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
 * BLOCK THE WHOLE CAMPAIGN FROM A CASE (#10354), through the route the
 * case's card calls:
 *
 *   POST /security-playbook-run/block-campaign
 *
 * The campaign of the case's address is the other addresses whose requests
 * carried one of its user agents to one of its targets. It is blocked in
 * ONE run of the playbook engine - one step, one approval that lists every
 * address - whose targets are the case's address (On the Case) and the
 * campaign's (In the Campaign). A protected or own address is a target
 * marked Protected, so the approval names it and nothing acts on it; one a
 * signed-in user used lately, and one already blocked, are left out and
 * said. A Security Member's run waits for someone else's approval; a
 * Security Admin's, a Project Admin's and a Project Owner's runs at once.
 *
 * Nothing is stubbed between the route and the tables but the tables, held
 * in memory, and what lies past the run: the case's requests, the
 * campaign's events, who signed in, what protects an address.
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
import SecurityPlaybookRunAPI, {
  ONE_STEP_BLOCK_REFUSED_MESSAGE,
  SECURITY_PLAYBOOK_CAMPAIGN_BLOCK_PATH,
} from "../../../Server/API/SecurityPlaybookRunAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import SecurityBlockService from "../../../Server/Services/SecurityBlockService";
import SecurityCaseFeedService from "../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import SecurityEventService from "../../../Server/Services/SecurityEventService";
import SecurityPlaybookRunService from "../../../Server/Services/SecurityPlaybookRunService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SecuritySignedInAddresses, {
  SecuritySignedInAddressState,
  SecuritySignedInSource,
} from "../../../Server/Utils/SecurityAutomaticResponse/SecuritySignedInAddresses";
import SecurityCaseMatches from "../../../Server/Utils/SecurityCase/Context/SecurityCaseMatches";
import SecurityProtectedAddresses from "../../../Server/Utils/SecurityBlocklist/SecurityProtectedAddresses";
import {
  NOTHING_LEFT_IN_CAMPAIGN_MESSAGE,
  NOT_BLOCKABLE_MESSAGE,
} from "../../../Server/Utils/SecurityPlaybook/SecurityPlaybookOneStepRuns";
import SecurityPlaybookEngine from "../../../Server/Utils/SecurityPlaybook/SecurityPlaybookEngine";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import TelemetryReadAccess from "../../../Server/Utils/Telemetry/TelemetryReadAccess";
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
  SecurityBlockSource,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import AuditLogService from "../../../Server/Services/AuditLogService";
import SecurityBlocklistJobs from "../../../Server/Utils/SecurityBlocklist/SecurityBlocklistJobs";
import SecurityBlockDestinations from "../../../Server/Utils/SecurityBlocklist/SecurityBlockDestinations";
import { SecurityProtectedAddressSource } from "../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchesJson,
} from "../../../Types/SecurityCase/SecurityCaseMatches";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { SecurityCampaignAddressStanding } from "../../../Types/SecurityEvent/SecurityCampaignContainment";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { readOneStepRun } from "../../../Types/SecurityPlaybook/SecurityPlaybookOneStepRun";
import {
  SecurityPlaybookStep,
  doesStepNeedApproval,
  parseSecurityPlaybookSteps,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookTarget,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import { NetworkAddressBlock } from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import { customDomainCaller } from "./CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "10354000-6d3e-4f90-8b72-8e1d3c5f7a01",
);
const CASE_ID: string = "10354000-6d3e-4f90-8b72-8e1d3c5f7a02";

// The scanner the case is about, and its campaign.
const ADDRESS: string = "35.205.11.131";
const SIBLING: string = "35.205.11.140";
const OTHER_SIBLING: string = "198.51.100.23";
const OWN: string = "203.0.113.10";
const SIGNED_IN: string = "192.0.2.5";

const HOUR_IN_MS: number = 60 * 60 * 1000;

let props: DatabaseCommonInteractionProps;
let runs: InMemoryTable;
let blocks: InMemoryTable;
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
    caseNumberWithPrefix: "SEC-77",
    entities: [{ type: SecurityEntityType.IpAddress, value: ADDRESS }],
    createdAt: new Date(Date.now() - HOUR_IN_MS),
    version: 1,
  };
}

function detection(): SecurityCaseMatchedDetectionJson {
  return {
    id: "10354000-6d3e-4f90-8b72-8e1d3c5f7a04",
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
        attributes: {},
      },
    ],
    isKept: false,
    keptPastRetentionCount: 0,
    hiddenEventCount: 0,
    matchedEventCount: 2,
    outcomes: {},
  } as unknown as SecurityCaseMatchedDetectionJson;
}

async function call(
  body: JSONObject = {},
): Promise<{ refusal: Exception | null }> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    headers: {},
    body: { securityCaseId: CASE_ID, value: ADDRESS, ...body },
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {
    setHeader: jest.fn(),
  } as unknown as ExpressResponse;
  const next: MockedFn = jest.fn();

  await mockRouter
    .match(
      "post",
      `/security-playbook-run/${SECURITY_PLAYBOOK_CAMPAIGN_BLOCK_PATH}`,
    )
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    refusal: (next.mock.calls[0]?.[0] as Exception | undefined) || null,
  };
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

