/**
 * Simple i18n module for Pairlane.
 * Supports: ja, en, zh
 */

import ja from "../locales/ja.json";
import en from "../locales/en.json";
import zh from "../locales/zh.json";

export type Locale = "ja" | "en" | "zh";
export type Translations = typeof ja;

const locales: Record<Locale, Translations> = { ja, en, zh };

export const supportedLocales: Locale[] = ["ja", "en", "zh"];
export const defaultLocale: Locale = "en";

/**
 * Get translations for a locale
 */
export function getTranslations(locale: Locale): Translations {
  return locales[locale] || locales[defaultLocale];
}

/**
 * Detect locale from Accept-Language header
 */
export function detectLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return defaultLocale;

  const languages = acceptLanguage
    .split(",")
    .map((lang) => {
      const [code, q] = lang.trim().split(";q=");
      return { code: code.toLowerCase(), q: q ? parseFloat(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { code } of languages) {
    const primary = code.split("-")[0];
    if (primary === "ja") return "ja";
    if (primary === "zh") return "zh";
    if (primary === "en") return "en";
  }

  return defaultLocale;
}

/**
 * Get nested translation value by key path (e.g., "home.heroTitle")
 */
export function t(translations: Translations, key: string, params?: Record<string, string>): string {
  const keys = key.split(".");
  let value: unknown = translations;

  for (const k of keys) {
    if (value && typeof value === "object" && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      return key; // Return key if not found
    }
  }

  if (typeof value !== "string") return key;

  // Replace placeholders like {name}
  if (params) {
    return value.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? `{${name}}`);
  }

  return value;
}

/**
 * Get all translations as a flat object for client-side use
 */
export function getClientTranslations(locale: Locale): Translations {
  return getTranslations(locale);
}
