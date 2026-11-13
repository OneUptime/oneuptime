jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AIService from "../../../Server/Services/AIService";
import type AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import DashboardService from "../../../Server/Services/DashboardService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import OnCallTestPageService from "../../../Server/Services/OnCallTestPageService";
import ProductFeedbackService from "../../../Server/Services/ProductFeedbackService";
import ProjectMilestoneService from "../../../Server/Services/ProjectMilestoneService";
import ProjectService from "../../../Server/Services/ProjectService";
import SetupHealthService from "../../../Server/Services/SetupHealthService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TelemetryIngestionKeyService from "../../../Server/Services/TelemetryIngestionKeyService";
import UserService from "../../../Server/Services/UserService";
import WelcomeChecklistService from "../../../Server/Services/WelcomeChecklistService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import {
  ActiveMonitoringMeteredPlan,
  LogDataIngestMeteredPlan,
  WatchedTableMeteredPlan,
} from "../../../Server/Types/Billing/MeteredPlan/AllMeteredPlans";
import WatchedTableMeteredPlanType from "../../../Server/Types/Billing/MeteredPlan/WatchedTableMeteredPlan";
import ActiveMonitorLimit from "../../../Server/Utils/Billing/ActiveMonitorLimit";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import SampleProjectAnalyticsData, {
  SAMPLE_PROJECT_ANALYTICS_SERVICES,
} from "../../../Server/Utils/SampleProject/SampleProjectAnalyticsData";
import SampleProjectStatusPages from "../../../Server/Utils/StatusPage/SampleProjectStatusPages";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import TelemetryUsageMeter from "../../../Server/Utils/TelemetryUsage/TelemetryUsageMeter";
import { ExpressRequest } from "../../../Server/Utils/Express";
import type AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import User from "../../../Models/DatabaseModels/User";
import ActivationMilestone from "../../../Types/Analytics/ActivationMilestone";
import Email from "../../../Types/Email";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import {
  FeedbackQuestionDecision,
  decideFeedbackQuestion,
} from "../../../Types/ProductFeedback/ProductFeedback";
import {
  SAMPLE_PROJECT_REFUSALS,
  getSamplePersonEmail,
} from "../../../Types/SampleProject/SampleProject";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * EACH READER OF A SAMPLE PROJECT'S FLAG, DOING WHAT IT IS THERE FOR
 * (issue #6808). SampleProjectReadersGuard lists them; this proves each:
 * a sample is never billed or counted, takes no telemetry, uses no AI,
 * reaches no milestone, is asked nothing, has no checklist and no
 * findings, sends no test page, connects no workspace, takes no member,
 * has no public dashboard or status page, and its analytics rows go with
 * it. A real project goes on as before, beside each.
 *
 * No database: the services are jest.spyOn stubs.
 * ---------------------------------------------------------------------------
 */

const SAMPLE_ID: ObjectID = new ObjectID(
  "5a3c0000-0000-4000-8000-0000000000a1",
);
const REAL_ID: ObjectID = new ObjectID("5a3c0000-0000-4000-8000-0000000000b1");
const USER_ID: ObjectID = new ObjectID("5a3c0000-0000-4000-8000-0000000000c1");
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "5a3c0000-0000-4000-8000-0000000000d1",
);

const isSampleId: (projectId: ObjectID | string) => boolean = (
  projectId: ObjectID | string,
): boolean => {
  return projectId.toString() === SAMPLE_ID.toString();
};

