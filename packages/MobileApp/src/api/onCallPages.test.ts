import apiClient from "./client";
import { fetchMyOnCallPages, toOnCallPageItem } from "./onCallPages";
import { describe, expect, test, beforeEach } from "@jest/globals";
import type { OnCallPageItem } from "./types";

jest.mock("./client", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(async () => {
        return { data: { data: [] } };
      }),
    },
  };
});

function postSpy(): jest.SpyInstance {
  return apiClient.post as unknown as jest.SpyInstance;
}

const PROJECT: { projectId: string; projectName: string } = {
  projectId: "project-1",
  projectName: "Acme",
};

/*
 * The notification log is scoped to the signed-in user BY THE SERVER: the
 * model grants read through the auto-granted CurrentUser permission, which is
 * converted into a userId filter. The request therefore must not (and cannot)
 * carry a user id of its own - a test that asserts one would be locking in a
 * misunderstanding of where the scoping happens.
 */

describe("fetchMyOnCallPages", () => {
  beforeEach(() => {
    postSpy().mockClear();
    postSpy().mockResolvedValue({ data: { data: [] } } as never);
  });

  test("sends an empty query and lets the tenant header scope it", async () => {
    await fetchMyOnCallPages(PROJECT);

    const calls: Array<Array<unknown>> = postSpy().mock.calls;
    const [url, body, config] = calls[calls.length - 1]! as [
      string,
      { query: Record<string, unknown>; sort: Record<string, unknown> },
      { headers: Record<string, string> },
    ];

    expect(url).toContain("/api/user-notification-log/get-list");
    expect(body.query).toEqual({});
    expect(body.sort).toEqual({ createdAt: "DESC" });
    expect(config.headers["tenantid"]).toBe("project-1");
  });

  test("parses an acknowledged page with its incident", async () => {
    postSpy().mockResolvedValue({
      data: {
        data: [
          {
            _id: "log-1",
            createdAt: "2026-03-03T12:00:00.000Z",
            status: "Completed",
            acknowledgedAt: "2026-03-03T12:04:00.000Z",
            onCallDutyPolicy: { _id: "policy-1", name: "Database" },
            triggeredByIncident: { _id: "incident-9", title: "Replica lag" },
          },
        ],
      },
    } as never);

    const pages: OnCallPageItem[] = await fetchMyOnCallPages(PROJECT);

    expect(pages[0]).toMatchObject({
      _id: "log-1",
      projectId: "project-1",
      projectName: "Acme",
      status: "Completed",
      acknowledgedAt: "2026-03-03T12:04:00.000Z",
      policyName: "Database",
      triggeredByIncident: { _id: "incident-9", title: "Replica lag" },
    });
  });

  test("an unacknowledged page carries a null, which is what the filter reads", async () => {
    postSpy().mockResolvedValue({
      data: {
        data: [
          {
            _id: "log-1",
            createdAt: "2026-03-03T12:00:00.000Z",
            status: "Completed",
            triggeredByAlert: { _id: "alert-3", title: "Disk full" },
          },
        ],
      },
    } as never);

    const pages: OnCallPageItem[] = await fetchMyOnCallPages(PROJECT);

    expect(pages[0]?.acknowledgedAt).toBeNull();
  });

  test("drops rows with no id", async () => {
    postSpy().mockResolvedValue({
      data: { data: [{ createdAt: "2026-03-03T12:00:00.000Z" }] },
    } as never);

    await expect(fetchMyOnCallPages(PROJECT)).resolves.toEqual([]);
  });
});

describe("toOnCallPageItem", () => {
  test("keeps each of the four trigger kinds separate", () => {
    const episode: OnCallPageItem | null = toOnCallPageItem(
      {
        _id: "log-1",
        createdAt: "2026-03-03T12:00:00.000Z",
        triggeredByAlertEpisode: { _id: "episode-2", title: "Flapping" },
      },
      PROJECT,
    );

    expect(episode?.triggeredByAlertEpisode).toEqual({
      _id: "episode-2",
      title: "Flapping",
    });
    expect(episode?.triggeredByAlert).toBeNull();
    expect(episode?.triggeredByIncident).toBeNull();
    expect(episode?.triggeredByIncidentEpisode).toBeNull();
  });

  test("a trigger whose resource was deleted collapses to null", () => {
    /*
     * The join comes back as an empty object when the resource is gone. Keeping
     * it would render a card titled after a resource that no longer exists and
     * a chevron that navigates nowhere.
     */
    const page: OnCallPageItem | null = toOnCallPageItem(
      {
        _id: "log-1",
        createdAt: "2026-03-03T12:00:00.000Z",
        triggeredByIncident: {},
      },
      PROJECT,
    );

    expect(page?.triggeredByIncident).toBeNull();
  });

  test("rejects non-objects", () => {
    expect(toOnCallPageItem(null, PROJECT)).toBeNull();
    expect(toOnCallPageItem(42, PROJECT)).toBeNull();
  });
});
