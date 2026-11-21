import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * BLOCKING ONE OF A CASE'S ADDRESSES FROM ITS RESPONSE PLAN, AND LIFTING THE
 * BLOCK, THROUGH THE ROUTES THE CASE'S CARD CALLS (#10342):
 *
 *   POST /security-playbook-run/block-address  a one-step run of the
 *        playbook engine that blocks the address: Block for 24 Hours,
 *        Challenge Instead, Block for 7 Days, Block Until Lifted
 *   PUT  /security-block/:id                   Lift, as the Blocklist lifts
 *
 * Who may: Project Owner, Project Admin, Security Admin and Security Member
 * block - the permission to run playbooks and the permission to block - and
 * lift; Security Viewer and a member with no Security role do neither. The
 * approval rule is a playbook's: a Security Member's block waits for
 * someone else's approval; a Security Admin's, a Project Admin's and a
 * Project Owner's runs at once, stamped as theirs. Only they keep a block
 * until someone lifts it.
 *
 * Refused, saying why, before any run is started: an address the case's
 * requests only claimed (#10416), a private one, one that is no address of
 * the case, a protected one, one a block already covers, and a second block
 * of an address while the first waits.
 *
 * Nothing is stubbed between the routes and the tables but the tables, held
 * in memory: the caller's permission rows go through the real permission
 * layer, the run through the run service's real create. What lies past the
 * run - the engine's queue, the case's timeline, its requests, what protects
 * an address - stands in for itself.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
    },
  };
});

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

import CommonAPI from "../../../Server/API/CommonAPI";
import SecurityBlockAPI from "../../../Server/API/SecurityBlockAPI";
import SecurityPlaybookRunAPI, {
  ONE_STEP_BLOCK_REFUSED_MESSAGE,
  SECURITY_PLAYBOOK_ONE_STEP_BLOCK_PATH,
} from "../../../Server/API/SecurityPlaybookRunAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import SecurityBlockService from "../../../Server/Services/SecurityBlockService";
import SecurityCaseFeedService from "../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import SecurityPlaybookRunService from "../../../Server/Services/SecurityPlaybookRunService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SecurityCaseMatches from "../../../Server/Utils/SecurityCase/Context/SecurityCaseMatches";
import SecurityCaseStepChecks from "../../../Server/Utils/SecurityCase/StepChecks/SecurityCaseStepChecks";
import SecurityBlocklistJobs from "../../../Server/Utils/SecurityBlocklist/SecurityBlocklistJobs";
import SecurityProtectedAddresses from "../../../Server/Utils/SecurityBlocklist/SecurityProtectedAddresses";
import {
  MATCHES_UNREAD_MESSAGE,
  NOT_BLOCKABLE_MESSAGE,
} from "../../../Server/Utils/SecurityPlaybook/SecurityPlaybookOneStepRuns";
import SecurityPlaybookEngine from "../../../Server/Utils/SecurityPlaybook/SecurityPlaybookEngine";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockIndicatorType,
  SecurityBlockSource,
  SecurityBlockState,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityProtectedAddressSource } from "../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchesJson,
} from "../../../Types/SecurityCase/SecurityCaseMatches";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { readOneStepRun } from "../../../Types/SecurityPlaybook/SecurityPlaybookOneStepRun";
import SecurityPlaybookRunStatus from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookStep,
  doesStepNeedApproval,
  parseSecurityPlaybookSteps,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import SecurityPlaybookTrigger from "../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { customDomainCaller } from "./CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryHookFreeWrites,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import AuditLogService from "../../../Server/Services/AuditLogService";
import SecurityBlockEnforcementService from "../../../Server/Services/SecurityBlockEnforcementService";
import SecurityProtectedEntityService from "../../../Server/Services/SecurityProtectedEntityService";
import SecurityCaseNotifications from "../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import SecurityBlockDestinations from "../../../Server/Utils/SecurityBlocklist/SecurityBlockDestinations";
import SecurityBlocklistReconciler from "../../../Server/Utils/SecurityBlocklist/SecurityBlocklistReconciler";
import TestSecurityBlockDestination from "../../../Server/Utils/SecurityBlocklist/TestSecurityBlockDestination";
import { SELF_APPROVAL_REFUSED_MESSAGE } from "../../../Server/Utils/SecurityPlaybook/SecurityPlaybookRunDecision";
import WorkspaceSecurityPlaybookApprovalMessages from "../../../Server/Utils/Workspace/WorkspaceSecurityPlaybookApprovalMessages";
import SecurityBlockEnforcement from "../../../Models/DatabaseModels/SecurityBlockEnforcement";
import {
  SecurityBlockDestinationProvider,
  SecurityBlockEnforcementState,
} from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { SecurityPlaybookStepStatus } from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookStepResult,
  readStepResults,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "6d2f8b51-6d3e-4f90-8b72-8e1d3c5f7a01",
);
const CASE_ID: string = "6d2f8b51-6d3e-4f90-8b72-8e1d3c5f7a02";
const BLOCK_ID: string = "6d2f8b51-6d3e-4f90-8b72-8e1d3c5f7a03";

