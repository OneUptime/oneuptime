import { describe, expect, test } from "@jest/globals";
import { getOpenApiMetadata } from "@asteasolutions/zod-to-openapi";
import { ZodType } from "zod";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "../../../Models/DatabaseModels/StatusPageSCIM";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import ServerOwned from "../../../Types/Database/ServerOwned";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import Dictionary from "../../../Types/Dictionary";
import {
  getTerraformAttributes,
  isModelInPublicApi,
  TerraformAttributeDescriptor,
} from "../../../Utils/DeveloperDocs/TerraformSchema";
import {
  ModelSchema,
  ModelSchemaType,
} from "../../../Utils/Schema/ModelSchema";

/*
 * COLUMNS ONEUPTIME KEEPS ONCE A RECORD EXISTS (TableColumnMetadata
 * .serverOwned, #9985).
 *
 * A monitor's current status, which its checks move; when a telemetry
 * monitor was last evaluated; what a cluster's agent last counted. The
 * Terraform and Crossplane providers kept each one the way a configuration
 * said, and fought OneUptime over it: Crossplane copied a monitor's status
 * into its manifest and set it back after every check, and failed every
 * reconcile of a Metrics monitor once an evaluation moved its timestamps.
 * The model says which columns those are, and how:
 *
 *   - Always: only OneUptime writes it. No create or update schema of the
 *     spec offers it, and every schema marks it read only.
 *   - AfterCreate: a create may give the value it starts with. The create
 *     and update schemas keep it - an update through the API changes it by
 *     hand - and the providers send it to create the record only.
 *
 * This holds each declaration to its column's permissions, holds the spec
 * to the models, and catches a column a configuration can write whose name
 * says OneUptime keeps it (current...Id, last...At, a count, an agent's
 * version) and that declares nothing - the way a new model gets it wrong.
 */

type ModelType = new () => DatabaseBaseModel;

interface Column {
  table: string;
  name: string;
  modelType: ModelType;
  metadata: TableColumnMetadata;
  access: ColumnAccessControl | undefined;
}

// Every column of every model, once.
const COLUMNS: Array<Column> = (AllModelTypes as Array<ModelType>)
  .flatMap((modelType: ModelType): Array<Column> => {
    const model: DatabaseBaseModel = new modelType();
    const access: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    return Object.entries(getTableColumns(model)).map(
      ([name, metadata]: [string, TableColumnMetadata]): Column => {
        return {
          table: model.tableName || modelType.name,
          name,
          modelType,
          metadata,
          access: access[name],
        };
      },
    );
  })
  .filter((column: Column, index: number, all: Array<Column>): boolean => {
    return (
      all.findIndex((other: Column): boolean => {
        return other.table === column.table && other.name === column.name;
      }) === index
    );
  });

const DECLARED: Array<Column> = COLUMNS.filter((column: Column): boolean => {
  return column.metadata.serverOwned !== undefined;
});

function nameOf(column: Column): string {
  return `${column.table}.${column.name}`;
}

function schemaProperty(
  schema: ModelSchemaType,
  column: string,
): Record<string, unknown> | undefined {
  const shape: Record<string, ZodType> = (
    schema as unknown as { shape: Record<string, ZodType> }
  ).shape;
  const property: ZodType | undefined = shape[column];

  if (!property) {
    return undefined;
  }

  return (getOpenApiMetadata(property) || {}) as Record<string, unknown>;
}

/*
 * Writable columns named like ones OneUptime keeps, which are a person's
 * choice all the same: each with why.
 */
