import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DataSecurityAPI from "../../../Server/API/DataSecurityAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import DataSecurityIssueFeedService from "../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../Server/Services/DataSecurityIssueService";
import DataSecurityResidencyRuleService from "../../../Server/Services/DataSecurityResidencyRuleService";
import DataSecuritySettingService from "../../../Server/Services/DataSecuritySettingService";
import DataStoreFeedService from "../../../Server/Services/DataStoreFeedService";
import DataStoreFindingService from "../../../Server/Services/DataStoreFindingService";
import DataStoreOwnerTeamService from "../../../Server/Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../../Server/Services/DataStoreOwnerUserService";
import DataStoreService from "../../../Server/Services/DataStoreService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import LabelService from "../../../Server/Services/LabelService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import { ChangeDataSecurityIssueTool } from "../../../Server/Utils/AI/Toolbox/DataSecurityIssueActionTools";
import {
  JudgeDataSecurityFindingTool,
  ScrubDataSecurityFindingTool,
  forgetScrubImpacts,
} from "../../../Server/Utils/AI/Toolbox/DataSecurityFindingActionTools";
import { SaveDataSecurityRuleTool } from "../../../Server/Utils/AI/Toolbox/DataSecurityRuleTools";
import {
  RespondOnDataStoreTool,
  SetDataStoreOwnersTool,
} from "../../../Server/Utils/AI/Toolbox/DataSecurityStoreActionTools";
import {
  ObservabilityTool,
  PreparedMutation,
  ToolContext,
} from "../../../Server/Utils/AI/Toolbox/ToolTypes";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import * as DataSecurityJobs from "../../../Server/Utils/DataSecurity/DataSecurityJobs";
import DataSecurityResponse from "../../../Server/Utils/DataSecurity/DataSecurityResponse";
import * as TelemetryScrubImpact from "../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubImpact";
import * as TelemetryScrubIt from "../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubIt";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityResidencyRule from "../../../Models/DatabaseModels/DataSecurityResidencyRule";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import DataStoreOwnerTeam from "../../../Models/DatabaseModels/DataStoreOwnerTeam";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DATA_SECURITY_API_ROUTES } from "../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataSecurityResponseAction } from "../../../Types/DataSecurity/DataSecurityResponseAction";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  IssueMove,
  getIssueAssignWrite,
  getIssueMoveWrite,
} from "../../../Utils/DataSecurity/DataSecurityIssueChanges";
import {
  getConfirmFindingWrite,
  getNotSensitiveFindingWrite,
} from "../../../Utils/DataSecurity/DataStoreFindingDecisions";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp from "../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryHookFreeWrites,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * EACH OF ASK AI'S DATA SECURITY ACTIONS IS ITS BUTTON (#10378).
 *
 * "Each action must call the same server code as its button." Here each
 * button is pressed as the Dashboard presses it - its own request, through
 * Express's body parser, the routes, BaseAPI, the permission layer and the
 * services - and each action runs on a fresh copy of the same fixture, as
 * Ask AI's turn runs it: prepared, then executed, as the same person. What
 * each wrote must be the same, column for column:
 *
 *   - Accept Risk, Not an Issue, Reopen and Assign on an issue;
 *   - Confirm and Not Sensitive on a finding;
 *   - a team added as a store's owner;
 *   - a residency rule saved;
 *   - Scrub It on a telemetry finding, and a response on a store, compared
 *     by what reaches the code under them: the scrub rule made, and the
 *     cloud's response run, with the same arguments.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10378000-0000-4000-8000-000000000201",
);
const BUCKET_ID: string = "10378000-0000-4000-8000-0000000002b1";
const LOGS_ID: string = "10378000-0000-4000-8000-0000000002b2";
const OPEN_ISSUE_ID: string = "10378000-0000-4000-8000-0000000002c1";
const RESOLVED_ISSUE_ID: string = "10378000-0000-4000-8000-0000000002c2";
const FINDING_ID: string = "10378000-0000-4000-8000-0000000002d1";
const TEAM_ID: string = "10378000-0000-4000-8000-0000000002f1";