// The scanner the case is about, and an address its requests only claimed.
const ADDRESS: string = "35.205.11.131";
const CLAIMED: string = "198.51.100.23";

const HOUR_IN_MS: number = 60 * 60 * 1000;

const BLOCKERS: Array<[string, Permission]> = [
  ["Project Owner", Permission.ProjectOwner],
  ["Project Admin", Permission.ProjectAdmin],
  ["Security Admin", Permission.SecurityAdmin],
  ["Security Member", Permission.SecurityMember],
];

// Those who may let a containment step run without approval, and keep a block until lifted.
const ADMINS: Array<[string, Permission]> = BLOCKERS.slice(0, 3);

const NOT_BLOCKERS: Array<[string, Permission]> = [
  ["Security Viewer", Permission.SecurityViewer],
  ["Project Member", Permission.ProjectMember],
  ["Project Viewer", Permission.Viewer],
];

let props: DatabaseCommonInteractionProps;
let runs: InMemoryTable;
let blocks: InMemoryTable;
let cases: InMemoryTable;
let matches: SecurityCaseMatchesJson | null;
let enqueue: MockedFn;

const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;

function caller(permission: Permission): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: [permission], projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function caseRow(): StoredRow {
  return {
    _id: CASE_ID,
    projectId: PROJECT_ID.toString(),
    title: `Path traversal attempts - ${ADDRESS}`,
    caseNumberWithPrefix: "SEC-52",
    entities: [
      { type: SecurityEntityType.IpAddress, value: ADDRESS },
      { type: SecurityEntityType.IpAddress, value: "10.0.4.12" },
    ],
    createdAt: new Date(Date.now() - HOUR_IN_MS),
    version: 1,
  };
}

// The detection that opened the case: its requests came from the scanner, one claimed another address.
function detection(): SecurityCaseMatchedDetectionJson {
  return {
    id: "6d2f8b51-6d3e-4f90-8b72-8e1d3c5f7a04",
    source: "Detection Rule",
    title: `Path traversal attempts - ${ADDRESS}`,
    severity: "Medium",
    groupValue: ADDRESS,
    ruleName: "Path traversal attempts",
    eventCount: 2,
    fireCount: 1,
    firstSeenAt: new Date(Date.now() - HOUR_IN_MS).toISOString(),
    lastSeenAt: new Date().toISOString(),
    sampleMessage: "",
    isOpening: true,
    rule: null,
    threatIntelFeedId: "",
    securityEventConnectionId: "",
    basis: SecurityCaseMatchBasis.RuleCondition,
    windowStart: new Date(Date.now() - HOUR_IN_MS).toISOString(),
    windowEnd: new Date().toISOString(),
    events: [
      {
        id: "event-1",
        time: new Date().toISOString(),
        message: "GET /../../etc/passwd",
        principalIp: ADDRESS,
        traceId: "",
        spanId: "",
        attributes: {
          [SECURITY_REQUEST_ATTRIBUTES.claimedClientAddress]: CLAIMED,
        },
      },
    ],
    isKept: false,
    keptPastRetentionCount: 0,
    hiddenEventCount: 0,
    matchedEventCount: 2,
    outcomes: {},
  } as unknown as SecurityCaseMatchedDetectionJson;
}

function activeBlock(value: string): StoredRow {
  return {
    _id: BLOCK_ID,
    projectId: PROJECT_ID.toString(),
    value,
    indicatorType: value.includes("/")
      ? SecurityBlockIndicatorType.IpRange
      : SecurityBlockIndicatorType.IpAddress,
    action: SecurityBlockAction.Block,
    state: SecurityBlockState.Active,
    expiresAt: new Date(Date.now() + 24 * HOUR_IN_MS),
    source: SecurityBlockSource.Person,
    securityCaseId: CASE_ID,
    createdAt: new Date(Date.now() - HOUR_IN_MS),
    version: 1,
  };
}

