import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A status page shows nothing of an archived monitor: not on its overview,
 * not on its badge, not among the resources a subscriber can pick (see
 * FrozenMonitorResources). The public API reads a page's resources in
 * several places, and each one filters them with
 * FrozenMonitorResources.withoutArchivedMonitors.
 *
 * That filter can only see what was read: a resource read without
 * `monitor.isArchived` looks live, so a read that forgets to select the flag
 * silently puts archived monitors back on the page. This guard reads the
 * public API source and checks that every read of a page's resources selects
 * the flag, and is filtered.
 *
 * A monitor whose monitoring is off stays on the page, drawn as Not
 * monitored, and decides no status (issue #6478). The same blind spot holds:
 * a read without `monitor.disableActiveMonitoring` shows a frozen status as
 * live. So every read that takes a monitor's current status also reads
 * whether anything checks it (MONITORING_OFF_SELECT).
 */

const STATUS_PAGE_API: string = path.resolve(
  __dirname,
  "../../../Server/API/StatusPageAPI.ts",
);

const RESOURCE_READ: RegExp = /StatusPageResourceService\.findBy\(/g;

const SELECTS_ARCHIVE_FLAG: RegExp = /isArchived:\s*true/;

const FILTERED_READ: RegExp =
  /FrozenMonitorResources\.withoutArchivedMonitors\(/g;

const SELECTS_CURRENT_STATUS: RegExp = /currentMonitorStatusId:\s*true/;

const SELECTS_MONITORING_OFF: RegExp = /\.\.\.MONITORING_OFF_SELECT\b/;

// The full argument list of the call that opens at `start` (its "(").
function callArguments(source: string, start: number): string {
  let depth: number = 0;

  for (let index: number = start; index < source.length; index++) {
    const char: string = source[index]!;

    if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;

      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error("Unbalanced call - the guard could not read it.");
}

// The `monitor: { ... }` block of a select, or "" when there is none.
function monitorSelect(args: string): string {
  const start: number = args.search(/\bmonitor:\s*\{/);

  if (start === -1) {
    return "";
  }

  const open: number = args.indexOf("{", start);
  let depth: number = 0;

  for (let index: number = open; index < args.length; index++) {
    if (args[index] === "{") {
      depth++;
    } else if (args[index] === "}") {
      depth--;

      if (depth === 0) {
        return args.slice(open, index + 1);
      }
    }
  }

  return "";
}

describe("the status page public API leaves archived monitors out", () => {
  const source: string = fs.readFileSync(STATUS_PAGE_API, "utf8");

  const reads: Array<{ line: number; args: string }> = Array.from(
    source.matchAll(RESOURCE_READ),
  ).map((match: RegExpMatchArray) => {
    return {
      line: source.slice(0, match.index).split("\n").length,
      args: callArguments(source, match.index! + match[0].length - 1),
    };
  });

  test("the guard finds the public reads of a page's resources", () => {
    /*
     * The badge, the subscriber's resource picker, the overview and the
     * resources-and-timelines read behind the history pages.
     */
    expect(reads.length).toBeGreaterThanOrEqual(4);
  });

  test("every read selects whether each resource's monitor is archived", () => {
    const missing: Array<number> = reads
      .filter((read: { args: string }): boolean => {
        return !SELECTS_ARCHIVE_FLAG.test(monitorSelect(read.args));
      })
      .map((read: { line: number }): number => {
        return read.line;
      });

    expect(missing).toEqual([]);
  });

  test("every read is filtered through FrozenMonitorResources", () => {
    const filters: number = (source.match(FILTERED_READ) || []).length;

    expect(filters).toBeGreaterThanOrEqual(reads.length);
  });

  test("every read that takes a monitor's current status reads whether the monitor is checked", () => {
    const statusReads: Array<{ line: number; args: string }> = reads.filter(
      (read: { args: string }): boolean => {
        return SELECTS_CURRENT_STATUS.test(monitorSelect(read.args));
      },
    );

    // The badge, the announcements and the resources-and-timelines read.
    expect(statusReads.length).toBeGreaterThanOrEqual(3);

    const missing: Array<number> = statusReads
      .filter((read: { args: string }): boolean => {
        return !SELECTS_MONITORING_OFF.test(monitorSelect(read.args));
      })
      .map((read: { line: number }): number => {
        return read.line;
      });

    expect(missing).toEqual([]);
  });

  test("the reads that decide a status work out which resources are not monitored", () => {
    // The badge, and the read behind the overview and the uptime endpoint.
    expect(
      (
        source.match(/FrozenMonitorResources\.getNotMonitoredResourceIds\(/g) ||
        []
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(source).toContain(
      "notMonitoredResourceIds: notMonitoredResourceIds,",
    );
  });

  test("a resource whose monitoring is off is never filtered out of a public read", () => {
    expect(source).not.toMatch(
      /FrozenMonitorResources\.withoutFrozenMonitors\(/,
    );
  });

  test("the subscriber's resource picker does not send the monitor it read only to filter", () => {
    const pickerRead: number = source.indexOf(
      "const subscribableResources: Array<StatusPageResource> =",
    );

    expect(pickerRead).toBeGreaterThan(-1);
    expect(source.slice(pickerRead, pickerRead + 400)).toContain(
      "delete resource.monitor;",
    );
  });
});
