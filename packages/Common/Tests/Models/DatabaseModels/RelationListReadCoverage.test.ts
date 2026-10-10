import RelationListPermission, {
  CheckedRelationList,
} from "../../../Server/Types/Database/Permissions/RelationListPermission";
import RelationNames from "../../../Server/Utils/Database/RelationNames";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../../Types/Dictionary";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY LIST A WRITE MAY NAME RECORDS IN IS HELD TO THE CALLER'S READ, OR
 * NAMES RECORDS EVERY MEMBER READS.
 *
 * A create or an update that lists records - the monitors an incident
 * affects, the status pages a maintenance event shows on, the on-call
 * policies an alert pages, the runbooks a rule runs - names only records its
 * caller may read (RelationListPermission, asked by DatabaseService on every
 * create and update). This sweeps every many-to-many column a create or an
 * update may write, on every model:
 *
 *   - a list of records read one by one (labelled, owned, private, read
 *     through another record, or carrying the labels of what they name) is
 *     held to the read - every one of them, by RelationListPermission's own
 *     sweep of the model, but the parent a model is read through, which the
 *     parent rule holds;
 *   - every other list names records read as a whole table, by every member
 *     of the project. Those models are pinned below with the reason the
 *     project reference check is their answer; a new one fails this test
 *     until it is weighed and added, and one that comes to be read one by
 *     one is checked from then on and fails this test until it is removed.
 *
 * Lists of records read one by one that the rule leaves out on purpose may
 * only shrink - and there are none.
 */

type ModelType = { new (): BaseModel };

// The models a list may name without the caller's read of them, and why.
const READ_AS_A_WHOLE_TABLE: Record<string, string> = {
  Label:
    "Every member reads the project's labels; the reference check refuses another project's label like a missing one.",
  Team: "Every member reads the project's teams; the reference check refuses another project's team.",
  User: "People are held to membership of the project (ProjectScopedReferenceValidator), not to a read of the user table.",
  File: "A record points only at its own project's files (FileOwnership), checked on every create and update.",
  IncidentSeverity:
    "Severities are project settings every member reads; the reference check holds them to the project.",
  AlertSeverity:
    "Severities are project settings every member reads; the reference check holds them to the project.",
  MonitorStatus:
    "Monitor statuses are project settings every member reads; the reference check holds them to the project.",
  IncidentRole:
    "Incident roles are project settings every member reads; the reference check holds them to the project.",
};

// Lists of records read one by one the rule leaves out. May only shrink - and is empty.
const LISTS_LEFT_OUT: Array<string> = [];

interface WritableList {
  name: string;
  modelType: ModelType;
  column: string;
  listedModelType: ModelType;
}

function getWritableLists(): Array<WritableList> {
  const lists: Array<WritableList> = [];

  for (const modelType of AllModelTypes as Array<ModelType>) {
    const model: BaseModel = new modelType();
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    for (const column of Object.keys(columns)) {
      const metadata: TableColumnMetadata | undefined = columns[column];

      if (
        !metadata ||
        metadata.type !== TableColumnType.EntityArray ||
        !metadata.modelType ||
        column === model.canAccessIfCanReadOn
      ) {
        continue;
      }

      const isWritable: boolean =
        (accessControl[column]?.create || []).length > 0 ||
        (accessControl[column]?.update || []).length > 0;

      if (!isWritable) {
        continue;
      }

      lists.push({
        name: `${model.tableName}.${column}`,
        modelType: modelType,
        column: column,
        listedModelType: metadata.modelType as ModelType,
      });
    }
  }

  return lists;
}

const WRITABLE_LISTS: Array<WritableList> = getWritableLists();

const isChecked: (list: WritableList) => boolean = (
  list: WritableList,
): boolean => {
  return RelationListPermission.getCheckedLists(list.modelType).some(
    (checked: CheckedRelationList): boolean => {
      return checked.column === list.column;
    },
  );
};

