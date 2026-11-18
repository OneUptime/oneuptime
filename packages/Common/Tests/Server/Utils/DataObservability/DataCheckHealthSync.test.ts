import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";
import DataCheck from "../../../../Models/DatabaseModels/DataCheck";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import DataCheckService from "../../../../Server/Services/DataCheckService";
import DataCheckHealthSync from "../../../../Server/Utils/DataObservability/DataCheckHealthSync";
import Includes from "../../../../Types/BaseDatabase/Includes";
import {
  DataCheckRunStatus,
  DataCheckType,
} from "../../../../Types/DataObservability/DataCheckType";
import { DataCheckHealth } from "../../../../Types/DataObservability/DataObservabilityAttention";
import ObjectID from "../../../../Types/ObjectID";
import {
  StoredRow,
  rowMatchesWhere,
} from "../../TestingUtils/InMemoryRepository";

/*
 * A CHECK'S HEALTH, KEPT ON THE CHECK (#6554).
 *
 * Checks lists failing checks first because each check keeps how it stands
 * (DataCheck.health and healthRank), worked out by the Status column's rule
 * whenever what it reads changes: a run, an alert opening or resolving, the
 * check turned on or off. These pin what is written, that only a change is
 * written, that only an alert every reader may see counts, that an alert
 * read that fails writes nothing, and how an alert finds its check.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

function id(suffix: string): string {
  return `44444444-4444-4444-8444-${suffix.padStart(12, "0")}`;
}

const CHECK_FAILING: string = id("1");
const CHECK_PASSING: string = id("2");
const CHECK_COULD_NOT_RUN: string = id("3");
const CHECK_PRIVATE_ALERT: string = id("4");
const CHECK_NO_ALERT: string = id("5");
const CHECK_WAITING: string = id("6");
const CHECK_OFF: string = id("7");
const CHECK_DBT_FAILED: string = id("8");
const CHECK_ALREADY_KEPT: string = id("9");
const CHECK_OTHER_PROJECT: string = id("10");

const MONITOR_OPEN: string = id("101");
const MONITOR_QUIET: string = id("102");
const MONITOR_PRIVATE: string = id("103");
const MONITOR_KEPT: string = id("104");
const MONITOR_OTHER: string = id("105");

const OPEN_STATE: string = id("201");

const LAST_RUN: Date = new Date("2026-11-18T10:00:00.000Z");

function check(fields: StoredRow): DataCheck {
  const row: DataCheck = new DataCheck();

  for (const [column, value] of Object.entries({
    projectId: PROJECT,
    checkType: DataCheckType.NullPercent,
    isEnabled: true,
    lastRunAt: LAST_RUN,
    lastRunStatus: DataCheckRunStatus.Ran,
    ...fields,
  })) {
    (row as unknown as StoredRow)[column] = value;
  }

  return row;
}

let checks: Array<DataCheck>;
let alerts: Array<StoredRow>;
let written: Array<{ id: string; data: StoredRow }>;
let checkReads: Array<Record<string, unknown>>;

function matches(row: StoredRow, query: Record<string, unknown>): boolean {
  for (const [column, wanted] of Object.entries(query)) {
    if (wanted instanceof Includes) {
      if (!wanted.values.map(String).includes(String(row[column]))) {
        return false;
      }
      continue;
    }

    if (!rowMatchesWhere(row, { [column]: wanted })) {
      return false;
    }
  }

  return true;
}

// The privacy clause as Postgres reads it for no one: the alerts that are not private.
function passesNoOnesPrivacy(clause: unknown, row: StoredRow): boolean {
  if (!(clause instanceof FindOperator) || !clause.getSql) {
    throw new Error("Alerts read with no privacy clause.");
  }

  expect(clause.getSql("c")).toBe("(c IS NULL OR c = FALSE)");

  return row["isPrivate"] !== true;
}

beforeEach(() => {
  checks = [
    check({
      _id: CHECK_FAILING,
      monitorId: new ObjectID(MONITOR_OPEN),
      health: DataCheckHealth.Passing,
      healthRank: 2,
    }),
    check({ _id: CHECK_PASSING, monitorId: new ObjectID(MONITOR_QUIET) }),
    check({
      _id: CHECK_COULD_NOT_RUN,
      monitorId: new ObjectID(MONITOR_QUIET),
      lastRunStatus: DataCheckRunStatus.Failed,
    }),
    check({
      _id: CHECK_PRIVATE_ALERT,
      monitorId: new ObjectID(MONITOR_PRIVATE),
    }),
    check({ _id: CHECK_NO_ALERT }),
    check({ _id: CHECK_WAITING, lastRunAt: null, lastRunStatus: null }),
    check({
      _id: CHECK_OFF,
      isEnabled: false,
      monitorId: new ObjectID(MONITOR_OPEN),
    }),
    check({
      _id: CHECK_DBT_FAILED,
      checkType: DataCheckType.DbtTest,
      lastRunStatus: "Failed",
    }),
    // Already kept as it stands: nothing to write.
    check({
      _id: CHECK_ALREADY_KEPT,
      monitorId: new ObjectID(MONITOR_KEPT),
      health: DataCheckHealth.Passing,
      healthRank: 2,
    }),
    check({
      _id: CHECK_OTHER_PROJECT,
      projectId: OTHER_PROJECT,
      monitorId: new ObjectID(MONITOR_OTHER),
    }),
  ];

  alerts = [
    {
      _id: id("301"),
      projectId: PROJECT,
      monitorId: MONITOR_OPEN,
      currentAlertStateId: OPEN_STATE,
      isPrivate: false,
      title: "Null rate above 5%",
      createdAt: new Date("2026-11-18T09:00:00.000Z"),
    },
    // Open, but private to its owners: no one else is told the check fails.
    {
      _id: id("302"),
      projectId: PROJECT,
      monitorId: MONITOR_PRIVATE,
      currentAlertStateId: OPEN_STATE,
      isPrivate: true,
      title: "Private",
      createdAt: new Date("2026-11-18T09:00:00.000Z"),
    },
    {
      _id: id("303"),
      projectId: OTHER_PROJECT,
      monitorId: MONITOR_OTHER,
      currentAlertStateId: OPEN_STATE,
      isPrivate: false,
      title: "Other project's",
      createdAt: new Date("2026-11-18T09:00:00.000Z"),
    },
  ];

  written = [];
  checkReads = [];

  jest.spyOn(DataCheckService, "findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
  }) => {
    checkReads.push(findBy.query);
    return checks.filter((row: DataCheck): boolean => {
      return matches(row as unknown as StoredRow, findBy.query);
    });
  }) as never);

  jest
    .spyOn(DataCheckService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: { id: ObjectID; data: StoredRow }) => {
      written.push({ id: data.id.toString(), data: data.data });
    }) as never);

  jest
    .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
    .mockResolvedValue([new ObjectID(OPEN_STATE)] as never);

  jest.spyOn(AlertService, "findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
  }) => {
    const { isPrivate, ...rest } = findBy.query;

    return alerts
      .filter((row: StoredRow): boolean => {
        return matches(row, rest) && passesNoOnesPrivacy(isPrivate, row);
      })
      .map((row: StoredRow) => {
        return {
          ...row,
          id: new ObjectID(String(row["_id"])),
          monitorId: new ObjectID(String(row["monitorId"])),
        };
      });
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function writtenHealth(checkId: string): StoredRow | undefined {
  return written.find((write: { id: string }): boolean => {
    return write.id === checkId;
  })?.data;
}

describe("what a check keeps of how it stands", () => {
  test("each check's health and its place worst first, by the Status column's rule", async () => {
    const count: number = await DataCheckHealthSync.refreshChecks({
      projectId: PROJECT,
      checkIds: [
        CHECK_FAILING,
        CHECK_PASSING,
        CHECK_COULD_NOT_RUN,
        CHECK_NO_ALERT,
        CHECK_WAITING,
        CHECK_OFF,
        CHECK_DBT_FAILED,
      ],
    });

    expect(count).toBe(7);
    expect(writtenHealth(CHECK_FAILING)).toEqual({
      health: DataCheckHealth.Failing,
      healthRank: 0,
    });
    expect(writtenHealth(CHECK_COULD_NOT_RUN)).toEqual({
      health: DataCheckHealth.CouldNotRun,
      healthRank: 1,
    });
    expect(writtenHealth(CHECK_PASSING)).toEqual({
      health: DataCheckHealth.Passing,
      healthRank: 2,
    });
    expect(writtenHealth(CHECK_NO_ALERT)).toEqual({
      health: DataCheckHealth.NoAlert,
      healthRank: 3,
    });
    expect(writtenHealth(CHECK_WAITING)).toEqual({
      health: DataCheckHealth.Waiting,
      healthRank: 4,
    });
    // Turned off: off, whatever its alert says.
    expect(writtenHealth(CHECK_OFF)).toEqual({
      health: DataCheckHealth.Off,
      healthRank: 5,
    });
    // dbt's own verdict stands.
    expect(writtenHealth(CHECK_DBT_FAILED)).toEqual({
      health: DataCheckHealth.Failing,
      healthRank: 0,
    });
  });

  test("a check already kept as it stands is not written again", async () => {
    const count: number = await DataCheckHealthSync.refreshChecks({
      projectId: PROJECT,
      checkIds: [CHECK_ALREADY_KEPT],
    });

    expect(count).toBe(0);
    expect(written).toEqual([]);
  });

  test("a check whose only open alert is private is kept as its run says, never as failing", async () => {
    await DataCheckHealthSync.refreshChecks({
      projectId: PROJECT,
      checkIds: [CHECK_PRIVATE_ALERT],
    });

    expect(writtenHealth(CHECK_PRIVATE_ALERT)).toEqual({
      health: DataCheckHealth.Passing,
      healthRank: 2,
    });
  });

  test("checks of several projects are each read with their own project's alerts", async () => {
    await DataCheckHealthSync.refreshChecks({
      checkIds: [CHECK_FAILING, CHECK_OTHER_PROJECT],
    });

    expect(writtenHealth(CHECK_FAILING)?.["health"]).toBe(
      DataCheckHealth.Failing,
    );
    expect(writtenHealth(CHECK_OTHER_PROJECT)?.["health"]).toBe(
      DataCheckHealth.Failing,
    );
  });

  test("the checks are read in the project asked for only", async () => {
    await DataCheckHealthSync.refreshChecks({
      projectId: PROJECT,
      checkIds: [CHECK_OTHER_PROJECT],
    });

    expect(written).toEqual([]);
    expect(checkReads[0]!["projectId"]).toEqual(PROJECT);
  });

  test("alerts that cannot be read write nothing: a failing check is never written as passing", async () => {
    jest
      .spyOn(AlertService, "findBy")
      .mockRejectedValue(new Error("The database did not answer."));

    const count: number = await DataCheckHealthSync.refreshChecks({
      projectId: PROJECT,
      checkIds: [CHECK_FAILING, CHECK_PASSING],
    });

    expect(count).toBe(0);
    expect(written).toEqual([]);
  });

  test("a write that fails leaves the others written, and never throws", async () => {
    jest
      .spyOn(DataCheckService, "updateColumnsByIdWithoutHooks")
      .mockImplementation((async (data: { id: ObjectID; data: StoredRow }) => {
        if (data.id.toString() === CHECK_PASSING) {
          throw new Error("Lock timeout.");
        }

        written.push({ id: data.id.toString(), data: data.data });
      }) as never);

    const count: number = await DataCheckHealthSync.refreshChecks({
      projectId: PROJECT,
      checkIds: [CHECK_PASSING, CHECK_NO_ALERT],
    });

    expect(count).toBe(1);
    expect(writtenHealth(CHECK_NO_ALERT)?.["health"]).toBe(
      DataCheckHealth.NoAlert,
    );
  });

  test("nothing to read for no ids, or ids that are no ids", async () => {
    expect(
      await DataCheckHealthSync.refreshChecks({
        checkIds: ["", "not-an-id"],
      }),
    ).toBe(0);
    expect(checkReads).toEqual([]);
  });

  test("a check read that fails writes nothing, and never throws", async () => {
    jest
      .spyOn(DataCheckService, "findBy")
      .mockRejectedValue(new Error("The database did not answer."));

    expect(
      await DataCheckHealthSync.refreshChecks({ checkIds: [CHECK_FAILING] }),
    ).toBe(0);
    expect(written).toEqual([]);
  });
});

describe("an alert finds its check (refreshForAlerts)", () => {
  test("one read joins the alerts to the checks their monitors alert for, in the alert's project", async () => {
    const queries: Array<{ sql: string; parameters: Array<unknown> }> = [];

    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
      query: async (sql: string, parameters: Array<unknown>) => {
        queries.push({ sql, parameters });
        return [{ checkId: CHECK_FAILING }];
      },
    } as never);

    const count: number = await DataCheckHealthSync.refreshForAlerts([
      new ObjectID(id("301")),
      id("301"),
    ]);

    expect(count).toBe(1);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.parameters).toEqual([[id("301")]]);
    expect(queries[0]!.sql.replace(/\s+/g, " ")).toContain(
      'JOIN "DataCheck" check_row ON check_row."monitorId" = alert_row."monitorId" AND check_row."projectId" = alert_row."projectId" AND check_row."deletedAt" IS NULL',
    );
    expect(writtenHealth(CHECK_FAILING)?.["health"]).toBe(
      DataCheckHealth.Failing,
    );
  });

  test("an alert of a monitor that is no check's reads no check", async () => {
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
      query: async () => {
        return [];
      },
    } as never);

    expect(await DataCheckHealthSync.refreshForAlerts([id("399")])).toBe(0);
    expect(checkReads).toEqual([]);
  });

  test("no database, a read that fails, or no alert: nothing, and never a throw", async () => {
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(null);
    expect(await DataCheckHealthSync.refreshForAlerts([id("301")])).toBe(0);

    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
      query: async () => {
        throw new Error("Connection reset.");
      },
    } as never);
    expect(await DataCheckHealthSync.refreshForAlerts([id("301")])).toBe(0);

    expect(await DataCheckHealthSync.refreshForAlerts([])).toBe(0);
    expect(written).toEqual([]);
  });
});

/*
 * A deleted alert is open no more: its monitor's checks are read again by
 * the monitor - the alert may not be there to join through - in its
 * project only (AlertService.onDeleteSuccess).
 */
