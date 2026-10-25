/**
 * Access to Pi's live theme.
 *
 * The instance lives on `globalThis` (Pi shares it across module loaders), but
 * the proxy is not part of the package's public exports — only the `Theme`
 * class is. Reading the well-known symbol is how an extension reaches it
 * outside a render callback.
 */
const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");

export interface ThemeLike {
	fg(color: string, text: string): string;
	bg(color: string, text: string): string;
	bold(text: string): string;
}

export function getTheme(): ThemeLike | undefined {
	return (globalThis as unknown as Record<symbol, ThemeLike | undefined>)[THEME_KEY];
}