describe("every list a write may name records in", () => {
  test("the sweep covers the lists a write may name records in", () => {
    expect(WRITABLE_LISTS.length).toBeGreaterThan(300);
  });

  test("a list of records read one by one is held to the caller's read", () => {
    const unchecked: Array<string> = WRITABLE_LISTS.filter(
      (list: WritableList): boolean => {
        return (
          RelationListPermission.isReadPerRecord(list.listedModelType) &&
          !isChecked(list)
        );
      },
    ).map((list: WritableList): string => {
      return list.name;
    });

    expect(unchecked.sort()).toEqual([...LISTS_LEFT_OUT].sort());
  });

  test("every other list names records every member reads, for the reason given", () => {
    const tables: Set<string> = new Set<string>();

    for (const list of WRITABLE_LISTS) {
      if (isChecked(list)) {
        continue;
      }

      tables.add(new list.listedModelType().tableName || "");
    }

    expect(Array.from(tables).sort()).toEqual(
      Object.keys(READ_AS_A_WHOLE_TABLE).sort(),
    );
  });

  test("a model read as a whole table is not one read one by one", () => {
    for (const list of WRITABLE_LISTS) {
      const table: string = new list.listedModelType().tableName || "";

      if (READ_AS_A_WHOLE_TABLE[table]) {
        expect([list.name, isChecked(list)]).toEqual([list.name, false]);
      }
    }
  });

  test.each([
    ["Incident", "monitors"],
    ["Incident", "statusPages"],
    ["Incident", "onCallDutyPolicies"],
    ["Alert", "onCallDutyPolicies"],
    ["Alert", "services"],
    ["ScheduledMaintenance", "monitors"],
    ["ScheduledMaintenance", "statusPages"],
    ["StatusPageAnnouncement", "monitors"],
    ["IncidentTemplate", "monitors"],
    ["ScheduledMaintenanceTemplate", "statusPages"],
    ["IncidentGroupingRule", "onCallDutyPolicies"],
    ["RunbookRule", "runbooks"],
    ["MonitorSecret", "monitors"],
    ["StatusPageSubscriber", "statusPageResources"],
  ])(
    "%s.%s is held to the read of what it lists",
    (table: string, column: string) => {
      const list: WritableList | undefined = WRITABLE_LISTS.find(
        (each: WritableList): boolean => {
          return each.name === `${table}.${column}`;
        },
      );

      expect(list).toBeDefined();
      expect(isChecked(list!)).toBe(true);
    },
  );

  test("the parent a model is read through, through a list, is the parent rule's", () => {
    expect(
      RelationListPermission.getCheckedLists(
        (AllModelTypes as Array<ModelType>).find((modelType: ModelType) => {
          return new modelType().tableName === "StatusPageAnnouncement";
        })!,
      ).map((list: CheckedRelationList): string => {
        return list.column;
      }),
    ).not.toContain("statusPages");
  });
});

/*
 * DatabaseService asks the rule on every create and update, before the
 * write's hooks run.
 */
describe("the shared paths ask it", () => {
  const source: string = fs.readFileSync(
    path.resolve(__dirname, "../../../Server/Services/DatabaseService.ts"),
    "utf8",
  );

  const bodyOf: (signature: string) => string = (signature: string): string => {
    const start: number = source.indexOf(signature);
    expect(start).toBeGreaterThan(-1);
    return source.slice(start, start + 20000);
  };

  test("a create asks before its hooks", () => {
    const create: string = bodyOf(
      "private async _create(\n    createBy: CreateBy<TBaseModel>,",
    );

    const checks: number = create.indexOf(
      "await this.checkCreateBeforeHooks(createBy)",
    );
    const hooks: number = create.indexOf(
      "await this._onBeforeCreate(createBy)",
    );

    expect(checks).toBeGreaterThan(-1);
    expect(hooks).toBeGreaterThan(checks);

    // The checks before the hooks, shared with checkCallerMayCreate.
    const beforeHooks: string = bodyOf("private async checkCreateBeforeHooks(");

    expect(beforeHooks).toContain("await this.checkNamedLists({");
  });

  test("an update asks before its hooks, with what each row lists already", () => {
    const update: string = bodyOf(
      "private async _updateBy(updateBy: UpdateBy<TBaseModel>): Promise<number> {",
    );

    const named: number = update.indexOf("await this.checkUpdateNamedRecords(");
    const hooks: number = update.indexOf("await this.onBeforeUpdate(updateBy)");

    expect(named).toBeGreaterThan(-1);
    expect(hooks).toBeGreaterThan(named);

    const helper: string = bodyOf("private async checkUpdateNamedRecords(");

    expect(helper).toContain("heldIdsByColumn");
    expect(helper).toContain("await this.checkNamedLists({");
  });
});

