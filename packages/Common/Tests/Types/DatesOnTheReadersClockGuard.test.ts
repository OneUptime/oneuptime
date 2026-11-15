// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { describe, expect, test } from "@jest/globals";
import {
  BROWSER_DATE_WRITES_ALLOWED,
  findDatesWrittenOffTheReadersClock,
  readScannedSources,
  ScannedSource,
} from "../Helpers/IntlHourScan";

/*
 * A DATE IS WRITTEN ON THE READER'S CLOCK AND IN THEIR ZONE (issue #8231).
 *
 * Every date and time on the Dashboard follows the reader: the zone they
 * picked in User Settings (else the browser's), their 12- or 24-hour clock
 * and their language (OneUptimeDate). Eight places wrote theirs with
 * Date.prototype.toLocaleString or toLocaleTimeString and only a locale -
 * the license's expiry, the last update check and the last usage report in
 * the edition dialog, a chart point in an AI chat's Markdown export,
 * Topology's and Network Discovery's "Last refreshed", and the Admin
 * Dashboard's migration and health log times - and the browser wrote them
 * in its own zone, on the language's own clock, with seconds: "05:14:00"
 * in a US browser on a German page whose reader keeps a 12-hour clock,
 * beside every table's "5:14 AM" in the zone they picked. Five more did
 * the same and are fixed with them: Network Discovery's scan start, a BI
 * dashboard's last sync, OpenStack spend's CloudKitty read and its
 * partial month, OpenStack's idle-since dates, and the edition dialog's
 * grace period and release dates.
 *
 * The clock guards (TwelveHourClockLeadingZeroGuard,
 * TwentyFourHourClockLeadingZeroGuard) read Intl options objects, and
 * these pass none. So this one refuses a date written by the browser with
 * no options at all, in every front end Helpers/IntlHourScan reads; a
 * number's toLocaleString ("1,234") is left alone.
 */

describe("a date is written on the reader's clock and in their zone", () => {
  test("no product code has the browser write a date with no options", () => {
    const sources: Array<ScannedSource> = readScannedSources();
    const found: Array<string> = [];

    for (const source of sources) {
      found.push(
        ...findDatesWrittenOffTheReadersClock(source.file, source.text),
      );
    }

    // The sweep reads the front ends: thousands of files.
    expect(sources.length).toBeGreaterThan(1000);
    expect(found).toEqual([]);
  });

  test("the one write left to the browser is still there, and still writes nothing a person reads", () => {
    const sources: Array<ScannedSource> = readScannedSources();

    for (const allowed of BROWSER_DATE_WRITES_ALLOWED) {
      const source: ScannedSource | undefined = sources.find(
        (item: ScannedSource): boolean => {
          return item.file === allowed.file;
        },
      );

      expect(source).toBeDefined();
      expect(source!.text).toContain(
        `${allowed.receiver}.toLocaleTimeString()`,
      );
      expect(allowed.reason.length).toBeGreaterThan(20);
    }

    // Only the probe: anywhere else, the same write is refused.
    expect(
      findDatesWrittenOffTheReadersClock(
        "packages/Common/UI/Components/Example.tsx",
        "const timeString: string = new Date().toLocaleTimeString();",
      ),
    ).toHaveLength(1);
  });

  test.each<[string, number]>([
    // The forms #8231 found, as they were.
    ["return expiresAt.toLocaleString(getReaderDateLocale());", 1],
    ["return checkedAt.toLocaleString(getReaderDateLocale());", 1],
    ["date: date.toLocaleString(getReaderDateLocale()),", 1],
    [
      "point.date\n  ? point.date.toLocaleString(getReaderDateLocale())\n  : point.x",
      1,
    ],
    [
      "time: activeTab.loadedAt.toLocaleTimeString(\n  getReaderDateLocale(),\n),",
      1,
    ],
    [
      "time: liveUpdates.lastRefreshedAt.toLocaleTimeString(\n  getReaderDateLocale(),\n),",
      1,
    ],
    ["return date.toLocaleString(getReaderDateLocale());", 1],
    [": date.toLocaleString(getReaderDateLocale());", 1],
    // The ones found beside them.
    [
      "date: new Date(item.since).toLocaleDateString(\n  getReaderDateLocale(),\n),",
      1,
    ],
    [
      'time: new Date(snapshot.cloudKittyReadAt).toLocaleString(\n  getNumberLocale(translator.language || "en"),\n),',
      1,
    ],
    ["return endsAt.toLocaleDateString(getReaderDateLocale());", 1],
    // The issue's negative control, and every other no-option form.
    ["date.toLocaleTimeString(getReaderDateLocale())", 1],
    ["date.toLocaleTimeString()", 1],
    ["someValue.toLocaleTimeString()", 1],
    ["date.toLocaleDateString()", 1],
    ["new Date(value).toLocaleString()", 1],
    ['new Date(value).toLocaleString("en-US")', 1],
    ["startDate.toLocaleString(locale)", 1],
    ["row.createdAt!.toLocaleString()", 1],
    ["value.toLocaleString(getDateLocale(language))", 1],
    // A number's toLocaleString is a number's: "1,234".
    ["count.toLocaleString(getReaderNumberLocale())", 0],
    ['count.toLocaleString("en-US")', 0],
    ["parsed.toLocaleString()", 0],
    ["(usdCents / 100).toLocaleString(getReaderNumberLocale())", 0],
    ["Math.round(value).toLocaleString()", 0],
    ["data.seatsInUse.toLocaleString()", 0],
    // With options, it is the options' to say (the clock guards, #7651).
    [
      'date.toLocaleTimeString(getReaderDateLocale(), { hour, minute: "2-digit", timeZone })',
      0,
    ],
    [
      'date.toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" })',
      0,
    ],
    // A date written by OneUptimeDate.
    [
      "OneUptimeDate.getDateAsLocalShortDateTimeString(date, { showYear: true })",
      0,
    ],
    ["writeReaderTimeOfDay(activeTab.loadedAt)", 0],
  ])("finds %p %p time(s)", (source: string, count: number) => {
    expect(
      findDatesWrittenOffTheReadersClock("Example.tsx", source),
    ).toHaveLength(count);
  });

  test("names the file, the line and the write it finds", () => {
    expect(
      findDatesWrittenOffTheReadersClock(
        "TopologyPage.tsx",
        [
          "const a = 1;",
          "const title = activeTab.loadedAt.toLocaleTimeString(",
          "  getReaderDateLocale(),",
          ");",
        ].join("\n"),
      ),
    ).toEqual([
      "TopologyPage.tsx:2 activeTab.loadedAt.toLocaleTimeString(getReaderDateLocale(),)",
    ]);
  });
});
