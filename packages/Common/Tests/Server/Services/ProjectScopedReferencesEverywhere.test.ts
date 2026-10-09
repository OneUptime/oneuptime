import fs from "fs";
import path from "path";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import ProjectReferencesService, {
  ProjectReferenceWrite,
} from "../../../Server/Services/ProjectReferencesService";
import ProjectReferenceCheck, {
  ProjectReferenceColumn,
} from "../../../Server/Utils/Database/ProjectReferenceCheck";
import ProjectScopedReferenceValidator, {
  ProjectScopedReferenceException,
} from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import EnableWorkflowOn from "../../../Types/BaseDatabase/EnableWorkflowOn";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { stubRowsCallerMayWriteLikeFindBy } from "../TestingUtils/RowsCallerMayWrite";

/*
 * Every service whose rows name another record of the project - an
 * incident's labels, a status page link's page, a team member's team, a log
 * pipeline processor's pipeline - checks that the record is the project's
 * own. A row that names another project's record would act on it (a feed
 * item written to that incident, a list reordered on that page) and show its
 * name back through the relation, which a read joins without asking whose
 * it is.
 *
 * This finds every such model from the metadata - a tenant column and a
 * list or relation to a project's record or a person (ProjectReferenceCheck)
 * - and works out which of those references a caller can write: an API
 * create or update the table and the column both allow, or a workflow's
 * Create / Update step (which writes as root). For each model with one, it
 * holds every service of the model to the check:
 *
 *   - the service extends ProjectReferencesService, or is listed below in
 *     SERVICES_WITH_ANOTHER_CHECK with the reason it is safe;
 *   - its real create hook refuses another project's record in every list
 *     and relation it does not check itself, naming the field and the id;
 *   - its own records are accepted;
 *   - its real update hook refuses an id the update adds;
 *   - a service that checks some references itself, or leaves OneUptime's
 *     own writes unchecked, says so below, so a new one is a decision someone
 *     made.
 *
 * A model whose references no caller can write (a call log written only by
 * OneUptime, an agent's resource rows) has nothing to check: its rows name
 * what the server found. Rule and owner rows are held to the same check by
 * OwnerAndRuleServicesCheckReferences.
 *
 * A service added later, for a model with references a caller can write,
 * fails here until it checks them.
 */

const MODELS_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../Models/DatabaseModels",
);
const SERVICES_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../Server/Services",
);

// OwnerAndRuleServicesCheckReferences covers these.
const RULE_MODEL_CLASS: RegExp =
  /class \w+ extends (RuleBaseModel|RelationOnlyRuleBaseModel)\b/;
const OWNER_MODEL_NAME: RegExp = /Owner(User|Team)$/;

type AnotherCheck =
  | {
      /*
       * The only reference a caller can write is the row's owner, and only
       * the owner may create the row: CreatePermission makes it the caller
       * (Permission.CurrentUser is the whole create list), and nobody can
       * change it afterwards. Checked from the metadata below.
       */
      kind: "owner-is-the-caller";
    }
  | {
      // A check of the service's own, and the suite that holds it to it.
      kind: "own-check";
      reason: string;
    };

/*
 * Services that do not extend ProjectReferencesService although a caller can
 * write the records their rows name, and why that is safe.
 */
const SERVICES_WITH_ANOTHER_CHECK: Record<string, AnotherCheck> = {
  "UserCallService.ts": { kind: "owner-is-the-caller" },
  "UserEmailService.ts": { kind: "owner-is-the-caller" },
  "UserIncomingCallNumberService.ts": { kind: "owner-is-the-caller" },
  "UserMicrosoftTeamsService.ts": { kind: "owner-is-the-caller" },
  "UserNotificationEmailRollupSettingService.ts": {
    kind: "owner-is-the-caller",
  },
  "UserNotificationSettingService.ts": { kind: "owner-is-the-caller" },
  "RoutineEmailSettingsService.ts": { kind: "owner-is-the-caller" },
  "UserOnCallShiftReminderService.ts": { kind: "owner-is-the-caller" },
  "UserPushService.ts": { kind: "owner-is-the-caller" },
  "UserSmsService.ts": { kind: "owner-is-the-caller" },
  "UserSlackService.ts": { kind: "owner-is-the-caller" },
  "UserTelegramService.ts": { kind: "owner-is-the-caller" },
  "UserWebhookService.ts": { kind: "owner-is-the-caller" },
  "UserWhatsAppService.ts": { kind: "owner-is-the-caller" },
  "WorkspaceUserAuthTokenService.ts": { kind: "owner-is-the-caller" },
  "ProjectSsoService.ts": {
    kind: "own-check",
    reason:
      "SsoProviderTeamGrant reads the provider's teams pinned to the project for every caller, root and master admin included, and refuses another project's team like a missing one (SsoProviderTeamGrant.test.ts)",
  },
  "ProjectOidcService.ts": {
    kind: "own-check",
    reason:
      "SsoProviderTeamGrant checks the provider's teams for every caller (SsoProviderTeamGrant.test.ts)",
  },
  "ProjectSCIMService.ts": {
    kind: "own-check",
    reason:
      "SsoProviderTeamGrant checks the SCIM configuration's teams for every caller (SsoProviderTeamGrant.test.ts)",
  },
};

