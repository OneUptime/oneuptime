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
import Queue from "../../../Server/Infrastructure/Queue";
import logger from "../../../Server/Utils/Logger";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import DataSecurityAiProposalService, {
  DataSecurityAiProposalTransitionSet,
} from "../../../Server/Services/DataSecurityAiProposalService";
import DataSecurityIssueFeedService from "../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../Server/Services/DataSecurityIssueService";
import DataStoreFeedService from "../../../Server/Services/DataStoreFeedService";
import DataStoreOwnerRuleEngineService from "../../../Server/Services/DataStoreOwnerRuleEngineService";
import DataStoreOwnerRuleService from "../../../Server/Services/DataStoreOwnerRuleService";
import DataStoreOwnerTeamService from "../../../Server/Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../../Server/Services/DataStoreOwnerUserService";
import DataStoreService from "../../../Server/Services/DataStoreService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataSecurityAiProposal from "../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DataSecurityAiChangeSafety,
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
  DataSecurityAiWork,
  getDataSecurityAiPlanFingerprint,
} from "../../../Types/DataSecurity/DataSecurityAi";
import { DATA_SECURITY_API_ROUTES } from "../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  DataStoreOwnerConfidence,
  DataStoreOwnerEvidenceSource,
  DataStoreOwnerKind,
  DataStoreOwnerRulePlan,
  DataStoreOwnersPlan,
} from "../../../Types/DataSecurity/DataStoreOwnerProposal";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
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
 * APPROVE, CHANGE FIRST, DISMISS AND UNDO ONEUPTIME AI'S OWNERS, THROUGH
 * THE SERVER'S OWN ROUTES (#10374): Express, the route's permission list,
 * DataSecurityAPI, DataSecurityAiProposals and the owner actions as they
 * ship, writing owner rows, owner rules and proposals into tables held in
 * memory through the real services - the permission layer, the hooks and
 * the project's reference checks. For each role: who reads an owner
 * proposal, approves it (what adding a store's owners takes), changes it
 * first, dismisses it (what changing the issue takes) and undoes it (what
 * removing owners takes); an owner rule's one approval owning every store
 * it matches and the next one found; and no owner ever added without one.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10374000-0000-4000-8000-000000000001",
);
const PROPOSAL_ID: string = "10374000-0000-4000-8000-0000000003a1";
const RULE_PROPOSAL_ID: string = "10374000-0000-4000-8000-0000000003a2";
const ISSUE_ID: string = "10374000-0000-4000-8000-0000000000a1";
const PAYMENTS_ID: string = "10374000-0000-4000-8000-0000000000c1";
const PLATFORM_ID: string = "10374000-0000-4000-8000-0000000000c2";
const OTHER_PROJECTS_TEAM_ID: string = "10374000-0000-4000-8000-0000000000c9";
const ALICE_ID: string = "10374000-0000-4000-8000-0000000000d1";

function storeId(index: number): string {
  return `10374000-0000-4000-8000-0000000000b${index}`;
}

interface Role {
  name: string;
  permissions: Array<Permission>;
  // Reads an owner proposal: the issue's readers.
  reads: boolean;
  // May add, and remove, a store's team owners.
  ownsStores: boolean;
  // May create owner rules.
  makesRules: boolean;
  // May change the issue: dismiss.
  changesIssues: boolean;
}

