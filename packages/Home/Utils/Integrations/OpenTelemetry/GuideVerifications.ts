import crypto from "crypto";
import fs from "fs";
import path from "path";
import { GuideSnippet, OpenTelemetryGuide } from "./GuideTypes";
import { guideSnippets } from "./GuideSnippets";

/*
 * What the end-to-end check saw, guide by guide.
 *
 * Scripts/VerifyOpenTelemetryGuides.ts runs each guide's app with the real
 * OpenTelemetry SDK against a local receiver and writes what arrived to
 * Verifications.json beside this file: when, on which runtime, the packages
 * it installed, and the spans, metrics and logs it received. It records a
 * digest of the snippets it ran, so a snippet changed after the check no
 * longer matches its record, and Tests/OpenTelemetryGuides fails until the
 * check is run again. The page shows the record as "Checked on ...".
 */

// What one of a guide's variant runs saw: uWSGI beside gunicorn.
export interface GuideVariantRecord {
  observed: GuideVerificationRecord["observed"];
  packages: Record<string, string>;
}

export interface GuideVerificationRecord {
  // The day the check ran: "2026-10-27".
  checkedOn: string;
  // The runtime it ran on: "Node.js 24.22.1".
  runtime: string;
  // Every package the page names, at the version installed: { "express": "5.3.0" }.
  packages: Record<string, string>;
  // The framework itself, as the page names it: "Express 5.3.0".
  framework: string;
  receiver: string;
  snippetDigest: string;
  observed: {
    spans: Array<string>;
    metrics: Array<string>;
    logs: Array<string>;
  };
  // The names each package exports, as installed, for the import checks.
  packageExports: Record<string, Array<string>>;
  // Each variant run's own record, by the variant's name.
  variants?: Record<string, GuideVariantRecord> | undefined;
}

export const VERIFICATIONS_FILE: string = path.join(
  __dirname,
  "Verifications.json",
);

let records: Record<string, GuideVerificationRecord> | null = null;

export function getVerificationRecords(): Record<
  string,
  GuideVerificationRecord
> {
  if (!records) {
    records = fs.existsSync(VERIFICATIONS_FILE)
      ? (JSON.parse(fs.readFileSync(VERIFICATIONS_FILE, "utf8")) as Record<
          string,
          GuideVerificationRecord
        >)
      : {};
  }

  return records;
}

export function getVerificationRecord(
  slug: string,
): GuideVerificationRecord | undefined {
  return getVerificationRecords()[slug];
}

/*
 * The digest of what the end-to-end check runs for a guide: every snippet it
 * runs or that a file it runs contains, and the files, commands and requests
 * of its app. Anything else on the page can change without a new check.
 */
export function guideSnippetDigest(guide: OpenTelemetryGuide): string {
  const checked: Array<[string, string]> = guideSnippets(guide)
    .filter((snippet: GuideSnippet): boolean => {
      return snippet.check === "run" || snippet.check === "contained";
    })
    .map((snippet: GuideSnippet): [string, string] => {
      return [snippet.id, snippet.code];
    })
    .sort((a: [string, string], b: [string, string]): number => {
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });

  const hash: crypto.Hash = crypto.createHash("sha256");
  hash.update(
    JSON.stringify({
      snippets: checked,
      verification: guide.verification,
    }),
  );

  return `sha256:${hash.digest("hex")}`;
}

// A digit: a name with one carries its version ("Express 5.3.0").
const DIGIT: RegExp = /[0-9]/;

/*
 * What a check ran on, as the page and its Markdown copy name it: the
 * framework at its version, then the runtime - ["Express 5.3.0",
 * "Node.js 24.22.1"]. A guide whose framework is the runtime itself names
 * the runtime once: the Node.js, Bun and Deno guides ("Bun 1.4.4", not "Bun
 * · Bun 1.4.4"), and the browser's, whose framework is the browser
 * ("Chrome 153.0.8010.12", not "Chromium · Chrome 153.0.8010.12"). A
 * framework named without a version is such a runtime.
 */
export function checkedWith(
  record: Pick<GuideVerificationRecord, "framework" | "runtime">,
): Array<string> {
  const isRuntimeItself: boolean =
    !DIGIT.test(record.framework) ||
    record.runtime.startsWith(record.framework);

  return (
    isRuntimeItself ? [record.runtime] : [record.framework, record.runtime]
  ).filter((part: string): boolean => {
    return Boolean(part);
  });
}

// "27 October 2026", for the page.
export function formatCheckedOn(checkedOn: string): string {
  const date: Date = new Date(`${checkedOn}T00:00:00Z`);

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
