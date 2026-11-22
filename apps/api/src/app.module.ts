import {
  Controller,
  Get,
  Logger,
  Module,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { HealthResponse } from '@sensewell/contracts';
import { DatabaseService } from './database.service.js';
import { AuthController, AuthService } from './auth.js';
import { CamerasController } from './cameras.controller.js';
import { CameraEndpointsController } from './camera-endpoints.controller.js';
import { DwellTriggersController } from './dwell-triggers.controller.js';
import { IpCameraService } from './ip-camera.service.js';

@Controller('api')
class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly database: DatabaseService) {}

  @Get('health')
  async health(): Promise<HealthResponse> {
    try {
      await this.database.checkReadiness();
      return { status: 'ready' };
    } catch {
      this.logger.warn('PostgreSQL readiness check failed');
      throw new ServiceUnavailableException({ status: 'unavailable' } satisfies HealthResponse);
    }
  }
}

@Module({
  controllers: [HealthController, AuthController, CamerasController, CameraEndpointsController, DwellTriggersController],
  providers: [DatabaseService, AuthService, IpCameraService],
})
export class AppModule {}
