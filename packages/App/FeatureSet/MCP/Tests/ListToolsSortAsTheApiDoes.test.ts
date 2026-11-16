/*
 * A LIST TOOL'S SORT TAKES WHAT THE API TAKES (#8840).
 *
 * Since #8141 the API sorts a list through a relation of one record, by a
 * field of the related record, and puts the records with no value first or
 * last. Every list_ tool's `sort` took {"<field>": "ASC" | "DESC"} alone, so
 * an agent asked to list incidents by severity sent
 * {"incidentSeverity": "DESC"}, was told by the API to send
 * {"incidentSeverity": {"order": "ASC"}} - and the tool's own schema refused
 * that.
 *
 * Held here, on the tools as tools/list lists them, checked by Ajv as the
 * MCP SDK checks a call:
 *
 *   - list_incidents takes both of the issue's sorts;
 *   - a database list tool takes every sort the OpenAPI spec offers its
 *     resource, and every form of value it takes is one the API takes, put
 *     on a field of the kind it is for;
 *   - the sort the API's refusal tells an agent to send is one the tool
 *     takes, for every relation of every resource;
 *   - a telemetry list tool still takes a direction alone, as ClickHouse is
 *     asked one.
 *
 * Which fields and relations a resource sorts by is not listed tool by
 * tool, as its fields are not (Tests/ToolListBudget):
 * oneuptime_describe_resource says (Tests/DescribeResource).
 */

import { beforeAll, describe, expect, jest, test } from "@jest/globals";

jest.mock("../Utils/MCPLogger");

import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js";
import AnalyticsBaseModel, {
  AnalyticsBaseModelType,
} from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import SortValidator from "Common/Server/Types/Database/Permissions/SortValidator";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import OpenAPIUtil from "Common/Server/Utils/OpenAPI";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortNulls from "Common/Types/BaseDatabase/SortNulls";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { findModelClass } from "../Services/SelectFieldGenerator";
import { isHelperTool } from "../Tools/HelperTools";
import { isPublicStatusPageTool } from "../Tools/PublicStatusPageTools";
import { generateAllTools } from "../Tools/ToolGenerator";
import { isWorkflowTool } from "../Tools/WorkflowTools";
import { JSONSchemaProperty, McpToolInfo } from "../Types/McpTypes";
import ModelType from "../Types/ModelType";
import OneUptimeOperation from "../Types/OneUptimeOperation";

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

const VALIDATOR: AjvJsonSchemaValidator = new AjvJsonSchemaValidator();

// The list tool of each resource: not the helpers', status pages' or workflows'.
const listTools: Array<McpToolInfo> = generateAllTools().filter(
  (tool: McpToolInfo): boolean => {
    return (
      tool.operation === OneUptimeOperation.List &&
      !isHelperTool(tool.name) &&
      !isPublicStatusPageTool(tool.name) &&
      !isWorkflowTool(tool.name)
    );
  },
);

const databaseLists: Array<McpToolInfo> = listTools.filter(
  (tool: McpToolInfo): boolean => {
    return tool.modelType === ModelType.Database;
  },
);

const telemetryLists: Array<McpToolInfo> = listTools.filter(
  (tool: McpToolInfo): boolean => {
    return tool.modelType === ModelType.Analytics;
  },
);

let SCHEMAS: JSONObject = {};

beforeAll(() => {
  SCHEMAS = (OpenAPIUtil.generateOpenAPISpec()["components"] as JSONObject)[
    "schemas"
  ] as JSONObject;
});

function findTool(name: string): McpToolInfo {
  const tool: McpToolInfo | undefined = listTools.find(
    (candidate: McpToolInfo): boolean => {
      return candidate.name === name;
    },
  );

  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }

  return tool;
}

// Whether a list tool's input schema takes this sort, as a client checks it.
function sortCheckerFor(tool: McpToolInfo): (sort: unknown) => boolean {
  const check: (input: unknown) => { valid: boolean } = VALIDATOR.getValidator(
    tool.inputSchema as never,
  );

  return (sort: unknown): boolean => {
    return check({ sort }).valid;
  };
}

function modelOf(tool: McpToolInfo): DatabaseBaseModelType {
  return findModelClass(
    tool.tableName,
    ModelType.Database,
  ) as DatabaseBaseModelType;
}

function refusalOf(
  modelType: DatabaseBaseModelType,
  sort: unknown,
): Error | null {
  try {
    SortValidator.checkSort({ modelType, sort, props: ROOT });
    return null;
  } catch (error) {
    return error as Error;
  }
}

function propertiesOf(schema: JSONObject | undefined): JSONObject {
  return (schema?.["properties"] || {}) as JSONObject;
}

function refName(schema: JSONValue): string {
  return String((schema as JSONObject)["$ref"]).replace(
    "#/components/schemas/",
    "",
  );
}