function targetsOf(run: StoredRow): Array<SecurityPlaybookTarget> {
  return readOneStepRun(run)?.result?.targets || [];
}

// A target as the approval reads it: what, why, where it stands, and why not.
function shownTargetsOf(run: StoredRow): Array<JSONObject> {
  return targetsOf(run).map((target: SecurityPlaybookTarget): JSONObject => {
    return {
      type: target.type,
      value: target.value,
      reason: target.reason,
      state: target.state,
      ...(target.detail ? { detail: target.detail } : {}),
    };
  });
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new SecurityPlaybookRunAPI();
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
  const cases: InMemoryTable = useInMemoryTable(
    SecurityCaseService as unknown as DatabaseService<BaseModel>,
    [caseRow()],
  );

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
      return {
        detections: [detection()],
        detectionCount: 1,
        unreadableSources: [],
        failedSources: [],
      };
    });
  jest
    .spyOn(TelemetryReadAccess, "getServiceFilter")
    .mockResolvedValue({} as never);

  // The campaign: two more scanners, one of the project's own addresses, and a signed-in user's.
  jest.spyOn(SecurityEventService, "findCampaignOfAddress").mockResolvedValue({
    userAgents: ["zgrab/0.x"],
    targetCount: 4,
    addresses: [SIBLING, OTHER_SIBLING, OWN, SIGNED_IN].map(
      (address: string, index: number) => {
        return {
          address,
          requestCount: 40 - index,
          sharedTargetCount: 3,
          lastSeen: new Date().toISOString(),
        };
      },
    ),
  } as never);
  jest
    .spyOn(SecurityProtectedAddresses, "findProtection")
    .mockImplementation((async (data: { block: NetworkAddressBlock }) => {
      return data.block.text === OWN
        ? {
            protection: {
              source: SecurityProtectedAddressSource.CloudResource,
              protectedValue: OWN,
              name: "prod-alb",
            },
            unreadSources: [],
          }
        : { protection: null, unreadSources: [] };
    }) as never);
  jest.spyOn(SecuritySignedInAddresses, "checkMany").mockResolvedValue({
    state: SecuritySignedInAddressState.SignedIn,
    usersByAddress: new Map([
      [
        SIGNED_IN,
        [
          {
            name: "alice@example.com",
            source: SecuritySignedInSource.IdentityProvider,
            lastSeenAt: new Date(),
          },
        ],
      ],
    ]),
  } as never);
  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(SecurityBlocklistJobs, "queueReconcile")
    .mockResolvedValue(undefined);
  jest.spyOn(AuditLogService, "recordCreate").mockResolvedValue(undefined);
  // Nothing enforces the blocklist: an address at the edge is kept all the same.
  SecurityBlockDestinations.setSourcesForTests([]);
  enqueue = jest
    .spyOn(SecurityPlaybookEngine, "enqueueRun")
    .mockResolvedValue(undefined) as unknown as MockedFn;
});

afterEach(() => {
  SecurityBlockDestinations.resetSourcesForTests();
  jest.restoreAllMocks();
});

