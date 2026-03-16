import { z } from 'zod';

export const appSettingsSchema = z.object({
  locale: z.enum(['de-DE', 'en-US']),
  dateFormat: z.enum(['DD.MM.YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD-MM-YYYY']),
  numberFormat: z.enum(['de-DE', 'en-US']),
});

export type AppSettingsInput = z.infer<typeof appSettingsSchema>;
