import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

const adapter = new FastifyAdapter();
const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);

if (process.env.STATIC_ROOT) {
  app.useStaticAssets({ root: process.env.STATIC_ROOT, wildcard: false });
}

app.enableShutdownHooks();
await app.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1');
