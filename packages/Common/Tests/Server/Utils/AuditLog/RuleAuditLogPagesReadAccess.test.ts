import "../../TestingUtils/Init";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import IncidentOwnerRuleService from "../../../../Server/Services/IncidentOwnerRuleService";
import NetworkSiteAssignmentRuleService from "../../../../Server/Services/NetworkSiteAssignmentRuleService";
import RunbookRuleService from "../../../../Server/Services/RunbookRuleService";
import FindBy from "../../../../Server/Types/Database/FindBy";
import AuditLogReadAccess from "../../../../Server/Utils/AuditLog/AuditLogReadAccess";
import AuditLog from "../../../../Models/AnalyticsModels/AuditLog";
import AllDatabaseModelTypes from "../../../../Models/DatabaseModels/Index";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HostLabelRule from "../../../../Models/DatabaseModels/HostLabelRule";
import IncidentOwnerRule from "../../../../Models/DatabaseModels/IncidentOwnerRule";
import NetworkSiteAssignmentRule from "../../../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import RunbookRule from "../../../../Models/DatabaseModels/RunbookRule";
import AuditLogAction from "../../../../Types/AuditLog/AuditLogAction";
import {
  AUDIT_LOG_HIDDEN_VALUE,
  isAuditLogChangeHidden,
} from "../../../../Types/AuditLog/AuditLogHiddenValues";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../../Server/Utils/Logger");

/*
 * A PRODUCT'S RULES' AUDIT LOGS PAGE SHOWS ITS READER ONLY WHAT THEY MAY
 * READ OF THE RULES (#10462, held by #10658's AuditLogReadAccess).
 *
 * Alerts > Rules > Audit Logs, Incidents > Rules > Audit Logs, Hosts >
 * Settings > Rule Audit Logs and the rest list their product's rules'
 * entries by type, through the shared audit log table, whose every read
 * AuditLogService holds to its reader. These hold the entries of every kind
 * of rule those pages list to the rule's own read lists, as #10658 holds
 * every entry:
 *
 *   - a reader who may not read a rule (Read Audit Log alone) sees that it
 *     changed, who changed it, when and which fields - "Name hidden" and
 *     "Value hidden" in place of the rest;
 *   - a Project Owner reads every one of them as it was recorded, and a
 *     Project Admin a deleted one's snapshot;
 *   - a product's own readers read their product's rules and not another's:
 *     an Incident Viewer an incident owner rule, never a host label rule; a
 *     Runbook Viewer the runbook rules of every product, on Runbooks' page;
 *     a Settings Admin a network site assignment rule, never a runbook rule.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10462000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("10462000-0000-4000-8000-000000000002");
const RULE_ID: ObjectID = new ObjectID("10462000-0000-4000-8000-0000000000a1");
const DELETED_RULE_ID: ObjectID = new ObjectID(
  "10462000-0000-4000-8000-0000000000a2",
);

// The tables of the rules each product's rules' Audit Logs page lists.
const RULE_PAGE_TABLES: ReadonlyArray<RegExp> = [
  /^Alert(Episode)?[A-Z][A-Za-z]*Rule(OwningTeam)?$/,
  /^Incident(Episode)?[A-Z][A-Za-z]*Rule(OwningTeam)?$/,
  /^Monitor[A-Z][A-Za-z]*Rule$/,
  /^ScheduledMaintenance[A-Z][A-Za-z]*Rule$/,
  /^StatusPage(Owner|Label)Rule$/,
  /^Service(Owner|Label)Rule$/,
  /^Host[A-Z][A-Za-z]*Rule$/,
  /^KubernetesCluster[A-Z][A-Za-z]*Rule$/,
  /^DockerHost[A-Z][A-Za-z]*Rule$/,
  /^DockerSwarmCluster[A-Z][A-Za-z]*Rule$/,
  /^PodmanHost[A-Z][A-Za-z]*Rule$/,
  /^ProxmoxCluster[A-Z][A-Za-z]*Rule$/,
  /^OpenStackCloud[A-Z][A-Za-z]*Rule$/,
  /^VMwareVCenter[A-Z][A-Za-z]*Rule$/,
  /^CephCluster[A-Z][A-Za-z]*Rule$/,
  /^StorageArray[A-Z][A-Za-z]*Rule$/,
  /^Network(Device|Site)[A-Z][A-Za-z]*Rule$/,
  /^IoTFleet[A-Z][A-Za-z]*Rule$/,
  /^Runbook[A-Za-z]*Rule$/,
];

const RULE_MODELS: Array<BaseModel> = (
  AllDatabaseModelTypes as Array<DatabaseBaseModelType>
)
  .map((modelType: DatabaseBaseModelType): BaseModel => {
    return new modelType();
  })
  .filter((model: BaseModel): boolean => {
    return (
      Boolean(model.enableAuditLogOn?.update) &&
      RULE_PAGE_TABLES.some((tables: RegExp): boolean => {
        return tables.test(model.tableName || "");
      })
    );
  });

function rowsOf(rows: Array<Permission>): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };
}

// A person in the project, with these permissions.
function memberWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: rowsOf([
        Permission.CurrentUser,
        Permission.ProjectUser,
        ...permissions,
      ]),
    },
    userTeamIds: [],
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  };
}

const READ_AUDIT_LOG_ALONE: DatabaseCommonInteractionProps = memberWith([
  Permission.ReadAuditLog,
]);
const PROJECT_OWNER: DatabaseCommonInteractionProps = memberWith([
  Permission.ProjectOwner,
]);
const PROJECT_ADMIN: DatabaseCommonInteractionProps = memberWith([
  Permission.ProjectAdmin,
]);

/*
 * A field every kind of rule records: its name, the team it gives a rule,
 * or what it matches (a site assignment rule's host names).
 */
