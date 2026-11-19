import type { AxiosResponse } from "axios";
import { beforeEach, describe, expect, test } from "@jest/globals";
import apiClient from "./client";
import {
  LIST_COLUMNS,
  MAX_FILTER_IDS,
  fetchLabels,
  fetchMonitorOptions,
  fetchMyTeamIds,
  fetchOwnedRecordIds,
  fetchSeverities,
  fetchTeams,
  getFilterColumnsQuery,
  getOwnersQuery,
  postFilteredList,
  type FilteredListRequest,
  type LabelOptionItem,
  type SeverityOptionItem,
  type TeamOptionItem,
} from "./recordFilters";
import { fetchIncidents } from "./incidents";
import { fetchMonitors } from "./monitors";
import { emptyFilters, type RecordFilters } from "../filters/recordFilters";

jest.mock("./client", () => {
  return {
    __esModule: true,
    default: { post: jest.fn() },
  };
});

/*
 * How a list's filters reach the server. Each list must name the columns
 * the Dashboard filters on - a wrong column is a 400 at best and, at worst,
 * a filter quietly matching nothing - and the owners filter must still work
 * on a server older than it, by reading the owner tables first. A filter
 * that can match nothing is an empty page, never a request that would match
 * everything.
 */

function postSpy(): jest.Mock {
  return apiClient.post as unknown as jest.Mock;
}

function ok(data: unknown): AxiosResponse {
  return { data: data } as AxiosResponse;
}

function badRequest(): Error {
  return Object.assign(new Error("Bad request"), {
    isAxiosError: true,
    response: { status: 400, data: { message: "Invalid column" } },
  });
}

function filters(overrides: Partial<RecordFilters>): RecordFilters {
  return { ...emptyFilters(), ...overrides };
}

function bodyOf(call: number): Record<string, unknown> {
  return postSpy().mock.calls[call]?.[1] as Record<string, unknown>;
}

function queryOf(call: number): Record<string, unknown> {
  return bodyOf(call)["query"] as Record<string, unknown>;
}

beforeEach(() => {
  postSpy().mockReset();
});

describe("getFilterColumnsQuery", () => {
  test("incidents: state, severity and labels on the Dashboard's columns", () => {
    expect(
      getFilterColumnsQuery(
        "incidents",
        filters({
          stateIds: ["s1"],
          severityIds: ["sev1", "sev2"],
          labelIds: ["l1"],
        }),
      ),
    ).toEqual({
      currentIncidentStateId: { _type: "Includes", value: ["s1"] },
      incidentSeverityId: { _type: "Includes", value: ["sev1", "sev2"] },
      labels: { _type: "Includes", value: ["l1"] },
    });
  });

  test("incidents: monitors are not a column here - they are a step of their own", () => {
    expect(
      getFilterColumnsQuery("incidents", filters({ monitorIds: ["m1"] })),
    ).toEqual({});
  });

  test("alerts: their one monitor is matched on monitorId", () => {
    expect(
      getFilterColumnsQuery(
        "alerts",
        filters({ monitorIds: ["m1"], stateIds: ["s1"], severityIds: ["v"] }),
      ),
    ).toEqual({
      currentAlertStateId: { _type: "Includes", value: ["s1"] },
      alertSeverityId: { _type: "Includes", value: ["v"] },
      monitorId: { _type: "Includes", value: ["m1"] },
    });
  });

  test("episodes use their own state and severity columns", () => {
    expect(
      getFilterColumnsQuery(
        "incidentEpisodes",
        filters({ stateIds: ["s"], severityIds: ["v"] }),
      ),
    ).toEqual({
      currentIncidentStateId: { _type: "Includes", value: ["s"] },
      incidentSeverityId: { _type: "Includes", value: ["v"] },
    });
    expect(
      getFilterColumnsQuery(
        "alertEpisodes",
        filters({ stateIds: ["s"], severityIds: ["v"] }),
      ),
    ).toEqual({
      currentAlertStateId: { _type: "Includes", value: ["s"] },
      alertSeverityId: { _type: "Includes", value: ["v"] },
    });
  });

  test("monitors: status, type and labels; a severity has no column", () => {
    expect(
      getFilterColumnsQuery(
        "monitors",
        filters({
          stateIds: ["offline"],
          monitorTypes: ["Website", "API"],
          labelIds: ["l"],
          severityIds: ["ignored"],
        }),
      ),
    ).toEqual({
      currentMonitorStatusId: { _type: "Includes", value: ["offline"] },
      monitorType: { _type: "Includes", value: ["Website", "API"] },
      labels: { _type: "Includes", value: ["l"] },
    });
  });

  test("no filters, no columns", () => {
    expect(getFilterColumnsQuery("alerts", emptyFilters())).toEqual({});
  });
});

