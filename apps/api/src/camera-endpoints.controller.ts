import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Header, HttpCode, Param, Post, Req,
} from '@nestjs/common';
import { cameraEndpointInput } from '@sensewell/contracts';
import { normalizeCameraEndpoint } from '@sensewell/database';
import type { FastifyRequest } from 'fastify';
import { AuthService } from './auth.js';
import { DatabaseService } from './database.service.js';
import { IpCameraService } from './ip-camera.service.js';

function parseEndpoint(body: unknown) {
  const input = cameraEndpointInput.safeParse(body);
  const endpoint = input.success ? normalizeCameraEndpoint(input.data.endpoint) : undefined;
  if (!endpoint) throw new BadRequestException('Enter a hostname, IP address, or RTSP URL. Leave credentials out of the URL.');
  return endpoint;
}

@Controller('api/camera-endpoints')
export class CameraEndpointsController {
  constructor(
    private readonly auth: AuthService,
    private readonly database: DatabaseService,
    private readonly captures: IpCameraService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async settings(@Req() request: FastifyRequest) {
    const userId = await this.auth.requireTenant(request);
    const canManage = await this.database.endpoints.canManage(userId);
    return { canManage, endpoints: canManage ? await this.database.endpoints.list() : [] };
  }

  @Post()
  @HttpCode(204)
  async approve(@Req() request: FastifyRequest, @Body() body: unknown) {
    const userId = await this.requireAdministrator(request);
    await this.database.endpoints.add(userId, parseEndpoint(body));
  }

  @Delete(':endpoint')
  @HttpCode(204)
  async revoke(@Req() request: FastifyRequest, @Param('endpoint') value: string) {
    const userId = await this.requireAdministrator(request);
    const endpoint = parseEndpoint({ endpoint: value });
    await this.database.endpoints.remove(userId, endpoint);
    this.captures.revoke(endpoint);
  }

  private async requireAdministrator(request: FastifyRequest) {
    const userId = await this.auth.requireTenant(request);
    if (!await this.database.endpoints.canManage(userId)) {
      throw new ForbiddenException('Only camera endpoint administrators can manage approvals.');
    }
    return userId;
  }
}
