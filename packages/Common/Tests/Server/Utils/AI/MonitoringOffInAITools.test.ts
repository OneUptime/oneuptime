import {
  ARCHIVED_MONITOR_NOTE,
  MONITOR_TABLE_ORDER_TEXT,
  MONITOR_TABLE_ORDER_WITH_MONITORING_OFF_TEXT,
  MONITOR_TABLE_PROBLEMS_ONLY_TEXT,
  MONITORING_OFF_LAST_STATUS_LABEL,
  MONITORING_OFF_LIST_NOTE,
  MONITORING_OFF_MONITOR_NOTE,
  MONITORING_OFF_STATUS_TEXT,
  QueryMonitorsTool,
} from "../../../../Server/Utils/AI/Toolbox/MonitorTools";
import { getFactsNotInHeading } from "../../../../Types/AI/ResourceCardFacts";
import {
  AI_READ_CARD_VALUES,
  AI_READ_TABLE_LINES,
  AI_READ_TABLE_TITLES,
  AIActionCardWords,
  AIActionTableCell,
  AIActionTableWords,
  aiActionFigure,
  aiActionSentence,
  aiActionTerm,
  describeAIActionCardWords,
  describeAIActionTableCell,
  describeAIActionTableWords,
  isKnownAIActionTableWords,
} from "../../../../Types/AI/AIActionWords";
import { dashboardTranslator } from "../../../Helpers/DashboardLocales";
import { expectReadCardWorded } from "../../../Helpers/ReadCardWords";
import MonitorOwnerTeam from "../../../../Models/DatabaseModels/MonitorOwnerTeam";
import Team from "../../../../Models/DatabaseModels/Team";
import {
  AIChatResourceCardOrigin,
  AIChatWidgetData,
  isAIChatReadResourceCard,
} from "../../../../Types/AI/AIChatTypes";
import { Gray500, Green, Red } from "../../../../Types/BrandColors";
import Color from "../../../../Types/Color";
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
 *   - the chat's table says Disabled for it, as the Monitors table does,
 *     and its order line says Disabled ones come last - only when one is
 *     there, so the line stays short enough to be read whole;
 *   - no status filter matches it (problemsOnly, monitorStatusName).
 * Read by id, it carries a note and a "Monitoring: Off" fact, and its card
 * says Disabled under its name - not the Offline it was frozen at, which it
 * names as its last status.
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
  });

  test("the table's order line says Disabled ones come last, in words its Status column uses", async () => {
    const { result } = await list(mixedPage());

    expect(result.widget?.description).toBe(
      MONITOR_TABLE_ORDER_WITH_MONITORING_OFF_TEXT,
    );
    expect(MONITOR_TABLE_ORDER_WITH_MONITORING_OFF_TEXT).toBe(
      "Non-operational first, Disabled last",
    );
    expect(MONITOR_TABLE_ORDER_WITH_MONITORING_OFF_TEXT).toContain(
      MONITORING_OFF_STATUS_TEXT,
    );
    /*
     * One line beside Open, cut past about 206px on a 360px phone (about 40
     * characters): "..., monitors with monitoring turned off last" was cut
     * on every screen, so the half that mattered was never read.
     */
    expect(
      MONITOR_TABLE_ORDER_WITH_MONITORING_OFF_TEXT.length,
    ).toBeLessThanOrEqual(40);
  });

  test("a table with no monitor whose monitoring is off keeps its order line as it was", async () => {
    const { result } = await list([
      monitor({ name: "Alpha", status: OPERATIONAL }),
      monitor({ name: "Zulu", status: OFFLINE }),
    ]);

    expect(result.widget?.description).toBe(MONITOR_TABLE_ORDER_TEXT);
    expect(MONITOR_TABLE_ORDER_TEXT).toBe("Non-operational monitors first");
  });

  test("a table of monitors whose monitoring is all off says Disabled for every row", async () => {
    const { result } = await list([
      monitor({ name: "Archive Bot", status: OFFLINE, monitoringOff: true }),
      monitor({ name: "Backup Job", status: DEGRADED, monitoringOff: true }),
    ]);

    expect(result.widget?.description).toBe(
      MONITOR_TABLE_ORDER_WITH_MONITORING_OFF_TEXT,
    );
    expect(
      tableRows(result).map((row: JSONObject): unknown => {
        return row["currentStatus"];
      }),
    ).toEqual(["Disabled", "Disabled"]);
  });

  test("problemsOnly keeps its own order line, which never lists a monitor whose monitoring is off", async () => {
    const { result } = await list(
      [monitor({ name: "Zulu", status: OFFLINE })],
      { problemsOnly: true },
    );

    expect(result.widget?.description).toBe(MONITOR_TABLE_PROBLEMS_ONLY_TEXT);
    // Short enough to be read whole beside Open on a phone, as the others.
    expect(MONITOR_TABLE_PROBLEMS_ONLY_TEXT).toBe(
      "Non-operational monitors only",
    );
    expect(MONITOR_TABLE_PROBLEMS_ONLY_TEXT.length).toBeLessThanOrEqual(40);
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

  function cardData(result: ToolExecutionResult): JSONObject {
    return (result.widget?.data as JSONObject | undefined) || {};
  }

  function cardFields(
    result: ToolExecutionResult,
  ): Array<{ label: string; value: string }> {
    return (cardData(result)["fields"] || []) as Array<{
      label: string;
      value: string;
    }>;
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

  test("its card says Disabled under its name, as the Monitors table does, and Offline as its last status", async () => {
    mockDetailLookups(
      monitor({ name: "Checkout API", status: OFFLINE, monitoringOff: true }),
    );

    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      { monitorId: ObjectID.generate().toString() },
      ctx,
    );
    const card: JSONObject = cardData(result);

    expect(card["heading"]).toBe("Checkout API");
    expect(card["subheading"]).toBe(MONITORING_OFF_STATUS_TEXT);
    expect(card["subheading"]).not.toBe("Offline");
    expect(MONITORING_OFF_LAST_STATUS_LABEL).toBe("Last status");
    expect(cardFields(result)).toEqual([
      { label: "Type", value: MonitorType.Website },
      { label: "Last status", value: "Offline" },
      { label: "Monitoring", value: "Off - not checked" },
    ]);
    expect(
      cardFields(result).map((field: { label: string }): string => {
        return field.label;
      }),
    ).not.toContain("Status");
  });

  test("the card draws the last status, which the line under the name does not say", async () => {
    mockDetailLookups(
      monitor({ name: "Checkout API", status: OFFLINE, monitoringOff: true }),
    );

    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      { monitorId: ObjectID.generate().toString() },
      ctx,
    );
    const card: JSONObject = cardData(result);

    // What ResourceCardWidget draws: every fact but those the lines say.
    expect(
      getFactsNotInHeading({
        heading: card["heading"] as string,
        subheading: card["subheading"] as string,
        fields: cardFields(result),
      }),
    ).toEqual([
      { label: "Type", value: MonitorType.Website },
      { label: "Last status", value: "Offline" },
      { label: "Monitoring", value: "Off - not checked" },
    ]);
  });

  test("a monitor whose monitoring is on keeps its status under its name, said once", async () => {
    mockDetailLookups(monitor({ name: "Checkout API", status: OFFLINE }));

    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      { monitorId: ObjectID.generate().toString() },
      ctx,
    );
    const card: JSONObject = cardData(result);

    // The line under the name says Offline, so no Status fact says it again.
    expect(card["subheading"]).toBe("Offline");
    expect(cardFields(result)).toEqual([
      { label: "Type", value: MonitorType.Website },
    ]);
    expect(
      getFactsNotInHeading({
        heading: card["heading"] as string,
        subheading: card["subheading"] as string,
        fields: cardFields(result),
      }),
    ).toEqual([{ label: "Type", value: MonitorType.Website }]);
  });

  test("an operational monitor whose monitoring is off is Disabled on its card too, not Operational", async () => {
    mockDetailLookups(
      monitor({
        name: "Backup Job",
        status: OPERATIONAL,
        monitoringOff: true,
      }),
    );

    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      { monitorId: ObjectID.generate().toString() },
      ctx,
    );

    expect(cardData(result)["subheading"]).toBe("Disabled");
    expect(cardFields(result)).toContainEqual({
      label: "Last status",
      value: "Operational",
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
    expect(cardData(result)["subheading"]).toBe("Disabled");
    expect(cardFields(result)).toEqual([
      { label: "Type", value: MonitorType.Website },
      { label: "Last status", value: "Offline" },
      { label: "Archived", value: "Yes - not monitored" },
      { label: "Monitoring", value: "Off - not checked" },
    ]);
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

/*
 * Issue #6968: the card a monitor read by id leaves was drawn as a write's
 * - green, with a check - so a monitor that was Offline, or whose
 * monitoring was off, read as something done well. Its card is a read's
 * now, drawn plain, with its status's own colour beside the line that
 * names it: the Offline red, and gray when the status is not live.
 */
describe("query_monitors read by id leaves a read's card, its status in its colour (#6968)", () => {
  function coloured(
    row: MonitorStatus,
    color: Color | undefined,
  ): MonitorStatus {
    const copy: MonitorStatus = status({
      name: row.name!,
      priority: row.priority!,
      operational: row.isOperationalState === true,
    });
    if (color) {
      copy.color = color;
    }
    return copy;
  }

  async function cardOf(row: Monitor): Promise<AIChatWidgetData> {
    spy(MonitorService, "findOneById", row);
    spy(MonitorStatusTimelineService, "findBy", []);
    spy(MonitorOwnerTeamService, "findBy", []);
    spy(MonitorOwnerUserService, "findBy", []);

    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      { monitorId: ObjectID.generate().toString() },
      ctx,
    );

    return result.widget!.data;
  }

  test("an Offline monitor's card is a read's, never a write's", async () => {
    const card: AIChatWidgetData = await cardOf(
      monitor({ name: "Checkout API", status: coloured(OFFLINE, Red) }),
    );

    expect(card.origin).toBe(AIChatResourceCardOrigin.Read);
    expect(isAIChatReadResourceCard(card)).toBe(true);
    expect(card.subheading).toBe("Offline");
  });

  test("its line's status is in that status's own colour, as the Monitors table draws it", async () => {
    const offline: AIChatWidgetData = await cardOf(
      monitor({ name: "Checkout API", status: coloured(OFFLINE, Red) }),
    );
    jest.restoreAllMocks();
    const operational: AIChatWidgetData = await cardOf(
      monitor({ name: "Ledger", status: coloured(OPERATIONAL, Green) }),
    );

    expect(offline.statusColor).toBe("#fd625e");
    expect(offline.statusColor).toBe(Red.toString());
    expect(operational.statusColor).toBe("#2ab57d");
    expect(operational.subheading).toBe("Operational");
  });

  test("monitoring off: Disabled, in gray - never the colour of the status it was frozen at", async () => {
    for (const frozenAt of [
      coloured(OFFLINE, Red),
      coloured(OPERATIONAL, Green),
    ]) {
      jest.restoreAllMocks();
      const card: AIChatWidgetData = await cardOf(
        monitor({
          name: "Backup Job",
          status: frozenAt,
          monitoringOff: true,
        }),
      );

      expect(card.subheading).toBe(MONITORING_OFF_STATUS_TEXT);
      expect(card.statusColor).toBe(Gray500.toString());
      expect(card.statusColor).toBe("#6b7280");
      expect(card.statusColor).not.toBe(frozenAt.color!.toString());
      expect(card.origin).toBe(AIChatResourceCardOrigin.Read);
    }
  });

  test("archived, and so not monitored: its status in gray too", async () => {
    const card: AIChatWidgetData = await cardOf(
      monitor({
        name: "Old Checkout API",
        status: coloured(OPERATIONAL, Green),
        isArchived: true,
      }),
    );

    expect(card.subheading).toBe("Operational");
    expect(card.statusColor).toBe(Gray500.toString());
    expect(card.fields).toContainEqual({
      label: "Archived",
      value: "Yes - not monitored",
    });
  });

  test("a status with no colour leaves no dot; a monitor with no status, no line and no dot", async () => {
    const uncoloured: AIChatWidgetData = await cardOf(
      monitor({ name: "Checkout API", status: coloured(DEGRADED, undefined) }),
    );
    expect(uncoloured.subheading).toBe("Degraded");
    expect(Object.keys(uncoloured)).not.toContain("statusColor");

    jest.restoreAllMocks();
    // A monitor not checked yet: no status at all.
    const row: Monitor = new Monitor();
    row._id = ObjectID.generate().toString();
    row.name = "New monitor";
    row.monitorType = MonitorType.Website;
    row.disableActiveMonitoring = false;
    const statusless: AIChatWidgetData = await cardOf(row);
    expect(statusless.subheading).toBeUndefined();
    expect(Object.keys(statusless)).not.toContain("statusColor");
  });

  test("a status colour that is not one is never saved on the card", async () => {
    const odd: MonitorStatus = coloured(OFFLINE, undefined);
    odd.color = new Color("red; background: url(https://example.com/x.png)");

    const card: AIChatWidgetData = await cardOf(
      monitor({ name: "Checkout API", status: odd }),
    );

    expect(card.subheading).toBe("Offline");
    expect(Object.keys(card)).not.toContain("statusColor");
  });
});

/*
 * Issue #7175: the card said "MONITOR", "Type: Website", "Last status" and
 * "Off - not checked" in English on a German or Persian page. Its words are
 * OneUptime's own words now, which the Dashboard says in the reader's
 * language - its status and its owners as the project named them - and the
 * English it stores is the same words in English.
 */
describe("query_monitors read by id leaves its card in the reader's language (#7175)", () => {
  async function widgetOf(
    row: Monitor,
    ownerTeams: Array<string> = [],
  ): Promise<ToolExecutionResult["widget"]> {
    spy(MonitorService, "findOneById", row);
    spy(MonitorStatusTimelineService, "findBy", []);
    spy(
      MonitorOwnerTeamService,
      "findBy",
      ownerTeams.map((name: string): MonitorOwnerTeam => {
        const owner: MonitorOwnerTeam = new MonitorOwnerTeam();
        const team: Team = new Team();
        team.name = name;
        owner.team = team;
        return owner;
      }),
    );
    spy(MonitorOwnerUserService, "findBy", []);

    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      { monitorId: ObjectID.generate().toString() },
      ctx,
    );

    return result.widget;
  }

  test("an Offline monitor: its type a word of ours, its status and owners as the project named them", async () => {
    const words: AIActionCardWords = expectReadCardWorded(
      await widgetOf(monitor({ name: "Checkout API", status: OFFLINE }), [
        "SRE",
        "DBA",
      ]),
    );

    expect(describeAIActionCardWords(words)).toEqual({
      kind: "Monitor",
      line: "Offline",
      facts: [
        { label: "Type", value: "Website" },
        { label: "Owner teams", value: "SRE, DBA" },
      ],
    });
    expect(describeAIActionCardWords(words, dashboardTranslator("de"))).toEqual(
      {
        kind: "Überwachung",
        line: "Offline",
        facts: [
          { label: "Typ", value: "Website" },
          { label: "Eigentümer-Teams", value: "SRE, DBA" },
        ],
      },
    );
  });

  test("monitoring off and archived: Disabled, Last status, Off - not checked and Yes - not monitored, each in the reader's words", async () => {
    const words: AIActionCardWords = expectReadCardWorded(
      await widgetOf(
        monitor({
          name: "Backup Job",
          status: OFFLINE,
          monitoringOff: true,
          isArchived: true,
        }),
      ),
    );

    expect(describeAIActionCardWords(words)).toEqual({
      kind: "Monitor",
      line: MONITORING_OFF_STATUS_TEXT,
      facts: [
        { label: "Type", value: "Website" },
        { label: MONITORING_OFF_LAST_STATUS_LABEL, value: "Offline" },
        { label: "Archived", value: "Yes - not monitored" },
        { label: "Monitoring", value: "Off - not checked" },
      ],
    });

    for (const language of ["de", "fa", "ar"]) {
      const drawn: string = JSON.stringify(
        describeAIActionCardWords(words, dashboardTranslator(language)),
      );

      for (const english of [
        "Monitor",
        "Disabled",
        "Last status",
        "Off - not checked",
        "Yes - not monitored",
        // German writes Website as English does.
        ...(language === "de" ? [] : ["Website"]),
      ]) {
        expect({ language, english, drawn }).toEqual({
          language,
          english,
          drawn: expect.not.stringContaining(english),
        });
      }

      // The status the project named is data, in every language.
      expect(drawn).toContain("Offline");
    }
  });
});

/*
 * The table under the cards, in the reader's language (issue #7394): the
 * cards above it said "Deaktiviert" and "Eingehende Anfrage" on a German
 * page while the row for the same monitor said "Disabled" and "Incoming
 * Request", under the English "Monitors (4)". query_monitors' table
 * carries words now - its title, its line, each type and Disabled - and
 * stores them in English; the model's rows stay as they were read.
 */
describe("query_monitors' table carries its words (#7394)", () => {
  function wordsOf(result: ToolExecutionResult): AIActionTableWords {
    const words: unknown = result.widget?.data.tableWords;

    expect(isKnownAIActionTableWords(words)).toBe(true);

    return words as AIActionTableWords;
  }

  function cellsOf(
    result: ToolExecutionResult,
    key: string,
  ): Array<AIActionTableCell | undefined> {
    return (wordsOf(result).cells || []).map(
      (
        cells: Record<string, AIActionTableCell>,
      ): AIActionTableCell | undefined => {
        return cells[key];
      },
    );
  }

  test("its title and line are sentences, its count a figure, and its English is those words", async () => {
    const { result } = await list(mixedPage());
    const words: AIActionTableWords = wordsOf(result);

    expect(words.title).toEqual(
      aiActionSentence(AI_READ_TABLE_TITLES.monitors, {
        count: aiActionFigure(5),
      }),
    );
    expect(words.description).toEqual(
      aiActionSentence(AI_READ_TABLE_LINES.notOperationalFirstDisabledLast),
    );
    expect(result.widget?.title).toBe("Monitors (5)");
    expect(describeAIActionTableWords(words)).toEqual({
      title: result.widget?.title,
      description: result.widget?.description,
    });
  });

  test("each type is a word of ours, and Disabled the card's word for a monitor whose monitoring is off", async () => {
    const { result } = await list(mixedPage());

    // Zulu, Mid, Alpha are checked; Archive Bot and Backup Job are not.
    expect(cellsOf(result, "type")).toEqual([
      aiActionTerm("Website"),
      aiActionTerm("Website"),
      aiActionTerm("Website"),
      aiActionTerm("Website"),
      aiActionTerm("Website"),
    ]);
    expect(cellsOf(result, "currentStatus")).toEqual([
      undefined,
      undefined,
      undefined,
      aiActionTerm(AI_READ_CARD_VALUES.disabled),
      aiActionTerm(AI_READ_CARD_VALUES.disabled),
    ]);

    // What the table stores at each worded cell is that word in English.
    tableRows(result).forEach((row: JSONObject, index: number): void => {
      for (const [key, cell] of Object.entries(
        wordsOf(result).cells![index]!,
      )) {
        expect(row[key]).toBe(describeAIActionTableCell(cell));
      }
    });
  });

  test("the statuses the project named are data: never words, in the table as named", async () => {
    const { result } = await list(mixedPage());

    expect(
      tableRows(result).map((row: JSONObject): unknown => {
        return row["currentStatus"];
      }),
    ).toEqual(["Offline", "Degraded", "Operational", "Disabled", "Disabled"]);

    for (const cells of wordsOf(result).cells || []) {
      expect(Object.keys(cells)).not.toContain("name");
    }
  });

  test("the model reads its rows as they were read: the type as stored and the status the monitor was frozen at", async () => {
    const { result } = await list(mixedPage());

    expect(rowLine(result, "Archive Bot")).toContain("currentStatus=Offline");
    expect(rowLine(result, "Archive Bot")).toContain(
      `type=${MonitorType.Website}`,
    );
    expect(result.dataForLlm).not.toContain("Disabled");
  });

  test("in German and Persian it says no English of ours: the title, the line, the types and Disabled", async () => {
    const { result } = await list(mixedPage());
    const words: AIActionTableWords = wordsOf(result);

    const de: { title: string; description?: string | undefined } =
      describeAIActionTableWords(words, dashboardTranslator("de"));
    expect(de.title).toBe("Monitore (5)");
    expect(de.description).toBe(
      "Nicht betriebsbereit zuerst, Deaktiviert zuletzt",
    );
    expect(
      describeAIActionTableCell(
        words.cells![3]!["currentStatus"]!,
        dashboardTranslator("de"),
      ),
    ).toBe("Deaktiviert");

    const fa: { title: string; description?: string | undefined } =
      describeAIActionTableWords(words, dashboardTranslator("fa"));
    expect(fa.title).toBe("مانیتورها (۵)");
    for (const english of ["Monitors", "Non-operational", "Disabled"]) {
      expect(`${fa.title} ${fa.description}`).not.toContain(english);
    }
    expect(
      describeAIActionTableCell(
        words.cells![0]!["type"]!,
        dashboardTranslator("fa"),
      ),
    ).toBe("وب‌سایت");
  });

  test("problemsOnly: Monitors with problems, and only non-operational ones", async () => {
    const { result } = await list(
      [monitor({ name: "Zulu", status: OFFLINE })],
      { problemsOnly: true },
    );

    expect(result.widget?.title).toBe("Monitors with problems (1)");
    expect(wordsOf(result).description).toEqual(
      aiActionSentence(AI_READ_TABLE_LINES.notOperationalOnly),
    );
  });

  test("a status asked for is named as the project named it, not as the model typed it", async () => {
    spy(MonitorStatusService, "findBy", [OPERATIONAL, DEGRADED, OFFLINE]);

    const { result } = await list(
      [monitor({ name: "Zulu", status: OFFLINE })],
      { monitorStatusName: "offline" },
    );

    expect(result.widget?.title).toBe('Monitors in status "Offline" (1)');
    expect(wordsOf(result).title).toEqual(
      aiActionSentence(AI_READ_TABLE_TITLES.monitorsInStatus, {
        status: "Offline",
        count: aiActionFigure(1),
      }),
    );
    expect(
      describeAIActionTableWords(wordsOf(result), dashboardTranslator("de"))
        .title,
    ).toBe("Monitore mit Status „Offline“ (1)");
    // The citation keeps what was asked, as before.
    expect(result.citationLabel).toBe('Monitors in status "offline" (1 found)');
  });

  test("a status asked for that matches several is named as asked", async () => {
    const offlineEu: MonitorStatus = status({
      name: "Offline EU",
      priority: 4,
      operational: false,
    });
    spy(MonitorStatusService, "findBy", [OPERATIONAL, OFFLINE, offlineEu]);

    const { result } = await list(
      [monitor({ name: "Zulu", status: OFFLINE })],
      { monitorStatusName: "offl" },
    );

    expect(result.widget?.title).toBe('Monitors in status "offl" (1)');
  });

  test("no monitors, no table: nothing to word", async () => {
    const { result } = await list([]);

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