/*
 * Services that check some of their references with a check of their own -
 * the same pinned lookups, in their own words - and name them in
 * getRelationsCheckedByService / getListsCheckedByService, so the generic
 * check covers only the rest. Where each one's own check is tested.
 */
const SERVICES_WITH_THEIR_OWN_CHECKS: Record<string, string> = {
  "AlertService.ts":
    "AlertService.test.ts, AlertProjectScopedReferences.test.ts and the cross-project reference guards",
  "AlertEpisodeService.ts": "AlertEpisodeService.test.ts",
  "AlertEpisodeMemberService.ts":
    "EpisodeMemberPrivateEnds.test.ts and EpisodeMemberPrivateEndsPostgres.test.ts (a person's create reads the episode and the alert as the caller: private, foreign and missing answered alike; root writes get the project check)",
  "IncidentService.ts":
    "IncidentService.test.ts and the cross-project reference guards",
  "IncidentAlertService.ts":
    "IncidentAlertService.test.ts and IncidentAlertPostgres.test.ts (read as the caller: private, foreign and missing answered alike)",
  "DatabaseServerEndpointService.ts":
    "DatabaseServerEndpointService.test.ts and DatabaseServerSqlPostgres.test.ts (a database they may not edit, a foreign and a missing one answered alike; root writes get the project check)",
  "IncidentEpisodeService.ts": "IncidentEpisodeService.test.ts",
  "IncidentEpisodeMemberService.ts":
    "EpisodeMemberPrivateEnds.test.ts and EpisodeMemberPrivateEndsPostgres.test.ts (a person's create reads the episode and the incident as the caller: private, foreign and missing answered alike; root writes get the project check)",
  "IncidentTemplateService.ts": "IncidentTemplateService.test.ts",
  "ScheduledMaintenanceService.ts": "ScheduledMaintenanceService.test.ts",
  "ScheduledMaintenanceTemplateService.ts":
    "ScheduledMaintenanceTemplateService.test.ts",
  "KubernetesClusterService.ts":
    "KubernetesClusterAiAccessBindingGuard.test.ts (the AI access Runner and credential, pinned to the project)",
  "MonitorService.ts":
    "MonitorService.test.ts, MonitorDependency suites and MonitorTemplate suites",
  "MonitorSecretService.ts": "MonitorSecretService.test.ts",
  "MonitorProbeService.ts":
    "MonitorProbeService.test.ts (ProbeService.isProbeAttachableToProject: global probes and the project's own)",
  "NetworkDeviceService.ts":
    "NetworkDeviceProbeTenancy suites (ProbeService.isProbeAttachableToProject)",
  "NetworkSiteService.ts":
    "NetworkSiteService.test.ts (ProbeService.isProbeAttachableToProject)",
  "ServiceLevelObjectiveBurnRateRuleService.ts":
    "ServiceLevelObjectiveBurnRateRuleService.test.ts",
  "TeamComplianceSettingService.ts":
    "TeamComplianceSettingService.test.ts (severities, after the rule type drops the options it does not use)",
  "TeamMemberService.ts":
    "the invited user is not a member until the row exists (TeamMemberService.test.ts)",
};

/*
 * Services that leave OneUptime's own writes - root, with no project on the
 * request - unchecked (checksServerWrites), each with the reason on the
 * service. Requests made in a project are still checked.
 */
const SERVICES_TRUSTING_SERVER_WRITES: Array<string> = [
  "AlertEpisodeFeedService.ts",
  "AlertFeedService.ts",
  "CallLogService.ts",
  "CephClusterFeedService.ts",
  "CloudResourceFeedService.ts",
  "DatabaseServerFeedService.ts",
  "DockerHostFeedService.ts",
  "DockerSwarmClusterFeedService.ts",
  "EmailLogService.ts",
  "HostFeedService.ts",
  "IncidentEpisodeFeedService.ts",
  "IncidentFeedService.ts",
  "IncomingCallLogItemService.ts",
  "KubernetesClusterFeedService.ts",
  "MonitorFeedService.ts",
  "OnCallDutyPolicyExecutionLogService.ts",
  "OnCallDutyPolicyFeedService.ts",
  "OnCallDutyPolicyTimeLogService.ts",
  "PodmanHostFeedService.ts",
  "ProxmoxClusterFeedService.ts",
  "PushNotificationLogService.ts",
  "ScheduledMaintenanceFeedService.ts",
  "ServiceFeedService.ts",
  "ServiceLevelObjectiveFeedService.ts",
  "ServiceLevelObjectiveService.ts",
  "SmsLogService.ts",
  "StorageArrayFeedService.ts",
  "TelegramLogService.ts",
  "VMwareVCenterFeedService.ts",
  "WebhookLogService.ts",
  "WhatsAppLogService.ts",
  "WorkspaceNotificationLogService.ts",
];

const PROJECT_ID: ObjectID = new ObjectID(
  "6b1fb8a1-0c4e-4d7b-9f3a-2f6d3c1e5a01",
);

const USER_PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("06e40000-0000-4000-8000-000000000001"),
};

// A workflow step writes as root, with its project's tenant.
const WORKFLOW_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
  tenantId: PROJECT_ID,
};

// A job or an engine writes as root, with no project on the request.
const SERVER_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
};

