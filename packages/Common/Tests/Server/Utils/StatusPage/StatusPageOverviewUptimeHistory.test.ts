import StatusPageOverviewCache, {
  StatusPageOverviewBase,
} from "../../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

jest.mock("../../../../Server/Utils/Logger");

/*
 * StatusPageOverviewCache.getOrBuildUptimeHistory: a status page's uptime
 * history is cut in each visitor's zone (issue #6697: it was UTC days for
 * everyone), and kept on the overview it belongs to - one build per clock
 * however many visitors and zones ask, gone with the overview.
 */

const WINDOW_START: Date = new Date("2026-08-13T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-11-11T10:00:00.000Z");

function overview(): StatusPageOverviewBase {
  return {
    response: { statusPage: { _id: "page" } },
    uptimeHistory: {
      monitorIds: [new ObjectID("11111111-1111-4111-8111-111111111111")],
      monitorGroups: [],
      rankedMonitorStatusIds: [],
      startDate: WINDOW_START,
      endDate: WINDOW_END,
    },
  };
}

// a history as buildUptimeHistory returns it, cut in `cutIn`.
function history(
  cutIn: string,
  marker: string,
): {
  json: JSONObject;
  cutIn: string;
} {
  return {
    json: {
      uptimeDailyAggregate: {
        monitors: [{ monitorId: marker, buckets: [] }],
        isComplete: true,
        completeFrom: null,
        timezone: cutIn,
      },
      monitorGroupUptimeDailyAggregate: {
        monitorGroups: [],
        timezone: cutIn,
      },
    },
    cutIn: cutIn,
  };
}

async function historyFor(data: {
  overview: StatusPageOverviewBase;
  timezone: string;
  build: () => Promise<{ json: JSONObject; cutIn: string }>;
}): Promise<JSONObject> {
  return await StatusPageOverviewCache.getOrBuildUptimeHistory({
    overview: data.overview,
    timezone: data.timezone,
    startDate: WINDOW_START,
    endDate: WINDOW_END,
    build: data.build,
  });
}

function timezoneOf(json: JSONObject, field: string): unknown {
  return (json[field] as JSONObject)["timezone"];
}

describe("StatusPageOverviewCache.getOrBuildUptimeHistory", () => {
  beforeEach(() => {
    StatusPageOverviewCache.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("builds a zone's history once, and keeps it on the overview", async () => {
    const base: StatusPageOverviewBase = overview();
    const build: Mock<() => Promise<{ json: JSONObject; cutIn: string }>> =
      jest.fn(async () => {
        return history("Asia/Shanghai", "shanghai");
      });

    const first: JSONObject = await historyFor({
      overview: base,
      timezone: "Asia/Shanghai",
      build,
    });
    const second: JSONObject = await historyFor({
      overview: base,
      timezone: "Asia/Shanghai",
      build,
    });

    expect(build).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(timezoneOf(first, "uptimeDailyAggregate")).toBe("Asia/Shanghai");
  });

  test("visitors who ask together share one build", async () => {
    const base: StatusPageOverviewBase = overview();
    let release: () => void = () => {};
    const gate: Promise<void> = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });
    const build: Mock<() => Promise<{ json: JSONObject; cutIn: string }>> =
      jest.fn(async () => {
        await gate;
        return history("Europe/Berlin", "berlin");
      });

    const requests: Array<Promise<JSONObject>> = [1, 2, 3].map(() => {
      return historyFor({ overview: base, timezone: "Europe/Berlin", build });
    });

    release();
    await Promise.all(requests);

    expect(build).toHaveBeenCalledTimes(1);
  });

  test("a zone of the same clock is served the same history, labelled with its own zone", async () => {
    const base: StatusPageOverviewBase = overview();
    const build: Mock<() => Promise<{ json: JSONObject; cutIn: string }>> =
      jest.fn(async () => {
        return history("Asia/Shanghai", "shanghai");
      });

    const shanghai: JSONObject = await historyFor({
      overview: base,
      timezone: "Asia/Shanghai",
      build,
    });
    const singapore: JSONObject = await historyFor({
      overview: base,
      timezone: "Asia/Singapore",
      build,
    });

    expect(build).toHaveBeenCalledTimes(1);
    expect(timezoneOf(singapore, "uptimeDailyAggregate")).toBe(
      "Asia/Singapore",
    );
    expect(timezoneOf(singapore, "monitorGroupUptimeDailyAggregate")).toBe(
      "Asia/Singapore",
    );
    // the buckets are shared; what was kept is not changed.
    expect((singapore["uptimeDailyAggregate"] as JSONObject)["monitors"]).toBe(
      (shanghai["uptimeDailyAggregate"] as JSONObject)["monitors"],
    );
    expect(timezoneOf(shanghai, "uptimeDailyAggregate")).toBe("Asia/Shanghai");
  });

  test("a zone of another clock gets a history of its own", async () => {
    const base: StatusPageOverviewBase = overview();
    const build: Mock<
      (timezone: string) => Promise<{ json: JSONObject; cutIn: string }>
    > = jest.fn(async (timezone: string) => {
      return history(timezone, timezone);
    });

    await historyFor({
      overview: base,
      timezone: "Asia/Shanghai",
      build: () => {
        return build("Asia/Shanghai");
      },
    });
    const newYork: JSONObject = await historyFor({
      overview: base,
      timezone: "America/New_York",
      build: () => {
        return build("America/New_York");
      },
    });

    expect(build).toHaveBeenCalledTimes(2);
    expect(timezoneOf(newYork, "uptimeDailyAggregate")).toBe(
      "America/New_York",
    );
  });

  test("a history that fell back to UTC keeps saying UTC, whoever asked", async () => {
    const base: StatusPageOverviewBase = overview();

    const json: JSONObject = await historyFor({
      overview: base,
      timezone: "Asia/Shanghai",
      build: async () => {
        return history("UTC", "fallback");
      },
    });

    expect(timezoneOf(json, "uptimeDailyAggregate")).toBe("UTC");
    expect(timezoneOf(json, "monitorGroupUptimeDailyAggregate")).toBe("UTC");
  });

  test("a failed build is never kept: the next visitor builds again", async () => {
    const base: StatusPageOverviewBase = overview();
    let calls: number = 0;

    const build: () => Promise<{
      json: JSONObject;
      cutIn: string;
    }> = async (): Promise<{ json: JSONObject; cutIn: string }> => {
      calls++;

      if (calls === 1) {
        throw new Error("database went away");
      }

      return history("Asia/Tokyo", "tokyo");
    };

    await expect(
      historyFor({ overview: base, timezone: "Asia/Tokyo", build }),
    ).rejects.toThrow("database went away");

    const json: JSONObject = await historyFor({
      overview: base,
      timezone: "Asia/Tokyo",
      build,
    });

    expect(calls).toBe(2);
    expect(timezoneOf(json, "uptimeDailyAggregate")).toBe("Asia/Tokyo");
  });

  test("goes with the overview: a new overview builds its own history", async () => {
    const build: Mock<() => Promise<{ json: JSONObject; cutIn: string }>> =
      jest.fn(async () => {
        return history("Asia/Kolkata", "kolkata");
      });

    await historyFor({
      overview: overview(),
      timezone: "Asia/Kolkata",
      build,
    });
    await historyFor({
      overview: overview(),
      timezone: "Asia/Kolkata",
      build,
    });

    expect(build).toHaveBeenCalledTimes(2);
  });

  test("clear() forgets every history", async () => {
    const base: StatusPageOverviewBase = overview();
    const build: Mock<() => Promise<{ json: JSONObject; cutIn: string }>> =
      jest.fn(async () => {
        return history("UTC", "utc");
      });

    await historyFor({ overview: base, timezone: "UTC", build });
    StatusPageOverviewCache.clear();
    await historyFor({ overview: base, timezone: "UTC", build });

    expect(build).toHaveBeenCalledTimes(2);
  });
});

