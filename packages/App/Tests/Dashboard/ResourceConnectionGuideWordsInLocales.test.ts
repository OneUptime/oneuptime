import {
  ExtractedString,
  SourceScanResult,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  readGlobalSameAsEnglish,
  readLocaleProgress,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";
import {
  RESOURCE_CONNECTED_LABEL,
  RESOURCE_DISCONNECTED_LABEL,
} from "../../FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceHeroStatus";
import { SERVERLESS_FUNCTION_RECEIVING_DATA_LABEL } from "Common/Types/Serverless/ServerlessFunctionStatus";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";
import { wordAsWrittenIn } from "Common/Tests/Helpers/ArabicWords";

/*
 * THE "HOW DO I CONNECT THIS?" CARD READS IN THE READER'S LANGUAGE (issue
 * #6308).
 *
 * Every resource Overview - a Kubernetes cluster, a Docker or Podman host,
 * a Swarm, Proxmox or Ceph cluster, a vCenter, an OpenStack cloud, a
 * storage array, a host, an IoT fleet, a cloud environment, a RUM
 * application, a serverless function - shows ResourceConnectionGuideCard
 * until its data arrives. Most of it read English in thirteen of the
 * sixteen languages, the card's own sentences in German, French and
 * Spanish too, so a reader met a translated pill above English steps.
 *
 * Everything the card draws is a string of the two files below, as the
 * extractor reads them: the card's own words, each kind of resource's
 * sentences, every guide's steps. Each is a key of the English locale and
 * worded in all sixteen languages, or the same as English on purpose (the
 * global or the language's own same-as-English list). And each keeps what
 * a reader types or reads as written - its placeholders, the settings,
 * attributes, commands, codes and product names it names, the states
 * kubectl and docker print - and names a status as that language's pill
 * says it. A string added to either file without its translations fails
 * here.
 */

const DASHBOARD: string = path.resolve(__dirname, "../../FeatureSet/Dashboard");
const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");

const CARD_FILES: ReadonlyArray<string> = [
  "packages/App/FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionGuideCard.tsx",
  "packages/App/FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionGuides.ts",
];

const LANGUAGES: ReadonlyArray<string> = [...DASHBOARD_LANGUAGES];

type Locale = Record<string, unknown>;

function localeOf(language: string): Locale {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD, `src/Locales/${language}.json`),
      "utf8",
    ),
  ) as Locale;
}

const ENGLISH: Locale = localeOf("en");

function scanOf(file: string): SourceScanResult {
  return scanSourceText(
    file,
    fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
    { kind: "ui" },
  );
}

const SCANS: Array<SourceScanResult> = CARD_FILES.map(scanOf);

// Every string the card and its guides draw, each once.
const CARD_WORDS: Array<string> = Array.from(
  new Set(
    SCANS.flatMap((scan: SourceScanResult): Array<string> => {
      return scan.strings.map((entry: ExtractedString): string => {
        return entry.text;
      });
    }),
  ),
);

const PLACEHOLDER: RegExp = /\{\{\s*\w+\s*\}\}/g;

