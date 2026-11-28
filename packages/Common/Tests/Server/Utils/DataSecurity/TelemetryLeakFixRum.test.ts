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
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import RumApplicationService from "../../../../Server/Services/RumApplicationService";
import ServiceService from "../../../../Server/Services/ServiceService";
import TelemetrySourceMapService from "../../../../Server/Services/TelemetrySourceMapService";
import CodeFixOnItsWay from "../../../../Server/Utils/AI/CodeFix/CodeFixOnItsWay";
import CodeTaskAccess from "../../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import DataSecurityCodeTask, {
  DATA_SECURITY_APPLICATION_FIX_STARTED_MESSAGE,
} from "../../../../Server/Utils/AI/DataSecurity/DataSecurityCodeTask";
import { ResolvableRepository } from "../../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import DataSecurityRunner from "../../../../Server/Utils/DataSecurity/DataSecurityRunner";
import ProjectDataTypeNames from "../../../../Server/Utils/DataSecurity/ProjectDataTypeNames";
import TelemetryLeakFix, {
  TELEMETRY_FIX_NOTHING_TO_FIX_IN_APPLICATION_MESSAGE,
  ServiceLeakFinding,
  TELEMETRY_FIX_NOT_A_SERVICE_MESSAGE,
  TelemetryLeakFixPlan,
  readSourceMapSources,
} from "../../../../Server/Utils/DataSecurity/TelemetryLeakFix";
import TelemetryLeakLocator, {
  TelemetryLeakFindingToLocate,
  TelemetryLeakLocation,
} from "../../../../Server/Utils/DataSecurity/Telemetry/TelemetryLeakLocator";
import * as TelemetryScrubCoverage from "../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import { TelemetryLeakFixTaskContext } from "../../../../Types/AI/CodeFixTaskContext";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DataSecurityFixResult,
  DataSecurityTelemetryFixPlanResult,
  DataSecurityTelemetryFixRepositoryChoice,
} from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { telemetryDataStoreKey } from "../../../../Types/DataSecurity/DataStoreKey";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import {
  TelemetryLeakFixLeak,
  TelemetryLeakFixOwnerKind,
  TelemetryLeakFixStrategy,
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
 * A RUM APPLICATION'S LEAKS, FIXED IN ITS FRONT-END CODE (#10933).
 *
 * A RUM application, its session replay store (keyed by the application:
 * telemetry:<id>:Session Replays), its two issues - one per check: an email
 * in a browser log and in a session's user details, and a token in a
 * browser span - and their findings are rows held in memory; where each
 * leak is written is what the locator would read: the original file its
 * stack resolves to, the page, the session recorder call. Fix with AI on
 * either issue plans ONE pull request for the application's leaks in the
 * repository its records' files are in - else where the files its source
 * maps name are - in its front-end words: the application, the browser,
 * the session recorder. The service's own path is untouched.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10933000-0000-4000-8000-000000000001",
);
const APP_ID: string = "10933000-0000-4000-8000-0000000000e1";
const SOURCE_MAP_SERVICE_ID: string = "10933000-0000-4000-8000-0000000000e2";
const REPLAY_STORE_ID: string = "10933000-0000-4000-8000-0000000000b1";
const BUCKET_STORE_ID: string = "10933000-0000-4000-8000-0000000000b2";
// One issue per check of the store, as the scan opens them.
const SENSITIVE_ISSUE_ID: string = "10933000-0000-4000-8000-0000000000a1";
const SECRET_ISSUE_ID: string = "10933000-0000-4000-8000-0000000000a2";
const LOG_FINDING_ID: string = "10933000-0000-4000-8000-0000000000d1";
const SESSION_FINDING_ID: string = "10933000-0000-4000-8000-0000000000d2";
const SPAN_FINDING_ID: string = "10933000-0000-4000-8000-0000000000d3";
const RUN_ID: string = "10933000-0000-4000-8000-0000000000f1";