// Someone signed in who holds no permission in the project.
const STRANGER_PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("06e40000-0000-4000-8000-0000000000ee"),
  userGlobalAccessPermission: {
    projectIds: [],
    globalPermissions: [Permission.Public, Permission.User],
    _type: "UserGlobalAccessPermission",
  },
  userTenantAccessPermission: {},
};

/*
 * Services whose own refusals describe the records they look up (a
 * database, a queue, a team's rules): they ask for the caller's whole create
 * permission before the project check reads anything
 * (checksCreatePermissionFirst).
 */
const SERVICES_CHECKING_CREATE_PERMISSION_FIRST: Array<string> = [
  "DatabaseServerFeedService.ts",
  "DatabaseServerService.ts",
  "MessageQueueService.ts",
  "TeamComplianceSettingService.ts",
  // Anyone signed in may create their own row: it must be theirs first.
  "ProjectUserProfileService.ts",
];

/*
 * Services whose own hook answers a person before the permission check does,
 * by design, with the reason.
 */
const SERVICES_ANSWERING_BEFORE_THE_PERMISSION_CHECK: Record<string, string> = {
  "UserNotificationRuleService.ts":
    "anyone signed in may create their own rule; the rule's owner must be a member of the project before anything else is decided (R1, UserNotificationRuleAdminGuards.test.ts)",
};

type ModelType = { new (): DatabaseBaseModel };

interface ModelCase {
  model: string;
  modelType: ModelType;
  references: Array<ProjectReferenceColumn>;
  writable: Array<ProjectReferenceColumn>;
  isRuleOrOwner: boolean;
}

interface ServiceCase {
  model: string;
  file: string;
  writable: Array<ProjectReferenceColumn>;
}

/*
 * The references of `model` a caller can write: an API create or update the
 * table and the column (either spelling of a relation) both allow, or a
 * workflow step that writes rows - a workflow writes as root, past every
 * column check. The workflow decorator is read as is (EnableWorkflowOn
 * writeSteps), so a model counts as writable even where its service is not
 * offered to workflows.
 */
export function getCallerWritableReferences(
  model: DatabaseBaseModel,
): Array<ProjectReferenceColumn> {
  const tableCreate: Array<Permission> = model.createRecordPermissions || [];
  const tableUpdate: Array<Permission> = model.updateRecordPermissions || [];
  const workflow: EnableWorkflowOn | undefined = model.enableWorkflowOn;
  const workflowWrites: boolean =
    Boolean(workflow) && workflow!.writeSteps !== false;
  const workflowCreate: boolean = workflowWrites && Boolean(workflow!.create);
  const workflowUpdate: boolean = workflowWrites && Boolean(workflow!.update);
  const access: Dictionary<ColumnAccessControl> =
    model.getColumnAccessControlForAllColumns();

  return ProjectReferenceCheck.getReferenceColumns(model).filter(
    (column: ProjectReferenceColumn): boolean => {
      const keys: Array<string> = [column.column];

      if (column.idColumn) {
        keys.push(column.idColumn);
      }

      const columnCreate: boolean = keys.some((key: string): boolean => {
        return (access[key]?.create || []).length > 0;
      });
      const columnUpdate: boolean = keys.some((key: string): boolean => {
        return (access[key]?.update || []).length > 0;
      });

      return (
        (tableCreate.length > 0 && columnCreate) ||
        (tableUpdate.length > 0 && columnUpdate) ||
        workflowCreate ||
        workflowUpdate
      );
    },
  );
}

function findModelCases(): Array<ModelCase> {
  const cases: Array<ModelCase> = [];

  for (const name of fs.readdirSync(MODELS_DIRECTORY).sort()) {
    if (!name.endsWith(".ts") || name === "Index.ts") {
      continue;
    }

    const source: string = fs.readFileSync(
      path.join(MODELS_DIRECTORY, name),
      "utf8",
    );

    const exported: unknown = (
      jest.requireActual(path.join(MODELS_DIRECTORY, name)) as {
        default?: unknown;
      }
    ).default;

    if (typeof exported !== "function") {
      continue;
    }

    const modelType: ModelType = exported as ModelType;
    let instance: unknown;

    try {
      instance = new modelType();
    } catch {
      continue;
    }

    if (!(instance instanceof DatabaseBaseModel)) {
      continue;
    }

    if (!instance.getTenantColumn()) {
      continue;
    }

    const references: Array<ProjectReferenceColumn> =
      ProjectReferenceCheck.getReferenceColumns(instance);

    if (references.length === 0) {
      continue;
    }

    const model: string = name.replace(/\.ts$/, "");

    cases.push({
      model: model,
      modelType: modelType,
      references: references,
      writable: getCallerWritableReferences(instance),
      isRuleOrOwner:
        RULE_MODEL_CLASS.test(source) || OWNER_MODEL_NAME.test(model),
    });
  }

  return cases;
}

const serviceSources: Map<string, string> = new Map<string, string>(
  fs
    .readdirSync(SERVICES_DIRECTORY)
    .filter((name: string): boolean => {
      return name.endsWith(".ts");
    })
    .map((name: string): [string, string] => {
      return [
        name,
        fs.readFileSync(path.join(SERVICES_DIRECTORY, name), "utf8"),
      ];
    }),
);