/*
 * THE ONE RECORD A WRITE NAMES IN A FIELD OF ITS OWN IS HELD TO THE
 * CALLER'S READ TOO, OR IS A RECORD EVERY MEMBER READS.
 *
 * An alert's monitor, a status page resource's monitor, a cost budget's
 * service, a run's incident: a create or an update that names one record in
 * a field of its own, under either of the reference's names, names only a
 * record its caller may read (RelationListPermission.getCheckedReferences,
 * asked in the same shared path as the lists). This sweeps every single
 * reference a create or an update may write, on every model - but the
 * project, which the tenant check holds, and the parent a model is read
 * through, which the parent rule holds:
 *
 *   - a reference to a record read one by one is held to the read;
 *   - every other reference names records read as a whole table. Those
 *     models are pinned below with the reason the project reference check
 *     (or the check named) is their answer; a new one fails this test until
 *     it is weighed and added, and one that comes to be read one by one is
 *     checked from then on and fails this test until it is removed.
 *
 * References to records read one by one that the rule leaves out on purpose
 * may only shrink - and there are none.
 */

const PROJECT_SETTING: string =
  "A project setting read as a whole table: no label, owner or parent narrows a read of it, so a read reaches every one of the project's records or none of them, and the reference check holds the record named to the project.";

const NOTIFICATION_METHOD: string =
  "A person's own notification method: a notification rule names only methods of the person it belongs to (UserNotificationRuleService's method-ownership check), whatever a read of the table reaches.";

// The models a single reference may name without the caller's read of them, and why.
const REFERENCED_AS_A_WHOLE_TABLE: Record<string, string> = {
  User: "People are held to membership of the project (ProjectScopedReferenceValidator), not to a read of the user table.",
  Team: "Every member reads the project's teams; the reference check refuses another project's team.",
  File: "A record points only at its own project's files (FileOwnership), checked on every create and update.",
  AlertSeverity: PROJECT_SETTING,
  IncidentSeverity: PROJECT_SETTING,
  AlertState: PROJECT_SETTING,
  IncidentState: PROJECT_SETTING,
  ScheduledMaintenanceState: PROJECT_SETTING,
  MonitorStatus: PROJECT_SETTING,
  IncidentRole: PROJECT_SETTING,
  AlertGroupingRule: PROJECT_SETTING,
  IncidentGroupingRule: PROJECT_SETTING,
  IncidentSlaRule: PROJECT_SETTING,
  LogPipeline: PROJECT_SETTING,
  TracePipeline: PROJECT_SETTING,
  NetworkDeviceOidTemplate: PROJECT_SETTING,
  NetworkDeviceRole: PROJECT_SETTING,
  NetworkSiteType: PROJECT_SETTING,
  StatusPageSubscriberNotificationTemplate: PROJECT_SETTING,
  Domain: PROJECT_SETTING,
  UserCall: NOTIFICATION_METHOD,
  UserEmail: NOTIFICATION_METHOD,
  UserMicrosoftTeams: NOTIFICATION_METHOD,
  UserPush: NOTIFICATION_METHOD,
  UserSMS: NOTIFICATION_METHOD,
  UserSlack: NOTIFICATION_METHOD,
  UserTelegram: NOTIFICATION_METHOD,
  UserWebhook: NOTIFICATION_METHOD,
  UserWhatsApp: NOTIFICATION_METHOD,
};

