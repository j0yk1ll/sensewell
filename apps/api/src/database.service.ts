import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase } from '@sensewell/database';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly database = createDatabase();
  readonly cameras = this.database.cameras;
  readonly endpoints = this.database.endpoints;
  readonly zones = this.database.zones;
  readonly zoneEntryRules = this.database.zoneEntryRules;
  readonly zoneEntries = this.database.zoneEntries;
  readonly zoneActivity = this.database.zoneActivity;
  readonly observations = this.database.observations;
  readonly dwell = this.database.dwell;
  readonly recordings = this.database.recordings;
  readonly authPool = this.database.authPool;

  checkReadiness() {
    return this.database.checkReadiness();
  }

  onApplicationShutdown() {
    return this.database.close();
  }
}
