import Project from "../../../../Models/DatabaseModels/Project";
import SecurityAutomaticResponsePolicy from "../../../../Models/DatabaseModels/SecurityAutomaticResponsePolicy";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ProjectService from "../../../../Server/Services/ProjectService";
import SecurityAutomaticResponseActionService from "../../../../Server/Services/SecurityAutomaticResponseActionService";
import SecurityAutomaticResponsePolicyService from "../../../../Server/Services/SecurityAutomaticResponsePolicyService";
import SecurityAutomaticResponseLimit from "../../../../Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseLimit";
import SecurityAutomaticResponseOverview from "../../../../Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseOverview";
import SecurityBlockDestinations from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestinations";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityAutomaticResponseOutcome } from "../../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseOutcome";
import {
  SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR,
  SECURITY_AUTOMATIC_RESPONSE_MESSAGES,
} from "../../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  SecurityAutomaticResponseOverviewData,
  readSecurityAutomaticResponseOverview,
} from "../../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseOverview";
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
 * THE HOURLY LIMIT, ON THE SERVER (#10746): what a project stores is read
 * for every decision and every read of the Automatic Response page, and
 * the server keeps no limit a project could not set.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NOW: Date = new Date("2026-11-24T10:00:00.000Z");

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SecurityAutomaticResponseLimit.read", () => {
  let stored: unknown;
  let reads: Array<JSONObject>;

  beforeEach(() => {
    stored = undefined;
    reads = [];

    jest.spyOn(ProjectService, "findOneById").mockImplementation((async (
      data: JSONObject,
    ) => {
      reads.push(data);

      if (stored === null) {
        return null;
      }

      const project: Project = new Project(PROJECT_ID);
      (project as unknown as Record<string, unknown>)[
        "securityAutomaticResponseMaxBlocksPerHour"
      ] = stored;
      return project;
    }) as never);
  });

  test("reads the project's own column, as OneUptime, and nothing else of it", async () => {
    stored = 120;

    expect(await SecurityAutomaticResponseLimit.read(PROJECT_ID)).toBe(120);
    expect(reads).toHaveLength(1);
    expect((reads[0]!["id"] as ObjectID).toString()).toBe(PROJECT_ID.toString());
    expect(reads[0]!["select"]).toEqual({
      securityAutomaticResponseMaxBlocksPerHour: true,
    });
    expect(reads[0]!["props"]).toEqual({ isRoot: true });
  });

  test.each([1, 50, 500])("a limit of %p is the project's", async (limit: number) => {
    stored = limit;

    expect(await SecurityAutomaticResponseLimit.read(PROJECT_ID)).toBe(limit);
  });

  test.each([undefined, null, 0, 501, 2.5, "lots"])(
    "%p - unset, gone or none a project could set - is the default",
    async (value: unknown) => {
      stored = value;

      expect(await SecurityAutomaticResponseLimit.read(PROJECT_ID)).toBe(
        SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR,
      );
    },
  );

  test("reads afresh every time: a limit changed in the middle of an hour is the next read's", async () => {
    stored = 50;
    expect(await SecurityAutomaticResponseLimit.read(PROJECT_ID)).toBe(50);

    stored = 10;
    expect(await SecurityAutomaticResponseLimit.read(PROJECT_ID)).toBe(10);

    stored = 200;
    expect(await SecurityAutomaticResponseLimit.read(PROJECT_ID)).toBe(200);
    expect(reads).toHaveLength(3);
  });

  test("a read that fails is not a limit: it throws, and the decision is not made", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockRejectedValue(new Error("database unavailable"));

    await expect(SecurityAutomaticResponseLimit.read(PROJECT_ID)).rejects.toThrow(
      "database unavailable",
    );
  });
});

