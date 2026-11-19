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
      column: "IncidentSla.incidentSlaRuleId",
      why: "Only OneUptime makes an incident's SLA record, from the SLA rule that matches the incident (IncidentSlaService).",
    },
    {
      column: "IncidentSla.slaStartedAt",
      why: "Only OneUptime makes an incident's SLA record, started when the incident was declared or reopened (IncidentSlaService).",
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
    for (const column of ["name", "monitorType", "monitorSteps", "labels"]) {
      expect([column, columns[column]?.serverOwned]).toEqual([
        column,
        undefined,
      ]);
    }
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
