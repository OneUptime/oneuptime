import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import StatusPageOverviewCache from "../../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * getProjectGeneration is what a status page's maintenance calendar keeps
 * its rendered body under (StatusPageMaintenanceCalendarFeed): the same
 * generation the page's overview is kept under, so an event taken off the
 * page - hidden, deleted, the page made private - is a new key for the
 * calendar at once, as it is for the overview.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "72000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "72000000-0000-4000-8000-000000000002",
);

let redis: Map<string, string>;

function redisReachable(): void {
  redis = new Map();

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return redis.get(`${namespace}-${key}`) || null;
    });
  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        redis.set(`${namespace}-${key}`, value);
      },
    );
}

beforeEach(() => {
  StatusPageOverviewCache.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
  StatusPageOverviewCache.clear();
});

describe("StatusPageOverviewCache.getProjectGeneration", () => {
  test("is the same from one read to the next while nothing is taken off", async () => {
    redisReachable();

    const first: string =
      await StatusPageOverviewCache.getProjectGeneration(PROJECT_ID);
    const second: string =
      await StatusPageOverviewCache.getProjectGeneration(PROJECT_ID);

    expect(typeof first).toBe("string");
    expect(second).toBe(first);
  });

  test("changes when a write takes something off the project's pages", async () => {
    redisReachable();

    const before: string =
      await StatusPageOverviewCache.getProjectGeneration(PROJECT_ID);

    await StatusPageOverviewCache.forgetProjects([PROJECT_ID]);

    const after: string =
      await StatusPageOverviewCache.getProjectGeneration(PROJECT_ID);

    expect(after).not.toBe(before);
  });

  test("another project's change leaves it as it was", async () => {
    redisReachable();

    const before: string =
      await StatusPageOverviewCache.getProjectGeneration(PROJECT_ID);

    await StatusPageOverviewCache.forgetProjects([OTHER_PROJECT_ID]);

    expect(await StatusPageOverviewCache.getProjectGeneration(PROJECT_ID)).toBe(
      before,
    );
  });

  test("an id written in capitals, or as a string, is the same project", async () => {
    redisReachable();

    const asObjectId: string =
      await StatusPageOverviewCache.getProjectGeneration(PROJECT_ID);

    expect(
      await StatusPageOverviewCache.getProjectGeneration(
        PROJECT_ID.toString().toUpperCase(),
      ),
    ).toBe(asObjectId);
  });

  test("never throws when the cache cannot be reached", async () => {
    jest.spyOn(GlobalCache, "getString").mockRejectedValue(new Error("down"));
    jest.spyOn(GlobalCache, "setString").mockRejectedValue(new Error("down"));

    await expect(
      StatusPageOverviewCache.getProjectGeneration(PROJECT_ID),
    ).resolves.toEqual(expect.any(String));
  });
});
