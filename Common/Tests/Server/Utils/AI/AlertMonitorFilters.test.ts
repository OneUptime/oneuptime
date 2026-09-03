import { QueryAlertsTool } from "../../../../Server/Utils/AI/Toolbox/AlertTools";
import { QueryMonitorsTool } from "../../../../Server/Utils/AI/Toolbox/MonitorTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AlertService from "../../../../Server/Services/AlertService";
import AlertOwnerTeamService from "../../../../Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../../Server/Services/AlertOwnerUserService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorOwnerTeamService from "../../../../Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../../Server/Services/MonitorOwnerUserService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertOwnerTeam from "../../../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../../../Models/DatabaseModels/AlertOwnerUser";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorOwnerTeam from "../../../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../../../Models/DatabaseModels/MonitorOwnerUser";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import Color from "../../../../Types/Color";
import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * These tests lock in the new filtering surface of query_alerts and
 * query_monitors: that state / problemsOnly / monitorStatusName actually
 * reach the service query (asserted on the spy's call args, not on the
 * result), that skip/totalCount paging is reported honestly, and that
 * detail mode surfaces owners.
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

function buildAlert(data?: {
  number?: number;
  title?: string;
  state?: string;
  monitorName?: string;
}): Alert {
  const alert: Alert = new Alert();
  alert._id = ObjectID.generate().toString();
  alert.title = data?.title ?? "CPU usage high";
  alert.alertNumber = data?.number ?? 42;
  alert.createdAt = new Date("2026-08-01T00:00:00Z");

  /*
   * Left unset on purpose when no name is given: an alert can be raised by
   * hand or by a workflow, with no monitor behind it at all, and that shape
   * has to survive serialization too.
   */
  if (data?.monitorName) {
    alert.monitor = buildMonitor({ name: data.monitorName });
  }

  const state: AlertState = new AlertState();
  state.name = data?.state ?? "Created";
  alert.currentAlertState = state;

  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "Critical";
  alert.alertSeverity = severity;

  return alert;
}

function buildMonitorStatus(data: {
  id?: ObjectID;
  name: string;
  priority: number;
  operational: boolean;
  color?: string;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status._id = (data.id ?? ObjectID.generate()).toString();
  status.name = data.name;
  status.priority = data.priority;
  status.isOperationalState = data.operational;
  if (data.color) {
    status.color = new Color(data.color);
  }
  return status;
}

function buildMonitor(data: { name: string; status?: MonitorStatus }): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.name = data.name;
  monitor.monitorType = MonitorType.Website;
  if (data.status) {
    monitor.currentMonitorStatus = data.status;
  }
  return monitor;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("query_alerts — state filter", () => {
  test("state='active' filters on isResolvedState=false and drops the createdAt window", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([buildAlert()] as never);
    const countBySpy: jest.SpyInstance = jest
      .spyOn(AlertService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);

    const result: ToolExecutionResult = await QueryAlertsTool.execute(
      { state: "active" },
      ctx,
    );

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["query"]).toEqual({
      currentAlertState: { isResolvedState: false },
    });
    expect(callArgs["props"]).toBe(ctx.props);

    // countBy must see the exact same query the rows came from.
    const countArgs: JSONObject = countBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(countArgs["query"]).toBe(callArgs["query"]);

    expect(result.rowCount).toBe(1);
    expect(result.citationLabel).toBe("Active alerts (1 found)");
  });

  test("state='active' keeps an explicitly requested createdAt window", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(AlertService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    await QueryAlertsTool.execute(
      { state: "active", createdWithinHours: 6 },
      ctx,
    );

    const query: JSONObject = (findBySpy.mock.calls[0]?.[0] as JSONObject)[
      "query"
    ] as JSONObject;
    expect(query["currentAlertState"]).toEqual({ isResolvedState: false });
    expect(query["createdAt"]).toBeDefined();
  });

  test("state='resolved' filters on isResolvedState=true within the default window", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([buildAlert({ state: "Resolved" })] as never);
    jest
      .spyOn(AlertService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);

    const result: ToolExecutionResult = await QueryAlertsTool.execute(
      { state: "resolved" },
      ctx,
    );

    const query: JSONObject = (findBySpy.mock.calls[0]?.[0] as JSONObject)[
      "query"
    ] as JSONObject;
    expect(query["currentAlertState"]).toEqual({ isResolvedState: true });
    expect(query["createdAt"]).toBeDefined();
    expect(result.citationLabel).toBe("Resolved alerts, last 24h (1 found)");
  });

  test("default state='any' applies no state condition", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([buildAlert()] as never);
    jest
      .spyOn(AlertService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);

    const result: ToolExecutionResult = await QueryAlertsTool.execute({}, ctx);

    const query: JSONObject = (findBySpy.mock.calls[0]?.[0] as JSONObject)[
      "query"
    ] as JSONObject;
    expect(query["currentAlertState"]).toBeUndefined();
    expect(query["createdAt"]).toBeDefined();
    expect(result.citationLabel).toBe("Alerts, last 24h (1 found)");
  });
});