const CHOSEN_BY_PEOPLE: ReadonlyArray<{ column: string; why: string }> = [
  {
    column: "ScheduledMaintenance.endsAt",
    why: "When the maintenance a person schedules ends. OneUptime moves the event's state when the time comes, never the time.",
  },
  {
    column: "DetectionRuleException.endsAt",
    why: "When a person's time-window exception to a detection rule stops; OneUptime only reads it.",
  },
  {
    column: "OnCallDutyPolicyUserOverride.endsAt",
    why: "When a person's on-call override ends; OneUptime pages by it and never moves it.",
  },
  {
    column: "AlertGroupingRule.enableMinimumAlertCount",
    why: "A switch of the grouping rule: wait for this many alerts before opening an episode. A setting, not a count OneUptime keeps.",
  },
  {
    column: "AlertGroupingRule.minimumAlertCount",
    why: "How many alerts the rule waits for: a setting a person picks, not a count OneUptime keeps.",
  },
  {
    column: "IncidentGroupingRule.enableMinimumIncidentCount",
    why: "A switch of the grouping rule: wait for this many incidents before opening an episode. A setting, not a count OneUptime keeps.",
  },
  {
    column: "IncidentGroupingRule.minimumIncidentCount",
    why: "How many incidents the rule waits for: a setting a person picks, not a count OneUptime keeps.",
  },
  {
    column: "ServiceLevelObjectiveBurnRateRule.minimumSampleCount",
    why: "The fewest events a burn rate rule alerts on: a setting a person picks, not a count OneUptime keeps.",
  },
];

/*
 * Columns only OneUptime writes that a record needs, each filled in by the
 * create's own steps or on records only OneUptime makes: with where.
 */
const FILLED_IN_BY_THE_CREATE: ReadonlyArray<{ column: string; why: string }> =
  [
    {
      column: "OnCallDutyPolicyExecutionLog.status",
      why: "OnCallDutyPolicyExecutionLogService.onBeforeCreate picks Scheduled, Waiting or Error for every new execution.",
    },
    {
      column: "OnCallDutyPolicyExecutionLog.statusMessage",
      why: "OnCallDutyPolicyExecutionLogService.onBeforeCreate writes it with the status it picks.",
    },
    {
      column: "IncomingCallLogItem.status",
      why: "Only the incoming-call webhook makes these items, each one Ringing, and the call provider's dial status moves it.",
    },
    {
      column: "IncidentSla.slaStartedAt",
      why: "IncidentSlaService.onBeforeCreate starts an SLA a person adds when its incident was declared; the SLA OneUptime starts for the rule an incident matches comes started.",
    },
    {
      column: "RunbookExecution.runbookNameSnapshot",
      why: "Every run is started by OneUptime (RunbookStarter, the manual-run route), which takes the runbook's name as it is then.",
    },
    {
      column: "InventoryItem.entityKey",
      why: "InventoryItemService.onBeforeCreate computes it from the item's identifying attributes, whatever a create sent.",
    },
    {
      column: "InventoryItem.source",
      why: "InventoryItemService.onBeforeCreate sets manual for every create through the API; ingest and the mirror set their own.",
    },
    {
      column: "DatabaseServer.databaseIdentifier",
      why: "DatabaseServerService.onBeforeCreate computes it from the engine and the endpoint on every create through the API.",
    },
    {
      column: "MessageQueue.queueIdentifier",
      why: "MessageQueueService.onBeforeCreate computes it from the broker and the destination on every create through the API.",
    },
  ];

/*
 * COLUMNS PEOPLE AND ONEUPTIME BOTH CHANGE (ServerOwned.Shared, #10052),
 * each with what OneUptime changes it by. A person sets it, and the
 * providers never take OneUptime's change for one to undo: Crossplane never
 * copies one into spec.forProvider, sends a manifest's value only when it
 * changes, and holds a list to the entries the manifest declares; a
 * Terraform configuration that leaves one out keeps OneUptime's value.
 *
 * A model with label, on-call or privacy rules marks the column its rules
 * change (the tests below derive it from the rule models), so a new one
 * gets it right; the rest are named here.
 */
const SHARED_BY_RULES: ReadonlyArray<{
  // A rule model's name ends with it: MonitorLabelRule changes Monitor.labels.
  ruleSuffix: string;
  column: string;
  why: string;
}> = [
  {
    ruleSuffix: "LabelRule",
    column: "labels",
    why: "A label rule adds its labels when the record is created and when a person runs the rule (RuleAddedLabels); ingest and agents add labels from oneuptime.label.* attributes too. They never take one off.",
  },
  {
    ruleSuffix: "OnCallRule",
    column: "onCallDutyPolicies",
    why: "An on-call rule adds its policies when the record is created, and again when its severity, labels or owners change while it is open.",
  },
  {
    ruleSuffix: "PrivacyRule",
    column: "isPrivate",
    why: "A privacy rule makes the record private when it is created and when a person runs the rule.",
  },
];

