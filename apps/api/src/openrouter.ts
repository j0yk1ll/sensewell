import { setTimeout } from 'node:timers/promises';
import { BadGatewayException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { activityQuery } from '@sensewell/contracts';

const logger = new Logger('OpenRouter');
const toolName = 'inspect_activity';
const tool = {
  type: 'function',
  function: {
    name: toolName,
    description: 'Query recorded observations and derived crossings, distinct entrants, occupancy, dwell and supporting timestamps for a replay pass.',
    parameters: activityQuery.toJSONSchema({ target: 'openapi-3.0', io: 'input' }),
  },
};

type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls: ToolCall[]; reasoning_details?: unknown[] }
  | { role: 'tool'; content: string; tool_call_id: string };

async function rateLimit(response: Response) {
  const payload = await response.json().catch(() => undefined);
  const source = payload?.error?.metadata?.limit_source;
  const daily = source === 'openrouter_free_tier_daily';
  const retryAfter = response.headers.get('Retry-After');
  const reset = response.headers.get('X-RateLimit-Reset');
  let waitMs: number | undefined;
  if (retryAfter) {
    waitMs = /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
  }
  if (!Number.isFinite(waitMs) && reset && /^\d+$/.test(reset)) {
    waitMs = Number(reset) - Date.now();
  }
  const cooldownMs = waitMs !== undefined && Number.isFinite(waitMs) ? Math.max(0, waitMs) : undefined;
  const waitSeconds = cooldownMs === undefined ? undefined : Math.ceil(cooldownMs / 1000);
  const reason = daily ? 'daily free-model quota' : source === 'upstream_provider_shared_pool' ? 'provider capacity' : 'request rate';
  logger.warn(`OpenRouter rate limited chat (${reason})`);
  const message = daily
    ? 'OpenRouter’s daily free-model quota has been reached. Try again after midnight UTC.'
    : waitSeconds
      ? `OpenRouter is rate limiting chat. Try again in ${waitSeconds} seconds.`
      : 'OpenRouter is rate limiting chat. Try again shortly.';
  return { retryMs: daily ? Infinity : (cooldownMs ?? 1000), message };
}

export async function askOpenRouter(
  apiKey: string, model: string, instructions: string, question: string, inspect: (args: string) => Promise<unknown>,
) {
  const messages: Message[] = [{ role: 'system', content: instructions }, { role: 'user', content: question }];
  const signal = AbortSignal.timeout(90_000);
  let callCount = 0;
  let retried = false;
  for (let round = 0; round < 5; round++) {
    const body = JSON.stringify({
      model, messages, tools: [tool], tool_choice: round === 0 ? 'required' : 'auto',
      provider: { require_parameters: true }, max_tokens: 2048,
    });
    const request = () => fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body,
      signal,
    }).catch(() => {
      throw new BadGatewayException('The chat model could not respond. Try again.');
    });
    let response = await request();
    if (response.status === 429) {
      let limit = await rateLimit(response);
      if (!retried && limit.retryMs <= 5000) {
        retried = true;
        await setTimeout(limit.retryMs, undefined, { signal }).catch(() => {
          throw new HttpException(limit.message, HttpStatus.TOO_MANY_REQUESTS);
        });
        response = await request();
        if (response.status === 429) limit = await rateLimit(response);
      }
      if (response.status === 429) throw new HttpException(limit.message, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!response.ok) {
      logger.warn(`Chat completion returned HTTP ${response.status}`);
      throw new BadGatewayException('The chat model could not respond. Try again.');
    }
    const payload = await response.json().catch(() => undefined);
    const completion = payload?.choices?.[0];
    if (completion?.error || completion?.finish_reason === 'length' || !completion?.message) {
      throw new BadGatewayException('The chat model could not respond. Try again.');
    }

    const { content, tool_calls: calls, reasoning_details: reasoning } = completion.message;
    if (calls === undefined || (Array.isArray(calls) && calls.length === 0)) {
      if (callCount && typeof content === 'string' && content.trim()) return content.trim();
      break;
    }
    if (!Array.isArray(calls) || callCount + calls.length > 8 || !calls.every((call) =>
      typeof call?.id === 'string' && call.type === 'function' && typeof call.function?.name === 'string'
      && typeof call.function.arguments === 'string' && call.function.arguments.length <= 4096)) break;
    callCount += calls.length;
    messages.push({
      role: 'assistant', content: typeof content === 'string' ? content : null, tool_calls: calls,
      reasoning_details: Array.isArray(reasoning) ? reasoning : undefined,
    });
    for (const call of calls as ToolCall[]) {
      const result = call.function.name === toolName
        ? await inspect(call.function.arguments)
        : { error: 'Use inspect_activity to query recorded evidence.' };
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  throw new BadGatewayException('The chat model could not complete the evidence query. Try again.');
}
