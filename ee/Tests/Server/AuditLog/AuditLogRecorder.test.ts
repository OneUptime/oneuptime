import AuditLogRecorder, {
  AuditLogStore,
} from "../../../Server/AuditLog/AuditLogRecorder";
import CoreAuditLogService from "Common/Server/Services/AuditLogService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import { EnterpriseLicenseStatus } from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import FindBy from "Common/Server/Types/Database/FindBy";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveMonitorRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import ServiceLevelObjectiveOwnerTeam from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The Enterprise audit-log recorder decides whether a change is recorded, and
 * what the entry says. Every failure mode here is silent - record* swallows
 * its errors and an empty audit page looks exactly like "nobody changed
 * anything" - so each rule is pinned against the entry that actually reaches
 * the insert:
 *
 *   - eligibility: billing first (the Cloud records Enterprise-plan projects
 *     only), else the Enterprise Edition being loaded (never the license),
 *     then the project's switch and system events;
 *   - identity: resourceType is the model's singularName, and every entry
 *     carries the root resource it rolls up to (an SLO's burn-rate rules,
 *     monitor rules and owners roll up to the SLO);
 *   - noise: the evaluation worker's columns never produce an entry;
 *   - readability: relations are recorded as { _id, name }, nameless owner
 *     rows are named after their user or team, and names are only ever read
 *     from inside the audited project.
 *
 * This behaviour lived in core's AuditLogService until the Community /
 * Enterprise split; core now only delegates to the recorder (its own suite,
 * packages/Common/Tests/Server/Services/AuditLogService.test.ts, pins that).
 * The eligibility matrix below also runs through core's delegate, so the seam
 * between the two is covered as well.
 *
 * Billing and the edition are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true): billing through TestBillingFlag, the edition by
 * registering a fake enterprise module whose recorder is the one under test.
 *
 * No ClickHouse or Postgres: the insert, the project and user reads and the
 * related-row lookups are all stubbed. ProjectService and UserService are
 * module stubs rather than spies: the real modules pull in most of the service
 * graph, none of which a settings or user read here needs.
 */

const findProjectMock: jest.Mock = jest.fn();
const findUserMock: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return findProjectMock(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return findUserMock(...args);
      },
    },
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const SLO_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const RULE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const OWNER_ROW_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OWNER_USER_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const TEAM_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const MONITOR_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

const LABEL_A: string = "aaaaaaaa-0000-4000-8000-00000000000a";
const LABEL_B: string = "aaaaaaaa-0000-4000-8000-00000000000b";
const LABEL_C: string = "aaaaaaaa-0000-4000-8000-00000000000c";

const SEVERITY_1: string = "bbbbbbbb-0000-4000-8000-000000000001";
const SEVERITY_2: string = "bbbbbbbb-0000-4000-8000-000000000002";

const SLO_RESOURCE_TYPE: string = "Service Level Objective";

const USER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  userType: UserType.User,
  tenantId: PROJECT_ID,
};

// How the evaluation worker and the monitor-rule engine write.
const SYSTEM_PROPS: DatabaseCommonInteractionProps = { isRoot: true };

interface RelatedLookup {
  tableName: string;
  query: JSONObject;
  select: JSONObject;
  props: JSONObject;
}

interface Harness {
  recorder: AuditLogRecorder;
  inserted: Array<AuditLog>;
  findProject: jest.Mock;
  findUser: jest.Mock;
  insert: jest.Mock;
  relatedLookups: Array<RelatedLookup>;
}

let project: Project;
let usersById: Map<string, User>;
let relatedRows: Map<string, Array<BaseModel>>;
let failRelatedLookups: boolean;
let harness: Harness;

function makeProject(settings: {
  enableAuditLogs?: boolean;
  storeSystemEventsInAuditLogs?: boolean;
  planName?: PlanType;
}): Project {
  const item: Project = new Project();
  item._id = PROJECT_ID.toString();
  if (settings.enableAuditLogs !== undefined) {
    item.enableAuditLogs = settings.enableAuditLogs;
  }
  if (settings.storeSystemEventsInAuditLogs !== undefined) {
    item.storeSystemEventsInAuditLogs = settings.storeSystemEventsInAuditLogs;
  }
  item.auditLogsRetentionInDays = 30;
  if (settings.planName) {
    item.planName = settings.planName;
  }
  return item;
}

function makeUser(id: ObjectID, name: string | null, email: string): User {
  const user: User = new User();
  user._id = id.toString();
  if (name) {
    user.name = new Name(name);
  }
  user.email = new Email(email);
  return user;
}

function createHarness(): Harness {
  const inserted: Array<AuditLog> = [];

  // The store the recorder writes to: core's AuditLog analytics service in production.
  const insert: jest.Mock = jest.fn(((createBy: { data: AuditLog }) => {
    inserted.push(createBy.data);
    return Promise.resolve(createBy.data);
  }) as never);

  const recorder: AuditLogRecorder = new AuditLogRecorder({
    store: { create: insert } as unknown as AuditLogStore,
  });

  const findProject: jest.Mock = findProjectMock;
  findProject.mockReset();
  findProject.mockImplementation(() => {
    return Promise.resolve(project);
  });

  const findUser: jest.Mock = findUserMock;
  findUser.mockReset();
  findUser.mockImplementation(((findOneById: { id: ObjectID }) => {
    return Promise.resolve(usersById.get(findOneById.id.toString()) || null);
  }) as never);

  const relatedLookups: Array<RelatedLookup> = [];

  jest.spyOn(DatabaseService.prototype, "findBy").mockImplementation(function (
    this: DatabaseService<BaseModel>,
    findBy: FindBy<BaseModel>,
  ): Promise<Array<BaseModel>> {
    const tableName: string = this.getModel().tableName!;

    relatedLookups.push({
      tableName,
      query: findBy.query as unknown as JSONObject,
      select: findBy.select as unknown as JSONObject,
      props: findBy.props as unknown as JSONObject,
    });

    if (failRelatedLookups) {
      return Promise.reject(new Error("database unavailable"));
    }

    return Promise.resolve(relatedRows.get(tableName) || []);
  } as never);

  return { recorder, inserted, findProject, findUser, insert, relatedLookups };
}