function fieldOf(model: BaseModel): string {
  for (const column of ["name", "teamId", "hostnamePattern", "isEnabled"]) {
    if (model.isTableColumn(column)) {
      return column;
    }
  }

  throw new Error(`${model.tableName} has no field the sweep knows`);
}

function entryOf(data: {
  model: BaseModel;
  id: ObjectID;
  action: AuditLogAction;
  changes: JSONArray;
}): AuditLog {
  const entry: AuditLog = new AuditLog();
  entry._id = ObjectID.generate();
  entry.projectId = PROJECT_ID;
  entry.resourceType =
    AuditLogReadAccess.getResourceTypeOf(data.model) || "missing";
  entry.resourceId = data.id;
  entry.resourceName = "Page the checkout team";
  entry.action = data.action;
  entry.userId = USER_ID;
  entry.userName = "Jane Doe";
  entry.userEmail = "jane@example.com";
  entry.changes = JSON.parse(JSON.stringify(data.changes)) as JSONArray;

  return entry;
}

// An update of a rule: its name, or the team picked to own it.
function ruleUpdate(model: BaseModel, id: ObjectID = RULE_ID): AuditLog {
  const field: string = fieldOf(model);

  return entryOf({
    model,
    id,
    action: AuditLogAction.Update,
    changes: [
      field === "name"
        ? {
            field,
            oldValue: "Page the payments team",
            newValue: "Page the checkout team",
          }
        : field === "teamId"
          ? {
              field,
              oldValue: "10462000-0000-4000-8000-0000000000b1",
              newValue: "10462000-0000-4000-8000-0000000000b2",
            }
          : { field, oldValue: true, newValue: false },
    ],
  });
}

// A rule deleted since: the snapshot the entry kept of it.
function ruleDeleted(model: BaseModel): AuditLog {
  const field: string = fieldOf(model);

  return entryOf({
    model,
    id: DELETED_RULE_ID,
    action: AuditLogAction.Delete,
    changes: [
      {
        field,
        oldValue:
          field === "isEnabled" ? true : "Page the payments team on Fridays",
      },
    ],
  });
}

type AnyService = DatabaseService<BaseModel>;

/*
 * What a service's read finds, for the services a test names: the records
 * of `ids` it is asked for. Every other service answers as it would.
 */
const foundByService: Map<
  AnyService,
  { ids: Array<ObjectID>; asked: Array<FindBy<BaseModel>> }
> = new Map();

