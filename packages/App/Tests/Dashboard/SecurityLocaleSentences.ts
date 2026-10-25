import fs from "fs";
import path from "path";
import { getLocalePath } from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import {
  readGlobalSameAsEnglish,
  readLocaleProgress,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";

/*
 * What the Security Events pages' tests ask of a Dashboard locale: its
 * entries, and whether a sentence is said in the language - translated, or
 * one that reads the same as the English there ("Matrix" in German), as
 * the locale's i18n/Progress file or the global SameAsEnglish list says.
 */

export function readDashboardLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../..", getLocalePath(locale)),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

const GLOBAL_SAME_AS_ENGLISH: Array<string> = readGlobalSameAsEnglish();

export function isSaidInLocale(
  locale: string,
  english: string,
  value: unknown,
): boolean {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  if (value !== english) {
    return true;
  }

  return (
    GLOBAL_SAME_AS_ENGLISH.includes(english) ||
    (readLocaleProgress(locale)?.sameAsEnglish || []).includes(english)
  );
}