// The ids a tenant-scoped lookup asked for, read back out of QueryHelper.any.
function idsInLookup(lookup: RelatedLookup): Array<string> {
  const operator: { objectLiteralParameters?: Record<string, unknown> } = lookup
    .query["_id"] as unknown as {
    objectLiteralParameters?: Record<string, unknown>;
  };

  return Object.values(operator.objectLiteralParameters || {})
    .flat()
    .map((id: unknown) => {
      return String(id);
    })
    .sort();
}

function label(id: string, name?: string): Label {
  const item: Label = new Label();
  item._id = id;
  if (name) {
    item.name = name;
  }
  return item;
}

function makeSlo(): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = SLO_ID.toString();
  slo.projectId = PROJECT_ID;
  slo.name = "Checkout availability";
  slo.targetPercentage = 99.9;
  return slo;
}

function makeBurnRateRule(): ServiceLevelObjectiveBurnRateRule {
  const rule: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule();
  rule._id = RULE_ID.toString();
  rule.projectId = PROJECT_ID;
  rule.serviceLevelObjectiveId = SLO_ID;
  rule.name = "Fast burn";
  rule.burnRateThreshold = 14.4;
  return rule;
}

function makeMonitorRule(): ServiceLevelObjectiveMonitorRule {
  const rule: ServiceLevelObjectiveMonitorRule =
    new ServiceLevelObjectiveMonitorRule();
  rule._id = RULE_ID.toString();
  rule.projectId = PROJECT_ID;
  rule.serviceLevelObjectiveId = SLO_ID;
  rule.name = "Production APIs";
  return rule;
}

function makeOwnerUser(): ServiceLevelObjectiveOwnerUser {
  const owner: ServiceLevelObjectiveOwnerUser =
    new ServiceLevelObjectiveOwnerUser();
  owner._id = OWNER_ROW_ID.toString();
  owner.projectId = PROJECT_ID;
  owner.serviceLevelObjectiveId = SLO_ID;
  owner.userId = OWNER_USER_ID;
  owner.isOwnerNotified = false;
  return owner;
}

function makeOwnerTeam(): ServiceLevelObjectiveOwnerTeam {
  const owner: ServiceLevelObjectiveOwnerTeam =
    new ServiceLevelObjectiveOwnerTeam();
  owner._id = OWNER_ROW_ID.toString();
  owner.projectId = PROJECT_ID;
  owner.serviceLevelObjectiveId = SLO_ID;
  owner.teamId = TEAM_ID;
  owner.isOwnerNotified = false;
  return owner;
}

function onlyEntry(): AuditLog {
  expect(harness.inserted).toHaveLength(1);
  return harness.inserted[0]!;
}

function changesOf(entry: AuditLog): Array<JSONObject> {
  return (entry.changes || []) as Array<JSONObject>;
}

function fieldsOf(entry: AuditLog): Array<string> {
  return changesOf(entry).map((change: JSONObject) => {
    return String(change["field"]);
  });
}

function changeFor(entry: AuditLog, field: string): JSONObject | undefined {
  return changesOf(entry).find((change: JSONObject) => {
    return change["field"] === field;
  });
}

