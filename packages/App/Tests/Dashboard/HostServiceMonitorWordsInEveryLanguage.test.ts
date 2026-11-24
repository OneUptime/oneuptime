import {
  ExtractedString,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  LOCALES_DIRECTORY,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A SERVICE'S MONITOR, IN EVERY LANGUAGE (#10296).
 *
 * What Create Monitor on a host's Windows service or systemd unit page puts
 * in front of a person: the Monitors card (its description, its empty line,
 * Create Another Monitor, why the list could not be read), the monitor it
 * opens Monitor Create on (its name and description, its three criteria and
 * the incidents two of them open) and why Monitor Create shows no form for a
 * link it cannot read. Each is read the way the Dashboard's extraction reads
 * it (npm run i18n:extract), and reads in every language's own words, with
 * the English placeholders: a sentence added to these later is worded with
 * them, or fails here.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");

const SOURCES: Array<string> = [
  "packages/App/FeatureSet/Dashboard/src/Utils/HostServiceMonitorPrefill.ts",
  "packages/App/FeatureSet/Dashboard/src/Utils/HostServiceMonitors.ts",
  "packages/App/FeatureSet/Dashboard/src/Components/Host/HostServiceMonitorsCard.tsx",
];

const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;

type Locale = Record<string, unknown>;

function readLocale(language: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Locale;
}

// Every key the sources read, as the extraction reads them.
function getKeys(): Array<string> {
  const keys: Array<string> = [];

  for (const source of SOURCES) {
    const entries: Array<ExtractedString> = scanSourceText(
      source,
      fs.readFileSync(path.join(REPOSITORY_ROOT, source), "utf8"),
      { kind: "ui" },
    ).strings as Array<ExtractedString>;

    for (const entry of entries) {
      if (entry.nestedPath || keys.includes(entry.text)) {
        continue;
      }

      keys.push(entry.text);
    }
  }

  return keys;
}

const KEYS: Array<string> = getKeys();
const ENGLISH: Locale = readLocale("en");

function placeholdersOf(text: string): Array<string> {
  return Array.from(new Set(text.match(PLACEHOLDER) || [])).sort();
}

describe("a service's monitor, in every language", () => {
  test("its words are read, every one of them an English key", () => {
    // The card's, the prefill's and Monitor Create's refusals: 28 new, and a few the Dashboard had.
    expect(KEYS.length).toBeGreaterThanOrEqual(28);

    for (const sentence of [
      "Create Another Monitor",
      "No monitor watches this service yet.",
      "No monitor watches this unit yet.",
      "{{serviceName}} on {{hostName}}",
      "{{serviceName}} is not running on {{hostName}}",
      "{{unitName}} is not active on {{hostName}}",
      "{{serviceName}} stopped reporting on {{hostName}}",
      "This link does not point to a service on a host. Open the service's page again and choose Create Monitor.",
    ]) {
      expect(KEYS).toContain(sentence);
    }

    expect(
      KEYS.filter((key: string): boolean => {
        return ENGLISH[key] !== key;
      }),
    ).toEqual([]);
  });

  test.each([...TRANSLATED_LOCALES])(
    "%s words every sentence its own way",
    (language: string) => {
      const locale: Locale = readLocale(language);

      const inEnglish: Array<string> = KEYS.filter((key: string): boolean => {
        const value: unknown = locale[key];

        return (
          typeof value !== "string" || value.trim() === "" || value === key
        );
      });

      expect({ language, inEnglish }).toEqual({ language, inEnglish: [] });
    },
  );

  test.each([...TRANSLATED_LOCALES])(
    "%s keeps every placeholder of every sentence",
    (language: string) => {
      const locale: Locale = readLocale(language);

      const lost: Array<string> = KEYS.filter((key: string): boolean => {
        const value: unknown = locale[key];

        return (
          typeof value === "string" &&
          placeholdersOf(value).join(",") !== placeholdersOf(key).join(",")
        );
      });

      expect({ language, lost }).toEqual({ language, lost: [] });
    },
  );

  test.each([...TRANSLATED_LOCALES])(
    "%s keeps the commands an incident's description gives as written",
    (language: string) => {
      const locale: Locale = readLocale(language);
      const commands: Record<string, Array<string>> = {
        "This Windows service has not been running for the whole time range. Check it with Get-Service or in the Services console, read the System event log for why it stopped, and start it again. The incident resolves on its own once it runs.":
          ["Get-Service"],
        "This systemd unit has not been active for the whole time range. On the host, systemctl status and journalctl -u with its name say why; start it again with systemctl start. The incident resolves on its own once it is active.":
          ["systemctl status", "journalctl -u", "systemctl start"],
      };

      for (const [key, written] of Object.entries(commands)) {
        for (const command of written) {
          expect({ language, command, kept: String(locale[key]) }).toEqual({
            language,
            command,
            kept: expect.stringContaining(command),
          });
        }
      }
    },
  );
});