describe("StatusPageOverviewCache.getOrBuildOverviewInZone", () => {
  beforeEach(() => {
    StatusPageOverviewCache.clear();
  });

  test("is the shared overview with the visitor's history, and the very same object when they ask again", async () => {
    const base: StatusPageOverviewBase = overview();
    const build: Mock<() => Promise<{ json: JSONObject; cutIn: string }>> =
      jest.fn(async () => {
        return history("Asia/Shanghai", "shanghai");
      });

    const first: JSONObject =
      await StatusPageOverviewCache.getOrBuildOverviewInZone({
        overview: base,
        timezone: "Asia/Shanghai",
        build,
      });
    const second: JSONObject =
      await StatusPageOverviewCache.getOrBuildOverviewInZone({
        overview: base,
        timezone: "Asia/Shanghai",
        build,
      });

    expect(second).toBe(first);
    expect(build).toHaveBeenCalledTimes(1);
    expect(first["statusPage"]).toBe(base.response["statusPage"]);
    expect(timezoneOf(first, "uptimeDailyAggregate")).toBe("Asia/Shanghai");
    // what every visitor shares is not changed.
    expect(base.response["uptimeDailyAggregate"]).toBeUndefined();
  });

  test("each zone gets its own response, sharing one build per clock", async () => {
    const base: StatusPageOverviewBase = overview();
    const build: Mock<() => Promise<{ json: JSONObject; cutIn: string }>> =
      jest.fn(async () => {
        return history("Asia/Shanghai", "shanghai");
      });

    const shanghai: JSONObject =
      await StatusPageOverviewCache.getOrBuildOverviewInZone({
        overview: base,
        timezone: "Asia/Shanghai",
        build,
      });
    const perth: JSONObject =
      await StatusPageOverviewCache.getOrBuildOverviewInZone({
        overview: base,
        timezone: "Australia/Perth",
        build,
      });

    expect(build).toHaveBeenCalledTimes(1);
    expect(perth).not.toBe(shanghai);
    expect(timezoneOf(perth, "uptimeDailyAggregate")).toBe("Australia/Perth");
  });

  test("a failed build is never kept", async () => {
    const base: StatusPageOverviewBase = overview();
    let calls: number = 0;

    const build: () => Promise<{
      json: JSONObject;
      cutIn: string;
    }> = async (): Promise<{ json: JSONObject; cutIn: string }> => {
      calls++;

      if (calls === 1) {
        throw new Error("timed out");
      }

      return history("UTC", "utc");
    };

    await expect(
      StatusPageOverviewCache.getOrBuildOverviewInZone({
        overview: base,
        timezone: "UTC",
        build,
      }),
    ).rejects.toThrow("timed out");

    const json: JSONObject =
      await StatusPageOverviewCache.getOrBuildOverviewInZone({
        overview: base,
        timezone: "UTC",
        build,
      });

    expect(calls).toBe(2);
    expect(timezoneOf(json, "uptimeDailyAggregate")).toBe("UTC");
  });
});