beforeEach(() => {
  jest
    .spyOn(ProjectService, "isSampleProject")
    .mockImplementation(async (projectId: ObjectID | string) => {
      return isSampleId(projectId);
    });
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("billing meters never count a sample", () => {
  test("active monitors: nothing counted or reported", async () => {
    const refreshCount: jest.SpyInstance = jest
      .spyOn(ActiveMonitorLimit, "refreshCount")
      .mockResolvedValue(3 as never);

    await ActiveMonitoringMeteredPlan.reportQuantityToBillingProvider(
      SAMPLE_ID,
    );

    expect(refreshCount).not.toHaveBeenCalled();
  });

  test("active monitors of a real project are counted", async () => {
    const refreshCount: jest.SpyInstance = jest
      .spyOn(ActiveMonitorLimit, "refreshCount")
      .mockRejectedValue(new Error("counted"));

    await expect(
      ActiveMonitoringMeteredPlan.reportQuantityToBillingProvider(REAL_ID),
    ).rejects.toThrow("counted");
    expect(refreshCount).toHaveBeenCalledWith(REAL_ID);
  });

  test("telemetry: the payment setup is not even asked", async () => {
    const authorizeUsageNow: jest.SpyInstance = jest
      .spyOn(PayAsYouGoBillingService, "authorizeUsageNow")
      .mockRejectedValue(new Error("asked"));

    await LogDataIngestMeteredPlan.reportQuantityToBillingProvider(SAMPLE_ID);

    expect(authorizeUsageNow).not.toHaveBeenCalled();
  });

  test("watched tables: nothing counted", async () => {
    const countWatchedTables: jest.SpyInstance = jest
      .spyOn(WatchedTableMeteredPlanType, "countWatchedTables")
      .mockResolvedValue(2 as never);

    await WatchedTableMeteredPlan.reportQuantityToBillingProvider(SAMPLE_ID);

    expect(countWatchedTables).not.toHaveBeenCalled();
  });

  test("the usage meter of a server with billing off reads no sample", async () => {
    const findAllBy: jest.SpyInstance = jest
      .spyOn(ProjectService, "findAllBy")
      .mockResolvedValue([] as never);

    await TelemetryUsageMeter.meterAllProjects({
      deadline: new Date(Date.now() + 60_000),
      shouldContinue: () => {
        return true;
      },
    });

    expect(findAllBy).toHaveBeenCalledWith(
      expect.objectContaining({ query: { isSampleProject: false } }),
    );
  });
});

describe("a sample takes no telemetry and uses no AI", () => {
  test("no ingestion key can be made in it", async () => {
    await expect(
      (
        TelemetryIngestionKeyService as unknown as {
          onBeforeCreate: (createBy: unknown) => Promise<unknown>;
        }
      ).onBeforeCreate({
        data: { projectId: SAMPLE_ID, name: "Key" },
        props: { tenantId: SAMPLE_ID, userId: USER_ID },
      }),
    ).rejects.toThrow(SAMPLE_PROJECT_REFUSALS.telemetryIngestion);
  });

  test("OneUptime AI is refused, on the same row as its switch", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      enableAi: true,
      isSampleProject: true,
    } as never);

    await expect(AIService.assertProjectAIEnabled(SAMPLE_ID)).rejects.toThrow(
      SAMPLE_PROJECT_REFUSALS.ai,
    );
    await expect(AIService.isProjectAIEnabled(SAMPLE_ID)).resolves.toBe(false);
  });

  test("a real project with AI on may use it", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      enableAi: true,
      isSampleProject: false,
    } as never);

    await expect(AIService.assertProjectAIEnabled(REAL_ID)).resolves.toBe(
      undefined,
    );
  });
});

