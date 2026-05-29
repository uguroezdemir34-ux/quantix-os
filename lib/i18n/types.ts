export type Locale = "en" | "tr";
export const DEFAULT_LOCALE: Locale = "en";
export type Dictionary = {
  [key: string]: string | Dictionary;
};
