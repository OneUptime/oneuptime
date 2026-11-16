import { beforeAll, describe, expect, test } from "@jest/globals";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import Models from "Common/Models/DatabaseModels/Index";
import SortValidator from "Common/Server/Types/Database/Permissions/SortValidator";
import OpenAPIUtil from "Common/Server/Utils/OpenAPI";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortNulls from "Common/Types/BaseDatabase/SortNulls";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  getTableColumns,
  TableColumnMetadata,
} from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "Common/Types/JSON";

/*
 * A CLIENT GENERATED FROM THE SPEC SORTS A LIST AS THE API DOES (#8840).
 *
 * Since #8141 the API sorts a list through a relation of one record, by a
 * field of the related record, and puts the records with no value where a
 * field's order says:
 *
 *   { "sort": { "incidentSeverity": { "order": "ASC" },
 *               "declaredAt": { "direction": "DESC", "nulls": "LAST" } } }
 *
 * Every SDK and the Terraform provider are held to the OpenAPI spec, whose
 * sort schemas allowed neither. Asked here of the spec as the API serves
 * it, by Ajv, the JSON Schema validator the MCP SDK checks a tool call with,
 * as a client validating a request would:
 *
 *   - the incident's sort schema, and its list endpoint's request, allow
 *     both, and still refuse a field incidents do not have;
 *   - every sort each model's schema allows, the API takes (SortValidator),
 *     and every form the API refuses, the schema does not allow.
 *
 * Common's Tests/Utils/Schema/ModelSchemaSort holds the same with a reader
 * of its own; this holds that reader, and the spec, to a real validator.
 */

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

const VALIDATOR: AjvJsonSchemaValidator = new AjvJsonSchemaValidator();

let SCHEMAS: JSONObject = {};
let PATHS: JSONObject = {};
let SORTED_MODELS: Array<DatabaseBaseModelType> = [];

beforeAll(() => {
  const spec: JSONObject = OpenAPIUtil.generateOpenAPISpec();

  SCHEMAS = (spec["components"] as JSONObject)["schemas"] as JSONObject;
  PATHS = spec["paths"] as JSONObject;

  SORTED_MODELS = (Models as Array<DatabaseBaseModelType>).filter(
    (modelType: DatabaseBaseModelType): boolean => {
      return Boolean(SCHEMAS[`${tableOf(modelType)}SortSchema`]);
    },
  );
});

function tableOf(modelType: DatabaseBaseModelType): string {
  return new modelType().tableName as string;
}

function refName(schema: JSONValue): string {
  return String((schema as JSONObject)["$ref"]).replace(
    "#/components/schemas/",
    "",
  );
}

function propertiesOf(schema: JSONObject): JSONObject {
  return (schema["properties"] || {}) as JSONObject;
}

// The schemas `value` refers to, and those they refer to.
function referredFrom(value: JSONValue, found: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    for (const member of value) {
      referredFrom(member as JSONValue, found);
    }
  } else if (value && typeof value === "object") {
    for (const [key, member] of Object.entries(value as JSONObject)) {
      if (key === "$ref" && typeof member === "string") {
        const name: string = refName(value);

        if (!found.has(name)) {
          found.add(name);
          referredFrom(SCHEMAS[name] as JSONValue, found);
        }
      } else {
        referredFrom(member as JSONValue, found);
      }
    }
  }

  return found;
}

// A check of `schema` against the spec's components, as a client runs it.
function checkerFor(schema: JSONObject): (value: unknown) => boolean {
  const components: JSONObject = {};

  for (const name of referredFrom(schema, new Set())) {
    components[name] = SCHEMAS[name] as JSONValue;
  }

  const check: (value: unknown) => { valid: boolean } = VALIDATOR.getValidator({
    ...schema,
    components: { schemas: components },
  } as never);

  return (value: unknown): boolean => {
    return check(value).valid;
  };
}

