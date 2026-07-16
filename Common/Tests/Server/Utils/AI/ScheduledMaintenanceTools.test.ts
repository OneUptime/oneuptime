import { QueryScheduledMaintenanceTool } from "../../../../Server/Utils/AI/Toolbox/ScheduledMaintenanceTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * query_scheduled_maintenance closes the gap where "this maintenance event"
 * had no fetch tool. These tests lock in what the model relies on: the detail
 * mode returns the window + affected monitors for one event, the list mode
 * respects its clamps, empty results are honest (rowCount 0), and citations
 * deep-link to the right dashboard page.
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

const EVENT_ID: ObjectID = ObjectID.generate();

function buildEvent(data?: {
  id?: ObjectID;
  number?: number;
  title?: string;
  state?: string;
  monitors?: Array<string>;
}): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event._id = (data?.id ?? EVENT_ID).toString();
  event.title = data?.title ?? "Database upgrade";
  event.description = "Upgrading postgres to 17.";
  event.scheduledMaintenanceNumber = data?.number ?? 7;
  event.startsAt = new Date("2026-07-20T01:00:00Z");
  event.endsAt = new Date("2026-07-20T03:00:00Z");

  const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  state.name = data?.state ?? "Scheduled";
  event.currentScheduledMaintenanceState = state;

  event.monitors = (data?.monitors ?? ["Payments API"]).map(
    (name: string): Monitor => {
      const monitor: Monitor = new Monitor();
      monitor.name = name;
      return monitor;
    },
  );

  return event;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("query_scheduled_maintenance — detail mode", () => {
  test("returns the event's window and affected monitors with a view citation", async () => {
    jest
      .spyOn(ScheduledMaintenanceService, "findOneById")
      .mockResolvedValue(buildEvent() as never);

    const result: ToolExecutionResult =
      await QueryScheduledMaintenanceTool.execute(
        { scheduledMaintenanceId: EVENT_ID.toString() },
        ctx,
      );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain("Database upgrade");
    expect(result.dataForLlm).toContain("Payments API");
    expect(result.dataForLlm).toContain("2026-07-20");
    expect(result.citationLabel).toBe("Scheduled maintenance #7");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.ScheduledMaintenanceView,
      params: { scheduledMaintenanceId: EVENT_ID.toString() },
    });
    expect(result.widget).toBeDefined();
  });

  test("a missing event is honest: zero rows, no widget", async () => {
    jest
      .spyOn(ScheduledMaintenanceService, "findOneById")
      .mockResolvedValue(null as never);

    const result: ToolExecutionResult =
      await QueryScheduledMaintenanceTool.execute(
        { scheduledMaintenanceId: EVENT_ID.toString() },
        ctx,
      );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
  });
});

describe("query_scheduled_maintenance — list mode", () => {
  test("lists events overlapping the window, most recent first", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockResolvedValue([
        buildEvent({ number: 7 }),
        buildEvent({
          id: ObjectID.generate(),
          number: 8,
          title: "CDN failover drill",
          state: "Ongoing",
          monitors: [],
        }),
      ] as never);

    const result: ToolExecutionResult =
      await QueryScheduledMaintenanceTool.execute({}, ctx);

    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).toContain("Database upgrade");
    expect(result.dataForLlm).toContain("CDN failover drill");
    expect(result.citationLabel).toBe(
      "Scheduled maintenance, -30d/+30d (2 found)",
    );
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.ScheduledMaintenanceEvents,
    });

    // The query must run under the requesting user's props, never as root+.
    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["props"]).toBe(ctx.props);
    expect(callArgs["limit"]).toBe(10);
  });

  test("clamps the window and limit arguments", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult =
      await QueryScheduledMaintenanceTool.execute(
        { pastDays: 10000, upcomingDays: -5, limit: 999 },
        ctx,
      );

    expect(result.citationLabel).toBe(
      "Scheduled maintenance, -365d/+0d (0 found)",
    );

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["limit"]).toBe(25);
  });

  test("an empty window is honest: zero rows and no widget", async () => {
    jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockResolvedValue([] as never);

    const result: ToolExecutionResult =
      await QueryScheduledMaintenanceTool.execute({}, ctx);

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
  });
});

describe("query_scheduled_maintenance — permissions", () => {
  test("required permissions derive from the model read ACL", () => {
    expect(
      QueryScheduledMaintenanceTool.requiredPermissions.length,
    ).toBeGreaterThan(0);
  });
});