const ROLES: Array<Role> = [
  {
    name: "a project owner",
    permissions: [Permission.ProjectOwner],
    reads: true,
    ownsStores: true,
    makesRules: true,
    changesIssues: true,
  },
  {
    name: "a project admin",
    permissions: [Permission.ProjectAdmin],
    reads: true,
    ownsStores: true,
    makesRules: true,
    changesIssues: true,
  },
  {
    name: "a project member",
    permissions: [Permission.ProjectMember],
    reads: false,
    ownsStores: false,
    makesRules: false,
    changesIssues: false,
  },
  {
    name: "a viewer",
    permissions: [Permission.Viewer],
    reads: false,
    ownsStores: false,
    makesRules: false,
    changesIssues: false,
  },
  {
    name: "a security admin",
    permissions: [Permission.SecurityAdmin],
    reads: true,
    ownsStores: true,
    makesRules: true,
    changesIssues: true,
  },
  {
    name: "a security member",
    permissions: [Permission.SecurityMember],
    reads: true,
    ownsStores: true,
    makesRules: true,
    changesIssues: true,
  },
  {
    name: "a security viewer",
    permissions: [Permission.SecurityViewer],
    reads: true,
    ownsStores: false,
    makesRules: false,
    changesIssues: false,
  },
  {
    name: "a custom role that reads issues and their proposals",
    permissions: [
      Permission.ReadDataSecurityIssue,
      Permission.ReadDataSecurityAiProposal,
    ],
    reads: true,
    ownsStores: false,
    makesRules: false,
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

function ownersPlan(): DataStoreOwnersPlan {
  const payments: DataStoreOwnersPlan["owners"][number] = {
    kind: DataStoreOwnerKind.Team,
    id: PAYMENTS_ID,
    ref: "T1",
    name: "Payments",
    evidenceIds: ["E1"],
    canOpenStore: true,
  };

  return {
    dataStoreId: storeId(1),
    dataStoreName: "payments-ledger",
    owners: [payments],
    confidence: DataStoreOwnerConfidence.High,
    reason: "The team tag names Payments.",
    disagreement: "",
    restsOn: ["E1"],
    evidence: [
      {
        id: "E1",
        source: DataStoreOwnerEvidenceSource.CloudTag,
        tagKey: "team",
        tagValue: "payments",
        owners: [{ kind: DataStoreOwnerKind.Team, id: PAYMENTS_ID }],
      },
    ],
    candidates: [payments],
    ruleFacts: [{ kind: "CloudTag", key: "team", value: "payments" }],
    isSensitive: true,
  };
}

function rulePlan(): DataStoreOwnerRulePlan {
  return {
    fact: { kind: "CloudTag", key: "team", value: "payments" },
    ruleName: "Payments owns stores tagged team=payments",
    cloudTagPattern: "^team=payments$",
    owners: [
      { kind: DataStoreOwnerKind.Team, id: PAYMENTS_ID, name: "Payments" },
    ],
    dataStoreIds: [storeId(1), storeId(2), storeId(3)],
    preview: {
      matchingStores: 4,
      alreadyOwned: 1,
      storeNames: ["payments-ledger"],
      previewedAt: "2026-11-21T00:00:00.000Z",
    },
  };
}

function storedProposal(overrides: StoredRow = {}): StoredRow {
  return {
    _id: PROPOSAL_ID,
    version: 1,
    projectId: PROJECT_ID.toString(),
    dataSecurityIssueId: ISSUE_ID,
    dataStoreId: storeId(1),
    kind: DataSecurityAiProposalKind.SetStoreOwners,
    work: DataSecurityAiWork.Judge,
    safety: DataSecurityAiChangeSafety.ChangesWhoIsTold,
    status: DataSecurityAiProposalStatus.Proposed,
    title: "Make Payments the owner of payments-ledger",
    plan: ownersPlan() as unknown as JSONObject,
    ...overrides,
  };
}

function storedRuleProposal(overrides: StoredRow = {}): StoredRow {
  return {
    _id: RULE_PROPOSAL_ID,
    version: 1,
    projectId: PROJECT_ID.toString(),
    kind: DataSecurityAiProposalKind.CreateOwnerRule,
    work: DataSecurityAiWork.Judge,
    safety: DataSecurityAiChangeSafety.ChangesWhoIsTold,
    status: DataSecurityAiProposalStatus.Proposed,
    title: "Make Payments the owner of every store tagged team=payments",
    plan: rulePlan() as unknown as JSONObject,
    ...overrides,
  };
}

function storeRows(): Array<StoredRow> {
  return [1, 2, 3, 4, 5].map((index: number): StoredRow => {
    return {
      _id: storeId(index),
      projectId: PROJECT_ID.toString(),
      name: index === 1 ? "payments-ledger" : `bucket-${index}`,
      description: "",
      kind: "AWS S3 Bucket",
      isArchived: false,
      // Stores 1 to 4 are tagged team=payments; 5 is the platform team's.
      cloudTags: index <= 4 ? { team: "payments" } : { team: "platform" },
      labels: [],
    };
  });
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
let ownerTeams: InMemoryTable;
let ownerRules: InMemoryTable;

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
    storedRuleProposal(),
  ]);
  useInMemoryTable(asService(DataSecurityIssueService), [
    {
      _id: ISSUE_ID,
      projectId: PROJECT_ID.toString(),
      title: "Nobody owns this sensitive store",
      checkId: "no-owner",
      severity: "Medium",
      status: "Open",
      dataStoreId: storeId(1),
    },
  ]);
  useInMemoryTable(asService(DataStoreService), storeRows());
  ownerTeams = useInMemoryTable(asService(DataStoreOwnerTeamService), [
    // Store 4 has an owner already: the rule adds Payments beside it.
    {
      _id: "10374000-0000-4000-8000-0000000004a4",
      projectId: PROJECT_ID.toString(),
      dataStoreId: storeId(4),
      teamId: PLATFORM_ID,
    },
  ]);
  useInMemoryTable(asService(DataStoreOwnerUserService), []);
  ownerRules = useInMemoryTable(asService(DataStoreOwnerRuleService), []);
  useInMemoryTable(asService(TeamService), [
    { _id: PAYMENTS_ID, projectId: PROJECT_ID.toString(), name: "Payments" },
    { _id: PLATFORM_ID, projectId: PROJECT_ID.toString(), name: "Platform" },
    {
      _id: OTHER_PROJECTS_TEAM_ID,
      projectId: "10374000-0000-4000-8000-000000000999",
      name: "Somebody else's",
    },
  ]);
  useInMemoryTable(asService(UserService), [
    { _id: ALICE_ID, name: "Alice Example", email: "alice@acme.com" },
  ]);
  jest
    .spyOn(TeamMemberService, "isUserMemberOfProject")
    .mockImplementation(async (data: { userId: ObjectID }) => {
      return data.userId.toString() === ALICE_ID;
    });

  // The claims, as Postgres answers them: the WHERE decides, row by row.
  jest
    .spyOn(DataSecurityAiProposalService, "attemptTransition")
    .mockImplementation((async (data: {
      proposalId: ObjectID;
      fromStatuses: ReadonlyArray<string>;
      set: DataSecurityAiProposalTransitionSet;
    }) => {
      const row: StoredRow | undefined = proposals.get(data.proposalId);

      if (!row || !data.fromStatuses.includes(row["status"] as string)) {
        return 0;
      }

      Object.assign(row, data.set, { version: (row["version"] as number) + 1 });
      return 1;
    }) as never);
  jest
    .spyOn(DataSecurityAiProposalService, "expireWaitingOwnersForStore")
    .mockImplementation((async (data: { dataStoreId: ObjectID }) => {
      let expired: number = 0;

      for (const row of proposals.rows) {
        if (
          row["kind"] === DataSecurityAiProposalKind.SetStoreOwners &&
          row["status"] === DataSecurityAiProposalStatus.Proposed &&
          String(row["dataStoreId"]).toLowerCase() ===
            data.dataStoreId.toString().toLowerCase()
        ) {
          row["status"] = DataSecurityAiProposalStatus.Expired;
          expired++;
        }
      }

      return expired;
    }) as never);

  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    id: PROJECT_ID,
    requireTwoApprovalsForRiskierFixes: true,
  } as unknown as Project);
  jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);
  jest
    .spyOn(DataStoreFeedService, "createDataStoreFeedItem")
    .mockResolvedValue(undefined);
  // A store's link reads the dashboard's address from the server's settings.
  jest
    .spyOn(DataStoreService, "getDataStoreMarkdownLink")
    .mockResolvedValue(
      FeedMarkdown.asMarkdown("[Data Store payments-ledger](/store)"),
    );
  jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);
  /*
   * The teams, people and stores an owner row or rule names are the
   * project's, as the owner services check (ProjectReferenceCheck).
   */
  stubProjectDirectory({ projectId: PROJECT_ID });
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