describe("getOwnersQuery", () => {
  test("the server's OwnedBy operator, any of the people and teams", () => {
    expect(getOwnersQuery({ userIds: ["me"], teamIds: ["t1"] })).toEqual({
      owners: {
        _type: "OwnedBy",
        match: "AnyOf",
        userIds: ["me"],
        teamIds: ["t1"],
      },
    });
  });

  test("never names more than the server takes", () => {
    const teamIds: Array<string> = Array.from(
      { length: MAX_FILTER_IDS + 10 },
      (_: unknown, index: number) => {
        return `t${index}`;
      },
    );
    const query: Record<string, unknown> = getOwnersQuery({
      userIds: ["me"],
      teamIds: teamIds,
    });
    const owners: { userIds: Array<string>; teamIds: Array<string> } = query[
      "owners"
    ] as { userIds: Array<string>; teamIds: Array<string> };
    expect(owners.userIds.length + owners.teamIds.length).toBe(MAX_FILTER_IDS);
  });
});

describe("LIST_COLUMNS owner tables", () => {
  test("each list reads the owner tables beside its own records", () => {
    expect(LIST_COLUMNS.incidents.owners).toEqual({
      userPath: "/api/incident-owner-user",
      teamPath: "/api/incident-owner-team",
      recordIdColumn: "incidentId",
    });
    expect(LIST_COLUMNS.alerts.owners.recordIdColumn).toBe("alertId");
    expect(LIST_COLUMNS.monitors.owners.userPath).toBe(
      "/api/monitor-owner-user",
    );
    expect(LIST_COLUMNS.incidentEpisodes.owners.recordIdColumn).toBe(
      "incidentEpisodeId",
    );
    expect(LIST_COLUMNS.alertEpisodes.owners.teamPath).toBe(
      "/api/alert-episode-owner-team",
    );
  });
});

function request(
  overrides: Partial<FilteredListRequest> = {},
): FilteredListRequest & { post: jest.Mock } {
  const post: jest.Mock = jest.fn(async (query: unknown) => {
    return ok({ data: [{ query: query }], count: 1 });
  });
  return {
    projectId: "project-1",
    list: "incidents",
    filters: emptyFilters(),
    owners: null,
    baseQuery: {},
    post: post,
    limit: 100,
    ...overrides,
  } as FilteredListRequest & { post: jest.Mock };
}