// References to records read one by one the rule leaves out. May only shrink - and is empty.
const REFERENCES_LEFT_OUT: Array<string> = [];

/*
 * The settings that hold credentials OneUptime uses for the record that
 * names them. They are read as a whole table too, but a write names one of
 * them only when its caller may read that table
 * (RelationListPermission.isHeldToTableRead): a caller who may not read the
 * project's SMTP servers does not choose the one a status page sends with.
 * Each with the credentials it holds and the records that name it.
 */
const CREDENTIAL_SETTINGS: Record<string, string> = {
  ProjectSMTPConfig:
    "An SMTP server's login: a status page that names one sends its subscribers' email through it.",
  ProjectCallSMSConfig:
    "A call and SMS provider's account token: a status page or an incoming call policy that names one calls and texts through it.",
  RunbookCredential:
    "SSH keys and Kubernetes service account tokens: a cluster that names one lets OneUptime AI reach the cluster with it.",
  NetworkSnmpCredentialProfile:
    "SNMP community strings and keys: a network device or site that names one is polled with them.",
  VideoCallConnection:
    "A video call provider's authorization: an incident or alert video call that names one starts its meeting through it.",
  ApiKey:
    "An API key is itself a credential: a permission row that names one grants that key what it lists.",
};

// The references to them, each held to the read of the table it names.
const CREDENTIAL_REFERENCES: Array<[string, string, string]> = [
  ["StatusPage", "smtpConfig", "ProjectSMTPConfig"],
  ["StatusPage", "callSmsConfig", "ProjectCallSMSConfig"],
  ["IncomingCallPolicy", "projectCallSMSConfig", "ProjectCallSMSConfig"],
  ["KubernetesCluster", "aiAccessCredential", "RunbookCredential"],
  ["NetworkDevice", "snmpCredentialProfile", "NetworkSnmpCredentialProfile"],
  ["NetworkSite", "snmpCredentialProfile", "NetworkSnmpCredentialProfile"],
  ["IncidentVideoCall", "videoCallConnection", "VideoCallConnection"],
  ["AlertVideoCall", "videoCallConnection", "VideoCallConnection"],
  ["ApiKeyPermission", "apiKey", "ApiKey"],
];

/*
 * Models that hold a secret - an encrypted or a hashed column - that a write
 * may name and that are neither read one by one nor one of the settings
 * above, and why. May only shrink.
 */
const SECRETS_NAMED_WITHOUT_A_READ: Record<string, string> = {
  User: "People are held to membership of the project; their password is never read back by anyone.",
};

interface WritableReference {
  name: string;
  modelType: ModelType;
  relation: string;
  idColumn: string;
  referencedModelType: ModelType;
}

function getWritableReferences(): Array<WritableReference> {
  const references: Array<WritableReference> = [];

  for (const modelType of AllModelTypes as Array<ModelType>) {
    const model: BaseModel = new modelType();
    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    const isWritable: (column: string) => boolean = (
      column: string,
    ): boolean => {
      return (
        (accessControl[column]?.create || []).length > 0 ||
        (accessControl[column]?.update || []).length > 0
      );
    };

    for (const reference of RelationNames.getSingleRelations(model)) {
      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(reference.relation);

      if (
        !metadata?.modelType ||
        reference.relation === model.canAccessIfCanReadOn ||
        !(isWritable(reference.relation) || isWritable(reference.idColumn))
      ) {
        continue;
      }

      references.push({
        name: `${model.tableName}.${reference.relation}`,
        modelType: modelType,
        relation: reference.relation,
        idColumn: reference.idColumn,
        referencedModelType: metadata.modelType as ModelType,
      });
    }
  }

  return references;
}