function answerFindsFromTests(): void {
  const original: AnyService["findBy"] = DatabaseService.prototype.findBy;

  jest
    .spyOn(DatabaseService.prototype, "findBy")
    .mockImplementation(async function (
      this: AnyService,
      findBy: FindBy<BaseModel>,
    ): Promise<Array<BaseModel>> {
      const found:
        | { ids: Array<ObjectID>; asked: Array<FindBy<BaseModel>> }
        | undefined = foundByService.get(this);

      if (!found) {
        return await original.call(this, findBy);
      }

      found.asked.push(findBy);

      const idCondition: FindOperator<unknown> = (
        findBy.query as unknown as { _id: FindOperator<unknown> }
      )._id;
      const askedIds: Array<string> = (
        Object.values(
          idCondition.objectLiteralParameters || {},
        )[0] as Array<string>
      ).map((id: string): string => {
        return id.toLowerCase();
      });

      return found.ids
        .filter((id: ObjectID): boolean => {
          return askedIds.includes(id.toString().toLowerCase());
        })
        .map((id: ObjectID): BaseModel => {
          const model: BaseModel = new this.modelType() as BaseModel;
          model._id = id.toString();
          return model;
        });
    } as never);
}

function findsOnly(
  service: unknown,
  ids: Array<ObjectID>,
): Array<FindBy<BaseModel>> {
  const asked: Array<FindBy<BaseModel>> = [];

  foundByService.set(service as AnyService, { ids, asked });

  return asked;
}

async function hold(
  entries: Array<AuditLog>,
  props: DatabaseCommonInteractionProps,
): Promise<Array<AuditLog>> {
  await AuditLogReadAccess.holdEntriesToReader({ entries, props });
  return entries;
}

function expectHeldFromReader(held: AuditLog, recorded: AuditLog): void {
  // Who, what kind, which record, when and which fields stay.
  expect(held.resourceType).toBe(recorded.resourceType);
  expect(held.resourceId?.toString()).toBe(recorded.resourceId?.toString());
  expect(held.action).toBe(recorded.action);
  expect(held.userEmail).toBe(recorded.userEmail);
  expect(
    (held.changes || []).map((change: unknown): unknown => {
      return (change as JSONObject)["field"];
    }),
  ).toEqual(
    (recorded.changes || []).map((change: unknown): unknown => {
      return (change as JSONObject)["field"];
    }),
  );

  // The rule's name and every value are kept from them.
  expect(held.resourceName).toBe(AUDIT_LOG_HIDDEN_VALUE);

  for (const change of held.changes || []) {
    const shown: JSONObject = change as JSONObject;

    expect(isAuditLogChangeHidden(shown)).toBe(true);

    for (const key of ["oldValue", "newValue"]) {
      if (Object.prototype.hasOwnProperty.call(shown, key)) {
        expect(shown[key]).toBe(AUDIT_LOG_HIDDEN_VALUE);
      }
    }
  }

  expect(JSON.stringify(held.toJSON())).not.toMatch(/payments|checkout/);
}

function expectShownAsRecorded(held: AuditLog, recorded: AuditLog): void {
  expect(held.resourceName).toBe(recorded.resourceName);
  expect(held.changes).toEqual(recorded.changes);
}

