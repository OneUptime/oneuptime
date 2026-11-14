import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * A self-hosted server keeps its activation milestones to itself (issue
 * #6830): with no ANALYTICS_KEY / ANALYTICS_HOST - config.example.env sets
 * neither - a milestone is still kept in its own database, and nothing at
 * all is posted anywhere. Only the transport is stood in for (API.post), so
 * a regression anywhere between the milestone and the wire - the service
 * sending without asking, ProductAnalytics posting without a key - fails
 * here.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    AnalyticsKey: "",
    AnalyticsHost: "",
  };
});

const postMock: Mock<(...args: Array<unknown>) => Promise<unknown>> = jest.fn(
  async (..._args: Array<unknown>): Promise<unknown> => {
    return undefined;
  },
);

jest.mock("../../../Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): Promise<unknown> => {
        return postMock(...args);
      },
    },
  };
});

import ProjectMilestoneService from "../../../Server/Services/ProjectMilestoneService";
import ProjectService from "../../../Server/Services/ProjectService";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import * as EnvironmentConfig from "../../../Server/EnvironmentConfig";
import ActivationMilestone, {
  ALL_ACTIVATION_MILESTONES,
} from "../../../Types/Analytics/ActivationMilestone";

interface MutableEnvironment {
  AnalyticsKey: string;
  AnalyticsHost: string;
}

const environment: MutableEnvironment =
  EnvironmentConfig as unknown as MutableEnvironment;

const PROJECT_ID: string = "6d1f6a37-6a2c-4c8c-9a1f-6f1e2a3b4c5d";

const flush: () => Promise<void> = async (): Promise<void> => {
  for (let i: number = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

describe("activation milestones on a server without product analytics", () => {
  let inserts: number;

  beforeEach(() => {
    inserts = 0;
    postMock.mockClear();
    environment.AnalyticsKey = "";
    environment.AnalyticsHost = "";

    ProjectMilestoneService.forgetKnownMilestones();

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    /*
     * Before it keeps a milestone, the service asks whether the project is a
     * sample (#6808), which reaches none (ProjectMilestoneService.test.ts
     * pins that). This project is a real one.
     */
    jest.spyOn(ProjectService, "isSampleProject").mockResolvedValue(false);
    jest.spyOn(ProjectMilestoneService, "getRepository").mockReturnValue({
      manager: {
        query: async (sql: string): Promise<unknown> => {
          if (sql.startsWith(`INSERT INTO "ProjectMilestone"`)) {
            inserts++;
            return [{ _id: `row-${inserts}` }];
          }

          return [
            {
              createdAt: new Date("2026-11-01T10:00:00.000Z"),
              planName: "",
              createdOwnerEmail: "owner@example.com",
            },
          ];
        },
      },
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("every milestone is kept in the server's own database, and nothing is posted anywhere", async () => {
    for (const milestone of ALL_ACTIVATION_MILESTONES) {
      expect(
        await ProjectMilestoneService.reach({
          projectId: PROJECT_ID,
          milestone: milestone,
        }),
      ).toBe(true);
    }

    await flush();

    expect(inserts).toBe(ALL_ACTIVATION_MILESTONES.length);
    expect(postMock).not.toHaveBeenCalled();
  });

  test("a key without a host - or a host without a key - still posts nothing", async () => {
    environment.AnalyticsKey = "phc_key";

    await ProjectMilestoneService.reach({
      projectId: PROJECT_ID,
      milestone: ActivationMilestone.FirstMonitorCreated,
    });

    environment.AnalyticsKey = "";
    environment.AnalyticsHost = "https://analytics.example.com";

    await ProjectMilestoneService.reach({
      projectId: PROJECT_ID,
      milestone: ActivationMilestone.FirstCheckResultReceived,
    });

    await flush();

    expect(postMock).not.toHaveBeenCalled();
  });

  test("the same milestone with a key and a host set - OneUptime Cloud - is posted, once", async () => {
    environment.AnalyticsKey = "phc_key";
    environment.AnalyticsHost = "https://analytics.example.com";

    await ProjectMilestoneService.reach({
      projectId: PROJECT_ID,
      milestone: ActivationMilestone.FirstMonitorCreated,
    });
    await ProjectMilestoneService.reach({
      projectId: PROJECT_ID,
      milestone: ActivationMilestone.FirstMonitorCreated,
    });

    await flush();

    expect(postMock).toHaveBeenCalledTimes(1);

    const body: Record<string, unknown> = (
      postMock.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;

    expect(body["event"]).toBe("activation/first_monitor_created");
    expect(body["distinct_id"]).toBe("owner@example.com");
  });
});
