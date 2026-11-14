import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestSurface, {
  BROWSER_ALLOWED_INGEST_SURFACES,
} from "../../../Types/Telemetry/TelemetryIngestSurface";

/*
 * WHAT A BROWSER KEY IS ACCEPTED FOR, WHEREVER ONEUPTIME SAYS IT (#7872).
 *
 * Ingest accepts a Browser key on the surfaces in
 * BROWSER_ALLOWED_INGEST_SURFACES only: OTLP traces, logs and metrics,
 * session replay, and Sentry - a browser app's Sentry DSN is public by
 * design (#7742). Four texts say what the key is accepted for, and all four
 * left Sentry out. A reader setting up a Sentry browser SDK was told the key
 * would not do, and could paste a Server key into the page instead, which
 * must never ship to a browser:
 *
 *   1. the key's page, under its Browser pill;
 *   2. the key picker's caution under a picked Browser key, which the Sentry
 *      browser guide shows beside the DSN the key goes into;
 *   3. GET /otlp/v1/validate's answer for a Browser key, in English as the
 *      server's other answers are;
 *   4. the Key Type column's description, which the API reference and the
 *      OpenAPI spec show.
 *
 * The first two are Dashboard sentences, so they are read in every language
 * the Dashboard speaks, with the words each language's docs use for Sentry
 * events.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");
const LOCALES_DIRECTORY: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard/src/Locales",
);

const read: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8");
};

// The source between two markers: the branch a sentence must be said in.
const between: (text: string, start: string, end: string) => string = (
  text: string,
  start: string,
  end: string,
): string => {
  const from: number = text.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);

  const to: number = text.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);

  return text.slice(from, to);
};

const KEY_PAGE: string =
  "Safe to publish in a page. Accepted only from the allowed origins below, and only for traces, logs, metrics, session replays and Sentry events.";

/*
 * #6458 rewrites this caution in plain words. Its new words still name
 * Sentry events, in English and in each language's docs words.
 */
const PICKER_CAUTION: string =
  "Browser key — intended for client distribution. Web origins may send traces, logs, metrics, session replays and Sentry events; app:// identities authorize React Native replay only. Accepted identities: {{identities}}. Native app identities are self-asserted, not platform attestation.";

const TOKEN_CHECK: string =
  "Ingestion token is valid, but it is a BROWSER ingestion key. It is accepted only from a browser, only from one of its allowed origins, and only for OTLP traces, logs and metrics, session replays, and events from a Sentry browser SDK. Use a server ingestion key in a collector, an agent, or any backend service.";

const KEY_TYPE_DESCRIPTION: string =
  "Server keys are for backend services and OpenTelemetry collectors: full ingest, no origin checks. Browser keys are write-only client keys: listed web origins may send traces, logs, metrics, session replays and Sentry events, while listed app:// identities currently authorize React Native session replay only. This cannot be changed after the key is created - create a new key instead.";

type LocaleFile = Record<string, unknown>;

const localeFiles: Map<string, LocaleFile> = new Map<string, LocaleFile>();

const readLocale: (language: string) => LocaleFile = (
  language: string,
): LocaleFile => {
  if (!localeFiles.has(language)) {
    localeFiles.set(
      language,
      JSON.parse(
        fs.readFileSync(
          path.join(LOCALES_DIRECTORY, `${language}.json`),
          "utf8",
        ),
      ) as LocaleFile,
    );
  }

  return localeFiles.get(language) as LocaleFile;
};

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIRECTORY)
  .filter((name: string): boolean => {
    return name.endsWith(".json") && name !== "en.json";
  })
  .map((name: string): string => {
    return name.replace(/\.json$/, "");
  })
  .sort();

/*
 * "Sentry events" as each language's docs say it, on the Sends row of
 * telemetry/ingestion-keys.md (#7828), so the Dashboard and the docs name
 * them alike. The docs have no Arabic pages: Arabic says it the way ar.json
 * says Kubernetes events (أحداث Kubernetes).
 */