describe("postFilteredList", () => {
  test("columns are added to the list's own query", async () => {
    const req: FilteredListRequest & { post: jest.Mock } = request({
      list: "monitors",
      baseQuery: { isArchived: false },
      filters: filters({ monitorTypes: ["Website"] }),
    });
    await postFilteredList(req);
    expect(req.post).toHaveBeenCalledTimes(1);
    expect(req.post.mock.calls[0]?.[0]).toEqual({
      isArchived: false,
      monitorType: { _type: "Includes", value: ["Website"] },
    });
  });

  test("owners go to the server as one OwnedBy query", async () => {
    const req: FilteredListRequest & { post: jest.Mock } = request({
      filters: filters({ ownedByMe: true }),
      owners: { userIds: ["me"], teamIds: ["t1"] },
    });
    await postFilteredList(req);
    expect(req.post).toHaveBeenCalledTimes(1);
    expect(req.post.mock.calls[0]?.[0]).toEqual({
      owners: {
        _type: "OwnedBy",
        match: "AnyOf",
        userIds: ["me"],
        teamIds: ["t1"],
      },
    });
    expect(postSpy()).not.toHaveBeenCalled();
  });

  test("an owner filter that names nobody matches nothing, and asks nothing", async () => {
    const req: FilteredListRequest & { post: jest.Mock } = request({
      filters: filters({ ownedByMe: true }),
      owners: { userIds: [], teamIds: [] },
    });
    const response: AxiosResponse = await postFilteredList(req);
    expect(response.data).toEqual({ data: [], count: 0, skip: 0, limit: 100 });
    expect(req.post).not.toHaveBeenCalled();
  });

  test("a server older than OwnedBy: the owner tables are read, then the records by id", async () => {
    const req: FilteredListRequest & { post: jest.Mock } = request({
      filters: filters({ ownerUserIds: ["u1"], ownerTeamIds: ["t1"] }),
      owners: { userIds: ["u1"], teamIds: ["t1"] },
      baseQuery: { title: "x" },
    });
    req.post
      .mockImplementationOnce(async () => {
        throw badRequest();
      })
      .mockImplementationOnce(async (query: unknown) => {
        return ok({ data: [{ query: query }], count: 1 });
      });
    postSpy()
      .mockResolvedValueOnce(
        ok({ data: [{ incidentId: "i1" }, { incidentId: "i2" }] }),
      )
      .mockResolvedValueOnce(
        ok({
          data: [
            { incidentId: { _type: "ObjectID", value: "i2" } },
            { incidentId: "i3" },
          ],
        }),
      );

    await postFilteredList(req);

    expect(postSpy().mock.calls[0]?.[0]).toBe(
      "/api/incident-owner-user/get-list?skip=0&limit=1000",
    );
    expect(queryOf(0)).toEqual({
      userId: { _type: "Includes", value: ["u1"] },
    });
    expect(postSpy().mock.calls[1]?.[0]).toBe(
      "/api/incident-owner-team/get-list?skip=0&limit=1000",
    );
    expect(queryOf(1)).toEqual({
      teamId: { _type: "Includes", value: ["t1"] },
    });
    expect(postSpy().mock.calls[0]?.[2]).toEqual({
      headers: { tenantid: "project-1" },
    });
    expect(req.post).toHaveBeenCalledTimes(2);
    expect(req.post.mock.calls[1]?.[0]).toEqual({
      title: "x",
      _id: { _type: "Includes", value: ["i1", "i2", "i3"] },
    });
  });

  test("a server older than OwnedBy, owners holding nothing: an empty page", async () => {
    const req: FilteredListRequest & { post: jest.Mock } = request({
      filters: filters({ ownerUserIds: ["u1"] }),
      owners: { userIds: ["u1"], teamIds: [] },
    });
    req.post.mockImplementationOnce(async () => {
      throw badRequest();
    });
    postSpy().mockResolvedValueOnce(ok({ data: [] }));
    const response: AxiosResponse = await postFilteredList(req);
    expect(response.data).toEqual({ data: [], count: 0, skip: 0, limit: 100 });
    expect(req.post).toHaveBeenCalledTimes(1);
    // Only the people's table: no teams were named.
    expect(postSpy()).toHaveBeenCalledTimes(1);
  });

  test("an error that is not a refusal is not retried", async () => {
    const req: FilteredListRequest & { post: jest.Mock } = request({
      filters: filters({ ownedByMe: true }),
      owners: { userIds: ["me"], teamIds: [] },
    });
    const failure: Error = Object.assign(new Error("offline"), {
      isAxiosError: true,
      response: { status: 503 },
    });
    req.post.mockImplementationOnce(async () => {
      throw failure;
    });
    await expect(postFilteredList(req)).rejects.toBe(failure);
    expect(postSpy()).not.toHaveBeenCalled();
  });

  test("an incident's monitors: the matching ids first, so rows keep every monitor", async () => {
    const req: FilteredListRequest & { post: jest.Mock } = request({
      filters: filters({ monitorIds: ["m1"] }),
    });
    postSpy().mockResolvedValueOnce(
      ok({ data: [{ _id: "i1" }, { _id: "i2" }] }),
    );
    await postFilteredList(req);
    expect(postSpy().mock.calls[0]?.[0]).toBe(
      "/api/incident/get-list?skip=0&limit=1000",
    );
    expect(queryOf(0)).toEqual({
      monitors: { _type: "Includes", value: ["m1"] },
    });
    expect(bodyOf(0)["select"]).toEqual({ _id: true });
    expect(req.post.mock.calls[0]?.[0]).toEqual({
      _id: { _type: "Includes", value: ["i1", "i2"] },
    });
  });

  test("an incident's monitors with no incidents: an empty page without asking for the list", async () => {
    const req: FilteredListRequest & { post: jest.Mock } = request({
      filters: filters({ monitorIds: ["m1"] }),
    });
    postSpy().mockResolvedValueOnce(ok({ data: [] }));
    const response: AxiosResponse = await postFilteredList(req);
    expect(response.data.data).toEqual([]);
    expect(req.post).not.toHaveBeenCalled();
  });

  test("monitors and owners on an old server: only the incidents both match", async () => {
    const req: FilteredListRequest & { post: jest.Mock } = request({
      filters: filters({ monitorIds: ["m1"], ownedByMe: true }),
      owners: { userIds: ["me"], teamIds: [] },
    });
    postSpy()
      .mockResolvedValueOnce(ok({ data: [{ _id: "i1" }, { _id: "i2" }] }))
      .mockResolvedValueOnce(
        ok({ data: [{ incidentId: "i2" }, { incidentId: "i9" }] }),
      );
    req.post
      .mockImplementationOnce(async () => {
        throw badRequest();
      })
      .mockImplementationOnce(async (query: unknown) => {
        return ok({ data: [{ query: query }] });
      });
    await postFilteredList(req);
    expect(req.post.mock.calls[1]?.[0]).toEqual({
      _id: { _type: "Includes", value: ["i2"] },
    });
  });
});

