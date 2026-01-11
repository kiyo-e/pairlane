/**
 * Client-side i18n helpers for Pairlane.
 * Uses translations injected by the server via window.__TRANSLATIONS__
 */

import type { Translations, Locale } from "./index";

declare global {
  interface Window {
    __LOCALE__: Locale;
    __TRANSLATIONS__: Translations;
  }
}

/**
 * Get the current locale from window
 */
export function getLocale(): Locale {
  return window.__LOCALE__ || "en";
}

/**
 * Get translations from window
 */
export function getT(): Translations {
  return window.__TRANSLATIONS__;
}

/**
 * Get a translation value by key with optional parameter substitution
 */
export function t(key: string, params?: Record<string, string>): string {
  const translations = getT();
  const keys = key.split(".");
  let value: unknown = translations;

  for (const k of keys) {
    if (value && typeof value === "object" && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      return key;
    }
  }

  if (typeof value !== "string") return key;

  if (params) {
    return value.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? `{${name}}`);
  }

  return value;
}
