import ArchivedMonitorResources, {
  ResourceWithMonitor,
} from "../../../Utils/StatusPage/ArchivedMonitorResources";
import { describe, expect, test } from "@jest/globals";

/*
 * A status page resource whose monitor is archived is left out of every
 * public read of the page, and an archived monitor no longer counts towards
 * a monitor group's status. These are the two answers every one of those
 * reads relies on.
 */

interface Row extends ResourceWithMonitor {
  name: string;
}

function monitorRow(name: string, isArchived?: boolean): Row {
  return {
    name,
    monitorId: `${name}-id`,
    monitor: isArchived === undefined ? {} : { isArchived },
  };
}

function groupRow(name: string): Row {
  return { name };
}

describe("ArchivedMonitorResources.isMonitorArchived", () => {
  test("a resource whose monitor is archived", () => {
    expect(
      ArchivedMonitorResources.isMonitorArchived(monitorRow("api", true)),
    ).toBe(true);
  });

  test("a resource whose monitor is live", () => {
    expect(
      ArchivedMonitorResources.isMonitorArchived(monitorRow("api", false)),
    ).toBe(false);
  });

  test("a monitor read without the flag counts as live, never as archived", () => {
    expect(
      ArchivedMonitorResources.isMonitorArchived(monitorRow("api", undefined)),
    ).toBe(false);
  });

  test("a resource with no monitor (a monitor group row) is never archived", () => {
    expect(ArchivedMonitorResources.isMonitorArchived(groupRow("group"))).toBe(
      false,
    );
  });
});

describe("ArchivedMonitorResources.withoutArchivedMonitors", () => {
  test("drops only the rows whose monitor is archived, keeping the order", () => {
    const rows: Array<Row> = [
      monitorRow("checkout", false),
      monitorRow("legacy", true),
      groupRow("payments group"),
      monitorRow("search", undefined),
      monitorRow("old-cron", true),
    ];

    expect(
      ArchivedMonitorResources.withoutArchivedMonitors(rows).map(
        (row: Row): string => {
          return row.name;
        },
      ),
    ).toEqual(["checkout", "payments group", "search"]);
  });

  test("returns the same row objects, so callers keep every field they read", () => {
    const live: Row = monitorRow("checkout", false);

    expect(ArchivedMonitorResources.withoutArchivedMonitors([live])[0]).toBe(
      live,
    );
  });

  test("leaves the input untouched", () => {
    const rows: Array<Row> = [monitorRow("legacy", true)];

    ArchivedMonitorResources.withoutArchivedMonitors(rows);

    expect(rows).toHaveLength(1);
  });

  test("an empty list stays empty, and a list of only archived monitors empties", () => {
    expect(ArchivedMonitorResources.withoutArchivedMonitors([])).toEqual([]);
    expect(
      ArchivedMonitorResources.withoutArchivedMonitors([
        monitorRow("a", true),
        monitorRow("b", true),
      ]),
    ).toEqual([]);
  });
});
