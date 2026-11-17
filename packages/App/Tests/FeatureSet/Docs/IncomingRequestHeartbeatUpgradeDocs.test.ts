import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { inlineCode } from "./DocsTranslationChecks";
import { flattened, otherChangesItems } from "./UpgradingDocsNotes";
import { EVERY_THIRTY_SECONDS } from "Common/Utils/CronTime";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The upgrade note that says the background check of Incoming Request
 * monitors reads only the request as it came (#8906) - held to the code
 * that makes it true.
 *
 * The note (installation/upgrading, "Other changes in 16": the release
 * after 16.0.0 brought it, and 16 is upgraded to from 15 only) is in 16's
 * list once, and every translation carries it in the English note's place.
 * What it claims is what the code does:
 *
 *   - the check (IncomingRequestMonitor:CheckHeartbeat) reads one copy of
 *     the latest request, the request as it came, and splits nothing;
 *   - it runs every 30 seconds;
 *   - every server keeps each request both ways: the ingest writes the two
 *     copies in one statement (MonitorResource, LatestIncomingRequest).
 *
 * The release the note names, 14.0.106, is a version, which the
 * translations suite's number checks leave out: each translation names it
 * as often as the English note does.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const NOTE_LEAD: string =
  "**The background check of Incoming Request monitors reads only the request as it came.**";

// The major version whose "Other changes in" list carries the note.
const MAJOR: number = 16;

// The first release that kept each request both ways (#6536).
const SPLIT_RELEASE: string = "14.0.106";

const HEARTBEAT_JOB_FILE: string =
  "App/FeatureSet/Workers/Jobs/IncomingRequestMonitor/CheckHeartbeat.ts";
const INGEST_FILE: string = "Common/Server/Utils/Monitor/MonitorResource.ts";

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

function source(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

// The columns the job's sweep selects: the select it hands runMonitorSweep.
function sweepSelect(): string {
  const job: string = source(HEARTBEAT_JOB_FILE);
  const start: number = job.indexOf("select: {");
  const end: number = job.indexOf("processMonitor:", start);

  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);

  return job.slice(start, end);
}

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en", MAJOR);
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

describe("the English upgrade note on the background check of Incoming Request monitors", () => {
  it("is a note of the 15 → 16 changes, once, and of no earlier version's", () => {
    expect(NOTE_INDEX).toBeGreaterThanOrEqual(0);
    expect(
      ENGLISH_ITEMS.filter((item: string): boolean => {
        return flattened(item).includes(NOTE_LEAD);
      }),
    ).toHaveLength(1);

    for (const major of [14, 15]) {
      expect(
        otherChangesItems("en", major).filter((item: string): boolean => {
          return flattened(item).includes(NOTE_LEAD);
        }),
      ).toEqual([]);
    }
  });

  it("says the check reads the request as it came alone, as the job's sweep selects it", () => {
    const select: string = sweepSelect();
    const job: string = source(HEARTBEAT_JOB_FILE);

    expect(select).toContain("incomingMonitorRequestAsReceived: true,");
    expect(select).not.toMatch(/\bincomingMonitorRequest:/);
    expect(job).toContain(
      "monitor.incomingMonitorRequestAsReceived || undefined;",
    );

    expect(ENGLISH_NOTE).toContain(
      "It now reads the request as it came alone, one copy where it read two, and judges it as before.",
    );
  });

  it("says nothing of a split: the job splits no request any more", () => {
    const job: string = source(HEARTBEAT_JOB_FILE);

    expect(job).not.toContain("rewriteLatestIncomingRequestForReaders");
    expect(job).not.toContain("isReadersCopyAsItCame");
    expect(job).not.toContain("getAsReceived");
  });

  it("says the check runs every 30 seconds, as its schedule does", () => {
    expect(EVERY_THIRTY_SECONDS).toBe("*/30 * * * * *");
    expect(source(HEARTBEAT_JOB_FILE)).toContain(
      "{ schedule: EVERY_THIRTY_SECONDS, runOnStartup: false },",
    );
    expect(ENGLISH_NOTE).toContain(
      "as it came, which the check that runs every 30 seconds judges again",
    );
  });

  it("says each request is kept both ways, as the ingest writes the two copies in one statement", () => {
    const ingest: string = source(INGEST_FILE);
    const write: number = ingest.indexOf(
      "incomingMonitorRequest: latestRequest.incomingMonitorRequest,",
    );

    expect(ingest).toContain("LatestIncomingRequest.toColumns({");
    expect(write).toBeGreaterThan(0);
    // The request as it came, in the same data as the copy people read.
    expect(
      ingest
        .slice(write, write + 200)
        .replace(/\s+/g, " ")
        .includes(
          "incomingMonitorRequestAsReceived: latestRequest.incomingMonitorRequestAsReceived,",
        ),
    ).toBe(true);

    expect(ENGLISH_NOTE).toContain(
      `Upgrading from 15 needs nothing: every release since ${SPLIT_RELEASE} keeps each request both ways.`,
    );
  });

  it("names the release that split the copies where it says when, and which servers wrote one", () => {
    expect(occurrences(ENGLISH_NOTE, SPLIT_RELEASE)).toBe(3);
    expect(ENGLISH_NOTE).toContain(`a server older than ${SPLIT_RELEASE}`);
  });
});

describe.each(TRANSLATIONS)(
  "the %s upgrade note on the background check of Incoming Request monitors",
  (language: string) => {
    const items: Array<string> = otherChangesItems(language, MAJOR);
    const note: string = flattened(items[NOTE_INDEX] || "");

    it("is in the English note's place, under a lead of its own", () => {
      expect(items.length).toBe(ENGLISH_ITEMS.length);
      expect(note.startsWith("- **")).toBe(true);
      expect(note).not.toContain(NOTE_LEAD);
    });

    it("names the release that split the copies as often as the English note", () => {
      expect(occurrences(note, SPLIT_RELEASE)).toBe(
        occurrences(ENGLISH_NOTE, SPLIT_RELEASE),
      );
    });

    it("carries the English note's code: none", () => {
      expect(inlineCode(note)).toEqual(inlineCode(ENGLISH_NOTE));
    });

    it("says every 30 seconds, and upgrading from 15", () => {
      const numbers: Array<string> = note.match(/(?<![\d.])\d+(?![\d])/g) || [];

      expect(numbers).toContain("30");
      expect(numbers).toContain("15");
    });
  },
);