const sentryEventsInTheDocs: (language: string) => string = (
  language: string,
): string => {
  if (language === "ar") {
    return "أحداث Sentry";
  }

  const sendsRow: Array<string> = read(
    `packages/App/FeatureSet/Docs/Content/${language}/telemetry/ingestion-keys.md`,
  )
    .split("\n")
    .filter((line: string): boolean => {
      return (
        line.startsWith("| ") &&
        line.includes("Sentry") &&
        line.includes("](/docs/telemetry/compatible-endpoints#")
      );
    });

  expect({ language, rows: sendsRow.length }).toEqual({ language, rows: 1 });

  const link: RegExpMatchArray | null = (sendsRow[0] as string).match(
    /\[([^\]]*Sentry[^\]]*)\]\(\/docs\/telemetry\/compatible-endpoints#/,
  );

  expect(link).not.toBeNull();

  return (link as RegExpMatchArray)[1] as string;
};

/*
 * Where a language's grammar declines the docs' words. Russian's "для"
 * ("for") takes the genitive: the docs' "события Sentry" reads
 * "событий Sentry" after it on the key's page.
 */
const DECLINED: Record<string, Record<string, string>> = {
  ru: { [KEY_PAGE]: "событий Sentry" },
};

const sentryEventsIn: (language: string, english: string) => string = (
  language: string,
  english: string,
): string => {
  return DECLINED[language]?.[english] ?? sentryEventsInTheDocs(language);
};

describe("what a Browser key is accepted for", () => {
  test("is OTLP traces, logs and metrics, session replay and Sentry, and nothing else", () => {
    // Change this list, and the four texts below must say the same.
    expect(Array.from(BROWSER_ALLOWED_INGEST_SURFACES).sort()).toEqual(
      [
        TelemetryIngestSurface.OtelTraces,
        TelemetryIngestSurface.OtelLogs,
        TelemetryIngestSurface.OtelMetrics,
        TelemetryIngestSurface.SessionReplay,
        // A browser app's Sentry DSN, which is public by design (#7742).
        TelemetryIngestSurface.Sentry,
      ].sort(),
    );
  });

  test("the key's page says it under the Browser pill, Sentry events included", () => {
    const browser: string = between(
      read(
        "packages/App/FeatureSet/Dashboard/src/Pages/Settings/TelemetryIngestionKeyView.tsx",
      ),
      '<Pill color={Yellow} text="Browser" />',
      '<Pill color={Blue} text="Server" />',
    );

    expect(browser).toContain(JSON.stringify(KEY_PAGE));
  });

  test("the key picker's caution says it for a picked Browser key, Sentry events included", () => {
    const browser: string = between(
      read(
        "packages/App/FeatureSet/Dashboard/src/Components/Telemetry/IngestionKeySelector.tsx",
      ),
      "if (key.keyType === TelemetryIngestionKeyType.Browser) {",
      "Server key — treat it as a secret.",
    );

    expect(browser).toContain(JSON.stringify(PICKER_CAUTION));
  });

  test("the token check says it to whoever checks a Browser key, Sentry's browser SDKs included", () => {
    const answer: string = between(
      read("packages/App/FeatureSet/Telemetry/API/OTelIngest.ts"),
      "message: isBrowserKey",
      '"Ingestion token is valid."',
    );

    expect(answer).toContain(JSON.stringify(TOKEN_CHECK));
  });

  test("the Key Type column's description, which the API reference and the OpenAPI spec show, says it with Sentry events", () => {
    expect(
      new TelemetryIngestionKey().getTableColumnMetadata("keyType").description,
    ).toBe(KEY_TYPE_DESCRIPTION);
  });
});

describe.each([
  ["the key's page", KEY_PAGE],
  ["the key picker's caution", PICKER_CAUTION],
])("%s, in the Dashboard's languages", (_name: string, english: string) => {
  test("is a key of all 18 locale files", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(readLocale("en")[english]).toBe(english);

    for (const language of LANGUAGES) {
      expect({
        language,
        isKey: typeof readLocale(language)[english] === "string",
      }).toEqual({ language, isKey: true });
    }
  });

  test("reads in each of the 17 languages, naming Sentry events in that language's docs words", () => {
    for (const language of LANGUAGES) {
      const translated: string = readLocale(language)[english] as string;
      const sentryEvents: string = sentryEventsIn(language, english);

      expect(sentryEvents).toContain("Sentry");
      expect({
        language,
        translated: translated !== english,
        namesSentryEvents: translated.includes(sentryEvents),
      }).toEqual({ language, translated: true, namesSentryEvents: true });
    }
  });
});