describe("the entries the rules' Audit Logs pages list, held to their reader", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    foundByService.clear();
    answerFindsFromTests();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    foundByService.clear();
  });

  test("the sweep reads every kind of rule the pages list (it is not vacuous)", () => {
    const tables: Array<string> = RULE_MODELS.map((model: BaseModel) => {
      return model.tableName || "";
    });

    // Alerts' 13 kinds and the 54 of the other products' pages.
    expect(tables.length).toBeGreaterThanOrEqual(67);
    expect(tables).toEqual(
      expect.arrayContaining([
        "IncidentOwnerRule",
        "IncidentEpisodeOnCallRuleOwningTeam",
        "MonitorLabelRule",
        "ScheduledMaintenanceReminderRule",
        "HostLabelRule",
        "NetworkSiteAssignmentRule",
        "RunbookRule",
      ]),
    );
  });

  test.each(
    RULE_MODELS.map((model: BaseModel): [string, BaseModel] => {
      return [model.tableName || "", model];
    }),
  )(
    "%s: the audit log finds the rule's table by the type its entries carry",
    (_table: string, model: BaseModel) => {
      const type: string | null = AuditLogReadAccess.getResourceTypeOf(model);

      expect(type).toBeTruthy();
      expect(
        AuditLogReadAccess.getModelTypesOf(type as string).map(
          (modelType: DatabaseBaseModelType): string | null => {
            return new modelType().tableName;
          },
        ),
      ).toContain(model.tableName);
    },
  );

  test.each(
    RULE_MODELS.map((model: BaseModel): [string, BaseModel] => {
      return [model.tableName || "", model];
    }),
  )(
    "%s: Read Audit Log alone sees who changed which field and when, never the rule's name or values",
    async (_table: string, model: BaseModel) => {
      const [held] = await hold([ruleUpdate(model)], READ_AUDIT_LOG_ALONE);

      expectHeldFromReader(held!, ruleUpdate(model));
    },
  );

  test.each(
    RULE_MODELS.map((model: BaseModel): [string, BaseModel] => {
      return [model.tableName || "", model];
    }),
  )(
    "%s: a Project Owner reads it as recorded",
    async (_table: string, model: BaseModel) => {
      const [held] = await hold([ruleUpdate(model)], PROJECT_OWNER);

      expectShownAsRecorded(held!, ruleUpdate(model));
    },
  );

  test.each(
    RULE_MODELS.map((model: BaseModel): [string, BaseModel] => {
      return [model.tableName || "", model];
    }),
  )(
    "%s deleted since: a Project Admin reads its snapshot, Read Audit Log alone does not",
    async (_table: string, model: BaseModel) => {
      const [forAdmin] = await hold([ruleDeleted(model)], PROJECT_ADMIN);
      expectShownAsRecorded(forAdmin!, ruleDeleted(model));

      const [forAuditLogReader] = await hold(
        [ruleDeleted(model)],
        READ_AUDIT_LOG_ALONE,
      );
      expectHeldFromReader(forAuditLogReader!, ruleDeleted(model));
    },
  );

  describe("a product's own readers read their product's rules, and no other's", () => {
    const INCIDENT_VIEWER: DatabaseCommonInteractionProps = memberWith([
      Permission.IncidentViewer,
      Permission.ReadAuditLog,
    ]);
    const RUNBOOK_VIEWER: DatabaseCommonInteractionProps = memberWith([
      Permission.RunbookViewer,
      Permission.ReadAuditLog,
    ]);
    const SETTINGS_ADMIN: DatabaseCommonInteractionProps = memberWith([
      Permission.SettingsAdmin,
    ]);

    test("an Incident Viewer with Read Audit Log reads Incidents' page in full, and nothing of a host label rule", async () => {
      findsOnly(IncidentOwnerRuleService, [RULE_ID]);

      const [incidentRule, hostRule] = await hold(
        [ruleUpdate(new IncidentOwnerRule()), ruleUpdate(new HostLabelRule())],
        INCIDENT_VIEWER,
      );

      expectShownAsRecorded(incidentRule!, ruleUpdate(new IncidentOwnerRule()));
      expectHeldFromReader(hostRule!, ruleUpdate(new HostLabelRule()));
    });

    test("a Runbook Viewer with Read Audit Log reads the runbook rules of every product, on Runbooks' page", async () => {
      findsOnly(RunbookRuleService, [RULE_ID]);

      const alertRunbookRule: AuditLog = entryOf({
        model: new RunbookRule(),
        id: RULE_ID,
        action: AuditLogAction.Create,
        changes: [
          { field: "name", newValue: "Page the checkout team" },
          { field: "triggerEntityType", newValue: "Alert" },
        ],
      });

      const [held] = await hold([alertRunbookRule], RUNBOOK_VIEWER);

      expectShownAsRecorded(held!, alertRunbookRule);
      // What it was created for is there to read: the entry's own type does not say.
      expect(
        (held!.changes || []).find((change: unknown): boolean => {
          return (change as JSONObject)["field"] === "triggerEntityType";
        }),
      ).toEqual({ field: "triggerEntityType", newValue: "Alert" });
    });

    test("a Settings Admin reads Network's site assignment rules, and none of Runbooks' rules", async () => {
      findsOnly(NetworkSiteAssignmentRuleService, [RULE_ID]);
      findsOnly(RunbookRuleService, [RULE_ID]);

      const [siteRule, runbookRule] = await hold(
        [
          ruleUpdate(new NetworkSiteAssignmentRule()),
          ruleUpdate(new RunbookRule()),
        ],
        SETTINGS_ADMIN,
      );

      expectShownAsRecorded(
        siteRule!,
        ruleUpdate(new NetworkSiteAssignmentRule()),
      );
      expectHeldFromReader(runbookRule!, ruleUpdate(new RunbookRule()));
    });
  });
});