describe("the list fetchers", () => {
  test("fetchIncidents without filters posts exactly as before", async () => {
    postSpy().mockResolvedValueOnce(ok({ data: [], count: 0 }));
    await fetchIncidents("project-1", { skip: 0, limit: 100 });
    expect(postSpy()).toHaveBeenCalledTimes(1);
    expect(queryOf(0)).toEqual({});
  });

  test("fetchIncidents with filters asks the server for them", async () => {
    postSpy().mockResolvedValueOnce(ok({ data: [], count: 0 }));
    await fetchIncidents("project-1", {
      skip: 0,
      limit: 100,
      filter: {
        filters: filters({ severityIds: ["sev"] }),
        owners: { userIds: ["me"], teamIds: [] },
      },
    });
    expect(postSpy().mock.calls[0]?.[0]).toBe(
      "/api/incident/get-list?skip=0&limit=100",
    );
    expect(queryOf(0)).toEqual({
      incidentSeverityId: { _type: "Includes", value: ["sev"] },
      owners: {
        _type: "OwnedBy",
        match: "AnyOf",
        userIds: ["me"],
        teamIds: [],
      },
    });
    expect(postSpy().mock.calls[0]?.[2]).toEqual({
      headers: { tenantid: "project-1" },
    });
  });

  test("fetchMonitors keeps archived monitors out when it filters", async () => {
    postSpy().mockResolvedValueOnce(ok({ data: [], count: 0 }));
    await fetchMonitors("project-1", {
      limit: 100,
      filter: { filters: filters({ stateIds: ["offline"] }), owners: null },
    });
    expect(queryOf(0)).toEqual({
      isArchived: false,
      currentMonitorStatusId: { _type: "Includes", value: ["offline"] },
    });
  });

  test("fetchMonitors on an old server: an older select first, then the owner tables", async () => {
    postSpy()
      // New select with owners: refused.
      .mockRejectedValueOnce(badRequest())
      // Legacy select with owners: refused too.
      .mockRejectedValueOnce(badRequest())
      // The owner table.
      .mockResolvedValueOnce(ok({ data: [{ monitorId: "m1" }] }))
      // The monitors by id.
      .mockResolvedValueOnce(ok({ data: [{ _id: "m1" }], count: 1 }));
    const result: { data: Array<unknown> } = await fetchMonitors("project-1", {
      limit: 100,
      filter: {
        filters: filters({ ownerUserIds: ["u1"] }),
        owners: { userIds: ["u1"], teamIds: [] },
      },
    });
    expect(result.data).toEqual([{ _id: "m1" }]);
    expect(postSpy().mock.calls[2]?.[0]).toBe(
      "/api/monitor-owner-user/get-list?skip=0&limit=1000",
    );
    expect(queryOf(3)).toEqual({
      isArchived: false,
      _id: { _type: "Includes", value: ["m1"] },
    });
  });
});

