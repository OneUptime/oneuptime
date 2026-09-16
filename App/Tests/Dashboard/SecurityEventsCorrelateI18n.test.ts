import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The redesigned Security Events -> Correlate page looks every visible
 * string up in the Dashboard locale files (by its English text), so a
 * string the page renders but no locale carries would stay English for
 * everyone. This pins both halves: the components still render exactly
 * these strings, and every locale translates each of them.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const SOURCE_FILES: Array<Array<string>> = [
  ["Components", "SecurityEvents", "CorrelateGraph.tsx"],
  ["Components", "SecurityEvents", "CorrelateInspector.tsx"],
  ["Components", "SecurityEvents", "CorrelateNodeCard.tsx"],
  ["Components", "SecurityEvents", "CorrelateResultSummary.tsx"],
  ["Components", "SecurityEvents", "CorrelateFilterBuilder.tsx"],
  ["Components", "SecurityEvents", "CorrelateFilterChips.tsx"],
  ["Components", "SecurityEvents", "SecurityEventsEmptyState.tsx"],
  // Field and operator labels, shown through the chips and the centre card.
  ["Utils", "SecurityEventCorrelation.ts"],
];

const STRINGS: Array<string> = [
  "Correlate",
  "Start from a host, user, or IP address to see every event class it appears in and the observables seen alongside it.",
  "Search mode",
  "Observable",
  "Search a host, user, or IP address",
  "Combine fields with AND or OR below, then press Correlate.",
  "Last 7 days",
  "Last 30 days",
  "Applied filter",
  "Where",
  "All conditions",
  "Any condition",
  "No conditions yet. Add one to start.",
  "Correlate security events",
  "Search for a host, user, or IP address, or switch to Conditions to combine fields with AND or OR.",
  "Enter an observable, or build conditions across hosts, users, IPs, severity and more.",
  "Read the graph",
  "Event classes surround your filter, marked by their worst severity. Observables seen in the same events sit on the outer ring.",
  "Pivot",
  "Select a class to list its events, or an observable to correlate on it, add it to the filter, or exclude it.",
  "No events found",
  "No security events matched this filter in the selected time range.",
  "Search last 6 hours",
  "Search last 24 hours",
  "Search last 7 days",
  "Search last 30 days",
  "Remove last condition",
  "Edit conditions",
  "This filter can't run",
  "Couldn't load security events",
  "Try again",
  "Correlating events…",
  "matching event",
  "matching events",
  "Searched",
  "Fit to screen",
  "Correlation graph",
  "The same results are listed below the graph.",
  "Each search returns only its 200 most recent events, and at least one reached that limit. Older matches in this time range are missing — treat counts as lower bounds. Narrow the time range or add a condition to see everything.",
  "Search limit reached",
  "In the selected window",
  "Event classes",
  "critical or high",
  "Co-occurring observables",
  "less frequent not shown",
  "All shown",
  "Highest severity",
  "Found in",
  "No severity recorded",
  "Graph key",
  "Your filter",
  "Event class",
  "Co-occurring observable",
  "Worst severity:",
  "No severity",
  "Numbers are event counts; thicker lines mean more shared events. Hold Ctrl and scroll, or pinch, to zoom.",
  "less frequent observables not drawn",
  "less frequent observables not shown",
  "No co-occurring observables in these events.",
  "Select a node or a row to see its details.",
  "Class filters apply only when matching all conditions.",
  "Only the 50 most recent events are listed. Narrow the filter or time range to see the rest.",
  "Filter to this class",
  "Clear selection",
  "Copy value",
  "Correlate on this",
  "Start a new graph centred on this observable.",
  "Add to filter",
  "Keep only events that also mention it.",
  "Also include events that mention it.",
  "Exclude from results",
  "Hide events that mention it.",
  "Seen in",
  "Match all",
  "Match any",
  "conditions",
  "event",
  "events",
  "No security events yet",
  "Send events from any source that can POST JSON — a SIEM, a SOAR webhook, a log forwarder — or connect a security product and OneUptime polls it for you. Every event is normalized to OCSF, whatever dialect it arrives in.",
  "Read the setup guide",
  "Connect a security product",
  "Principal User",
  "Principal Host",
  "Principal IP",
  "Target User",
  "Target Host",
  "Target IP",
  "Event Class",
  "Vendor",
  "is not",
  "Select a value",
  "hostname, user, or IP address",
];

/*
 * Translations that are legitimately the same word as English. Keep this
 * list short and explicit — anything else identical to English is a copy
 * someone forgot to translate.
 */
const IDENTICAL_TO_ENGLISH: Record<string, Array<string>> = {};

/*
 * Persian (like the existing "Last 24 hours" entries) writes numbers with
 * its own digits; compare them as the ASCII digits they stand for.
 */
function toAsciiDigits(text: string): string {
  return text.replace(/[\u06F0-\u06F9\u0660-\u0669]/g, (digit: string) => {
    const code: number = digit.charCodeAt(0);
    const zero: number = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - zero);
  });
}

function readSources(): string {
  return SOURCE_FILES.map((relativePath: Array<string>): string => {
    return fs.readFileSync(path.join(DASHBOARD_SRC, ...relativePath), "utf8");
  }).join("\n");
}

function readLocale(file: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Record<string, unknown>;
}

const localeFiles: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".json");
  })
  .sort();

describe("Security Events Correlate translations", () => {
  test("the list has no duplicates", () => {
    expect(new Set<string>(STRINGS).size).toBe(STRINGS.length);
  });

  test("every string is still rendered by the Correlate components", () => {
    const sources: string = readSources();
    const missing: Array<string> = STRINGS.filter((text: string): boolean => {
      return !sources.includes(`"${text}"`);
    });
    expect(missing).toEqual([]);
  });

  test("all 17 Dashboard locales are covered", () => {
    expect(localeFiles).toHaveLength(17);
    expect(localeFiles).toContain("en.json");
  });

  test("English maps every string to itself", () => {
    const english: Record<string, unknown> = readLocale("en.json");
    for (const text of STRINGS) {
      expect(english[text]).toBe(text);
    }
  });

  test.each(
    localeFiles.filter((file: string): boolean => {
      return file !== "en.json";
    }),
  )("%s translates every string", (file: string) => {
    const locale: Record<string, unknown> = readLocale(file);
    const allowedCopies: Array<string> =
      IDENTICAL_TO_ENGLISH[file.replace(/\.json$/, "")] || [];

    for (const text of STRINGS) {
      const value: unknown = locale[text];
      expect(typeof value).toBe("string");
      expect((value as string).trim().length).toBeGreaterThan(0);
      if (!allowedCopies.includes(text)) {
        expect({ text, value }).not.toEqual({ text, value: text });
      }
    }
  });

  test.each(localeFiles)(
    "%s keeps the numbers the English strings carry",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);
      const numberPattern: RegExp = /\d+/g;
      for (const text of STRINGS) {
        const englishNumbers: Array<string> = text.match(numberPattern) || [];
        const translatedNumbers: Array<string> =
          toAsciiDigits(String(locale[text])).match(numberPattern) || [];
        expect({ text, numbers: translatedNumbers.sort() }).toEqual({
          text,
          numbers: englishNumbers.sort(),
        });
      }
    },
  );
});