const WRITABLE_REFERENCES: Array<WritableReference> = getWritableReferences();

const isReferenceChecked: (reference: WritableReference) => boolean = (
  reference: WritableReference,
): boolean => {
  return RelationListPermission.getCheckedReferences(reference.modelType).some(
    (checked: CheckedRelationList): boolean => {
      return (
        checked.column === reference.relation &&
        checked.idColumn === reference.idColumn
      );
    },
  );
};

const modelNamed: (table: string) => ModelType = (table: string): ModelType => {
  const found: ModelType | undefined = (AllModelTypes as Array<ModelType>).find(
    (modelType: ModelType): boolean => {
      return new modelType().tableName === table;
    },
  );

  expect(found).toBeDefined();

  return found!;
};

describe("every single reference a write may name a record in", () => {
  test("the sweep covers the references a write may name a record in", () => {
    /*
     * The resource an owner row names is the record it is read through
     * (OwnerTablesReadThroughResource.test.ts), so the parent rule holds it
     * and it is not swept here.
     */
    expect(WRITABLE_REFERENCES.length).toBeGreaterThan(250);
  });

  test("a reference to records read one by one is held to the caller's read", () => {
    const unchecked: Array<string> = WRITABLE_REFERENCES.filter(
      (reference: WritableReference): boolean => {
        return (
          RelationListPermission.isReadPerRecord(
            reference.referencedModelType,
          ) && !isReferenceChecked(reference)
        );
      },
    ).map((reference: WritableReference): string => {
      return reference.name;
    });

    expect(unchecked.sort()).toEqual([...REFERENCES_LEFT_OUT].sort());
  });

  test("every other reference names records read as a whole table, for the reason given", () => {
    const tables: Set<string> = new Set<string>();

    for (const reference of WRITABLE_REFERENCES) {
      if (isReferenceChecked(reference)) {
        continue;
      }

      tables.add(new reference.referencedModelType().tableName || "");
    }

    expect(Array.from(tables).sort()).toEqual(
      Object.keys(REFERENCED_AS_A_WHOLE_TABLE).sort(),
    );
  });

  test("a model read as a whole table is not one read one by one", () => {
    for (const table of Object.keys(REFERENCED_AS_A_WHOLE_TABLE)) {
      expect([
        table,
        RelationListPermission.isReadPerRecord(modelNamed(table)),
      ]).toEqual([table, false]);
    }
  });

  test("every reason is given", () => {
    for (const table of Object.keys(REFERENCED_AS_A_WHOLE_TABLE)) {
      expect(REFERENCED_AS_A_WHOLE_TABLE[table]!.length).toBeGreaterThan(40);
    }
  });

  test.each([
    ["Alert", "monitor"],
    ["StatusPageResource", "monitor"],
    ["StatusPageResource", "monitorGroup"],
    ["MonitorGroupResource", "monitor"],
    ["NetworkDevice", "monitor"],
    ["NetworkSiteLink", "monitor"],
    ["NetworkDeviceLink", "monitor"],
    ["RunbookExecution", "runbook"],
    ["RunbookExecution", "incident"],
    ["RunbookExecution", "alert"],
    ["RunbookExecution", "scheduledMaintenance"],
    ["RumSessionPin", "incident"],
    ["RumSessionPin", "alert"],
    ["LlmCostBudget", "service"],
    ["ProxmoxCluster", "cephCluster"],
    ["IncomingCallPolicyEscalationRule", "incomingCallPolicy"],
    ["MonitorProbe", "probe"],
  ])(
    "%s.%s is held to the read of the record it names, under both of its names",
    (table: string, relation: string) => {
      const reference: WritableReference | undefined = WRITABLE_REFERENCES.find(
        (each: WritableReference): boolean => {
          return each.name === `${table}.${relation}`;
        },
      );

      expect(reference).toBeDefined();
      expect(reference!.idColumn).toBe(`${relation}Id`);
      expect(isReferenceChecked(reference!)).toBe(true);
    },
  );

  test.each([
    ["MonitorOwnerUser", "monitor"],
    ["MonitorOwnerTeam", "monitor"],
    ["IncidentOwnerUser", "incident"],
    ["IncidentOwnerTeam", "incident"],
    ["AlertOwnerUser", "alert"],
    ["AlertOwnerTeam", "alert"],
    ["ScheduledMaintenanceOwnerUser", "scheduledMaintenance"],
    ["ScheduledMaintenanceOwnerTeam", "scheduledMaintenance"],
    ["IncidentTemplateOwnerUser", "incidentTemplate"],
    ["IncidentTemplateOwnerTeam", "incidentTemplate"],
    ["ScheduledMaintenanceTemplateOwnerUser", "scheduledMaintenanceTemplate"],
    ["ScheduledMaintenanceTemplateOwnerTeam", "scheduledMaintenanceTemplate"],
    // Every other owner table too (OwnerTablesReadThroughResource.test.ts).
    ["HostOwnerUser", "host"],
    ["KubernetesClusterOwnerTeam", "kubernetesCluster"],
    ["OnCallDutyPolicyOwnerUser", "onCallDutyPolicy"],
    ["OnCallDutyPolicyScheduleOwnerTeam", "onCallDutyPolicySchedule"],
    ["IncomingCallPolicyOwnerUser", "incomingCallPolicy"],
    ["DashboardOwnerTeam", "dashboard"],
    ["ProbeOwnerUser", "probe"],
    ["AIAgentOwnerTeam", "aiAgent"],
    ["IncidentEpisodeOwnerUser", "incidentEpisode"],
    ["WorkflowOwnerTeam", "workflow"],
  ])(
    "the owners in %s are read through the %s they own, as the parent rule holds them",
    (table: string, parent: string) => {
      const modelType: ModelType = modelNamed(table);

      expect(new modelType().canAccessIfCanReadOn).toBe(parent);
      expect(
        WRITABLE_REFERENCES.some((reference: WritableReference): boolean => {
          return reference.name === `${table}.${parent}`;
        }),
      ).toBe(false);
    },
  );
});

