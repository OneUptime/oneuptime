import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * GUARD: a monitor type's summary lays its facts out by its own width.
 *
 * The summary views (Website, API, Ping, Port, SSL, DNS, DNSSEC, Domain,
 * NTP, SQL, Database, Server, SNMP, Synthetic, Custom Code, Incoming
 * Request and Email, telemetry, External Status Page) each drew their
 * facts as a flex row of quarter- or fifth-width InfoCards. In the
 * overview's Monitor Summary card - two thirds of the page - that squeezed
 * every value into a column a word or two wide at 1280, and at 390 the row
 * was wider than the phone, so the card scrolled sideways. Their tables sat
 * in frames that hid what did not fit. They share SummaryFacts now: rows
 * that follow the summary's own width (a container query) - one fact a row
 * on a phone, two from 22rem, four from 64rem, a short last row shared by
 * the facts on it - and table frames that scroll rather than clip.
 *
 * This reads every view's source and keeps it so: a new view, or a new
 * row in an old one, uses SummaryFacts and SummaryFact.
 */

const SUMMARY_VIEW_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Monitor",
  "SummaryView",
);

const SHARED_MODULE: string = "SummaryFacts.tsx";

const TSX_FILE: RegExp = /\.tsx$/;
const INFO_CARD_IMPORT: RegExp =
  /import\s+InfoCard\s+from\s+"Common\/UI\/Components\/InfoCard\/InfoCard"/;
// "w-1/4", "w-1/5", "sm:w-1/2" - a fraction of a row.
const FRACTION_WIDTH: RegExp = /(?:^|[\s"'`:])w-\d\/\d(?=[\s"'`]|$)/m;
/*
 * Columns or shares of a row counted by the screen ("lg:grid-cols-4",
 * "md:basis-1/2").
 */
const VIEWPORT_GRID: RegExp = /(?:sm|md|lg|xl|2xl):(?:grid-cols-\d|basis-)/;
// A frame that hides what does not fit.
const CLIPPING_FRAME: RegExp = /overflow-hidden/;
// A row of cards spaced with space-x.
const SPACED_ROW: RegExp = /"flex space-x-3/;

function views(): Array<string> {
  return fs
    .readdirSync(SUMMARY_VIEW_DIR)
    .filter((file: string): boolean => {
      return TSX_FILE.test(file);
    })
    .sort();
}

function read(file: string): string {
  return fs.readFileSync(path.join(SUMMARY_VIEW_DIR, file), "utf8");
}

describe("the monitor summary views lay their facts out by their own width", () => {
  test("the scan reads the views", () => {
    const files: Array<string> = views();

    for (const view of [
      "WebsiteMonitorView.tsx",
      "PingMonitorView.tsx",
      "SSLCertificateMonitorView.tsx",
      "IncomingRequestMonitorSummaryView.tsx",
      "ExternalStatusPageMonitorView.tsx",
      SHARED_MODULE,
    ]) {
      expect(files).toContain(view);
    }
  });

  test("only SummaryFacts draws an InfoCard: every view draws its facts with SummaryFact", () => {
    expect(
      views().filter((file: string): boolean => {
        return file !== SHARED_MODULE && INFO_CARD_IMPORT.test(read(file));
      }),
    ).toEqual([]);
    expect(INFO_CARD_IMPORT.test(read(SHARED_MODULE))).toBe(true);
  });

  test.each([
    ["a card a fraction of a row wide", FRACTION_WIDTH],
    ["a grid that counts its columns by the screen", VIEWPORT_GRID],
    ["a frame that hides what does not fit", CLIPPING_FRAME],
    ["a row of cards spaced with space-x", SPACED_ROW],
  ])("no view lays out %s", (_label: string, pattern: RegExp) => {
    expect(
      views().filter((file: string): boolean => {
        return pattern.test(read(file));
      }),
    ).toEqual([]);
  });

  test("the detectors find what they look for", () => {
    expect(FRACTION_WIDTH.test('className="w-1/4 shadow-none"')).toBe(true);
    expect(FRACTION_WIDTH.test('className="w-full shadow-none"')).toBe(false);
    expect(VIEWPORT_GRID.test("grid grid-cols-2 lg:grid-cols-4")).toBe(true);
    expect(VIEWPORT_GRID.test("basis-full md:basis-1/2")).toBe(true);
    expect(
      VIEWPORT_GRID.test(
        "basis-full [@container(min-width:22rem)]:basis-[calc(50%-0.75rem)]",
      ),
    ).toBe(false);
    expect(
      VIEWPORT_GRID.test(
        "grid grid-cols-2 [@container(min-width:64rem)]:grid-cols-4",
      ),
    ).toBe(false);
    expect(CLIPPING_FRAME.test('"border rounded-md overflow-hidden"')).toBe(
      true,
    );
    expect(SPACED_ROW.test('<div className="flex space-x-3">')).toBe(true);
  });

  test("the shared rows follow the summary's width, not the screen's", () => {
    const shared: string = read(SHARED_MODULE);

    expect(shared).toContain('"space-y-5 [container-type:inline-size]"');
    expect(shared).toContain('"flex flex-wrap gap-3"');
    expect(shared).toContain(
      '"basis-full [@container(min-width:22rem)]:basis-[calc(50%-0.75rem)] [@container(min-width:64rem)]:basis-[calc(25%-0.75rem)]"',
    );
    expect(shared).toContain('"overflow-x-auto rounded-md border"');
  });

  /*
   * A table cell that may break anywhere ([overflow-wrap:anywhere]) can be
   * squeezed to one letter a line once its table runs out of room. Each
   * table keeps that to its one column of long values.
   */
  test("a table breaks anywhere in one column at most", () => {
    for (const file of views()) {
      for (const table of read(file).split("<table").slice(1)) {
        const body: string = table.split("</table>")[0] || "";

        const columnsBreakingAnywhere: number =
          body.split("SUMMARY_TABLE_VALUE_CLASS_NAME").length - 1;

        expect({ file, atMostOne: columnsBreakingAnywhere <= 1 }).toEqual({
          file,
          atMostOne: true,
        });
      }
    }
  });
});