describe("query_alerts — paging", () => {
  test("reports the total and the shown slice when more rows exist", async () => {
    jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([
        buildAlert({ number: 1 }),
        buildAlert({ number: 2 }),
      ] as never);
    jest
      .spyOn(AlertService, "countBy")
      .mockResolvedValue(new PositiveNumber(30) as never);

    const result: ToolExecutionResult = await QueryAlertsTool.execute(
      { state: "active" },
      ctx,
    );

    expect(result.dataForLlm).toContain(
      "Showing rows 1–2 of 30 total. Pass skip to page further.",
    );
    expect(result.citationLabel).toBe("Active alerts (2 of 30)");
  });

  test("skip reaches the query and is clamped to 500", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(AlertService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    await QueryAlertsTool.execute({ skip: 700, limit: 999 }, ctx);

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["skip"]).toBe(500);
    expect(callArgs["limit"]).toBe(25);
  });

  test("an empty result is honest: zero rows, no widget, no paging banner", async () => {
    jest.spyOn(AlertService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(AlertService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    const result: ToolExecutionResult = await QueryAlertsTool.execute(
      { state: "active" },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
    expect(result.dataForLlm).not.toContain("Showing rows");
  });
});

describe("query_alerts — detail mode owners", () => {
  test("includes owner teams and users in the detail row", async () => {
    const alertId: ObjectID = ObjectID.generate();

    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(buildAlert() as never);

    const team: Team = new Team();
    team.name = "SRE";
    const ownerTeam: AlertOwnerTeam = new AlertOwnerTeam();
    ownerTeam.team = team;
    const ownerTeamSpy: jest.SpyInstance = jest
      .spyOn(AlertOwnerTeamService, "findBy")
      .mockResolvedValue([ownerTeam] as never);

    const user: User = new User();
    user.name = new Name("Alice Smith");
    const ownerUser: AlertOwnerUser = new AlertOwnerUser();
    ownerUser.user = user;
    jest
      .spyOn(AlertOwnerUserService, "findBy")
      .mockResolvedValue([ownerUser] as never);

    const result: ToolExecutionResult = await QueryAlertsTool.execute(
      { alertId: alertId.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain("SRE");
    expect(result.dataForLlm).toContain("Alice Smith");

    // The owner lookup is keyed by an untrusted id, so it must be tenant-pinned.
    const ownerQuery: JSONObject = (
      ownerTeamSpy.mock.calls[0]?.[0] as JSONObject
    )["query"] as JSONObject;
    expect(ownerQuery["projectId"]).toBe(ctx.projectId);

    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.AlertView,
      params: { alertId: alertId.toString() },
    });
    expect(result.widget).toBeDefined();
  });

  test("a missing alert is honest: zero rows and no owner lookups", async () => {
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(null as never);
    const ownerTeamSpy: jest.SpyInstance = jest
      .spyOn(AlertOwnerTeamService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryAlertsTool.execute(
      { alertId: ObjectID.generate().toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
    expect(ownerTeamSpy).not.toHaveBeenCalled();
  });
});

/*
 * The alerts page ships "Which monitor or source is generating the most alerts
 * recently?" as a first-class suggested prompt, and query_alerts is the only
 * tool that can answer it. Until an alert row carried the monitor it was
 * raised for, the model had nothing to group by and could only guess a source
 * out of alert titles. So the monitor is pinned in two places here: the select
 * that reaches the database (a column that is never selected can never be
 * returned, no matter what the row mapper does) and the serialized rows the
 * model actually reads.
 */
describe("query_alerts — originating monitor", () => {
  test("the list branch selects and returns the monitor each alert was raised for", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([
        buildAlert({ title: "Latency spike", monitorName: "Payments API" }),
        buildAlert({ title: "5xx rate high", monitorName: "Checkout Web" }),
      ] as never);
    jest
      .spyOn(AlertService, "countBy")
      .mockResolvedValue(new PositiveNumber(2) as never);

    const result: ToolExecutionResult = await QueryAlertsTool.execute(
      { state: "active" },
      ctx,
    );

    const select: JSONObject = (findBySpy.mock.calls[0]?.[0] as JSONObject)[
      "select"
    ] as JSONObject;
    expect(select["monitor"]).toEqual({ name: true });

    // One monitor per row — grouping by source is only possible if each row names its own.
    expect(result.dataForLlm).toContain("monitor=Payments API");
    expect(result.dataForLlm).toContain("monitor=Checkout Web");

    /*
     * The widget is built from the same rows, so the field travels in its
     * payload too. EntityListWidget does not render a monitor today — this
     * pins the payload shape, not a user-visible outcome.
     */
    const items: Array<JSONObject> = result.widget?.data.items ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]?.["monitor"]).toBe("Payments API");
    expect(items[1]?.["monitor"]).toBe("Checkout Web");
  });

  test("the single-alert branch selects and returns the originating monitor too", async () => {
    const alertId: ObjectID = ObjectID.generate();

    const findOneByIdSpy: jest.SpyInstance = jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(
        buildAlert({
          title: "Latency spike",
          monitorName: "Payments API",
        }) as never,
      );
    jest.spyOn(AlertOwnerTeamService, "findBy").mockResolvedValue([] as never);
    jest.spyOn(AlertOwnerUserService, "findBy").mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryAlertsTool.execute(
      { alertId: alertId.toString() },
      ctx,
    );

    const select: JSONObject = (
      findOneByIdSpy.mock.calls[0]?.[0] as JSONObject
    )["select"] as JSONObject;
    expect(select["monitor"]).toEqual({ name: true });

    /*
     * "What is this alert even watching?" is the first question asked of a
     * single alert, and the detail row is the only place it can be answered.
     */
    expect(result.dataForLlm).toContain("monitor=Payments API");
  });

  test("an alert with no monitor serializes cleanly and emits no monitor field", async () => {
    jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([buildAlert({ title: "Raised by hand" })] as never);
    jest
      .spyOn(AlertService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);

    const result: ToolExecutionResult = await QueryAlertsTool.execute(
      { state: "active" },
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain("Raised by hand");

    /*
     * Nothing is better than something wrong here: the field is dropped
     * outright rather than emitted as an empty or "undefined" source that the
     * model would then count as a monitor of its own.
     */
    expect(result.dataForLlm).not.toContain("monitor=");
    const items: Array<JSONObject> = result.widget?.data.items ?? [];
    expect(items[0]?.["monitor"]).toBeUndefined();
  });

  test("the tool description advertises the monitor so the model plans around it", () => {
    /*
     * The model chooses tools from their descriptions, not from the shape of
     * results it has not fetched yet. A field nothing advertises is a field it
     * will not go looking for.
     */
    expect(QueryAlertsTool.description.toLowerCase()).toContain("monitor");
  });
});

describe("query_monitors — problemsOnly filter", () => {
  test("problemsOnly=true filters on isOperationalState=false at the DB level", async () => {
    const downStatus: MonitorStatus = buildMonitorStatus({
      name: "Offline",
      priority: 3,
      operational: false,
      color: "#ff0000",
    });
    const findBySpy: jest.SpyInstance = jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        buildMonitor({ name: "Payments API", status: downStatus }),
      ] as never);
    const countBySpy: jest.SpyInstance = jest
      .spyOn(MonitorService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);

    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      { problemsOnly: true },
      ctx,
    );

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["query"]).toEqual({
      currentMonitorStatus: { isOperationalState: false },
    });
    expect(callArgs["props"]).toBe(ctx.props);

    const countArgs: JSONObject = countBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(countArgs["query"]).toBe(callArgs["query"]);

    expect(result.rowCount).toBe(1);
    expect(result.citationLabel).toBe("Monitors with problems (1 found)");
    // The row carries the status name and its color for rendering.
    expect(result.dataForLlm).toContain("Offline");
    expect(result.dataForLlm).toContain("#ff0000");
    expect(result.widget).toBeDefined();
  });
});