describe("a deleted alert's checks (refreshForMonitors)", () => {
  test("the checks of the monitors that raised it, in its project, are worked out again", async () => {
    const count: number = await DataCheckHealthSync.refreshForMonitors({
      projectId: PROJECT,
      monitorIds: [new ObjectID(MONITOR_OPEN), MONITOR_OPEN],
    });

    // Read by the monitor in the project, then each check by its id.
    expect(checkReads[0]!["projectId"]).toEqual(PROJECT);
    expect(checkReads[0]!["monitorId"]).toBeInstanceOf(FindOperator);
    expect(
      Object.values(
        (checkReads[0]!["monitorId"] as FindOperator<unknown>)
          .objectLiteralParameters || {},
      ).flat(),
    ).toEqual([MONITOR_OPEN]);
    // The checks of that monitor whose kept health moved.
    expect(count).toBeGreaterThan(0);
    expect(
      written.map((write: { id: string }): string => {
        return write.id;
      }),
    ).toContain(CHECK_FAILING);
  });

  test("a monitor that is no check's reads no check by id, and writes nothing", async () => {
    expect(
      await DataCheckHealthSync.refreshForMonitors({
        projectId: PROJECT,
        monitorIds: [id("399")],
      }),
    ).toBe(0);
    expect(checkReads).toHaveLength(1);
    expect(written).toEqual([]);
  });

  test("no monitor, ids that are no ids, or a read that fails: nothing, and never a throw", async () => {
    expect(
      await DataCheckHealthSync.refreshForMonitors({
        projectId: PROJECT,
        monitorIds: ["not-an-id"],
      }),
    ).toBe(0);
    expect(checkReads).toEqual([]);

    jest
      .spyOn(DataCheckService, "findBy")
      .mockRejectedValue(new Error("Connection reset.") as never);

    expect(
      await DataCheckHealthSync.refreshForMonitors({
        projectId: PROJECT,
        monitorIds: [MONITOR_OPEN],
      }),
    ).toBe(0);
    expect(written).toEqual([]);
  });
});

describe("what is stored", () => {
  test("a health and its rank", () => {
    expect(DataCheckHealthSync.toStored(DataCheckHealth.CouldNotRun)).toEqual({
      health: DataCheckHealth.CouldNotRun,
      healthRank: 1,
    });
    expect(
      DataCheckHealthSync.isStored(
        check({ health: DataCheckHealth.Off, healthRank: 5 }),
        DataCheckHealthSync.toStored(DataCheckHealth.Off),
      ),
    ).toBe(true);
    // A rank that does not match its health is written again.
    expect(
      DataCheckHealthSync.isStored(
        check({ health: DataCheckHealth.Off, healthRank: 2 }),
        DataCheckHealthSync.toStored(DataCheckHealth.Off),
      ),
    ).toBe(false);
  });
});
