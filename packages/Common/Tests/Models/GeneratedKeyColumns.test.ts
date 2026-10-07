import { describe, expect, test } from "@jest/globals";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import AlertMeasurement from "../../Models/DatabaseModels/AlertMeasurement";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentMeasurement from "../../Models/DatabaseModels/IncidentMeasurement";
import LogRecordingRule from "../../Models/DatabaseModels/LogRecordingRule";
import MetricRecordingRule from "../../Models/DatabaseModels/MetricRecordingRule";
import ScheduledMaintenanceMeasurement from "../../Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import TraceRecordingRule from "../../Models/DatabaseModels/TraceRecordingRule";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import { JSONObject } from "../../Types/JSON";
import { ModelSchema } from "../../Utils/Schema/ModelSchema";

/*
 * Columns whose value the server makes from the record's name when a create
 * leaves it out (a measurement's key, a recording rule's output metric
 * name). For each, the API, the MCP tools and the Terraform provider - all
 * generated from this metadata - must not ask for it:
 *
 *   - not required, and not among the create schema's required properties,
 *     while still writable on create for whoever wants a particular value;
 *   - still never empty in the database: the column stays NOT NULL, because
 *     the server always fills it.
 *
 * A measurement's key stays immutable after create (no update access): it
 * is part of the metric name every point is written under. A recording
 * rule's output metric can still be renamed.
 */

type ModelType = { new (): BaseModel };

interface GeneratedColumn {
  model: ModelType;
  column: string;
  canChangeAfterCreate: boolean;
}

const GENERATED_COLUMNS: Array<GeneratedColumn> = [
  { model: IncidentMeasurement, column: "key", canChangeAfterCreate: false },
  { model: AlertMeasurement, column: "key", canChangeAfterCreate: false },
  {
    model: ScheduledMaintenanceMeasurement,
    column: "key",
    canChangeAfterCreate: false,
  },
  {
    model: MetricRecordingRule,
    column: "outputMetricName",
    canChangeAfterCreate: true,
  },
  {
    model: TraceRecordingRule,
    column: "outputMetricName",
    canChangeAfterCreate: true,
  },
  {
    model: LogRecordingRule,
    column: "outputMetricName",
    canChangeAfterCreate: true,
  },
];

const createSchemaOf: (modelType: ModelType) => JSONObject = (
  modelType: ModelType,
): JSONObject => {
  const registry: OpenAPIRegistry = new OpenAPIRegistry();

  registry.register(
    "Schema",
    ModelSchema.getCreateModelSchema({ modelType: modelType }),
  );

  const document: JSONObject = new OpenApiGeneratorV3(
    registry.definitions,
  ).generateComponents() as unknown as JSONObject;

  return ((document["components"] as JSONObject)["schemas"] as JSONObject)[
    "Schema"
  ] as JSONObject;
};

const labelOf: (entry: GeneratedColumn) => string = (
  entry: GeneratedColumn,
): string => {
  return `${entry.model.name}.${entry.column}`;
};

describe.each(
  GENERATED_COLUMNS.map((entry: GeneratedColumn) => {
    return { ...entry, label: labelOf(entry) };
  }),
)("$label", (entry: GeneratedColumn & { label: string }) => {
  const model: BaseModel = new entry.model();

  test("is not required to create a record", () => {
    expect(model.getTableColumnMetadata(entry.column).required).toBe(false);
    expect(model.getRequiredColumns().columns).not.toContain(entry.column);
  });

  test("is writable on create, but not among the create schema's required properties", () => {
    const schema: JSONObject = createSchemaOf(entry.model);
    const required: Array<string> =
      (schema["required"] as Array<string> | undefined) || [];
    const properties: JSONObject = (schema["properties"] as JSONObject) || {};

    expect(Object.keys(properties)).toContain(entry.column);
    expect(required).not.toContain(entry.column);
  });

  test("tells API readers that it is made from the name when left out", () => {
    expect(model.getTableColumnMetadata(entry.column).description).toMatch(
      /Leave it out and it is made from the/,
    );
  });

  test("is still never empty in the database", () => {
    const column: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find((args: ColumnMetadataArgs) => {
        return (
          args.target === entry.model && args.propertyName === entry.column
        );
      });

    expect(column).toBeDefined();
    expect(column!.options.nullable).toBe(false);
  });

  test(
    entry.canChangeAfterCreate
      ? "can be changed after create"
      : "can never be changed after create",
    () => {
      const access: ColumnAccessControl | null =
        model.getColumnAccessControlFor(entry.column);

      expect(access).not.toBeNull();
      expect((access!.create || []).length).toBeGreaterThan(0);

      if (entry.canChangeAfterCreate) {
        expect((access!.update || []).length).toBeGreaterThan(0);
      } else {
        expect(access!.update || []).toEqual([]);
      }
    },
  );
});