const WEB_REPOSITORY: ResolvableRepository = {
  id: "10933000-0000-4000-8000-0000000000c1",
  name: "web",
  organizationName: "acme",
  repositoryName: "web",
  mainBranchName: "main",
  gitHubAppInstallationId: null,
};
const API_REPOSITORY: ResolvableRepository = {
  ...WEB_REPOSITORY,
  id: "10933000-0000-4000-8000-0000000000c2",
  name: "api",
  repositoryName: "api",
};

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

function findingRow(data: {
  id: string;
  location: string;
  dataTypeId?: string;
}): StoredRow {
  return {
    _id: data.id,
    projectId: PROJECT_ID.toString(),
    dataStoreId: REPLAY_STORE_ID,
    dataTypeId: data.dataTypeId || "email-address",
    dataTypeName: data.dataTypeId ? "JSON web token" : "Email address",
    location: data.location,
    locationKind: "Attribute",
    confidence: "High",
    matchCount: 12,
    isConfirmed: false,
    isAiSuggested: false,
    isSuppressed: false,
    isScrubbed: false,
    lastSeenAt: new Date(),
    sampleRecords: [],
  };
}

function issueRow(
  id: string,
  riskScore: number,
  storeId: string,
  checkId: string = "sensitive-data-in-telemetry",
): StoredRow {
  return {
    _id: id,
    projectId: PROJECT_ID.toString(),
    title: "Sensitive data is reaching your telemetry",
    checkId,
    severity: "High",
    riskScore,
    status: "Open",
    dataStoreId: storeId,
  };
}

let places: Map<string, Array<TelemetryLeakPlace>>;
let trees: Record<string, Array<string>>;
let repositories: Array<ResolvableRepository>;
let sourceMaps: Array<StoredRow>;
let located: Array<TelemetryLeakFindingToLocate>;
let requested: SpyInstance<typeof DataSecurityCodeTask.requestTelemetryLeakFix>;

function useWorld(data: { findings?: Array<StoredRow> } = {}): void {
  useInMemoryTable(asService(RumApplicationService), [
    {
      _id: APP_ID,
      projectId: PROJECT_ID.toString(),
      name: "Storefront",
      appIdentifier: "storefront-web",
    },
  ]);
  // The service its builds' source maps were uploaded under, named as it names itself.
  useInMemoryTable(asService(ServiceService), [
    {
      _id: SOURCE_MAP_SERVICE_ID,
      projectId: PROJECT_ID.toString(),
      name: "storefront-web",
    },
  ]);
  useInMemoryTable(asService(DataStoreService), [
    {
      _id: REPLAY_STORE_ID,
      projectId: PROJECT_ID.toString(),
      name: "Storefront · Session Replays",
      kind: DataStoreKind.TelemetrySessionReplays,
      storeKey: telemetryDataStoreKey({
        serviceId: APP_ID,
        kind: DataStoreKind.TelemetrySessionReplays,
      }),
      provider: "oneuptime",
      isArchived: false,
    },
    {
      _id: BUCKET_STORE_ID,
      projectId: PROJECT_ID.toString(),
      name: "invoices",
      kind: "AWS S3 Bucket",
      provider: "aws",
      isArchived: false,
    },
  ]);
  useInMemoryTable(asService(DataSecurityIssueService), [
    issueRow(SENSITIVE_ISSUE_ID, 70, REPLAY_STORE_ID),
    issueRow(SECRET_ISSUE_ID, 90, REPLAY_STORE_ID, "secrets-in-telemetry"),
  ]);
  useInMemoryTable(
    asService(DataStoreFindingService),
    data.findings || [
      findingRow({
        id: LOG_FINDING_ID,
        location: "logs.attributes.user.email",
      }),
      findingRow({
        id: SESSION_FINDING_ID,
        location: "sessions.identifiedUserLabel",
      }),
      findingRow({
        id: SPAN_FINDING_ID,
        location: "spans.attributes.http.request.header.authorization",
        dataTypeId: "json-web-token",
      }),
    ],
  );
  useInMemoryTable(asService(TelemetrySourceMapService), sourceMaps);
}

