import { describe, expect, test } from "@jest/globals";
import {
  getDisabledMonitorsQuery,
  getListedMonitorsQuery,
  getMonitorHealth,
  getMonitorIssuesQuery,
  type MonitorHealth,
  type MonitorHealthFields,
} from "./monitorHealth";

/*
 * The app's copy of the web's monitor rule (issue #6475): a monitor whose
 * monitoring is turned off is Disabled and never an issue, whatever status its
 * last check left, and archived monitors are listed and counted nowhere.
 *
 * Home's counts are server queries, the Monitors screen sorts the rows it was
 * sent in memory, and Home's rows open the screen's filters - so the two must
 * pick the same monitors. This suite runs each query over every kind of row,
 * in memory, and holds it to what the screen does with that row. Common's
 * suite runs this file next to the web's rule itself
 * (MonitorHealthMobileParity).
 */

interface Row extends MonitorHealthFields {
  isArchived: boolean;
}

/*
 * A query as the server reads one of these: every key must match, a nested
 * object matches the related record's fields, a value is compared as is.
 */
function matches(row: Record<string, unknown>, query: unknown): boolean {
  return Object.entries(query as Record<string, unknown>).every(
    ([key, expected]: [string, unknown]): boolean => {
      const actual: unknown = row[key];

      if (expected !== null && typeof expected === "object") {
        return (
          actual !== null &&
          typeof actual === "object" &&
          matches(actual as Record<string, unknown>, expected)
        );
      }

      return actual === expected;
    },
  );
}

// Every kind of row: archived or not, monitoring on or off, each status flag.
const ROWS: Array<Row> = [true, false].flatMap((isArchived: boolean) => {
  return [true, false].flatMap((disableActiveMonitoring: boolean) => {
    return [true, false, undefined].map(
      (isOperationalState: boolean | undefined): Row => {
        return {
          isArchived,
          disableActiveMonitoring,
          currentMonitorStatus:
            isOperationalState === undefined ? {} : { isOperationalState },
        };
      },
    );
  });
});

function describeRow(row: Row): string {
  return `archived=${row.isArchived} off=${row.disableActiveMonitoring} operational=${String(
    row.currentMonitorStatus?.isOperationalState,
  )}`;
}

function listed(): Array<Row> {
  return ROWS.filter((row: Row): boolean => {
    return matches(
      row as unknown as Record<string, unknown>,
      getListedMonitorsQuery(),
    );
  });
}

describe("getMonitorHealth", () => {
  test.each<[string, MonitorHealthFields, MonitorHealth]>([
    [
      "an offline monitor that is checked has an issue",
      { currentMonitorStatus: { isOperationalState: false } },
      "issue",
    ],
    [
      "an operational monitor that is checked is healthy",
      { currentMonitorStatus: { isOperationalState: true } },
      "healthy",
    ],
    [
      "an offline monitor whose monitoring is off is disabled, not an issue",
      {
        disableActiveMonitoring: true,
        currentMonitorStatus: { isOperationalState: false },
      },
      "disabled",
    ],
    [
      "an operational monitor whose monitoring is off is disabled, not healthy",
      {
        disableActiveMonitoring: true,
        currentMonitorStatus: { isOperationalState: true },
      },
      "disabled",
    ],
    [
      "a monitor whose monitoring is off and that has no status is disabled",
      { disableActiveMonitoring: true },
      "disabled",
    ],
    [
      "a monitor read without a status is unknown, not healthy",
      { currentMonitorStatus: undefined },
      "unknown",
    ],
    [
      "a status without the semantic flag is unknown",
      { currentMonitorStatus: {} },
      "unknown",
    ],
    [
      "a null flag is unknown",
      { currentMonitorStatus: { isOperationalState: null } },
      "unknown",
    ],
    [
      "monitoring explicitly on reads the status",
      {
        disableActiveMonitoring: false,
        currentMonitorStatus: { isOperationalState: false },
      },
      "issue",
    ],
    [
      "a missing monitoring flag is on: the column defaults to false",
      {
        disableActiveMonitoring: undefined,
        currentMonitorStatus: { isOperationalState: false },
      },
      "issue",
    ],
    [
      "a null monitoring flag is on",
      {
        disableActiveMonitoring: null,
        currentMonitorStatus: { isOperationalState: true },
      },
      "healthy",
    ],
  ])(
    "%s",
    (_name: string, monitor: MonitorHealthFields, expected: MonitorHealth) => {
      expect(getMonitorHealth(monitor)).toBe(expected);
    },
  );
});