// The route's answer: what it sent, or what it handed to next.
async function call(data: {
  method: "post" | "put";
  uri: string;
  params?: Record<string, string> | undefined;
  body?: JSONObject | undefined;
}): Promise<{ refusal: Exception | null }> {
  const req: ExpressRequest = {
    params: data.params || {},
    query: {},
    headers: {},
    body: data.body || {},
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {
    setHeader: jest.fn(),
  } as unknown as ExpressResponse;
  const next: MockedFn = jest.fn();

  await mockRouter
    .match(data.method, data.uri)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    refusal: (next.mock.calls[0]?.[0] as Exception | undefined) || null,
  };
}

async function block(
  body: JSONObject = {},
): Promise<{ refusal: Exception | null }> {
  return await call({
    method: "post",
    uri: `/security-playbook-run/${SECURITY_PLAYBOOK_ONE_STEP_BLOCK_PATH}`,
    body: { securityCaseId: CASE_ID, value: ADDRESS, ...body },
  });
}

function answered(): JSONObject {
  const calls: Array<Array<unknown>> = sendJsonObjectResponseMock.mock.calls;
  return calls[calls.length - 1]![2] as JSONObject;
}

function onlyRun(): StoredRow {
  expect(runs.rows).toHaveLength(1);
  return runs.rows[0]!;
}