function statusOf(id: string): string {
  return proposals.get(id)!["status"] as string;
}

function ownersOfStore(index: number): Array<string> {
  return ownerTeams.rows
    .filter((row: StoredRow): boolean => {
      return String(row["dataStoreId"]).toLowerCase() === storeId(index);
    })
    .map((row: StoredRow): string => {
      return String(row["teamId"]).toLowerCase();
    })
    .sort();
}

function fingerprintOf(id: string): string {
  const row: StoredRow = proposals.get(id)!;

  return getDataSecurityAiPlanFingerprint({
    kind: row["kind"],
    plan: row["plan"],
  });
}

describe("who may approve a store's owners", () => {
  test.each(ROLES)("$name", async (role: Role) => {
    const sent: SentRequest = await press(
      role.permissions,
      DATA_SECURITY_API_ROUTES.approveAiProposal(PROPOSAL_ID),
      { expectedPlanFingerprint: fingerprintOf(PROPOSAL_ID) },
    );

    if (!role.reads) {
      expect(sent.status).toBeGreaterThanOrEqual(400);
      expect(sent.status).toBeLessThan(500);
      expect(statusOf(PROPOSAL_ID)).toBe(DataSecurityAiProposalStatus.Proposed);
      expect(ownersOfStore(1)).toEqual([]);
      return;
    }

    if (!role.ownsStores) {
      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 422,
        refusal:
          "Approving this adds teams as owners of data stores, and you do not have permission to add them. Ask a Project Owner or Project Admin, or for Create Data Store Team Owner.",
      });
      expect(statusOf(PROPOSAL_ID)).toBe(DataSecurityAiProposalStatus.Proposed);
      expect(ownersOfStore(1)).toEqual([]);
      return;
    }

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 200,
      refusal: "",
    });
    expect(statusOf(PROPOSAL_ID)).toBe(DataSecurityAiProposalStatus.Applied);
    // The owner is added, as the person, and told as any owner is.
    expect(ownersOfStore(1)).toEqual([PAYMENTS_ID]);

    const added: StoredRow = ownerTeams.rows.find((row: StoredRow) => {
      return String(row["dataStoreId"]).toLowerCase() === storeId(1);
    })!;

    /*
     * Not marked told: the column starts false in Postgres, so the
     * owner-added job tells the new owner, as it tells any.
     */
    expect(added["isOwnerNotified"]).not.toBe(true);
    expect(String(added["createdByUserId"] || "")).toBe(
      caller.userId?.toString(),
    );
    // One approval is enough, even where riskier changes take two.
    expect((sent.answer as JSONObject)["waitsForSecondApproval"]).toBe(false);
    // The store is checked again: "Nobody owns this sensitive store" decides.
    expect(Queue.addJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "DataSecurity:EvaluateProject",
      expect.anything(),
      expect.anything(),
    );
  });
});

