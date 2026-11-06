import { describe, expect, test } from "@jest/globals";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import MessageQueue from "../../../Models/DatabaseModels/MessageQueue";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import {
  AUDIT_LOG_EXEMPTION_KINDS,
  AUDIT_LOG_EXEMPT_TABLES,
  AUDIT_LOG_REPORTED_COLUMNS,
  AUDIT_LOG_ROOT_RESOURCE_TABLES,
  AUDIT_LOG_SECRET_COLUMNS,
  AuditLogExemptionKind,
  getAuditLogExemption,
  getDefaultAuditLogOn,
  inferResourceNameRelation,
  inferRootResource,
  looksLikeSecretColumn,
  looksLikeSecretName,
  toComparableName,
} from "../../../Types/AuditLog/AuditLogCoverage";
import { getAuditLogRedactedColumns } from "../../../Types/AuditLog/AuditLogRedaction";
import EnableAuditLogOn from "../../../Types/BaseDatabase/EnableAuditLogOn";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";

/*
 * EVERY MODEL PEOPLE CHANGE IS AUDITED, unless it is listed as exempt and
 * says why (issue #6187).
 *
 * Audit logging used to be opt-in, and most models never opted in: saving a
 * workflow in the builder, a queue's owners, a team's members recorded
 * nothing. Now a project-scoped model is audited by default
 * (Types/AuditLog/AuditLogCoverage), and this suite is what keeps it so:
 *
 *   - a project-scoped model is audited on create, update and delete, or is
 *     exempt with a kind that says why, or declares which actions it leaves
 *     out and is pinned below;
 *   - an exemption names a real project-scoped model that declares nothing,
 *     and switching audit logging off with @EnableAuditLog is refused: an
 *     exemption is made here, with its reason, or not at all;
 *   - what the defaults leave out, redact and roll up names real columns,
 *     and never what a person edits.
 *
 * A model added tomorrow is audited without anyone remembering to opt in.
 */

type ModelType = { new (): BaseModel };

const MODELS: Array<BaseModel> = (AllModelTypes as Array<ModelType>).map(
  (modelType: ModelType): BaseModel => {
    return new modelType();
  },
);

const BY_TABLE: Map<string, BaseModel> = new Map<string, BaseModel>(
  MODELS.map((model: BaseModel): [string, BaseModel] => {
    return [model.tableName as string, model];
  }),
);

const tableOf: (modelType: ModelType) => BaseModel = (
  modelType: ModelType,
): BaseModel => {
  return new modelType();
};

// What the model's own class declares with @EnableAuditLog, if anything.
const declaredOf: (model: BaseModel) => EnableAuditLogOn | undefined = (
  model: BaseModel,
): EnableAuditLogOn | undefined => {
  let prototype: object | null = Object.getPrototypeOf(model);

  while (prototype && prototype !== BaseModel.prototype) {
    const descriptor: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(prototype, "enableAuditLogOn");

    if (descriptor && "value" in descriptor) {
      return descriptor.value as EnableAuditLogOn | undefined;
    }

    prototype = Object.getPrototypeOf(prototype);
  }

  return undefined;
};

const isFullyAudited: (config: EnableAuditLogOn | undefined) => boolean = (
  config: EnableAuditLogOn | undefined,
): boolean => {
  return Boolean(config?.create && config.update && config.delete);
};

/*
 * Models whose own decorator leaves an action out, each for its own reason
 * (in its model file). A new one is a decision: it is added here.
 */
const DECLARED_PARTIALLY: Readonly<
  Record<string, { create: boolean; update: boolean; delete: boolean }>
