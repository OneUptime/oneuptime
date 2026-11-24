jest.mock("../../../../Server/Utils/Logger", () => {
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

import AIRun from "../../../../Models/DatabaseModels/AIRun";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import AIRunService from "../../../../Server/Services/AIRunService";
import CodeRepositoryService, {
  Service as CodeRepositoryServiceClass,
} from "../../../../Server/Services/CodeRepositoryService";
import DataSecurityAiProposalService from "../../../../Server/Services/DataSecurityAiProposalService";
import DataSecurityIssueFeedService from "../../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../../Server/Services/DataSecurityIssueService";
import DataStoreFindingService from "../../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import ServiceService from "../../../../Server/Services/ServiceService";
import CodeFixOnItsWay from "../../../../Server/Utils/AI/CodeFix/CodeFixOnItsWay";
import CodeTaskAccess from "../../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import { isDataSecurityAiCodeRequest } from "../../../../Server/Utils/AI/DataSecurity/DataSecurityAiInput";
import DataSecurityCodeTask from "../../../../Server/Utils/AI/DataSecurity/DataSecurityCodeTask";
import ProductionReviewScope from "../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewScope";
import { ResolvableRepository } from "../../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import DataSecurityRunner from "../../../../Server/Utils/DataSecurity/DataSecurityRunner";
import ProjectDataTypeNames from "../../../../Server/Utils/DataSecurity/ProjectDataTypeNames";
import TelemetryLeakFix, {
  TELEMETRY_FIX_CHANGED_MESSAGE,
  TELEMETRY_FIX_NOTHING_TO_FIX_MESSAGE,
  TELEMETRY_FIX_NOT_A_SERVICE_MESSAGE,
  TELEMETRY_FIX_ON_ITS_WAY_MESSAGE,
  TelemetryLeakFixPlan,
} from "../../../../Server/Utils/DataSecurity/TelemetryLeakFix";
import TelemetryLeakLocator, {
  TelemetryLeakFindingToLocate,
  TelemetryLeakLocation,
} from "../../../../Server/Utils/DataSecurity/Telemetry/TelemetryLeakLocator";
import * as TelemetryScrubCoverage from "../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import { TelemetryLeakFixTaskContext } from "../../../../Types/AI/CodeFixTaskContext";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DataSecurityFixResult,
  DataSecurityTelemetryFixPlanResult,
  DataSecurityTelemetryFixRepositoryChoice,
} from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import {
  TelemetryLeakFixLeak,
  TelemetryLeakFixStrategy,
  TelemetryLeakHandling,
  TelemetryLeakPlace,
  TelemetryLeakSignal,
} from "../../../../Types/DataSecurity/TelemetryLeakFix";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { customDomainCaller } from "../../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import {
  StoredRow,
  useInMemoryTable,
} from "../../TestingUtils/InMemoryRepository";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ONE PULL REQUEST FOR ALL OF A SERVICE'S TELEMETRY LEAKS (#10367).
 *
 * A service's telemetry stores, their issues and findings are rows held in
 * memory; where each leak is written is what the locator would read from
 * its records. The issue's first scenario - a span's and a log line's
 * user.email - is ONE plan and ONE pull request for both issues, in the
 * repository the records' files are in, each fixed where it is written; the
 * second - one key in twenty places - one redaction step. Fix with AI asks
 * for exactly the plan shown: one that changed starts nothing and comes
 * back; with nothing to decide the repository the person picks; one on its
 * way is answered with. Each issue it fixes keeps the task and says on its
 * timeline when its pull request opened, and a secret is to be rotated.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10367000-0000-4000-8000-000000000001",
);
const SERVICE_ID: string = "10367000-0000-4000-8000-0000000000e1";
const TRACES_STORE_ID: string = "10367000-0000-4000-8000-0000000000b1";
const LOGS_STORE_ID: string = "10367000-0000-4000-8000-0000000000b2";
const BUCKET_STORE_ID: string = "10367000-0000-4000-8000-0000000000b3";
const SPAN_ISSUE_ID: string = "10367000-0000-4000-8000-0000000000a1";
const LOG_ISSUE_ID: string = "10367000-0000-4000-8000-0000000000a2";
const BUCKET_ISSUE_ID: string = "10367000-0000-4000-8000-0000000000a3";
const SPAN_FINDING_ID: string = "10367000-0000-4000-8000-0000000000d1";
const LOG_FINDING_ID: string = "10367000-0000-4000-8000-0000000000d2";
const RUN_ID: string = "10367000-0000-4000-8000-0000000000f1";