describe("changing a store's owners before approving", () => {
  test("the owners a person picks are added instead, and the timeline says it was changed", async () => {
    const sent: SentRequest = await press(
      [Permission.SecurityMember],
      DATA_SECURITY_API_ROUTES.approveAiProposal(PROPOSAL_ID),
      {
        expectedPlanFingerprint: fingerprintOf(PROPOSAL_ID),
        changes: {
          owners: [{ kind: DataStoreOwnerKind.Team, id: PLATFORM_ID }],
        },
      },
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 200,
      refusal: "",
    });
    expect(ownersOfStore(1)).toEqual([PLATFORM_ID]);
    expect(proposals.get(PROPOSAL_ID)!["result"]).toMatchObject({
      changedBeforeApproving: true,
      approvedOwners: [
        { kind: DataStoreOwnerKind.Team, id: PLATFORM_ID, name: "Platform" },
      ],
    });
    expect(
      (
        DataStoreFeedService.createDataStoreFeedItem as jest.Mock
      ).mock.calls.some((call: Array<unknown>): boolean => {
        return String(
          (call[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown,
        ).includes("after changing it");
      }),
    ).toBe(true);
  });

  test("a team of another project is refused in words, and nothing is added", async () => {
    const sent: SentRequest = await press(
      [Permission.SecurityMember],
      DATA_SECURITY_API_ROUTES.approveAiProposal(PROPOSAL_ID),
      {
        changes: {
          owners: [
            { kind: DataStoreOwnerKind.Team, id: OTHER_PROJECTS_TEAM_ID },
          ],
        },
      },
    );

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toContain("is no longer a team of this project");
    expect(statusOf(PROPOSAL_ID)).toBe(DataSecurityAiProposalStatus.Proposed);
    expect(ownersOfStore(1)).toEqual([]);
  });

  test("picking nobody is refused: dismiss it instead", async () => {
    const sent: SentRequest = await press(
      [Permission.SecurityMember],
      DATA_SECURITY_API_ROUTES.approveAiProposal(PROPOSAL_ID),
      { changes: { owners: [] } },
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 400,
      refusal: "Pick at least one owner, or dismiss the proposal instead.",
    });
  });

  test("a person the reader may not add as an owner is refused for them", async () => {
    const sent: SentRequest = await press(
      [Permission.SecurityViewer],
      DATA_SECURITY_API_ROUTES.approveAiProposal(PROPOSAL_ID),
      {
        changes: { owners: [{ kind: DataStoreOwnerKind.User, id: ALICE_ID }] },
      },
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 422,
      refusal:
        "Approving this adds people as owners of data stores, and you do not have permission to add them. Ask a Project Owner or Project Admin, or for Create Data Store User Owner.",
    });
  });

  test("an owner rule is approved as it was proposed", async () => {
    const sent: SentRequest = await press(
      [Permission.ProjectOwner],
      DATA_SECURITY_API_ROUTES.approveAiProposal(RULE_PROPOSAL_ID),
      {
        changes: {
          owners: [{ kind: DataStoreOwnerKind.Team, id: PLATFORM_ID }],
        },
      },
    );

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toContain("approved as OneUptime AI proposed it");
    expect(ownerRules.rows).toEqual([]);
  });
});