describe("query_monitors — monitorStatusName filter", () => {
  test("resolves the status name case-insensitively and filters by its id", async () => {
    const offlineId: ObjectID = ObjectID.generate();
    jest.spyOn(MonitorStatusService, "findBy").mockResolvedValue([
      buildMonitorStatus({
        name: "Operational",
        priority: 1,
        operational: true,
      }),
      buildMonitorStatus({ name: "Degraded", priority: 2, operational: false }),
      buildMonitorStatus({
        id: offlineId,
        name: "Offline",
        priority: 3,
        operational: false,
      }),
    ] as never);

    const anySpy: jest.SpyInstance = jest.spyOn(QueryHelper, "any");

    const findBySpy: jest.SpyInstance = jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(MonitorService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    await QueryMonitorsTool.execute({ monitorStatusName: "OFFLINE" }, ctx);

    // The matched status id — and only that id — reaches the monitor query.
    expect(anySpy).toHaveBeenCalledWith([offlineId]);
    const query: JSONObject = (findBySpy.mock.calls[0]?.[0] as JSONObject)[
      "query"
    ] as JSONObject;
    expect(query["currentMonitorStatusId"]).toBe(anySpy.mock.results[0]?.value);
  });

  test("an unknown status name fails loudly with the real status names", async () => {
    jest.spyOn(MonitorStatusService, "findBy").mockResolvedValue([
      buildMonitorStatus({
        name: "Operational",
        priority: 1,
        operational: true,
      }),
      buildMonitorStatus({
        name: "Offline",
        priority: 3,
        operational: false,
      }),
    ] as never);
    const findBySpy: jest.SpyInstance = jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      { monitorStatusName: "Bogus" },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
    expect(result.dataForLlm).toContain('No monitor status matches "Bogus"');
    expect(result.dataForLlm).toContain("Operational");
    expect(result.dataForLlm).toContain("Offline");
    expect(findBySpy).not.toHaveBeenCalled();
  });
});

describe("query_monitors — ordering and paging", () => {
  test("non-operational monitors come first, worst status first, then name", async () => {
    const up: MonitorStatus = buildMonitorStatus({
      name: "Operational",
      priority: 1,
      operational: true,
    });
    const degraded: MonitorStatus = buildMonitorStatus({
      name: "Degraded",
      priority: 2,
      operational: false,
    });
    const offline: MonitorStatus = buildMonitorStatus({
      name: "Offline",
      priority: 3,
      operational: false,
    });

    // DB returns name-ascending; the page must be reordered problems-first.
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        buildMonitor({ name: "Alpha", status: up }),
        buildMonitor({ name: "Mid", status: degraded }),
        buildMonitor({ name: "Zulu", status: offline }),
      ] as never);
    jest
      .spyOn(MonitorService, "countBy")
      .mockResolvedValue(new PositiveNumber(3) as never);

    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      {},
      ctx,
    );

    const zulu: number = result.dataForLlm.indexOf("Zulu");
    const mid: number = result.dataForLlm.indexOf("Mid");
    const alpha: number = result.dataForLlm.indexOf("Alpha");
    expect(zulu).toBeGreaterThanOrEqual(0);
    expect(zulu).toBeLessThan(mid);
    expect(mid).toBeLessThan(alpha);
  });

  test("reports the total and clamps skip/limit", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        buildMonitor({
          name: "Solo",
          status: buildMonitorStatus({
            name: "Operational",
            priority: 1,
            operational: true,
          }),
        }),
      ] as never);
    jest
      .spyOn(MonitorService, "countBy")
      .mockResolvedValue(new PositiveNumber(120) as never);

    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      { skip: 5000, limit: 5000 },
      ctx,
    );

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["skip"]).toBe(500);
    expect(callArgs["limit"]).toBe(50);
    expect(result.dataForLlm).toContain(
      "Showing rows 501–501 of 120 total. Pass skip to page further.",
    );
    expect(result.citationLabel).toBe("Monitors (1 of 120)");
  });

  test("an empty list is honest: zero rows and no widget", async () => {
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(MonitorService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      { problemsOnly: true },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
    expect(result.dataForLlm).not.toContain("Showing rows");
  });
});

