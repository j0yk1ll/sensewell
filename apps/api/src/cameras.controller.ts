import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, NotFoundException,
  Param, ParseUUIDPipe, PayloadTooLargeException, Post, Query, Req, Res,
  ServiceUnavailableException, UnsupportedMediaTypeException,
} from '@nestjs/common';
import { cameraName, cameraZoneInput, maxCameraNameLength, maxClipBytes, maxClipMiB, replayOptions } from '@sensewell/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.js';
import { ClipStorage } from './clip-storage.js';
import { DatabaseService } from './database.service.js';
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

@Controller('api/cameras')
export class CamerasController {
  constructor(
    private readonly auth: AuthService,
    private readonly database: DatabaseService,
    private readonly clips: ClipStorage,
    private readonly replay: ReplayService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(@Req() request: FastifyRequest) {
    const tenantId = await this.auth.requireTenant(request);
    return this.database.cameras.list(tenantId);
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
    const zone = cameraZoneInput.safeParse(body);
    if (!zone.success) {
      throw new BadRequestException('Enter a zone name and draw a valid outline within the camera image.');
    }
    return this.database.zones.add(tenantId, camera.id, zone.data);
  }

  @Get(':id/media')
  async media(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.requireCamera(request, id);
    const file = await this.clips.open(id);
    try {
      const { size } = await file.stat();
      if (!size) throw new ServiceUnavailableException('The source clip is unavailable.');

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
    await this.requireCamera(request, id);
    return this.replay.status(id);
  }

  @Post(':id/replay')
  @HttpCode(202)
  async start(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ) {
    const { camera, tenantId } = await this.requireCamera(request, id);
    const options = replayOptions.safeParse(body);
    if (!options.success) throw new BadRequestException('Specify whether replay should loop.');
    const clip = await this.clips.open(id);
    await clip.close();
    return this.replay.start(tenantId, camera, options.data.loop);
  }

  @Delete(':id/replay')
  async stop(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest) {
    await this.requireCamera(request, id);
    return this.replay.stop(id);
  }

  @Get(':id/replay/video')
  async video(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.requireCamera(request, id);
    const state = this.replay.status(id).state;
    if (state !== 'starting' && state !== 'running' && state !== 'finished') {
      throw new ServiceUnavailableException('Replay footage is unavailable.');
    }
    const abort = new AbortController();
    reply.raw.once('close', () => abort.abort());
    return reply
      .headers(privateFootageHeaders)
      .type('multipart/x-mixed-replace; boundary=frame')
      .send(Readable.from(this.replay.video(id, abort.signal)));
  }

  private async requireCamera(request: FastifyRequest, id: string) {
    const tenantId = await this.auth.requireTenant(request);
    const camera = await this.database.cameras.find(tenantId, id);
    if (!camera) throw new NotFoundException('Synthetic Camera not found.');
    return { tenantId, camera };
  }
}
