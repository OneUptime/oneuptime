import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A status page shows nothing of an archived monitor: not on its overview,
 * not on its badge, not among the resources a subscriber can pick (see
 * ArchivedMonitorResources). The public API reads a page's resources in
 * several places, and each one filters them with
 * ArchivedMonitorResources.withoutArchivedMonitors.
 *
 * That filter can only see what was read: a resource read without
 * `monitor.isArchived` looks live, so a read that forgets to select the flag
 * silently puts archived monitors back on the page. This guard reads the
 * public API source and checks that every read of a page's resources selects
 * the flag, and is filtered.
 */

const STATUS_PAGE_API: string = path.resolve(
  __dirname,
  "../../../Server/API/StatusPageAPI.ts",
);

const RESOURCE_READ: RegExp = /StatusPageResourceService\.findBy\(/g;

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
        return !/isArchived:\s*true/.test(monitorSelect(read.args));
      })
      .map((read: { line: number }): number => {
        return read.line;
      });

    expect(missing).toEqual([]);
  });

  test("every read is filtered through ArchivedMonitorResources", () => {
    const filters: number = (
      source.match(/ArchivedMonitorResources\.withoutArchivedMonitors\(/g) ||
      []
    ).length;

    expect(filters).toBeGreaterThanOrEqual(reads.length);
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