describe("the queries Home counts with", () => {
  test("Monitor issues is the web's Not Operational rule, word for word", () => {
    expect(getMonitorIssuesQuery()).toEqual({
      isArchived: false,
      disableActiveMonitoring: false,
      currentMonitorStatus: { isOperationalState: false },
    });
  });

  test("Disabled monitors leaves the archived ones out, as the web's Disabled badge does", () => {
    expect(getDisabledMonitorsQuery()).toEqual({
      isArchived: false,
      disableActiveMonitoring: true,
    });
  });

  test("All monitors leaves the archived ones out and nothing else", () => {
    expect(getListedMonitorsQuery()).toEqual({ isArchived: false });
  });

  test("each call hands out a fresh object: a caller that changes one changes no other", () => {
    const issues: Record<string, unknown> = getMonitorIssuesQuery();
    issues["isArchived"] = true;
    (issues["currentMonitorStatus"] as Record<string, unknown>)[
      "isOperationalState"
    ] = true;
    const disabled: Record<string, unknown> = getDisabledMonitorsQuery();
    disabled["disableActiveMonitoring"] = false;
    const all: Record<string, unknown> = getListedMonitorsQuery();
    all["isArchived"] = true;

    expect(getMonitorIssuesQuery()).toEqual({
      isArchived: false,
      disableActiveMonitoring: false,
      currentMonitorStatus: { isOperationalState: false },
    });
    expect(getDisabledMonitorsQuery()).toEqual({
      isArchived: false,
      disableActiveMonitoring: true,
    });
    expect(getListedMonitorsQuery()).toEqual({ isArchived: false });
  });
});

describe("Home's counts pick the monitors the screen's filters show", () => {
  test("the screen is sent no archived monitor", () => {
    expect(listed().length).toBe(6);
    for (const row of listed()) {
      expect(row.isArchived).toBe(false);
    }
  });

  test.each(
    ROWS.map((row: Row): [string, Row] => {
      return [describeRow(row), row];
    }),
  )("%s", (_name: string, row: Row) => {
    const record: Record<string, unknown> = row as unknown as Record<
      string,
      unknown
    >;
    const isListed: boolean = matches(record, getListedMonitorsQuery());
    const health: MonitorHealth = getMonitorHealth(row);

    // Monitor issues counts exactly the listed rows under Issues.
    expect(matches(record, getMonitorIssuesQuery())).toBe(
      isListed && health === "issue",
    );
    // Disabled monitors counts exactly the listed rows under Disabled.
    expect(matches(record, getDisabledMonitorsQuery())).toBe(
      isListed && health === "disabled",
    );
  });

  test("an offline monitor whose monitoring is off is in the Disabled count and not in Monitor issues", () => {
    const row: Record<string, unknown> = {
      isArchived: false,
      disableActiveMonitoring: true,
      currentMonitorStatus: { isOperationalState: false },
    };

    expect(matches(row, getMonitorIssuesQuery())).toBe(false);
    expect(matches(row, getDisabledMonitorsQuery())).toBe(true);
    expect(matches(row, getListedMonitorsQuery())).toBe(true);
  });

  test("an archived offline monitor is counted nowhere", () => {
    const row: Record<string, unknown> = {
      isArchived: true,
      disableActiveMonitoring: false,
      currentMonitorStatus: { isOperationalState: false },
    };

    expect(matches(row, getMonitorIssuesQuery())).toBe(false);
    expect(matches(row, getDisabledMonitorsQuery())).toBe(false);
    expect(matches(row, getListedMonitorsQuery())).toBe(false);
  });
});