const SHARED: ReadonlyArray<{ column: string; why: string }> = [
  {
    column: "Incident.postmortemNote",
    why: "The AI writes a draft postmortem when the incident is resolved and the note is still empty (IncidentPostmortemRunner).",
  },
  {
    column: "Incident.postmortemStatusId",
    why: "OneUptime moves the postmortem to Draft on its first note, the AI's included, and to Completed when it is published (IncidentService).",
  },
  {
    column: "AlertEpisode.title",
    why: "Rewritten from the episode's title template, with the alert count, each time an alert joins or leaves it (AlertEpisodeService).",
  },
  {
    column: "AlertEpisode.description",
    why: "Rewritten from the episode's description template, with the alert count, each time an alert joins or leaves it (AlertEpisodeService).",
  },
  {
    column: "AlertEpisode.alertSeverityId",
    why: "Raised by grouping when a more severe alert joins the episode (AlertEpisodeService).",
  },
  {
    column: "IncidentEpisode.title",
    why: "Rewritten from the episode's title template, with the incident count, each time an incident joins or leaves it (IncidentEpisodeService).",
  },
  {
    column: "IncidentEpisode.description",
    why: "Rewritten from the episode's description template, with the incident count, each time an incident joins or leaves it (IncidentEpisodeService).",
  },
  {
    column: "IncidentEpisode.incidentSeverityId",
    why: "Raised by grouping when a more severe incident joins the episode (IncidentEpisodeService).",
  },
  {
    column: "Alert.customFields",
    why: "A custom field mapped from the monitor's is copied into the alert when it is written, and again when the monitor's changes (CustomFieldMappingService).",
  },
  {
    column: "Incident.customFields",
    why: "A custom field mapped from the monitor's is copied into the incident when it is written, and again when the monitor's changes (CustomFieldMappingService).",
  },
  {
    column: "ScheduledMaintenance.customFields",
    why: "A custom field mapped from the monitor's is copied into the event when it is written, and again when the monitor's changes (CustomFieldMappingService).",
  },
  {
    column: "ServiceLevelObjective.monitors",
    why: "An SLO's monitor rules attach the monitors they match and detach the ones they attached, as monitors are created, changed and labelled (ServiceLevelObjectiveMonitorRuleEngineService).",
  },
  {
    column: "MetricType.description",
    why: "Overwritten whenever the telemetry that sends the metric declares another description (Telemetry ingest).",
  },
  {
    column: "MetricType.unit",
    why: "Overwritten whenever the telemetry that sends the metric declares another unit (Telemetry ingest).",
  },
  {
    column: "MetricType.services",
    why: "Ingest attaches each service that sends the metric (Telemetry ingest).",
  },
  {
    column: "Monitor.dependsOnMonitors",
    why: "A monitor made from an OpenStack template gets its parents, and is added to the parents of its existing children (OpenStackMonitorDependencies).",
  },
  {
    column: "NetworkDevice.siteId",
    why: "Site assignment rules place a device when it is created, at each poll of a device with no site, and again when its names change, which can move a device a person placed (NetworkDeviceService).",
  },
  {
    column: "NetworkDevice.macAddress",
    why: "ARP learning fills an empty MAC address and corrects one it learned itself (NetworkDeviceMacLearningUtil).",
  },
  {
    column: "NetworkEndpoint.siteId",
    why: "Each walk that moves an endpoint's attachment gives it the site of the device it is attached to (NetworkEndpointService).",
  },
  {
    column: "CloudResource.isArchived",
    why: "The stale sweep archives a resource no longer seen and restores one seen again, and a connection sync archives resources missing from a fully listed account (CloudResourceService, CloudConnectionResourceSync).",
  },
  {
    column: "DatabaseServer.isArchived",
    why: "A discovered server nobody touched is archived when it goes stale, and restored when it is seen again (DatabaseServerService).",
  },
  {
    column: "MessageQueue.isArchived",
    why: "A discovered queue nobody touched is archived when it goes stale, and restored when it is seen again (MessageQueueService).",
  },
  {
    column: "InventoryItem.isArchived",
    why: "The inventory mirror archives an item whose entity is gone, and device management archives a removed device's item and restores it when the device returns (InventoryEntityRegistry, ManagedDeviceInventory).",
  },
  {
    column: "Host.hostIdentifier",
    why: "Ingest writes the identifier in lower case when a host reports in, whatever case it was given in (HostService).",
  },
  {
    column: "DockerHost.hostIdentifier",
    why: "Ingest writes the identifier in lower case when a host reports in, whatever case it was given in (DockerHostService).",
  },
  {
    column: "PodmanHost.hostIdentifier",
    why: "Ingest writes the identifier in lower case when a host reports in, whatever case it was given in (PodmanHostService).",
  },
  {
    column: "DataStore.name",
    why: "Data security discovery writes the name it finds the store under on every run (DataSecurityDiscovery).",
  },
  {
    column: "DataStore.environment",
    why: "Data security discovery fills in the environment while it is still Unknown, the default (DataSecurityDiscovery).",
  },
  {
    column: "TelemetryException.isResolved",
    why: "Ingest reopens an exception that happens again, a merged AI fix resolves it, and the production check of a fix resolves or reopens it (Exception ingest, SyncPullRequestStates, FixProductionVerifier).",
  },
  {
    column: "TelemetryException.isArchived",
    why: "AI triage archives an exception it finds expected, when the project opted in (InsightTriageRunner).",
  },
  {
    column: "TelemetryException.resolvedInReleaseAfter",
    why: "Cleared when ingest reopens the exception (Exception ingest).",
  },
  {
    column: "Host.collectorConfigId",
    why: "The host agent's poll picks the first matching collector config again, unless the host is pinned to one (HostCollectorAgent).",
  },
  {
    column: "Host.isCollectorConfigPinned",
    why: "Cleared when the config the host is pinned to is deleted (HostCollectorAgent).",
  },
  {
    column: "KubernetesCluster.aiAccessRunnerId",
    why: "Set when the cluster's in-cluster runner registers (KubernetesClusterAiAccessService).",
  },
  {
    column: "TelemetryIngestionKey.isEnabled",
    why: "A Vercel uninstall or key rotation switches off the key OneUptime provisioned for that Vercel resource (VercelMarketplaceResources).",
  },
  {
    column: "TelemetryIngestionKey.expiresAt",
    why: "A Vercel key rotation sets when the key OneUptime provisioned for that Vercel resource stops working (VercelMarketplaceResources).",
  },
  {
    column: "DataSecurityIssue.status",
    why: "The reconciler reopens a resolved issue and an expired acceptance, and resolves an issue that no longer fails (DataSecurityIssueReconciler).",
  },
  {
    column: "DataSecurityIssue.acceptedReason",
    why: "Cleared by the reconciler when an acceptance expires and the issue reopens (DataSecurityIssueReconciler).",
  },
  {
    column: "DataSecurityIssue.acceptedUntil",
    why: "Cleared by the reconciler when an acceptance expires and the issue reopens (DataSecurityIssueReconciler).",
  },
  ...[
    "KubernetesCluster",
    "Host",
    "DockerHost",
    "PodmanHost",
    "DockerSwarmCluster",
    "ProxmoxCluster",
    "CephCluster",
    "VMwareVCenter",
    "OpenStackCloud",
    "DatabaseServer",
    "CloudAccount",
  ].flatMap((table: string): Array<{ column: string; why: string }> => {
    return [
      {
        column: `${table}.isAiInvestigationEnabled`,
        why: "The AI agent's registration and every report it sends set it: a default on its first connection, and the value its Helm chart is configured with after (ResourceAiAgentService, KubernetesAiAgentService).",
      },
      {
        column: `${table}.aiRemediationMode`,
        why: "The AI agent's registration and every report it sends set it: a default on its first connection, and the value its Helm chart is configured with after (ResourceAiAgentService, KubernetesAiAgentService).",
      },
    ];
  }),
];

