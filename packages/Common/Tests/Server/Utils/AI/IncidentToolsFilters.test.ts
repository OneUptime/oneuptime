import { QueryIncidentsTool } from "../../../../Server/Utils/AI/Toolbox/IncidentTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import IncidentOwnerTeamService from "../../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../../Server/Services/IncidentOwnerUserService";
import IncidentService from "../../../../Server/Services/IncidentService";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "../../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../../Models/DatabaseModels/IncidentOwnerUser";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * query_incidents grew a state filter, skip pagination and owner details.
 * These tests lock in the load-bearing behavior: state="active" filters on
 * the canonical isResolvedState flag WITHOUT a createdAt window (so an open
 * incident from months ago still answers "what's active right now?"), skip
 * pagination reports the true total, and detail mode surfaces owner teams
 * and users scoped to the ctx tenant.
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

const INCIDENT_ID: ObjectID = ObjectID.generate();

function buildIncident(data?: { number?: number; title?: string }): Incident {
  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID.toString();
  incident.incidentNumber = data?.number ?? 42;
  incident.title = data?.title ?? "Checkout is down";

  const state: IncidentState = new IncidentState();
  state.name = "Investigating";
  incident.currentIncidentState = state;

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical";
  incident.incidentSeverity = severity;

  return incident;
}

