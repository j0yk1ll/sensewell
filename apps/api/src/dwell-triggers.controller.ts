import { BadRequestException, Body, Controller, Get, Header, NotFoundException, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { dwellMatch, forkliftDwellLookbackMs, triggerDraftInput, triggerPreviewRange, triggerToggle, type CameraZone, type TriggerPreview } from '@sensewell/contracts';
import type { FastifyRequest } from 'fastify';
import { AuthService } from './auth.js';
import { DatabaseService } from './database.service.js';
import { evaluateForkliftDwell } from './forklift-dwell.js';
import { interpretTrigger } from './interpret-trigger.js';

function floorOutline(points: NonNullable<CameraZone['ground']>['points']) {
  // The same polygon may be drawn from a different starting vertex or in reverse.
  return points.map((point, index) => [
    JSON.stringify(point), JSON.stringify(points[(index + 1) % points.length]),
  ].sort().join(':')).sort().join('|');
}

@Controller('api/cameras/:cameraId/triggers')
export class DwellTriggersController {
  constructor(private readonly auth: AuthService, private readonly database: DatabaseService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async workspace(@Param('cameraId', ParseUUIDPipe) cameraId: string, @Req() request: FastifyRequest) {
    const tenantId = await this.requireCamera(request, cameraId);
    const [triggers, history] = await Promise.all([
      this.database.dwell.list(tenantId, cameraId), this.database.dwell.history(tenantId, cameraId),
    ]);
    return {
      triggers, analysisConfigured: Boolean(process.env.REPLAY_DETECTOR_URL),
      history: history.map(({ id, condition, match }) => ({ id, condition, ...dwellMatch.parse(match) })),
    };
  }

  @Post()
  @Header('Cache-Control', 'private, no-store')
  async draft(@Param('cameraId', ParseUUIDPipe) cameraId: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const tenantId = await this.requireCamera(request, cameraId);
    const input = triggerDraftInput.safeParse(body);
    if (!input.success) throw new BadRequestException('Choose a zone and describe the trigger in up to 1,000 characters.');
    const zone = (await this.database.zones.list(tenantId, cameraId)).find(({ id }) => id === input.data.zoneId);
    if (!zone) throw new NotFoundException('Camera zone not found.');
    const { condition, explanation } = await interpretTrigger(input.data.request, zone);
    if (condition?.zone.ground) {
      const outline = floorOutline(condition.zone.ground.points);
      const cameras = (await this.database.cameras.list(tenantId)).filter(({ id }) => id !== cameraId);
      const supportingViews = await Promise.all(cameras.map(async ({ id }) => {
        const zones = await this.database.zones.list(tenantId, id);
        const zone = zones.find((zone) => 'ground' in zone && floorOutline(zone.ground.points) === outline);
        return zone && { cameraId: id, zone };
      }));
      condition.supportingViews = supportingViews.filter((view) => view !== undefined);
    }
    const trigger = condition ? await this.database.dwell.draft(tenantId, cameraId, condition) : null;
    return { trigger, explanation };
  }

  @Put(':triggerId/enabled')
  @Header('Cache-Control', 'private, no-store')
  async setEnabled(
    @Param('cameraId', ParseUUIDPipe) cameraId: string,
    @Param('triggerId', ParseUUIDPipe) triggerId: string,
    @Body() body: unknown, @Req() request: FastifyRequest,
  ) {
    const tenantId = await this.requireCamera(request, cameraId);
    const input = triggerToggle.safeParse(body);
    if (!input.success) throw new BadRequestException('Confirm whether to enable or disable this condition.');
    const trigger = await this.database.dwell.setEnabled(tenantId, cameraId, triggerId, input.data.enabled);
    if (!trigger) throw new NotFoundException('Trigger not found.');
    return trigger;
  }

  @Post(':triggerId/preview')
  @Header('Cache-Control', 'private, no-store')
  async preview(
    @Param('cameraId', ParseUUIDPipe) cameraId: string,
    @Param('triggerId', ParseUUIDPipe) triggerId: string,
    @Body() body: unknown, @Req() request: FastifyRequest,
  ): Promise<TriggerPreview> {
    const tenantId = await this.requireCamera(request, cameraId);
    const range = triggerPreviewRange.safeParse(body);
    if (!range.success || range.data.endMs > Date.now()) {
      throw new BadRequestException('Choose a past time range of up to one hour.');
    }
    const trigger = await this.database.dwell.find(tenantId, cameraId, triggerId);
    if (!trigger) throw new NotFoundException('Trigger not found.');
    const { startMs, endMs } = range.data;
    const window = { startMs: Math.max(0, startMs - forkliftDwellLookbackMs), endMs };
    const recordings = await this.database.dwell.recordings(tenantId, cameraId, window, trigger.condition);
    const result = evaluateForkliftDwell(trigger.condition, recordings, window, undefined, cameraId);
    return {
      matches: result.matches.filter(({ occurrenceMs }) => occurrenceMs >= startMs).map((match) => dwellMatch.parse(match)),
      undecided: result.undecided.filter((gap) => gap.endMs >= startMs)
        .map((gap) => ({ ...gap, startMs: Math.max(startMs, gap.startMs) })),
    };
  }

  private async requireCamera(request: FastifyRequest, cameraId: string) {
    const tenantId = await this.auth.requireTenant(request);
    if (!await this.database.cameras.find(tenantId, cameraId)) throw new NotFoundException('Camera not found.');
    return tenantId;
  }
}
