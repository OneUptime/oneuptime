import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ExtractedString,
  scanSourceText,
} from "../../../../App/FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * THE PROBES CARD AND THE NETWORK PATH CARD IN EVERY LANGUAGE (#7416, #7420).
 *
 * The monitor overview's Probes card and the Network Path at Time of
 * Failure card under a failed Ping, IP, Port or NTP check had their words
 * in English in up to fourteen of the Dashboard's languages: "No path was
 * recorded.", "Route broke at hop 2.", "Couldn't load probes.", the
 * agreement footnote. Every text the two cards (and the traceroute's hop
 * table) look up is read here from their own source, as the Dashboard's
 * extractor reads it, and each must be worded in every language.
 *
 * A few stay as English writes them, on purpose and only these: RTT and
 * the DNS label are abbreviations every language keeps; "Hop" is the word
 * German, Danish, Dutch and Italian network people use; "Host" is German,
 * Spanish, Italian, Dutch and Portuguese; German says "Up". Any other key
 * a language leaves in English - by the same-as-English list or not -
 * fails here.
 */

const REPOSITORY: string = path.resolve(__dirname, "../../../../..");

const CARD_FILES: ReadonlyArray<string> = [
  "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorProbesCard.tsx",
  "packages/App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/NetworkPathView.tsx",
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/TracerouteHopsTable.tsx",
];

// The Response time card's sentences about the probes' latest results.
const RESPONSE_TIME_SENTENCES: ReadonlyArray<string> = [
  "Latest: {{median}} ms median across {{responded}} of {{total}} probes ({{min}}–{{max}} ms)",
  "Latest: {{median}} ms median across {{count}} probes ({{min}}–{{max}} ms)",
  "Latest: {{median}} ms median across {{count}} probes ({{min}}–{{max}} ms)_one",
  "Response-time history needs permission to read telemetry.",
];

// What each language writes as English does, on purpose.
const KEPT_AS_ENGLISH: Record<string, ReadonlyArray<string>> = {
  RTT: DASHBOARD_LANGUAGES,
  "DNS:": DASHBOARD_LANGUAGES,
  Hop: ["de", "da", "nl", "it"],
  Host: ["de", "es", "it", "nl", "pt"],
  Up: ["de"],
};

// The keys one source file looks up: each text, and a plural's "one" form.
const keysOf: (file: string) => Array<string> = (
  file: string,
): Array<string> => {
  const strings: Array<ExtractedString> = scanSourceText(
    file,
    fs.readFileSync(path.join(REPOSITORY, file), "utf8"),
    { kind: "ui" },
  ).strings;
  const keys: Set<string> = new Set<string>();

  for (const found of strings) {
    keys.add(found.text);

    if (found.pluralOne !== undefined) {
      keys.add(`${found.text}_one`);
    }
  }

  return [...keys];
};

const CARD_KEYS: ReadonlyArray<string> = Array.from(
  new Set<string>([
    ...CARD_FILES.flatMap((file: string): Array<string> => {
      return keysOf(file);
    }),
    ...RESPONSE_TIME_SENTENCES,
  ]),
).sort();

const ENGLISH: Record<string, string> = readDashboardLocale("en");

// "language: key" for each key a language does not word.
const notWorded: (keys: ReadonlyArray<string>) => Array<string> = (
  keys: ReadonlyArray<string>,
): Array<string> => {
  const missing: Array<string> = [];

  for (const language of DASHBOARD_LANGUAGES) {
    for (const key of keys) {
      if (!isWordedInDashboardLocale(key, language)) {
        missing.push(`${language}: ${key}`);
      }
    }
  }

  return missing;
};

// "language: key" for each key a language writes exactly as English does.
const writtenAsEnglish: (keys: ReadonlyArray<string>) => Array<string> = (
  keys: ReadonlyArray<string>,
): Array<string> => {
  const same: Array<string> = [];

  for (const language of DASHBOARD_LANGUAGES) {
    const words: Record<string, string> = readDashboardLocale(language);

    for (const key of keys) {
      if (words[key] === ENGLISH[key]) {
        same.push(`${language}: ${key}`);
      }
    }
  }

  return same;
};