function stepOf(run: StoredRow): SecurityPlaybookStep {
  return parseSecurityPlaybookSteps(run["steps"] as JSONArray)[0]!;
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new SecurityPlaybookRunAPI();
  new SecurityBlockAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  everyServerProductIsOn();

  runs = useInMemoryTable(
    SecurityPlaybookRunService as unknown as DatabaseService<BaseModel>,
    [],
  );
  blocks = useInMemoryTable(
    SecurityBlockService as unknown as DatabaseService<BaseModel>,
    [],
  );
  cases = useInMemoryTable(
    SecurityCaseService as unknown as DatabaseService<BaseModel>,
    [caseRow()],
  );
  matches = {
    detections: [detection()],
    detectionCount: 1,
    unreadableSources: [],
    failedSources: [],
  };

  /*
   * The run names the case and the person who asked: the project check
   * reads them where the run's records are, here the case's table and
   * the caller's membership of the project.
   */
  jest
    .spyOn(ProjectScopedReferenceValidator, "findIdsInProject")
    .mockImplementation(
      async (data: {
        projectId: ObjectID;
        ids: Array<string>;
      }): Promise<Set<string>> => {
        return new Set(
          data.ids
            .filter((id: string): boolean => {
              // The case, or the run a block names.
              const row: StoredRow | undefined = cases.get(id) || runs.get(id);

              return Boolean(
                row &&
                  String(row["projectId"]).toLowerCase() ===
                    data.projectId.toString().toLowerCase(),
              );
            })
            .map((id: string): string => {
              return id.toLowerCase();
            }),
        );
      },
    );
  jest
    .spyOn(ProjectScopedReferenceValidator, "findProjectMemberIds")
    .mockImplementation(
      async (data: { userIds: Array<string> }): Promise<Set<string>> => {
        return new Set(
          data.userIds.map((id: string): string => {
            return id.toLowerCase();
          }),
        );
      },
    );
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });
  jest
    .spyOn(SecurityCaseMatches, "build")
    .mockImplementation(async (): Promise<SecurityCaseMatchesJson> => {
      if (!matches) {
        throw new Error("the detections could not be read");
      }

      return matches;
    });
  jest
    .spyOn(SecurityProtectedAddresses, "findProtection")
    .mockResolvedValue({ protection: null, unreadSources: [] });
  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(SecurityBlocklistJobs, "queueReconcile")
    .mockResolvedValue(undefined);
  jest.spyOn(SecurityCaseStepChecks, "requestCheck").mockResolvedValue();
  enqueue = jest
    .spyOn(SecurityPlaybookEngine, "enqueueRun")
    .mockResolvedValue(undefined) as unknown as MockedFn;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Block for 24 Hours from a case's Response Plan", () => {
  test.each(ADMINS)(
    "a %s blocks at once: a one-step run with no playbook, stamped as theirs, queued",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { refusal } = await block();

      expect(refusal).toBeNull();

      const run: StoredRow = onlyRun();
      const step: SecurityPlaybookStep = stepOf(run);

      expect(run["securityPlaybookId"] ?? null).toBeNull();
      expect(run["playbookName"]).toBe("Block the address");
      expect(run["trigger"]).toBe(SecurityPlaybookTrigger.Manual);
      expect(String(run["triggeredByUserId"])).toBe(props.userId!.toString());
      expect(run["status"]).toBe(SecurityPlaybookRunStatus.Queued);
      expect(step.action).toBe(SecurityPlaybookActionType.BlockAddress);
      expect(step.config).toEqual({
        blockAction: SecurityBlockAction.Block,
        duration: SecurityBlockDuration.OneDay,
      });
      expect(doesStepNeedApproval(step)).toBe(false);
      expect(step.approvalTurnedOff?.byUserId).toBe(props.userId!.toString());
      expect(readOneStepRun(run)?.values).toEqual([ADDRESS]);
      expect(readOneStepRun(run)?.result?.targets).toEqual([
        {
          type: SecurityEntityType.IpAddress,
          value: ADDRESS,
          reason: SecurityPlaybookTargetReason.OnTheCase,
          state: SecurityPlaybookTargetState.Proposed,
        },
      ]);
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(answered()).toEqual({
        runId: String(run["_id"]),
        needsApproval: false,
      });
      // The engine makes the block: nothing is written to the blocklist here.
      expect(blocks.rows).toEqual([]);
      // A one-step run says nothing of a playbook starting.
      expect(SecurityCaseFeedService.createSecurityCaseFeedItem).not.toHaveBeenCalled();
    },
  );

  test("a Security Member's block waits for someone else's approval", async () => {
    props = caller(Permission.SecurityMember);

    const { refusal } = await block();

    expect(refusal).toBeNull();

    const step: SecurityPlaybookStep = stepOf(onlyRun());

    expect(step.requiresApproval).toBe(true);
    expect(step.approvalTurnedOff).toBeUndefined();
    expect(doesStepNeedApproval(step)).toBe(true);
    expect(answered()["needsApproval"]).toBe(true);
  });

  test.each(NOT_BLOCKERS)(
    "a %s may not, and no run is started",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { refusal } = await block();

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(refusal?.message).toBe(ONE_STEP_BLOCK_REFUSED_MESSAGE);
      expect(runs.rows).toEqual([]);
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  test("Challenge Instead and Block for 7 Days are the step's settings", async () => {
    props = caller(Permission.SecurityAdmin);

    await block({
      blockAction: SecurityBlockAction.Challenge,
      duration: SecurityBlockDuration.SevenDays,
    });

    expect(stepOf(onlyRun()).config).toEqual({
      blockAction: SecurityBlockAction.Challenge,
      duration: SecurityBlockDuration.SevenDays,
    });
  });

  test.each(ADMINS)(
    "a %s may block until someone lifts it",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { refusal } = await block({
        duration: SecurityBlockDuration.UntilLifted,
      });

      expect(refusal).toBeNull();
      expect(stepOf(onlyRun()).config["duration"]).toBe(
        SecurityBlockDuration.UntilLifted,
      );
    },
  );

  test("a Security Member may not block until someone lifts it", async () => {
    props = caller(Permission.SecurityMember);

    const { refusal } = await block({
      duration: SecurityBlockDuration.UntilLifted,
    });

    expect(refusal?.message).toContain("Only a Security Admin");
    expect(runs.rows).toEqual([]);
  });
});