function mockList(data: { incidents: Array<Incident>; total: number }): {
  findBySpy: jest.SpyInstance;
  countBySpy: jest.SpyInstance;
} {
  return {
    countBySpy: jest
      .spyOn(IncidentService, "countBy")
      .mockResolvedValue(new PositiveNumber(data.total) as never),
    findBySpy: jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue(data.incidents as never),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("query_incidents — state filter", () => {
  test("state=active filters on isResolvedState=false with NO createdAt window", async () => {
    const spies: { findBySpy: jest.SpyInstance; countBySpy: jest.SpyInstance } =
      mockList({ incidents: [buildIncident()], total: 1 });

    const result: ToolExecutionResult = await QueryIncidentsTool.execute(
      { state: "active" },
      ctx,
    );

    const callArgs: JSONObject = spies.findBySpy.mock
      .calls[0]?.[0] as JSONObject;
    const query: JSONObject = callArgs["query"] as JSONObject;

    expect(query["currentIncidentState"]).toEqual({ isResolvedState: false });
    // An open incident created months ago must still be found.
    expect(query["createdAt"]).toBeUndefined();

    // countBy sees the same query so the reported total matches the filter.
    const countArgs: JSONObject = spies.countBySpy.mock
      .calls[0]?.[0] as JSONObject;
    expect(countArgs["query"]).toEqual(query);

    expect(result.citationLabel).toBe("Active incidents (1 total)");
    expect(result.rowCount).toBe(1);
    expect(result.widget).toBeDefined();
  });

  test("state=active honors an explicitly passed time window", async () => {
    const spies: { findBySpy: jest.SpyInstance } = mockList({
      incidents: [],
      total: 0,
    });

    await QueryIncidentsTool.execute(
      { state: "active", createdWithinHours: 24 },
      ctx,
    );

    const callArgs: JSONObject = spies.findBySpy.mock
      .calls[0]?.[0] as JSONObject;
    const query: JSONObject = callArgs["query"] as JSONObject;

    expect(query["currentIncidentState"]).toEqual({ isResolvedState: false });
    expect(query["createdAt"]).toBeDefined();
  });

  test("state=resolved filters on isResolvedState=true within the window", async () => {
    const spies: { findBySpy: jest.SpyInstance } = mockList({
      incidents: [],
      total: 0,
    });

    const result: ToolExecutionResult = await QueryIncidentsTool.execute(
      { state: "resolved" },
      ctx,
    );

    const callArgs: JSONObject = spies.findBySpy.mock
      .calls[0]?.[0] as JSONObject;
    const query: JSONObject = callArgs["query"] as JSONObject;

    expect(query["currentIncidentState"]).toEqual({ isResolvedState: true });
    expect(query["createdAt"]).toBeDefined();
    expect(result.citationLabel).toBe(
      "Resolved incidents, last 168h (0 total)",
    );
  });

  test("default (no state) keeps the old behavior: window only, no state filter", async () => {
    const spies: { findBySpy: jest.SpyInstance } = mockList({
      incidents: [buildIncident()],
      total: 1,
    });

    const result: ToolExecutionResult = await QueryIncidentsTool.execute(
      {},
      ctx,
    );

    const callArgs: JSONObject = spies.findBySpy.mock
      .calls[0]?.[0] as JSONObject;
    const query: JSONObject = callArgs["query"] as JSONObject;

    expect(query["currentIncidentState"]).toBeUndefined();
    expect(query["createdAt"]).toBeDefined();
    expect(callArgs["props"]).toBe(ctx.props);
    expect(callArgs["limit"]).toBe(10);
    expect(callArgs["skip"]).toBe(0);
    expect(result.citationLabel).toBe("Incidents, last 168h (1 total)");
  });

  test("an invalid state value is rejected", async () => {
    await expect(
      QueryIncidentsTool.execute({ state: "open" }, ctx),
    ).rejects.toThrow(BadDataException);
  });
});

describe("query_incidents — skip pagination", () => {
  test("reports the slice and total when more rows exist", async () => {
    const incidents: Array<Incident> = [
      buildIncident({ number: 11 }),
      buildIncident({ number: 12 }),
    ];
    const spies: { findBySpy: jest.SpyInstance } = mockList({
      incidents: incidents,
      total: 40,
    });

    const result: ToolExecutionResult = await QueryIncidentsTool.execute(
      { skip: 10 },
      ctx,
    );

    const callArgs: JSONObject = spies.findBySpy.mock
      .calls[0]?.[0] as JSONObject;
    expect(callArgs["skip"]).toBe(10);

    expect(result.dataForLlm).toContain(
      "Showing rows 11–12 of 40 total. Pass skip to page further.",
    );
    expect(result.citationLabel).toBe("Incidents, last 168h (40 total)");
    // rowCount reflects the returned slice, not the total.
    expect(result.rowCount).toBe(2);
  });

  test("no paging banner when everything fits in one page", async () => {
    mockList({ incidents: [buildIncident()], total: 1 });

    const result: ToolExecutionResult = await QueryIncidentsTool.execute(
      {},
      ctx,
    );

    expect(result.dataForLlm).not.toContain("Pass skip to page further");
  });

  test("paging past the end stays oriented instead of a bare empty", async () => {
    mockList({ incidents: [], total: 40 });

    const result: ToolExecutionResult = await QueryIncidentsTool.execute(
      { skip: 100 },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain(
      "No rows at skip=100; there are 40 total.",
    );
    expect(result.widget).toBeUndefined();
  });

  test("clamps skip and limit", async () => {
    const spies: { findBySpy: jest.SpyInstance } = mockList({
      incidents: [],
      total: 0,
    });

    await QueryIncidentsTool.execute({ skip: 99999, limit: 9999 }, ctx);

    const callArgs: JSONObject = spies.findBySpy.mock
      .calls[0]?.[0] as JSONObject;
    expect(callArgs["skip"]).toBe(500);
    expect(callArgs["limit"]).toBe(25);
  });
});

describe("query_incidents — detail mode owners", () => {
  function buildDetailIncident(): Incident {
    const incident: Incident = buildIncident();
    incident.monitors = [];
    incident.labels = [];
    return incident;
  }

  test("surfaces owner teams and owner users, scoped to the ctx tenant", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(buildDetailIncident() as never);

    const ownerTeam: IncidentOwnerTeam = new IncidentOwnerTeam();
    const team: Team = new Team();
    team.name = "SRE";
    ownerTeam.team = team;

    const ownerUser: IncidentOwnerUser = new IncidentOwnerUser();
    const user: User = new User();
    user.name = new Name("Alice Doe");
    ownerUser.user = user;

    const teamSpy: jest.SpyInstance = jest
      .spyOn(IncidentOwnerTeamService, "findBy")
      .mockResolvedValue([ownerTeam] as never);
    const userSpy: jest.SpyInstance = jest
      .spyOn(IncidentOwnerUserService, "findBy")
      .mockResolvedValue([ownerUser] as never);

    const result: ToolExecutionResult = await QueryIncidentsTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain("SRE");
    expect(result.dataForLlm).toContain("Alice Doe");

    // Owner lookups are pinned to the tenant: incidentId is an untrusted arg.
    for (const spy of [teamSpy, userSpy]) {
      const callArgs: JSONObject = spy.mock.calls[0]?.[0] as JSONObject;
      const query: JSONObject = callArgs["query"] as JSONObject;
      expect((query["incidentId"] as ObjectID).toString()).toBe(
        INCIDENT_ID.toString(),
      );
      expect(query["projectId"]).toBe(ctx.projectId);
      expect(callArgs["props"]).toBe(ctx.props);
    }
  });

  test("a missing incident skips owner lookups and stays honest", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null as never);

    const teamSpy: jest.SpyInstance = jest.spyOn(
      IncidentOwnerTeamService,
      "findBy",
    );
    const userSpy: jest.SpyInstance = jest.spyOn(
      IncidentOwnerUserService,
      "findBy",
    );

    const result: ToolExecutionResult = await QueryIncidentsTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
    expect(teamSpy).not.toHaveBeenCalled();
    expect(userSpy).not.toHaveBeenCalled();
  });
});
