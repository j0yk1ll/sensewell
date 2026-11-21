import type { FileHandle } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, NotFoundException,
  Param, ParseUUIDPipe, PayloadTooLargeException, Post, Put, Query, Req, Res,
  ServiceUnavailableException, UnsupportedMediaTypeException,
} from '@nestjs/common';
import { cameraName, cameraZoneInput, ipCameraInput, maxCameraNameLength, maxClipBytes, maxClipMiB, replayOptions, zoneEntryRuleInput, zoneEntryRuleToggle } from '@sensewell/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.js';
import { ClipStorage, evidenceWindow } from './clip-storage.js';
import { DatabaseService } from './database.service.js';
import { IpCameraService } from './ip-camera.service.js';
import { cameraStream, encryptStream } from './ip-camera-source.js';
import { ReplayService } from './replay.service.js';

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
  return zone.data;
}

function parseRule(body: unknown) {
  const input = zoneEntryRuleInput.safeParse(body);
  if (!input.success) throw new BadRequestException('Choose a saved zone, a rule name, and a minimum confidence from 0 to 100%.');
  return input.data;
}

@Controller('api/cameras')
export class CamerasController {
  constructor(
    private readonly auth: AuthService,
    private readonly database: DatabaseService,
    private readonly clips: ClipStorage,
    private readonly replay: ReplayService,
    private readonly ipCameras: IpCameraService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(@Req() request: FastifyRequest) {
    const tenantId = await this.auth.requireTenant(request);
    const cameras = await this.database.cameras.list(tenantId);
    return cameras.map(({ id, name, durationMs }) =>
      durationMs === null ? { id, name, kind: 'ip' as const } : { id, name, durationMs });
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
    if (!await this.database.cameras.removeIp(tenantId, id)) throw new NotFoundException('IP camera not found.');
    await this.ipCameras.stop(id);
  }

  @Get(':id/capture')
  @Header('Cache-Control', 'private, no-store')
  async captureStatus(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest) {
    await this.requireIpCamera(request, id);
    return this.ipCameras.status(id);
  }

  @Get(':id/capture/video')
  async liveVideo(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    await this.requireIpCamera(request, id);
    if (this.ipCameras.status(id).state !== 'connected') throw new ServiceUnavailableException('Camera feed is unavailable.');
    return this.sendFootage(reply, (signal) => this.ipCameras.video(id, signal));
  }

  @Get(':id/recordings')
  @Header('Cache-Control', 'private, no-store')
  async recordings(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest) {
    const tenantId = await this.requireIpCamera(request, id);
    return this.database.recordings.list(tenantId, id);
  }

  @Get(':id/recordings/:recordingId')
  async recording(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('recordingId', ParseUUIDPipe) recordingId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const tenantId = await this.requireIpCamera(request, id);
    if (!await this.database.recordings.find(tenantId, id, recordingId)) {
      throw new NotFoundException('Recording not found.');
    }
    return this.sendMp4(await this.ipCameras.open(id, recordingId), request, reply);
  }

  @Post()
  async add(@Req() request: FastifyRequest, @Query('name') input: unknown) {
    const tenantId = await this.auth.requireTenant(request);
    const name = cameraName.safeParse(input);
    if (!name.success) throw new BadRequestException(`Enter a camera name up to ${maxCameraNameLength} characters.`);
    if (!(request.body instanceof Readable)) {
      throw new UnsupportedMediaTypeException('Send the clip as application/octet-stream.');
    }
    if (Number(request.headers['content-length']) > maxClipBytes) {
      throw new PayloadTooLargeException(`Choose a clip up to ${maxClipMiB} MiB.`);
    }

    const id = randomUUID();
    const timeline = await this.clips.save(id, request.body);
    const camera = { id, name: name.data, durationMs: timeline.durationMs };
    try {
      await this.database.cameras.add(tenantId, { ...camera, startOffsetMs: timeline.startOffsetMs });
    } catch (error) {
      await this.clips.discard(id);
      throw error;
    }
    return camera;
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

  @Get(':id/zone-entry-rules')
  @Header('Cache-Control', 'private, no-store')
  async listZoneEntryRules(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest) {
    const { tenantId } = await this.requireSyntheticCamera(request, id);
    return this.database.zoneEntryRules.list(tenantId, id);
  }

  @Post(':id/zone-entry-rules')
  @Header('Cache-Control', 'private, no-store')
  async addZoneEntryRule(
    @Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest, @Body() body: unknown,
  ) {
    const { tenantId } = await this.requireSyntheticCamera(request, id);
    const rule = await this.database.zoneEntryRules.add(tenantId, id, parseRule(body));
    if (!rule) throw new NotFoundException('Camera zone not found.');
    return rule;
  }

  @Put(':id/zone-entry-rules/:ruleId')
  @Header('Cache-Control', 'private, no-store')
  async updateZoneEntryRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ) {
    const { tenantId } = await this.requireSyntheticCamera(request, id);
    const rule = await this.database.zoneEntryRules.update(tenantId, id, ruleId, parseRule(body));
    if (!rule) throw new NotFoundException('Rule or saved zone not found.');
    return rule;
  }

  @Delete(':id/zone-entry-rules/:ruleId')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  async removeZoneEntryRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Req() request: FastifyRequest,
  ) {
    const { tenantId } = await this.requireSyntheticCamera(request, id);
    if (!await this.database.zoneEntryRules.remove(tenantId, id, ruleId)) {
      throw new NotFoundException('Rule not found.');
    }
  }