describe("the sheet's values", () => {
  test("severities, most severe first, for the record's own kind", async () => {
    postSpy().mockResolvedValueOnce(
      ok({
        data: [
          {
            _id: "s1",
            name: "Critical",
            color: { r: 255, g: 0, b: 0 },
            order: 1,
          },
          { _id: { _type: "ObjectID", value: "s2" }, name: "Minor", order: 2 },
          { _id: "", name: "No id" },
        ],
      }),
    );
    const severities: Array<SeverityOptionItem> = await fetchSeverities(
      "project-1",
      "alert",
    );
    expect(postSpy().mock.calls[0]?.[0]).toBe(
      "/api/alert-severity/get-list?skip=0&limit=50",
    );
    expect(bodyOf(0)["sort"]).toEqual({ order: "ASC" });
    expect(
      severities.map((s: SeverityOptionItem) => {
        return s._id;
      }),
    ).toEqual(["s1", "s2"]);
    expect(severities[0]?.order).toBe(1);
  });

  test("labels, teams and monitors are read for the selected project", async () => {
    postSpy()
      .mockResolvedValueOnce(ok({ data: [{ _id: "l1", name: "payments" }] }))
      .mockResolvedValueOnce(ok({ data: [{ _id: "t1", name: "Platform" }] }))
      .mockResolvedValueOnce(
        ok({ data: [{ _id: "m1", name: "API", monitorType: "Website" }] }),
      );
    expect(
      (await fetchLabels("p")).map((l: LabelOptionItem) => {
        return l.name;
      }),
    ).toEqual(["payments"]);
    expect(
      (await fetchTeams("p")).map((t: TeamOptionItem) => {
        return t.name;
      }),
    ).toEqual(["Platform"]);
    expect(await fetchMonitorOptions("p")).toEqual([
      { _id: "m1", name: "API", monitorType: "Website" },
    ]);
    expect(
      postSpy().mock.calls.map((call: Array<unknown>) => {
        return call[0];
      }),
    ).toEqual([
      "/api/label/get-list?skip=0&limit=500",
      "/api/team/get-list?skip=0&limit=500",
      "/api/monitor/get-list?skip=0&limit=1000",
    ]);
    // Archived monitors are offered nowhere in the app.
    expect(queryOf(2)).toEqual({ isArchived: false });
    postSpy().mock.calls.forEach((call: Array<unknown>) => {
      expect(call[2]).toEqual({ headers: { tenantid: "p" } });
    });
  });

  test("the reader's teams: accepted memberships of this user only", async () => {
    postSpy().mockResolvedValueOnce(
      ok({
        data: [
          { teamId: "t1" },
          { teamId: { _type: "ObjectID", value: "t2" } },
          { teamId: "t1" },
        ],
      }),
    );
    expect(await fetchMyTeamIds("p", "me")).toEqual(["t1", "t2"]);
    expect(queryOf(0)).toEqual({ userId: "me", hasAcceptedInvitation: true });
  });

  test("owned record ids read both owner tables only when both are named", async () => {
    postSpy().mockResolvedValueOnce(ok({ data: [{ alertId: "a1" }] }));
    expect(
      await fetchOwnedRecordIds("p", "alerts", { userIds: [], teamIds: ["t"] }),
    ).toEqual(["a1"]);
    expect(postSpy()).toHaveBeenCalledTimes(1);
    expect(postSpy().mock.calls[0]?.[0]).toBe(
      "/api/alert-owner-team/get-list?skip=0&limit=1000",
    );
    expect(bodyOf(0)["select"]).toEqual({ _id: true, alertId: true });
  });
});