describe("a setting that holds credentials is named only by a caller who may read it", () => {
  test("the settings held to their table's read are the ones pinned here, each for the reason given", () => {
    expect(
      [...RelationListPermission.getCredentialSettingsTables()].sort(),
    ).toEqual(Object.keys(CREDENTIAL_SETTINGS).sort());

    for (const reason of Object.values(CREDENTIAL_SETTINGS)) {
      expect(reason.length).toBeGreaterThan(40);
    }
  });

  test.each(Object.keys(CREDENTIAL_SETTINGS))(
    "%s is read as a whole table, and held to that table's read",
    (table: string) => {
      const modelType: ModelType = modelNamed(table);

      expect(RelationListPermission.isReadPerRecord(modelType)).toBe(false);
      expect(RelationListPermission.isHeldToTableRead(modelType)).toBe(true);
      expect(RelationListPermission.isNamedOnlyWhenRead(modelType)).toBe(true);
    },
  );

  test.each(CREDENTIAL_REFERENCES)(
    "%s.%s is held to the read of %s, under both of its names",
    (table: string, relation: string, credentialTable: string) => {
      const reference: WritableReference | undefined = WRITABLE_REFERENCES.find(
        (each: WritableReference): boolean => {
          return each.name === `${table}.${relation}`;
        },
      );

      expect(reference).toBeDefined();
      expect(new reference!.referencedModelType().tableName).toBe(
        credentialTable,
      );
      expect(isReferenceChecked(reference!)).toBe(true);
    },
  );

  test("every reference a write may make to one of them is held to the read", () => {
    const references: Array<string> = WRITABLE_REFERENCES.filter(
      (reference: WritableReference): boolean => {
        return Boolean(
          CREDENTIAL_SETTINGS[
            new reference.referencedModelType().tableName || ""
          ],
        );
      },
    ).map((reference: WritableReference): string => {
      return reference.name;
    });

    expect(references.sort()).toEqual(
      CREDENTIAL_REFERENCES.map(
        ([table, relation]: [string, string, string]): string => {
          return `${table}.${relation}`;
        },
      ).sort(),
    );
  });

  test("a model that holds a secret is named only when read, or for the reason given", () => {
    const holdsSecret: (modelType: ModelType) => boolean = (
      modelType: ModelType,
    ): boolean => {
      const columns: Dictionary<TableColumnMetadata> = getTableColumns(
        new modelType(),
      );

      return Object.values(columns).some(
        (column: TableColumnMetadata): boolean => {
          return Boolean(column.encrypted || column.hashed);
        },
      );
    };

    const namedWithoutRead: Set<string> = new Set<string>();

    for (const reference of WRITABLE_REFERENCES) {
      if (
        holdsSecret(reference.referencedModelType) &&
        !RelationListPermission.isNamedOnlyWhenRead(
          reference.referencedModelType,
        )
      ) {
        namedWithoutRead.add(
          new reference.referencedModelType().tableName || "",
        );
      }
    }

    for (const list of WRITABLE_LISTS) {
      if (
        holdsSecret(list.listedModelType) &&
        !RelationListPermission.isNamedOnlyWhenRead(list.listedModelType)
      ) {
        namedWithoutRead.add(new list.listedModelType().tableName || "");
      }
    }

    expect(Array.from(namedWithoutRead).sort()).toEqual(
      Object.keys(SECRETS_NAMED_WITHOUT_A_READ).sort(),
    );
  });
});

