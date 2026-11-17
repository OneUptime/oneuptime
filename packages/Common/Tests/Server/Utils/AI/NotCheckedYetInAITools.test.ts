import {
  getNotCheckedYet,
  MONITORING_OFF_STATUS_TEXT,
  NOT_CHECKED_YET_LIST_NOTE,
  NOT_CHECKED_YET_MONITOR_NOTE,
  QueryMonitorsTool,
} from "../../../../Server/Utils/AI/Toolbox/MonitorTools";
import {
  AI_READ_CARD_LINES,
  AI_READ_CARD_NOT_CHECKED_YET_LINES,
  AIActionCardWords,
  AIActionTableCell,
  AIActionTableWords,
  describeAIActionCardWords,
  describeAIActionTableCell,
  isKnownAIActionTableWords,
} from "../../../../Types/AI/AIActionWords";
import { dashboardTranslator } from "../../../Helpers/DashboardLocales";
import { expectReadCardWorded } from "../../../Helpers/ReadCardWords";
import { AIChatWidgetData } from "../../../../Types/AI/AIChatTypes";
import {
  Amber600,
  Gray500,
  Green,
  Red500,
} from "../../../../Types/BrandColors";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import MonitorOwnerTeamService from "../../../../Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../../Server/Services/MonitorOwnerUserService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import MonitorRowStatusUtil, {
  MONITOR_ROW_STATUS_SELECT,
  MONITOR_ROW_STATUS_WORDS,
  MonitorRowStatusKind,
} from "../../../../Utils/Monitor/MonitorRowStatus";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * OneUptime AI NEVER REPORTS A MONITOR NOTHING HAS CHECKED YET AS UP
 * (issue #8899).
 *
 * Every monitor is created in the project's operational status, so one
 * nothing has checked yet - its first probe result not back, a self-hosted
 * probe never connected - read "Operational" on the Monitors list, and
 * query_monitors said the same: "is everything up?" answered yes for a
 * monitor no check stood behind. The Monitors list now says why nothing
 * has checked it (MonitorRowStatus: Waiting for data, No results yet,
 * Paused, No Probe Enabled, Probes Disconnected), and the assistant says
 * what the list says:
 *
 *   - its row carries notCheckedYet, in those words, beside the status it
 *     was created in, and the result says what that means before the rows;
 *   - the chat's table says those words in its Status column, and its card
 *     under the monitor's name, in the reader's language, in the colour the
 *     list draws them in - and names no status, as the monitor's own page
 *     names no last recorded status;
 *   - a monitor something has measured, one read without the column, a
 *     manual monitor, and one whose status was set some other way since
 *     (an incident) are said as they always were.
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const EVERY_FIVE_MINUTES: string = "*/5 * * * *";

type AnySpy = SpyInstance<(...args: Array<never>) => unknown>;

function spy(target: unknown, method: string, value: unknown): AnySpy {
  return jest
    .spyOn(target as Record<string, () => unknown>, method)
    .mockResolvedValue(value as never) as unknown as AnySpy;
}

function firstCallArg(target: AnySpy): JSONObject {
  return target.mock.calls[0]?.[0] as unknown as JSONObject;
}

function ago(ms: number): Date {
  return new Date(Date.now() - ms);
}

function status(data: {
  name: string;
  priority: number;
  operational: boolean;
  offline?: boolean;
}): MonitorStatus {
  const row: MonitorStatus = new MonitorStatus();
  row._id = ObjectID.generate().toString();
  row.name = data.name;
  row.priority = data.priority;
  row.isOperationalState = data.operational;
  row.isOfflineState = data.offline === true;
  row.color = data.operational ? Green : Red500;
  return row;
}

const OPERATIONAL: MonitorStatus = status({
  name: "Operational",
  priority: 1,
  operational: true,
});
const OFFLINE: MonitorStatus = status({
  name: "Offline",
  priority: 3,
  operational: false,
  offline: true,
});

interface MonitorSpec {
  name: string;
  status?: MonitorStatus | undefined;
  type?: MonitorType | undefined;
  // null: read, and nothing has measured it; undefined: not read.
  firstMeasuredAt?: Date | null | undefined;
  createdAt?: Date | undefined;
  monitoringInterval?: string | undefined;
  monitoringOff?: boolean | undefined;
  isArchived?: boolean | undefined;
  pausedByIncident?: boolean | undefined;
  pausedByMaintenance?: boolean | undefined;
  noProbeEnabled?: boolean | undefined;
  probesDisconnected?: boolean | undefined;
}

function monitor(spec: MonitorSpec): Monitor {
  const row: Monitor = new Monitor();
  row._id = ObjectID.generate().toString();
  row.name = spec.name;
  row.monitorType = spec.type || MonitorType.Website;
  row.currentMonitorStatus = spec.status || OPERATIONAL;
  row.disableActiveMonitoring = spec.monitoringOff === true;
  row.isArchived = spec.isArchived === true;
  row.disableActiveMonitoringBecauseOfManualIncident =
    spec.pausedByIncident === true;
  row.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent =
    spec.pausedByMaintenance === true;
  row.isNoProbeEnabledOnThisMonitor = spec.noProbeEnabled === true;
  row.isAllProbesDisconnectedFromThisMonitor = spec.probesDisconnected === true;
  row.createdAt = spec.createdAt || ago(MINUTE);
  row.monitoringInterval = spec.monitoringInterval || EVERY_FIVE_MINUTES;

  if (spec.firstMeasuredAt !== undefined) {
    (row as unknown as JSONObject)["firstMeasuredAt"] =
      spec.firstMeasuredAt as unknown as JSONObject["firstMeasuredAt"];
  }

  return row;
}

// A monitor nothing has checked yet, created a minute ago.
function brandNew(name: string, spec: Partial<MonitorSpec> = {}): Monitor {
  return monitor({ name, firstMeasuredAt: null, ...spec });
}

async function list(monitors: Array<Monitor>): Promise<{
  result: ToolExecutionResult;
  findBy: AnySpy;
}> {
  const findBy: AnySpy = spy(MonitorService, "findBy", monitors);
  spy(MonitorService, "countBy", new PositiveNumber(monitors.length));

  const result: ToolExecutionResult = await QueryMonitorsTool.execute({}, ctx);

  return { result, findBy };
}

async function readById(row: Monitor | null): Promise<{
  result: ToolExecutionResult;
  findOneById: AnySpy;
}> {
  const findOneById: AnySpy = spy(MonitorService, "findOneById", row);
  spy(MonitorStatusTimelineService, "findBy", []);
  spy(MonitorOwnerTeamService, "findBy", []);
  spy(MonitorOwnerUserService, "findBy", []);

  const result: ToolExecutionResult = await QueryMonitorsTool.execute(
    { monitorId: ObjectID.generate().toString() },
    ctx,
  );

  return { result, findOneById };
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

// The chat table's Status for each monitor, as it stores it, by name.
function tableStatuses(result: ToolExecutionResult): Record<string, unknown> {
  const rows: Array<JSONObject> = ((result.widget?.data as JSONObject)[
    "rows"
  ] || []) as Array<JSONObject>;
  const statuses: Record<string, unknown> = {};

  for (const row of rows) {
    statuses[String(row["name"])] = row["currentStatus"];
  }

  return statuses;
}

function tableWords(result: ToolExecutionResult): AIActionTableWords {
  return (result.widget?.data as JSONObject)[
    "tableWords"
  ] as unknown as AIActionTableWords;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the words query_monitors says a monitor nothing has checked yet in", () => {
  test("are the Monitors table's own, each a line of the chat's card", () => {
    expect(AI_READ_CARD_LINES.waitingForData).toBe(
      MONITOR_ROW_STATUS_WORDS[MonitorRowStatusKind.WaitingForData],
    );
    expect(AI_READ_CARD_LINES.noResultsYet).toBe(
      MONITOR_ROW_STATUS_WORDS[MonitorRowStatusKind.NoResultsYet],
    );
    expect(AI_READ_CARD_LINES.paused).toBe(
      MONITOR_ROW_STATUS_WORDS[MonitorRowStatusKind.PausedBeforeFirstCheck],
    );
    expect(AI_READ_CARD_LINES.probesNotEnabled).toBe(
      MONITOR_ROW_STATUS_WORDS[MonitorRowStatusKind.NoProbeEnabled],
    );
    expect(AI_READ_CARD_LINES.probesDisconnected).toBe(
      MONITOR_ROW_STATUS_WORDS[MonitorRowStatusKind.ProbesDisconnected],
    );
    expect([...AI_READ_CARD_NOT_CHECKED_YET_LINES].sort()).toEqual(
      [
        "No results yet",
        "Paused",
        "Probes Disconnected",
        "No Probe Enabled",
        "Waiting for data",
      ].sort(),
    );
  });

  test.each([
    ["created a minute ago", {}, "Waiting for data"],
    [
      "its first result overdue",
      { createdAt: ago(2 * HOUR) },
      "No results yet",
    ],
    [
      "held by an incident declared by hand",
      { pausedByIncident: true },
      "Paused",
    ],
    [
      "held by scheduled maintenance",
      { pausedByMaintenance: true, createdAt: ago(2 * HOUR) },
      "Paused",
    ],
    ["no probe enabled", { noProbeEnabled: true }, "No Probe Enabled"],
    [
      "every probe disconnected",
      { probesDisconnected: true },
      "Probes Disconnected",
    ],
    [
      "an incoming request monitor waiting for its first request, however long",
      { type: MonitorType.IncomingRequest, createdAt: ago(30 * 24 * HOUR) },
      "Waiting for data",
    ],
  ] as Array<[string, Partial<MonitorSpec>, string]>)(
    "%s: %s, as the Monitors table says it",
    (_case: string, spec: Partial<MonitorSpec>, words: string) => {
      const row: Monitor = brandNew("Checkout API", spec);

      expect(getNotCheckedYet(row)?.words).toBe(words);
      expect(getNotCheckedYet(row)?.words).toBe(
        MonitorRowStatusUtil.getRowStatus(row).text,
      );
    },
  );

  test.each([
    ["something has measured it", { firstMeasuredAt: ago(10 * MINUTE) }],
    ["it was read without the column", { firstMeasuredAt: undefined }],
    ["it is a manual monitor", { type: MonitorType.Manual }],
    ["an incident set it Offline before its first check", { status: OFFLINE }],
    ["its monitoring is off", { monitoringOff: true }],
    ["it is archived", { isArchived: true }],
  ] as Array<[string, Partial<MonitorSpec>]>)(
    "none when %s",
    (_case: string, spec: Partial<MonitorSpec>) => {
      expect(
        getNotCheckedYet(
          monitor({ name: "Checkout API", firstMeasuredAt: null, ...spec }),
        ),
      ).toBeUndefined();
    },
  );

  test("none for a monitor that is not there", () => {
    expect(getNotCheckedYet(null)).toBeUndefined();
    expect(getNotCheckedYet(undefined)).toBeUndefined();
  });

  test("in the colour the Monitors table draws them in", () => {
    expect(getNotCheckedYet(brandNew("A"))?.color).toBe(Gray500.toString());
    expect(
      getNotCheckedYet(brandNew("B", { createdAt: ago(2 * HOUR) }))?.color,
    ).toBe(Amber600.toString());
    expect(
      getNotCheckedYet(brandNew("C", { noProbeEnabled: true }))?.color,
    ).toBe(Red500.toString());
  });
});

describe("query_monitors lists a monitor nothing has checked yet as such", () => {
  test("reads each monitor with what the Monitors table reads a row's status by", async () => {
    const { findBy } = await list([]);

    const select: JSONObject = firstCallArg(findBy)["select"] as JSONObject;

    for (const key of Object.keys(MONITOR_ROW_STATUS_SELECT)) {
      expect(select[key]).toBeDefined();
    }

    expect(select["firstMeasuredAt"]).toBe(true);
    expect(select["createdAt"]).toBe(true);
    expect(select["monitoringInterval"]).toBe(true);
    // And the status with its priority, for the problems-first order.
    expect(select["currentMonitorStatus"]).toEqual({
      name: true,
      color: true,
      isOperationalState: true,
      isOfflineState: true,
      priority: true,
    });
  });

  test("its row says why, beside the status it was created in", async () => {
    const { result } = await list([
      brandNew("Payments API"),
      monitor({
        name: "Checkout API",
        firstMeasuredAt: ago(HOUR),
      }),
    ]);

    expect(rowLine(result, "Payments API")).toContain(
      "notCheckedYet=Waiting for data",
    );
    // The model still reads the status, beside what says it is no check's.
    expect(rowLine(result, "Payments API")).toContain(
      "currentStatus=Operational",
    );
    expect(rowLine(result, "Checkout API")).not.toContain("notCheckedYet");
  });

  test("the model is told what notCheckedYet means, before the rows", async () => {
    const { result } = await list([brandNew("Payments API")]);

    expect(result.dataForLlm).toContain(NOT_CHECKED_YET_LIST_NOTE);
    expect(NOT_CHECKED_YET_LIST_NOTE).toContain("notCheckedYet");
    expect(NOT_CHECKED_YET_LIST_NOTE).toContain("created in");
    expect(NOT_CHECKED_YET_LIST_NOTE).toMatch(/do not report them as up/i);
    expect(result.dataForLlm.indexOf(NOT_CHECKED_YET_LIST_NOTE)).toBeLessThan(
      result.dataForLlm.indexOf("name="),
    );
  });

  test("a list every monitor of which has been measured carries no note", async () => {
    const { result } = await list([
      monitor({ name: "Checkout API", firstMeasuredAt: ago(HOUR) }),
      // Read before the column was: as it always was.
      monitor({ name: "Search" }),
    ]);

    expect(result.dataForLlm).not.toContain(NOT_CHECKED_YET_LIST_NOTE);
    expect(result.dataForLlm).not.toContain("notCheckedYet");
  });

  test("the chat's table says the Monitors table's words, and Disabled for one whose monitoring is off", async () => {
    const { result } = await list([
      brandNew("Payments API"),
      brandNew("Billing", { createdAt: ago(2 * HOUR) }),
      brandNew("Edge", { noProbeEnabled: true }),
      monitor({ name: "Checkout API", firstMeasuredAt: ago(HOUR) }),
      brandNew("Backup Job", { monitoringOff: true }),
    ]);

    expect(tableStatuses(result)).toEqual({
      "Payments API": "Waiting for data",
      Billing: "No results yet",
      Edge: "No Probe Enabled",
      "Checkout API": "Operational",
      "Backup Job": MONITORING_OFF_STATUS_TEXT,
    });
  });

  test("its table's words are ones the Dashboard says in the reader's language", async () => {
    const { result } = await list([
      brandNew("Payments API"),
      brandNew("Billing", { createdAt: ago(2 * HOUR) }),
    ]);

    const words: AIActionTableWords = tableWords(result);
    expect(isKnownAIActionTableWords(words)).toBe(true);

    const german: Array<string> = (words.cells || []).map(
      (cells: Record<string, AIActionTableCell>): string => {
        return describeAIActionTableCell(
          cells["currentStatus"]!,
          dashboardTranslator("de"),
        );
      },
    );

    // In the table's order: by name, both holding the operational status.
    expect(german).toEqual(["Noch keine Ergebnisse", "Warten auf Daten"]);
  });

  test("words a row carries that are not the Monitors table's are not said", async () => {
    const { result } = await list([brandNew("Payments API")]);

    // What a stored table says is checked again where it is drawn.
    expect(AI_READ_CARD_NOT_CHECKED_YET_LINES).not.toContain("Operational");
    expect(tableStatuses(result)["Payments API"]).toBe("Waiting for data");
  });
});

describe("query_monitors read by id says a monitor nothing has checked yet", () => {
  function card(result: ToolExecutionResult): AIChatWidgetData {
    return result.widget!.data;
  }

  test("reads it with what the Monitors table reads a row's status by", async () => {
    const { findOneById } = await readById(brandNew("Payments API"));

    const select: JSONObject = firstCallArg(findOneById)[
      "select"
    ] as JSONObject;
    expect(select["firstMeasuredAt"]).toBe(true);
    expect(select["isArchived"]).toBe(true);
    expect(select["disableActiveMonitoring"]).toBe(true);
    expect(
      (select["currentMonitorStatus"] as JSONObject)["isOfflineState"],
    ).toBe(true);
  });

  test("the note says its status is no check's, before the rows, and its row says why", async () => {
    const { result } = await readById(brandNew("Payments API"));

    expect(result.dataForLlm.startsWith(NOT_CHECKED_YET_MONITOR_NOTE)).toBe(
      true,
    );
    expect(result.dataForLlm).toContain("notCheckedYet=Waiting for data");
    expect(NOT_CHECKED_YET_MONITOR_NOTE).toMatch(/do not report it as up/i);
  });

  test("its card says Waiting for data under its name, in gray, and names no status", async () => {
    const { result } = await readById(brandNew("Payments API"));

    expect(card(result).subheading).toBe("Waiting for data");
    expect(card(result).statusColor).toBe(Gray500.toString());
    expect(card(result).fields).toEqual([
      { label: "Type", value: MonitorType.Website },
    ]);
  });

  test("overdue: No results yet, in amber", async () => {
    const { result } = await readById(
      brandNew("Billing", { createdAt: ago(2 * HOUR) }),
    );

    expect(card(result).subheading).toBe("No results yet");
    expect(card(result).statusColor).toBe(Amber600.toString());
    expect(result.dataForLlm).toContain("notCheckedYet=No results yet");
  });

  test("its card is in the reader's language", async () => {
    const { result } = await readById(brandNew("Payments API"));

    const words: AIActionCardWords = expectReadCardWorded(result.widget);

    expect(describeAIActionCardWords(words)).toEqual({
      kind: "Monitor",
      line: "Waiting for data",
      facts: [{ label: "Type", value: "Website" }],
    });
    expect(
      describeAIActionCardWords(words, dashboardTranslator("de")).line,
    ).toBe("Warten auf Daten");
  });

  test("a monitor something has measured keeps its status, its colour and no note", async () => {
    const { result } = await readById(
      monitor({ name: "Checkout API", firstMeasuredAt: ago(HOUR) }),
    );

    expect(result.dataForLlm).not.toContain(NOT_CHECKED_YET_MONITOR_NOTE);
    expect(result.dataForLlm).not.toContain("notCheckedYet");
    expect(card(result).subheading).toBe("Operational");
    expect(card(result).statusColor).toBe(Green.toString());
  });

  test("one whose monitoring is off is Disabled, as before: off says more than new", async () => {
    const { result } = await readById(
      brandNew("Backup Job", { monitoringOff: true }),
    );

    expect(result.dataForLlm).not.toContain(NOT_CHECKED_YET_MONITOR_NOTE);
    expect(card(result).subheading).toBe(MONITORING_OFF_STATUS_TEXT);
    expect(card(result).statusColor).toBe(Gray500.toString());
  });
});
