import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The dashboard's one call for the schedule timeline: the URL it builds, the
 * 503 "busy, retry shortly" handling, and that anything else surfaces as an
 * error straight away.
 */

const getMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return getMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-1" };
      },
    },
  };
});

import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  SCHEDULE_TIMELINE_ROUTE,
  ScheduleTimelineResponse,
} from "../../../Types/OnCallDutyPolicy/ScheduleTimeline";
import ScheduleTimelineAPI, {
  TIMELINE_DEFAULT_RETRY_MS,
  TIMELINE_MAX_ATTEMPTS,
  getRetryDelayMilliseconds,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/ScheduleTimelineAPI";

const FROM: Date = new Date("2026-09-14T04:00:00.000Z");
const TO: Date = new Date("2026-09-21T04:00:00.000Z");

const BODY: JSONObject = {
  from: FROM.toISOString(),
  to: TO.toISOString(),
  generatedAt: "2026-09-17T12:00:00.000Z",
  truncated: false,
  totalScheduleCount: 1,
  schedulesTruncated: false,
  schedules: [
    {
      scheduleId: "s-1",
      scheduleName: "Primary",
      scheduleTimezone: null,
      ownerTeamIds: [],
      isCurrentUserOnRoster: false,
      truncated: false,
      shifts: [],
    },
  ],
  teams: [],
};

function ok(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

function failure(
  statusCode: number,
  headers?: Record<string, string>,
): HTTPErrorResponse {
  return new HTTPErrorResponse(
    statusCode,
    { message: `status ${statusCode}` },
    headers || {},
  );
}

function requestedUrl(call: number = 0): string {
  const options: { url: URL } = getMock.mock.calls[call]?.[0] as { url: URL };
  return options.url.toString();
}

beforeEach(() => {
  getMock.mockReset();
});

describe("buildUrl", () => {
  test("carries the route and the window as ISO strings", () => {
    const url: string = ScheduleTimelineAPI.buildUrl({
      from: FROM,
      to: TO,
    }).toString();

    expect(url).toContain(SCHEDULE_TIMELINE_ROUTE);
    expect(url).toContain(`from=${encodeURIComponent(FROM.toISOString())}`);
    expect(url).toContain(`to=${encodeURIComponent(TO.toISOString())}`);
    expect(url).not.toContain("teamId");
  });

  test("adds the team filter when locked to a team", () => {
    const teamId: ObjectID = ObjectID.generate();

    const url: string = ScheduleTimelineAPI.buildUrl({
      from: FROM,
      to: TO,
      teamId,
    }).toString();

    expect(url).toContain(`teamId=${teamId.toString()}`);
  });
});

describe("getRetryDelayMilliseconds", () => {
  test("honours Retry-After in seconds, capped at ten", () => {
    expect(
      getRetryDelayMilliseconds(failure(503, { "retry-after": "5" })),
    ).toBe(5000);
    expect(
      getRetryDelayMilliseconds(failure(503, { "Retry-After": "2" })),
    ).toBe(2000);
    expect(
      getRetryDelayMilliseconds(failure(503, { "retry-after": "3600" })),
    ).toBe(10000);
  });

  test("falls back to the default without a usable header", () => {
    expect(getRetryDelayMilliseconds(failure(503))).toBe(
      TIMELINE_DEFAULT_RETRY_MS,
    );
    expect(
      getRetryDelayMilliseconds(failure(503, { "retry-after": "soon" })),
    ).toBe(TIMELINE_DEFAULT_RETRY_MS);
    expect(
      getRetryDelayMilliseconds(failure(503, { "retry-after": "0" })),
    ).toBe(TIMELINE_DEFAULT_RETRY_MS);
  });
});

describe("getTimeline", () => {
  test("parses a successful answer, sending the tenant headers", async () => {
    getMock.mockResolvedValue(ok(BODY));

    const response: ScheduleTimelineResponse =
      await ScheduleTimelineAPI.getTimeline({ from: FROM, to: TO });

    expect(response.schedules[0]?.scheduleName).toBe("Primary");
    expect(getMock).toHaveBeenCalledTimes(1);

    const options: { headers: Record<string, string> } = getMock.mock
      .calls[0]?.[0] as { headers: Record<string, string> };

    expect(options.headers).toEqual({ tenantid: "project-1" });
    expect(requestedUrl()).toContain(SCHEDULE_TIMELINE_ROUTE);
  });

  test("a 503 is retried after the server's delay, then succeeds", async () => {
    const sleep: MockFunction = getJestMockFunction();
    sleep.mockResolvedValue(undefined);

    getMock
      .mockResolvedValueOnce(failure(503, { "retry-after": "5" }))
      .mockResolvedValueOnce(ok(BODY));

    const response: ScheduleTimelineResponse =
      await ScheduleTimelineAPI.getTimeline({
        from: FROM,
        to: TO,
        sleep: sleep as unknown as (milliseconds: number) => Promise<void>,
      });

    expect(response.schedules).toHaveLength(1);
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(requestedUrl(1)).toBe(requestedUrl(0));
  });

  test("gives up after the last attempt and throws the 503", async () => {
    const sleep: MockFunction = getJestMockFunction();
    sleep.mockResolvedValue(undefined);

    getMock.mockResolvedValue(failure(503));

    await expect(
      ScheduleTimelineAPI.getTimeline({
        from: FROM,
        to: TO,
        sleep: sleep as unknown as (milliseconds: number) => Promise<void>,
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);

    expect(getMock).toHaveBeenCalledTimes(TIMELINE_MAX_ATTEMPTS);
    expect(sleep).toHaveBeenCalledTimes(TIMELINE_MAX_ATTEMPTS - 1);
  });

  test("a request the caller has abandoned stops retrying after its wait", async () => {
    let cancelled: boolean = false;
    const sleep: MockFunction = getJestMockFunction();

    sleep.mockImplementation(async () => {
      // The reader moves to another week while this request waits.
      cancelled = true;
    });

    getMock.mockResolvedValue(failure(503, { "retry-after": "5" }));

    await expect(
      ScheduleTimelineAPI.getTimeline({
        from: FROM,
        to: TO,
        sleep: sleep as unknown as (milliseconds: number) => Promise<void>,
        isCancelled: () => {
          return cancelled;
        },
      }),
    ).rejects.toMatchObject({ statusCode: 503 });

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  test("a request that is still wanted keeps its retries", async () => {
    const sleep: MockFunction = getJestMockFunction();
    sleep.mockResolvedValue(undefined);

    getMock.mockResolvedValueOnce(failure(503)).mockResolvedValueOnce(ok(BODY));

    const response: ScheduleTimelineResponse =
      await ScheduleTimelineAPI.getTimeline({
        from: FROM,
        to: TO,
        sleep: sleep as unknown as (milliseconds: number) => Promise<void>,
        isCancelled: () => {
          return false;
        },
      });

    expect(response.schedules).toHaveLength(1);
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  test.each([400, 403, 404, 422, 500])(
    "a %i is not retried",
    async (statusCode: number) => {
      const sleep: MockFunction = getJestMockFunction();

      getMock.mockResolvedValue(failure(statusCode));

      await expect(
        ScheduleTimelineAPI.getTimeline({
          from: FROM,
          to: TO,
          sleep: sleep as unknown as (milliseconds: number) => Promise<void>,
        }),
      ).rejects.toMatchObject({ statusCode });

      expect(getMock).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  test("a list body is an error, not an empty timeline", async () => {
    getMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, [] as unknown as JSONObject, {}),
    );

    await expect(
      ScheduleTimelineAPI.getTimeline({ from: FROM, to: TO }),
    ).rejects.toThrow("Invalid schedule timeline response.");
  });
});