/*
 * DatabaseService asks again once a create's or an update's hooks have run,
 * on the records a hook named besides what the caller sent (a template's
 * monitors and status pages), before anything is written; and an incident
 * declared from a template asks before it takes its number.
 */
describe("the records a hook names are asked about too", () => {
  const read: (relative: string) => string = (relative: string): string => {
    return fs.readFileSync(path.resolve(__dirname, relative), "utf8");
  };

  const databaseService: string = read(
    "../../../Server/Services/DatabaseService.ts",
  );

  const bodyOf: (source: string, signature: string) => string = (
    source: string,
    signature: string,
  ): string => {
    const start: number = source.indexOf(signature);
    expect(start).toBeGreaterThan(-1);
    return source.slice(start, start + 20000);
  };

  test("a create asks after its hooks about what they named besides, before its scope and its save", () => {
    const create: string = bodyOf(
      databaseService,
      "private async _create(\n    createBy: CreateBy<TBaseModel>,",
    );

    const hooks: number = create.indexOf(
      "await this._onBeforeCreate(createBy)",
    );
    const onRecord: number = create.indexOf(
      "await this.checkCreatePermissionsOnRecord({",
    );
    const save: number = create.indexOf(
      "await this.getRepository().save(createBy.data)",
    );

    expect(hooks).toBeGreaterThan(-1);
    expect(onRecord).toBeGreaterThan(hooks);
    expect(save).toBeGreaterThan(onRecord);

    // The permission checks on the record as written, shared with checkCallerMayCreate.
    const permissions: string = bodyOf(
      databaseService,
      "private async checkCreatePermissionsOnRecord(",
    );
    const after: number = permissions.indexOf(
      "askedIds: DatabaseService.namedIdsAskedOn.get(data.createBy) || {},",
    );
    const scope: number = permissions.indexOf("await this.checkCreateScope({");

    expect(after).toBeGreaterThan(-1);
    expect(scope).toBeGreaterThan(after);
  });

  test("an update asks after its hooks, before it writes", () => {
    const update: string = bodyOf(
      databaseService,
      "private async _updateBy(updateBy: UpdateBy<TBaseModel>): Promise<number> {",
    );

    const hooks: number = update.indexOf("await this.onBeforeUpdate(updateBy)");
    const after: number = update.indexOf(
      "await this.checkUpdateNamedRecordsAfterHooks(",
    );

    expect(hooks).toBeGreaterThan(-1);
    expect(after).toBeGreaterThan(hooks);
  });

  test("an incident declared from a template asks before it takes its number", () => {
    const incidentService: string = read(
      "../../../Server/Services/IncidentService.ts",
    );

    const start: number = incidentService.indexOf(
      "protected override async onBeforeCreate(",
    );
    expect(start).toBeGreaterThan(-1);

    // The whole hook, up to the next method of the service.
    const end: number = incidentService.indexOf(
      "\n  protected override async ",
      start + 1,
    );
    const hook: string = incidentService.slice(
      start,
      end > start ? end : undefined,
    );

    const asks: number = hook.indexOf(
      "await this.checkRecordsNamedSoFar(createBy);",
    );
    const number: number = hook.indexOf(
      "ProjectService.incrementAndGetIncidentCounter(",
    );

    expect(asks).toBeGreaterThan(-1);
    expect(number).toBeGreaterThan(asks);
  });
});