// What the spec's sort schema for the tool's resource names: fields, relations.
function specSortOf(tool: McpToolInfo): {
  fields: Array<string>;
  relations: Record<string, Array<string>>;
} {
  const fields: Array<string> = [];
  const relations: Record<string, Array<string>> = {};

  for (const [key, property] of Object.entries(
    propertiesOf(SCHEMAS[`${tool.tableName}SortSchema`] as JSONObject),
  )) {
    const name: string = refName(property);

    if (name === "SortFieldOrder") {
      fields.push(key);
    } else {
      relations[key] = Object.keys(propertiesOf(SCHEMAS[name] as JSONObject));
    }
  }

  return { fields, relations };
}

/*
 * Every value the tool's sort takes for a field, read from its schema: each
 * direction, and the order object with each direction and place for the
 * records with no value, or none. And for a relation: each direction, on
 * a field of its record.
 */
function toolValues(tool: McpToolInfo): {
  forField: Array<JSONValue>;
  forRelationField: Array<JSONValue>;
} {
  const sort: JSONSchemaProperty = tool.inputSchema.properties?.[
    "sort"
  ] as JSONSchemaProperty;
  const [direction, order, relation] = (
    sort.additionalProperties as JSONSchemaProperty
  ).anyOf as Array<JSONSchemaProperty>;

  const directions: Array<JSONValue> = direction!.enum as Array<JSONValue>;
  const orderDirections: Array<JSONValue> = order!.properties!["direction"]!
    .enum as Array<JSONValue>;
  const places: Array<JSONValue> = order!.properties!["nulls"]!
    .enum as Array<JSONValue>;

  const forField: Array<JSONValue> = [...directions];

  for (const each of orderDirections) {
    forField.push({ direction: each });

    for (const place of places) {
      forField.push({ direction: each, nulls: place });
    }
  }

  return {
    forField,
    forRelationField: (relation!.additionalProperties as JSONSchemaProperty)
      .enum as Array<JSONValue>,
  };
}

describe("list_incidents, as the issue asks", () => {
  test("takes a sort by the severity's place in the list, and by when an incident was declared with the undeclared last", () => {
    const takes: (sort: unknown) => boolean = sortCheckerFor(
      findTool("list_incidents"),
    );

    for (const sort of [
      { incidentSeverity: { order: SortOrder.Ascending } },
      {
        declaredAt: { direction: SortOrder.Descending, nulls: SortNulls.Last },
      },
      {
        incidentSeverity: { order: SortOrder.Ascending },
        declaredAt: { direction: SortOrder.Descending, nulls: SortNulls.Last },
      },
      { createdAt: SortOrder.Descending },
    ]) {
      expect([sort, takes(sort), refusalOf(Incident, sort)]).toEqual([
        sort,
        true,
        null,
      ]);
    }
  });

  test("still checks every direction and place it is given", () => {
    const takes: (sort: unknown) => boolean = sortCheckerFor(
      findTool("list_incidents"),
    );

    for (const sort of [
      { title: "UP" },
      { title: null },
      { title: 1 },
      { declaredAt: { direction: "UP" } },
      { declaredAt: { direction: SortOrder.Descending, nulls: "NEVER" } },
      { declaredAt: { direction: SortOrder.Descending, nulls: "last" } },
      { declaredAt: { direction: SortOrder.Descending, more: 1 } },
      { incidentSeverity: { order: SortNulls.Last } },
      { incidentSeverity: { order: "UP" } },
      { incidentSeverity: ["order"] },
    ]) {
      expect([sort, takes(sort)]).toEqual([sort, false]);
    }
  });

  test("says so in a line, and leaves the fields to oneuptime_describe_resource", () => {
    const sort: JSONSchemaProperty = findTool("list_incidents").inputSchema
      .properties?.["sort"] as JSONSchemaProperty;

    expect(sort.description).toBe(
      'For example {"createdAt":"DESC"}, or a related record\'s field: {"<relation>":{"<field>":"ASC"}}.',
    );
    expect(Buffer.byteLength(JSON.stringify(sort))).toBeLessThan(400);
    expect(sort.properties).toBeUndefined();
  });
});