const CALLER: DatabaseCommonInteractionProps = {
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

const BUCKET: StoredRow = {
  _id: BUCKET_ID,
  projectId: PROJECT_ID.toString(),
  name: "website-assets",
  kind: "AWS S3 Bucket",
  provider: "aws",
  region: "us-east-1",
  exposure: "Public",
  sensitivity: "Confidential",
  dataTypeIds: ["email-address"],
  dataCategories: ["Contact and identity"],
  subjectCountries: [],
  isArchived: false,
  cloudConnectionId: "10378000-0000-4000-8000-0000000002a1",
};

const LOGS: StoredRow = {
  ...BUCKET,
  _id: LOGS_ID,
  name: "checkout · Logs",
  kind: "Logs",
  provider: "oneuptime",
  region: null,
  exposure: "Private",
  cloudConnectionId: null,
};

interface World {
  issues: InMemoryTable;
  findings: InMemoryTable;
  ownerTeams: InMemoryTable;
  residencyRules: InMemoryTable;
  scrub: SpyInstance<typeof TelemetryScrubIt.scrubFindingWithProvenRule>;
  respond: SpyInstance<typeof DataSecurityResponse.run>;
}

let server: DashboardRequestsOverHttp;

// Every request a signed-in person's: the routes take these when they are built.
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
    new BaseAPI<DataSecurityIssue, DatabaseService<BaseModel>>(
      DataSecurityIssue,
      DataSecurityIssueService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<DataStoreFinding, DatabaseService<BaseModel>>(
      DataStoreFinding,
      DataStoreFindingService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<DataStoreOwnerTeam, DatabaseService<BaseModel>>(
      DataStoreOwnerTeam,
      DataStoreOwnerTeamService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<DataSecurityResidencyRule, DatabaseService<BaseModel>>(
      DataSecurityResidencyRule,
      DataSecurityResidencyRuleService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

afterEach(() => {
  jest.restoreAllMocks();
  passThroughSessions();
  forgetScrubImpacts();
});

// The same fixture, fresh, for a button or an action.
function fresh(): World {
  jest.restoreAllMocks();
  forgetScrubImpacts();
  server.requests.length = 0;

  everyServerProductIsOn();
  passThroughSessions();
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return CALLER;
    });
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});

  useInMemoryTable(asService(DataStoreService), [BUCKET, LOGS]);
  const issues: InMemoryTable = useInMemoryTable(
    asService(DataSecurityIssueService),
    [
      {
        _id: OPEN_ISSUE_ID,
        projectId: PROJECT_ID.toString(),
        title: "Anyone on the internet can read it",
        checkId: "public-read",
        severity: "Critical",
        status: "Open",
        dataStoreId: BUCKET_ID,
        dataStore: BUCKET,
      },
      {
        _id: RESOLVED_ISSUE_ID,
        projectId: PROJECT_ID.toString(),
        title: "Versioning is off",
        checkId: "versioning-off",
        severity: "Low",
        status: "Resolved",
        dataStoreId: BUCKET_ID,
        dataStore: BUCKET,
      },
    ],
  );
  const findings: InMemoryTable = useInMemoryTable(
    asService(DataStoreFindingService),
    [
      {
        _id: FINDING_ID,
        projectId: PROJECT_ID.toString(),
        dataStoreId: LOGS_ID,
        dataStore: LOGS,
        dataTypeId: "email-address",
        dataTypeName: "Email address",
        location: "attributes.user.email",
        locationKind: "Attribute",
        confidence: "High",
        isScrubbed: false,
        isSuppressed: false,
        isConfirmed: false,
      },
    ],
  );
  useInMemoryHookFreeWrites(asService(DataStoreFindingService), findings);
  useInMemoryTable(asService(DataSecuritySettingService), []);
  useInMemoryTable(asService(DataStoreOwnerUserService), []);
  const ownerTeams: InMemoryTable = useInMemoryTable(
    asService(DataStoreOwnerTeamService),
    [],
  );
  useInMemoryTable(asService(TeamMemberService), []);
  useInMemoryTable(asService(TeamService), [
    { _id: TEAM_ID, projectId: PROJECT_ID.toString(), name: "Payments" },
  ]);
  useInMemoryTable(asService(LabelService), []);
  const residencyRules: InMemoryTable = useInMemoryTable(
    asService(DataSecurityResidencyRuleService),
    [],
  );

  jest
    .spyOn(ProjectReferenceCheck, "validateUpdate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectReferenceCheck, "validateCreate")
    .mockResolvedValue(undefined as never);
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null as never);
  jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(DataStoreFeedService, "createDataStoreFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(DataSecurityJobs, "queueDataSecurityEvaluation")
    .mockResolvedValue(undefined as never);
  jest.spyOn(TelemetryScrubImpact, "getScrubItImpact").mockResolvedValue({
    isAvailable: true,
    rule: {
      signal: "log",
      name: "Data Security: Email address in attributes.user.email",
      scrubAction: "mask",
      patternType: "Email",
      fieldsToScrub: "attributes",
      dataTypeName: "Email address",
    },
  } as never);
  const scrub: SpyInstance<typeof TelemetryScrubIt.scrubFindingWithProvenRule> =
    jest
      .spyOn(TelemetryScrubIt, "scrubFindingWithProvenRule")
      .mockResolvedValue({
        signal: "log",
        scrubRuleId: "10378000-0000-4000-8000-0000000002a2",
        scrubRuleName: "Data Security: Email address in attributes.user.email",
        isProven: true,
        hidesFinding: true,
      } as never);
  jest.spyOn(DataSecurityResponse, "getAvailability").mockResolvedValue({
    actions: [
      {
        action: DataSecurityResponseAction.BlockPublicAccess,
        isAvailable: true,
      },
    ],
  } as never);
  const respond: SpyInstance<typeof DataSecurityResponse.run> = jest
    .spyOn(DataSecurityResponse, "run")
    .mockResolvedValue({ status: "Succeeded" } as never);

  return { issues, findings, ownerTeams, residencyRules, scrub, respond };
}

const CTX: ToolContext = { projectId: PROJECT_ID, props: CALLER };

// The action as Ask AI's turn runs it: prepared, then executed with what was prepared.
async function act(tool: ObservabilityTool, args: JSONObject): Promise<void> {
  const prepared: PreparedMutation | undefined = tool.prepareMutation
    ? await tool.prepareMutation(args, CTX)
    : undefined;

  await tool.execute(prepared?.arguments || args, CTX);
}

// The columns no write chooses: when it was made, its id, its version.
const NOT_WRITTEN: RegExp = /(At|_id|version)$/;

// A row as the comparison reads it: what was written, not when or by which write.
function written(row: StoredRow | undefined): JSONObject {
  const kept: JSONObject = {};

  for (const [key, value] of Object.entries(row || {})) {
    if (NOT_WRITTEN.test(key) || key === "_id") {
      continue;
    }

    kept[key] = JSON.parse(JSON.stringify(value ?? null));
  }

  return kept;
}

const UNTIL: Date = new Date("2027-03-31T23:59:59.999Z");

describe("an issue's buttons and change_data_security_issue write the same", () => {
  test("Accept Risk, with its reason and its date", async () => {
    const button: World = fresh();
    await ModelAPI.updateById({
      modelType: DataSecurityIssue,
      id: new ObjectID(OPEN_ISSUE_ID),
      data: getIssueMoveWrite(IssueMove.Accept, {
        reason: "It is our CDN origin.",
        until: UNTIL,
      }),
    });
    const pressed: JSONObject = written(button.issues.get(OPEN_ISSUE_ID));

    const action: World = fresh();
    await act(ChangeDataSecurityIssueTool, {
      dataSecurityIssueId: OPEN_ISSUE_ID,
      change: "accept-risk",
      reason: "It is our CDN origin.",
      acceptedUntil: "2027-03-31",
    });

    expect(pressed["status"]).toBe("Accepted");
    expect(written(action.issues.get(OPEN_ISSUE_ID))).toEqual(pressed);
  });

  test("Not an Issue, with its reason", async () => {
    const button: World = fresh();
    await ModelAPI.updateById({
      modelType: DataSecurityIssue,
      id: new ObjectID(OPEN_ISSUE_ID),
      data: getIssueMoveWrite(
        IssueMove.NotAnIssue,
        undefined,
        "It is a public website on purpose.",
      ),
    });
    const pressed: JSONObject = written(button.issues.get(OPEN_ISSUE_ID));

    const action: World = fresh();
    await act(ChangeDataSecurityIssueTool, {
      dataSecurityIssueId: OPEN_ISSUE_ID,
      change: "not-an-issue",
      reason: "It is a public website on purpose.",
    });

    expect(pressed["status"]).toBe("Not an issue");
    expect(written(action.issues.get(OPEN_ISSUE_ID))).toEqual(pressed);
  });

  test("Reopen", async () => {
    const button: World = fresh();
    await ModelAPI.updateById({
      modelType: DataSecurityIssue,
      id: new ObjectID(RESOLVED_ISSUE_ID),
      data: getIssueMoveWrite(IssueMove.Reopen),
    });
    const pressed: JSONObject = written(button.issues.get(RESOLVED_ISSUE_ID));

    const action: World = fresh();
    await act(ChangeDataSecurityIssueTool, {
      dataSecurityIssueId: RESOLVED_ISSUE_ID,
      change: "reopen",
    });

    expect(pressed["status"]).toBe("Open");
    expect(written(action.issues.get(RESOLVED_ISSUE_ID))).toEqual(pressed);
  });

  test("Assign, to a team by its name", async () => {
    const button: World = fresh();
    await ModelAPI.updateById({
      modelType: DataSecurityIssue,
      id: new ObjectID(OPEN_ISSUE_ID),
      data: getIssueAssignWrite({ teamId: TEAM_ID }),
    });
    const pressed: JSONObject = written(button.issues.get(OPEN_ISSUE_ID));

    const action: World = fresh();
    await act(ChangeDataSecurityIssueTool, {
      dataSecurityIssueId: OPEN_ISSUE_ID,
      change: "assign",
      assignee: "Payments",
    });

    expect(String(pressed["assignedToTeamId"])).toContain(TEAM_ID);
    expect(written(action.issues.get(OPEN_ISSUE_ID))).toEqual(pressed);
  });
});

describe("a finding's buttons and judge_data_security_finding write the same", () => {
  test("Confirm", async () => {
    const button: World = fresh();
    await ModelAPI.updateById({
      modelType: DataStoreFinding,
      id: new ObjectID(FINDING_ID),
      data: getConfirmFindingWrite(),
    });
    const pressed: JSONObject = written(button.findings.get(FINDING_ID));

    const action: World = fresh();
    await act(JudgeDataSecurityFindingTool, {
      dataStoreFindingId: FINDING_ID,
      decision: "confirm",
    });

    expect(pressed["isConfirmed"]).toBe(true);
    expect(written(action.findings.get(FINDING_ID))).toEqual(pressed);
  });

  test("Not Sensitive, with its reason", async () => {
    const button: World = fresh();
    await ModelAPI.updateById({
      modelType: DataStoreFinding,
      id: new ObjectID(FINDING_ID),
      data: getNotSensitiveFindingWrite("Test accounts only."),
    });
    const pressed: JSONObject = written(button.findings.get(FINDING_ID));

    const action: World = fresh();
    await act(JudgeDataSecurityFindingTool, {
      dataStoreFindingId: FINDING_ID,
      decision: "not-sensitive",
      reason: "Test accounts only.",
    });

    expect(pressed["isSuppressed"]).toBe(true);
    expect(written(action.findings.get(FINDING_ID))).toEqual(pressed);
  });
});

describe("the other buttons and their actions write the same", () => {
  test("a team added as a store's owner", async () => {
    const button: World = fresh();
    const owner: DataStoreOwnerTeam = new DataStoreOwnerTeam();
    owner.projectId = PROJECT_ID;
    owner.dataStoreId = new ObjectID(BUCKET_ID);
    owner.teamId = new ObjectID(TEAM_ID);
    await ModelAPI.create({ modelType: DataStoreOwnerTeam, model: owner });

    const action: World = fresh();
    await act(SetDataStoreOwnersTool, {
      dataStoreId: BUCKET_ID,
      add: ["Payments"],
    });

    expect(button.ownerTeams.rows).toHaveLength(1);
    expect(action.ownerTeams.rows.map(written)).toEqual(
      button.ownerTeams.rows.map(written),
    );
  });

  test("a residency rule saved, as the Residency Rules form saves it", async () => {
    const button: World = fresh();
    const rule: DataSecurityResidencyRule = new DataSecurityResidencyRule();
    rule.projectId = PROJECT_ID;
    rule.name = "EU personal data stays in the EU";
    rule.description = "Personal data is kept only in EU regions.";
    rule.dataCategories = [] as never;
    rule.subjectCountries = [] as never;
    rule.allowedRegions = ["eu-*", "europe-*"] as never;
    // As the form's Enabled switch starts.
    rule.isEnabled = true;
    await ModelAPI.create({
      modelType: DataSecurityResidencyRule,
      model: rule,
    });

    const action: World = fresh();
    await act(SaveDataSecurityRuleTool, {
      kind: "residency",
      name: "EU personal data stays in the EU",
      description: "Personal data is kept only in EU regions.",
      dataCategories: [],
      subjectCountries: [],
      allowedRegions: ["eu-*", "europe-*"],
    });

    expect(button.residencyRules.rows).toHaveLength(1);
    expect(action.residencyRules.rows.map(written)).toEqual(
      button.residencyRules.rows.map(written),
    );
  });

  test("Scrub It: the same proven rule is made, with the same props, and the finding is marked scrubbed", async () => {
    const button: World = fresh();
    const sent: { status: number } = await server.request(
      "POST",
      `/api${DATA_SECURITY_API_ROUTES.scrubFinding(FINDING_ID)}`,
      {},
    );

    expect(sent.status).toBe(200);
    const pressed: unknown = button.scrub.mock.calls[0]![0];

    const action: World = fresh();
    await act(ScrubDataSecurityFindingTool, { dataStoreFindingId: FINDING_ID });

    expect(action.scrub.mock.calls[0]![0]).toEqual(pressed);
    expect(written(action.findings.get(FINDING_ID))).toEqual(
      written(button.findings.get(FINDING_ID)),
    );
    expect(action.findings.get(FINDING_ID)?.["isScrubbed"]).toBe(true);
  });

  test("a response on a store: the cloud's response runs with the same arguments", async () => {
    const button: World = fresh();
    const sent: { status: number } = await server.request(
      "POST",
      `/api${DATA_SECURITY_API_ROUTES.respond(BUCKET_ID)}`,
      {
        action: DataSecurityResponseAction.BlockPublicAccess,
        dataSecurityIssueId: OPEN_ISSUE_ID,
      },
    );

    expect(sent.status).toBe(200);
    const pressed: unknown = button.respond.mock.calls[0]![0];

    const action: World = fresh();
    await act(RespondOnDataStoreTool, {
      dataStoreId: BUCKET_ID,
      action: DataSecurityResponseAction.BlockPublicAccess,
      dataSecurityIssueId: OPEN_ISSUE_ID,
    });

    expect(action.respond.mock.calls[0]![0]).toEqual(pressed);
  });
});
