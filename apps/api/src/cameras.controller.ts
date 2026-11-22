import type { FileHandle } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, NotFoundException,
  Param, ParseUUIDPipe, Post, Put, Req, Res, ServiceUnavailableException,
} from '@nestjs/common';
import { calibratedZoneInput, cameraZoneInput, ipCameraInput, type IpCamera } from '@sensewell/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.js';
import { DatabaseService } from './database.service.js';
import { IpCameraService } from './ip-camera.service.js';
import { cameraStream, encryptStream } from './ip-camera-source.js';

const privateFootageHeaders = {
  'Cache-Control': 'private, no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};

function byteRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return;
  const [, first, last] = match;
  if (!first && !last) return;

  const start = first ? Number(first) : Math.max(0, size - Number(last));
  const end = first && last ? Math.min(Number(last), size - 1) : size - 1;
  if (start <= end) return { start, end };
}

function parseZone(body: unknown) {
  const zone = cameraZoneInput.safeParse(body);
  if (!zone.success) {
    throw new BadRequestException('Enter a zone name and draw a valid outline within the camera image.');
  }
  const calibrated = calibratedZoneInput(zone.data);
  if (!calibrated) throw new BadRequestException('The floor plan must project inside the camera image and pass the independent calibration checks.');
  return calibrated;
}

@Controller('api/cameras')
export class CamerasController {
  constructor(
    private readonly auth: AuthService,
    private readonly database: DatabaseService,
    private readonly ipCameras: IpCameraService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(@Req() request: FastifyRequest): Promise<IpCamera[]> {
    const tenantId = await this.auth.requireTenant(request);
    const cameras = await this.database.cameras.list(tenantId);
    return cameras.map(({ id, name }) => ({ id, name, kind: 'ip' }));
  }

  @Post('ip')
  @Header('Cache-Control', 'private, no-store')
  async connect(@Req() request: FastifyRequest, @Body() body: unknown) {
    const tenantId = await this.auth.requireTenant(request);
    const input = ipCameraInput.safeParse(body);
    const stream = input.success ? cameraStream(input.data) : undefined;
    if (!input.success || !stream) {
      throw new BadRequestException('Enter an RTSP stream URL and provide any credentials in the separate fields.');
    }
    const endpoint = await this.ipCameras.allowedEndpoint(stream);
    if (!endpoint) throw new BadRequestException('This camera endpoint needs approval in Camera endpoints.');

    const camera = { id: randomUUID(), name: input.data.name, kind: 'ip' as const };
    await this.database.cameras.addIp(tenantId, {
      id: camera.id, name: camera.name, encryptedStream: encryptStream(stream),
    });
    this.ipCameras.start(tenantId, camera.id, stream, endpoint);
    return camera;
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest) {
    const tenantId = await this.auth.requireTenant(request);
    if (!await this.database.cameras.removeIp(tenantId, id)) throw new NotFoundException('Camera not found.');
    await this.ipCameras.stop(id);
  }

  @Get(':id/capture')
  @Header('Cache-Control', 'private, no-store')
  async captureStatus(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest) {
    await this.requireCamera(request, id);
    return this.ipCameras.status(id);
  }

  @Get(':id/capture/video')
  async liveVideo(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    await this.requireCamera(request, id);
    if (this.ipCameras.status(id).state !== 'connected') throw new ServiceUnavailableException('Camera feed is unavailable.');
    return this.sendFootage(reply, (signal) => this.ipCameras.video(id, signal));
  }

  @Get(':id/recordings')
  @Header('Cache-Control', 'private, no-store')
  async recordings(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest) {
    const { tenantId } = await this.requireCamera(request, id);
    return this.database.recordings.list(tenantId, id);
  }

  @Get(':id/recordings/:recordingId')
  async recording(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('recordingId', ParseUUIDPipe) recordingId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const { tenantId } = await this.requireCamera(request, id);
    if (!await this.database.recordings.find(tenantId, id, recordingId)) {
      throw new NotFoundException('Recording not found.');
    }
    return this.sendMp4(await this.ipCameras.open(id, recordingId), request, reply);
  }

  @Get(':id/trigger-events/:eventId/recordings/:recordingId')
  async triggerEvidence(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('recordingId', ParseUUIDPipe) recordingId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const { tenantId } = await this.requireCamera(request, id);
    const evidence = await this.database.dwell.eventEvidence(tenantId, id, eventId, recordingId);
    if (!evidence) throw new NotFoundException('Trigger evidence not found.');
    return this.sendMp4(await this.ipCameras.open(evidence.cameraId, evidence.recordingId), request, reply);
  }

  @Get(':id/zones')
  @Header('Cache-Control', 'private, no-store')
  async listZones(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest) {
    const { camera, tenantId } = await this.requireCamera(request, id);
    return this.database.zones.list(tenantId, camera.id);
  }

  @Post(':id/zones')
  @Header('Cache-Control', 'private, no-store')
  async addZone(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ) {
    const { camera, tenantId } = await this.requireCamera(request, id);
    return this.database.zones.add(tenantId, camera.id, parseZone(body));
  }

  @Put(':id/zones/:zoneId')
  @Header('Cache-Control', 'private, no-store')
  async updateZone(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ) {
    const { camera, tenantId } = await this.requireCamera(request, id);
    const zone = await this.database.zones.update(tenantId, camera.id, zoneId, parseZone(body));
    if (!zone) throw new NotFoundException('Camera zone not found.');
    return zone;
  }

  @Delete(':id/zones/:zoneId')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  async removeZone(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
    @Req() request: FastifyRequest,
  ) {
    const { camera, tenantId } = await this.requireCamera(request, id);
    if (!await this.database.zones.remove(tenantId, camera.id, zoneId)) {
      throw new NotFoundException('Camera zone not found.');
    }
  }

  private async sendMp4(file: FileHandle, request: FastifyRequest, reply: FastifyReply) {
    try {
      const { size } = await file.stat();
      if (!size) throw new ServiceUnavailableException('The footage is unavailable.');

      reply.headers(privateFootageHeaders).header('Accept-Ranges', 'bytes');

      if (!request.headers.range) {
        return reply.type('video/mp4').header('Content-Length', size).send(file.createReadStream());
      }

      const range = byteRange(request.headers.range, size);
      if (!range) {
        await file.close();
        return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      }
      const { start, end } = range;
      return reply.code(206).type('video/mp4')
        .header('Content-Range', `bytes ${start}-${end}/${size}`)
        .header('Content-Length', end - start + 1)
        .send(file.createReadStream(range));
    } catch (error) {
      await file.close();
      throw error;
    }
  }

  private sendFootage(
    reply: FastifyReply,
    stream: (signal: AbortSignal) => AsyncIterable<Buffer | string>,
  ) {
    const abort = new AbortController();
    reply.raw.once('close', () => abort.abort());
    return reply
      .headers(privateFootageHeaders)
      .type('multipart/x-mixed-replace; boundary=frame')
      .send(Readable.from(stream(abort.signal)));
  }

  private async requireCamera(request: FastifyRequest, id: string) {
    const tenantId = await this.auth.requireTenant(request);
    const camera = await this.database.cameras.find(tenantId, id);
    if (!camera) throw new NotFoundException('Camera not found.');
    return { tenantId, camera };
  }
}