> = {
  // Found by scans, not created by people; a person's triage is recorded.
  DataStoreFinding: { create: false, update: true, delete: true },
  // Discovered from telemetry; a person's edits and deletes are recorded.
  InventoryItem: { create: false, update: true, delete: true },
  // A grant's use is bookkeeping; connecting and revoking a client are recorded.
  McpOAuthGrant: { create: true, update: false, delete: true },
  // The probe writes a capture's progress; starting and deleting it are recorded.
  PacketCapture: { create: true, update: false, delete: true },
  // Worked out by risk scoring; a person resetting an entity's risk is recorded.
  SecurityEntityRisk: { create: false, update: false, delete: true },
};

describe("every project-scoped model is audited, or exempt with a reason", () => {
  const projectScoped: Array<BaseModel> = MODELS.filter(
    (model: BaseModel): boolean => {
      return Boolean(model.getTenantColumn());
    },
  );

  test("the sweep reads every model (it is not vacuous)", () => {
    expect(MODELS.length).toBeGreaterThan(500);
    expect(projectScoped.length).toBeGreaterThan(450);
  });

  test("none is left unaudited without being exempt or pinned", () => {
    const unaccounted: Array<string> = projectScoped
      .filter((model: BaseModel): boolean => {
        const tableName: string = model.tableName as string;

        if (getAuditLogExemption(tableName)) {
          return false;
        }

        if (DECLARED_PARTIALLY[tableName]) {
          return false;
        }

        return !isFullyAudited(model.enableAuditLogOn);
      })
      .map((model: BaseModel): string => {
        return model.tableName as string;
      });

    expect(unaccounted).toEqual([]);
  });

  test("an exempt model is not audited, and every other one is", () => {
    for (const model of projectScoped) {
      const tableName: string = model.tableName as string;
      const isExempt: boolean = Boolean(getAuditLogExemption(tableName));

      expect([tableName, Boolean(model.enableAuditLogOn)]).toEqual([
        tableName,
        !isExempt,
      ]);
    }
  });

  test("the models a declaration leaves partly audited are exactly the pinned ones, as pinned", () => {
    const partial: Record<
      string,
      { create: boolean; update: boolean; delete: boolean }
    > = {};

    for (const model of projectScoped) {
      const config: EnableAuditLogOn | undefined = model.enableAuditLogOn;

      if (config && !isFullyAudited(config)) {
        partial[model.tableName as string] = {
          create: Boolean(config.create),
          update: Boolean(config.update),
          delete: Boolean(config.delete),
        };
      }
    }

    expect(partial).toEqual(DECLARED_PARTIALLY);
  });

  test("no declaration switches audit logging off altogether: that is an exemption, with its reason", () => {
    const switchedOff: Array<string> = MODELS.filter(
      (model: BaseModel): boolean => {
        const declared: EnableAuditLogOn | undefined = declaredOf(model);

        return Boolean(
          declared && !declared.create && !declared.update && !declared.delete,
        );
      },
    ).map((model: BaseModel): string => {
      return model.tableName as string;
    });

    expect(switchedOff).toEqual([]);
  });

  test("a model with no project is not audited: there is no project audit log to file it under", () => {
    for (const model of MODELS) {
      if (model.getTenantColumn()) {
        continue;
      }

      expect([model.tableName, model.enableAuditLogOn]).toEqual([
        model.tableName,
        undefined,
      ]);
    }
  });

  test.each([
    // The issue: a workflow saved in the builder, and the Queues product.
    "Workflow",
    "WorkflowVariable",
    "WorkflowOwnerUser",
    "WorkflowOwnerTeam",
    "MessageQueue",
    "MessageQueueOwnerUser",
    "MessageQueueOwnerTeam",
    "MessageQueueOwnerRule",
    "MessageQueueLabelRule",
    // Who has access, the first thing an audit is asked.
    "TeamMember",
    "TeamPermission",
    "ApiKeyPermission",
    "CustomRolePermission",
    "ProjectSSO",
    "ProjectSCIM",
    "Project",
    // The resources whose Audit Logs pages were empty before.
    "Service",
    "Dashboard",
    "Runbook",
    "Host",
    "KubernetesCluster",
    "DockerHost",
    "MonitorGroup",
    "OnCallDutyPolicySchedule",
    "IncomingCallPolicy",
    "IncidentEpisode",
    "AlertEpisode",
    // A few of what belongs to them.
    "StatusPageDomain",
    "StatusPageResource",
    "MonitorProbe",
    "OnCallDutyPolicyEscalationRule",
    "IncidentInternalNote",
    "IncidentStateTimeline",
  ])("%s is audited on create, update and delete", (tableName: string) => {
    const model: BaseModel | undefined = BY_TABLE.get(tableName);

    expect(model).toBeDefined();
    expect(isFullyAudited(model!.enableAuditLogOn)).toBe(true);
  });

  test.each([
    // Written on every run, every message, every report.
    "WorkflowLog",
    "SmsLog",
    "EmailLog",
    "CallLog",
    "WebhookLog",
    "OnCallDutyPolicyExecutionLog",
    "UserOnCallLog",
    "KubernetesResource",
    "KubernetesContainer",
    "DockerResource",
    "TelemetryUsageBilling",
    "IncidentFeed",
    "MonitorFeed",
    "StatusPagePrivateUserSession",
    // A person's own addresses and numbers.
    "UserEmail",
    "UserSMS",
    "UserNotificationRule",
  ])("%s is exempt", (tableName: string) => {
    expect(BY_TABLE.has(tableName)).toBe(true);
    expect(getAuditLogExemption(tableName)).not.toBeNull();
    expect(BY_TABLE.get(tableName)!.enableAuditLogOn).toBeUndefined();
  });
});