describe("a sample is no activation, and is asked nothing", () => {
  test("it reaches no milestone, and nothing is written", async () => {
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    const getRepository: jest.SpyInstance = jest.spyOn(
      ProjectMilestoneService,
      "getRepository",
    );

    await expect(
      ProjectMilestoneService.reach({
        projectId: SAMPLE_ID,
        milestone: ActivationMilestone.FirstMonitorCreated,
      }),
    ).resolves.toBe(false);

    expect(getRepository).not.toHaveBeenCalled();
    expect(
      ProjectMilestoneService.isKnownReached(
        SAMPLE_ID,
        ActivationMilestone.FirstMonitorCreated,
      ),
    ).toBe(true);
  });

  test("never asks a feedback question in a sample", () => {
    expect(
      decideFeedbackQuestion({
        key: "check_in:project",
        isServerOn: true,
        isPersonOn: true,
        asked: {},
        isIncidentOpen: false,
        now: new Date(),
        isSampleProject: true,
      }),
    ).toBe(FeedbackQuestionDecision.SampleProject);
    expect(
      decideFeedbackQuestion({
        key: "check_in:project",
        isServerOn: true,
        isPersonOn: true,
        asked: {},
        isIncidentOpen: false,
        now: new Date(),
      }),
    ).toBe(FeedbackQuestionDecision.Ask);
  });

  test("the server answers not to ask, and writes nothing down", async () => {
    jest.spyOn(ProductFeedbackService, "isServerOn").mockResolvedValue(true);
    jest.spyOn(UserService, "findOneById").mockResolvedValue({
      disableFeedbackQuestions: false,
      feedbackQuestionsAsked: {},
    } as never);
    const updateOneById: jest.SpyInstance = jest.spyOn(
      UserService,
      "updateOneById",
    );

    await expect(
      ProductFeedbackService.ask({
        userId: USER_ID,
        projectId: SAMPLE_ID,
        key: "setup_flow:website_down",
        now: new Date(),
      }),
    ).resolves.toBe(FeedbackQuestionDecision.SampleProject);
    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("the Welcome checklist is finished, and the goals are never asked", async () => {
    jest
      .spyOn(WelcomeChecklistService as never, "readProject" as never)
      .mockResolvedValue({
        goals: null,
        state: { startedWithOutcomes: true, hiddenFor: [] },
        isFreePlan: false,
      } as never);
    const readMilestones: jest.SpyInstance = jest.spyOn(
      WelcomeChecklistService as never,
      "readMilestones" as never,
    );

    const answer: { isFinished: boolean; canChooseGoals: boolean } =
      (await WelcomeChecklistService.getAnswer({
        projectId: SAMPLE_ID,
        userId: USER_ID,
        props: { tenantId: SAMPLE_ID, userId: USER_ID, isMasterAdmin: true },
      })) as never;

    expect(answer.isFinished).toBe(true);
    expect(answer.canChooseGoals).toBe(false);
    expect(readMilestones).not.toHaveBeenCalled();
  });

  test("setup health has no findings, and reads nothing", async () => {
    const readFacts: jest.SpyInstance = jest.spyOn(
      SetupHealthService,
      "readFacts",
    );

    const findings: { findings: Array<unknown> } =
      (await SetupHealthService.getProjectFindings({
        projectId: SAMPLE_ID,
        refresh: true,
      })) as never;

    expect(findings.findings).toEqual([]);
    expect(readFacts).not.toHaveBeenCalled();
  });
});

describe("nothing leaves a sample, and nobody joins it", () => {
  test("a test page is refused before anything is claimed", async () => {
    const assertIsProjectMember: jest.SpyInstance = jest.spyOn(
      OnCallTestPageService,
      "assertIsProjectMember",
    );

    await expect(
      OnCallTestPageService.sendToPerson({
        projectId: SAMPLE_ID,
        targetUserId: USER_ID,
        sentByUserId: USER_ID,
        recordKind: "incident" as never,
        severityId: USER_ID,
      }),
    ).rejects.toThrow(SAMPLE_PROJECT_REFUSALS.testPage);
    expect(assertIsProjectMember).not.toHaveBeenCalled();

    await expect(
      OnCallTestPageService.assertNotSampleProject(REAL_ID),
    ).resolves.toBe(undefined);
  });

  test("no workspace can be connected", async () => {
    const service: {
      onBeforeCreate: (createBy: unknown) => Promise<unknown>;
    } = WorkspaceProjectAuthTokenService as unknown as {
      onBeforeCreate: (createBy: unknown) => Promise<unknown>;
    };

    await expect(
      service.onBeforeCreate({
        data: { projectId: SAMPLE_ID },
        props: { isRoot: true },
      }),
    ).rejects.toThrow(SAMPLE_PROJECT_REFUSALS.workspace);
    await expect(
      service.onBeforeCreate({
        data: { projectId: REAL_ID },
        props: { isRoot: true },
      }),
    ).resolves.toBeTruthy();
  });

  test("nobody is invited to a sample", async () => {
    await expect(
      TeamMemberService.assertSampleProjectRules({
        createBy: { data: {}, props: { userId: USER_ID } } as never,
        projectId: SAMPLE_ID,
        invitedEmail: new Email("friend@example.com"),
        namedUserId: null,
      }),
    ).rejects.toThrow(SAMPLE_PROJECT_REFUSALS.member);
  });

  test("a sample person joins no real project, by address or by id", async () => {
    await expect(
      TeamMemberService.assertSampleProjectRules({
        createBy: { data: {}, props: { userId: USER_ID } } as never,
        projectId: REAL_ID,
        invitedEmail: new Email(
          getSamplePersonEmail({
            handle: "maya.chen",
            projectId: SAMPLE_ID.toString(),
          }),
        ),
        namedUserId: null,
      }),
    ).rejects.toThrow(SAMPLE_PROJECT_REFUSALS.samplePersonElsewhere);

    const samplePerson: User = new User();
    samplePerson.sampleProjectId = SAMPLE_ID;
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(UserService, "findOneById").mockResolvedValue(samplePerson);

    await expect(
      TeamMemberService.assertSampleProjectRules({
        createBy: { data: {}, props: { userId: USER_ID } } as never,
        projectId: REAL_ID,
        invitedEmail: null,
        namedUserId: USER_ID,
      }),
    ).rejects.toThrow(SAMPLE_PROJECT_REFUSALS.samplePersonElsewhere);
  });

  test("a real invitation goes ahead, and OneUptime writes the sample's own members", async () => {
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(UserService, "findOneById").mockResolvedValue(new User());

    await expect(
      TeamMemberService.assertSampleProjectRules({
        createBy: { data: {}, props: { userId: USER_ID } } as never,
        projectId: REAL_ID,
        invitedEmail: new Email("friend@example.com"),
        namedUserId: USER_ID,
      }),
    ).resolves.toBe(undefined);
    await expect(
      TeamMemberService.assertSampleProjectRules({
        createBy: { data: {}, props: { isRoot: true } } as never,
        projectId: SAMPLE_ID,
        invitedEmail: null,
        namedUserId: USER_ID,
      }),
    ).resolves.toBe(undefined);
  });
});

describe("nothing in a sample is public", () => {
  test("its dashboard's public link answers as for none", async () => {
    const dashboard: Dashboard = new Dashboard();
    dashboard.projectId = SAMPLE_ID;

    const withoutBlockedProject: (
      dashboard: Dashboard | null,
    ) => Promise<Dashboard | null> = (
      DashboardService as unknown as {
        withoutBlockedProject: (
          dashboard: Dashboard | null,
        ) => Promise<Dashboard | null>;
      }
    ).withoutBlockedProject.bind(DashboardService);

    await expect(withoutBlockedProject(dashboard)).resolves.toBeNull();

    const real: Dashboard = new Dashboard();
    real.projectId = REAL_ID;

    await expect(withoutBlockedProject(real)).resolves.toBe(real);
  });

  const request: ExpressRequest = { headers: {} } as unknown as ExpressRequest;

  test("its status page is read by a signed-in member of the sample only", async () => {
    jest
      .spyOn(StatusPageService, "getProjectIdOfStatusPage")
      .mockResolvedValue(SAMPLE_ID);
    const getSessionUser: jest.SpyInstance = jest
      .spyOn(UserMiddleware, "getSessionUser")
      .mockResolvedValue({ userId: USER_ID } as JSONWebTokenData);
    const isMember: jest.SpyInstance = jest
      .spyOn(ProjectMembership, "isMember")
      .mockResolvedValue(true);

    await expect(
      SampleProjectStatusPages.getReadAccess({
        req: request,
        statusPageId: STATUS_PAGE_ID,
      }),
    ).resolves.toBe(true);
    expect(isMember).toHaveBeenCalledWith({
      projectId: SAMPLE_ID,
      userId: USER_ID,
    });

    isMember.mockResolvedValue(false);
    await expect(
      SampleProjectStatusPages.getReadAccess({
        req: request,
        statusPageId: STATUS_PAGE_ID,
      }),
    ).resolves.toBe(false);

    getSessionUser.mockResolvedValue(null);
    await expect(
      SampleProjectStatusPages.getReadAccess({
        req: request,
        statusPageId: STATUS_PAGE_ID,
      }),
    ).resolves.toBe(false);
  });

  test("a real project's status page keeps its own rules", async () => {
    jest
      .spyOn(StatusPageService, "getProjectIdOfStatusPage")
      .mockResolvedValue(REAL_ID);
    const getSessionUser: jest.SpyInstance = jest.spyOn(
      UserMiddleware,
      "getSessionUser",
    );

    await expect(
      SampleProjectStatusPages.getReadAccess({
        req: request,
        statusPageId: STATUS_PAGE_ID,
      }),
    ).resolves.toBeNull();
    expect(getSessionUser).not.toHaveBeenCalled();
  });

  test("a status page read: a member reads it unsigned to the page, anyone else finds nothing, even when it is public", async () => {
    const statusPage: StatusPage = new StatusPage();
    statusPage._id = STATUS_PAGE_ID.toString();
    statusPage.isPublicStatusPage = true;
    jest.spyOn(StatusPageService, "findOneById").mockResolvedValue(statusPage);
    const getReadAccess: jest.SpyInstance = jest
      .spyOn(SampleProjectStatusPages, "getReadAccess")
      .mockResolvedValue(false);

    const refused: { hasReadAccess: boolean; error?: unknown } =
      await StatusPageService.hasReadAccess({
        statusPageId: STATUS_PAGE_ID,
        req: request,
      });

    expect(refused.hasReadAccess).toBe(false);
    expect(refused.error).toBeInstanceOf(NotFoundException);

    getReadAccess.mockResolvedValue(true);
    statusPage.isPublicStatusPage = false;

    await expect(
      StatusPageService.hasReadAccess({
        statusPageId: STATUS_PAGE_ID,
        req: request,
      }),
    ).resolves.toEqual({ hasReadAccess: true });
  });

  test("no custom domain can be added to its status page", async () => {
    const parentOnBeforeCreate: jest.SpyInstance = jest
      .spyOn(DatabaseService.prototype as never, "onBeforeCreate" as never)
      .mockImplementation((async (createBy: unknown) => {
        return { createBy: createBy, carryForward: null };
      }) as never);

    const { default: StatusPageDomainService } = await import(
      "../../../Server/Services/StatusPageDomainService"
    );

    await expect(
      (
        StatusPageDomainService as unknown as {
          onBeforeCreate: (createBy: unknown) => Promise<unknown>;
        }
      ).onBeforeCreate({
        data: { projectId: SAMPLE_ID },
        props: { tenantId: SAMPLE_ID, userId: USER_ID },
      }),
    ).rejects.toThrow(SAMPLE_PROJECT_REFUSALS.statusPageDomain);

    parentOnBeforeCreate.mockRestore();
  });
});

describe("a deleted sample leaves nothing in the analytics database", () => {
  test("every table is asked to delete the project's rows, as root", async () => {
    const deleteBys: Array<jest.SpyInstance> =
      SAMPLE_PROJECT_ANALYTICS_SERVICES.map(
        (service: AnalyticsDatabaseService<AnalyticsBaseModel>) => {
          return jest
            .spyOn(service, "deleteBy")
            .mockResolvedValue(undefined as never);
        },
      );

    const result: { deletedFrom: Array<string>; failedFor: Array<string> } =
      await SampleProjectAnalyticsData.deleteAll(SAMPLE_ID);

    for (const deleteBy of deleteBys) {
      expect(deleteBy).toHaveBeenCalledWith({
        query: { projectId: SAMPLE_ID },
        props: { isRoot: true },
      });
    }

    expect(result.deletedFrom).toHaveLength(
      SAMPLE_PROJECT_ANALYTICS_SERVICES.length,
    );
    expect(result.failedFor).toEqual([]);
  });

  test("a table that fails is logged, and the others still delete", async () => {
    const services: ReadonlyArray<{
      deleteBy: (data: unknown) => Promise<void>;
      model: { tableName?: string | undefined };
    }> = SAMPLE_PROJECT_ANALYTICS_SERVICES as never;

    services.forEach(
      (
        service: {
          deleteBy: (data: unknown) => Promise<void>;
        },
        index: number,
      ) => {
        jest
          .spyOn(service, "deleteBy")
          .mockImplementation(async (): Promise<void> => {
            if (index === 0) {
              throw new Error("mutation refused");
            }
          });
      },
    );

    const result: { deletedFrom: Array<string>; failedFor: Array<string> } =
      await SampleProjectAnalyticsData.deleteAll(SAMPLE_ID);

    expect(result.failedFor).toEqual([services[0]!.model.tableName]);
    expect(result.deletedFrom).toHaveLength(services.length - 1);
  });
});

describe("a sample's project row is read by the readers, not asked again", () => {
  test("a real project is asked once, and stays a real one", async () => {
    // A guard against the stubs above leaking: the real answer is a lookup.
    (
      ProjectService.isSampleProject as unknown as jest.SpyInstance
    ).mockRestore();
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(false);

    await expect(ProjectService.isSampleProject(REAL_ID)).resolves.toBe(false);
    expect(new Project().isSampleProject).toBeUndefined();
  });
});
