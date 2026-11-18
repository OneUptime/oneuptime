import apiClient from "./client";
import {
  createOnCallOverride,
  deleteOnCallOverride,
  endOnCallOverrideNow,
  fetchCoverPolicies,
  fetchOnCallOverrides,
  fetchOverlappingOverrides,
  fetchOverrideAddAccess,
  toOverrideAddAccess,
  toOverrideUpdateData,
  updateOnCallOverride,
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
      put: jest.fn(async () => {
        return { data: {} };
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

function putSpy(): jest.SpyInstance {
  return apiClient.put as unknown as jest.SpyInstance;
}

// As axios rejects a request the server answered with `status`.
function answered(status: number): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status: status, data: { message: "Not found" } },
  });
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

  /*
   * #7897: an edit and a conflict are of one scope - global, or that
   * policy - whether or not the person may read the policy's name.
   */
  test("reads each override's policy by id, a global one's as none", async () => {
    postSpy().mockResolvedValue({
      data: {
        data: [
          {
            _id: "override-1",
            startsAt: "2026-03-03T12:00:00.000Z",
            endsAt: "2026-03-03T16:00:00.000Z",
            onCallDutyPolicyId: "policy-7",
          },
          {
            _id: "override-2",
            startsAt: "2026-03-03T12:00:00.000Z",
            endsAt: "2026-03-03T16:00:00.000Z",
          },
        ],
      },
    } as never);

    const overrides: OnCallOverrideItem[] = await fetchOnCallOverrides(PROJECT);

    expect(overrides[0]?.onCallDutyPolicyId).toBe("policy-7");
    // Its name unread: the card says nothing of it, the scope is still known.
    expect(overrides[0]?.onCallDutyPolicy).toBeNull();
    expect(overrides[1]?.onCallDutyPolicyId).toBeNull();
    expect(
      (lastPost()[1] as { select: Record<string, unknown> }).select[
        "onCallDutyPolicyId"
      ],
    ).toBe(true);
  });
});

/*
 * EDITING AN OVERRIDE (#7897): only what changes is sent, under the
 * server's field names, to the override's own PUT, in its project. Who is
 * away and its policy are never sent: they never change.
 */
describe("updateOnCallOverride", () => {
  beforeEach(() => {
    putSpy().mockClear();
    putSpy().mockResolvedValue({ data: {} } as never);
  });

  test("sends who covers and the times it changes, in ISO, to the override's PUT, in its project", async () => {
    await updateOnCallOverride("project-1", "override-1", {
      routeAlertsToUserId: "user-pat",
      startsAt: new Date("2026-03-03T12:00:00.000Z"),
      endsAt: new Date("2026-03-03T18:00:00.000Z"),
    });

    expect(putSpy()).toHaveBeenCalledWith(
      "/api/on-call-duty-policy-user-override/override-1",
      {
        data: {
          routeAlertsToUserId: "user-pat",
          startsAt: "2026-03-03T12:00:00.000Z",
          endsAt: "2026-03-03T18:00:00.000Z",
        },
      },
      { headers: { tenantid: "project-1" } },
    );
  });

  test("the rotation covering is sent as null, not left out, so the saved cover is cleared", () => {
    expect(toOverrideUpdateData({ routeAlertsToUserId: null })).toEqual({
      routeAlertsToUserId: null,
    });
  });

  test("what does not change is not sent, and who is away never is", () => {
    const data: Record<string, unknown> = toOverrideUpdateData({
      endsAt: new Date("2026-03-03T18:00:00.000Z"),
    });

    expect(data).toEqual({ endsAt: "2026-03-03T18:00:00.000Z" });
    expect(data).not.toHaveProperty("overrideUserId");
    expect(data).not.toHaveProperty("onCallDutyPolicyId");
    expect(data).not.toHaveProperty("startsAt");
  });
});

/*
 * END NOW: the server ends the override at its own now, so a phone whose
 * clock is a minute out still ends it. A server older than End Now answers
 * 404, and is sent the end the phone works out instead.
 */
describe("endOnCallOverrideNow", () => {
  beforeEach(() => {
    postSpy().mockReset();
    postSpy().mockResolvedValue({ data: {} } as never);
    putSpy().mockClear();
    putSpy().mockResolvedValue({ data: {} } as never);
  });

  test("asks the server to end it, in its project, sending no time of the phone's", async () => {
    await endOnCallOverrideNow(
      "project-1",
      "override-1",
      new Date("2026-03-03T12:00:00.000Z"),
    );

    expect(postSpy()).toHaveBeenCalledWith(
      "/api/on-call-duty-policy-user-override/override-1/end-now",
      {},
      { headers: { tenantid: "project-1" } },
    );
    expect(putSpy()).not.toHaveBeenCalled();
  });

  test("a server older than End Now (404) is sent the phone's end as an edit", async () => {
    postSpy().mockRejectedValueOnce(answered(404) as never);

    await endOnCallOverrideNow(
      "project-1",
      "override-1",
      new Date("2026-03-03T12:00:00.000Z"),
    );

    expect(putSpy()).toHaveBeenCalledWith(
      "/api/on-call-duty-policy-user-override/override-1",
      { data: { endsAt: "2026-03-03T12:00:00.000Z" } },
      { headers: { tenantid: "project-1" } },
    );
  });

  test("any other refusal is the caller's, and nothing else is sent", async () => {
    postSpy().mockRejectedValueOnce(answered(400) as never);

    await expect(
      endOnCallOverrideNow(
        "project-1",
        "override-1",
        new Date("2026-03-03T12:00:00.000Z"),
      ),
    ).rejects.toThrow("Request failed with status code 400");
    expect(putSpy()).not.toHaveBeenCalled();
  });

  test("an older server with no end to send is refused as it answered", async () => {
    postSpy().mockRejectedValueOnce(answered(404) as never);

    await expect(
      endOnCallOverrideNow("project-1", "override-1", null),
    ).rejects.toThrow("Request failed with status code 404");
    expect(putSpy()).not.toHaveBeenCalled();
  });
});