describe("every database list tool's sort", () => {
  test("covers the resources, so the checks below are not vacuous", () => {
    expect(databaseLists.length).toBeGreaterThan(50);
  });

  test("takes every sort the OpenAPI spec offers its resource", () => {
    const problems: Array<string> = [];
    let checked: number = 0;

    for (const tool of databaseLists) {
      const takes: (sort: unknown) => boolean = sortCheckerFor(tool);
      const { fields, relations } = specSortOf(tool);

      expect([tool.name, fields.length]).not.toEqual([tool.name, 0]);

      const sorts: Array<JSONObject> = [];

      for (const field of fields) {
        sorts.push(
          { [field]: SortOrder.Descending },
          { [field]: { direction: SortOrder.Ascending } },
          {
            [field]: {
              direction: SortOrder.Descending,
              nulls: SortNulls.First,
            },
          },
        );
      }

      for (const [relation, relatedFields] of Object.entries(relations)) {
        for (const field of relatedFields) {
          sorts.push({ [relation]: { [field]: SortOrder.Ascending } });
        }
      }

      for (const sort of sorts) {
        if (!takes(sort)) {
          problems.push(`${tool.name} ${JSON.stringify(sort)}`);
        }
        checked++;
      }
    }

    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(5_000);
  });

  test("takes only values the API takes, each put on a field of its kind", () => {
    const problems: Array<string> = [];
    let relationsChecked: number = 0;

    for (const tool of databaseLists) {
      const modelType: DatabaseBaseModelType = modelOf(tool);
      const takes: (sort: unknown) => boolean = sortCheckerFor(tool);
      const { forField, forRelationField } = toolValues(tool);
      const { fields, relations } = specSortOf(tool);

      const sorts: Array<JSONObject> = [];

      for (const field of fields) {
        for (const value of forField) {
          sorts.push({ [field]: value });
        }
      }

      for (const [relation, relatedFields] of Object.entries(relations)) {
        for (const field of relatedFields) {
          for (const value of forRelationField) {
            sorts.push({ [relation]: { [field]: value } });
          }
        }
        relationsChecked++;
      }

      for (const sort of sorts) {
        const refusal: Error | null = refusalOf(modelType, sort);

        if (!takes(sort) || refusal) {
          problems.push(
            `${tool.name} ${JSON.stringify(sort)}: ${refusal?.message || "the tool refuses it"}`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
    expect(relationsChecked).toBeGreaterThan(200);
  });

  /*
   * The API refuses a relation given only a direction, and says which sort
   * to send instead (SortValidator). An agent that sends it is through.
   */
  test("takes the sort the API's refusal of a relation given only a direction tells an agent to send", () => {
    const problems: Array<string> = [];
    let refusals: number = 0;

    for (const tool of databaseLists) {
      const modelType: DatabaseBaseModelType = modelOf(tool);
      const takes: (sort: unknown) => boolean = sortCheckerFor(tool);

      const { relations } = specSortOf(tool);

      for (const relation of Object.keys(relations)) {
        const refusal: Error | null = refusalOf(modelType, {
          [relation]: SortOrder.Descending,
        });

        // The direction alone is a form the tool takes; the API refuses it.
        if (!(refusal instanceof BadDataException)) {
          problems.push(`${tool.name} ${relation}: the API took a direction`);
          continue;
        }

        const named: RegExpMatchArray | null = refusal.message.match(
          /Send (\{.+?\}) to sort by/,
        );

        if (!named) {
          problems.push(`${tool.name} ${relation}: ${refusal.message}`);
          continue;
        }

        const suggested: JSONObject = JSON.parse(named[1]!) as JSONObject;
        const field: string = Object.keys(
          (suggested[relation] || {}) as JSONObject,
        )[0] as string;

        // The tool takes it, the API takes it, and the spec offers it too.
        if (
          !takes(suggested) ||
          refusalOf(modelType, suggested) ||
          !relations[relation]!.includes(field)
        ) {
          problems.push(`${tool.name} ${named[1]}`);
        }

        refusals++;
      }
    }

    expect(problems).toEqual([]);
    expect(refusals).toBeGreaterThan(200);
  });
});

describe("a telemetry list tool's sort", () => {
  test("takes a direction alone, as ClickHouse is asked one", () => {
    expect(telemetryLists.length).toBeGreaterThan(5);

    for (const tool of telemetryLists) {
      const modelType: AnalyticsBaseModelType = findModelClass(
        tool.tableName,
        ModelType.Analytics,
      ) as AnalyticsBaseModelType;
      const timeColumn: string = new modelType().defaultSortColumn;
      const takes: (sort: unknown) => boolean = sortCheckerFor(tool);
      const generator: StatementGenerator<AnalyticsBaseModel> =
        new StatementGenerator({
          modelType,
          database: ClickhouseAppInstance,
        } as never);

      expect([
        tool.name,
        takes({ [timeColumn]: SortOrder.Descending }),
      ]).toEqual([tool.name, true]);

      const withNulls: JSONObject = {
        [timeColumn]: {
          direction: SortOrder.Descending,
          nulls: SortNulls.Last,
        },
      };

      expect([tool.name, takes(withNulls)]).toEqual([tool.name, false]);
      expect(() => {
        generator.toSortStatement(withNulls as never);
      }).toThrow(BadDataException);
    }
  });
});