function loadService(file: string): DatabaseService<DatabaseBaseModel> {
  return (
    jest.requireActual(path.join(SERVICES_DIRECTORY, file)) as {
      default: DatabaseService<DatabaseBaseModel>;
    }
  ).default;
}

/*
 * The service files of a model: they import it and extend a service of it
 * (DatabaseService, ProjectReferencesService or a base of their own), and
 * the instance they export serves that model's table.
 */
function findServiceFiles(modelCase: ModelCase): Array<string> {
  const files: Array<string> = [];
  const tableName: string | null = new modelCase.modelType().tableName;

  for (const [file, source] of serviceSources) {
    const imported: RegExpMatchArray | null = source.match(
      new RegExp(
        `import (\\w+)(,\\s*\\{[^}]*\\})? from "\\.\\./\\.\\./Models/DatabaseModels/${modelCase.model}";`,
      ),
    );

    if (!imported) {
      continue;
    }

    if (!new RegExp(`extends \\w+<${imported[1]}>`).test(source)) {
      continue;
    }

    const service: unknown = loadService(file);

    if (
      service instanceof DatabaseService &&
      service.getModel().tableName === tableName
    ) {
      files.push(file);
    }
  }

  return files;
}

const MODEL_CASES: Array<ModelCase> = findModelCases();

const SERVICE_CASES: Array<ServiceCase> = MODEL_CASES.filter(
  (modelCase: ModelCase): boolean => {
    return !modelCase.isRuleOrOwner && modelCase.writable.length > 0;
  },
).flatMap((modelCase: ModelCase): Array<ServiceCase> => {
  return findServiceFiles(modelCase).map((file: string): ServiceCase => {
    return {
      model: modelCase.model,
      file: file,
      writable: modelCase.writable,
    };
  });
});

// The services held to ProjectReferencesService's check.
const CHECKED_CASES: Array<ServiceCase> = SERVICE_CASES.filter(
  (serviceCase: ServiceCase): boolean => {
    return !SERVICES_WITH_ANOTHER_CHECK[serviceCase.file];
  },
);

type ListFunction = (write?: ProjectReferenceWrite) => Array<string>;

/*
 * What a service checks itself on `write`; with no write, everything it may
 * check itself on some write.
 */
function declared(
  service: DatabaseService<DatabaseBaseModel>,
  method: "getRelationsCheckedByService" | "getListsCheckedByService",
  write?: ProjectReferenceWrite,
): Array<string> {
  const declaration: ListFunction | undefined = (
    service as unknown as Record<string, ListFunction | undefined>
  )[method];

  return declaration ? declaration.call(service, write) : [];
}

function checksServerWrites(
  service: DatabaseService<DatabaseBaseModel>,
): boolean {
  const declaration: (() => boolean) | undefined = (
    service as unknown as { checksServerWrites?: () => boolean }
  ).checksServerWrites;

  return declaration ? declaration.call(service) : true;
}

/*
 * The columns the generic check covers for this service on `write`; with no
 * write, those it covers on every write.
 */
function genericallyCheckedColumns(
  service: DatabaseService<DatabaseBaseModel>,
  write?: ProjectReferenceWrite,
): Array<ProjectReferenceColumn> {
  return ProjectReferenceCheck.getCheckedColumns(
    service.getModel(),
    declared(service, "getRelationsCheckedByService", write),
    declared(service, "getListsCheckedByService", write),
  );
}

function createBy(
  props: DatabaseCommonInteractionProps,
): ProjectReferenceWrite {
  return { kind: "create", props: props };
}

function updateBy(
  props: DatabaseCommonInteractionProps,
): ProjectReferenceWrite {
  return { kind: "update", props: props };
}