/*
 * Columns OneUptime changes on its own that stay a person's alone, each
 * with why: marked shared, a configuration's value would no longer hold.
 */
const NOT_SHARED: ReadonlyArray<{ column: string; why: string }> = [
  {
    column: "Monitor.disableActiveMonitoring",
    why: "OneUptime pauses only the monitors a disabled network alert policy owns, which OneUptime made itself. A person's pause stays the person's.",
  },
  {
    column: "NetworkDevice.name",
    why: "Auto-import renames only a device discovery named; a name a person gave, a create through the API included, is never changed.",
  },
  {
    column: "DatabaseServer.name",
    why: "Discovery renames only a server that still has the name it generated.",
  },
  {
    column: "InventoryItem.displayName",
    why: "Ingest, the mirror and device management rename only the items they made, under names they generated.",
  },
  {
    column: "NetworkDevice.probeId",
    why: "A site's default probe only fills in a device that has none: a probe a person gave is never changed.",
  },
  {
    column: "NetworkDevice.snmpOids",
    why: "A poll seeds the vendor's template only into an empty list, while the device applies vendor templates.",
  },
  {
    column: "DataAsset.description",
    why: "dbt ingest only fills in an empty description.",
  },
  {
    column: "Runner.key",
    why: "A secret: only a runner OneUptime names for its cluster gets a new key when it registers, and no record of what a manifest said may hold a secret.",
  },
  {
    column: "MonitorLabelRule.isEnabled",
    why: "Every rule's switch: OneUptime switches a rule off only as a safety stop, when a delete empties a list the rule is limited to, and refuses to switch it on until the list holds a record again. A configuration that switches it on is told so, which is what it needs to hear.",
  },
];