describe("the exemptions", () => {
  const entries: Array<[string, AuditLogExemptionKind]> = Object.entries(
    AUDIT_LOG_EXEMPT_TABLES,
  );

  test("each names a real project-scoped model", () => {
    for (const [tableName] of entries) {
      const model: BaseModel | undefined = BY_TABLE.get(tableName);

      expect([tableName, Boolean(model)]).toEqual([tableName, true]);
      expect([tableName, Boolean(model!.getTenantColumn())]).toEqual([
        tableName,
        true,
      ]);
    }
  });

  test("none declares @EnableAuditLog: an exemption and a declaration would say two things", () => {
    for (const [tableName] of entries) {
      expect([tableName, declaredOf(BY_TABLE.get(tableName)!)]).toEqual([
        tableName,
        undefined,
      ]);
    }
  });

  test("each kind has a title and a reason a person can read, and is used", () => {
    const used: Set<AuditLogExemptionKind> = new Set<AuditLogExemptionKind>(
      Object.values(AUDIT_LOG_EXEMPT_TABLES),
    );

    for (const kind of Object.values(AuditLogExemptionKind)) {
      const description: { title: string; reason: string } =
        AUDIT_LOG_EXEMPTION_KINDS[kind];

      expect(description.title.length).toBeGreaterThan(5);
      expect(description.reason.length).toBeGreaterThan(60);
      expect(description.reason.endsWith(".")).toBe(true);
      expect(used.has(kind)).toBe(true);
    }
  });

  test("getAuditLogExemption reads only the list's own entries", () => {
    expect(getAuditLogExemption("WorkflowLog")).toBe(
      AUDIT_LOG_EXEMPTION_KINDS[AuditLogExemptionKind.RunRecord],
    );
    expect(getAuditLogExemption("Workflow")).toBeNull();
    expect(getAuditLogExemption("toString")).toBeNull();
    expect(getAuditLogExemption("constructor")).toBeNull();
    expect(getAuditLogExemption(undefined)).toBeNull();
    expect(getAuditLogExemption("")).toBeNull();
  });
});