describe("query_monitors — detail mode owners", () => {
  test("includes owner teams and users next to the status timeline", async () => {
    const monitorId: ObjectID = ObjectID.generate();

    jest.spyOn(MonitorService, "findOneById").mockResolvedValue(
      buildMonitor({
        name: "Payments API",
        status: buildMonitorStatus({
          name: "Offline",
          priority: 3,
          operational: false,
          color: "#ff0000",
        }),
      }) as never,
    );

    const timelineEntry: MonitorStatusTimeline = new MonitorStatusTimeline();
    timelineEntry.createdAt = new Date("2026-08-13T10:00:00Z");
    timelineEntry.monitorStatus = buildMonitorStatus({
      name: "Offline",
      priority: 3,
      operational: false,
    });
    jest
      .spyOn(MonitorStatusTimelineService, "findBy")
      .mockResolvedValue([timelineEntry] as never);

    const team: Team = new Team();
    team.name = "Platform";
    const ownerTeam: MonitorOwnerTeam = new MonitorOwnerTeam();
    ownerTeam.team = team;
    const ownerTeamSpy: jest.SpyInstance = jest
      .spyOn(MonitorOwnerTeamService, "findBy")
      .mockResolvedValue([ownerTeam] as never);

    const user: User = new User();
    user.name = new Name("Bob Jones");
    const ownerUser: MonitorOwnerUser = new MonitorOwnerUser();
    ownerUser.user = user;
    jest
      .spyOn(MonitorOwnerUserService, "findBy")
      .mockResolvedValue([ownerUser] as never);

    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      { monitorId: monitorId.toString() },
      ctx,
    );

    // monitor row + 1 timeline row
    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).toContain("Platform");
    expect(result.dataForLlm).toContain("Bob Jones");
    expect(result.dataForLlm).toContain("Offline");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.MonitorView,
      params: { monitorId: monitorId.toString() },
    });
    expect(result.widget).toBeDefined();

    // The owner lookup is keyed by an untrusted id, so it must be tenant-pinned.
    const ownerQuery: JSONObject = (
      ownerTeamSpy.mock.calls[0]?.[0] as JSONObject
    )["query"] as JSONObject;
    expect(ownerQuery["projectId"]).toBe(ctx.projectId);
  });
});

describe("query_alerts / query_monitors — permissions", () => {
  test("required permissions derive from the model read ACLs", () => {
    expect(QueryAlertsTool.requiredPermissions.length).toBeGreaterThan(0);
    expect(QueryMonitorsTool.requiredPermissions.length).toBeGreaterThan(0);
  });
});