describe("who may dismiss a store's owners", () => {
  test.each(ROLES)("$name", async (role: Role) => {
    const sent: SentRequest = await press(
      role.permissions,
      DATA_SECURITY_API_ROUTES.dismissAiProposal(PROPOSAL_ID),
      { reason: "Payments moved this bucket to the data team." },
    );

    if (role.reads && role.changesIssues) {
      expect(sent.status).toBe(200);
      expect(proposals.get(PROPOSAL_ID)).toMatchObject({
        status: DataSecurityAiProposalStatus.Dismissed,
        dismissReason: "Payments moved this bucket to the data team.",
      });
      return;
    }

    expect(sent.status).toBeGreaterThanOrEqual(400);
    expect(sent.status).toBeLessThan(500);
    expect(statusOf(PROPOSAL_ID)).toBe(DataSecurityAiProposalStatus.Proposed);
  });
});

describe("who may undo a store's owners", () => {
  // Approved, as a project owner: Payments owns store 1.
  async function approveFirst(): Promise<void> {
    const approved: SentRequest = await press(
      [Permission.ProjectOwner],
      DATA_SECURITY_API_ROUTES.approveAiProposal(PROPOSAL_ID),
    );

    expect(approved.status).toBe(200);
    expect(ownersOfStore(1)).toEqual([PAYMENTS_ID]);
  }

  test.each(ROLES)("$name", async (role: Role) => {
    await approveFirst();

    const sent: SentRequest = await press(
      role.permissions,
      DATA_SECURITY_API_ROUTES.undoAiProposal(PROPOSAL_ID),
    );

    if (role.reads && role.ownsStores) {
      expect(sent.status).toBe(200);
      expect(statusOf(PROPOSAL_ID)).toBe(DataSecurityAiProposalStatus.Undone);
      // Exactly what the approval added goes.
      expect(ownersOfStore(1)).toEqual([]);
      return;
    }

    expect(sent.status).toBeGreaterThanOrEqual(400);
    expect(sent.status).toBeLessThan(500);
    expect(statusOf(PROPOSAL_ID)).toBe(DataSecurityAiProposalStatus.Applied);
    expect(ownersOfStore(1)).toEqual([PAYMENTS_ID]);
  });

  test("an owner someone added by hand after it is never taken back", async () => {
    await approveFirst();
    ownerTeams.rows.push({
      _id: "10374000-0000-4000-8000-0000000004b1",
      projectId: PROJECT_ID.toString(),
      dataStoreId: storeId(1),
      teamId: PLATFORM_ID,
    });

    const sent: SentRequest = await press(
      [Permission.ProjectOwner],
      DATA_SECURITY_API_ROUTES.undoAiProposal(PROPOSAL_ID),
    );

    expect(sent.status).toBe(200);
    expect(ownersOfStore(1)).toEqual([PLATFORM_ID]);
  });
});