// Names that say OneUptime keeps the value.
const KEPT_BY_ONEUPTIME_NAMES: ReadonlyArray<RegExp> = [
  /^current[A-Z]\w*Id$/,
  /^(last|next)[A-Z]\w*At$/,
  /SeenAt$/,
  /Count$/,
  /Snapshot$/,
  /^is\w*Notified/,
  /^(agentVersion|otelCollectorStatus|connectionStatus|lastAlive)$/,
  /^(endsAt|resolvedAt|completedAt|startedAt)$/,
];

describe("columns OneUptime keeps once a record exists", () => {
  test("are declared on monitors, incidents, alerts, maintenance, agents and what they report", () => {
    const always: number = DECLARED.filter((column: Column): boolean => {
      return column.metadata.serverOwned === ServerOwned.Always;
    }).length;
    const afterCreate: number = DECLARED.filter((column: Column): boolean => {
      return column.metadata.serverOwned === ServerOwned.AfterCreate;
    }).length;

    expect(always).toBeGreaterThan(200);
    expect(afterCreate).toBeGreaterThan(20);
    for (const column of DECLARED) {
      expect([nameOf(column), Object.values(ServerOwned)]).toEqual([
        nameOf(column),
        expect.arrayContaining([column.metadata.serverOwned]),
      ]);
    }
  });

  test("a monitor's status starts where a create puts it, and its telemetry evaluation times are OneUptime's", () => {
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(
      new Monitor(),
    );

    expect(columns["currentMonitorStatusId"]?.serverOwned).toBe(
      ServerOwned.AfterCreate,
    );
    expect(columns["telemetryMonitorLastMonitorAt"]?.serverOwned).toBe(
      ServerOwned.Always,
    );
    expect(columns["telemetryMonitorNextMonitorAt"]?.serverOwned).toBe(
      ServerOwned.Always,
    );
    // What a person sets is the person's.
    for (const column of ["name", "monitorType", "monitorSteps"]) {
      expect([column, columns[column]?.serverOwned]).toEqual([
        column,
        undefined,
      ]);
    }
    // Its labels are a person's and a label rule's both (#10052).
    expect(columns["labels"]?.serverOwned).toBe(ServerOwned.Shared);
  });

  /*
   * Rotating a SCIM connection's client secret sets when the new one and the
   * one it replaced stop working (ee/Server/Identity/API/
   * SCIMOAuthClientSecret.ts), for a project's connection and a status
   * page's alike.
   */
  test("a SCIM connection's client secrets expire when OneUptime says, for a project and a status page", () => {
    for (const [table, model] of [
      ["ProjectSCIM", new ProjectSCIM()],
      ["StatusPageSCIM", new StatusPageSCIM()],
    ] as Array<[string, DatabaseBaseModel]>) {
      const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

      for (const column of [
        "oauthClientSecretExpiresAt",
        "oauthPreviousClientSecretExpiresAt",
      ]) {
        expect([table, column, columns[column]?.serverOwned]).toEqual([
          table,
          column,
          ServerOwned.Always,
        ]);
      }
    }
  });

  test("one a create may start is one a create may give: it has a create list, and OneUptime does not fill it in alone", () => {
    const broken: Array<string> = [];

    for (const column of DECLARED) {
      if (column.metadata.serverOwned !== ServerOwned.AfterCreate) {
        continue;
      }
      if (!column.access?.create || column.access.create.length === 0) {
        broken.push(`${nameOf(column)}: nobody may create it - Always, then`);
      }
      if (column.metadata.computed) {
        broken.push(`${nameOf(column)}: computed, so no create gives it`);
      }
    }

    expect(broken).toEqual([]);
  });

  /*
   * No create schema offers a column only OneUptime writes, so a client
   * made from the spec never sends it: one the record needs is filled in by
   * the create's own steps, before the required columns are checked
   * (DatabaseService: onBeforeCreate runs first) - or the record is one
   * only OneUptime makes.
   */
  test("one only OneUptime writes that a record needs is filled in by the create itself", () => {
    const required: Array<string> = DECLARED.filter(
      (column: Column): boolean => {
        return (
          column.metadata.serverOwned === ServerOwned.Always &&
          Boolean(column.metadata.required) &&
          !column.metadata.isDefaultValueColumn
        );
      },
    ).map(nameOf);

    expect(required.sort()).toEqual(
      FILLED_IN_BY_THE_CREATE.map((entry: { column: string }): string => {
        return entry.column;
      }).sort(),
    );
    for (const entry of FILLED_IN_BY_THE_CREATE) {
      expect([entry.column, entry.why.length > 40]).toEqual([
        entry.column,
        true,
      ]);
    }
  });

  test("the spec says it on the column, in every schema the column is in, and leaves out of the requests what only OneUptime writes", () => {
    const broken: Array<string> = [];
    const byModel: Map<ModelType, Array<Column>> = new Map();

    for (const column of DECLARED) {
      byModel.set(column.modelType, [
        ...(byModel.get(column.modelType) || []),
        column,
      ]);
    }

    for (const [modelType, columns] of byModel) {
      const schemas: Array<[string, ModelSchemaType]> = [
        ["create", ModelSchema.getCreateModelSchema({ modelType })],
        ["update", ModelSchema.getUpdateModelSchema({ modelType })],
        ["read", ModelSchema.getReadModelSchema({ modelType })],
      ];

      for (const column of columns) {
        const kind: ServerOwned = column.metadata.serverOwned!;

        for (const [schemaType, schema] of schemas) {
          const property: Record<string, unknown> | undefined = schemaProperty(
            schema,
            column.name,
          );

          if (!property) {
            continue;
          }
          if (kind === ServerOwned.Always && schemaType !== "read") {
            broken.push(
              `${nameOf(column)} is in the ${schemaType} schema, though only OneUptime writes it`,
            );
          }
          if (property["x-oneuptime-server-owned"] !== kind) {
            broken.push(
              `${nameOf(column)}: the ${schemaType} schema says ${String(property["x-oneuptime-server-owned"])}, the model ${kind}`,
            );
          }
          if (kind === ServerOwned.Always && property["readOnly"] !== true) {
            broken.push(
              `${nameOf(column)}: the ${schemaType} schema does not mark it read only`,
            );
          }
        }

        const created: boolean = Boolean(
          schemaProperty(schemas[0]![1], column.name),
        );
        if (
          kind === ServerOwned.AfterCreate &&
          !created &&
          !column.metadata.hideColumnInDocumentation
        ) {
          broken.push(
            `${nameOf(column)} starts at create and is in no create schema`,
          );
        }
      }
    }

    expect(broken).toEqual([]);
  });

  test("the spec says it only where a model declares it", () => {
    const stray: Array<string> = [];

    for (const modelType of AllModelTypes as Array<ModelType>) {
      const model: DatabaseBaseModel = new modelType();
      const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
      const schema: ModelSchemaType = ModelSchema.getReadModelSchema({
        modelType,
      });
      const shape: Record<string, ZodType> = (
        schema as unknown as { shape: Record<string, ZodType> }
      ).shape;

      for (const column of Object.keys(shape)) {
        const said: unknown = schemaProperty(schema, column)?.[
          "x-oneuptime-server-owned"
        ];

        if (said !== columns[column]?.serverOwned) {
          stray.push(
            `${model.tableName}.${column}: the spec says ${String(said)}, the model ${String(columns[column]?.serverOwned)}`,
          );
        }
      }
    }

    expect(stray).toEqual([]);
  });

  test("a column a configuration can write, named like one OneUptime keeps, declares it or is a person's choice", () => {
    const chosen: Array<string> = CHOSEN_BY_PEOPLE.map(
      (entry: { column: string }): string => {
        return entry.column;
      },
    );
    const undeclared: Array<string> = [];
    const seen: Set<string> = new Set<string>();

    for (const modelType of AllModelTypes as Array<ModelType>) {
      if (!isModelInPublicApi(modelType)) {
        continue;
      }
      const model: DatabaseBaseModel = new modelType();

      for (const attribute of getTerraformAttributes(modelType)) {
        const key: string = `${model.tableName}.${attribute.columnName}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        const metadata: TableColumnMetadata = model.getTableColumnMetadata(
          attribute.columnName,
        );
        if (metadata?.serverOwned || chosen.includes(key)) {
          continue;
        }
        if (
          KEPT_BY_ONEUPTIME_NAMES.some((name: RegExp): boolean => {
            return name.test(attribute.columnName);
          })
        ) {
          undeclared.push(key);
        }
      }
    }

    expect(undeclared).toEqual([]);
  });

  test("each person's choice named like that is a column a configuration writes, listed once, with why", () => {
    const names: Array<string> = CHOSEN_BY_PEOPLE.map(
      (entry: { column: string }): string => {
        return entry.column;
      },
    );

    expect(new Set(names).size).toBe(names.length);
    for (const entry of CHOSEN_BY_PEOPLE) {
      const [table, columnName] = entry.column.split(".") as [string, string];
      const modelType: ModelType | undefined = (
        AllModelTypes as Array<ModelType>
      ).find((candidate: ModelType): boolean => {
        return new candidate().tableName === table;
      });
      const attribute: TerraformAttributeDescriptor | undefined = modelType
        ? getTerraformAttributes(modelType).find(
            (candidate: TerraformAttributeDescriptor): boolean => {
              return candidate.columnName === columnName;
            },
          )
        : undefined;

      expect([entry.column, Boolean(attribute), entry.why.length > 40]).toEqual(
        [entry.column, true, true],
      );
    }
  });
});

// The model of a table, by its table name.
function modelOfTable(table: string): ModelType | undefined {
  return (AllModelTypes as Array<ModelType>).find(
    (candidate: ModelType): boolean => {
      return new candidate().tableName === table;
    },
  );
}

/*
 * The columns the rules change: for each rule model whose name ends with a
 * suffix of SHARED_BY_RULES, the column of the model it is a rule of.
 */
function getSharedByRules(): Array<string> {
  const columns: Array<string> = [];

  for (const modelType of AllModelTypes as Array<ModelType>) {
    const table: string = new modelType().tableName || modelType.name;

    for (const entry of SHARED_BY_RULES) {
      if (!table.endsWith(entry.ruleSuffix)) {
        continue;
      }

      const target: string = table.slice(0, -entry.ruleSuffix.length);
      const targetType: ModelType | undefined = modelOfTable(target);

      if (targetType && getTableColumns(new targetType())[entry.column]) {
        columns.push(`${target}.${entry.column}`);
      }
    }
  }

  return Array.from(new Set(columns)).sort();
}

const SHARED_DECLARED: Array<Column> = DECLARED.filter(
  (column: Column): boolean => {
    return column.metadata.serverOwned === ServerOwned.Shared;
  },
);

describe("columns people and OneUptime both change", () => {
  test("are the ones label, on-call and privacy rules change, and the ones listed with why", () => {
    const expected: Array<string> = Array.from(
      new Set<string>([
        ...getSharedByRules(),
        ...SHARED.map((entry: { column: string }): string => {
          return entry.column;
        }),
      ]),
    ).sort();

    expect(SHARED_DECLARED.map(nameOf).sort()).toEqual(expected);
    // Every model a label rule labels, and every one an on-call or privacy rule acts on.
    expect(getSharedByRules().length).toBeGreaterThan(40);
    for (const entry of [...SHARED, ...SHARED_BY_RULES]) {
      expect([entry.column, entry.why.length > 40]).toEqual([
        entry.column,
        true,
      ]);
    }
    expect(
      new Set(
        SHARED.map((entry: { column: string }): string => {
          return entry.column;
        }),
      ).size,
    ).toBe(SHARED.length);
  });

  test("a monitor's labels and an exception's resolution are shared, and a monitor's name is not", () => {
    const monitor: Dictionary<TableColumnMetadata> = getTableColumns(
      new Monitor(),
    );

    expect(monitor["labels"]?.serverOwned).toBe(ServerOwned.Shared);
    expect(monitor["name"]?.serverOwned).toBe(undefined);
    for (const column of [
      "TelemetryException.isResolved",
      "TelemetryException.isArchived",
      "TelemetryException.resolvedInReleaseAfter",
      "NetworkDevice.siteId",
      "NetworkDevice.macAddress",
      "NetworkEndpoint.siteId",
      "Incident.postmortemNote",
      "Incident.postmortemStatusId",
      "IncidentEpisode.incidentSeverityId",
      "Alert.customFields",
    ]) {
      expect([
        column,
        SHARED_DECLARED.some((declared: Column): boolean => {
          return nameOf(declared) === column;
        }),
      ]).toEqual([column, true]);
    }
  });

  test("a person may write each one: a create or an update list, and no value OneUptime computes or keeps secret", () => {
    const broken: Array<string> = [];

    for (const column of SHARED_DECLARED) {
      const writable: boolean =
        (column.access?.create || []).length > 0 ||
        (column.access?.update || []).length > 0;

      if (!writable) {
        broken.push(`${nameOf(column)}: nobody may write it - Always, then`);
      }
      if (column.metadata.computed) {
        broken.push(`${nameOf(column)}: computed, so nobody writes it`);
      }
      /*
       * Crossplane keeps what a manifest last applied of these in an
       * annotation anyone who may read the resource reads.
       */
      if (
        column.metadata.secret ||
        column.metadata.encrypted ||
        column.metadata.hashed ||
        column.metadata.presentedKey
      ) {
        broken.push(`${nameOf(column)}: a secret`);
      }
    }

    expect(broken).toEqual([]);
  });

  test("the spec keeps each one in a request schema, for a person to write", () => {
    const missing: Array<string> = [];

    for (const column of SHARED_DECLARED) {
      if (
        column.metadata.hideColumnInDocumentation ||
        !isModelInPublicApi(column.modelType)
      ) {
        continue;
      }

      const created: boolean = Boolean(
        schemaProperty(
          ModelSchema.getCreateModelSchema({ modelType: column.modelType }),
          column.name,
        ),
      );
      const updated: boolean = Boolean(
        schemaProperty(
          ModelSchema.getUpdateModelSchema({ modelType: column.modelType }),
          column.name,
        ),
      );

      if (!created && !updated) {
        missing.push(nameOf(column));
      }
    }

    expect(missing).toEqual([]);
  });

  test("each one left a person's alone is a column OneUptime changes, listed once, with why", () => {
    const names: Array<string> = NOT_SHARED.map(
      (entry: { column: string }): string => {
        return entry.column;
      },
    );

    expect(new Set(names).size).toBe(names.length);
    for (const entry of NOT_SHARED) {
      const [table, columnName] = entry.column.split(".") as [string, string];
      const modelType: ModelType | undefined = modelOfTable(table);
      const metadata: TableColumnMetadata | undefined = modelType
        ? getTableColumns(new modelType())[columnName]
        : undefined;

      expect([
        entry.column,
        Boolean(metadata),
        metadata?.serverOwned,
        entry.why.length > 40,
      ]).toEqual([entry.column, true, undefined, true]);
    }
  });
});