const CHECKOUT_REPOSITORY: ResolvableRepository = {
  id: "10367000-0000-4000-8000-0000000000c1",
  name: "checkout",
  organizationName: "acme",
  repositoryName: "checkout",
  mainBranchName: "main",
  gitHubAppInstallationId: null,
};
const PLATFORM_REPOSITORY: ResolvableRepository = {
  ...CHECKOUT_REPOSITORY,
  id: "10367000-0000-4000-8000-0000000000c2",
  name: "platform",
  repositoryName: "platform",
};

// A project owner: one who may read and change the issues.
const PERSON: DatabaseCommonInteractionProps = {
  ...customDomainCaller({
    permissions: [Permission.ProjectOwner],
    projectId: PROJECT_ID,
  }),
  ...ON_HIGHEST_PLAN,
};

const asService: <T extends BaseModel>(
  service: unknown,
) => DatabaseService<T> = <T extends BaseModel>(
  service: unknown,
): DatabaseService<T> => {
  return service as DatabaseService<T>;
};

function storeRow(id: string, kind: string, serviceId?: string): StoredRow {
  return {
    _id: id,
    projectId: PROJECT_ID.toString(),
    name: `checkout · ${kind}`,
    kind,
    provider: "oneuptime",
    isArchived: false,
    ...(serviceId ? { serviceId } : {}),
  };
}

function issueRow(data: {
  id: string;
  storeId: string;
  riskScore: number;
  checkId?: string;
  status?: string;
  resolution?: string;
}): StoredRow {
  return {
    _id: data.id,
    projectId: PROJECT_ID.toString(),
    title: "Sensitive data is reaching your telemetry",
    checkId: data.checkId || "sensitive-data-in-telemetry",
    severity: "High",
    riskScore: data.riskScore,
    status: data.status || "Open",
    ...(data.resolution ? { resolution: data.resolution } : {}),
    dataStoreId: data.storeId,
  };
}

function findingRow(data: {
  id: string;
  storeId: string;
  location: string;
  dataTypeId?: string;
  isScrubbed?: boolean;
}): StoredRow {
  return {
    _id: data.id,
    projectId: PROJECT_ID.toString(),
    dataStoreId: data.storeId,
    dataTypeId: data.dataTypeId || "email-address",
    dataTypeName: "Email address",
    location: data.location,
    locationKind: "Attribute",
    confidence: "High",
    matchCount: 12,
    isConfirmed: false,
    isAiSuggested: false,
    isSuppressed: false,
    isScrubbed: data.isScrubbed === true,
    lastSeenAt: new Date(),
    sampleRecords: [],
  };
}

let places: Map<string, Array<TelemetryLeakPlace>>;
let trees: Record<string, Array<string>>;
let repositories: Array<ResolvableRepository>;
let onItsWay: string | null;
let requested: SpyInstance<typeof DataSecurityCodeTask.requestTelemetryLeakFix>;

function useWorld(
  data: {
    issues?: Array<StoredRow>;
    findings?: Array<StoredRow>;
  } = {},
): void {
  useInMemoryTable(asService(ServiceService), [
    { _id: SERVICE_ID, projectId: PROJECT_ID.toString(), name: "checkout" },
  ]);
  useInMemoryTable(asService(DataStoreService), [
    storeRow(TRACES_STORE_ID, "Traces", SERVICE_ID),
    storeRow(LOGS_STORE_ID, "Logs", SERVICE_ID),
    storeRow(BUCKET_STORE_ID, "AWS S3 Bucket"),
  ]);
  useInMemoryTable(
    asService(DataSecurityIssueService),
    data.issues || [
      issueRow({ id: SPAN_ISSUE_ID, storeId: TRACES_STORE_ID, riskScore: 90 }),
      issueRow({ id: LOG_ISSUE_ID, storeId: LOGS_STORE_ID, riskScore: 70 }),
      issueRow({
        id: BUCKET_ISSUE_ID,
        storeId: BUCKET_STORE_ID,
        riskScore: 95,
        checkId: "public-read",
      }),
    ],
  );
  useInMemoryTable(
    asService(DataStoreFindingService),
    data.findings || [
      findingRow({
        id: SPAN_FINDING_ID,
        storeId: TRACES_STORE_ID,
        location: "attributes.user.email",
      }),
      findingRow({
        id: LOG_FINDING_ID,
        storeId: LOGS_STORE_ID,
        location: "body",
      }),
    ],
  );
}