describe("what the defaults leave out, redact and roll up", () => {
  const defaulted: Array<BaseModel> = MODELS.filter(
    (model: BaseModel): boolean => {
      return !declaredOf(model) && Boolean(model.enableAuditLogOn);
    },
  );

  test.each(
    defaulted.map((model: BaseModel): [string, BaseModel] => {
      return [model.tableName as string, model];
    }),
  )("%s: every column it names is a real column", (_name: string, model: BaseModel) => {
    const config: EnableAuditLogOn = model.enableAuditLogOn as EnableAuditLogOn;

    for (const column of [
      ...(config.ignoreColumns || []),
      ...(config.redactColumns || []),
    ]) {
      expect([column, model.isTableColumn(column)]).toEqual([column, true]);
    }

    // A column is either left out or recorded redacted, never both.
    for (const column of config.redactColumns || []) {
      expect([column, (config.ignoreColumns || []).includes(column)]).toEqual([
        column,
        false,
      ]);
    }
  });

  test.each(
    defaulted.map((model: BaseModel): [string, BaseModel] => {
      return [model.tableName as string, model];
    }),
  )(
    "%s: a root it rolls up to is an audited root, through an ObjectID column it keeps",
    (_name: string, model: BaseModel) => {
      const config: EnableAuditLogOn = model.enableAuditLogOn as EnableAuditLogOn;

      if (!config.rootResource) {
        return;
      }

      const root: BaseModel | undefined = MODELS.find(
        (candidate: BaseModel): boolean => {
          return candidate.singularName === config.rootResource!.resourceType;
        },
      );

      expect(root).toBeDefined();
      expect(AUDIT_LOG_ROOT_RESOURCE_TABLES.has(root!.tableName as string)).toBe(
        true,
      );
      expect(root!.enableAuditLogOn?.update).toBe(true);
      expect(
        model.getTableColumnMetadata(config.rootResource.column).type,
      ).toBe(TableColumnType.ObjectID);
      expect(config.ignoreColumns || []).not.toContain(
        config.rootResource.column,
      );
    },
  );

  test("every root resource is an audited model of its own, named uniquely", () => {
    const names: Array<string> = [];

    for (const tableName of AUDIT_LOG_ROOT_RESOURCE_TABLES) {
      const root: BaseModel | undefined = BY_TABLE.get(tableName);

      expect([tableName, Boolean(root)]).toEqual([tableName, true]);
      // Audited: its page lists its own entries (an inventory item's are its edits).
      expect([tableName, Boolean(root!.enableAuditLogOn?.update)]).toEqual([
        tableName,
        true,
      ]);
      // A root is its own root.
      expect(root!.enableAuditLogOn?.rootResource).toBeUndefined();
      names.push(root!.singularName as string);
    }

    expect(new Set<string>(names).size).toBe(names.length);
  });

  test.each([
    ["MessageQueueOwnerUser", "Queue", "messageQueueId"],
    ["MessageQueueOwnerTeam", "Queue", "messageQueueId"],
    ["WorkflowVariable", "Workflow", "workflowId"],
    ["WorkflowOwnerUser", "Workflow", "workflowId"],
    ["StatusPageDomain", "Status Page", "statusPageId"],
    ["MonitorProbe", "Monitor", "monitorId"],
    // The longest root wins: an episode's member belongs to the episode.
    ["IncidentEpisodeMember", "Incident Episode", "incidentEpisodeId"],
    // A state timeline belongs to its incident, not to the state.
    ["IncidentStateTimeline", "Incident", "incidentId"],
    ["MonitorStatusTimeline", "Monitor", "monitorId"],
    [
      "OnCallDutyPolicyScheduleLayerUser",
      "On-Call Policy Schedule",
      "onCallDutyPolicyScheduleId",
    ],
  ])(
    "%s rolls up to its %s through %s",
    (tableName: string, resourceType: string, column: string) => {
      expect(BY_TABLE.get(tableName)!.enableAuditLogOn?.rootResource).toEqual({
        resourceType,
        column,
      });
    },
  );

  test.each(["IncidentState", "MonitorStatus", "IncidentSeverity", "Label"])(
    "%s is a setting of the project, not a part of a resource: it has no root",
    (tableName: string) => {
      expect(BY_TABLE.get(tableName)!.enableAuditLogOn?.rootResource).toBeUndefined();
    },
  );

  test("a row with no name is named after the person, else the team, it is about", () => {
    expect(BY_TABLE.get("MessageQueueOwnerUser")!.enableAuditLogOn?.resourceNameRelation).toBe(
      "user",
    );
    expect(BY_TABLE.get("MessageQueueOwnerTeam")!.enableAuditLogOn?.resourceNameRelation).toBe(
      "team",
    );
    expect(BY_TABLE.get("TeamMember")!.enableAuditLogOn?.resourceNameRelation).toBe(
      "user",
    );
    // A row with a name of its own keeps it.
    expect(BY_TABLE.get("Workflow")!.enableAuditLogOn?.resourceNameRelation).toBeUndefined();
  });

  test("what only OneUptime writes, and what agents report, is left out", () => {
    const ignored: (tableName: string) => ReadonlyArray<string> = (
      tableName: string,
    ): ReadonlyArray<string> => {
      return BY_TABLE.get(tableName)!.enableAuditLogOn?.ignoreColumns || [];
    };

    expect(ignored("MessageQueue")).toEqual(
      expect.arrayContaining([
        "lastSeenAt",
        "brokerMetricsLastSeenAt",
        "brokerAddress",
        "archivedAt",
        "archivedByUserId",
      ]),
    );
    expect(ignored("Workflow")).toEqual(
      expect.arrayContaining([
        "lastWebhookRequestAt",
        "lastWebhookError",
        "lastWebhookErrorAt",
      ]),
    );
    expect(ignored("MonitorProbe")).toEqual(
      expect.arrayContaining(["lastPingAt", "nextPingAt", "lastMonitoringLog"]),
    );
    expect(ignored("Probe")).toEqual(expect.arrayContaining(["lastAlive"]));
    expect(ignored("Host")).toEqual(
      expect.arrayContaining(["lastSeenAt", "osVersion", "latestCpuPercent"]),
    );
    expect(ignored("TelemetryException")).toEqual(
      expect.arrayContaining(["lastSeenAt", "occuranceCount"]),
    );
  });

  test.each([
    ["Workflow", ["name", "description", "graph", "isEnabled", "labels", "isArchived"]],
    [
      "MessageQueue",
      ["name", "description", "labels", "isArchived", "messagingSystem", "destinationName"],
    ],
    ["MonitorProbe", ["isEnabled", "probeId", "monitorId"]],
    ["TeamMember", ["teamId", "userId"]],
    ["Project", ["name", "enableAuditLogs", "auditLogsRetentionInDays", "storeSystemEventsInAuditLogs", "requireSsoForLogin"]],
  ])("%s never leaves out what a person edits", (tableName: string, columns: Array<string>) => {
    const model: BaseModel = BY_TABLE.get(tableName)!;

    for (const column of columns) {
      expect([column, model.isTableColumn(column)]).toEqual([column, true]);
      expect(model.enableAuditLogOn?.ignoreColumns || []).not.toContain(column);
      expect(model.enableAuditLogOn?.redactColumns || []).not.toContain(column);
    }
  });

  test("the reported and secret lists name models audited by these defaults, and real columns", () => {
    for (const list of [AUDIT_LOG_REPORTED_COLUMNS, AUDIT_LOG_SECRET_COLUMNS]) {
      for (const [tableName, columns] of Object.entries(list)) {
        const model: BaseModel | undefined = BY_TABLE.get(tableName);

        expect([tableName, Boolean(model)]).toEqual([tableName, true]);
        expect([tableName, declaredOf(model!)]).toEqual([tableName, undefined]);
        expect([tableName, Boolean(getAuditLogExemption(tableName))]).toEqual([
          tableName,
          false,
        ]);

        for (const column of columns) {
          expect([tableName, column, model!.isTableColumn(column)]).toEqual([
            tableName,
            column,
            true,
          ]);
        }
      }
    }
  });

  test("every listed secret is recorded redacted, or left out altogether", () => {
    for (const [tableName, columns] of Object.entries(AUDIT_LOG_SECRET_COLUMNS)) {
      const model: BaseModel = BY_TABLE.get(tableName)!;
      const redacted: Set<string> = getAuditLogRedactedColumns(model);
      const ignored: ReadonlyArray<string> =
        model.enableAuditLogOn?.ignoreColumns || [];

      for (const column of columns) {
        expect([
          tableName,
          column,
          redacted.has(column) || ignored.includes(column),
        ]).toEqual([tableName, column, true]);
      }
    }

    // A secret only OneUptime writes is left out: a device's key, which it issues.
    expect(
      BY_TABLE.get("IoTDeviceCredential")!.enableAuditLogOn?.ignoreColumns,
    ).toContain("secretKey");
    // One a person sets is recorded redacted: a probe's key, an SNMP community.
    expect(
      getAuditLogRedactedColumns(BY_TABLE.get("Probe")!).has("key"),
    ).toBe(true);
    expect(
      getAuditLogRedactedColumns(BY_TABLE.get("NetworkDevice")!).has(
        "snmpCommunityString",
      ),
    ).toBe(true);
  });

  test("a model that declares @EnableAuditLog keeps exactly what it declares", () => {
    expect(tableOf(InventoryItem).enableAuditLogOn).toStrictEqual({
      create: false,
      update: true,
      delete: true,
    });
    expect(tableOf(Monitor).enableAuditLogOn).toBe(declaredOf(tableOf(Monitor)));
    expect(tableOf(Monitor).enableAuditLogOn?.ignoreColumns).toBeUndefined();
  });

  test("the defaults are worked out once, shared, and cannot be changed through what is shared", () => {
    const first: EnableAuditLogOn | undefined = tableOf(Workflow).enableAuditLogOn;

    expect(tableOf(Workflow).enableAuditLogOn).toBe(first);
    expect((Workflow.prototype as BaseModel).enableAuditLogOn).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first!.ignoreColumns)).toBe(true);
    expect((): void => {
      (first!.ignoreColumns as Array<string>).push("graph");
    }).toThrow();
  });

  test("an own value set on a model is the model's, as a plain assignment made it", () => {
    const queue: MessageQueue = new MessageQueue();
    const declared: EnableAuditLogOn = { create: false, update: true, delete: true };

    queue.enableAuditLogOn = declared;

    expect(queue.enableAuditLogOn).toBe(declared);
    // Only that instance: the class keeps its defaults.
    expect(new MessageQueue().enableAuditLogOn).not.toBe(declared);
    expect(isFullyAudited(new MessageQueue().enableAuditLogOn)).toBe(true);
  });
});

