import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  RUM_BROWSER_ENDPOINT_HINT,
  RUM_MOBILE_ENDPOINT_HINT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/RumSetupGuide";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * THE HINT UNDER A GUIDE'S ENDPOINT, IN THE READER'S LANGUAGE (#6458).
 *
 * The key step of a setup guide shows the endpoint, and under it a line on
 * how to use it: the RUM guide's "this address plus /v1/traces", the
 * serverless and queue guides' base endpoint. They were the guide's own
 * English strings, so a German page drew them in English under a German
 * key step. Each is a key of the locale files now, worded in every
 * language the Dashboard is read in, and a hint written as a bare string
 * fails here.
 */

const DASHBOARD_SOURCE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;
// A constant that holds the key (ENDPOINT_HINT).
const CONSTANT_NAME: RegExp = /^[A-Z][A-Z0-9_]*,?$/;
// The key selector passes the step's own hint along.
const PASSED_ALONG: RegExp = /^(?:props\.|keyStep\.)\w+/;
const OWN_HINT: RegExp = /^\w+\.endpointHint/;

function sourceFiles(directory: string): Array<string> {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const file: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return entry.name === "DocumentationTranslations"
          ? []
          : sourceFiles(file);
      }

      return TYPESCRIPT_FILE.test(entry.name) ? [file] : [];
    });
}

// Every `endpointHint:` a guide declares, with what follows it.
const DECLARED: Array<{ file: string; value: string }> = sourceFiles(
  DASHBOARD_SOURCE,
).flatMap((file: string): Array<{ file: string; value: string }> => {
  const source: string = fs.readFileSync(file, "utf8");

  return [...source.matchAll(/\bendpointHint:\s*([^,}\n][^\n]*)/g)].map(
    (match: RegExpMatchArray): { file: string; value: string } => {
      return {
        file: path.relative(DASHBOARD_SOURCE, file),
        value: (match[1] as string).trim(),
      };
    },
  );
});

// The hints written inline, as translationKey("...").
const INLINE_HINTS: Array<string> = sourceFiles(DASHBOARD_SOURCE).flatMap(
  (file: string): Array<string> => {
    const source: string = fs.readFileSync(file, "utf8");

    return [
      ...source.matchAll(
        /\bendpointHint:\s*translationKey\(\s*"((?:[^"\\]|\\.)*)"/g,
      ),
    ].map((match: RegExpMatchArray): string => {
      return JSON.parse(`"${match[1] as string}"`) as string;
    });
  },
);

const HINTS: Array<string> = [
  RUM_BROWSER_ENDPOINT_HINT,
  RUM_MOBILE_ENDPOINT_HINT,
  ...INLINE_HINTS,
];

describe("a setup guide's endpoint hint", () => {
  test("is a translation key, never a bare string", () => {
    expect(DECLARED.length).toBeGreaterThanOrEqual(5);

    for (const declared of DECLARED) {
      expect({
        ...declared,
        isKey:
          declared.value.startsWith("translationKey(") ||
          CONSTANT_NAME.test(declared.value) ||
          // The key selector passes the step's own hint along.
          PASSED_ALONG.test(declared.value) ||
          OWN_HINT.test(declared.value),
      }).toEqual({ ...declared, isKey: true });
    }
  });

  test("the RUM guide's two hints say how each SDK takes the address", () => {
    expect(RUM_BROWSER_ENDPOINT_HINT).toBe(
      "The browser exporter takes the full URL of each signal: this address plus /v1/traces.",
    );
    expect(RUM_MOBILE_ENDPOINT_HINT).toBe(
      "SDKs that take a base endpoint add /v1/traces, /v1/metrics and /v1/logs to it.",
    );
  });

  test("is a key of the English locale, worded in every language", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    expect(HINTS.length).toBeGreaterThanOrEqual(5);

    for (const hint of HINTS) {
      expect({ hint, isKey: english[hint] === hint }).toEqual({
        hint,
        isKey: true,
      });

      for (const language of DASHBOARD_LANGUAGES) {
        expect({
          language,
          hint,
          worded: isWordedInDashboardLocale(hint, language),
        }).toEqual({ language, hint, worded: true });
      }
    }
  });
});
