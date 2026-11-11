import {
  ARCHIVED_MONITOR_NOTE,
  MONITORING_OFF_LIST_NOTE,
  MONITORING_OFF_MONITOR_NOTE,
  MONITORING_OFF_STATUS_TEXT,
  QueryMonitorsTool,
} from "../../../../Server/Utils/AI/Toolbox/MonitorTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import MonitorOwnerTeamService from "../../../../Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../../Server/Services/MonitorOwnerUserService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import NotOperationalMonitorQuery from "../../../../Utils/Monitor/NotOperationalMonitorQuery";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ASK AI NEVER READS A MONITOR WHOSE MONITORING IS OFF AS A LIVE PROBLEM
 * (issue #6477).
 *
 * Nothing checks a monitor whose monitoring is turned off, so the status it
 * holds - "Offline", say - is only what its last check saw. #6416 left such
 * monitors out of query_monitors' problemsOnly; without it, the list still
 * sorted one first as a problem and gave its frozen status with nothing to
 * say monitoring was off, so the model answered "Checkout API is Offline"
 * about a monitor nobody was checking. Read by id, it said nothing either.
 *
 * Now the list keeps it - it is still one of the project's monitors - but:
 *   - after every monitor that is checked, in the database's order and in
 *     the page's, whatever status it was frozen at;
 *   - its row says monitoringOff=true, and the result says what that means;
 *   - the chat's table says Disabled for it, as the Monitors table does;
 *   - no status filter matches it (problemsOnly, monitorStatusName).
 * Read by id, it carries a note and a "Monitoring: Off" fact.
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

type AnySpy = SpyInstance<(...args: Array<never>) => unknown>;

function spy(target: unknown, method: string, value: unknown): AnySpy {
  return jest
    .spyOn(target as Record<string, () => unknown>, method)
    .mockResolvedValue(value as never) as unknown as AnySpy;
}

function firstCallArg(target: AnySpy): JSONObject {
  return target.mock.calls[0]?.[0] as unknown as JSONObject;
}

function status(data: {
  name: string;
  priority: number;
  operational: boolean;
}): MonitorStatus {
  const row: MonitorStatus = new MonitorStatus();
  row._id = ObjectID.generate().toString();
  row.name = data.name;
  row.priority = data.priority;
  row.isOperationalState = data.operational;
  return row;
}

const OPERATIONAL: MonitorStatus = status({
  name: "Operational",
  priority: 1,
  operational: true,
});
const DEGRADED: MonitorStatus = status({
  name: "Degraded",
  priority: 2,
  operational: false,
});
const OFFLINE: MonitorStatus = status({
  name: "Offline",
  priority: 3,
  operational: false,
});

function monitor(data: {
  name: string;
  status: MonitorStatus;
  monitoringOff?: boolean;
  isArchived?: boolean;
}): Monitor {
  const row: Monitor = new Monitor();
  row._id = ObjectID.generate().toString();
  row.name = data.name;
  row.monitorType = MonitorType.Website;
  row.currentMonitorStatus = data.status;
  row.disableActiveMonitoring = data.monitoringOff === true;
  if (data.isArchived !== undefined) {
    row.isArchived = data.isArchived;
  }
  return row;
}

async function list(
  monitors: Array<Monitor>,
  args: JSONObject = {},
): Promise<{ result: ToolExecutionResult; findBy: AnySpy; countBy: AnySpy }> {
  const findBy: AnySpy = spy(MonitorService, "findBy", monitors);
  const countBy: AnySpy = spy(
    MonitorService,
    "countBy",
    new PositiveNumber(monitors.length),
  );

  const result: ToolExecutionResult = await QueryMonitorsTool.execute(
    args,
    ctx,
  );

  return { result, findBy, countBy };
}

// The rows of the chat's table, as the widget carries them.
function tableRows(result: ToolExecutionResult): Array<JSONObject> {
  return ((result.widget?.data as JSONObject | undefined)?.["rows"] ||
    []) as Array<JSONObject>;
}

// The serialized row line that names a monitor.
function rowLine(result: ToolExecutionResult, name: string): string {
  const line: string | undefined = result.dataForLlm
    .split("\n")
    .find((candidate: string): boolean => {
      return candidate.includes(`name=${name}`);
    });

  if (!line) {
    throw new Error(`No row names ${name}.`);
  }

  return line;
}

// A mixed page, as the database answers it: checked by name, then off by name.
function mixedPage(): Array<Monitor> {
  return [
    monitor({ name: "Alpha", status: OPERATIONAL }),
    monitor({ name: "Mid", status: DEGRADED }),
    monitor({ name: "Zulu", status: OFFLINE }),
    monitor({ name: "Archive Bot", status: OFFLINE, monitoringOff: true }),
    monitor({ name: "Backup Job", status: OPERATIONAL, monitoringOff: true }),
  ];
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("query_monitors lists a monitor whose monitoring is off as such", () => {
  test("reads whether monitoring is off, and asks the database for checked monitors first", async () => {
    const { findBy } = await list([]);

    const args: JSONObject = firstCallArg(findBy);
    expect((args["select"] as JSONObject)["disableActiveMonitoring"]).toBe(
      true,
    );
    expect(args["sort"]).toEqual({
      disableActiveMonitoring: SortOrder.Ascending,
      name: SortOrder.Ascending,
    });
    // The order of the keys is the order of the ORDER BY.
    expect(Object.keys(args["sort"] as JSONObject)).toEqual([
      "disableActiveMonitoring",
      "name",
    ]);
  });

  test("without a filter, it is still listed: the query is the archive's alone", async () => {
    const { findBy, countBy } = await list([]);

    expect(firstCallArg(findBy)["query"]).toEqual({ isArchived: false });
    expect(firstCallArg(countBy)["query"]).toBe(firstCallArg(findBy)["query"]);
  });

  test("an Offline monitor whose monitoring is off is not sorted ahead of live problems", async () => {
    const { result } = await list(mixedPage());

    /*
     * Live problems, worst first; then the rest that are checked; then the
     * monitors whose monitoring is off, by name - the Offline one too.
     */
    const positions: Array<number> = [
      "Zulu",
      "Mid",
      "Alpha",
      "Archive Bot",
      "Backup Job",
    ].map((name: string): number => {
      return result.dataForLlm.indexOf(`name=${name}`);
    });

    for (const position of positions) {
      expect(position).toBeGreaterThanOrEqual(0);
    }
    for (let index: number = 1; index < positions.length; index++) {
      expect(positions[index]).toBeGreaterThan(positions[index - 1]!);
    }
  });

  test("monitors whose monitoring is off come last, among themselves by name, whatever status they were frozen at", async () => {
    const { result } = await list([
      monitor({ name: "Zebra", status: OFFLINE, monitoringOff: true }),
      monitor({ name: "Apple", status: OPERATIONAL, monitoringOff: true }),
      monitor({ name: "Quiet", status: OPERATIONAL }),
    ]);

    expect(
      tableRows(result).map((row: JSONObject): unknown => {
        return row["name"];
      }),
    ).toEqual(["Quiet", "Apple", "Zebra"]);
  });

  test("its row says monitoring is off; a checked monitor's row says nothing of it", async () => {
    const { result } = await list(mixedPage());

    expect(rowLine(result, "Archive Bot")).toContain("monitoringOff=true");
    expect(rowLine(result, "Backup Job")).toContain("monitoringOff=true");
    for (const name of ["Alpha", "Mid", "Zulu"]) {
      expect(rowLine(result, name)).not.toContain("monitoringOff");
    }
  });

  test("the model is told what monitoringOff means: a stale status, not down and not up", async () => {
    const { result } = await list(mixedPage());

    expect(result.dataForLlm).toContain(MONITORING_OFF_LIST_NOTE);
    expect(MONITORING_OFF_LIST_NOTE).toContain("monitoringOff=true");
    expect(MONITORING_OFF_LIST_NOTE).toContain("last check saw");
    expect(MONITORING_OFF_LIST_NOTE).toMatch(/do not report them as down/i);
    // Said before the rows it explains.
    expect(result.dataForLlm.indexOf(MONITORING_OFF_LIST_NOTE)).toBeLessThan(
      result.dataForLlm.indexOf("name="),
    );
  });

  test("a list with no monitor whose monitoring is off carries no such note", async () => {
    const { result } = await list([
      monitor({ name: "Alpha", status: OPERATIONAL }),
      monitor({ name: "Zulu", status: OFFLINE }),
    ]);

    expect(result.dataForLlm).not.toContain(MONITORING_OFF_LIST_NOTE);
    expect(result.dataForLlm).not.toContain("monitoringOff");
  });

  test("the row keeps the status it was frozen at for the model, and the chat's table says Disabled", async () => {
    const { result } = await list(mixedPage());

    // The model reads the last status, beside the flag that says it is stale.
    expect(rowLine(result, "Archive Bot")).toContain("currentStatus=Offline");

    const rows: Array<JSONObject> = tableRows(result);
    const statusOf: (name: string) => unknown = (name: string): unknown => {
      return rows.find((row: JSONObject): boolean => {
        return row["name"] === name;
      })?.["currentStatus"];
    };

    expect(MONITORING_OFF_STATUS_TEXT).toBe("Disabled");
    expect(statusOf("Archive Bot")).toBe("Disabled");
    expect(statusOf("Backup Job")).toBe("Disabled");
    expect(statusOf("Zulu")).toBe("Offline");
    expect(statusOf("Mid")).toBe("Degraded");
    expect(statusOf("Alpha")).toBe("Operational");
    expect((result.widget?.description as string | undefined) || "").toContain(
      "monitors with monitoring turned off last",
    );
  });

  test("paging still says how far it got, before the note and the rows", async () => {
    const findBy: AnySpy = spy(MonitorService, "findBy", mixedPage());
    spy(MonitorService, "countBy", new PositiveNumber(40));

    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      { limit: 5 },
      ctx,
    );

    expect(firstCallArg(findBy)["limit"]).toBe(5);
    const lines: Array<string> = result.dataForLlm.split("\n");
    expect(lines[0]).toBe(
      "Showing rows 1–5 of 40 total. Pass skip to page further.",
    );
    expect(lines[1]).toBe(MONITORING_OFF_LIST_NOTE);
    expect(lines[2]!.startsWith("- ")).toBe(true);
  });
});

describe("no status filter matches a monitor whose monitoring is off", () => {
  test("problemsOnly is the Not Operational rule, unchanged", async () => {
    const { findBy } = await list([], { problemsOnly: true });

    expect(firstCallArg(findBy)["query"]).toEqual(
      NotOperationalMonitorQuery.getQuery(),
    );
  });

  test("monitorStatusName matches only monitors whose monitoring is on", async () => {
    spy(MonitorStatusService, "findBy", [OPERATIONAL, DEGRADED, OFFLINE]);

    const { findBy, countBy } = await list([], {
      monitorStatusName: "offline",
    });

    const query: JSONObject = firstCallArg(findBy)["query"] as JSONObject;
    expect(query["isArchived"]).toBe(false);
    expect(query["disableActiveMonitoring"]).toBe(false);
    expect(query["currentMonitorStatusId"]).toBeDefined();
    expect(Object.keys(query).sort()).toEqual([
      "currentMonitorStatusId",
      "disableActiveMonitoring",
      "isArchived",
    ]);
    expect(firstCallArg(countBy)["query"]).toBe(query);
  });

  test("a status name and problemsOnly together still match only monitors whose monitoring is on", async () => {
    spy(MonitorStatusService, "findBy", [OPERATIONAL, DEGRADED, OFFLINE]);

    const { findBy } = await list([], {
      monitorStatusName: "degraded",
      problemsOnly: true,
    });

    const query: JSONObject = firstCallArg(findBy)["query"] as JSONObject;
    expect(query["disableActiveMonitoring"]).toBe(false);
    expect(query["isArchived"]).toBe(false);
    expect(query["currentMonitorStatus"]).toEqual({
      isOperationalState: false,
    });
  });

  test("an unknown status name still fails loudly, before anything is listed", async () => {
    spy(MonitorStatusService, "findBy", [OPERATIONAL, OFFLINE]);
    const findBy: AnySpy = spy(MonitorService, "findBy", []);

    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      { monitorStatusName: "Bogus" },
      ctx,
    );

    expect(result.dataForLlm).toContain('No monitor status matches "Bogus"');
    expect(findBy).not.toHaveBeenCalled();
  });
});

