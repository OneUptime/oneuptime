import { describe, expect, test } from "@jest/globals";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LogDropFilter from "../../Models/DatabaseModels/LogDropFilter";
import LogPipeline from "../../Models/DatabaseModels/LogPipeline";
import LogScrubRule from "../../Models/DatabaseModels/LogScrubRule";
import TraceDropFilter from "../../Models/DatabaseModels/TraceDropFilter";
import TracePipeline from "../../Models/DatabaseModels/TracePipeline";
import TraceScrubRule from "../../Models/DatabaseModels/TraceScrubRule";
import DatabaseService from "../../Server/Services/DatabaseService";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  LOG_SCRUB_RULE_DEFAULTS,
  ScrubRuleDefaults,
  TRACE_SCRUB_RULE_DEFAULTS,
} from "../../Types/Telemetry/ScrubRule";
import { ModelSchema } from "../../Utils/Schema/ModelSchema";

/*
 * What a log or trace data rule - a scrub rule, a drop filter, a pipeline -
 * stores for a column a create leaves out, and what the API says about it.
 *
 * The dashboard's create forms start from these defaults: a scrub rule's
 * action and fields wait under Advanced at redact and every field, a
 * pipeline no longer asks for Enabled at all. That is only honest if the
 * server stores the same when the column is left out. Three mechanisms carry
 * a default, and they are easy to confuse, so all three are pinned:
 *
 *   - @Column({ default }) - the database's own default, what an INSERT
 *     that leaves the column out stores;
 *   - @TableColumn({ defaultValue }) - documentation: the API schema, the
 *     Terraform provider (which sends it when unset) and the dashboard form;
 *   - isDefaultValueColumn - what lets a create leave a required column out
 *     at all: without it DatabaseService.checkRequiredFields refused the
 *     request ("isEnabled is required") although the published schema said
 *     the field was optional with a default.
 */

interface DefaultedColumn {
  model: { new (): BaseModel };
  column: string;
  value: string | boolean;
}

const scrubRuleColumns: (
  model: { new (): BaseModel },
  defaults: ScrubRuleDefaults,
) => Array<DefaultedColumn> = (
  model: { new (): BaseModel },
  defaults: ScrubRuleDefaults,
): Array<DefaultedColumn> => {
  return [
    { model, column: "scrubAction", value: defaults.scrubAction },
    { model, column: "fieldsToScrub", value: defaults.fieldsToScrub },
    { model, column: "isEnabled", value: defaults.isEnabled },
  ];
};

const DEFAULTED_COLUMNS: Array<DefaultedColumn> = [
  ...scrubRuleColumns(LogScrubRule, LOG_SCRUB_RULE_DEFAULTS),
  ...scrubRuleColumns(TraceScrubRule, TRACE_SCRUB_RULE_DEFAULTS),
  { model: LogDropFilter, column: "isEnabled", value: true },
  { model: TraceDropFilter, column: "isEnabled", value: true },
  { model: LogPipeline, column: "isEnabled", value: true },
  { model: TracePipeline, column: "isEnabled", value: true },
];

function typeOrmColumn(
  model: { new (): BaseModel },
  column: string,
): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (args: ColumnMetadataArgs): boolean => {
      return args.target === model && args.propertyName === column;
    },
  );
}

function getCreateSchema(model: { new (): BaseModel }): JSONObject {
  const registry: OpenAPIRegistry = new OpenAPIRegistry();
  const name: string = `${model.name}Create`;

  registry.register(
    name,
    ModelSchema.getCreateModelSchema({ modelType: model }),
  );

  const document: JSONObject = new OpenApiGeneratorV3(
    registry.definitions,
  ).generateComponents() as unknown as JSONObject;

  return ((document["components"] as JSONObject)["schemas"] as JSONObject)[
    name
  ] as JSONObject;
}

// DatabaseService's check of required columns, as a create runs it.
class RequiredColumnsCheck<
  TModel extends BaseModel,
> extends DatabaseService<TModel> {
  public check(data: TModel): TModel {
    return this.checkRequiredFields(data);
  }
}