describe("what is never blocked from a case", () => {
  beforeEach(() => {
    props = caller(Permission.ProjectOwner);
  });

  test("an address the case's requests only claimed is never offered, and refused if asked", async () => {
    const { refusal } = await block({ value: CLAIMED });

    expect(refusal?.message).toBe(NOT_BLOCKABLE_MESSAGE);
    expect(runs.rows).toEqual([]);
  });

  test("an address the case's requests only claimed, even when something names it as an entity", async () => {
    cases.rows[0]!["entities"] = [
      { type: SecurityEntityType.IpAddress, value: ADDRESS },
      { type: SecurityEntityType.IpAddress, value: CLAIMED },
    ];

    const { refusal } = await block({ value: CLAIMED });

    expect(refusal?.message).toBe(NOT_BLOCKABLE_MESSAGE);
  });

  test("a private address, and one that is no address of the case", async () => {
    for (const value of ["10.0.4.12", "203.0.113.99", "not-an-address"]) {
      const { refusal } = await block({ value });

      expect(refusal?.message).toBe(NOT_BLOCKABLE_MESSAGE);
    }

    expect(runs.rows).toEqual([]);
  });

  test("a protected address is refused with what protects it", async () => {
    jest.spyOn(SecurityProtectedAddresses, "findProtection").mockResolvedValue({
      protection: {
        source: SecurityProtectedAddressSource.CloudResource,
        protectedValue: ADDRESS,
        name: "prod-alb",
        kind: "load balancer",
        where: "Production",
      },
      unreadSources: [],
    });

    const { refusal } = await block();

    expect(refusal?.message).toBe(
      `${ADDRESS} is the address of load balancer prod-alb in Production.`,
    );
    expect(runs.rows).toEqual([]);
  });

  test("an address OneUptime cannot tell is the project's own is not blocked", async () => {
    jest.spyOn(SecurityProtectedAddresses, "findProtection").mockResolvedValue({
      protection: null,
      unreadSources: [SecurityProtectedAddressSource.Host],
    });

    const { refusal } = await block();

    expect(refusal?.message).toContain(ADDRESS);
    expect(refusal?.message).toContain("could not check");
    expect(runs.rows).toEqual([]);
  });

  test("an address a range already blocks says which", async () => {
    blocks.rows.push(activeBlock("35.205.11.0/24"));

    const { refusal } = await block();

    expect(refusal?.message).toContain("35.205.11.0/24");
    expect(runs.rows).toEqual([]);
  });

  test("a second block of the address while the first waits is refused", async () => {
    props = caller(Permission.SecurityMember);

    expect((await block()).refusal).toBeNull();
    runs.rows[0]!["status"] = SecurityPlaybookRunStatus.WaitingForApproval;

    const { refusal } = await block();

    expect(refusal?.message).toBe(
      `Block the address is already waiting or running for ${ADDRESS} on this case. Wait for it to finish, or cancel it first.`,
    );
    expect(runs.rows).toHaveLength(1);
  });

  test("once the first is done, the address can be asked for again", async () => {
    expect((await block()).refusal).toBeNull();
    runs.rows[0]!["status"] = SecurityPlaybookRunStatus.Succeeded;

    expect((await block()).refusal).toBeNull();
    expect(runs.rows).toHaveLength(2);
  });

  test("a case whose requests cannot be read is not blocked from: OneUptime says so", async () => {
    matches = null;

    const { refusal } = await block();

    expect(refusal?.message).toBe(MATCHES_UNREAD_MESSAGE);
    expect(runs.rows).toEqual([]);
  });

  test("a case of another project is not found", async () => {
    cases.rows[0]!["projectId"] = ObjectID.generate().toString();

    const { refusal } = await block();

    expect(refusal?.message).toBe("Security case not found.");
    expect(runs.rows).toEqual([]);
  });

  test("a request that names no case or no address is refused", async () => {
    expect(
      (await block({ securityCaseId: "not-an-id" })).refusal?.message,
    ).toBe("Name the case to block the address from.");
    expect((await block({ value: "" })).refusal?.message).toBe(
      "Name the address to block.",
    );
    expect(
      (await block({ blockAction: "Tarpit" })).refusal?.message,
    ).toBe("Choose Block or Challenge.");
    expect((await block({ duration: "Forever" })).refusal?.message).toContain(
      "Choose how long the block lasts",
    );
  });
});

