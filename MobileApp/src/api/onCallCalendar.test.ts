import apiClient from "./client";
import {
  fetchMyShifts,
  fetchPersonalCalendarFeed,
  fetchScheduleCalendarFeed,
  getHttpStatus,
  isRouteMissingError,
  isServiceUnavailableError,
  ON_CALL_CALENDAR_API_PATH,
  rotatePersonalCalendarFeed,
  setPersonalCalendarFeedEnabled,
  toMyOnCallShift,
  toMyOnCallShiftsResponse,
  toOnCallCalendarFeedStatus,
  USER_ON_CALL_CALENDAR_FEED_API_PATH,
} from "./onCallCalendar";
import { describe, expect, test, beforeEach } from "@jest/globals";
import type {
  MyOnCallShift,
  MyOnCallShiftsResponse,
  OnCallCalendarFeedStatus,
} from "./types";

jest.mock("./client", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(async () => {
        return { data: {} };
      }),
      post: jest.fn(async () => {
        return { data: {} };
      }),
      put: jest.fn(async () => {
        return { data: {} };
      }),
    },
  };
});

function getSpy(): jest.SpyInstance {
  return apiClient.get as unknown as jest.SpyInstance;
}

function postSpy(): jest.SpyInstance {
  return apiClient.post as unknown as jest.SpyInstance;
}

function putSpy(): jest.SpyInstance {
  return apiClient.put as unknown as jest.SpyInstance;
}

function lastCall(spy: jest.SpyInstance): Array<unknown> {
  const calls: Array<Array<unknown>> = spy.mock.calls;
  return calls[calls.length - 1]!;
}

/*
 * The calendar routes are custom endpoints, not CRUD, so the two things a
 * refactor can silently break are the URL (a typo in the prefix 404s, which
 * the app reads as "old server" and HIDES the feature) and the tenant header
 * (feeds are per project; a request without one is answered for the wrong
 * project, or not at all). Both are pinned on every call below.
 */

const FULL_STATUS: Record<string, unknown> = {
  exists: true,
  feedId: "feed-1",
  isEnabled: true,
  needsRegeneration: false,
  tokenHint: "k3Qx",
  rotatedAt: "2026-03-01T10:00:00.000Z",
  previousTokenExpiresAt: null,
  lastFetchedAt: "2026-03-03T10:00:00.000Z",
  lastFetchedClient: "Google Calendar",
  fetchCount: 143,
  lastRenderTruncated: false,
  settings: {
    includeCoveringShifts: true,
    pastDays: 2,
    futureDays: 90,
  },
  urls: {
    https:
      "https://oneuptime.example.com/api/on-call-calendar/user/abc/shifts.ics",
    webcal:
      "webcals://oneuptime.example.com/api/on-call-calendar/user/abc/shifts.ics",
    googleAdd: "https://calendar.google.com/calendar/r?cid=x",
  },
  hostWarning: null,
  protocolWarning: null,
};

describe("fetchPersonalCalendarFeed", () => {
  beforeEach(() => {
    getSpy().mockClear();
    getSpy().mockResolvedValue({ data: FULL_STATUS } as never);
  });

  test("reads the caller's feed for ONE project via the tenant header", async () => {
    await fetchPersonalCalendarFeed("project-1");

    const [url, config]: Array<unknown> = lastCall(getSpy());

    expect(url).toBe(`${ON_CALL_CALENDAR_API_PATH}/feed/current`);
    expect(url).toBe("/api/on-call-calendar/feed/current");
    expect(
      (config as { headers: Record<string, string> }).headers["tenantid"],
    ).toBe("project-1");
  });

  test("hands back the normalised status", async () => {
    const status: OnCallCalendarFeedStatus =
      await fetchPersonalCalendarFeed("project-1");

    expect(status.exists).toBe(true);
    expect(status.feedId).toBe("feed-1");
    expect(status.tokenHint).toBe("k3Qx");
    expect(status.fetchCount).toBe(143);
    expect(status.urls?.https).toContain("/shifts.ics");
    expect(status.settings.includeCoveringShifts).toBe(true);
  });
});

describe("rotatePersonalCalendarFeed", () => {
  beforeEach(() => {
    postSpy().mockClear();
    postSpy().mockResolvedValue({ data: FULL_STATUS } as never);
  });

  test("POSTs an empty JSON object, scoped to the project", async () => {
    /*
     * The body has to be JSON: the server answers 415 to a POST with no
     * content type, and axios only sets one when there is a body.
     */
    await rotatePersonalCalendarFeed("project-2");

    const [url, body, config]: Array<unknown> = lastCall(postSpy());

    expect(url).toBe("/api/on-call-calendar/feed/rotate");
    expect(body).toEqual({});
    expect(
      (config as { headers: Record<string, string> }).headers["tenantid"],
    ).toBe("project-2");
  });

  test("returns the new status straight from the rotate response", async () => {
    const status: OnCallCalendarFeedStatus =
      await rotatePersonalCalendarFeed("project-2");

    expect(status.exists).toBe(true);
    expect(status.tokenHint).toBe("k3Qx");
  });
});