// A distinct id per column, so each column is shown to be checked on its own.
function idFor(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

function foreignIdFor(index: number): string {
  return idFor("f1f1f1f1", index);
}

function ownIdFor(index: number): string {
  return idFor("b1b1b1b1", index);
}

// The payload, as an API create or update sends it, with `id` in every column.
function payloadWith(
  columns: Array<ProjectReferenceColumn>,
  idOf: (index: number) => string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  columns.forEach((column: ProjectReferenceColumn, index: number) => {
    if (column.isList) {
      payload[column.column] = [{ _id: idOf(index) }];
    } else {
      payload[column.idColumn || column.column] = new ObjectID(idOf(index));
    }
  });

  return payload;
}

function recordWith(
  service: DatabaseService<DatabaseBaseModel>,
  values: Record<string, unknown>,
): DatabaseBaseModel {
  const record: DatabaseBaseModel = new service.modelType();
  record.setColumnValue(record.getTenantColumn()!, PROJECT_ID);
  Object.assign(record, values);
  return record;
}

type HookFunction = (input: unknown) => Promise<unknown>;

function callHook(
  service: DatabaseService<DatabaseBaseModel>,
  hook: "onBeforeCreate" | "onBeforeUpdate",
  input: unknown,
): Promise<unknown> {
  return (service as unknown as Record<string, HookFunction>)[hook]!.call(
    service,
    input,
  );
}

/*
 * The person's create permission, which a few services ask for before the
 * reference check (checksCreatePermissionFirst), lets them through: these
 * tests are about the references.
 */
function allowCreatePermission(): void {
  jest
    .spyOn(ModelPermission, "checkCreatePermissions")
    .mockImplementation((): void => {
      // allowed
    });
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return null;
}

function servicesOf(file: string): DatabaseService<DatabaseBaseModel> {
  return loadService(file);
}

/*
 * The project has the "own" ids, by the table each column points at, and
 * the users among them as members. No "foreign" id is anywhere in it; the
 * ids in `elsewhere` are records of some other project.
 */
function stubTheProject(elsewhere: Array<string> = []): void {
  /*
   * Whichever write a test makes, the column at position i is written the
   * "own" id i: every table any reference points at holds them all.
   */
  const tables: Set<string> = new Set<string>();
  let mostColumns: number = 0;

  for (const serviceCase of CHECKED_CASES) {
    const columns: Array<ProjectReferenceColumn> =
      ProjectReferenceCheck.getCheckedColumns(
        servicesOf(serviceCase.file).getModel(),
      );

    mostColumns = Math.max(mostColumns, columns.length);

    for (const column of columns) {
      tables.add(column.service.getModel().tableName || "");
    }
  }

  const ownIds: Array<string> = Array.from(
    { length: mostColumns },
    (_value: unknown, index: number): string => {
      return ownIdFor(index);
    },
  );

  const records: Record<string, Array<string>> = {};

  for (const table of tables) {
    records[table] = ownIds;
  }

  stubProjectDirectory({
    projectId: PROJECT_ID,
    records: records,
    members: ownIds,
    elsewhere: elsewhere,
  });
}

// An id no record has, in any project.
function missingIdFor(index: number): string {
  return idFor("d1d1d1d1", index);
}

beforeEach(() => {
  stubTheProject();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("services whose rows name the project's records", () => {
  test("are found from the models' metadata", () => {
    const writableModels: Array<ModelCase> = MODEL_CASES.filter(
      (modelCase: ModelCase): boolean => {
        return !modelCase.isRuleOrOwner && modelCase.writable.length > 0;
      },
    );

    // Today: about 150 such models, besides the rules and owner rows.
    expect(writableModels.length).toBeGreaterThanOrEqual(140);
    expect(SERVICE_CASES.length).toBeGreaterThanOrEqual(150);
    expect(CHECKED_CASES.length).toBeGreaterThanOrEqual(130);
  });

  test("each one checks the records it names, or is listed with the reason it is safe", () => {
    const uncovered: Array<string> = [];

    for (const serviceCase of SERVICE_CASES) {
      if (SERVICES_WITH_ANOTHER_CHECK[serviceCase.file]) {
        continue;
      }

      if (servicesOf(serviceCase.file) instanceof ProjectReferencesService) {
        continue;
      }

      uncovered.push(
        `${serviceCase.file} (${serviceCase.model}: ${serviceCase.writable
          .map((column: ProjectReferenceColumn): string => {
            return column.column;
          })
          .join(", ")})`,
      );
    }

    /*
     * Extend ProjectReferencesService (Common/Server/Services), calling its
     * hooks first from any hook of your own - or, if the service checks
     * these itself, list it in SERVICES_WITH_ANOTHER_CHECK with the reason.
     */
    expect(uncovered).toEqual([]);
  });

  test("every listed exception is a service of a model whose references a caller can write", () => {
    for (const file of Object.keys(SERVICES_WITH_ANOTHER_CHECK)) {
      expect({
        file,
        found: SERVICE_CASES.some((serviceCase: ServiceCase): boolean => {
          return serviceCase.file === file;
        }),
      }).toEqual({ file, found: true });
    }
  });

  test.each(
    Object.entries(SERVICES_WITH_ANOTHER_CHECK)
      .filter(([, check]: [string, AnotherCheck]): boolean => {
        return check.kind === "owner-is-the-caller";
      })
      .map(([file]: [string, AnotherCheck]) => {
        return [file];
      }),
  )(
    "%s: the only reference a caller writes is its owner, who is the caller",
    (file: string) => {
      const model: DatabaseBaseModel = servicesOf(file).getModel();
      const userColumn: string | null = model.getUserColumn();

      // Only the owner may create the row...
      expect(model.createRecordPermissions).toEqual([Permission.CurrentUser]);
      expect(userColumn).toBeTruthy();

      const writable: Array<ProjectReferenceColumn> =
        getCallerWritableReferences(model);

      // ...the owner is the only reference it can write...
      for (const column of writable) {
        expect({ file, column: column.idColumn }).toEqual({
          file,
          column: userColumn,
        });
      }

      // ...and nobody can change it afterwards.
      const access: Dictionary<ColumnAccessControl> =
        model.getColumnAccessControlForAllColumns();

      expect(access[userColumn!]?.update || []).toEqual([]);
      expect(
        Boolean(model.enableWorkflowOn) &&
          model.enableWorkflowOn.writeSteps !== false &&
          Boolean(
            model.enableWorkflowOn.create || model.enableWorkflowOn.update,
          ),
      ).toBe(false);
    },
  );

  test("a service checks some references itself only where that is listed", () => {
    const declaring: Array<string> = [];

    for (const serviceCase of CHECKED_CASES) {
      const service: DatabaseService<DatabaseBaseModel> = servicesOf(
        serviceCase.file,
      );

      if (
        declared(service, "getRelationsCheckedByService").length > 0 ||
        declared(service, "getListsCheckedByService").length > 0
      ) {
        declaring.push(serviceCase.file);
      }
    }

    expect(declaring.sort()).toEqual(
      Object.keys(SERVICES_WITH_THEIR_OWN_CHECKS).sort(),
    );
  });

  test("a service leaves OneUptime's own writes unchecked only where that is listed", () => {
    const trusting: Array<string> = CHECKED_CASES.filter(
      (serviceCase: ServiceCase): boolean => {
        return !checksServerWrites(servicesOf(serviceCase.file));
      },
    ).map((serviceCase: ServiceCase): string => {
      return serviceCase.file;
    });

    expect(trusting.sort()).toEqual(
      [...SERVICES_TRUSTING_SERVER_WRITES].sort(),
    );
  });

  test.each(
    CHECKED_CASES.map((serviceCase: ServiceCase) => {
      return [serviceCase.file];
    }),
  )("%s names only its own references as checked by itself", (file: string) => {
    const service: DatabaseService<DatabaseBaseModel> = servicesOf(file);
    const references: Array<ProjectReferenceColumn> =
      ProjectReferenceCheck.getReferenceColumns(service.getModel());

    for (const relation of declared(service, "getRelationsCheckedByService")) {
      expect({
        file,
        relation,
        isRelation: references.some(
          (column: ProjectReferenceColumn): boolean => {
            return column.column === relation && !column.isList;
          },
        ),
      }).toEqual({ file, relation, isRelation: true });
    }

    for (const list of declared(service, "getListsCheckedByService")) {
      expect({
        file,
        list,
        isList: references.some((column: ProjectReferenceColumn): boolean => {
          return column.column === list && column.isList;
        }),
      }).toEqual({ file, list, isList: true });
    }
  });

  test.each(
    CHECKED_CASES.map((serviceCase: ServiceCase) => {
      return [serviceCase.file];
    }),
  )("%s calls the base hooks first from its own", (file: string) => {
    const source: string = serviceSources.get(file) || "";

    for (const hook of ["onBeforeCreate", "onBeforeUpdate"]) {
      const signature: RegExp = new RegExp(
        `override async ${hook}\\(\\s*(\\w+)[^)]*\\)[^{]*\\{\\s*`,
      );
      const match: RegExpExecArray | null = signature.exec(source);

      if (!match) {
        continue;
      }

      const body: string = source.slice(match.index + match[0].length);

      // The first statement - after any comment - is the base hook.
      const firstStatement: string = body
        .replace(/^(\s*\/\*[\s\S]*?\*\/\s*|\s*\/\/[^\n]*\n)*/, "")
        .trimStart();

      expect({
        file,
        hook,
        first: firstStatement.startsWith(`await super.${hook}(${match[1]});`),
      }).toEqual({ file, hook, first: true });
    }
  });

  test.each(
    CHECKED_CASES.map((serviceCase: ServiceCase) => {
      return [serviceCase.file];
    }),
  )(
    "%s refuses another project's record in every list and relation it does not check itself",
    async (file: string) => {
      const service: DatabaseService<DatabaseBaseModel> = servicesOf(file);
      allowCreatePermission();

      const propsToTry: Array<DatabaseCommonInteractionProps> = [
        USER_PROPS,
        WORKFLOW_PROPS,
      ];

      if (checksServerWrites(service)) {
        propsToTry.push(SERVER_PROPS);
      }

      for (const props of propsToTry) {
        const columns: Array<ProjectReferenceColumn> =
          genericallyCheckedColumns(service, createBy(props));

        if (columns.length === 0) {
          // Every reference it has is one it checks itself (see the service).
          expect(
            declared(service, "getRelationsCheckedByService").length +
              declared(service, "getListsCheckedByService").length,
          ).toBeGreaterThan(0);
          continue;
        }

        const thrown: unknown = await refusalOf(
          callHook(service, "onBeforeCreate", {
            data: recordWith(service, payloadWith(columns, foreignIdFor)),
            props: props,
          }),
        );

        expect(thrown).toBeInstanceOf(ProjectScopedReferenceException);

        const message: string = (thrown as Error).message;

        expect(message).toContain(
          "references records that are not in this project",
        );

        columns.forEach((column: ProjectReferenceColumn, index: number) => {
          expect(message).toContain(
            `${column.modelName} "${foreignIdFor(index)}"`,
          );
        });
      }
    },
  );

  test.each(
    CHECKED_CASES.map((serviceCase: ServiceCase) => {
      return [serviceCase.file];
    }),
  )("%s accepts its project's own records", async (file: string) => {
    const service: DatabaseService<DatabaseBaseModel> = servicesOf(file);
    const write: ProjectReferenceWrite = createBy(USER_PROPS);
    const columns: Array<ProjectReferenceColumn> = genericallyCheckedColumns(
      service,
      write,
    );

    await expect(
      ProjectReferenceCheck.validateCreate({
        service: service,
        createBy: {
          data: recordWith(service, payloadWith(columns, ownIdFor)),
          props: USER_PROPS,
        },
        relationsCheckedByService: declared(
          service,
          "getRelationsCheckedByService",
          write,
        ),
        listsCheckedByService: declared(
          service,
          "getListsCheckedByService",
          write,
        ),
      }),
    ).resolves.toBeUndefined();
  });

  test.each(
    CHECKED_CASES.map((serviceCase: ServiceCase) => {
      return [serviceCase.file];
    }),
  )(
    "%s refuses another project's record an update adds",
    async (file: string) => {
      const service: DatabaseService<DatabaseBaseModel> = servicesOf(file);
      const columns: Array<ProjectReferenceColumn> = genericallyCheckedColumns(
        service,
        updateBy(USER_PROPS),
      );

      if (columns.length === 0) {
        return;
      }

      // The record holds nothing yet.
      jest.spyOn(service, "findBy").mockResolvedValue([] as never);

      /*
       * The read of the rows the caller's update may write, which the update
       * path makes before the hooks: what the read above answers.
       */
      stubRowsCallerMayWriteLikeFindBy(service, jest.spyOn(service, "findBy"));

      const thrown: unknown = await refusalOf(
        callHook(service, "onBeforeUpdate", {
          query: { _id: "1c2d3e4f-0000-4000-8000-0000000000a1" },
          data: payloadWith(columns, foreignIdFor),
          props: USER_PROPS,
          limit: 1,
          skip: 0,
        }),
      );

      expect(thrown).toBeInstanceOf(ProjectScopedReferenceException);
    },
  );

  test.each(
    CHECKED_CASES.map((serviceCase: ServiceCase) => {
      return [serviceCase.file];
    }),
  )(
    "%s answers a record that does not exist exactly as one of another project",
    async (file: string) => {
      const service: DatabaseService<DatabaseBaseModel> = servicesOf(file);
      const columns: Array<ProjectReferenceColumn> = genericallyCheckedColumns(
        service,
        createBy(USER_PROPS),
      );

      if (columns.length === 0) {
        return;
      }

      allowCreatePermission();

      // The "foreign" ids are another project's records; the missing ones are nobody's.
      stubTheProject(
        columns.map((_column: ProjectReferenceColumn, index: number) => {
          return foreignIdFor(index);
        }),
      );

      const foreign: unknown = await refusalOf(
        callHook(service, "onBeforeCreate", {
          data: recordWith(service, payloadWith(columns, foreignIdFor)),
          props: USER_PROPS,
        }),
      );
      const missing: unknown = await refusalOf(
        callHook(service, "onBeforeCreate", {
          data: recordWith(service, payloadWith(columns, missingIdFor)),
          props: USER_PROPS,
        }),
      );

      expect(foreign).toBeInstanceOf(ProjectScopedReferenceException);
      expect(missing).toBeInstanceOf(ProjectScopedReferenceException);

      // Word for word the same answer, but for the ids it names.
      expect(
        (missing as Error).message.split("d1d1d1d1").join("f1f1f1f1"),
      ).toBe((foreign as Error).message);
    },
  );

  test.each(
    CHECKED_CASES.map((serviceCase: ServiceCase) => {
      return [serviceCase.file];
    }),
  )(
    "%s lets an update save back what its record already holds",
    async (file: string) => {
      const service: DatabaseService<DatabaseBaseModel> = servicesOf(file);
      const columns: Array<ProjectReferenceColumn> = genericallyCheckedColumns(
        service,
        updateBy(USER_PROPS),
      );

      if (columns.length === 0) {
        return;
      }

      // The record has held these "foreign" ids since before they were checked.
      const held: Record<string, unknown> = {};

      columns.forEach((column: ProjectReferenceColumn, index: number) => {
        held[column.column] = column.isList
          ? [{ _id: foreignIdFor(index) }]
          : { _id: foreignIdFor(index) };
      });

      const record: DatabaseBaseModel = recordWith(service, held);

      // The record the update names - a project is its own project already.
      if (!record._id) {
        record._id = "1c2d3e4f-0000-4000-8000-0000000000a1";
      }

      jest.spyOn(service, "findBy").mockResolvedValue([record] as never);

      /*
       * The read of the rows the caller's update may write, which the update
       * path makes before the hooks: what the read above answers.
       */
      stubRowsCallerMayWriteLikeFindBy(service, jest.spyOn(service, "findBy"));

      // The base class's hook: the service's own may read the database.
      const baseHook: HookFunction = (
        ProjectReferencesService.prototype as unknown as Record<
          string,
          HookFunction
        >
      )["onBeforeUpdate"]!;

      const update: (data: Record<string, unknown>) => Promise<unknown> = (
        data: Record<string, unknown>,
      ): Promise<unknown> => {
        return baseHook.call(service, {
          query: { _id: "1c2d3e4f-0000-4000-8000-0000000000a1" },
          data: data,
          props: USER_PROPS,
          limit: 1,
          skip: 0,
        });
      };

      await expect(
        update(payloadWith(columns, foreignIdFor)),
      ).resolves.toBeDefined();

      // What it holds exempts nothing else.
      await expect(
        update(payloadWith(columns, missingIdFor)),
      ).rejects.toBeInstanceOf(ProjectScopedReferenceException);
    },
  );

  /*
   * The check answers only someone who may write the table in the project:
   * DatabaseService refuses everyone else before any hook runs, so the
   * answer is never a way to learn which ids a project has. (A model anyone
   * may create in - a status page subscription - names only what its public
   * page shows.)
   */
  test.each(
    CHECKED_CASES.filter((serviceCase: ServiceCase): boolean => {
      return (
        !SERVICES_ANSWERING_BEFORE_THE_PERMISSION_CHECK[serviceCase.file] &&
        !servicesOf(serviceCase.file)
          .getModel()
          .createRecordPermissions.includes(Permission.Public)
      );
    }).map((serviceCase: ServiceCase) => {
      return [serviceCase.file];
    }),
  )(
    "%s refuses someone who may not create in it before reading anything",
    async (file: string) => {
      const service: DatabaseService<DatabaseBaseModel> = servicesOf(file);
      const lookups: ReturnType<typeof jest.spyOn> = jest.spyOn(
        ProjectScopedReferenceValidator,
        "getUnavailableReferences",
      );

      // A few creates take a lock first; here it is always free.
      jest
        .spyOn(Semaphore, "lock")
        .mockResolvedValue({} as unknown as SemaphoreMutex);
      jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);

      const thrown: unknown = await refusalOf(
        service.create({
          data: recordWith(
            service,
            payloadWith(
              ProjectReferenceCheck.getCheckedColumns(service.getModel()),
              foreignIdFor,
            ),
          ),
          props: STRANGER_PROPS,
        }),
      );

      /*
       * Refused - for not holding the permission, or sooner (an id supplied
       * on a create, a feature of another edition) - and never by the
       * project check, which has read nothing.
       */
      expect({
        file,
        refused: thrown !== null,
        byTheProjectCheck: thrown instanceof ProjectScopedReferenceException,
      }).toEqual({ file, refused: true, byTheProjectCheck: false });
      expect(lookups).not.toHaveBeenCalled();
    },
  );

  test("a service asks for the whole create permission first only where that is listed", () => {
    const asking: Array<string> = CHECKED_CASES.filter(
      (serviceCase: ServiceCase): boolean => {
        const declaration: (() => boolean) | undefined = (
          servicesOf(serviceCase.file) as unknown as {
            checksCreatePermissionFirst?: () => boolean;
          }
        ).checksCreatePermissionFirst;

        return Boolean(
          declaration && declaration.call(servicesOf(serviceCase.file)),
        );
      },
    ).map((serviceCase: ServiceCase): string => {
      return serviceCase.file;
    });

    expect(asking.sort()).toEqual(
      [...SERVICES_CHECKING_CREATE_PERMISSION_FIRST].sort(),
    );
  });

  test.each(
    SERVICES_CHECKING_CREATE_PERMISSION_FIRST.map((file: string) => {
      return [file];
    }),
  )(
    "%s refuses a caller without the create permission before the project check reads anything",
    async (file: string) => {
      const service: DatabaseService<DatabaseBaseModel> = servicesOf(file);
      const lookups: ReturnType<typeof jest.spyOn> = jest.spyOn(
        ProjectScopedReferenceValidator,
        "getUnavailableReferences",
      );

      // The base class's hook, past DatabaseService's own check of the table.
      const baseHook: HookFunction = (
        ProjectReferencesService.prototype as unknown as Record<
          string,
          HookFunction
        >
      )["onBeforeCreate"]!;

      const thrown: unknown = await refusalOf(
        baseHook.call(service, {
          data: recordWith(
            service,
            payloadWith(
              ProjectReferenceCheck.getCheckedColumns(service.getModel()),
              foreignIdFor,
            ),
          ),
          props: STRANGER_PROPS,
        }),
      );

      // Refused by the permission check (or its edition check), not by this one.
      expect({
        file,
        refused: thrown !== null,
        byTheProjectCheck: thrown instanceof ProjectScopedReferenceException,
      }).toEqual({ file, refused: true, byTheProjectCheck: false });
      expect(lookups).not.toHaveBeenCalled();
    },
  );

  test.each(
    SERVICES_TRUSTING_SERVER_WRITES.map((file: string) => {
      return [file];
    }),
  )(
    "%s reads nothing for OneUptime's own write, and still checks a workflow's",
    async (file: string) => {
      const service: DatabaseService<DatabaseBaseModel> = servicesOf(file);
      const columns: Array<ProjectReferenceColumn> =
        genericallyCheckedColumns(service);

      expect(columns.length).toBeGreaterThan(0);

      allowCreatePermission();

      const lookups: ReturnType<typeof jest.spyOn> = jest.spyOn(
        ProjectScopedReferenceValidator,
        "getUnavailableReferences",
      );

      // The base class's hook: the service's own may read the database.
      const baseHook: HookFunction = (
        ProjectReferencesService.prototype as unknown as Record<
          string,
          HookFunction
        >
      )["onBeforeCreate"]!;

      await expect(
        baseHook.call(service, {
          data: recordWith(service, payloadWith(columns, foreignIdFor)),
          props: SERVER_PROPS,
        }),
      ).resolves.toBeDefined();

      expect(lookups).not.toHaveBeenCalled();

      for (const props of [WORKFLOW_PROPS, USER_PROPS]) {
        await expect(
          baseHook.call(service, {
            data: recordWith(service, payloadWith(columns, foreignIdFor)),
            props: props,
          }),
        ).rejects.toBeInstanceOf(ProjectScopedReferenceException);
      }
    },
  );
});