describe("Lift from the step", () => {
  beforeEach(() => {
    blocks.rows.push(activeBlock(ADDRESS));
  });

  test.each(BLOCKERS)(
    "a %s lifts the block, as the Blocklist lifts it",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { refusal } = await call({
        method: "put",
        uri: "/security-block/:id",
        params: { id: BLOCK_ID },
        body: {
          data: {
            state: SecurityBlockState.Lifted,
            liftReason: "Lifted from the case's Response Plan.",
          },
        },
      });

      expect(refusal).toBeNull();
      expect(blocks.get(BLOCK_ID)!["state"]).toBe(SecurityBlockState.Lifted);
      expect(String(blocks.get(BLOCK_ID)!["liftedByUserId"])).toBe(
        props.userId!.toString(),
      );
      expect(blocks.get(BLOCK_ID)!["liftReason"]).toBe(
        "Lifted from the case's Response Plan.",
      );
      // The case's steps are checked again at once: its block no longer holds.
      expect(SecurityCaseStepChecks.requestCheck).toHaveBeenCalledWith({
        projectId: expect.anything(),
        securityCaseId: expect.anything(),
      });
    },
  );

  test("a Security Viewer may not", async () => {
    props = caller(Permission.SecurityViewer);

    const { refusal } = await call({
      method: "put",
      uri: "/security-block/:id",
      params: { id: BLOCK_ID },
      body: { data: { state: SecurityBlockState.Lifted } },
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(blocks.get(BLOCK_ID)!["state"]).toBe(SecurityBlockState.Active);
  });
});

/*
 * The whole way, as the case's card and the engine take it: the block is
 * asked for through the route, approved through the run's route where it
 * waits, made by the engine as the person who asked, and lifted by its
 * undo. The tables are held in memory; the run's compare-and-set writes
 * answer from them as the SQL they send would.
 */
describe("from the click to the block, and back", () => {
  let enforcement: Array<SecurityBlockEnforcement>;

  function writeRunCompareAndSet(): void {
    jest
      .spyOn(SecurityPlaybookRunService, "compareAndSetColumnsByIdWithoutHooks")
      .mockImplementation(
        async (input: {
          id: ObjectID;
          data: unknown;
          expectedData: unknown;
        }): Promise<boolean> => {
          const row: StoredRow | undefined = runs.get(input.id);
          const expected: StoredRow = input.expectedData as StoredRow;

          if (!row || row["status"] !== expected["status"]) {
            return false;
          }

          Object.assign(row, input.data as StoredRow);
          return true;
        },
      );
  }

  beforeEach(() => {
    enforcement = [];
    useInMemoryHookFreeWrites(
      SecurityPlaybookRunService as unknown as DatabaseService<BaseModel>,
      runs,
    );
    writeRunCompareAndSet();

    jest.spyOn(AuditLogService, "recordUpdate").mockResolvedValue(undefined as never);
    jest
      .spyOn(SecurityCaseNotifications, "approvalRequested")
      .mockResolvedValue();
    jest
      .spyOn(WorkspaceSecurityPlaybookApprovalMessages, "refreshInBackground")
      .mockReturnValue(undefined);
    jest.spyOn(SecurityProtectedEntityService, "getRules").mockResolvedValue([]);

    // Cloudflare enforces the project's blocklist, and holds each block once reconciled.
    SecurityBlockDestinations.setSourcesForTests([
      {
        provider: SecurityBlockDestinationProvider.Test,
        findForProject: async () => {
          return [
            new TestSecurityBlockDestination({
              key: "Test:cloudflare",
              name: "Cloudflare",
            }),
          ];
        },
      },
    ]);
    jest
      .spyOn(SecurityBlocklistReconciler, "reconcileProject")
      .mockImplementation(async () => {
        for (const row of blocks.rows) {
          const held: SecurityBlockEnforcement = new SecurityBlockEnforcement();
          held.securityBlockId = new ObjectID(String(row["_id"]));
          held.destinationName = "Cloudflare";
          held.state = SecurityBlockEnforcementState.Applied;
          held.appliedAt = new Date();
          held.lastConfirmedAt = new Date();
          enforcement.push(held);
        }

        return { destinations: 1, skipped: 0, failed: 0 };
      });
    jest
      .spyOn(SecurityBlockEnforcementService, "findForBlocks")
      .mockImplementation(async () => {
        return enforcement;
      });
  });

  afterEach(() => {
    SecurityBlockDestinations.resetSourcesForTests();
  });

  function result(): SecurityPlaybookStepResult {
    const run: StoredRow = onlyRun();

    return readStepResults(
      run["stepResults"],
      parseSecurityPlaybookSteps(run["steps"] as JSONArray),
    )[0]!;
  }

  test("a Security Admin's block is made by the engine at once, as theirs, on the case and the run", async () => {
    props = caller(Permission.SecurityAdmin);
    const asker: string = props.userId!.toString();

    await block();
    await SecurityPlaybookEngine.executeRun(
      new ObjectID(String(onlyRun()["_id"])),
    );

    expect(onlyRun()["status"]).toBe(SecurityPlaybookRunStatus.Succeeded);
    expect(result().status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(result().targets?.[0]).toMatchObject({
      value: ADDRESS,
      state: SecurityPlaybookTargetState.Done,
    });
    expect(result().targets?.[0]?.detail).toMatch(
      /^blocked until \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC, enforced at Cloudflare$/,
    );

    expect(blocks.rows).toHaveLength(1);
    const made: StoredRow = blocks.rows[0]!;

    expect(made["value"]).toBe(ADDRESS);
    expect(made["state"]).toBe(SecurityBlockState.Active);
    expect(made["action"]).toBe(SecurityBlockAction.Block);
    expect(made["source"]).toBe(SecurityBlockSource.Person);
    expect(String(made["createdByUserId"])).toBe(asker);
    expect(String(made["securityCaseId"]).toLowerCase()).toBe(CASE_ID);
    expect(String(made["securityPlaybookRunId"])).toBe(
      String(onlyRun()["_id"]),
    );
  });

  test("a Security Member's block waits, is approved by someone else through the run's route, then made as the Member's", async () => {
    props = caller(Permission.SecurityMember);
    const asker: string = props.userId!.toString();

    await block();
    const runId: string = String(onlyRun()["_id"]);

    await SecurityPlaybookEngine.executeRun(new ObjectID(runId));

    expect(onlyRun()["status"]).toBe(
      SecurityPlaybookRunStatus.WaitingForApproval,
    );
    expect(result().status).toBe(SecurityPlaybookStepStatus.WaitingForApproval);
    expect(blocks.rows).toEqual([]);
    expect(SecurityCaseNotifications.approvalRequested).toHaveBeenCalledTimes(
      1,
    );

    // The Member who asked may not approve their own block.
    const selfApproval: { refusal: Exception | null } = await call({
      method: "post",
      uri: "/security-playbook-run/:runId/approve",
      params: { runId },
    });

    expect(selfApproval.refusal?.message).toBe(SELF_APPROVAL_REFUSED_MESSAGE);
    expect(onlyRun()["status"]).toBe(
      SecurityPlaybookRunStatus.WaitingForApproval,
    );

    // A Security Admin approves it.
    props = caller(Permission.SecurityAdmin);

    const approval: { refusal: Exception | null } = await call({
      method: "post",
      uri: "/security-playbook-run/:runId/approve",
      params: { runId },
    });

    expect(approval.refusal).toBeNull();
    expect(onlyRun()["status"]).toBe(SecurityPlaybookRunStatus.Queued);

    await SecurityPlaybookEngine.executeRun(new ObjectID(runId));

    expect(onlyRun()["status"]).toBe(SecurityPlaybookRunStatus.Succeeded);
    expect(blocks.rows).toHaveLength(1);
    expect(String(blocks.rows[0]!["createdByUserId"])).toBe(asker);
    expect(blocks.rows[0]!["source"]).toBe(SecurityBlockSource.Person);
  });

  test("a rejected block is never made", async () => {
    props = caller(Permission.SecurityMember);

    await block();
    const runId: string = String(onlyRun()["_id"]);

    await SecurityPlaybookEngine.executeRun(new ObjectID(runId));

    props = caller(Permission.SecurityAdmin);

    const rejection: { refusal: Exception | null } = await call({
      method: "post",
      uri: "/security-playbook-run/:runId/reject",
      params: { runId },
    });

    expect(rejection.refusal).toBeNull();
    expect(onlyRun()["status"]).toBe(SecurityPlaybookRunStatus.Cancelled);
    expect(blocks.rows).toEqual([]);
  });

  test("its undo, through the run's route, lifts the block the run made, as the person who undoes it", async () => {
    props = caller(Permission.ProjectOwner);

    await block();
    const runId: string = String(onlyRun()["_id"]);

    await SecurityPlaybookEngine.executeRun(new ObjectID(runId));

    props = caller(Permission.SecurityMember);

    const undo: { refusal: Exception | null } = await call({
      method: "post",
      uri: "/security-playbook-run/:runId/undo",
      params: { runId },
      body: {
        stepId: parseSecurityPlaybookSteps(onlyRun()["steps"] as JSONArray)[0]!
          .id,
        value: ADDRESS,
      },
    });

    expect(undo.refusal).toBeNull();
    expect(blocks.rows[0]!["state"]).toBe(SecurityBlockState.Lifted);
    expect(String(blocks.rows[0]!["liftedByUserId"])).toBe(
      props.userId!.toString(),
    );
    expect(result().targets?.[0]).toMatchObject({
      value: ADDRESS,
      state: SecurityPlaybookTargetState.Undone,
      detail: "lifted",
    });
  });
});