describe("setPersonalCalendarFeedEnabled", () => {
  beforeEach(() => {
    putSpy().mockClear();
    putSpy().mockResolvedValue({ data: {} } as never);
  });

  test("uses the CRUD route with the {data} envelope the server expects", async () => {
    await setPersonalCalendarFeedEnabled("project-1", "feed-1", false);

    const [url, body, config]: Array<unknown> = lastCall(putSpy());

    expect(url).toBe(`${USER_ON_CALL_CALENDAR_FEED_API_PATH}/feed-1`);
    expect(url).toBe("/api/user-on-call-calendar-feed/feed-1");
    expect(body).toEqual({ data: { isEnabled: false } });
    expect(
      (config as { headers: Record<string, string> }).headers["tenantid"],
    ).toBe("project-1");
  });
});

describe("fetchScheduleCalendarFeed", () => {
  beforeEach(() => {
    getSpy().mockClear();
    getSpy().mockResolvedValue({ data: { exists: false } } as never);
  });

  test("addresses the schedule in the path and the project in the header", async () => {
    await fetchScheduleCalendarFeed("project-1", "schedule-9");

    const [url, config]: Array<unknown> = lastCall(getSpy());

    expect(url).toBe("/api/on-call-calendar/schedule-feed/schedule-9/current");
    expect(
      (config as { headers: Record<string, string> }).headers["tenantid"],
    ).toBe("project-1");
  });

  test("URL-encodes a schedule id that is not a bare uuid", async () => {
    await fetchScheduleCalendarFeed("project-1", "a b/c");

    const [url]: Array<unknown> = lastCall(getSpy());

    expect(url).toBe("/api/on-call-calendar/schedule-feed/a%20b%2Fc/current");
  });

  test("an unpublished feed reads as exists:false with no urls", async () => {
    const status: OnCallCalendarFeedStatus = await fetchScheduleCalendarFeed(
      "project-1",
      "schedule-9",
    );

    expect(status.exists).toBe(false);
    expect(status.urls).toBeNull();
  });
});

describe("fetchMyShifts", () => {
  beforeEach(() => {
    getSpy().mockClear();
    getSpy().mockResolvedValue({
      data: { shifts: [], truncated: false, generatedAt: "x" },
    } as never);
  });

  test("sends the window as ISO strings and NO tenant header by default", async () => {
    /*
     * Without a tenant header the server walks every project the caller is
     * rostered in - the cross-project view the on-call tab shows. Adding one
     * "for consistency" would silently scope the list to one project.
     */
    const from: Date = new Date("2026-03-03T12:00:00.000Z");
    const to: Date = new Date("2026-03-17T12:00:00.000Z");

    await fetchMyShifts({ from, to });

    const [url, config]: Array<unknown> = lastCall(getSpy());
    const request: {
      params: Record<string, string>;
      headers?: Record<string, string>;
    } = config as {
      params: Record<string, string>;
      headers?: Record<string, string>;
    };

    expect(url).toBe("/api/on-call-calendar/my-shifts");
    expect(request.params).toEqual({
      from: "2026-03-03T12:00:00.000Z",
      to: "2026-03-17T12:00:00.000Z",
    });
    expect(request.headers).toBeUndefined();
  });

  test("scopes to one project only when asked", async () => {
    await fetchMyShifts({ from: new Date(0), to: new Date(1000) }, "project-1");

    const [, config]: Array<unknown> = lastCall(getSpy());

    expect(
      (config as { headers: Record<string, string> }).headers["tenantid"],
    ).toBe("project-1");
  });

  test("returns the normalised list and the truncation flag", async () => {
    getSpy().mockResolvedValue({
      data: {
        shifts: [shiftJson({ shiftKey: "s:1" }), { junk: true }],
        truncated: true,
        generatedAt: "2026-03-03T12:00:00.000Z",
      },
    } as never);

    const result: MyOnCallShiftsResponse = await fetchMyShifts({
      from: new Date(0),
      to: new Date(1000),
    });

    expect(
      result.shifts.map((shift: MyOnCallShift) => {
        return shift.shiftKey;
      }),
    ).toEqual(["s:1"]);
    expect(result.truncated).toBe(true);
    expect(result.generatedAt).toBe("2026-03-03T12:00:00.000Z");
  });
});

