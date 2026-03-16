import { z } from 'zod';

export const invoiceNumberTemplateSchema = z.object({
  name: z.string().min(1),
  prefix: z.string().min(1),
  digits: z.number().int().min(1).max(6),
  nextNumber: z.number().int().min(1),
});

export const paymentTemplateSchema = z.object({
  name: z.string().min(1),
  paymentMeansCode: z.string().min(1),
  iban: z.string().optional().or(z.literal('')),
  bic: z.string().optional().or(z.literal('')),
  paymentTerms: z.string().optional().or(z.literal('')),
});

export const lineItemTemplateSchema = z.object({
  name: z.string().min(1),
  unitCode: z.string().min(1),
  netPrice: z.number().min(0),
  vatCategoryCode: z.string().min(1),
  vatRate: z.number().min(0),
});

export const invoiceTemplateSchema = z.object({
  name: z.string().min(1),
  data: z.string().min(1),
});
