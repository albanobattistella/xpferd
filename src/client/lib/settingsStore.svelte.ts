import type { AppSettingsDto } from '$shared/types';
import { settingsApi } from './api/settingsApi.js';

// Defaults (matches backend defaults)
const DEFAULTS: AppSettingsDto = {
  locale: 'de-DE',
  dateFormat: 'DD.MM.YYYY',
  numberFormat: 'de-DE',
};

let settings = $state<AppSettingsDto>({ ...DEFAULTS });
let loaded = $state(false);

export function getSettings(): AppSettingsDto {
  return settings;
}

export function isLoaded(): boolean {
  return loaded;
}

export async function loadSettings(): Promise<AppSettingsDto> {
  try {
    const s = await settingsApi.get();
    settings = s;
    loaded = true;
    return s;
  } catch {
    loaded = true;
    return settings;
  }
}

export async function saveSettings(newSettings: AppSettingsDto): Promise<AppSettingsDto> {
  const s = await settingsApi.update(newSettings);
  settings = s;
  return s;
}