describe.each(DEFAULTED_COLUMNS)(
  "$model.name.$column",
  ({ model, column, value }: DefaultedColumn) => {
    const metadata: TableColumnMetadata = new model().getTableColumnMetadata(
      column,
    );

    test("the database stores the default when a create leaves it out", () => {
      expect(typeOrmColumn(model, column)?.options.default).toBe(value);
      expect(typeOrmColumn(model, column)?.options.nullable).toBe(false);
    });

    test("publishes the same default", () => {
      expect(metadata.defaultValue).toBe(value);
    });

    test("may be left out of a create", () => {
      expect(new model().isDefaultValueColumn(column)).toBe(true);
    });

    test("the API schema does not require it, and says its default", () => {
      const schema: JSONObject = getCreateSchema(model);
      const required: Array<string> =
        (schema["required"] as Array<string> | undefined) || [];
      const property: JSONObject = (schema["properties"] as JSONObject)[
        column
      ] as JSONObject;

      expect(required).not.toContain(column);
      expect(property).toBeDefined();
      expect(property["default"]).toBe(value);
    });
  },
);

describe("a create that leaves the defaulted columns out", () => {
  test.each([
    [LogScrubRule, { patternType: "email" }],
    [TraceScrubRule, { patternType: "email" }],
    [LogDropFilter, { filterQuery: "severityText = 'Debug'", action: "drop" }],
    [
      TraceDropFilter,
      { filterQuery: "name LIKE 'healthcheck'", action: "drop" },
    ],
    [LogPipeline, {}],
    [TracePipeline, {}],
  ] as Array<[{ new (): BaseModel }, Record<string, unknown>]>)(
    "%p passes the required-column check",
    (model: { new (): BaseModel }, columns: Record<string, unknown>) => {
      const row: BaseModel = Object.assign(new model(), {
        name: "A rule",
        projectId: new ObjectID("22222222-2222-4222-8222-222222222222"),
        ...columns,
      });

      expect(() => {
        new RequiredColumnsCheck(model).check(row);
      }).not.toThrow();
    },
  );

  test("still refuses a scrub rule with no pattern type: it has no default", () => {
    const row: BaseModel = Object.assign(new LogScrubRule(), {
      name: "A rule",
      projectId: new ObjectID("22222222-2222-4222-8222-222222222222"),
    });

    expect(() => {
      new RequiredColumnsCheck(LogScrubRule).check(row);
    }).toThrow(new BadDataException("patternType is required"));

    const required: Array<string> =
      (getCreateSchema(LogScrubRule)["required"] as Array<string>) || [];
    expect(required).toContain("patternType");
    expect(required).toContain("name");
  });

  test("still refuses a drop filter with no action: the form suggests Drop, the server does not decide", () => {
    const row: BaseModel = Object.assign(new LogDropFilter(), {
      name: "A filter",
      projectId: new ObjectID("22222222-2222-4222-8222-222222222222"),
      filterQuery: "severityText = 'Debug'",
    });

    expect(() => {
      new RequiredColumnsCheck(LogDropFilter).check(row);
    }).toThrow(new BadDataException("action is required"));
  });
});

describe("the custom pattern column", () => {
  test.each([LogScrubRule, TraceScrubRule])(
    "%p says it is required for a custom rule and checked",
    (model: { new (): BaseModel }) => {
      const metadata: TableColumnMetadata = new model().getTableColumnMetadata(
        "customRegex",
      );

      expect(metadata.required).toBeFalsy();
      expect(metadata.description).toContain(
        "Required when patternType is 'custom'",
      );
      expect(metadata.description).toContain("refused");
    },
  );

  test.each([LogScrubRule, TraceScrubRule])(
    "%p lists every pattern type, sensitiveKeys included",
    (model: { new (): BaseModel }) => {
      const description: string =
        new model().getTableColumnMetadata("patternType").description || "";

      for (const patternType of [
        "email",
        "creditCard",
        "ssn",
        "phoneNumber",
        "ipAddress",
        "sensitiveKeys",
        "custom",
      ]) {
        expect(description).toContain(patternType);
      }
    },
  );
});