function shiftJson(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    shiftKey: "schedule-1:1772539200",
    contentHash: "abc",
    projectId: "project-1",
    projectName: "Acme",
    scheduleId: "schedule-1",
    scheduleName: "Primary",
    scheduleTimezone: "Europe/Stockholm",
    userId: "user-me",
    userName: "Ada Lovelace",
    start: "2026-03-03T13:00:00.000Z",
    end: "2026-03-03T21:00:00.000Z",
    coverageSeconds: 28800,
    layerId: "layer-1",
    layerName: "Weekdays",
    policies: [
      {
        policyId: "policy-1",
        policyName: "Database",
        ruleId: "rule-1",
        ruleName: "First responders",
        ruleOrder: 1,
      },
    ],
    isPast: false,
    lastModifiedAt: "2026-03-01T00:00:00.000Z",
    shiftConfigVersion: 3,
    ...overrides,
  };
}

describe("toMyOnCallShift", () => {
  test("keeps every field the cards render", () => {
    const shift: MyOnCallShift | null = toMyOnCallShift(shiftJson());

    expect(shift).not.toBeNull();
    expect(shift!.shiftKey).toBe("schedule-1:1772539200");
    expect(shift!.scheduleName).toBe("Primary");
    expect(shift!.projectName).toBe("Acme");
    expect(shift!.layerName).toBe("Weekdays");
    expect(shift!.scheduleTimezone).toBe("Europe/Stockholm");
    expect(shift!.coverageSeconds).toBe(28800);
    expect(shift!.policies).toHaveLength(1);
    expect(shift!.policies[0]?.policyName).toBe("Database");
    expect(shift!.shiftConfigVersion).toBe(3);
    expect(shift!.isPast).toBe(false);
  });

  test("omits optional keys the server did not send, rather than sending undefined", () => {
    const shift: MyOnCallShift | null = toMyOnCallShift(
      shiftJson({
        projectName: undefined,
        layerId: undefined,
        layerName: undefined,
      }),
    );

    expect(shift).not.toBeNull();
    expect("projectName" in shift!).toBe(false);
    expect("layerId" in shift!).toBe(false);
    expect("layerName" in shift!).toBe(false);
    expect("override" in shift!).toBe(false);
    expect("policyVariantOf" in shift!).toBe(false);
  });

  test("keeps the override block, including the policy scope", () => {
    const shift: MyOnCallShift | null = toMyOnCallShift(
      shiftJson({
        override: {
          originalUserId: "user-2",
          originalUserName: "Priya Rao",
          overrideStartsAt: "2026-03-03T13:00:00.000Z",
          overrideEndsAt: "2026-03-03T21:00:00.000Z",
          onCallDutyPolicyId: "policy-1",
        },
      }),
    );

    expect(shift!.override).toEqual({
      originalUserId: "user-2",
      originalUserName: "Priya Rao",
      overrideStartsAt: "2026-03-03T13:00:00.000Z",
      overrideEndsAt: "2026-03-03T21:00:00.000Z",
      onCallDutyPolicyId: "policy-1",
    });
  });

  test("keeps the policy variant block", () => {
    const shift: MyOnCallShift | null = toMyOnCallShift(
      shiftJson({
        policyVariantOf: {
          policyId: "policy-1",
          policyName: "Database",
          globalUserId: "user-2",
        },
      }),
    );

    expect(shift!.policyVariantOf).toEqual({
      policyId: "policy-1",
      policyName: "Database",
      globalUserId: "user-2",
    });
  });

  test("drops a shift that cannot be placed on a timeline", () => {
    expect(toMyOnCallShift(shiftJson({ shiftKey: "" }))).toBeNull();
    expect(toMyOnCallShift(shiftJson({ scheduleId: undefined }))).toBeNull();
    expect(toMyOnCallShift(shiftJson({ start: "not a date" }))).toBeNull();
    expect(toMyOnCallShift(shiftJson({ end: null }))).toBeNull();
    expect(toMyOnCallShift(null)).toBeNull();
    expect(toMyOnCallShift("shift")).toBeNull();
  });

  test("tolerates malformed sub-objects instead of throwing", () => {
    const shift: MyOnCallShift | null = toMyOnCallShift(
      shiftJson({
        override: "nope",
        policyVariantOf: 42,
        policies: "none",
        userName: null,
      }),
    );

    expect(shift).not.toBeNull();
    expect(shift!.override).toBeUndefined();
    expect(shift!.policyVariantOf).toBeUndefined();
    expect(shift!.policies).toEqual([]);
    expect(shift!.userName).toBe("Unnamed user");
  });

  test("unwraps serialized Name values the client interceptor leaves alone", () => {
    const shift: MyOnCallShift | null = toMyOnCallShift(
      shiftJson({ userName: { _type: "Name", value: "Ada" } }),
    );

    expect(shift!.userName).toBe("Ada");
  });
});

