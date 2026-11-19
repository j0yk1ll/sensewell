import { z } from 'zod';

export const healthResponse = z.object({
  status: z.enum(['ready', 'unavailable']),
});

export type HealthResponse = z.infer<typeof healthResponse>;