beforeEach(() => {
  located = [];
  places = new Map([
    [
      LOG_FINDING_ID,
      [
        {
          filePath: "src/checkout/payment.js",
          lineNumber: 8,
          functionName: "pay",
          template: "Payment declined",
          page: "/checkout/[redacted]/pay",
          recordCount: 3,
        },
      ],
    ],
    [
      SESSION_FINDING_ID,
      [{ recorderCall: "identify", page: "/account/settings", recordCount: 2 }],
    ],
    [
      SPAN_FINDING_ID,
      [
        {
          filePath: "src/api/client.js",
          lineNumber: 21,
          functionName: "authorize",
          spanName: "GET /api/orders",
          page: "/orders",
          recordCount: 4,
        },
      ],
    ],
  ]);
  trees = {
    [WEB_REPOSITORY.id]: [
      "src/checkout/payment.js",
      "src/api/client.js",
      "src/session.js",
      "src/recorder.js",
    ],
    [API_REPOSITORY.id]: ["server/index.js"],
  };
  repositories = [WEB_REPOSITORY, API_REPOSITORY];
  sourceMaps = [];

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
  jest.spyOn(TelemetryLeakLocator, "locate").mockImplementation((async (data: {
    findings: ReadonlyArray<TelemetryLeakFindingToLocate>;
  }) => {
    located.push(...data.findings);

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
  jest.spyOn(CodeFixOnItsWay, "findTaskId").mockResolvedValue(null as never);

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
    .mockResolvedValue(askable as never);
  jest
    .spyOn(DataSecurityAiProposalService, "expireWaitingInLane")
    .mockResolvedValue(0);
  requested = jest
    .spyOn(DataSecurityCodeTask, "requestTelemetryLeakFix")
    .mockResolvedValue({
      message: DATA_SECURITY_APPLICATION_FIX_STARTED_MESSAGE,
      aiRunId: RUN_ID,
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function planOfApplication(): Promise<Array<TelemetryLeakFixPlan>> {
  return await TelemetryLeakFix.planRumApplication({
    projectId: PROJECT_ID,
    rumApplicationId: new ObjectID(APP_ID),
  });
}

describe("whose code an issue's fix changes", () => {
  test("a session replay issue: the RUM application its store is keyed by", async () => {
    expect(
      await TelemetryLeakFix.ownerOfIssue({
        projectId: PROJECT_ID,
        issue: {
          checkId: "sensitive-data-in-telemetry",
          dataStoreId: new ObjectID(REPLAY_STORE_ID),
        },
      }),
    ).toEqual({
      kind: TelemetryLeakFixOwnerKind.RumApplication,
      id: new ObjectID(APP_ID),
    });
  });

  test("a bucket's issue, or another check's, is nobody's code", async () => {
    expect(
      await TelemetryLeakFix.ownerOfIssue({
        projectId: PROJECT_ID,
        issue: {
          checkId: "public-read",
          dataStoreId: new ObjectID(BUCKET_STORE_ID),
        },
      }),
    ).toBeNull();
    expect(
      await TelemetryLeakFix.ownerOfIssue({
        projectId: PROJECT_ID,
        issue: {
          checkId: "public-read",
          dataStoreId: new ObjectID(REPLAY_STORE_ID),
        },
      }),
    ).toBeNull();
  });

  test("a session replay store is no service's: the service's own path still says so", async () => {
    expect(
      await TelemetryLeakFix.serviceOfIssue({
        projectId: PROJECT_ID,
        issue: {
          checkId: "sensitive-data-in-telemetry",
          dataStoreId: new ObjectID(REPLAY_STORE_ID),
        },
      }),
    ).toBeNull();
  });
});

describe("a RUM application's leaks", () => {
  test("its session replay store's findings, each the signal its place says, the application its owner", async () => {
    const leaks: Awaited<
      ReturnType<typeof TelemetryLeakFix.readRumApplicationLeaks>
    > = await TelemetryLeakFix.readRumApplicationLeaks({
      projectId: PROJECT_ID,
      rumApplicationId: new ObjectID(APP_ID),
    });

    expect(leaks?.owner).toEqual({
      kind: TelemetryLeakFixOwnerKind.RumApplication,
      id: APP_ID,
      name: "Storefront",
      codeName: "storefront-web",
      sourceMapServiceId: SOURCE_MAP_SERVICE_ID,
    });
    expect(
      leaks?.stores.map((store: DataStore): string | undefined => {
        return store.id?.toString();
      }),
    ).toEqual([REPLAY_STORE_ID]);
    expect(
      leaks?.findings
        .map((entry: ServiceLeakFinding): Array<string | undefined> => {
          return [entry.finding.id?.toString(), entry.signal];
        })
        .sort(),
    ).toEqual(
      [
        [LOG_FINDING_ID, TelemetryLeakSignal.RumLogs],
        [SESSION_FINDING_ID, TelemetryLeakSignal.RumSessions],
        [SPAN_FINDING_ID, TelemetryLeakSignal.RumSpans],
      ].sort(),
    );
    // Each finding the issue of its check: the token's the secrets issue.
    expect(
      leaks?.findings
        .map((entry: ServiceLeakFinding): Array<string | undefined> => {
          return [entry.finding.id?.toString(), entry.issue.id?.toString()];
        })
        .sort(),
    ).toEqual(
      [
        [LOG_FINDING_ID, SENSITIVE_ISSUE_ID],
        [SESSION_FINDING_ID, SENSITIVE_ISSUE_ID],
        [SPAN_FINDING_ID, SECRET_ISSUE_ID],
      ].sort(),
    );
  });

  test("an application that is not the project's has none", async () => {
    expect(
      await TelemetryLeakFix.readRumApplicationLeaks({
        projectId: PROJECT_ID,
        rumApplicationId: ObjectID.generate(),
      }),
    ).toBeNull();
  });

  test("is located by its records, through the application's source maps", async () => {
    await planOfApplication();

    expect(located.length).toBe(3);

    for (const finding of located) {
      expect(finding).toMatchObject({
        storeKind: DataStoreKind.TelemetrySessionReplays,
        ownerId: APP_ID,
        sourceMapServiceId: SOURCE_MAP_SERVICE_ID,
      });
    }
  });
});

describe("one pull request per application and repository", () => {
  test("every leak in one plan, in the repository the records' original files are in, in the application's front-end words", async () => {
    const plans: Array<TelemetryLeakFixPlan> = await planOfApplication();

    expect(plans).toHaveLength(1);

    const plan: TelemetryLeakFixPlan = plans[0]!;

    expect(plan).toMatchObject({
      ownerKind: TelemetryLeakFixOwnerKind.RumApplication,
      serviceId: APP_ID,
      serviceName: "Storefront",
      repository: { id: WEB_REPOSITORY.id },
      choice: DataSecurityTelemetryFixRepositoryChoice.StackTrace,
    });
    expect(plan.decision.strategy).toBe(TelemetryLeakFixStrategy.CallSites);
    expect([...plan.startFiles].sort()).toEqual(
      ["src/api/client.js", "src/checkout/payment.js"].sort(),
    );
    expect(
      plan.decision.leaks
        .map((leak: TelemetryLeakFixLeak) => {
          return leak.signal;
        })
        .sort(),
    ).toEqual(
      [
        TelemetryLeakSignal.RumLogs,
        TelemetryLeakSignal.RumSessions,
        TelemetryLeakSignal.RumSpans,
      ].sort(),
    );
    // Both issues, the riskiest - the token's - first; a secret to rotate.
    expect(
      plan.issues.map((issue: { issueId: string }) => {
        return issue.issueId;
      }),
    ).toEqual([SECRET_ISSUE_ID, SENSITIVE_ISSUE_ID]);
    expect(plan.riskiestIssueId).toBe(SECRET_ISSUE_ID);
    expect(plan.hasSecrets).toBe(true);
    // One lane per application and repository: the service's own lanes never meet it.
    expect(
      plan.planKey.startsWith(`tleak-${APP_ID}-${WEB_REPOSITORY.id}`),
    ).toBe(true);
  });

  test("its task's context says it is the application's, in its title", async () => {
    const plan: TelemetryLeakFixPlan = (await planOfApplication())[0]!;
    const context: Omit<TelemetryLeakFixTaskContext, "request"> =
      TelemetryLeakFix.toTaskContext({ projectId: PROJECT_ID, plan });

    expect(context).toMatchObject({
      ownerKind: TelemetryLeakFixOwnerKind.RumApplication,
      serviceId: APP_ID,
      serviceName: "Storefront",
      title: "Stop Storefront sending sensitive data from the browser",
    });
  });

  test("its request is the front end's: the application, the browser, each place's page and recorder call", async () => {
    const plan: TelemetryLeakFixPlan = (await planOfApplication())[0]!;
    const text: string = TelemetryLeakFix.buildRequest(plan).text;

    expect(text).toContain(
      'Stop the web application "Storefront" sending sensitive data from the browser',
    );
    expect(text).toContain('"application": "Storefront"');
    expect(text).toContain('"runsIn": "browser"');
    expect(text).toContain('"page": "/account/settings"');
    expect(text).toContain('"recorderCall": "identify"');
    expect(text).toContain("identify() with an opaque reference");
    // A session's tags, by the call that gave them (#11458).
    expect(text).toContain(
      'where a session\'s tags hold it ("recorderCall": "setTags"), leave it out of the tags the page gives the session recorder with setTags() and addTag()',
    );
    expect(text).not.toContain('"service":');
  });

  test("leaks whose records name no file go where the files its newest release's source maps name are", async () => {
    places.set(LOG_FINDING_ID, [
      { template: "Payment declined", page: "/checkout", recordCount: 3 },
    ]);
    places.set(SPAN_FINDING_ID, [
      { spanName: "GET /api/orders", page: "/orders", recordCount: 4 },
    ]);
    trees[WEB_REPOSITORY.id] = [
      "web/src/checkout/payment.js",
      "web/src/session.js",
    ];
    // The application's name matches neither repository: only its source maps say.
    useInMemoryTable(asService(RumApplicationService), [
      {
        _id: APP_ID,
        projectId: PROJECT_ID.toString(),
        name: "Storefront",
        appIdentifier: "storefront-web",
      },
    ]);
    sourceMaps = [
      {
        _id: "10933000-0000-4000-8000-0000000000aa",
        projectId: PROJECT_ID.toString(),
        serviceId: SOURCE_MAP_SERVICE_ID,
        serviceVersion: "web-1.4.2",
        bundlePath: "assets/app.js",
        sizeInBytes: 400,
        createdAt: new Date("2026-11-20T10:00:00.000Z"),
        content: JSON.stringify({
          version: 3,
          sources: [
            "webpack://storefront-web/./src/checkout/payment.js",
            "webpack://storefront-web/./src/session.js",
            "webpack://storefront-web/./node_modules/react/index.js",
          ],
          sourcesContent: ["const secret = 1;"],
          mappings: "AAAA",
        }),
      },
    ];
    useInMemoryTable(asService(TelemetrySourceMapService), sourceMaps);

    const plans: Array<TelemetryLeakFixPlan> = await planOfApplication();

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      repository: { id: WEB_REPOSITORY.id },
      choice: DataSecurityTelemetryFixRepositoryChoice.SourceMaps,
      folder: "web",
    });
  });

  test("nothing decides: no repository, and a person picks among those they may ask in", async () => {
    places.set(LOG_FINDING_ID, [
      { template: "Payment declined", recordCount: 3 },
    ]);
    places.set(SPAN_FINDING_ID, [
      { spanName: "GET /api/orders", recordCount: 4 },
    ]);
    trees[WEB_REPOSITORY.id] = ["README.md"];

    const planned: {
      result: DataSecurityTelemetryFixPlanResult;
      plan: TelemetryLeakFixPlan | null;
    } = await TelemetryLeakFix.planForIssue({
      projectId: PROJECT_ID,
      issueId: new ObjectID(SENSITIVE_ISSUE_ID),
      props: PERSON,
    });

    expect(planned.result.plan?.ownerKind).toBe(
      TelemetryLeakFixOwnerKind.RumApplication,
    );
    expect(planned.result.plan?.repository).toBeUndefined();
    expect(planned.result.plan?.repositories?.length).toBe(2);

    const answer: DataSecurityFixResult = await TelemetryLeakFix.runForIssue({
      projectId: PROJECT_ID,
      issueId: new ObjectID(SENSITIVE_ISSUE_ID),
      props: PERSON,
      expectedPlanFingerprint: planned.result.plan!.fingerprint,
    });

    expect(answer.message).toBe(
      "Choose the repository that holds this application's front-end code.",
    );
    expect(requested).not.toHaveBeenCalled();
  });
});

describe("Fix with AI on a RUM application's issue", () => {
  test("shows the application's plan, then asks for exactly it, for both issues, in its repository", async () => {
    const planned: {
      result: DataSecurityTelemetryFixPlanResult;
      plan: TelemetryLeakFixPlan | null;
    } = await TelemetryLeakFix.planForIssue({
      projectId: PROJECT_ID,
      issueId: new ObjectID(SENSITIVE_ISSUE_ID),
      props: PERSON,
    });

    expect(planned.result.plan).toMatchObject({
      ownerKind: TelemetryLeakFixOwnerKind.RumApplication,
      serviceId: APP_ID,
      repository: { id: WEB_REPOSITORY.id },
    });

    const answer: DataSecurityFixResult = await TelemetryLeakFix.runForIssue({
      projectId: PROJECT_ID,
      issueId: new ObjectID(SENSITIVE_ISSUE_ID),
      props: PERSON,
      expectedPlanFingerprint: planned.result.plan!.fingerprint,
    });

    expect(answer.aiRunId).toBe(RUN_ID);
    expect(requested).toHaveBeenCalledTimes(1);
    expect(requested.mock.calls[0]![0]).toMatchObject({
      issueIds: expect.arrayContaining([
        new ObjectID(SENSITIVE_ISSUE_ID),
        new ObjectID(SECRET_ISSUE_ID),
      ]),
      requestedRepositoryId: WEB_REPOSITORY.id,
      fix: {
        ownerKind: TelemetryLeakFixOwnerKind.RumApplication,
        serviceId: APP_ID,
      },
    });
  });

  test("an application with nothing left to fix says so in its words", async () => {
    useWorld({ findings: [] });

    const planned: {
      result: DataSecurityTelemetryFixPlanResult;
    } = await TelemetryLeakFix.planForIssue({
      projectId: PROJECT_ID,
      issueId: new ObjectID(SENSITIVE_ISSUE_ID),
      props: PERSON,
    });

    expect(planned.result).toEqual({
      plan: null,
      message: TELEMETRY_FIX_NOTHING_TO_FIX_IN_APPLICATION_MESSAGE,
    });
  });

  test("an issue that is no service's and no application's is still refused as before", async () => {
    useInMemoryTable(asService(DataSecurityIssueService), [
      issueRow(SENSITIVE_ISSUE_ID, 90, BUCKET_STORE_ID, "public-read"),
    ]);

    const planned: {
      result: DataSecurityTelemetryFixPlanResult;
    } = await TelemetryLeakFix.planForIssue({
      projectId: PROJECT_ID,
      issueId: new ObjectID(SENSITIVE_ISSUE_ID),
      props: PERSON,
    });

    expect(planned.result.message).toBe(TELEMETRY_FIX_NOT_A_SERVICE_MESSAGE);
  });
});

describe("its pull request, on each issue it fixes", () => {
  test("each issue's timeline says it stops the application sending the data from the browser, and to rotate the token", async () => {
    const feed: SpyInstance<
      typeof DataSecurityIssueFeedService.createDataSecurityIssueFeedItem
    > = jest
      .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
      .mockResolvedValue(undefined);
    const plan: TelemetryLeakFixPlan = (await planOfApplication())[0]!;
    const context: TelemetryLeakFixTaskContext = {
      ...TelemetryLeakFix.toTaskContext({ projectId: PROJECT_ID, plan }),
      request: "the request",
    };
    const run: AIRun = new AIRun();

    run._id = RUN_ID;
    run.taskContext = { telemetryLeakFix: context } as never;
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(run);

    await TelemetryLeakFix.onPullRequestOpened({
      projectId: PROJECT_ID,
      aiRunId: new ObjectID(RUN_ID),
      pullRequestUrl: "https://github.com/acme/web/pull/91",
      title: "Stop Storefront sending sensitive data from the browser",
    });

    expect(feed).toHaveBeenCalledTimes(2);
    expect(
      feed.mock.calls
        .map((call: Array<unknown>): string => {
          return (
            call[0] as { dataSecurityIssueId: ObjectID }
          ).dataSecurityIssueId.toString();
        })
        .sort(),
    ).toEqual([SENSITIVE_ISSUE_ID, SECRET_ISSUE_ID].sort());

    for (const call of feed.mock.calls) {
      const said: string = String(call[0].feedInfoInMarkdown);

      expect(said).toContain(
        "stops Storefront sending sensitive data from the browser, for this issue and the application's others",
      );
      expect(said).toContain("https://github.com/acme/web/pull/91");
      expect(said).toContain("Rotate the secret too");
      expect(said).not.toContain("writing sensitive data to its telemetry");
    }
  });
});

describe("the files an application's source maps name", () => {
  test("their sources, a bundler's prefix taken off, a dependency's and the bundler's own left out - never their content", () => {
    expect(
      readSourceMapSources(
        JSON.stringify({
          version: 3,
          sources: [
            "webpack://storefront-web/./src/checkout/payment.js",
            "webpack://storefront-web/./src/session.js",
            "webpack://storefront-web/./src/session.js",
            "webpack://storefront-web/./node_modules/react/index.js",
            "webpack://storefront-web/webpack/runtime/jsonp chunk loading",
            "",
            7,
          ],
          sourcesContent: ["const apiKey = 'not here';"],
        }),
      ),
    ).toEqual(["src/checkout/payment.js", "src/session.js"]);
    expect(readSourceMapSources("not json")).toEqual([]);
    expect(readSourceMapSources(JSON.stringify({ version: 3 }))).toEqual([]);
  });

  test("of its newest release only, and none when nothing was uploaded", async () => {
    sourceMaps = [
      {
        _id: "10933000-0000-4000-8000-0000000000ab",
        projectId: PROJECT_ID.toString(),
        serviceId: SOURCE_MAP_SERVICE_ID,
        serviceVersion: "web-1.4.2",
        bundlePath: "assets/app.js",
        sizeInBytes: 100,
        createdAt: new Date("2026-11-20T10:00:00.000Z"),
        content: JSON.stringify({ version: 3, sources: ["./src/new.js"] }),
      },
      {
        _id: "10933000-0000-4000-8000-0000000000ac",
        projectId: PROJECT_ID.toString(),
        serviceId: SOURCE_MAP_SERVICE_ID,
        serviceVersion: "web-1.4.1",
        bundlePath: "assets/app.js",
        sizeInBytes: 100,
        createdAt: new Date("2026-11-19T10:00:00.000Z"),
        content: JSON.stringify({ version: 3, sources: ["./src/old.js"] }),
      },
    ];
    useInMemoryTable(asService(TelemetrySourceMapService), sourceMaps);

    expect(
      await TelemetryLeakFix.readSourceMapFiles({
        projectId: PROJECT_ID,
        serviceId: SOURCE_MAP_SERVICE_ID,
      }),
    ).toEqual(["src/new.js"]);

    useInMemoryTable(asService(TelemetrySourceMapService), []);

    expect(
      await TelemetryLeakFix.readSourceMapFiles({
        projectId: PROJECT_ID,
        serviceId: SOURCE_MAP_SERVICE_ID,
      }),
    ).toEqual([]);
  });
});