/*
 * The overrides a refusal for an overlap may be about: the person's, in
 * every scope, sharing a moment with the times sent - back to back is no
 * overlap - read in the project, as the dashboard's check reads them.
 */
describe("fetchOverlappingOverrides", () => {
  beforeEach(() => {
    postSpy().mockReset();
  });

  test("asks for the person's overrides that start before the end and end after the start", async () => {
    postSpy().mockResolvedValue({
      data: {
        data: [
          {
            _id: "override-9",
            startsAt: "2026-03-03T13:00:00.000Z",
            endsAt: "2026-03-03T15:00:00.000Z",
            overrideUser: { _id: "user-me", name: "Ada" },
            onCallDutyPolicyId: "policy-7",
          },
        ],
      },
    } as never);

    const overrides: OnCallOverrideItem[] = await fetchOverlappingOverrides(
      PROJECT,
      {
        overrideUserId: "user-me",
        startsAt: new Date("2026-03-03T12:00:00.000Z"),
        endsAt: new Date("2026-03-03T16:00:00.000Z"),
      },
    );

    const [url, body, config] = lastPost() as [
      string,
      { query: Record<string, unknown> },
      { headers: Record<string, string> },
    ];

    expect(url).toBe(
      "/api/on-call-duty-policy-user-override/get-list?skip=0&limit=50",
    );
    expect(body.query).toEqual({
      overrideUserId: "user-me",
      startsAt: { _type: "LessThan", value: "2026-03-03T16:00:00.000Z" },
      endsAt: { _type: "GreaterThan", value: "2026-03-03T12:00:00.000Z" },
    });
    expect(config.headers).toEqual({ tenantid: "project-1" });
    expect(overrides).toHaveLength(1);
    expect(overrides[0]?._id).toBe("override-9");
    expect(overrides[0]?.onCallDutyPolicyId).toBe("policy-7");
  });
});

/*
 * Where someone whose permission covers only some policies may arrange
 * cover: the server's answer, asked about the policies the sheet would
 * reach, in the project they belong to. A server older than the question
 * answers 404, and the sheet keeps its lock there.
 */
describe("fetchOverrideAddAccess", () => {
  beforeEach(() => {
    postSpy().mockReset();
  });

  test("asks about the policies, in the project, and reads the answer", async () => {
    postSpy().mockResolvedValue({
      data: { global: false, onCallDutyPolicyIds: ["policy-1"] },
    } as never);

    await expect(
      fetchOverrideAddAccess("project-1", ["policy-1", "policy-2"]),
    ).resolves.toEqual({ global: false, onCallDutyPolicyIds: ["policy-1"] });

    expect(lastPost()).toEqual([
      "/api/on-call-duty-policy-user-override/add-access",
      { onCallDutyPolicyIds: ["policy-1", "policy-2"] },
      { headers: { tenantid: "project-1" } },
    ]);
  });

  test("a server older than the question (404) answers nothing", async () => {
    postSpy().mockRejectedValue({
      isAxiosError: true,
      response: { status: 404 },
    } as never);

    await expect(
      fetchOverrideAddAccess("project-1", ["policy-1"]),
    ).resolves.toBeNull();
  });

  test("any other failure is the caller's to handle", async () => {
    const refusal: unknown = {
      isAxiosError: true,
      response: { status: 500 },
    };
    postSpy().mockRejectedValue(refusal as never);

    await expect(
      fetchOverrideAddAccess("project-1", ["policy-1"]),
    ).rejects.toBe(refusal);
  });
});

describe("toOverrideAddAccess", () => {
  test("grants nothing it does not plainly say", () => {
    expect(toOverrideAddAccess(undefined)).toEqual({
      global: false,
      onCallDutyPolicyIds: [],
    });
    expect(toOverrideAddAccess(["policy-1"])).toEqual({
      global: false,
      onCallDutyPolicyIds: [],
    });
    expect(
      toOverrideAddAccess({ global: "true", onCallDutyPolicyIds: "policy-1" }),
    ).toEqual({ global: false, onCallDutyPolicyIds: [] });
    expect(
      toOverrideAddAccess({
        global: true,
        onCallDutyPolicyIds: ["policy-1", "", 3, null],
      }),
    ).toEqual({ global: true, onCallDutyPolicyIds: ["policy-1"] });
  });
});

describe("fetchCoverPolicies", () => {
  beforeEach(() => {
    postSpy().mockReset();
  });

  test("lists the project's policies by name, in the project", async () => {
    postSpy().mockResolvedValue({
      data: {
        data: [
          { _id: "policy-1", name: "Payments" },
          { _id: "policy-2" },
          { name: "No id" },
          null,
        ],
      },
    } as never);

    await expect(fetchCoverPolicies("project-1")).resolves.toEqual([
      { policyId: "policy-1", policyName: "Payments" },
      { policyId: "policy-2", policyName: "policy-2" },
    ]);

    const [url, body, config] = lastPost() as [string, unknown, unknown];

    expect(url).toBe("/api/on-call-duty-policy/get-list?skip=0&limit=100");
    expect(body).toEqual({
      query: {},
      select: { _id: true, name: true },
      sort: { name: "ASC" },
    });
    expect(config).toEqual({ headers: { tenantid: "project-1" } });
  });
});