describe("an owner rule: one approval for every such store, and the next one", () => {
  test.each(ROLES)("who may approve it: $name", async (role: Role) => {
    const sent: SentRequest = await press(
      role.permissions,
      DATA_SECURITY_API_ROUTES.approveAiProposal(RULE_PROPOSAL_ID),
      { expectedPlanFingerprint: fingerprintOf(RULE_PROPOSAL_ID) },
    );

    if (role.reads && role.makesRules && role.ownsStores) {
      expect(sent.status).toBe(200);
      expect(ownerRules.rows).toHaveLength(1);
      return;
    }

    expect(sent.status).toBeGreaterThanOrEqual(400);
    expect(sent.status).toBeLessThan(500);
    expect(ownerRules.rows).toEqual([]);
    expect(ownersOfStore(1)).toEqual([]);
  });

  test("approving it saves the rule and sets Payments on every store tagged team=payments", async () => {
    const sent: SentRequest = await press(
      [Permission.SecurityMember],
      DATA_SECURITY_API_ROUTES.approveAiProposal(RULE_PROPOSAL_ID),
      { expectedPlanFingerprint: fingerprintOf(RULE_PROPOSAL_ID) },
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 200,
      refusal: "",
    });
    expect(ownerRules.rows).toHaveLength(1);
    expect(ownerRules.rows[0]).toMatchObject({
      name: "Payments owns stores tagged team=payments",
      cloudTagPattern: "^team=payments$",
      isEnabled: true,
      notifyOwners: true,
    });

    for (const index of [1, 2, 3]) {
      expect(ownersOfStore(index)).toEqual([PAYMENTS_ID]);
    }

    // The store that had an owner gets Payments beside it.
    expect(ownersOfStore(4)).toEqual([PAYMENTS_ID, PLATFORM_ID].sort());
    // The platform team's store is no store of this rule.
    expect(ownersOfStore(5)).toEqual([]);
    expect(statusOf(RULE_PROPOSAL_ID)).toBe(
      DataSecurityAiProposalStatus.Applied,
    );
    // The store's own owner proposal is no longer needed.
    expect(statusOf(PROPOSAL_ID)).toBe(DataSecurityAiProposalStatus.Expired);
  });

  test("the next store tagged team=payments is owned the day it is found", async () => {
    await press(
      [Permission.ProjectOwner],
      DATA_SECURITY_API_ROUTES.approveAiProposal(RULE_PROPOSAL_ID),
    );

    const ruleRow: StoredRow = ownerRules.rows[0]!;

    /*
     * The engine reads the rule as Postgres hands it back, with its owners
     * joined as models.
     */
    ruleRow["ownerTeams"] = [
      { _id: PAYMENTS_ID, id: new ObjectID(PAYMENTS_ID) },
    ];
    ruleRow["ownerUsers"] = [];

    const found: StoredRow = {
      _id: storeId(6),
      projectId: PROJECT_ID.toString(),
      name: "payments-refunds",
      description: "",
      isArchived: false,
      cloudTags: { team: "payments" },
      labels: [],
    };

    useInMemoryTable(asService(DataStoreService), [...storeRows(), found]);

    const store: DataStore = new DataStore();
    store.id = new ObjectID(storeId(6));
    store.projectId = PROJECT_ID;

    // The engine logs what it could not do, rather than throwing it.
    (logger.error as unknown as jest.Mock).mockClear();

    await DataStoreOwnerRuleEngineService.applyRulesToDataStore(store);

    expect(logger.error).not.toHaveBeenCalled();
    expect(ownersOfStore(6)).toEqual([PAYMENTS_ID]);
  });

  test("undo deletes the rule and the owners it added when it was approved", async () => {
    await press(
      [Permission.ProjectOwner],
      DATA_SECURITY_API_ROUTES.approveAiProposal(RULE_PROPOSAL_ID),
    );

    const sent: SentRequest = await press(
      [Permission.SecurityMember],
      DATA_SECURITY_API_ROUTES.undoAiProposal(RULE_PROPOSAL_ID),
    );

    expect(sent.status).toBe(200);
    expect(ownerRules.rows).toEqual([]);

    for (const index of [1, 2, 3]) {
      expect(ownersOfStore(index)).toEqual([]);
    }

    // The owner store 4 had before the rule stays.
    expect(ownersOfStore(4)).toEqual([PLATFORM_ID]);
    expect(statusOf(RULE_PROPOSAL_ID)).toBe(
      DataSecurityAiProposalStatus.Undone,
    );
  });
});

describe("who reads owner proposals through the API", () => {
  test.each(ROLES)("$name", async (role: Role) => {
    caller = callerWith(role.permissions);

    const sent: SentRequest = await server.request(
      "POST",
      "/api/data-security-ai-proposal/get-list",
      {
        query: {},
        select: { _id: true, title: true, kind: true },
        limit: 10,
        skip: 0,
      },
    );

    if (role.reads) {
      expect(sent.status).toBe(200);
    }

    const titles: Array<string> = (
      (((sent.answer || {}) as JSONObject)["data"] || []) as Array<JSONObject>
    )
      .map((row: JSONObject): string => {
        return String(row["title"]);
      })
      .sort();

    expect(titles).toEqual(
      role.reads
        ? [
            "Make Payments the owner of every store tagged team=payments",
            "Make Payments the owner of payments-ledger",
          ]
        : [],
    );
  });
});