describe("Block the Whole Campaign", () => {
  test.each([
    ["Security Admin", Permission.SecurityAdmin],
    ["Project Admin", Permission.ProjectAdmin],
    ["Project Owner", Permission.ProjectOwner],
  ])(
    "a %s blocks the case's address and its campaign in one run, at once",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { refusal } = await call();

      expect(refusal).toBeNull();

      const run: StoredRow = onlyRun();
      const step: SecurityPlaybookStep = stepOf(run);

      expect(run["securityPlaybookId"] ?? null).toBeNull();
      expect(step.action).toBe(SecurityPlaybookActionType.BlockAddress);
      expect(step.config).toEqual({
        blockAction: SecurityBlockAction.Block,
        duration: SecurityBlockDuration.OneDay,
      });
      expect(doesStepNeedApproval(step)).toBe(false);

      expect(shownTargetsOf(run)).toEqual([
        {
          type: SecurityEntityType.IpAddress,
          value: ADDRESS,
          reason: SecurityPlaybookTargetReason.OnTheCase,
          state: SecurityPlaybookTargetState.Proposed,
        },
        {
          type: SecurityEntityType.IpAddress,
          value: SIBLING,
          reason: SecurityPlaybookTargetReason.InTheCampaign,
          state: SecurityPlaybookTargetState.Proposed,
        },
        {
          type: SecurityEntityType.IpAddress,
          value: OTHER_SIBLING,
          reason: SecurityPlaybookTargetReason.InTheCampaign,
          state: SecurityPlaybookTargetState.Proposed,
        },
        {
          type: SecurityEntityType.IpAddress,
          value: OWN,
          reason: SecurityPlaybookTargetReason.InTheCampaign,
          state: SecurityPlaybookTargetState.Protected,
          /*
           * What protects it, as the person may be told it: by name to one
           * who reads the project's cloud resources, else as one of its own.
           */
          detail: expect.stringContaining(OWN),
        },
      ]);
      expect(enqueue).toHaveBeenCalledTimes(1);

      expect(answered()["needsApproval"]).toBe(false);
      expect(answered()["blocking"]).toEqual([ADDRESS, SIBLING, OTHER_SIBLING]);
      expect(
        (answered()["leftOut"] as Array<JSONObject>).map(
          (entry: JSONObject): Array<unknown> => {
            return [entry["value"], entry["standing"]];
          },
        ),
      ).toEqual([
        [OWN, SecurityCampaignAddressStanding.Protected],
        [SIGNED_IN, SecurityCampaignAddressStanding.SignedIn],
      ]);
    },
  );

  test("a Security Member's waits for ONE approval, of a step that lists every address", async () => {
    props = caller(Permission.SecurityMember);

    const { refusal } = await call();

    expect(refusal).toBeNull();

    const run: StoredRow = onlyRun();
    const step: SecurityPlaybookStep = stepOf(run);

    expect(parseSecurityPlaybookSteps(run["steps"] as JSONArray)).toHaveLength(
      1,
    );
    expect(step.requiresApproval).toBe(true);
    expect(doesStepNeedApproval(step)).toBe(true);
    expect(
      targetsOf(run)
        .filter((target: SecurityPlaybookTarget): boolean => {
          return target.state === SecurityPlaybookTargetState.Proposed;
        })
        .map((target: SecurityPlaybookTarget): string => {
          return target.value;
        }),
    ).toEqual([ADDRESS, SIBLING, OTHER_SIBLING]);
    expect(answered()["needsApproval"]).toBe(true);
  });

  test("only the campaign's addresses the person kept are blocked, and none outside the campaign", async () => {
    props = caller(Permission.SecurityAdmin);

    await call({ values: [OTHER_SIBLING, "8.8.8.8"] });

    expect(
      targetsOf(onlyRun()).map((target: SecurityPlaybookTarget): string => {
        return target.value;
      }),
    ).toEqual([ADDRESS, OTHER_SIBLING]);
  });

  test("Challenge Instead and Block for 7 Days are the step's settings", async () => {
    props = caller(Permission.SecurityAdmin);

    await call({
      blockAction: SecurityBlockAction.Challenge,
      duration: SecurityBlockDuration.SevenDays,
    });

    expect(stepOf(onlyRun()).config).toEqual({
      blockAction: SecurityBlockAction.Challenge,
      duration: SecurityBlockDuration.SevenDays,
    });
  });

  test("the case's own address already blocked, the rest of the campaign is still blocked", async () => {
    props = caller(Permission.SecurityAdmin);
    await SecurityBlockService.block({
      projectId: PROJECT_ID,
      value: ADDRESS,
      props: { isRoot: true },
      source: SecurityBlockSource.Playbook,
    });

    await call();

    expect(
      targetsOf(onlyRun())
        .filter((target: SecurityPlaybookTarget): boolean => {
          return target.state === SecurityPlaybookTargetState.Proposed;
        })
        .map((target: SecurityPlaybookTarget): string => {
          return target.value;
        }),
    ).toEqual([SIBLING, OTHER_SIBLING]);
    expect(answered()["blocking"]).toEqual([SIBLING, OTHER_SIBLING]);
  });

  test("with every address left out - blocked already, protected, a signed-in user's - nothing is started, and it says why", async () => {
    props = caller(Permission.SecurityAdmin);
    await SecurityBlockService.block({
      projectId: PROJECT_ID,
      value: ADDRESS,
      props: { isRoot: true },
      source: SecurityBlockSource.Playbook,
    });

    const { refusal } = await call({ values: [OWN, SIGNED_IN] });

    expect(refusal?.message).toBe(NOTHING_LEFT_IN_CAMPAIGN_MESSAGE);
    expect(runs.rows).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("an address that is none the case may be blocked from is refused before anything is read", async () => {
    props = caller(Permission.SecurityAdmin);
    const read: ReturnType<typeof jest.spyOn> = jest.spyOn(
      SecurityEventService,
      "findCampaignOfAddress",
    );

    const { refusal } = await call({ value: "35.205.11.200" });

    expect(refusal?.message).toBe(NOT_BLOCKABLE_MESSAGE);
    expect(read).not.toHaveBeenCalled();
    expect(runs.rows).toEqual([]);
  });

  test.each([
    ["Security Viewer", Permission.SecurityViewer],
    ["Project Member", Permission.ProjectMember],
  ])(
    "a %s may not, and no run is started",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { refusal } = await call();

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(refusal?.message).toBe(ONE_STEP_BLOCK_REFUSED_MESSAGE);
      expect(runs.rows).toEqual([]);
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  test("the route writes no block: the engine's step makes them, after the approval", async () => {
    props = caller(Permission.SecurityMember);

    await call();

    expect(blocks.rows).toEqual([]);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