describe("toMyOnCallShiftsResponse", () => {
  test("reads an empty or malformed body as no shifts", () => {
    expect(toMyOnCallShiftsResponse(null)).toEqual({
      shifts: [],
      truncated: false,
      generatedAt: "",
    });
    expect(toMyOnCallShiftsResponse({ shifts: "x" }).shifts).toEqual([]);
  });
});

describe("toOnCallCalendarFeedStatus", () => {
  test("reads a missing body as 'no feed yet'", () => {
    const status: OnCallCalendarFeedStatus =
      toOnCallCalendarFeedStatus(undefined);

    expect(status.exists).toBe(false);
    expect(status.isEnabled).toBe(false);
    expect(status.needsRegeneration).toBe(false);
    expect(status.urls).toBeNull();
    expect(status.fetchCount).toBe(0);
    expect(status.settings).toEqual({ pastDays: 2, futureDays: 90 });
  });

  test("never reports urls without an https link", () => {
    /*
     * The buttons are wired to `urls.https`; a block with an empty https
     * would put a Share button on screen that shares an empty string.
     */
    const status: OnCallCalendarFeedStatus = toOnCallCalendarFeedStatus({
      ...FULL_STATUS,
      urls: { https: "", webcal: "webcals://x" },
    });

    expect(status.urls).toBeNull();
  });

  test("fills a missing webcal link from the https one", () => {
    const status: OnCallCalendarFeedStatus = toOnCallCalendarFeedStatus({
      ...FULL_STATUS,
      urls: { https: "https://x/y.ics" },
    });

    expect(status.urls).toEqual({
      https: "https://x/y.ics",
      webcal: "https://x/y.ics",
      googleAdd: "",
    });
  });

  test("keeps the warnings and the optional settings", () => {
    const status: OnCallCalendarFeedStatus = toOnCallCalendarFeedStatus({
      ...FULL_STATUS,
      hostWarning: "Set HOST",
      protocolWarning: "http",
      settings: {
        pastDays: 5,
        futureDays: 30,
        includeCoverageGaps: true,
        minimumGapMinutes: 15,
        rotateWhenMemberLeaves: true,
      },
    });

    expect(status.hostWarning).toBe("Set HOST");
    expect(status.protocolWarning).toBe("http");
    expect(status.settings).toEqual({
      pastDays: 5,
      futureDays: 30,
      includeCoverageGaps: true,
      minimumGapMinutes: 15,
      rotateWhenMemberLeaves: true,
    });
  });

  test("accepts numeric strings for counts", () => {
    const status: OnCallCalendarFeedStatus = toOnCallCalendarFeedStatus({
      ...FULL_STATUS,
      fetchCount: "12",
    });

    expect(status.fetchCount).toBe(12);
  });
});

function axiosError(status: number | null): unknown {
  return {
    isAxiosError: true,
    message: "Request failed",
    ...(status === null ? {} : { response: { status } }),
  };
}

describe("error classification", () => {
  test("a 404 is 'route missing' - the server predates calendar feeds", () => {
    expect(isRouteMissingError(axiosError(404))).toBe(true);
    expect(isRouteMissingError(axiosError(403))).toBe(false);
    expect(isRouteMissingError(axiosError(500))).toBe(false);
  });

  test("a network failure is NOT 'route missing'", () => {
    /*
     * Hiding the feature because the phone lost signal would make it appear
     * and disappear with the connection.
     */
    expect(isRouteMissingError(axiosError(null))).toBe(false);
    expect(isRouteMissingError(new Error("boom"))).toBe(false);
    expect(isRouteMissingError(undefined)).toBe(false);
  });

  test("a 503 is the render cap or the kill switch", () => {
    expect(isServiceUnavailableError(axiosError(503))).toBe(true);
    expect(isServiceUnavailableError(axiosError(200))).toBe(false);
  });

  test("getHttpStatus reads only axios errors with a response", () => {
    expect(getHttpStatus(axiosError(418))).toBe(418);
    expect(getHttpStatus(axiosError(null))).toBeNull();
    expect(getHttpStatus({ response: { status: 500 } })).toBeNull();
    expect(getHttpStatus("x")).toBeNull();
  });
});