/*
 * What a hook fills in from a record the write names - as that record holds
 * it - is the service's to answer for, not asked about after the hooks as
 * the caller's own naming (DatabaseService
 * .getReferencesFilledFromNamedRecords). Only the services below say so, for
 * the reason given; this list only shrinks. A template's records are never
 * among them: what a template fills in is asked about as the caller's.
 */
const FILLED_FROM_NAMED_RECORDS: Dictionary<Dictionary<string>> = {
  NetworkDeviceService: {
    probe:
      "a device put in a site with no probe of its own takes the site's default probe, set on the site by someone allowed to",
  },
  NetworkDeviceDiagnosticService: {
    probe:
      "a diagnostic its caller names no probe for runs on the probe of the device it names",
  },
};

describe("what a hook fills in from a record the write names", () => {
  const servicesDirectory: string = path.resolve(
    __dirname,
    "../../../Server/Services",
  );

  const SIGNATURE: string =
    "protected override getReferencesFilledFromNamedRecords(): Array<string> {";

  // Each service that says its hooks fill something in, and what.
  const declared: Dictionary<Array<string>> = {};

  for (const file of fs.readdirSync(servicesDirectory)) {
    if (!file.endsWith(".ts")) {
      continue;
    }

    const source: string = fs.readFileSync(
      path.join(servicesDirectory, file),
      "utf8",
    );
    const start: number = source.indexOf(SIGNATURE);

    if (start < 0) {
      continue;
    }

    const body: string = source.slice(
      start,
      source.indexOf("\n  }", start) + 1,
    );
    const returned: RegExpMatchArray | null =
      body.match(/return \[([^\]]*)\];/);

    declared[file.replace(/\.ts$/, "")] = (returned?.[1] || "")
      .split(",")
      .map((entry: string): string => {
        return entry.trim().replace(/^"|"$/g, "");
      })
      .filter((entry: string): boolean => {
        return entry.length > 0;
      });
  }

  test("only the services listed say so, each for the references listed", () => {
    expect(
      Object.fromEntries(
        Object.entries(declared).map(
          ([service, columns]: [string, Array<string>]): [
            string,
            Array<string>,
          ] => {
            return [service, [...columns].sort()];
          },
        ),
      ),
    ).toEqual(
      Object.fromEntries(
        Object.entries(FILLED_FROM_NAMED_RECORDS).map(
          ([service, columns]: [string, Dictionary<string>]): [
            string,
            Array<string>,
          ] => {
            return [service, Object.keys(columns).sort()];
          },
        ),
      ),
    );
  });

  test("every reason is given", () => {
    for (const columns of Object.values(FILLED_FROM_NAMED_RECORDS)) {
      for (const reason of Object.values(columns)) {
        expect(reason.length).toBeGreaterThan(20);
      }
    }
  });

  test("the incident service, which fills records in from templates, is not among them", () => {
    expect(declared["IncidentService"]).toBeUndefined();
  });
});