function placeholdersOf(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

const LETTER: RegExp = /\p{L}/u;

// What a reading in English excuses as the same as English (LocaleStatus).
function hasNoLetters(text: string): boolean {
  return !LETTER.test(text.replace(PLACEHOLDER, ""));
}

const GLOBAL_SAME_AS_ENGLISH: Set<string> = new Set<string>(
  readGlobalSameAsEnglish(),
);

function sameAsEnglishOf(language: string): Set<string> {
  return new Set<string>([
    ...GLOBAL_SAME_AS_ENGLISH,
    ...(readLocaleProgress(language)?.sameAsEnglish || []),
  ]);
}

/*
 * What a sentence names that a reader types, pastes or reads as written,
 * in every language: an attribute or setting (service.name, iot.fleet.name,
 * browser.*, clusterName), a file (.env), an endpoint (/otlp), a header, a
 * service, a container, a command, an HTTP status, a protocol and the
 * products the agents are named after.
 */
const AS_WRITTEN: RegExp =
  /\b[a-z][a-z0-9]*(?:\.(?:[a-z0-9]+|\*))+|\b[a-z]+[A-Z]\w*|(?<![\w.])\.env\b|\/otlp\b|\b(?:x-oneuptime-token|otelcol-contrib|otel-collector|oneuptime-collector|docker compose up -d|helm install)\b|\b4\d\d\b|\b(?:OTLP|MQTT|HTTP|SDK|OneUptime|OpenTelemetry|Helm|Docker Compose|Docker|Podman|Proxmox|Ceph|OpenStack|vCenter|Kubernetes|Linux|macOS|Windows)\b/g;

function asWrittenIn(text: string): Array<string> {
  return Array.from(
    new Set(text.replace(PLACEHOLDER, " ").match(AS_WRITTEN) || []),
  );
}

// The states kubectl and docker print, which a step quotes as they print them.
const PRINTED_STATE: RegExp = /\b(?:be|are|is|and) (Running|Pending|Up)\b/g;

function printedStatesIn(text: string): Array<string> {
  return Array.from(text.matchAll(PRINTED_STATE)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// A resource's noun put into a sentence.
const NOUN_PUT_IN: RegExp = /\{\{\s*resourceNoun\s*\}\}/;

// The statuses a step or the card names, by the pill that shows them.
const STATUS_WORDS: ReadonlyArray<{ english: RegExp; key: string }> = [
  { english: /\bConnected\b/, key: RESOURCE_CONNECTED_LABEL },
  { english: /\bDisconnected\b/, key: RESOURCE_DISCONNECTED_LABEL },
  {
    english: /\bReceiving data\b/,
    key: SERVERLESS_FUNCTION_RECEIVING_DATA_LABEL,
  },
];

describe("the connection card's and its guides' words", () => {
  test("the extractor reads every string the card and its guides draw, and none is drawn as written", () => {
    expect(CARD_WORDS.length).toBeGreaterThan(150);
    for (const word of [
      "Connect this cluster",
      "This Docker host stopped sending data",
      "OneUptime last heard from this storage array {{lastHeard}}. The {{agentName}} is no longer reporting — check on it with the steps below.",
      "Refresh this page after a few minutes — the fleet switches to Connected once its first data arrives.",
      "Pick an ingestion key",
      "Check {{attribute}}",
      "Open the setup guide",
      "a while ago",
    ]) {
      expect(CARD_WORDS).toContain(word);
    }

    // Nothing glued from pieces or written into the markup unlooked-up.
    for (const scan of SCANS) {
      expect(scan.hardcoded).toEqual([]);
    }
  });

  test("are every one a key of the English locale", () => {
    for (const text of CARD_WORDS) {
      expect({ text, key: ENGLISH[text] }).toEqual({ text, key: text });
    }
  });

  /*
   * "this", "a different" and the noun after them take the noun's gender,
   * case and definite form in most of the languages, so a sentence with a
   * resource's noun put in cannot be worded for every noun: each kind of
   * resource says its own sentences.
   */
  test("put no resource's noun into a sentence", () => {
    expect(
      CARD_WORDS.filter((text: string): boolean => {
        return NOUN_PUT_IN.test(text);
      }),
    ).toEqual([]);
  });

  test.each(LANGUAGES)(
    "%s words every one of them, or keeps it as English on purpose",
    (language: string) => {
      const words: Locale = localeOf(language);
      const sameAsEnglish: Set<string> = sameAsEnglishOf(language);
      const english: Array<string> = CARD_WORDS.filter(
        (text: string): boolean => {
          const worded: unknown = words[text];

          if (typeof worded !== "string") {
            return true;
          }

          return (
            worded === text && !hasNoLetters(text) && !sameAsEnglish.has(text)
          );
        },
      );

      expect({ language, english }).toEqual({ language, english: [] });
    },
  );

  test.each(LANGUAGES)("%s keeps every placeholder", (language: string) => {
    const words: Locale = localeOf(language);

    for (const text of CARD_WORDS) {
      expect({
        language,
        text,
        placeholders: placeholdersOf(String(words[text])),
      }).toEqual({ language, text, placeholders: placeholdersOf(text) });
    }
  });

  test.each(LANGUAGES)(
    "%s keeps the settings, attributes, commands, codes and names a sentence names as written",
    (language: string) => {
      const words: Locale = localeOf(language);

      for (const text of CARD_WORDS) {
        const worded: string = String(words[text]);
        const missing: Array<string> = asWrittenIn(text).filter(
          (token: string): boolean => {
            // Arabic writes "browser.*" as the name it starts with.
            return !worded.includes(wordAsWrittenIn(language, token));
          },
        );

        expect({ language, text, missing }).toEqual({
          language,
          text,
          missing: [],
        });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s quotes the states kubectl and docker print as they print them",
    (language: string) => {
      const words: Locale = localeOf(language);
      const quoting: Array<string> = CARD_WORDS.filter((text: string) => {
        return printedStatesIn(text).length > 0;
      });

      // The pod check, the wait step and both container checks.
      expect(quoting.length).toBeGreaterThanOrEqual(4);

      for (const text of quoting) {
        const worded: string = String(words[text]);

        for (const state of printedStatesIn(text)) {
          expect({
            language,
            text,
            state,
            kept: worded.includes(state),
          }).toEqual({ language, text, state, kept: true });
        }
      }
    },
  );

  test.each(LANGUAGES)(
    "%s names a status in a sentence as its own pill says it, never in English",
    (language: string) => {
      const words: Locale = localeOf(language);
      let named: number = 0;

      for (const status of STATUS_WORDS) {
        const pill: string = String(words[status.key]);

        // The pill itself is worded.
        expect({ language, key: status.key, pill }).not.toEqual({
          language,
          key: status.key,
          pill: status.key,
        });

        for (const text of CARD_WORDS) {
          if (!status.english.test(text)) {
            continue;
          }

          const worded: string = String(words[text]);
          named++;

          expect({ language, text, names: worded.includes(pill) }).toEqual({
            language,
            text,
            names: true,
          });
          expect({
            language,
            text,
            english: status.english.test(worded),
          }).toEqual({ language, text, english: false });
        }
      }

      // Every wait step, every "why it reads Disconnected", the host's match.
      expect(named).toBeGreaterThanOrEqual(20);
    },
  );
});
