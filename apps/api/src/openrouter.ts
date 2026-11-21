import { BadGatewayException, Logger } from '@nestjs/common';
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

export async function askOpenRouter(
  apiKey: string, model: string, instructions: string, question: string, inspect: (args: string) => Promise<unknown>,
) {
  const messages: Message[] = [{ role: 'system', content: instructions }, { role: 'user', content: question }];
  const signal = AbortSignal.timeout(90_000);
  let callCount = 0;
  for (let round = 0; round < 5; round++) {
    const requireTool = round === 0;
    let completion;
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, messages, tools: [tool], tool_choice: requireTool ? 'required' : 'auto',
          provider: { require_parameters: true }, max_tokens: 2048,
        }),
        signal,
      });
      if (!response.ok) {
        logger.warn(`Chat completion returned HTTP ${response.status}`);
        throw new Error('OpenRouter HTTP error');
      }
      const { choices } = await response.json();
      completion = choices?.[0];
      if (completion?.error || completion?.finish_reason === 'length' || !completion?.message) {
        throw new Error('Incomplete OpenRouter response');
      }
    } catch {
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