describe("query_monitors read by id says when monitoring is off", () => {
  function mockDetailLookups(row: Monitor): AnySpy {
    const findOneById: AnySpy = spy(MonitorService, "findOneById", row);
    spy(MonitorStatusTimelineService, "findBy", []);
    spy(MonitorOwnerTeamService, "findBy", []);
    spy(MonitorOwnerUserService, "findBy", []);
    return findOneById;
  }

  function cardFields(
    result: ToolExecutionResult,
  ): Array<{ label: string; value: string }> {
    return ((result.widget?.data as JSONObject | undefined)?.["fields"] ||
      []) as Array<{ label: string; value: string }>;
  }

  test("reads the flag, and says what an Offline status is worth when monitoring is off", async () => {
    const findOneById: AnySpy = mockDetailLookups(
      monitor({ name: "Checkout API", status: OFFLINE, monitoringOff: true }),
    );

    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      { monitorId: ObjectID.generate().toString() },
      ctx,
    );

    expect(
      (firstCallArg(findOneById)["select"] as JSONObject)[
        "disableActiveMonitoring"
      ],
    ).toBe(true);
    expect(result.dataForLlm.startsWith(MONITORING_OFF_MONITOR_NOTE)).toBe(
      true,
    );
    expect(result.dataForLlm).toContain("monitoringOff=true");
    expect(result.dataForLlm).toContain("currentStatus=Offline");
    expect(cardFields(result)).toContainEqual({
      label: "Monitoring",
      value: "Off - not checked",
    });
  });

  test("the note says the status is stale and how to check it again", () => {
    expect(MONITORING_OFF_MONITOR_NOTE).toContain("monitoring is turned off");
    expect(MONITORING_OFF_MONITOR_NOTE).toContain("last check saw");
    expect(MONITORING_OFF_MONITOR_NOTE).toContain("Turn its monitoring on");
  });

  test("a monitor whose monitoring is on carries no note, flag or fact", async () => {
    mockDetailLookups(monitor({ name: "Checkout API", status: OFFLINE }));

    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      { monitorId: ObjectID.generate().toString() },
      ctx,
    );

    expect(result.dataForLlm).not.toContain(MONITORING_OFF_MONITOR_NOTE);
    expect(result.dataForLlm).not.toContain("monitoringOff");
    expect(
      cardFields(result).map((field: { label: string }): string => {
        return field.label;
      }),
    ).not.toContain("Monitoring");
  });

  test("an archived monitor whose monitoring is also off says both, archived first", async () => {
    mockDetailLookups(
      monitor({
        name: "Checkout API",
        status: OFFLINE,
        monitoringOff: true,
        isArchived: true,
      }),
    );

    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      { monitorId: ObjectID.generate().toString() },
      ctx,
    );

    const lines: Array<string> = result.dataForLlm.split("\n");
    expect(lines[0]).toBe(ARCHIVED_MONITOR_NOTE);
    expect(lines[1]).toBe(MONITORING_OFF_MONITOR_NOTE);
    expect(result.dataForLlm).toContain("archived=true");
    expect(result.dataForLlm).toContain("monitoringOff=true");
  });

  test("a monitor that is gone says nothing of monitoring", async () => {
    spy(MonitorService, "findOneById", null);
    spy(MonitorStatusTimelineService, "findBy", []);

    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      { monitorId: ObjectID.generate().toString() },
      ctx,
    );

    expect(result.dataForLlm).not.toContain(MONITORING_OFF_MONITOR_NOTE);
    expect(result.widget).toBeUndefined();
  });
});

describe("the tool's own description", () => {
  test("says a monitor whose monitoring is off is listed with a stale status, and last", () => {
    const description: string = QueryMonitorsTool.description;

    expect(description).toContain("monitoringOff=true");
    expect(description).toMatch(/its status is stale/);
    expect(description).toContain(
      "with monitors whose monitoring is turned off last",
    );
    expect(description).toContain(
      "it matches only monitors whose monitoring is on",
    );
    // What #6416 said of problemsOnly still holds.
    expect(description).toContain(
      "leaving out monitors whose monitoring is turned off",
    );
  });

  test("says the status filter matches monitors whose monitoring is on", () => {
    const properties: JSONObject = QueryMonitorsTool.inputSchema[
      "properties"
    ] as JSONObject;

    expect(
      (properties["monitorStatusName"] as JSONObject)["description"],
    ).toContain("among those whose monitoring is on");
    expect((properties["problemsOnly"] as JSONObject)["description"]).toContain(
      "among those whose monitoring is on",
    );
  });
});
