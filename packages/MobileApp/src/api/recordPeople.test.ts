import type { AxiosResponse } from "axios";
import { beforeEach, describe, expect, test } from "@jest/globals";
import apiClient from "./client";
import { fetchRecordLabels, fetchRecordOwners } from "./recordPeople";

jest.mock("./client", () => {
  return {
    __esModule: true,
    default: { post: jest.fn() },
  };
});

/*
 * A record's owners and labels, as its detail screen reads them: from the
 * owner tables beside the record (one for people, one for teams), and the
 * record's own labels - each in the record's project.
 */

function postSpy(): jest.Mock {
  return apiClient.post as unknown as jest.Mock;
}

function ok(data: unknown): AxiosResponse {
  return { data: data } as AxiosResponse;
}

beforeEach(() => {
  postSpy().mockReset();
});

describe("fetchRecordOwners", () => {
  test("reads the record's people and teams from its owner tables", async () => {
    postSpy()
      .mockResolvedValueOnce(
        ok({
          data: [
            {
              user: {
                _id: "u1",
                name: "Priya Shah",
                email: "priya@example.test",
              },
            },
            {
              user: {
                _id: { _type: "ObjectID", value: "u2" },
                name: "",
                email: "sam@example.test",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        ok({ data: [{ team: { _id: "t1", name: "Platform" } }] }),
      );

    const owners: Awaited<ReturnType<typeof fetchRecordOwners>> =
      await fetchRecordOwners("project-1", "incidents", "incident-9");

    expect(postSpy().mock.calls[0]?.[0]).toBe(
      "/api/incident-owner-user/get-list?skip=0&limit=100",
    );
    expect(postSpy().mock.calls[0]?.[1]).toEqual({
      query: { incidentId: "incident-9" },
      select: { _id: true, user: { _id: true, name: true, email: true } },
      sort: { createdAt: "ASC" },
    });
    expect(postSpy().mock.calls[1]?.[0]).toBe(
      "/api/incident-owner-team/get-list?skip=0&limit=100",
    );
    expect(postSpy().mock.calls[1]?.[1]).toMatchObject({
      query: { incidentId: "incident-9" },
      select: { _id: true, team: { _id: true, name: true } },
    });
    postSpy().mock.calls.forEach((call: Array<unknown>): void => {
      expect(call[2]).toEqual({ headers: { tenantid: "project-1" } });
    });
    expect(owners).toEqual([
      {
        kind: "user",
        id: "u1",
        name: "Priya Shah",
        email: "priya@example.test",
      },
      // A person who set no name is shown by their email.
      {
        kind: "user",
        id: "u2",
        name: "sam@example.test",
        email: "sam@example.test",
      },
      { kind: "team", id: "t1", name: "Platform" },
    ]);
  });

  test("each kind of record reads its own owner tables", async () => {
    postSpy().mockResolvedValue(ok({ data: [] }));
    await fetchRecordOwners("p", "monitors", "m1");
    await fetchRecordOwners("p", "alertEpisodes", "e1");
    expect(
      postSpy().mock.calls.map((call: Array<unknown>) => {
        return call[0];
      }),
    ).toEqual([
      "/api/monitor-owner-user/get-list?skip=0&limit=100",
      "/api/monitor-owner-team/get-list?skip=0&limit=100",
      "/api/alert-episode-owner-user/get-list?skip=0&limit=100",
      "/api/alert-episode-owner-team/get-list?skip=0&limit=100",
    ]);
    expect((postSpy().mock.calls[2]?.[1] as { query: unknown }).query).toEqual({
      alertEpisodeId: "e1",
    });
  });

  test("nobody twice, and rows without a person or a team are left out", async () => {
    postSpy()
      .mockResolvedValueOnce(
        ok({
          data: [
            { user: { _id: "u1", name: "Priya" } },
            { user: { _id: "u1", name: "Priya" } },
            { user: null },
            "junk",
          ],
        }),
      )
      .mockResolvedValueOnce(ok({ data: "not a list" }));
    expect(await fetchRecordOwners("p", "alerts", "a1")).toEqual([
      { kind: "user", id: "u1", name: "Priya", email: undefined },
    ]);
  });
});

describe("fetchRecordLabels", () => {
  test("reads the record's labels, by name", async () => {
    postSpy().mockResolvedValueOnce(
      ok({
        data: [
          {
            _id: "i1",
            labels: [
              { _id: "l2", name: "payments", color: { r: 1, g: 2, b: 3 } },
              { _id: "l1", name: "checkout", color: "#ff0000" },
              { _id: "", name: "no id" },
            ],
          },
        ],
      }),
    );
    const labels: Awaited<ReturnType<typeof fetchRecordLabels>> =
      await fetchRecordLabels("project-1", "alerts", "a1");
    expect(postSpy().mock.calls[0]?.[0]).toBe(
      "/api/alert/get-list?skip=0&limit=1",
    );
    expect(postSpy().mock.calls[0]?.[1]).toEqual({
      query: { _id: "a1" },
      select: { _id: true, labels: { _id: true, name: true, color: true } },
      sort: {},
    });
    expect(
      labels.map((label: { name: string }) => {
        return label.name;
      }),
    ).toEqual(["checkout", "payments"]);
  });

  test("a record with no labels, or that is gone, has none", async () => {
    postSpy()
      .mockResolvedValueOnce(ok({ data: [{ _id: "i1" }] }))
      .mockResolvedValueOnce(ok({ data: [] }));
    expect(await fetchRecordLabels("p", "incidents", "i1")).toEqual([]);
    expect(await fetchRecordLabels("p", "incidents", "gone")).toEqual([]);
  });
});
