import type { CustomFontDto } from '$shared/types/Invoice';

/**
 * Inject @font-face rules into a <style> element in document.head so that
 * custom fonts are available immediately for canvas preview rendering.
 * Called from a Svelte $effect whenever the template's customFonts change.
 */
export function injectFontFaces(fonts: CustomFontDto[]): void {
  const styleId = 'xr-font-faces';
  let el = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = styleId;
    document.head.appendChild(el);
  }
  el.textContent = fonts.flatMap(cf => {
    const rules = [
      `@font-face{font-family:'${cf.name}';src:url(data:${cf.mimeType};base64,${cf.data});font-weight:normal}`,
    ];
    if (cf.dataBold) {
      rules.push(
        `@font-face{font-family:'${cf.name}';src:url(data:${cf.mimeType};base64,${cf.dataBold});font-weight:bold}`,
      );
    }
    return rules;
  }).join('');
}