beforeEach(() => {
  places = new Map([
    [
      SPAN_FINDING_ID,
      [
        {
          filePath: "src/signup.js",
          lineNumber: 10,
          functionName: "signUp",
          spanName: "POST /signup",
          recordCount: 2,
        },
      ],
    ],
    [
      LOG_FINDING_ID,
      [
        {
          filePath: "src/signup.js",
          lineNumber: 12,
          template: "User <Email address> signed up",
          recordCount: 2,
        },
      ],
    ],
  ]);
  trees = {
    [CHECKOUT_REPOSITORY.id]: ["src/signup.js", "src/telemetry.js"],
    [PLATFORM_REPOSITORY.id]: ["README.md"],
  };
  repositories = [CHECKOUT_REPOSITORY, PLATFORM_REPOSITORY];
  onItsWay = null;

  useWorld();
  jest
    .spyOn(TelemetryScrubCoverage, "getScrubCoverage")
    .mockResolvedValue({ rules: [] } as never);
  jest
    .spyOn(ProjectDataTypeNames, "read")
    .mockResolvedValue(DataTypeNamer.withoutCustomTypes());
  jest
    .spyOn(DataSecurityRunner, "getScanSetup")
    .mockResolvedValue({ options: {} } as never);
  // Where each finding is written: what the locator reads from its records.
  jest.spyOn(TelemetryLeakLocator, "locate").mockImplementation((async (data: {
    findings: ReadonlyArray<TelemetryLeakFindingToLocate>;
  }) => {
    return new Map(
      data.findings.map(
        (
          finding: TelemetryLeakFindingToLocate,
        ): [string, TelemetryLeakLocation] => {
          return [
            finding.findingId,
            {
              findingId: finding.findingId,
              places: places.get(finding.findingId) || [],
              recordsRead: 2,
            },
          ];
        },
      ),
    );
  }) as never);
  jest
    .spyOn(CodeRepositoryService, "getResolvableRepositories")
    .mockImplementation((async () => {
      return repositories;
    }) as never);
  jest
    .spyOn(CodeRepositoryServiceClass, "getRepositoryTreePaths")
    .mockImplementation((async (repository: ResolvableRepository) => {
      return trees[repository.id] || [];
    }) as never);
  jest
    .spyOn(ProductionReviewScope, "get")
    .mockResolvedValue({ services: [] } as never);
  jest.spyOn(CodeFixOnItsWay, "findTaskId").mockImplementation((async () => {
    return onItsWay;
  }) as never);
  // The person may read and ask in both repositories.
  const askable: Array<CodeRepository> = repositories.map(
    (repository: ResolvableRepository): CodeRepository => {
      const row: CodeRepository = new CodeRepository();

      row._id = repository.id;
      row.name = repository.name;

      return row;
    },
  );

  jest
    .spyOn(CodeTaskAccess, "listReadableRepositories")
    .mockResolvedValue(askable);
  jest
    .spyOn(DataSecurityCodeTask, "getAskableRepositories")
    .mockImplementation((async () => {
      return askable.filter((row: CodeRepository): boolean => {
        return repositories.some(
          (repository: ResolvableRepository): boolean => {
            return repository.id === row._id;
          },
        );
      });
    }) as never);
  jest
    .spyOn(DataSecurityAiProposalService, "expireWaitingInLane")
    .mockResolvedValue(0);
  requested = jest
    .spyOn(DataSecurityCodeTask, "requestTelemetryLeakFix")
    .mockResolvedValue({
      message:
        "OneUptime AI is working on one pull request for the service's leaks.",
      aiRunId: RUN_ID,
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function planOfService(): Promise<Array<TelemetryLeakFixPlan>> {
  return await TelemetryLeakFix.planService({
    projectId: PROJECT_ID,
    serviceId: new ObjectID(SERVICE_ID),
  });
}

describe("which issue is a service's telemetry issue", () => {
  test("a telemetry check's issue on one of a service's telemetry stores", async () => {
    expect(
      (
        await TelemetryLeakFix.serviceOfIssue({
          projectId: PROJECT_ID,
          issue: {
            checkId: "sensitive-data-in-telemetry",
            dataStoreId: new ObjectID(LOGS_STORE_ID),
          },
        })
      )?.toString(),
    ).toBe(SERVICE_ID);
  });

  test("not another check's, nor one on a store no service's", async () => {
    expect(
      await TelemetryLeakFix.serviceOfIssue({
        projectId: PROJECT_ID,
        issue: {
          checkId: "public-read",
          dataStoreId: new ObjectID(BUCKET_STORE_ID),
        },
      }),
    ).toBeNull();
    expect(
      await TelemetryLeakFix.serviceOfIssue({
        projectId: PROJECT_ID,
        issue: {
          checkId: "sensitive-data-in-telemetry",
          dataStoreId: new ObjectID(BUCKET_STORE_ID),
        },
      }),
    ).toBeNull();
  });
});

describe("the issue's first scenario: a span's and a log line's user.email", () => {
  test("is one plan for both issues, in the repository the records' files are in, each leak fixed where it is written", async () => {
    const plans: Array<TelemetryLeakFixPlan> = await planOfService();

    expect(plans).toHaveLength(1);

    const plan: TelemetryLeakFixPlan = plans[0]!;

    expect(plan.serviceName).toBe("checkout");
    expect(plan.repository?.id).toBe(CHECKOUT_REPOSITORY.id);
    expect(plan.choice).toBe(
      DataSecurityTelemetryFixRepositoryChoice.StackTrace,
    );
    expect(plan.decision.strategy).toBe(TelemetryLeakFixStrategy.CallSites);
    expect(
      plan.decision.leaks.map((leak: TelemetryLeakFixLeak) => {
        return [leak.signal, leak.location, leak.key || "", leak.handling];
      }),
    ).toEqual([
      [
        TelemetryLeakSignal.Spans,
        "attributes.user.email",
        "user.email",
        TelemetryLeakHandling.CallSite,
      ],
      [TelemetryLeakSignal.Logs, "body", "", TelemetryLeakHandling.CallSite],
    ]);
    // The riskiest issue first: what the proposals and the cap order by.
    expect(
      plan.issues.map((issue: { issueId: string }) => {
        return issue.issueId;
      }),
    ).toEqual([SPAN_ISSUE_ID, LOG_ISSUE_ID]);
    expect(plan.riskiestIssueId).toBe(SPAN_ISSUE_ID);
    expect(plan.riskScore).toBe(90);
    expect(plan.startFiles).toEqual(["src/signup.js"]);
    expect(plan.hasSecrets).toBe(false);
    expect(
      plan.planKey.startsWith(`tleak-${SERVICE_ID}-${CHECKOUT_REPOSITORY.id}:`),
    ).toBe(true);
  });

  test("Fix with AI asks for that one pull request, for both issues, in that repository", async () => {
    const shown: DataSecurityTelemetryFixPlanResult = (
      await TelemetryLeakFix.planForIssue({
        projectId: PROJECT_ID,
        issueId: new ObjectID(LOG_ISSUE_ID),
        props: PERSON,
      })
    ).result;

    expect(shown.plan?.repository).toEqual({
      id: CHECKOUT_REPOSITORY.id,
      name: "checkout",
      choice: DataSecurityTelemetryFixRepositoryChoice.StackTrace,
    });

    const result: DataSecurityFixResult = await TelemetryLeakFix.runForIssue({
      projectId: PROJECT_ID,
      issueId: new ObjectID(LOG_ISSUE_ID),
      props: PERSON,
      expectedPlanFingerprint: shown.plan!.fingerprint,
    });

    expect(result.aiRunId).toBe(RUN_ID);
    expect(requested).toHaveBeenCalledTimes(1);

    const asked: Parameters<
      typeof DataSecurityCodeTask.requestTelemetryLeakFix
    >[0] = requested.mock.calls[0]![0];

    expect(
      asked.issueIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([SPAN_ISSUE_ID, LOG_ISSUE_ID]);
    expect(asked.requestedRepositoryId).toBe(CHECKOUT_REPOSITORY.id);
    expect(asked.fix.leaks).toHaveLength(2);
    expect(asked.fix.title).toBe(
      "Stop checkout writing sensitive data to its telemetry",
    );

    // The request is the builder's, from where each leak is written.
    const request: ReturnType<typeof TelemetryLeakFix.buildRequest> =
      await asked.buildMessage();

    expect(isDataSecurityAiCodeRequest(request)).toBe(true);
    expect(request.text).toContain("src/signup.js");
    expect(request.text).toContain("User <Email address> signed up");
  });
});

describe("the issue's second scenario: a key in twenty places", () => {
  test("is one redaction step for the key, not an edit at each place", async () => {
    places.set(
      SPAN_FINDING_ID,
      Array.from(
        { length: 5 },
        (_: unknown, index: number): TelemetryLeakPlace => {
          return {
            filePath: `src/handlers/step${index}.js`,
            lineNumber: 9,
            recordCount: 1,
          };
        },
      ),
    );
    places.set(
      LOG_FINDING_ID,
      Array.from(
        { length: 5 },
        (_: unknown, index: number): TelemetryLeakPlace => {
          return {
            filePath: `src/notify/notice${index}.js`,
            lineNumber: 7,
            recordCount: 1,
          };
        },
      ),
    );
    trees[CHECKOUT_REPOSITORY.id] = [
      ...Array.from({ length: 5 }, (_: unknown, index: number): string => {
        return `src/handlers/step${index}.js`;
      }),
      ...Array.from({ length: 5 }, (_: unknown, index: number): string => {
        return `src/notify/notice${index}.js`;
      }),
    ];
    useWorld({
      findings: [
        findingRow({
          id: SPAN_FINDING_ID,
          storeId: TRACES_STORE_ID,
          location: "attributes.customer.email",
        }),
        findingRow({
          id: LOG_FINDING_ID,
          storeId: LOGS_STORE_ID,
          location: "attributes.customer.email",
        }),
      ],
    });

    const plan: TelemetryLeakFixPlan = (await planOfService())[0]!;

    expect(plan.decision.strategy).toBe(TelemetryLeakFixStrategy.RedactionStep);
    expect(plan.decision.redactionKeys).toEqual(["customer.email"]);
    expect(TelemetryLeakFix.buildRequest(plan).text).toContain(
      "redaction step",
    );
  });
});

describe("a leak contained at ingest", () => {
  test("is fixed too - by the redaction step - its issue resolved as contained, not fixed", async () => {
    useWorld({
      issues: [
        issueRow({
          id: SPAN_ISSUE_ID,
          storeId: TRACES_STORE_ID,
          riskScore: 90,
        }),
        issueRow({
          id: LOG_ISSUE_ID,
          storeId: LOGS_STORE_ID,
          riskScore: 70,
          status: "Resolved",
          resolution: "ContainedAtIngest",
        }),
      ],
      findings: [
        findingRow({
          id: SPAN_FINDING_ID,
          storeId: TRACES_STORE_ID,
          location: "attributes.user.email",
        }),
        findingRow({
          id: LOG_FINDING_ID,
          storeId: LOGS_STORE_ID,
          location: "body",
          isScrubbed: true,
        }),
      ],
    });

    const plan: TelemetryLeakFixPlan = (await planOfService())[0]!;

    expect(plan.decision.strategy).toBe(
      TelemetryLeakFixStrategy.CallSitesAndRedactionStep,
    );
    expect(
      plan.decision.leaks.find((leak: TelemetryLeakFixLeak): boolean => {
        return leak.issueId === LOG_ISSUE_ID;
      })?.handling,
    ).toBe(TelemetryLeakHandling.RedactionStep);
  });
});

describe("Fix with AI asks for exactly the plan shown", () => {
  test("a plan that changed since it was shown starts nothing, and comes back to be shown again", async () => {
    const result: DataSecurityFixResult = await TelemetryLeakFix.runForIssue({
      projectId: PROJECT_ID,
      issueId: new ObjectID(SPAN_ISSUE_ID),
      props: PERSON,
      expectedPlanFingerprint: "0000000000000000",
    });

    expect(result.message).toBe(TELEMETRY_FIX_CHANGED_MESSAGE);
    expect(result.plan?.leaks).toHaveLength(2);
    expect(result.aiRunId).toBeUndefined();
    expect(requested).not.toHaveBeenCalled();
  });

  test("with nothing to decide the repository, the person picks one they may ask in, and it is asked there", async () => {
    // No file the records name is in any repository, and none is named like the service.
    trees = {
      [CHECKOUT_REPOSITORY.id]: ["README.md"],
      [PLATFORM_REPOSITORY.id]: ["README.md"],
    };
    repositories = [
      {
        ...CHECKOUT_REPOSITORY,
        name: "storefront",
        repositoryName: "storefront",
      },
      PLATFORM_REPOSITORY,
    ];

    const asked: DataSecurityFixResult = await TelemetryLeakFix.runForIssue({
      projectId: PROJECT_ID,
      issueId: new ObjectID(SPAN_ISSUE_ID),
      props: PERSON,
    });

    expect(asked.aiRunId).toBeUndefined();
    expect(asked.message).toBe(
      "Choose the repository that holds this service's code.",
    );
    expect(
      (asked.repositories || []).map((repository: { id: string }) => {
        return repository.id;
      }),
    ).toEqual([CHECKOUT_REPOSITORY.id, PLATFORM_REPOSITORY.id]);
    expect(requested).not.toHaveBeenCalled();

    const picked: DataSecurityFixResult = await TelemetryLeakFix.runForIssue({
      projectId: PROJECT_ID,
      issueId: new ObjectID(SPAN_ISSUE_ID),
      props: PERSON,
      codeRepositoryId: PLATFORM_REPOSITORY.id,
      expectedPlanFingerprint: asked.plan!.fingerprint,
    });

    expect(picked.aiRunId).toBe(RUN_ID);
    expect(requested.mock.calls[0]![0].requestedRepositoryId).toBe(
      PLATFORM_REPOSITORY.id,
    );
  });

  test("a fix on its way for the service there is answered with, and never asked twice", async () => {
    onItsWay = "10367000-0000-4000-8000-0000000000f9";

    const plan: TelemetryLeakFixPlan = (await planOfService())[0]!;
    const result: DataSecurityFixResult & { wasAlreadyAsked?: boolean } =
      await TelemetryLeakFix.start({
        projectId: PROJECT_ID,
        plan,
        props: PERSON,
      });

    expect(result).toEqual({
      message: TELEMETRY_FIX_ON_ITS_WAY_MESSAGE,
      aiRunId: onItsWay,
      wasAlreadyAsked: true,
    });
    expect(requested).not.toHaveBeenCalled();
  });

  test("an issue no service's, or a service with nothing left to fix, says why", async () => {
    expect(
      (
        await TelemetryLeakFix.planForIssue({
          projectId: PROJECT_ID,
          issueId: new ObjectID(BUCKET_ISSUE_ID),
          props: PERSON,
        })
      ).result,
    ).toEqual({ plan: null, message: TELEMETRY_FIX_NOT_A_SERVICE_MESSAGE });

    useWorld({ findings: [] });

    expect(
      (
        await TelemetryLeakFix.planForIssue({
          projectId: PROJECT_ID,
          issueId: new ObjectID(SPAN_ISSUE_ID),
          props: PERSON,
        })
      ).result,
    ).toEqual({ plan: null, message: TELEMETRY_FIX_NOTHING_TO_FIX_MESSAGE });
  });
});

describe("each issue the pull request fixes", () => {
  function taskWith(fix: Partial<TelemetryLeakFixTaskContext>): AIRun {
    const run: AIRun = new AIRun(new ObjectID(RUN_ID));

    run.codeFixTaskType = CodeFixTaskType.FixSensitiveDataInTelemetry;
    run.taskContext = {
      telemetryLeakFix: {
        serviceId: SERVICE_ID,
        serviceName: "checkout",
        title: "Stop checkout writing sensitive data to its telemetry",
        request: "Stop the service writing its leaks.",
        strategy: TelemetryLeakFixStrategy.CallSites,
        placeCount: 2,
        leaks: [
          {
            issueId: SPAN_ISSUE_ID,
            dataStoreId: TRACES_STORE_ID,
            checkId: "sensitive-data-in-telemetry",
            signal: TelemetryLeakSignal.Spans,
            dataTypeId: "email-address",
            dataTypeName: "Email address",
            isSecret: false,
            location: "attributes.user.email",
            key: "user.email",
            isMaskedByScrubRule: false,
            handling: TelemetryLeakHandling.CallSite,
            places: [],
          },
        ],
        issues: [
          {
            issueId: SPAN_ISSUE_ID,
            title: "Sensitive data is reaching your telemetry",
            checkId: "sensitive-data-in-telemetry",
            signal: TelemetryLeakSignal.Spans,
          },
          {
            issueId: LOG_ISSUE_ID,
            title: "Sensitive data is reaching your telemetry",
            checkId: "sensitive-data-in-telemetry",
            signal: TelemetryLeakSignal.Logs,
          },
        ],
        redactionKeys: [],
        redactionDataTypes: [],
        startFiles: ["src/signup.js"],
        hasSecrets: false,
        ...fix,
      },
    } as never;

    return run;
  }

  test("is the task's to follow: its issues are read from its own context", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(taskWith({}));

    expect(
      (
        await TelemetryLeakFix.getIssueIdsOfTask({
          projectId: PROJECT_ID,
          taskId: new ObjectID(RUN_ID),
        })
      ).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([SPAN_ISSUE_ID, LOG_ISSUE_ID]);
  });

  test("says on its timeline that its pull request opened, with the link - and that a secret must be rotated", async () => {
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(taskWith({ hasSecrets: true }));
    const feed: SpyInstance<
      typeof DataSecurityIssueFeedService.createDataSecurityIssueFeedItem
    > = jest
      .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
      .mockResolvedValue(undefined as never);

    await TelemetryLeakFix.onPullRequestOpened({
      projectId: PROJECT_ID,
      aiRunId: new ObjectID(RUN_ID),
      pullRequestUrl: "https://github.com/acme/checkout/pull/42",
      title: "fix: Stop checkout writing sensitive data to its telemetry",
    });

    expect(
      feed.mock.calls.map((call: Array<unknown>): string => {
        return (
          call[0] as { dataSecurityIssueId: ObjectID }
        ).dataSecurityIssueId.toString();
      }),
    ).toEqual([SPAN_ISSUE_ID, LOG_ISSUE_ID]);

    const markdown: string = (
      feed.mock.calls[0]![0] as { feedInfoInMarkdown: string }
    ).feedInfoInMarkdown;

    expect(markdown).toContain("https://github.com/acme/checkout/pull/42");
    expect(markdown).toContain("Rotate the secret too");
  });

  test("a pull request of another recipe's task says nothing on them", async () => {
    const run: AIRun = new AIRun(new ObjectID(RUN_ID));

    run.taskContext = {} as never;
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(run);
    const feed: SpyInstance<
      typeof DataSecurityIssueFeedService.createDataSecurityIssueFeedItem
    > = jest
      .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
      .mockResolvedValue(undefined as never);

    await TelemetryLeakFix.onPullRequestOpened({
      projectId: PROJECT_ID,
      aiRunId: new ObjectID(RUN_ID),
      pullRequestUrl: "https://github.com/acme/checkout/pull/43",
      title: "fix: something else",
    });

    expect(feed).not.toHaveBeenCalled();
  });
});

/*
 * A DATA SECURITY CASE'S PLAYBOOK ASKS FOR IT (#10740): OneUptime plans the
 * fix Fix with AI on the issue would show, asks it in the repository the
 * plan found, and keeps the task on the case. The expiry of what waits for
 * a person is a person's ask alone.
 */
describe("a security case's playbook asks for it", () => {
  test("planned as OneUptime, asked in the repository the plan found, and kept on the case", async () => {
    const caseId: ObjectID = new ObjectID(
      "10740000-0000-4000-8000-0000000000ca",
    );
    const planned: {
      result: DataSecurityTelemetryFixPlanResult;
      plan: TelemetryLeakFixPlan | null;
    } = await TelemetryLeakFix.planForIssue({
      projectId: PROJECT_ID,
      issueId: new ObjectID(LOG_ISSUE_ID),
      props: { isRoot: true },
    });

    expect(planned.plan?.repository?.id).toBe(CHECKOUT_REPOSITORY.id);

    const result: DataSecurityFixResult & { wasAlreadyAsked?: boolean } =
      await TelemetryLeakFix.start({
        projectId: PROJECT_ID,
        plan: planned.plan!,
        props: { isRoot: true },
        requestedRepositoryId: planned.plan!.repository!.id,
        triggeredBySecurityCaseId: caseId,
      });

    expect(result.aiRunId).toBe(RUN_ID);
    expect(requested).toHaveBeenCalledTimes(1);
    expect(requested.mock.calls[0]![0]).toMatchObject({
      props: { isRoot: true },
      requestedRepositoryId: CHECKOUT_REPOSITORY.id,
      triggeredBySecurityCaseId: caseId,
    });
    expect(
      DataSecurityAiProposalService.expireWaitingInLane,
    ).not.toHaveBeenCalled();
  });
});