describe("the rules, one by one", () => {
  test("a name says it holds a secret by its pieces, whatever its case and separators", () => {
    expect(toComparableName("X-Api_Key.v 2")).toBe("xapikeyv2");

    for (const name of [
      "password",
      "smtpPassword",
      "SMTP_PASSWORD",
      "apiKey",
      "x-api-key",
      "accessToken",
      "clientSecret",
      "privateKey",
      "snmpV3PrivKey",
      "snmpV3AuthKey",
      "snmpCommunityString",
      "bearerToken",
      "webhookUrl",
      "subscriberWebhook",
      "connectionString",
      "Authorization",
      "credentials",
    ]) {
      expect([name, looksLikeSecretName(name)]).toEqual([name, true]);
    }

    for (const name of ["name", "description", "key", "monitorKey", "url", "graph", ""]) {
      expect([name, looksLikeSecretName(name)]).toEqual([name, false]);
    }

    // A "name" too long to be one is not read as one.
    expect(looksLikeSecretName(`password${"x".repeat(300)}`)).toBe(false);
  });

  test("a column holds a secret by its type, or by its name on a type that can", () => {
    expect(looksLikeSecretColumn("anything", TableColumnType.Password)).toBe(true);
    expect(looksLikeSecretColumn("anything", TableColumnType.OTP)).toBe(true);
    expect(looksLikeSecretColumn("anything", TableColumnType.HashedString)).toBe(
      true,
    );
    expect(looksLikeSecretColumn("secretKey", TableColumnType.ObjectID)).toBe(true);
    expect(looksLikeSecretColumn("apiKey", TableColumnType.ObjectID)).toBe(true);
    expect(looksLikeSecretColumn("apiKeyId", TableColumnType.ObjectID)).toBe(false);
    expect(looksLikeSecretColumn("isTokenSet", TableColumnType.Boolean)).toBe(false);
    expect(
      looksLikeSecretColumn("tokenExpiresAt", TableColumnType.Date),
    ).toBe(false);
    expect(looksLikeSecretColumn("tokenCount", TableColumnType.Number)).toBe(false);
    expect(looksLikeSecretColumn("apiKey", TableColumnType.Entity)).toBe(false);
    expect(looksLikeSecretColumn("bearerToken", TableColumnType.LongText)).toBe(
      true,
    );
    expect(looksLikeSecretColumn("config", TableColumnType.JSON)).toBe(false);
    expect(looksLikeSecretColumn("password", undefined)).toBe(true);
  });

  test("the defaults of a real model, column by column", () => {
    const config: EnableAuditLogOn | undefined = getDefaultAuditLogOn(
      tableOf(Workflow),
    );

    expect(config?.create).toBe(true);
    expect(config?.update).toBe(true);
    expect(config?.delete).toBe(true);
    // Its secrets: named like secrets, or stored encrypted.
    expect(config?.redactColumns).toEqual(
      expect.arrayContaining(["webhookSecretKey", "incomingEmailSecretKey"]),
    );
    // A top-level resource is its own root, and has a name of its own.
    expect(config?.rootResource).toBeUndefined();
    expect(config?.resourceNameRelation).toBeUndefined();
    // What a person edits is tracked.
    expect(config?.ignoreColumns).not.toContain("graph");
  });

  test("an exempt model, and one with no project, get no defaults", () => {
    expect(getDefaultAuditLogOn(BY_TABLE.get("WorkflowLog")!)).toBeUndefined();
    expect(getDefaultAuditLogOn(BY_TABLE.get("User")!)).toBeUndefined();
  });

  test("root and name inference read the model's relations", () => {
    expect(inferRootResource(BY_TABLE.get("WorkflowOwnerTeam")!)).toEqual({
      resourceType: "Workflow",
      column: "workflowId",
    });
    // A root is never rolled up into another root, even one its name starts with.
    expect(inferRootResource(BY_TABLE.get("OnCallDutyPolicySchedule")!)).toBeUndefined();
    expect(inferRootResource(BY_TABLE.get("Workflow")!)).toBeUndefined();
    expect(inferResourceNameRelation(BY_TABLE.get("WorkflowOwnerTeam")!)).toBe(
      "team",
    );
    expect(inferResourceNameRelation(BY_TABLE.get("Workflow")!)).toBeUndefined();
  });

  test("a column that holds a file's bytes is never recorded", () => {
    for (const model of MODELS) {
      const config: EnableAuditLogOn | undefined = model.enableAuditLogOn;

      if (!config || declaredOf(model)) {
        continue;
      }

      for (const column of model.getTableColumns().columns) {
        const metadata: TableColumnMetadata = model.getTableColumnMetadata(column);

        if (
          metadata.type === TableColumnType.Buffer ||
          metadata.type === TableColumnType.File
        ) {
          expect([model.tableName, column, config.ignoreColumns]).toEqual([
            model.tableName,
            column,
            expect.arrayContaining([column]),
          ]);
        }
      }
    }
  });
});
