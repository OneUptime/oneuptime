import apiClient from "./client";
import {
  createOnCallOverride,
  deleteOnCallOverride,
  fetchOnCallOverrides,
} from "./onCallOverrides";
import { describe, expect, test, beforeEach } from "@jest/globals";
import type { OnCallOverrideItem } from "./types";

jest.mock("./client", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(async () => {
        return { data: { data: [] } };
      }),
      delete: jest.fn(async () => {
        return { data: {} };
      }),
    },
  };
});

function postSpy(): jest.SpyInstance {
  return apiClient.post as unknown as jest.SpyInstance;
}

function deleteSpy(): jest.SpyInstance {
  return apiClient.delete as unknown as jest.SpyInstance;
}

function lastPost(): Array<unknown> {
  const calls: Array<Array<unknown>> = postSpy().mock.calls;
  return calls[calls.length - 1]!;
}

const PROJECT: { projectId: string; projectName: string } = {
  projectId: "project-1",
  projectName: "Acme",
};

/*
 * Overrides are the only write in the on-call feature, and the request shape
 * is not forgiving: the server validates start-before-end and refuses equal
 * users, and it reads ids from `overrideUserId` / `routeAlertsToUserId`
 * exactly. A body that carries the right people under the wrong keys is a
 * silent no-op that leaves somebody uncovered.
 */

describe("createOnCallOverride", () => {
  beforeEach(() => {
    postSpy().mockClear();
    postSpy().mockResolvedValue({ data: {} } as never);
  });

  test("sends both user ids and an ISO window under the server's field names", async () => {
    const startsAt: Date = new Date("2026-03-03T12:00:00.000Z");
    const endsAt: Date = new Date("2026-03-03T16:00:00.000Z");

    await createOnCallOverride({
      projectId: "project-1",
      overrideUserId: "user-me",
      routeAlertsToUserId: "user-teammate",
      startsAt,
      endsAt,
    });

    const [url, body, config] = lastPost() as [
      string,
      { data: Record<string, unknown> },
      { headers: Record<string, string> },
    ];

    expect(url).toBe("/api/on-call-duty-policy-user-override");
    expect(body.data).toEqual({
      projectId: "project-1",
      overrideUserId: "user-me",
      routeAlertsToUserId: "user-teammate",
      startsAt: "2026-03-03T12:00:00.000Z",
      endsAt: "2026-03-03T16:00:00.000Z",
    });
    expect(config.headers["tenantid"]).toBe("project-1");
  });

  test("omits the policy id entirely for a project-wide override", async () => {
    /*
     * A project-wide override is one with NO onCallDutyPolicyId. Sending the
     * key as undefined/null would scope the record to "the policy called
     * null", which covers nothing.
     */
    await createOnCallOverride({
      projectId: "project-1",
      overrideUserId: "user-me",
      routeAlertsToUserId: "user-teammate",
      startsAt: new Date("2026-03-03T12:00:00.000Z"),
      endsAt: new Date("2026-03-03T16:00:00.000Z"),
    });

    const body: { data: Record<string, unknown> } = lastPost()[1] as {
      data: Record<string, unknown>;
    };

    expect("onCallDutyPolicyId" in body.data).toBe(false);
  });

  test("includes the policy id when the override is scoped to one", async () => {
    await createOnCallOverride({
      projectId: "project-1",
      overrideUserId: "user-me",
      routeAlertsToUserId: "user-teammate",
      startsAt: new Date("2026-03-03T12:00:00.000Z"),
      endsAt: new Date("2026-03-03T16:00:00.000Z"),
      onCallDutyPolicyId: "policy-7",
    });

    const body: { data: Record<string, unknown> } = lastPost()[1] as {
      data: Record<string, unknown>;
    };

    expect(body.data["onCallDutyPolicyId"]).toBe("policy-7");
  });
});

describe("deleteOnCallOverride", () => {
  beforeEach(() => {
    deleteSpy().mockClear();
    deleteSpy().mockResolvedValue({ data: {} } as never);
  });

  test("deletes by id under the project's tenant", async () => {
    await deleteOnCallOverride("project-1", "override-9");

    const calls: Array<Array<unknown>> = deleteSpy().mock.calls;
    const [url, config] = calls[calls.length - 1]! as [
      string,
      { headers: Record<string, string> },
    ];

    expect(url).toBe("/api/on-call-duty-policy-user-override/override-9");
    expect(config.headers["tenantid"]).toBe("project-1");
  });
});

describe("fetchOnCallOverrides", () => {
  beforeEach(() => {
    postSpy().mockClear();
  });

  test("stamps the project onto every row so a merged list stays attributable", async () => {
    postSpy().mockResolvedValue({
      data: {
        data: [
          {
            _id: "override-1",
            createdAt: "2026-03-01T00:00:00.000Z",
            startsAt: "2026-03-03T12:00:00.000Z",
            endsAt: "2026-03-03T16:00:00.000Z",
            overrideUser: {
              _id: "user-me",
              name: { _type: "Name", value: "Ada" },
            },
            routeAlertsToUser: {
              _id: "user-teammate",
              name: { _type: "Name", value: "Priya" },
            },
          },
        ],
      },
    } as never);

    const overrides: OnCallOverrideItem[] = await fetchOnCallOverrides(PROJECT);

    expect(overrides[0]?.projectId).toBe("project-1");
    expect(overrides[0]?.projectName).toBe("Acme");
    expect(overrides[0]?.overrideUser?.name).toBe("Ada");
    expect(overrides[0]?.routeAlertsToUser?.name).toBe("Priya");
  });

  test("a project-wide override parses with a null policy", async () => {
    postSpy().mockResolvedValue({
      data: {
        data: [
          {
            _id: "override-1",
            createdAt: "2026-03-01T00:00:00.000Z",
            startsAt: "2026-03-03T12:00:00.000Z",
            endsAt: "2026-03-03T16:00:00.000Z",
          },
        ],
      },
    } as never);

    const overrides: OnCallOverrideItem[] = await fetchOnCallOverrides(PROJECT);

    expect(overrides[0]?.onCallDutyPolicy).toBeNull();
  });

  test("a policy-scoped override keeps the policy name for the card", async () => {
    postSpy().mockResolvedValue({
      data: {
        data: [
          {
            _id: "override-1",
            createdAt: "2026-03-01T00:00:00.000Z",
            startsAt: "2026-03-03T12:00:00.000Z",
            endsAt: "2026-03-03T16:00:00.000Z",
            onCallDutyPolicy: { _id: "policy-7", name: "Database" },
          },
        ],
      },
    } as never);

    const overrides: OnCallOverrideItem[] = await fetchOnCallOverrides(PROJECT);

    expect(overrides[0]?.onCallDutyPolicy).toEqual({
      _id: "policy-7",
      name: "Database",
    });
  });

  test("drops rows with no id", async () => {
    postSpy().mockResolvedValue({
      data: { data: [{ startsAt: "2026-03-03T12:00:00.000Z" }] },
    } as never);

    await expect(fetchOnCallOverrides(PROJECT)).resolves.toEqual([]);
  });
});
