import deDe from '../../shared/i18n/de-DE.js';
import enUs from '../../shared/i18n/en-US.js';
import { getSettings } from './settingsStore.svelte.js';

export type Locale = 'de-DE' | 'en-US';

const translations: Record<Locale, Record<string, string>> = {
  'de-DE': deDe,
  'en-US': enUs,
};

/**
 * Returns the translated string for the given key.
 * Reads the locale from the reactive settings store ($state),
 * so any {t('key')} in a Svelte template re-evaluates when the locale changes.
 */
export function t(key: keyof typeof deDe): string {
  const locale = (getSettings().locale || 'de-DE') as Locale;
  return (translations[locale] ?? translations['de-DE'])[key] ?? key;
}
