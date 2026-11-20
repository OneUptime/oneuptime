jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DataSecurityAPI from "../../../Server/API/DataSecurityAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import DataSecurityAiProposalService, {
  DataSecurityAiProposalTransitionSet,
} from "../../../Server/Services/DataSecurityAiProposalService";
import DataSecurityIssueFeedService from "../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../Server/Services/DataSecurityIssueService";
import DataStoreFeedService from "../../../Server/Services/DataStoreFeedService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProjectService from "../../../Server/Services/ProjectService";
import ScrubTelemetryAction from "../../../Server/Utils/AI/DataSecurity/Actions/ScrubTelemetryAction";
import { DataSecurityAiAction } from "../../../Server/Utils/AI/DataSecurity/DataSecurityAiAction";
import DataSecurityAiActions from "../../../Server/Utils/AI/DataSecurity/DataSecurityAiActions";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import ServerProducts from "../../../Server/Utils/ServerProducts/ServerProducts";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataSecurityAiProposal from "../../../Models/DatabaseModels/DataSecurityAiProposal";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DataSecurityAiChangeSafety,
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
  DataSecurityAiWork,
} from "../../../Types/DataSecurity/DataSecurityAi";
import { DATA_SECURITY_API_ROUTES } from "../../../Types/DataSecurity/DataSecurityApiTypes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ProductKey from "../../../Types/Product/ProductKey";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * APPROVE, DISMISS AND UNDO ON A PROPOSAL OF ONEUPTIME AI'S, THROUGH THE
 * SERVER'S OWN ROUTES (#10364): Express, the route's permission list,
 * DataSecurityAPI, DataSecurityAiProposals and the permission layer reading
 * the proposal as the person, over HTTP, into tables held in memory. Only
 * the change itself (making the scrub rule) is stood in for; who may make
 * it is Scrub It's own answer. For every role: who may read a proposal,
 * approve it (it takes what making a log scrub rule takes), dismiss it (it
 * takes what changing the issue takes) and undo it (what deleting the rule
 * takes) - and nothing acts while the server has Data Security off.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10364000-0000-4000-8000-000000000001",
);
const PROPOSAL_ID: string = "10364000-0000-4000-8000-0000000003a1";
const ISSUE_ID: string = "10364000-0000-4000-8000-0000000000a1";
const STORE_ID: string = "10364000-0000-4000-8000-0000000000b1";
const FINDING_ID: string = "10364000-0000-4000-8000-0000000004a1";

const PERMISSION_MESSAGE: string =
  "You do not have permission to do this in Data Security.";

interface Role {
  name: string;
  permissions: Array<Permission>;
  // Reads the proposal: the issue's readers.
  reads: boolean;
  // May make, and delete, a log scrub rule.
  makesLogRules: boolean;
  // May change the issue.
  changesIssues: boolean;
}

const ROLES: Array<Role> = [
  {
    name: "a project owner",
    permissions: [Permission.ProjectOwner],
    reads: true,
    makesLogRules: true,
    changesIssues: true,
  },
  {
    name: "a project admin",
    permissions: [Permission.ProjectAdmin],
    reads: true,
    makesLogRules: true,
    changesIssues: true,
  },
  {
    name: "a project member",
    permissions: [Permission.ProjectMember],
    reads: false,
    makesLogRules: false,
    changesIssues: false,
  },
  {
    name: "a viewer",
    permissions: [Permission.Viewer],
    reads: false,
    makesLogRules: false,
    changesIssues: false,
  },
  {
    name: "a security admin",
    permissions: [Permission.SecurityAdmin],
    reads: true,
    makesLogRules: false,
    changesIssues: true,
  },
  {
    name: "a security member",
    permissions: [Permission.SecurityMember],
    reads: true,
    makesLogRules: false,
    changesIssues: true,
  },
  {
    name: "a security viewer",
    permissions: [Permission.SecurityViewer],
    reads: true,
    makesLogRules: false,
    changesIssues: false,
  },
  {
    name: "a security member who may make and delete log scrub rules",
    permissions: [
      Permission.SecurityMember,
      Permission.CreateProjectLogScrubRule,
      Permission.DeleteProjectLogScrubRule,
    ],
    reads: true,
    makesLogRules: true,
    changesIssues: true,
  },
  {
    name: "a custom role that reads issues and their proposals",
    permissions: [
      Permission.ReadDataSecurityIssue,
      Permission.ReadDataSecurityAiProposal,
    ],
    reads: true,
    makesLogRules: false,
    changesIssues: false,
  },
  {
    name: "a custom role that makes log scrub rules, but reads no issue",
    permissions: [
      Permission.CreateProjectLogScrubRule,
      Permission.DeleteProjectLogScrubRule,
    ],
    reads: false,
    makesLogRules: true,
    changesIssues: false,
  },
];

function callerWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function storedProposal(overrides: StoredRow = {}): StoredRow {
  return {
    _id: PROPOSAL_ID,
    version: 1,
    projectId: PROJECT_ID.toString(),
    dataSecurityIssueId: ISSUE_ID,
    dataStoreId: STORE_ID,
    kind: DataSecurityAiProposalKind.ScrubTelemetry,
    work: DataSecurityAiWork.Contain,
    safety: DataSecurityAiChangeSafety.MaskOnly,
    status: DataSecurityAiProposalStatus.Proposed,
    title: "Scrub Password in attributes.user.password of checkout logs",
    plan: {
      kind: "Logs",
      places: [
        {
          findingId: FINDING_ID,
          dataTypeId: "password",
          location: "attributes.user.password",
          signal: "log",
        },
      ],
    },
    result: {
      rules: [
        {
          findingId: FINDING_ID,
          signal: "log",
          scrubRuleId: "10364000-0000-4000-8000-0000000005a1",
          scrubRuleName: "Data Security: Password",
          created: true,
        },
      ],
    },
    ...overrides,
  };
}

function storedIssue(): StoredRow {
  return {
    _id: ISSUE_ID,
    projectId: PROJECT_ID.toString(),
    title: "Secrets in telemetry",
    checkId: "secrets-in-telemetry",
    severity: "Critical",
    status: "Open",
    dataStoreId: STORE_ID,
  };
}

const asService: <T extends BaseModel>(
  service: unknown,
) => DatabaseService<T> = <T extends BaseModel>(
  service: unknown,
): DatabaseService<T> => {
  return service as DatabaseService<T>;
};

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;
let proposals: InMemoryTable;
let action: DataSecurityAiAction;

function passThroughSessions(): void {
  jest.spyOn(UserMiddleware, "getUserMiddleware").mockImplementation((async (
    _req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ) => {
    next();
  }) as never);
  jest
    .spyOn(UserMiddleware, "requireUserAuthentication")
    .mockImplementation((async (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ) => {
      next();
    }) as never);
}

beforeAll(async () => {
  passThroughSessions();

  server = new DashboardRequestsOverHttp();
  await server.start([
    new DataSecurityAPI().getRouter(),
    // The App serves proposals as it serves every model: BaseAPI.
    new BaseAPI<
      DataSecurityAiProposal,
      DatabaseService<DataSecurityAiProposal>
    >(
      DataSecurityAiProposal,
      asService<DataSecurityAiProposal>(DataSecurityAiProposalService),
    ).getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  caller = callerWith([Permission.ProjectOwner]);

  everyServerProductIsOn();
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });

  proposals = useInMemoryTable(asService(DataSecurityAiProposalService), [
    storedProposal(),
  ]);
  useInMemoryTable(asService(DataSecurityIssueService), [storedIssue()]);

  // The claims, as Postgres answers them: the WHERE decides.
  jest
    .spyOn(DataSecurityAiProposalService, "attemptTransition")
    .mockImplementation((async (data: {
      fromStatuses: ReadonlyArray<string>;
      set: DataSecurityAiProposalTransitionSet;
    }) => {
      const row: StoredRow = proposals.rows[0]!;

      if (!data.fromStatuses.includes(row["status"] as string)) {
        return 0;
      }

      Object.assign(row, data.set, { version: (row["version"] as number) + 1 });
      return 1;
    }) as never);

  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    id: PROJECT_ID,
    requireTwoApprovalsForRiskierFixes: false,
  } as unknown as Project);

  // Scrub It decides who may make and delete the rule; making it is stood in for.
  action = {
    ...ScrubTelemetryAction,
    apply: jest.fn(async () => {
      return {
        result: { rules: [] },
        summaryMarkdown: "Scrub rules made: **Data Security: Password**.",
      };
    }) as never,
    undo: jest.fn(async () => {
      return { summaryMarkdown: "Scrub rules deleted." };
    }) as never,
  };
  jest.spyOn(DataSecurityAiActions, "get").mockImplementation(() => {
    return action;
  });

  jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);
  jest
    .spyOn(DataStoreFeedService, "createDataStoreFeedItem")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  passThroughSessions();
});

async function press(
  role: Array<Permission>,
  route: string,
  body: JSONObject = {},
): Promise<SentRequest> {
  caller = callerWith(role);

  return await server.request("POST", `/api${route}`, body);
}

function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = (sent.answer || {}) as JSONObject;
  return String(answer["error"] || answer["message"] || "");
}

function statusOfProposal(): string {
  return proposals.rows[0]!["status"] as string;
}