  @Put(':id/zone-entry-rules/:ruleId/enabled')
  @Header('Cache-Control', 'private, no-store')
  async setZoneEntryRuleEnabled(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ) {
    const { tenantId } = await this.requireSyntheticCamera(request, id);
    const input = zoneEntryRuleToggle.safeParse(body);
    if (!input.success) throw new BadRequestException('Specify whether the rule is enabled.');
    const rule = await this.database.zoneEntryRules.setEnabled(tenantId, id, ruleId, input.data.enabled);
    if (!rule) throw new NotFoundException('Zone-entry rule not found.');
    return rule;
  }

  @Get(':id/zone-entry-events')
  @Header('Cache-Control', 'private, no-store')
  async zoneEntryHistory(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest) {
    const { tenantId } = await this.requireSyntheticCamera(request, id);
    return this.database.zoneEntries.history(tenantId, id);
  }

  @Get(':id/zone-entry-events/:eventId')
  @Header('Cache-Control', 'private, no-store')
  async zoneEntryEvidence(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() request: FastifyRequest,
  ) {
    const { evidence, window } = await this.requireEventEvidence(request, id, eventId);
    return { ...evidence, window };
  }

  @Get(':id/zone-entry-events/:eventId/clip')
  async zoneEntryClip(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const abort = new AbortController();
    const cancel = () => abort.abort();
    reply.raw.once('close', cancel);
    try {
      const { window } = await this.requireEventEvidence(request, id, eventId);
      const clip = await this.clips.evidenceClip(id, window, abort.signal);
      return reply.headers(privateFootageHeaders).type('video/mp4').send(clip);
    } finally {
      reply.raw.off('close', cancel);
    }
  }

  private async requireEventEvidence(request: FastifyRequest, id: string, eventId: string) {
    const { camera, tenantId } = await this.requireSyntheticCamera(request, id);
    const evidence = await this.database.zoneEntries.evidence(tenantId, id, eventId);
    if (!evidence?.jpeg) throw new NotFoundException('Event evidence not found.');
    return { evidence, window: evidenceWindow(evidence.sourceMs, camera) };
  }

  @Get(':id/media')
  async media(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.requireSyntheticCamera(request, id);
    return this.sendMp4(await this.clips.open(id), request, reply);
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

  @Get(':id/replay')
  @Header('Cache-Control', 'private, no-store')
  async status(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest) {
    await this.requireSyntheticCamera(request, id);
    return this.replay.status(id);
  }

  @Post(':id/replay')
  @HttpCode(202)
  async start(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ) {
    const { camera, tenantId } = await this.requireSyntheticCamera(request, id);
    const options = replayOptions.safeParse(body);
    if (!options.success) throw new BadRequestException('Specify whether replay should loop.');
    const clip = await this.clips.open(id);
    await clip.close();
    return this.replay.start(tenantId, camera, options.data.loop);
  }

  @Delete(':id/replay')
  async stop(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest) {
    await this.requireSyntheticCamera(request, id);
    return this.replay.stop(id);
  }

  @Get(':id/replay/video')
  async video(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.requireReplayFootage(request, id);
    return this.sendFootage(reply, (signal) => this.replay.video(id, signal));
  }

  @Get(':id/replay/frames')
  async replayImages(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.requireReplayFootage(request, id);
    return this.sendFootage(reply, (signal) => this.replay.images(id, signal), 'application/x-ndjson');
  }

  private async requireReplayFootage(request: FastifyRequest, id: string) {
    await this.requireSyntheticCamera(request, id);
    const state = this.replay.status(id).state;
    if (state !== 'starting' && state !== 'running' && state !== 'finished') {
      throw new ServiceUnavailableException('Replay footage is unavailable.');
    }
  }

  private sendFootage(
    reply: FastifyReply,
    stream: (signal: AbortSignal) => AsyncIterable<Buffer | string>,
    contentType = 'multipart/x-mixed-replace; boundary=frame',
  ) {
    const abort = new AbortController();
    reply.raw.once('close', () => abort.abort());
    return reply
      .headers(privateFootageHeaders)
      .type(contentType)
      .send(Readable.from(stream(abort.signal)));
  }

  private async requireCamera(request: FastifyRequest, id: string) {
    const tenantId = await this.auth.requireTenant(request);
    const camera = await this.database.cameras.find(tenantId, id);
    if (!camera) throw new NotFoundException('Camera not found.');
    return { tenantId, camera };
  }

  private async requireSyntheticCamera(request: FastifyRequest, id: string) {
    const { tenantId, camera } = await this.requireCamera(request, id);
    const { durationMs, startOffsetMs } = camera;
    if (durationMs === null || startOffsetMs === null) throw new NotFoundException('Synthetic Camera not found.');
    return { tenantId, camera: { ...camera, durationMs, startOffsetMs } };
  }

  private async requireIpCamera(request: FastifyRequest, id: string) {
    const { tenantId, camera } = await this.requireCamera(request, id);
    if (camera.durationMs !== null) throw new NotFoundException('IP camera not found.');
    return tenantId;
  }
}
