import {
  Controller,
  Get,
  Injectable,
  Logger,
  Module,
  ServiceUnavailableException,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { HealthResponse } from '@sensewell/contracts';
import { createDatabase } from '@sensewell/database';

@Injectable()
class DatabaseService implements OnApplicationShutdown {
  private readonly database = createDatabase();

  checkReadiness() {
    return this.database.checkReadiness();
  }

  onApplicationShutdown() {
    return this.database.close();
  }
}

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
  controllers: [HealthController],
  providers: [DatabaseService],
})
export class AppModule {}
