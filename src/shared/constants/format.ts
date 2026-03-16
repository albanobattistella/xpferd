/**
 * Formats a number using German locale (comma as decimal separator).
 * Always shows exactly 2 decimal places.
 * @param locale Optional locale string (default: 'de-DE')
 */
export function fmtDe(n: number, locale: string = 'de-DE'): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n ?? 0);
}

/**
 * Formats a number as currency using German locale with the correct symbol.
 * E.g. fmtCurrency(1250, 'EUR') → "1.250,00 €"
 *      fmtCurrency(1250, 'USD') → "1.250,00 $"
 * @param locale Optional locale string (default: 'de-DE')
 */
export function fmtCurrency(amount: number, currencyCode: string, locale: string = 'de-DE'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode || 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount ?? 0);
}

/**
 * Formats a number using the given locale.
 * Falls back to de-DE if no locale provided.
 */
export function fmtNumber(n: number, locale: string = 'de-DE'): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n ?? 0);
}

/**
 * Formats a date string (YYYY-MM-DD) using the given format pattern.
 * Supported: DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, MM/DD/YYYY
 */
export function fmtDate(dateStr: string, format: string = 'DD.MM.YYYY'): string {
  if (!dateStr) return '';
  // Handle datetime strings (e.g. "2026-03-16 14:30:00" or "2026-03-16T14:30:00") — extract date portion only
  const datePart = dateStr.includes('T') || dateStr.includes(' ')
    ? dateStr.substring(0, 10)
    : dateStr;
  const d = new Date(datePart + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  switch (format) {
    case 'DD.MM.YYYY': return `${dd}.${mm}.${yyyy}`;
    case 'DD/MM/YYYY': return `${dd}/${mm}/${yyyy}`;
    case 'DD-MM-YYYY': return `${dd}-${mm}-${yyyy}`;
    case 'YYYY-MM-DD': return `${yyyy}-${mm}-${dd}`;
    case 'MM/DD/YYYY': return `${mm}/${dd}/${yyyy}`;
    default: return `${dd}.${mm}.${yyyy}`;
  }
}

/**
 * Formats an IBAN with a space every 4 characters.
 * Input can be raw ("DE89370400440532013000") or already spaced ("DE89 3704 ...").
 */
export function formatIban(iban: string): string {
  if (!iban) return '';
  const clean = iban.replace(/\s/g, '').toUpperCase();
  return clean.replace(/(.{4})/g, '$1 ').trim();
}
