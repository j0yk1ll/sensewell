import { Controller, Get, Injectable, Post, Req, Res, UnauthorizedException, UnsupportedMediaTypeException } from '@nestjs/common';
import { betterAuth } from 'better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DatabaseService } from './database.service.js';

function createAuth(database: DatabaseService, baseURL: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');

  return betterAuth({
    database: database.authPool,
    secret,
    baseURL,
    trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',').map((origin) => origin.trim()),
    emailAndPassword: { enabled: true },
    advanced: { database: { generateId: 'uuid' } },
  });
}

@Injectable()
export class AuthService {
  readonly auth: ReturnType<typeof createAuth>;
  readonly baseURL = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').origin;

  constructor(database: DatabaseService) {
    this.auth = createAuth(database, this.baseURL);
  }

  async requireTenant(request: FastifyRequest) {
    const session = await this.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
      query: { disableRefresh: true },
    });
    if (!session) throw new UnauthorizedException('Sign in to access cameras.');
    return session.user.id;
  }
}

@Controller('api/auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Get('get-session')
  get(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    return this.handle(request, reply);
  }

  @Post(['sign-up/email', 'sign-in/email', 'sign-out'])
  post(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    if (request.body !== undefined && request.headers['content-type']?.split(';')[0] !== 'application/json') {
      throw new UnsupportedMediaTypeException('Send a JSON body.');
    }
    return this.handle(request, reply);
  }

  private async handle(request: FastifyRequest, reply: FastifyReply) {
    const headers = fromNodeHeaders(request.headers);
    const body = request.body === undefined ? undefined : JSON.stringify(request.body);
    // Fastify has already parsed the request. Forward the serialized body without its original length.
    headers.delete('content-length');
    const response = await this.service.auth.handler(new Request(
      this.service.baseURL + request.url,
      { method: request.method, headers, body },
    ));
    for (const [name, value] of response.headers) {
      if (name !== 'set-cookie') reply.header(name, value);
    }
    const cookies = response.headers.getSetCookie();
    if (cookies.length) reply.header('set-cookie', cookies);
    await reply.code(response.status).send(response.body);
  }
}