beforeEach(() => {
  // Self-hosted Enterprise Edition, with the recorder under test registered.
  setTestBillingEnabled(false);
  project = makeProject({ enableAuditLogs: true });
  usersById = new Map<string, User>([
    [USER_ID.toString(), makeUser(USER_ID, "Ada Lovelace", "ada@example.com")],
  ]);
  relatedRows = new Map<string, Array<BaseModel>>();
  failRelatedLookups = false;
  harness = createHarness();
  installFakeEnterpriseModule({ auditLogRecorder: harness.recorder });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("which changes are recorded", () => {
  test("a person's change on an eligible project is recorded with its actor and retention", async () => {
    await harness.recorder.recordCreate({
      model: new ServiceLevelObjective(),
      createdItem: makeSlo(),
      props: USER_PROPS,
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(entry.action).toBe(AuditLogAction.Create);
    expect(entry.resourceType).toBe(SLO_RESOURCE_TYPE);
    expect(entry.resourceId?.toString()).toBe(SLO_ID.toString());
    expect(entry.resourceName).toBe("Checkout availability");
    expect(entry.userId?.toString()).toBe(USER_ID.toString());
    expect(entry.userName).toBe("Ada Lovelace");
    expect(entry.userEmail).toBe("ada@example.com");
    expect(entry.userType).toBe(UserType.User);
    expect(entry.retentionDate).toBeInstanceOf(Date);
    expect(changeFor(entry, "targetPercentage")).toEqual({
      field: "targetPercentage",
      newValue: 99.9,
    });
  });

  test("nothing is recorded while the project has audit logging off", async () => {
    project = makeProject({ enableAuditLogs: false });

    await harness.recorder.recordCreate({
      model: new ServiceLevelObjective(),
      createdItem: makeSlo(),
      props: USER_PROPS,
    });

    expect(harness.inserted).toHaveLength(0);
  });

  test("nothing is recorded for a project that no longer exists", async () => {
    harness.findProject.mockImplementation(() => {
      return Promise.resolve(null);
    });

    await harness.recorder.recordCreate({
      model: new ServiceLevelObjective(),
      createdItem: makeSlo(),
      props: USER_PROPS,
    });

    expect(harness.inserted).toHaveLength(0);
  });

  test("system events are dropped unless the project stores them", async () => {
    await harness.recorder.recordCreate({
      model: new ServiceLevelObjective(),
      createdItem: makeSlo(),
      props: SYSTEM_PROPS,
    });

    expect(harness.inserted).toHaveLength(0);

    project = makeProject({
      enableAuditLogs: true,
      storeSystemEventsInAuditLogs: true,
    });
    harness.recorder.invalidateProjectSettings(PROJECT_ID);

    await harness.recorder.recordCreate({
      model: new ServiceLevelObjective(),
      createdItem: makeSlo(),
      props: SYSTEM_PROPS,
    });

    const entry: AuditLog = onlyEntry();
    expect(entry.userType).toBe("System");
    expect(entry.userId).toBeUndefined();
  });

  test("a change with no project to file it under records nothing and reads nothing", async () => {
    const slo: ServiceLevelObjective = makeSlo();
    (slo as unknown as Record<string, unknown>)["projectId"] = undefined;

    await harness.recorder.recordCreate({
      model: new ServiceLevelObjective(),
      createdItem: slo,
      props: { userId: USER_ID, userType: UserType.User },
    });

    expect(harness.inserted).toHaveLength(0);
    expect(harness.findProject).not.toHaveBeenCalled();
  });

  test("the project's settings are read once per cache period, and again after invalidation", async () => {
    for (let i: number = 0; i < 3; i++) {
      await harness.recorder.recordCreate({
        model: new ServiceLevelObjective(),
        createdItem: makeSlo(),
        props: USER_PROPS,
      });
    }

    expect(harness.findProject).toHaveBeenCalledTimes(1);

    harness.recorder.invalidateProjectSettings(PROJECT_ID);

    await harness.recorder.recordCreate({
      model: new ServiceLevelObjective(),
      createdItem: makeSlo(),
      props: USER_PROPS,
    });

    expect(harness.findProject).toHaveBeenCalledTimes(2);
  });

  test("a failed insert never fails the write that triggered it", async () => {
    harness.insert.mockImplementation((() => {
      return Promise.reject(new Error("clickhouse unavailable"));
    }) as never);

    await expect(
      harness.recorder.recordCreate({
        model: new ServiceLevelObjective(),
        createdItem: makeSlo(),
        props: USER_PROPS,
      }),
    ).resolves.toBeUndefined();
  });
});

/*
 * --------------------------------------------------------------------------- *
 * Who records at all: billing first, then the edition - never the license.
 *
 * Each row runs twice: straight into the recorder, and through core's
 * AuditLogService delegate (what DatabaseService actually calls), which finds
 * the recorder through EnterpriseEdition. "Loaded" means an enterprise module
 * is registered with this recorder; "not loaded" is the Community Edition,
 * where core has no recorder to delegate to.
 * ---------------------------------------------------------------------------
 */

interface EligibilityRow {
  deployment: string;
  billing: boolean;
  loaded: boolean;
  license?: EnterpriseLicenseStatus | undefined;
  planName?: PlanType | undefined;
  enableAuditLogs: boolean;
  recorded: boolean;
}

const ELIGIBILITY_MATRIX: Array<EligibilityRow> = [
  {
    deployment: "self-hosted Enterprise Edition, valid license",
    billing: false,
    loaded: true,
    license: "valid",
    enableAuditLogs: true,
    recorded: true,
  },
  {
    deployment: "self-hosted Enterprise Edition, license in grace",
    billing: false,
    loaded: true,
    license: "grace",
    enableAuditLogs: true,
    recorded: true,
  },
  {
    deployment: "self-hosted Enterprise Edition, license expired past grace",
    billing: false,
    loaded: true,
    license: "expired",
    enableAuditLogs: true,
    recorded: true,
  },
  {
    deployment: "self-hosted Enterprise Edition, no license at all",
    billing: false,
    loaded: true,
    license: "missing",
    enableAuditLogs: true,
    recorded: true,
  },
  {
    deployment: "self-hosted Enterprise Edition, license invalid",
    billing: false,
    loaded: true,
    license: "invalid",
    enableAuditLogs: true,
    recorded: true,
  },
  {
    deployment: "self-hosted Enterprise Edition, project has audit logs off",
    billing: false,
    loaded: true,
    license: "valid",
    enableAuditLogs: false,
    recorded: false,
  },
  {
    deployment:
      "Community Edition, even with the Enterprise plan and the switch on",
    billing: false,
    loaded: false,
    planName: PlanType.Enterprise,
    enableAuditLogs: true,
    recorded: false,
  },
  {
    deployment: "Cloud (Enterprise Edition loaded), Enterprise plan",
    billing: true,
    loaded: true,
    planName: PlanType.Enterprise,
    enableAuditLogs: true,
    recorded: true,
  },
  {
    deployment:
      "Cloud (Enterprise Edition loaded), Enterprise plan, audit logs off",
    billing: true,
    loaded: true,
    planName: PlanType.Enterprise,
    enableAuditLogs: false,
    recorded: false,
  },
  {
    /*
     * The precedence bug this split fixes: the old order asked about the
     * edition before billing, and the Cloud runs the Enterprise image, so
     * every Growth project on the Cloud was recorded.
     */
    deployment: "Cloud (Enterprise Edition loaded), Growth plan",
    billing: true,
    loaded: true,
    planName: PlanType.Growth,
    enableAuditLogs: true,
    recorded: false,
  },
  {
    deployment: "Cloud (Enterprise Edition loaded), Scale plan",
    billing: true,
    loaded: true,
    planName: PlanType.Scale,
    enableAuditLogs: true,
    recorded: false,
  },
  {
    deployment: "Cloud (Enterprise Edition loaded), Free plan",
    billing: true,
    loaded: true,
    planName: PlanType.Free,
    enableAuditLogs: true,
    recorded: false,
  },
  {
    deployment: "Cloud (Enterprise Edition loaded), no plan on the project",
    billing: true,
    loaded: true,
    enableAuditLogs: true,
    recorded: false,
  },
];

type RecordThrough = "the recorder" | "core's AuditLogService";

const ELIGIBILITY_CASES: Array<EligibilityRow & { via: RecordThrough }> =
  ELIGIBILITY_MATRIX.flatMap((row: EligibilityRow) => {
    return [
      { ...row, via: "the recorder" as RecordThrough },
      { ...row, via: "core's AuditLogService" as RecordThrough },
    ];
  });

describe("who records audit logs", () => {
  test.each(ELIGIBILITY_CASES)(
    "$deployment, through $via: recorded=$recorded",
    async (row: EligibilityRow & { via: RecordThrough }) => {
      setTestBillingEnabled(row.billing);

      if (row.loaded) {
        installFakeEnterpriseModule({
          auditLogRecorder: harness.recorder,
          snapshot: createLicenseSnapshotWithStatus(row.license || "valid"),
        });
      } else {
        uninstallEnterpriseModule();
      }

      project = makeProject({
        enableAuditLogs: row.enableAuditLogs,
        ...(row.planName ? { planName: row.planName } : {}),
      });

      const data: {
        model: ServiceLevelObjective;
        createdItem: ServiceLevelObjective;
        props: DatabaseCommonInteractionProps;
      } = {
        model: new ServiceLevelObjective(),
        createdItem: makeSlo(),
        props: USER_PROPS,
      };

      if (row.via === "the recorder") {
        await harness.recorder.recordCreate(data);
      } else {
        await CoreAuditLogService.recordCreate(data);
      }

      expect(harness.inserted).toHaveLength(row.recorded ? 1 : 0);
    },
  );

  test("the Cloud reads the plan from the project, not the edition: switching plan changes the answer after invalidation", async () => {
    setTestBillingEnabled(true);
    project = makeProject({
      enableAuditLogs: true,
      planName: PlanType.Growth,
    });

    await harness.recorder.recordCreate({
      model: new ServiceLevelObjective(),
      createdItem: makeSlo(),
      props: USER_PROPS,
    });

    expect(harness.inserted).toHaveLength(0);

    project = makeProject({
      enableAuditLogs: true,
      planName: PlanType.Enterprise,
    });
    harness.recorder.invalidateProjectSettings(PROJECT_ID);

    await harness.recorder.recordCreate({
      model: new ServiceLevelObjective(),
      createdItem: makeSlo(),
      props: USER_PROPS,
    });

    expect(harness.inserted).toHaveLength(1);
  });

  test("the license snapshot is never read to decide whether to record", async () => {
    const fake: ReturnType<typeof installFakeEnterpriseModule> =
      installFakeEnterpriseModule({ auditLogRecorder: harness.recorder });
    fake.licensing.getCachedSnapshotError = new Error("must not be read");
    fake.licensing.getSnapshotError = new Error("must not be read");

    await harness.recorder.recordCreate({
      model: new ServiceLevelObjective(),
      createdItem: makeSlo(),
      props: USER_PROPS,
    });

    expect(harness.inserted).toHaveLength(1);
  });

  test("the billing flag is read at call time, not when the recorder was built", async () => {
    project = makeProject({
      enableAuditLogs: true,
      planName: PlanType.Growth,
    });

    await harness.recorder.recordCreate({
      model: new ServiceLevelObjective(),
      createdItem: makeSlo(),
      props: USER_PROPS,
    });

    // Self-hosted: the plan is irrelevant.
    expect(harness.inserted).toHaveLength(1);

    setTestBillingEnabled(true);

    await harness.recorder.recordCreate({
      model: new ServiceLevelObjective(),
      createdItem: makeSlo(),
      props: USER_PROPS,
    });

    // Same recorder, same cached settings, billing now on: Growth is not recorded.
    expect(harness.inserted).toHaveLength(1);
  });

  test("an ineligible update still costs no settings read when nothing tracked changed", async () => {
    setTestBillingEnabled(true);

    await harness.recorder.recordUpdate({
      model: new ServiceLevelObjective(),
      before: makeSlo(),
      updatedFields: { targetPercentage: 99.9 },
      itemId: SLO_ID,
      props: USER_PROPS,
    });

    expect(harness.findProject).not.toHaveBeenCalled();
  });
});

describe("where entries are written", () => {
  test("by default the recorder writes through core's AuditLog analytics service, as root", async () => {
    const coreCreate: jest.SpyInstance = jest
      .spyOn(CoreAuditLogService, "create")
      .mockImplementation(((createBy: { data: AuditLog }) => {
        return Promise.resolve(createBy.data);
      }) as never);

    const defaultRecorder: AuditLogRecorder = new AuditLogRecorder();

    await defaultRecorder.recordCreate({
      model: new ServiceLevelObjective(),
      createdItem: makeSlo(),
      props: USER_PROPS,
    });

    expect(coreCreate).toHaveBeenCalledTimes(1);

    const createBy: { data: AuditLog; props: JSONObject } = coreCreate.mock
      .calls[0]![0] as { data: AuditLog; props: JSONObject };

    expect(createBy.data).toBeInstanceOf(AuditLog);
    expect(createBy.data.resourceType).toBe(SLO_RESOURCE_TYPE);
    expect(createBy.props).toEqual({ isRoot: true });
  });

  test("each recorder keeps its own settings cache", async () => {
    const other: Harness = createHarness();

    await harness.recorder.recordCreate({
      model: new ServiceLevelObjective(),
      createdItem: makeSlo(),
      props: USER_PROPS,
    });
    await other.recorder.recordCreate({
      model: new ServiceLevelObjective(),
      createdItem: makeSlo(),
      props: USER_PROPS,
    });

    // findProjectMock is shared: one read per recorder.
    expect(findProjectMock).toHaveBeenCalledTimes(2);
  });

  test("the retention date is clamped to 1-180 days from now", async () => {
    const now: number = Date.now();

    project = makeProject({ enableAuditLogs: true });
    project.auditLogsRetentionInDays = 5000;
    harness.recorder.invalidateProjectSettings(PROJECT_ID);

    await harness.recorder.recordCreate({
      model: new ServiceLevelObjective(),
      createdItem: makeSlo(),
      props: USER_PROPS,
    });

    const retention: Date = onlyEntry().retentionDate as Date;
    const days: number = (retention.getTime() - now) / (24 * 60 * 60 * 1000);

    expect(days).toBeGreaterThan(179);
    expect(days).toBeLessThan(181);
  });
});

describe("resource identity", () => {
  test("an SLO's entries carry its singularName, the value its children's root pointer names", () => {
    expect(new ServiceLevelObjective().singularName).toBe(SLO_RESOURCE_TYPE);
    expect(
      new ServiceLevelObjectiveBurnRateRule().enableAuditLogOn?.rootResource
        ?.resourceType,
    ).toBe(SLO_RESOURCE_TYPE);
  });
});

describe("update diffs", () => {
  test("an update that changed nothing records nothing and costs no settings read", async () => {
    await harness.recorder.recordUpdate({
      model: new ServiceLevelObjective(),
      before: makeSlo(),
      updatedFields: { targetPercentage: 99.9 },
      itemId: SLO_ID,
      props: USER_PROPS,
    });

    expect(harness.inserted).toHaveLength(0);
    expect(harness.findProject).not.toHaveBeenCalled();
  });

  test("an evaluation tick that rewrites only worker-owned columns records nothing, even with system events stored", async () => {
    project = makeProject({
      enableAuditLogs: true,
      storeSystemEventsInAuditLogs: true,
    });

    const before: ServiceLevelObjective = makeSlo();
    before.currentSliPercentage = 99.95;
    before.errorBudgetRemainingPercentage = 60;
    before.currentBurnRate = 0.4;
    before.lastEvaluatedAt = new Date("2026-09-15T10:00:00.000Z");

    await harness.recorder.recordUpdate({
      model: new ServiceLevelObjective(),
      before,
      updatedFields: {
        currentSliPercentage: 99.91,
        errorBudgetRemainingPercentage: 55,
        errorBudgetRemainingSeconds: 1200,
        errorBudgetTotalSeconds: 2592,
        currentBurnRate: 1.3,
        sloStatus: "AtRisk",
        statusChangeNotificationSentAt: new Date("2026-09-15T10:05:00.000Z"),
        lastEvaluatedAt: new Date("2026-09-15T10:05:00.000Z"),
        nextEvaluationAt: new Date("2026-09-15T10:10:00.000Z"),
        lastAccumulatedBucketEndAt: new Date("2026-09-15T10:05:00.000Z"),
        autoAddedMonitors: [{ _id: MONITOR_ID.toString() }],
      },
      itemId: SLO_ID,
      props: SYSTEM_PROPS,
    });

    expect(harness.inserted).toHaveLength(0);
    expect(harness.findProject).not.toHaveBeenCalled();
  });

  test("a person's edit that lands with worker columns records the edit alone", async () => {
    const before: ServiceLevelObjective = makeSlo();
    before.currentSliPercentage = 99.95;

    await harness.recorder.recordUpdate({
      model: new ServiceLevelObjective(),
      before,
      updatedFields: {
        targetPercentage: 99.5,
        currentSliPercentage: 99.1,
        lastEvaluatedAt: new Date("2026-09-15T10:05:00.000Z"),
      },
      itemId: SLO_ID,
      props: USER_PROPS,
    });

    expect(changesOf(onlyEntry())).toEqual([
      { field: "targetPercentage", oldValue: 99.9, newValue: 99.5 },
    ]);
  });

  test("a burn-rate rule's refire bookkeeping records nothing; a threshold edit does", async () => {
    await harness.recorder.recordUpdate({
      model: new ServiceLevelObjectiveBurnRateRule(),
      before: makeBurnRateRule(),
      updatedFields: {
        lastAlertCreatedAt: new Date("2026-09-15T10:05:00.000Z"),
        lastAlertResolvedAt: new Date("2026-09-15T10:06:00.000Z"),
        lastIncidentCreatedAt: new Date("2026-09-15T10:07:00.000Z"),
        lastIncidentResolvedAt: new Date("2026-09-15T10:08:00.000Z"),
      },
      itemId: RULE_ID,
      props: USER_PROPS,
    });

    expect(harness.inserted).toHaveLength(0);

    await harness.recorder.recordUpdate({
      model: new ServiceLevelObjectiveBurnRateRule(),
      before: makeBurnRateRule(),
      updatedFields: { burnRateThreshold: 6 },
      itemId: RULE_ID,
      props: USER_PROPS,
    });

    expect(fieldsOf(onlyEntry())).toEqual(["burnRateThreshold"]);
  });

  test("the owner notification job marking an owner notified records nothing", async () => {
    project = makeProject({
      enableAuditLogs: true,
      storeSystemEventsInAuditLogs: true,
    });

    await harness.recorder.recordUpdate({
      model: new ServiceLevelObjectiveOwnerUser(),
      before: makeOwnerUser(),
      updatedFields: { isOwnerNotified: true },
      itemId: OWNER_ROW_ID,
      props: SYSTEM_PROPS,
    });

    expect(harness.inserted).toHaveLength(0);
  });

  test("create and delete snapshots leave ignored and bookkeeping columns out", async () => {
    const slo: ServiceLevelObjective = makeSlo();
    slo.slug = "checkout-availability";
    slo.currentSliPercentage = 99.2;
    slo.nextEvaluationAt = new Date("2026-09-15T10:10:00.000Z");

    await harness.recorder.recordDelete({
      model: new ServiceLevelObjective(),
      deletedItem: slo,
      itemId: SLO_ID,
      props: USER_PROPS,
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Delete);
    expect(fieldsOf(entry)).toEqual(
      expect.arrayContaining(["name", "targetPercentage", "projectId"]),
    );
    expect(fieldsOf(entry)).not.toContain("currentSliPercentage");
    expect(fieldsOf(entry)).not.toContain("nextEvaluationAt");
    expect(fieldsOf(entry)).not.toContain("_id");
    expect(fieldsOf(entry)).not.toContain("slug");
    expect(changeFor(entry, "name")).toEqual({
      field: "name",
      oldValue: "Checkout availability",
    });
  });
});

describe("every entry points at the resource it rolls up to", () => {
  test("an SLO's own entries point at the SLO", async () => {
    await harness.recorder.recordCreate({
      model: new ServiceLevelObjective(),
      createdItem: makeSlo(),
      props: USER_PROPS,
    });

    const entry: AuditLog = onlyEntry();
    expect(entry.rootResourceType).toBe(SLO_RESOURCE_TYPE);
    expect(entry.rootResourceId?.toString()).toBe(SLO_ID.toString());
  });

  test("a top-level resource with no configuration points at itself", async () => {
    const before: Monitor = new Monitor();
    before._id = MONITOR_ID.toString();
    before.projectId = PROJECT_ID;
    before.name = "Checkout API";

    await harness.recorder.recordUpdate({
      model: new Monitor(),
      before,
      updatedFields: { name: "Checkout API (primary)" },
      itemId: MONITOR_ID,
      props: USER_PROPS,
    });

    const entry: AuditLog = onlyEntry();
    expect(entry.rootResourceType).toBe("Monitor");
    expect(entry.rootResourceId?.toString()).toBe(MONITOR_ID.toString());
  });

  test.each([
    {
      name: "burn-rate rule",
      model: (): BaseModel => {
        return new ServiceLevelObjectiveBurnRateRule();
      },
      item: (): BaseModel => {
        return makeBurnRateRule();
      },
      resourceType: "SLO Burn Rate Rule",
      resourceId: RULE_ID,
    },
    {
      name: "monitor rule",
      model: (): BaseModel => {
        return new ServiceLevelObjectiveMonitorRule();
      },
      item: (): BaseModel => {
        return makeMonitorRule();
      },
      resourceType: "SLO Monitor Rule",
      resourceId: RULE_ID,
    },
    {
      name: "owner user",
      model: (): BaseModel => {
        return new ServiceLevelObjectiveOwnerUser();
      },
      item: (): BaseModel => {
        return makeOwnerUser();
      },
      resourceType: "Service Level Objective User Owner",
      resourceId: OWNER_ROW_ID,
    },
    {
      name: "owner team",
      model: (): BaseModel => {
        return new ServiceLevelObjectiveOwnerTeam();
      },
      item: (): BaseModel => {
        return makeOwnerTeam();
      },
      resourceType: "Service Level Objective Team Owner",
      resourceId: OWNER_ROW_ID,
    },
  ])(
    "an SLO $name keeps its own identity and rolls up to its SLO, on create and delete",
    async (data: {
      model: () => BaseModel;
      item: () => BaseModel;
      resourceType: string;
      resourceId: ObjectID;
    }) => {
      await harness.recorder.recordCreate({
        model: data.model(),
        createdItem: data.item(),
        props: USER_PROPS,
      });

      await harness.recorder.recordDelete({
        model: data.model(),
        deletedItem: data.item(),
        itemId: data.resourceId,
        props: USER_PROPS,
      });

      expect(harness.inserted).toHaveLength(2);

      for (const entry of harness.inserted) {
        expect(entry.resourceType).toBe(data.resourceType);
        expect(entry.resourceId?.toString()).toBe(data.resourceId.toString());
        expect(entry.rootResourceType).toBe(SLO_RESOURCE_TYPE);
        expect(entry.rootResourceId?.toString()).toBe(SLO_ID.toString());
      }
    },
  );

  test("a child's update rolls up through the parent id on its before-row", async () => {
    await harness.recorder.recordUpdate({
      model: new ServiceLevelObjectiveBurnRateRule(),
      before: makeBurnRateRule(),
      updatedFields: { name: "Fast burn (1h)" },
      itemId: RULE_ID,
      props: USER_PROPS,
    });

    const entry: AuditLog = onlyEntry();
    expect(entry.resourceName).toBe("Fast burn");
    expect(entry.rootResourceType).toBe(SLO_RESOURCE_TYPE);
    expect(entry.rootResourceId?.toString()).toBe(SLO_ID.toString());
  });

  test("a child that cannot name its parent is still recorded, with no pointer", async () => {
    const rule: ServiceLevelObjectiveBurnRateRule = makeBurnRateRule();
    (rule as unknown as Record<string, unknown>)["serviceLevelObjectiveId"] =
      undefined;

    await harness.recorder.recordCreate({
      model: new ServiceLevelObjectiveBurnRateRule(),
      createdItem: rule,
      props: USER_PROPS,
    });

    const entry: AuditLog = onlyEntry();
    expect(entry.resourceType).toBe("SLO Burn Rate Rule");
    expect(entry.rootResourceType).toBeUndefined();
    expect(entry.rootResourceId).toBeUndefined();
  });
});

describe("relation values are recorded as named references", () => {
  test("a label swap records old names from the before-row and new ones borrowed or looked up in the project", async () => {
    relatedRows.set("Label", [label(LABEL_C, "Staging")]);

    const before: ServiceLevelObjective = makeSlo();
    before.labels = [label(LABEL_A, "Production"), label(LABEL_B, "Payments")];

    await harness.recorder.recordUpdate({
      model: new ServiceLevelObjective(),
      before,
      updatedFields: {
        labels: [label(LABEL_C), label(LABEL_A)],
      } as unknown as JSONObject,
      itemId: SLO_ID,
      props: USER_PROPS,
    });

    expect(changeFor(onlyEntry(), "labels")).toEqual({
      field: "labels",
      oldValue: [
        { _id: LABEL_A, name: "Production" },
        { _id: LABEL_B, name: "Payments" },
      ],
      newValue: [
        { _id: LABEL_C, name: "Staging" },
        { _id: LABEL_A, name: "Production" },
      ],
    });

    // One lookup, for the only id nothing else could name - inside the project.
    expect(harness.relatedLookups).toHaveLength(1);
    const lookup: RelatedLookup = harness.relatedLookups[0]!;
    expect(lookup.tableName).toBe("Label");
    expect(idsInLookup(lookup)).toEqual([LABEL_C]);
    expect(lookup.query["projectId"]).toEqual(PROJECT_ID);
    expect(lookup.select).toEqual({ _id: true, name: true });
    expect(lookup.props).toEqual({ isRoot: true, ignoreHooks: true });
  });

  test("a label the project does not own is recorded by id only", async () => {
    // The tenant-scoped lookup finds nothing for another project's label.
    await harness.recorder.recordUpdate({
      model: new ServiceLevelObjective(),
      before: Object.assign(makeSlo(), { labels: [] }),
      updatedFields: { labels: [LABEL_C] } as unknown as JSONObject,
      itemId: SLO_ID,
      props: USER_PROPS,
    });

    expect(changeFor(onlyEntry(), "labels")).toEqual({
      field: "labels",
      oldValue: [],
      newValue: [{ _id: LABEL_C }],
    });
  });

  test("the same labels in another order and shape are not a change", async () => {
    const before: ServiceLevelObjective = makeSlo();
    before.labels = [label(LABEL_A, "Production"), label(LABEL_B, "Payments")];

    await harness.recorder.recordUpdate({
      model: new ServiceLevelObjective(),
      before,
      updatedFields: {
        labels: [{ _id: LABEL_B }, LABEL_A],
      } as unknown as JSONObject,
      itemId: SLO_ID,
      props: USER_PROPS,
    });

    expect(harness.inserted).toHaveLength(0);
  });

  test("a failed name lookup still records the entry, with ids", async () => {
    failRelatedLookups = true;

    const before: ServiceLevelObjective = makeSlo();
    before.labels = [label(LABEL_A, "Production")];

    await harness.recorder.recordUpdate({
      model: new ServiceLevelObjective(),
      before,
      updatedFields: {
        labels: [label(LABEL_C), label(LABEL_A)],
      } as unknown as JSONObject,
      itemId: SLO_ID,
      props: USER_PROPS,
    });

    expect(changeFor(onlyEntry(), "labels")?.["newValue"]).toEqual([
      { _id: LABEL_C },
      { _id: LABEL_A, name: "Production" },
    ]);
  });

  test("users are named by their name, else their email, without a generic lookup", async () => {
    usersById.set(
      OWNER_USER_ID.toString(),
      makeUser(OWNER_USER_ID, null, "grace@example.com"),
    );

    const before: ServiceLevelObjectiveBurnRateRule = makeBurnRateRule();
    before.alertOwnerUsers = [];

    await harness.recorder.recordUpdate({
      model: new ServiceLevelObjectiveBurnRateRule(),
      before,
      updatedFields: {
        alertOwnerUsers: [
          OWNER_USER_ID.toString(),
          { _id: USER_ID.toString() },
        ],
      } as unknown as JSONObject,
      itemId: RULE_ID,
      props: USER_PROPS,
    });

    expect(changeFor(onlyEntry(), "alertOwnerUsers")?.["newValue"]).toEqual([
      { _id: OWNER_USER_ID.toString(), name: "grace@example.com" },
      { _id: USER_ID.toString(), name: "Ada Lovelace" },
    ]);
    expect(harness.relatedLookups).toHaveLength(0);
  });

  test("a many-to-one relation is recorded as a single named reference", async () => {
    const minor: AlertSeverity = new AlertSeverity();
    minor._id = SEVERITY_2;
    minor.name = "Minor";
    relatedRows.set("AlertSeverity", [minor]);

    const critical: AlertSeverity = new AlertSeverity();
    critical._id = SEVERITY_1;
    critical.name = "Critical";

    const before: ServiceLevelObjectiveBurnRateRule = makeBurnRateRule();
    before.alertSeverity = critical;

    const next: AlertSeverity = new AlertSeverity();
    next._id = SEVERITY_2;

    await harness.recorder.recordUpdate({
      model: new ServiceLevelObjectiveBurnRateRule(),
      before,
      updatedFields: { alertSeverity: next } as unknown as JSONObject,
      itemId: RULE_ID,
      props: USER_PROPS,
    });

    expect(changeFor(onlyEntry(), "alertSeverity")).toEqual({
      field: "alertSeverity",
      oldValue: { _id: SEVERITY_1, name: "Critical" },
      newValue: { _id: SEVERITY_2, name: "Minor" },
    });
  });

  test("a create snapshot names its relations", async () => {
    relatedRows.set("Label", [label(LABEL_A, "Production")]);

    const slo: ServiceLevelObjective = makeSlo();
    slo.labels = [label(LABEL_A)];

    await harness.recorder.recordCreate({
      model: new ServiceLevelObjective(),
      createdItem: slo,
      props: USER_PROPS,
    });

    expect(changeFor(onlyEntry(), "labels")).toEqual({
      field: "labels",
      newValue: [{ _id: LABEL_A, name: "Production" }],
    });
  });

  test("name lookups are bounded, and the entry still records every reference", async () => {
    const manyIds: Array<string> = Array.from(
      { length: 150 },
      (_value: unknown, index: number) => {
        return `cccccccc-0000-4000-8000-${index.toString().padStart(12, "0")}`;
      },
    );

    await harness.recorder.recordUpdate({
      model: new ServiceLevelObjective(),
      before: Object.assign(makeSlo(), { labels: [] }),
      updatedFields: { labels: manyIds } as unknown as JSONObject,
      itemId: SLO_ID,
      props: USER_PROPS,
    });

    const lookedUp: number = harness.relatedLookups.reduce(
      (total: number, lookup: RelatedLookup) => {
        return total + idsInLookup(lookup).length;
      },
      0,
    );

    expect(lookedUp).toBe(100);
    expect(
      (changeFor(onlyEntry(), "labels")?.["newValue"] as Array<JSONObject>)
        .length,
    ).toBe(150);
  });

  test("a JSON column holding an _id is recorded as plain JSON, not as a reference", async () => {
    const before: ServiceLevelObjective = makeSlo();
    before.metricQueryConfig = { _id: "query-1", query: "a" };

    await harness.recorder.recordUpdate({
      model: new ServiceLevelObjective(),
      before,
      updatedFields: {
        metricQueryConfig: { _id: "query-1", query: "b", name: "Errors" },
      },
      itemId: SLO_ID,
      props: USER_PROPS,
    });

    expect(changeFor(onlyEntry(), "metricQueryConfig")).toEqual({
      field: "metricQueryConfig",
      oldValue: { _id: "query-1", query: "a" },
      newValue: { _id: "query-1", query: "b", name: "Errors" },
    });
    expect(harness.relatedLookups).toHaveLength(0);
  });
});

describe("rows with no name of their own are named after what they point at", () => {
  test("an owner user row is named after the user", async () => {
    usersById.set(
      OWNER_USER_ID.toString(),
      makeUser(OWNER_USER_ID, "Grace Hopper", "grace@example.com"),
    );

    await harness.recorder.recordCreate({
      model: new ServiceLevelObjectiveOwnerUser(),
      createdItem: makeOwnerUser(),
      props: USER_PROPS,
    });

    expect(onlyEntry().resourceName).toBe("Grace Hopper");
  });

  test("a user with no name is named by email", async () => {
    usersById.set(
      OWNER_USER_ID.toString(),
      makeUser(OWNER_USER_ID, null, "grace@example.com"),
    );

    await harness.recorder.recordDelete({
      model: new ServiceLevelObjectiveOwnerUser(),
      deletedItem: makeOwnerUser(),
      itemId: OWNER_ROW_ID,
      props: USER_PROPS,
    });

    expect(onlyEntry().resourceName).toBe("grace@example.com");
  });

  test("an owner team row is named after the team, read inside the project", async () => {
    const team: Team = new Team();
    team._id = TEAM_ID.toString();
    team.projectId = PROJECT_ID;
    team.name = "Site Reliability";
    relatedRows.set("Team", [team]);

    await harness.recorder.recordCreate({
      model: new ServiceLevelObjectiveOwnerTeam(),
      createdItem: makeOwnerTeam(),
      props: USER_PROPS,
    });

    expect(onlyEntry().resourceName).toBe("Site Reliability");

    const lookup: RelatedLookup = harness.relatedLookups[0]!;
    expect(lookup.tableName).toBe("Team");
    expect(idsInLookup(lookup)).toEqual([TEAM_ID.toString()]);
    expect(lookup.query["projectId"]).toEqual(PROJECT_ID);
  });

  test("a failed team lookup still records the entry, unnamed", async () => {
    failRelatedLookups = true;

    await harness.recorder.recordCreate({
      model: new ServiceLevelObjectiveOwnerTeam(),
      createdItem: makeOwnerTeam(),
      props: USER_PROPS,
    });

    const entry: AuditLog = onlyEntry();
    expect(entry.resourceName).toBeUndefined();
    expect(entry.rootResourceId?.toString()).toBe(SLO_ID.toString());
  });

  test("a row with its own name never looks anywhere else", async () => {
    await harness.recorder.recordCreate({
      model: new ServiceLevelObjectiveBurnRateRule(),
      createdItem: makeBurnRateRule(),
      props: USER_PROPS,
    });

    expect(onlyEntry().resourceName).toBe("Fast burn");
    expect(harness.relatedLookups).toHaveLength(0);
    // Only the actor was looked up.
    expect(harness.findUser).toHaveBeenCalledTimes(1);
  });
});