function sortCheckerFor(
  modelType: DatabaseBaseModelType,
): (sort: unknown) => boolean {
  return checkerFor({
    $ref: `#/components/schemas/${tableOf(modelType)}SortSchema`,
  });
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

// Each value a field's order takes, as SortFieldOrder writes it.
const FIELD_ORDERS: Array<JSONValue> = [
  SortOrder.Ascending,
  SortOrder.Descending,
  { direction: SortOrder.Ascending },
  { direction: SortOrder.Descending },
  { direction: SortOrder.Ascending, nulls: SortNulls.First },
  { direction: SortOrder.Ascending, nulls: SortNulls.Last },
  { direction: SortOrder.Descending, nulls: SortNulls.First },
  { direction: SortOrder.Descending, nulls: SortNulls.Last },
];

describe("the incident's sort, as the issue asks", () => {
  test("allows a sort by its severity's place in the list, and by when it was declared with the undeclared last", () => {
    const allows: (sort: unknown) => boolean = sortCheckerFor(Incident);

    for (const sort of [
      { incidentSeverity: { order: SortOrder.Ascending } },
      {
        declaredAt: { direction: SortOrder.Descending, nulls: SortNulls.Last },
      },
      {
        incidentSeverity: { order: SortOrder.Ascending },
        declaredAt: { direction: SortOrder.Descending, nulls: SortNulls.Last },
      },
    ]) {
      expect([sort, allows(sort), refusalOf(Incident, sort)]).toEqual([
        sort,
        true,
        null,
      ]);
    }
  });

  test("still refuses a field incidents do not have, and what the API refuses", () => {
    const allows: (sort: unknown) => boolean = sortCheckerFor(Incident);

    for (const sort of [
      { nope: SortOrder.Ascending },
      { incidentSeverity: SortOrder.Descending },
      { incidentSeverity: { nope: SortOrder.Ascending } },
      { labels: { name: SortOrder.Ascending } },
      { declaredAt: "descending" },
      { declaredAt: { direction: SortOrder.Descending, nulls: "NEVER" } },
      { title: { name: SortOrder.Ascending } },
    ]) {
      expect([sort, allows(sort)]).toEqual([sort, false]);
      expect(refusalOf(Incident, sort)).toBeInstanceOf(BadDataException);
    }
  });

  test("is what the incident list endpoint's request takes", () => {
    const operation: JSONObject | undefined = Object.values(PATHS)
      .map((path: JSONValue): JSONObject | undefined => {
        return (path as JSONObject)["post"] as JSONObject | undefined;
      })
      .find((post: JSONObject | undefined): boolean => {
        return post?.["operationId"] === "listIncident";
      });

    const body: JSONObject = (
      ((operation?.["requestBody"] as JSONObject)["content"] as JSONObject)[
        "application/json"
      ] as JSONObject
    )["schema"] as JSONObject;

    expect(propertiesOf(body)["sort"]).toEqual({
      $ref: "#/components/schemas/IncidentSortSchema",
    });

    const takes: (request: unknown) => boolean = checkerFor(body);

    expect(
      takes({
        query: {},
        limit: 10,
        sort: {
          incidentSeverity: { order: SortOrder.Ascending },
          declaredAt: {
            direction: SortOrder.Descending,
            nulls: SortNulls.Last,
          },
        },
      }),
    ).toBe(true);
    expect(takes({ sort: { nope: SortOrder.Ascending } })).toBe(false);
    expect(takes({ sort: { incidentSeverity: SortOrder.Descending } })).toBe(
      false,
    );
  });
});

describe("every model's sort schema, read by a validator", () => {
  test("covers the models the API lists, so the checks below are not vacuous", () => {
    expect(SORTED_MODELS.length).toBeGreaterThan(400);
  });

  test("allows each field with each order, and each relation with each field of its record: all of them sorts the API takes", () => {
    const problems: Array<string> = [];
    let checked: number = 0;

    for (const modelType of SORTED_MODELS) {
      const allows: (sort: unknown) => boolean = sortCheckerFor(modelType);

      for (const [key, property] of Object.entries(
        propertiesOf(SCHEMAS[`${tableOf(modelType)}SortSchema`] as JSONObject),
      )) {
        const name: string = refName(property);
        const values: Array<JSONValue> =
          name === "SortFieldOrder"
            ? FIELD_ORDERS
            : Object.keys(propertiesOf(SCHEMAS[name] as JSONObject)).flatMap(
                (field: string): Array<JSONValue> => {
                  return FIELD_ORDERS.map((order: JSONValue): JSONValue => {
                    return { [field]: order };
                  });
                },
              );

        for (const value of values) {
          const sort: JSONObject = { [key]: value };
          const refusal: Error | null = refusalOf(modelType, sort);

          if (!allows(sort) || refusal) {
            problems.push(
              `${tableOf(modelType)} ${JSON.stringify(sort)}: ${refusal?.message || "the schema refuses it"}`,
            );
          }

          checked++;
        }
      }
    }

    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(100_000);
  });

  test("allows no form the API refuses", () => {
    const problems: Array<string> = [];

    for (const modelType of SORTED_MODELS) {
      const allows: (sort: unknown) => boolean = sortCheckerFor(modelType);
      const model: DatabaseBaseModel = new modelType();
      const properties: JSONObject = propertiesOf(
        SCHEMAS[`${tableOf(modelType)}SortSchema`] as JSONObject,
      );
      const sorts: Array<unknown> = [{ notAFieldOfIt: SortOrder.Ascending }];

      for (const [key, property] of Object.entries(properties)) {
        const name: string = refName(property);

        if (name === "SortFieldOrder") {
          sorts.push(
            { [key]: "descending" },
            { [key]: null },
            { [key]: { direction: "UP" } },
            { [key]: { direction: SortOrder.Descending, nulls: "NEVER" } },
            { [key]: { name: SortOrder.Ascending } },
          );
          continue;
        }

        const field: string = Object.keys(
          propertiesOf(SCHEMAS[name] as JSONObject),
        )[0] as string;

        sorts.push(
          { [key]: SortOrder.Descending },
          { [key]: { notAFieldOfIt: SortOrder.Ascending } },
          { [key]: { [field]: "UP" } },
        );
      }

      for (const [key, column] of Object.entries(getTableColumns(model))) {
        if (
          (column as TableColumnMetadata).type === TableColumnType.EntityArray
        ) {
          sorts.push({ [key]: { _id: SortOrder.Ascending } });
        }
      }

      for (const sort of sorts) {
        if (allows(sort)) {
          problems.push(
            `${tableOf(modelType)} ${JSON.stringify(sort)}: the schema allows it`,
          );
        }

        if (!(refusalOf(modelType, sort) instanceof BadDataException)) {
          problems.push(
            `${tableOf(modelType)} ${JSON.stringify(sort)}: the API takes it`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