describe("who may approve a proposal to make a log scrub rule", () => {
  test.each(ROLES)("$name", async (role: Role) => {
    const sent: SentRequest = await press(
      role.permissions,
      DATA_SECURITY_API_ROUTES.approveAiProposal(PROPOSAL_ID),
    );

    if (!role.reads) {
      expect(sent.status).toBeGreaterThanOrEqual(400);
      expect(sent.status).toBeLessThan(500);
      expect(statusOfProposal()).toBe(DataSecurityAiProposalStatus.Proposed);
      expect(action.apply).not.toHaveBeenCalled();
      return;
    }

    if (!role.makesLogRules) {
      // Refused with what the change itself takes, and nothing claimed.
      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 422,
        refusal:
          "Approving this makes log scrub rules, and you do not have permission to create them. Ask a Project Owner or Project Admin, or for Create Project Log Scrub Rule.",
      });
      expect(statusOfProposal()).toBe(DataSecurityAiProposalStatus.Proposed);
      expect(action.apply).not.toHaveBeenCalled();
      return;
    }

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 200,
      refusal: "",
    });
    expect((sent.answer as JSONObject)["status"]).toBe(
      DataSecurityAiProposalStatus.Applied,
    );
    expect(statusOfProposal()).toBe(DataSecurityAiProposalStatus.Applied);
    // Made with the person's own props.
    expect(
      (
        (action.apply as jest.Mock).mock.calls[0]![0] as {
          actor: { props: DatabaseCommonInteractionProps };
        }
      ).actor.props.userId?.toString(),
    ).toBe(caller.userId?.toString());
  });

  test("a project member is refused by the route itself", async () => {
    const sent: SentRequest = await press(
      [Permission.ProjectMember],
      DATA_SECURITY_API_ROUTES.approveAiProposal(PROPOSAL_ID),
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 422,
      refusal: PERMISSION_MESSAGE,
    });
  });
});

describe("who may dismiss a proposal", () => {
  test.each(ROLES)("$name", async (role: Role) => {
    const sent: SentRequest = await press(
      role.permissions,
      DATA_SECURITY_API_ROUTES.dismissAiProposal(PROPOSAL_ID),
      { reason: "Support searches logs by this field." },
    );

    if (role.reads && role.changesIssues) {
      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      expect(proposals.rows[0]).toMatchObject({
        status: DataSecurityAiProposalStatus.Dismissed,
        dismissReason: "Support searches logs by this field.",
      });
      return;
    }

    expect(sent.status).toBeGreaterThanOrEqual(400);
    expect(sent.status).toBeLessThan(500);
    expect(statusOfProposal()).toBe(DataSecurityAiProposalStatus.Proposed);
  });
});

describe("who may undo a change OneUptime AI made without asking", () => {
  beforeEach(() => {
    proposals.rows[0]!["status"] =
      DataSecurityAiProposalStatus.AppliedWithoutAsking;
  });

  test.each(ROLES)("$name", async (role: Role) => {
    const sent: SentRequest = await press(
      role.permissions,
      DATA_SECURITY_API_ROUTES.undoAiProposal(PROPOSAL_ID),
    );

    if (role.reads && role.makesLogRules) {
      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      expect(statusOfProposal()).toBe(DataSecurityAiProposalStatus.Undone);
      expect(action.undo).toHaveBeenCalledTimes(1);
      return;
    }

    expect(sent.status).toBeGreaterThanOrEqual(400);
    expect(sent.status).toBeLessThan(500);
    expect(statusOfProposal()).toBe(
      DataSecurityAiProposalStatus.AppliedWithoutAsking,
    );
    expect(action.undo).not.toHaveBeenCalled();
  });
});

describe("who reads proposals through the API", () => {
  test.each(ROLES)("$name", async (role: Role) => {
    caller = callerWith(role.permissions);

    const sent: SentRequest = await server.request(
      "POST",
      "/api/data-security-ai-proposal/get-list",
      {
        query: {},
        select: { _id: true, title: true, status: true },
        limit: 10,
        skip: 0,
      },
    );
    const rows: Array<JSONObject> = (((sent.answer || {}) as JSONObject)[
      "data"
    ] || []) as Array<JSONObject>;

    if (role.reads) {
      expect(sent.status).toBe(200);
      expect(
        rows.map((row: JSONObject) => {
          return row["title"];
        }),
      ).toEqual([
        "Scrub Password in attributes.user.password of checkout logs",
      ]);
      return;
    }

    expect(rows).toEqual([]);
  });

  test("nobody writes one through the API: OneUptime alone does", async () => {
    caller = callerWith([Permission.ProjectOwner]);

    const created: SentRequest = await server.request(
      "POST",
      "/api/data-security-ai-proposal",
      {
        data: {
          projectId: PROJECT_ID.toString(),
          title: "Make everything public",
        },
      },
    );

    expect(created.status).toBeGreaterThanOrEqual(400);
    expect(proposals.inserts).toEqual([]);
  });
});

describe("while the server has Data Security switched off", () => {
  test("nothing is approved, dismissed or undone", async () => {
    jest
      .spyOn(ServerProducts, "getOff")
      .mockResolvedValue({ [ProductKey.DataSecurity]: true } as never);

    for (const route of [
      DATA_SECURITY_API_ROUTES.approveAiProposal(PROPOSAL_ID),
      DATA_SECURITY_API_ROUTES.dismissAiProposal(PROPOSAL_ID),
      DATA_SECURITY_API_ROUTES.undoAiProposal(PROPOSAL_ID),
    ]) {
      const sent: SentRequest = await press([Permission.ProjectOwner], route, {
        reason: "No.",
      });

      expect(sent.status).toBeGreaterThanOrEqual(400);
    }

    expect(statusOfProposal()).toBe(DataSecurityAiProposalStatus.Proposed);
    expect(action.apply).not.toHaveBeenCalled();
  });
});