const isKeptOnPurpose: (pair: string) => boolean = (pair: string): boolean => {
  const separator: number = pair.indexOf(": ");
  const language: string = pair.slice(0, separator);
  const key: string = pair.slice(separator + 2);

  return (KEPT_AS_ENGLISH[key] || []).includes(language);
};

describe("the Probes and Network Path cards in every language", () => {
  test("the cards' own source gives the keys, the ones each card is known by among them", () => {
    for (const key of [
      // The Network Path card, its verdicts and its DNS line.
      "Network Path at Time of Failure",
      "Traceroute captured by the probe when this check failed.",
      "No path was recorded.",
      "Route reached the destination.",
      "Route broke at hop {{hop}}.",
      "Route did not reach the destination.",
      "{{host}} resolved to {{addresses}} in {{time}} ms",
      "Lookup for {{host}} failed — {{error}}",
      "DNS:",
      // The hop table's headers.
      "Hop",
      "Host",
      "RTT",
      // The Probes card: each probe's state and the agreement footnote.
      "Where this monitor is checked from.",
      "Turned off for this monitor",
      "Disconnected",
      "Late",
      "No result yet · next {{next}}",
      "Next check {{next}}",
      "A status change needs {{required}} of {{count}} connected probes to agree.",
      "A status change needs both connected probes to agree.",
      "Couldn't load probes. {{error}}",
    ]) {
      expect(CARD_KEYS).toContain(key);
      // Each is a key the Dashboard's English file has.
      expect(ENGLISH[key]).toBe(key);
    }
  });

  test("every key is worded in each of the Dashboard's languages", () => {
    expect(CARD_KEYS.length).toBeGreaterThan(30);
    expect(notWorded(CARD_KEYS)).toEqual([]);
  });

  test("only the abbreviations, Hop, Host and German's Up read as English writes them", () => {
    const unexpected: Array<string> = writtenAsEnglish(CARD_KEYS).filter(
      (pair: string): boolean => {
        return !isKeptOnPurpose(pair);
      },
    );

    expect(unexpected).toEqual([]);
  });

  test("each language words the card's title its own way", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      expect(
        readDashboardLocale(language)["Network Path at Time of Failure"],
      ).not.toBe("Network Path at Time of Failure");
    }
  });
});

describe("negative control: the checks above see an English word", () => {
  // A sentence German still has in English, from a card outside this one.
  const STILL_ENGLISH_IN_GERMAN: string =
    "This probe is disabled for this monitor, so it is not collecting any data. Enable it under Probes.";

  test("a key a language has not worded is reported", () => {
    expect(readDashboardLocale("de")[STILL_ENGLISH_IN_GERMAN]).toBe(
      STILL_ENGLISH_IN_GERMAN,
    );
    expect(notWorded([STILL_ENGLISH_IN_GERMAN])).toContain(
      `de: ${STILL_ENGLISH_IN_GERMAN}`,
    );
  });

  test("a key written as English is reported unless it is kept on purpose", () => {
    const pairs: Array<string> = writtenAsEnglish(["RTT", "Hop"]);

    // RTT in every language, Hop in four: all kept on purpose.
    expect(pairs).toContain("fa: RTT");
    expect(pairs).toContain("de: Hop");
    expect(pairs.filter(isKeptOnPurpose)).toEqual(pairs);
    // Hop in Portuguese is "Salto": written as English, it would be reported.
    expect(isKeptOnPurpose("pt: Hop")).toBe(false);
    expect(isKeptOnPurpose("de: Route broke at hop {{hop}}.")).toBe(false);
  });

  test("the scan reads the keys from source, not from a list", () => {
    const keys: Array<string> = keysOf(CARD_FILES[1]!);

    expect(keys).toContain("Route broke at hop {{hop}}.");
    expect(keys).not.toContain("Couldn't load probes. {{error}}");
  });
});