describe("the Automatic Response page's read: the project's own limit, and whether its owners were paged", () => {
  let limit: number;
  let liveBlocks: number;
  let pages: number;
  let counts: Array<JSONObject>;

  beforeEach(() => {
    limit = SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR;
    liveBlocks = 0;
    pages = 0;
    counts = [];

    jest
      .spyOn(SecurityAutomaticResponsePolicyService, "ensureReadyPolicies")
      .mockResolvedValue(undefined);
    jest
      .spyOn(SecurityAutomaticResponsePolicyService, "findBy")
      .mockResolvedValue([] as Array<SecurityAutomaticResponsePolicy>);
    jest.spyOn(SecurityBlockDestinations, "findForProject").mockResolvedValue({
      destinations: [],
      failedProviders: [],
    } as never);
    jest
      .spyOn(SecurityAutomaticResponseLimit, "read")
      .mockImplementation(async () => {
        return limit;
      });
    jest
      .spyOn(SecurityAutomaticResponseActionService, "countBy")
      .mockImplementation((async (data: { query: JSONObject }) => {
        counts.push(data.query);
        const count: number =
          data.query["pagedAt"] !== undefined ? pages : liveBlocks;

        return {
          toNumber: () => {
            return count;
          },
        } as never;
      }) as never);
  });

  async function read(): Promise<SecurityAutomaticResponseOverviewData> {
    return readSecurityAutomaticResponseOverview(
      await SecurityAutomaticResponseOverview.read({
        projectId: PROJECT_ID,
        props: { isRoot: true },
        now: NOW,
      }),
    );
  }

  test("says the project's own limit, as its decisions are held to it", async () => {
    limit = 120;
    liveBlocks = 12;

    const overview: SecurityAutomaticResponseOverviewData = await read();

    expect(overview.maxBlocksPerHour).toBe(120);
    expect(overview.blocksThisHour).toBe(12);
    expect(overview.pagedThisHour).toBe(false);
  });

  test("a lowered limit below the hour's blocks reads as used up: the page's notice shows", async () => {
    limit = 10;
    liveBlocks = 30;

    const overview: SecurityAutomaticResponseOverviewData = await read();

    expect(overview.blocksThisHour >= overview.maxBlocksPerHour).toBe(true);
  });

  test("says the owners were paged once a stop paged them this hour, and counts that the way the decisions do", async () => {
    limit = 10;
    liveBlocks = 10;
    pages = 1;

    expect((await read()).pagedThisHour).toBe(true);

    const paged: JSONObject | undefined = counts.find((query: JSONObject) => {
      return query["pagedAt"] !== undefined;
    });

    expect(paged?.["outcome"]).toBe(SecurityAutomaticResponseOutcome.StoppedAtLimit);
    expect(paged?.["isTrialRun"]).toBe(false);
    expect(paged?.["projectId"]).toEqual(PROJECT_ID);
  });

  test("a trial run's stop pages nobody, so the hour's blocks are counted only where it acted", async () => {
    await read();

    const blocks: JSONObject | undefined = counts.find((query: JSONObject) => {
      return query["pagedAt"] === undefined;
    });

    expect(blocks?.["isTrialRun"]).toBe(false);
  });
});

describe("ProjectService: the hourly limit a project sets", () => {
  test.each([
    [1, 1],
    [500, 500],
    [120, 120],
    ["120", 120],
  ])("%p is kept as %p", (value: unknown, kept: number) => {
    const data: { securityAutomaticResponseMaxBlocksPerHour?: unknown } = {
      securityAutomaticResponseMaxBlocksPerHour: value,
    };

    ProjectService.applySecurityAutomaticResponseLimitRules(data);

    expect(data.securityAutomaticResponseMaxBlocksPerHour).toBe(kept);
  });

  test.each([0, -1, 501, 2.5, "fifty", "", null, true])(
    "%p is refused with the reason, never stored",
    (value: unknown) => {
      const data: { securityAutomaticResponseMaxBlocksPerHour?: unknown } = {
        securityAutomaticResponseMaxBlocksPerHour: value,
      };

      expect(() => {
        ProjectService.applySecurityAutomaticResponseLimitRules(data);
      }).toThrow(
        new BadDataException(
          SECURITY_AUTOMATIC_RESPONSE_MESSAGES.hourlyLimitOutOfRange,
        ),
      );
    },
  );

  test("a write that leaves the limit out leaves it as it is", () => {
    const data: { securityAutomaticResponseMaxBlocksPerHour?: unknown } = {};

    ProjectService.applySecurityAutomaticResponseLimitRules(data);

    expect(data).toEqual({});
  });
});
