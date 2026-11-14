import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import { JSONObject } from "../../../Types/JSON";

/*
 * ProjectMilestoneService (issue #6830): a project's activation milestone
 * kept once, and its event sent once, by the call that kept it.
 *
 * Postgres is stood in for by the repository's manager.query - the INSERT
 * ... ON CONFLICT DO NOTHING RETURNING answers with the row it wrote, or with
 * none when the milestone was kept already - and product analytics by
 * ProductAnalytics.capture. The real INSERT runs against a migrated Postgres
 * in ProjectMilestonePostgres.test.ts.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: true,
    IsEnterpriseEdition: false,
  };
});

import ProjectMilestoneService, {
  Service as ProjectMilestoneServiceClass,
} from "../../../Server/Services/ProjectMilestoneService";
import ProjectService from "../../../Server/Services/ProjectService";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import logger from "../../../Server/Utils/Logger";
import ActivationMilestone from "../../../Types/Analytics/ActivationMilestone";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: string = "6d1f6a37-6a2c-4c8c-9a1f-6f1e2a3b4c5d";
const OTHER_PROJECT_ID: string = "0a0b0c0d-1111-4222-8333-944455556666";
const PROJECT_CREATED_AT: Date = new Date("2026-11-01T10:00:00.000Z");

const INSERT_PREFIX: string = `INSERT INTO "ProjectMilestone"`;
const SELECT_PROJECT_PREFIX: string = `SELECT "createdAt", "planName", "createdOwnerEmail" FROM "Project"`;

interface QueryCall {
  sql: string;
  parameters: Array<unknown>;
}

let queryCalls: Array<QueryCall> = [];
let keptPairs: Set<string> = new Set<string>();
let failNextInserts: number = 0;
let foreignKeyMissing: boolean = false;
let insertGate: Promise<void> | null = null;

const queryMock: Mock<
  (sql: string, parameters: Array<unknown>) => Promise<unknown>
> = jest.fn(
  async (sql: string, parameters: Array<unknown>): Promise<unknown> => {
    queryCalls.push({ sql, parameters });

    if (sql.startsWith(INSERT_PREFIX)) {
      if (insertGate) {
        await insertGate;
      }

      if (failNextInserts > 0) {
        failNextInserts--;
        throw new Error("connection reset");
      }

      if (foreignKeyMissing) {
        throw Object.assign(new Error("violates foreign key constraint"), {
          code: "23503",
        });
      }

      const pair: string = `${parameters[0]}:${parameters[1]}`;

      if (keptPairs.has(pair)) {
        return [];
      }

      keptPairs.add(pair);
      return [{ _id: ObjectID.generate().toString() }];
    }

    if (sql.startsWith(SELECT_PROJECT_PREFIX)) {
      return [
        {
          createdAt: PROJECT_CREATED_AT,
          planName: "Growth",
          createdOwnerEmail: "owner@example.com",
        },
      ];
    }

    throw new Error(`Unexpected query: ${sql}`);
  },
);

const insertCalls: () => Array<QueryCall> = (): Array<QueryCall> => {
  return queryCalls.filter((call: QueryCall): boolean => {
    return call.sql.startsWith(INSERT_PREFIX);
  });
};

const flush: () => Promise<void> = async (): Promise<void> => {
  for (let i: number = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

describe("ProjectMilestoneService", () => {
  let captureSpy: SpyInstance<typeof ProductAnalytics.capture>;
  let isConfiguredSpy: SpyInstance<typeof ProductAnalytics.isConfigured>;
  let isSampleProjectSpy: SpyInstance<typeof ProjectService.isSampleProject>;

  beforeEach(() => {
    queryCalls = [];
    keptPairs = new Set<string>();
    failNextInserts = 0;
    foreignKeyMissing = false;
    insertGate = null;
    queryMock.mockClear();

    ProjectMilestoneService.forgetKnownMilestones();

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(ProjectMilestoneService, "getRepository").mockReturnValue({
      manager: { query: queryMock },
    } as never);
    /*
     * Before it keeps a milestone, the service asks whether the project is
     * a sample (#6808), which reaches none: a real project here, unless a
     * test says otherwise.
     */
    isSampleProjectSpy = jest
      .spyOn(ProjectService, "isSampleProject")
      .mockResolvedValue(false);

    captureSpy = jest
      .spyOn(ProductAnalytics, "capture")
      .mockImplementation((): void => {
        return undefined;
      });
    isConfiguredSpy = jest
      .spyOn(ProductAnalytics, "isConfigured")
      .mockReturnValue(true);

    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("reach", () => {
    test("keeps a milestone the first time, with an INSERT that does nothing on a conflict", async () => {
      const kept: boolean = await ProjectMilestoneService.reach({
        projectId: new ObjectID(PROJECT_ID),
        milestone: ActivationMilestone.FirstMonitorCreated,
      });

      expect(kept).toBe(true);
      expect(insertCalls()).toHaveLength(1);

      const insert: QueryCall = insertCalls()[0]!;

      expect(insert.sql).toContain(
        `ON CONFLICT ("projectId", "milestone") DO NOTHING RETURNING "_id"`,
      );
      expect(insert.sql).toContain(
        `"wasBackfilled", "version") VALUES ($1, $2, $3, false, 1)`,
      );
      expect(insert.parameters[0]).toBe(PROJECT_ID);
      expect(insert.parameters[1]).toBe("first_monitor_created");
      expect(insert.parameters[2]).toBeInstanceOf(Date);
    });

    test("the same milestone again is answered from the memo, with no query", async () => {
      await ProjectMilestoneService.reach({
        projectId: PROJECT_ID,
        milestone: ActivationMilestone.FirstMonitorCreated,
      });

      queryCalls = [];

      for (let i: number = 0; i < 5; i++) {
        expect(
          await ProjectMilestoneService.reach({
            projectId: PROJECT_ID,
            milestone: ActivationMilestone.FirstMonitorCreated,
          }),
        ).toBe(false);
      }

      expect(queryCalls).toEqual([]);
      expect(
        ProjectMilestoneService.isKnownReached(
          PROJECT_ID,
          ActivationMilestone.FirstMonitorCreated,
        ),
      ).toBe(true);
      // Its spelling does not matter.
      expect(
        ProjectMilestoneService.isKnownReached(
          PROJECT_ID.toUpperCase(),
          ActivationMilestone.FirstMonitorCreated,
        ),
      ).toBe(true);
    });

    test("a milestone kept by another server is found there: false, no event, and remembered", async () => {
      keptPairs.add(`${PROJECT_ID}:first_check_result_received`);

      const kept: boolean = await ProjectMilestoneService.reach({
        projectId: PROJECT_ID,
        milestone: ActivationMilestone.FirstCheckResultReceived,
      });

      expect(kept).toBe(false);
      expect(captureSpy).not.toHaveBeenCalled();
      expect(
        ProjectMilestoneService.isKnownReached(
          PROJECT_ID,
          ActivationMilestone.FirstCheckResultReceived,
        ),
      ).toBe(true);
    });

    test("each milestone and each project is kept on its own", async () => {
      expect(
        await ProjectMilestoneService.reach({
          projectId: PROJECT_ID,
          milestone: ActivationMilestone.FirstMonitorCreated,
        }),
      ).toBe(true);
      expect(
        await ProjectMilestoneService.reach({
          projectId: PROJECT_ID,
          milestone: ActivationMilestone.SecondMemberJoined,
        }),
      ).toBe(true);
      expect(
        await ProjectMilestoneService.reach({
          projectId: OTHER_PROJECT_ID,
          milestone: ActivationMilestone.FirstMonitorCreated,
        }),
      ).toBe(true);

      expect(insertCalls()).toHaveLength(3);
    });

    test("calls that arrive together share one INSERT, and only one of them kept it", async () => {
      let openGate: () => void = () => {};
      insertGate = new Promise<void>((resolve: () => void) => {
        openGate = resolve;
      });

      const calls: Array<Promise<boolean>> = [];

      for (let i: number = 0; i < 20; i++) {
        calls.push(
          ProjectMilestoneService.reach({
            projectId: PROJECT_ID,
            milestone: ActivationMilestone.FirstLogsReceived,
          }),
        );
      }

      openGate();

      const results: Array<boolean> = await Promise.all(calls);

      expect(insertCalls()).toHaveLength(1);
      expect(
        results.filter((kept: boolean): boolean => {
          return kept;
        }),
      ).toHaveLength(1);
      expect(captureSpy).toHaveBeenCalledTimes(1);
    });

    test("a write that failed is not remembered: the next call tries again and keeps it", async () => {
      failNextInserts = 1;

      expect(
        await ProjectMilestoneService.reach({
          projectId: PROJECT_ID,
          milestone: ActivationMilestone.FirstMonitorCreated,
        }),
      ).toBe(false);
      expect(
        ProjectMilestoneService.isKnownReached(
          PROJECT_ID,
          ActivationMilestone.FirstMonitorCreated,
        ),
      ).toBe(false);
      expect(captureSpy).not.toHaveBeenCalled();

      expect(
        await ProjectMilestoneService.reach({
          projectId: PROJECT_ID,
          milestone: ActivationMilestone.FirstMonitorCreated,
        }),
      ).toBe(true);
      expect(insertCalls()).toHaveLength(2);
      expect(captureSpy).toHaveBeenCalledTimes(1);
    });

    test("a project that no longer exists keeps nothing, throws nothing, and is not asked about again", async () => {
      foreignKeyMissing = true;

      expect(
        await ProjectMilestoneService.reach({
          projectId: PROJECT_ID,
          milestone: ActivationMilestone.FirstMonitorCreated,
        }),
      ).toBe(false);
      expect(
        await ProjectMilestoneService.reach({
          projectId: PROJECT_ID,
          milestone: ActivationMilestone.FirstMonitorCreated,
        }),
      ).toBe(false);

      expect(insertCalls()).toHaveLength(1);
      expect(captureSpy).not.toHaveBeenCalled();
    });

    /*
     * A sample project (#6808) was made up for a person to look around in:
     * nothing that happens in it is a project getting value.
     */
    test("a sample project reaches no milestone: nothing is kept, no event is sent, and it is not asked again", async () => {
      isSampleProjectSpy.mockResolvedValue(true);

      expect(
        await ProjectMilestoneService.reach({
          projectId: PROJECT_ID,
          milestone: ActivationMilestone.FirstMonitorCreated,
        }),
      ).toBe(false);

      expect(isSampleProjectSpy).toHaveBeenCalledTimes(1);
      expect(isSampleProjectSpy).toHaveBeenCalledWith(PROJECT_ID);
      // No INSERT, and the project is not read for an event.
      expect(queryCalls).toEqual([]);
      expect(captureSpy).not.toHaveBeenCalled();
      expect(
        ProjectMilestoneService.isKnownReached(
          PROJECT_ID,
          ActivationMilestone.FirstMonitorCreated,
        ),
      ).toBe(true);

      // Remembered: the next call is answered from the memo.
      expect(
        await ProjectMilestoneService.reach({
          projectId: PROJECT_ID,
          milestone: ActivationMilestone.FirstMonitorCreated,
        }),
      ).toBe(false);
      expect(isSampleProjectSpy).toHaveBeenCalledTimes(1);
      expect(queryCalls).toEqual([]);
      expect(captureSpy).not.toHaveBeenCalled();
    });

    test("no project, a value that is no milestone, or no database: nothing is written", async () => {
      expect(
        await ProjectMilestoneService.reach({
          projectId: null,
          milestone: ActivationMilestone.FirstMonitorCreated,
        }),
      ).toBe(false);
      expect(
        await ProjectMilestoneService.reach({
          projectId: PROJECT_ID,
          milestone: "first_coffee" as ActivationMilestone,
        }),
      ).toBe(false);

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(false);

      expect(
        await ProjectMilestoneService.reach({
          projectId: PROJECT_ID,
          milestone: ActivationMilestone.FirstMonitorCreated,
        }),
      ).toBe(false);

      expect(queryCalls).toEqual([]);
    });

    test("the time it happened can be given; it defaults to now", async () => {
      const at: Date = new Date("2026-11-02T08:00:00.000Z");

      await ProjectMilestoneService.reach({
        projectId: PROJECT_ID,
        milestone: ActivationMilestone.FirstMonitorCreated,
        reachedAt: at,
      });

      expect(insertCalls()[0]!.parameters[2]).toBe(at);
    });
  });

  describe("the milestone's event", () => {
    test("is sent once, by the call that kept it, under the project creator's id, naming no one", async () => {
      const reachedAt: Date = new Date("2026-11-01T10:12:30.000Z");

      await ProjectMilestoneService.reach({
        projectId: PROJECT_ID,
        milestone: ActivationMilestone.FirstCheckResultReceived,
        reachedAt: reachedAt,
      });
      await ProjectMilestoneService.reach({
        projectId: PROJECT_ID,
        milestone: ActivationMilestone.FirstCheckResultReceived,
      });

      expect(captureSpy).toHaveBeenCalledTimes(1);

      const event: Parameters<typeof ProductAnalytics.capture>[0] =
        captureSpy.mock.calls[0]![0];

      expect(event.event).toBe("activation/first_check_result_received");
      expect(event.distinctId).toBe("owner@example.com");
      expect(event.timestamp).toBe(reachedAt);
      expect(event.deduplicationKey).toBe(
        `activation:${PROJECT_ID}:first_check_result_received`,
      );
      expect(event.properties).toEqual({
        project_id: PROJECT_ID,
        plan: "Growth",
        edition: "cloud",
        milestone: "first_check_result_received",
        seconds_since_project_created: 750,
      });
    });

    test("is not sent - and the project is not even read - where product analytics is not set up", async () => {
      isConfiguredSpy.mockReturnValue(false);

      expect(
        await ProjectMilestoneService.reach({
          projectId: PROJECT_ID,
          milestone: ActivationMilestone.FirstMonitorCreated,
        }),
      ).toBe(true);

      expect(captureSpy).not.toHaveBeenCalled();
      expect(
        queryCalls.filter((call: QueryCall): boolean => {
          return call.sql.startsWith(SELECT_PROJECT_PREFIX);
        }),
      ).toEqual([]);
    });

    test("is not sent for a project with no creator's email to file it under", async () => {
      queryMock.mockImplementationOnce(
        async (sql: string, parameters: Array<unknown>): Promise<unknown> => {
          queryCalls.push({ sql, parameters });
          keptPairs.add(`${parameters[0]}:${parameters[1]}`);
          return [{ _id: "x" }];
        },
      );
      queryMock.mockImplementationOnce(
        async (sql: string, parameters: Array<unknown>): Promise<unknown> => {
          queryCalls.push({ sql, parameters });
          return [
            {
              createdAt: PROJECT_CREATED_AT,
              planName: null,
              createdOwnerEmail: null,
            },
          ];
        },
      );

      expect(
        await ProjectMilestoneService.reach({
          projectId: PROJECT_ID,
          milestone: ActivationMilestone.FirstMonitorCreated,
        }),
      ).toBe(true);
      expect(captureSpy).not.toHaveBeenCalled();
    });

    test("a failure to send it never fails keeping the milestone", async () => {
      captureSpy.mockImplementation((): void => {
        throw new Error("PostHog is down");
      });

      expect(
        await ProjectMilestoneService.reach({
          projectId: PROJECT_ID,
          milestone: ActivationMilestone.FirstMonitorCreated,
        }),
      ).toBe(true);
    });

    test("its properties are the project, the plan, the edition, the milestone and the seconds - and nothing else", () => {
      const properties: JSONObject =
        ProjectMilestoneServiceClass.getMilestoneEventProperties({
          projectId: PROJECT_ID,
          milestone: ActivationMilestone.SecondMemberJoined,
          reachedAt: new Date("2026-11-01T11:00:00.400Z"),
          projectCreatedAt: PROJECT_CREATED_AT,
          planName: "",
        });

      expect(properties).toEqual({
        project_id: PROJECT_ID,
        plan: "",
        edition: "cloud",
        milestone: "second_member_joined",
        seconds_since_project_created: 3600,
      });

      // A clock behind the project's creation never says a negative time.
      expect(
        ProjectMilestoneServiceClass.getMilestoneEventProperties({
          projectId: PROJECT_ID,
          milestone: ActivationMilestone.SecondMemberJoined,
          reachedAt: new Date("2026-11-01T09:00:00.000Z"),
          projectCreatedAt: PROJECT_CREATED_AT,
          planName: "Free",
        })["seconds_since_project_created"],
      ).toBe(0);

      // No creation time, no seconds.
      expect(
        "seconds_since_project_created" in
          ProjectMilestoneServiceClass.getMilestoneEventProperties({
            projectId: PROJECT_ID,
            milestone: ActivationMilestone.SecondMemberJoined,
            reachedAt: new Date(),
            projectCreatedAt: null,
            planName: "Free",
          }),
      ).toBe(false);
    });
  });

  describe("reachInBackground", () => {
    test("returns at once, keeps the milestone in the background, and never throws", async () => {
      expect(() => {
        ProjectMilestoneService.reachInBackground({
          projectId: PROJECT_ID,
          milestone: ActivationMilestone.FirstMonitorCreated,
        });
      }).not.toThrow();

      await flush();

      expect(insertCalls()).toHaveLength(1);
      expect(captureSpy).toHaveBeenCalledTimes(1);
    });

    test("once the milestone is known, it starts nothing at all", async () => {
      await ProjectMilestoneService.reach({
        projectId: PROJECT_ID,
        milestone: ActivationMilestone.FirstMonitorCreated,
      });

      const reachSpy: SpyInstance<typeof ProjectMilestoneService.reach> =
        jest.spyOn(ProjectMilestoneService, "reach");

      ProjectMilestoneService.reachInBackground({
        projectId: PROJECT_ID,
        milestone: ActivationMilestone.FirstMonitorCreated,
      });
      ProjectMilestoneService.reachInBackground({
        projectId: undefined,
        milestone: ActivationMilestone.FirstMonitorCreated,
      });

      expect(reachSpy).not.toHaveBeenCalled();
    });

    test("a database that throws is logged, not thrown", async () => {
      failNextInserts = 1;

      ProjectMilestoneService.reachInBackground({
        projectId: PROJECT_ID,
        milestone: ActivationMilestone.FirstMonitorCreated,
      });

      await flush();

      expect(logger.error).toHaveBeenCalled();
    });
  });

  test("the edition is cloud with billing on", () => {
    expect(ProjectMilestoneServiceClass.getEdition()).toBe("cloud");
  });
});
