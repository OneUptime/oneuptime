import { beforeAll, describe, expect, test } from "@jest/globals";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Models from "../../../Models/DatabaseModels/Index";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import SortValidator from "../../../Server/Types/Database/Permissions/SortValidator";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortNulls from "../../../Types/BaseDatabase/SortNulls";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { isOwnerOnlyColumn } from "../../../Types/Database/AccessControl/OwnerOnlyColumn";
import {
  ACCOUNT_DATE_COLUMNS,
  isAccountDateColumn,
} from "../../../Types/Database/AccessControl/AccountDateColumns";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import Query from "../../../Server/Types/Database/Query";
import { ALWAYS_READABLE_COLUMNS } from "../../../Utils/Schema/BaseSchema";
import { ModelSchema } from "../../../Utils/Schema/ModelSchema";

/*
 * EVERY SORT THE OPENAPI SPEC ALLOWS, THE API TAKES (#8840).
 *
 * The API sorts a list by a field and its order - "ASC", "DESC", or
 * { "direction": "DESC", "nulls": "LAST" } - and through a relation of one
 * record by a field of the related record: { "incidentSeverity":
 * { "order": "ASC" } } (#8141). SortValidator is what it takes. Every SDK
 * and the Terraform provider are generated from the spec, so a client can
 * send only what the spec's <Table>SortSchema allows: it allowed a column
 * and "ASC" or "DESC", and no relation.
 *
 * Held here, on the spec as GET /api/openapi/spec serves it, for every model
 * it documents:
 *
 *   - every sort a sort schema allows - each field with each order it
 *     takes, each relation with each field of its related record - passes
 *     SortValidator;
 *   - every form SortValidator refuses, the schema refuses too: a field the
 *     model does not have, a relation given only a direction, a relation of
 *     many records, an order TypeORM would read the other way;
 *   - a relation's sort is published once per related model and referred
 *     to, as its select is, and names only what a relation read may.
 *
 * Whether the schema allows a sort is asked of the spec's JSON as a client
 * reads it, by a reader of the few keywords these schemas are written with
 * ($ref, anyOf, type, enum, properties, required, additionalProperties). It
 * fails on any other, so it cannot let a sort through by not understanding
 * its schema. The App's Tests/BaseAPI/ListSortSchemaFollowsTheApi asks Ajv
 * the same, and so holds this reader to it.
 *
 * The shape of a sort is asked as root, who passes every permission check:
 * the schema says which sorts a list can be read in, not who may read which
 * column. Who may is SortValidator.checkSortPermission's (#8839), and held
 * apart below: whoever may read a relation may sort by every field the spec
 * offers through it.
 */

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

let SCHEMAS: JSONObject = {};

// The models whose list the spec documents, each with its sort schema.
let SORTED_MODELS: Array<DatabaseBaseModelType> = [];

beforeAll(() => {
  const spec: JSONObject = OpenAPIUtil.generateOpenAPISpec();

  SCHEMAS = (spec["components"] as JSONObject)["schemas"] as JSONObject;

  SORTED_MODELS = (Models as Array<DatabaseBaseModelType>).filter(
    (modelType: DatabaseBaseModelType): boolean => {
      return Boolean(SCHEMAS[`${tableOf(modelType)}SortSchema`]);
    },
  );
});

function tableOf(modelType: DatabaseBaseModelType): string {
  return new modelType().tableName as string;
}

function sortSchemaOf(modelType: DatabaseBaseModelType): JSONObject {
  return SCHEMAS[`${tableOf(modelType)}SortSchema`] as JSONObject;
}

function nameOfRef(schema: JSONValue): string {
  const ref: unknown = (schema as JSONObject)?.["$ref"];

  if (typeof ref !== "string" || !ref.startsWith("#/components/schemas/")) {
    throw new Error(`Not a reference: ${JSON.stringify(schema)}`);
  }

  return ref.replace("#/components/schemas/", "");
}

function propertiesOf(schema: JSONObject): JSONObject {
  return (schema["properties"] || {}) as JSONObject;
}

// The keywords this reader knows; any other in a sort schema fails the test.
const ANNOTATIONS: Array<string> = ["description", "example", "title"];

/*
 * Whether `schema` allows `value`, as JSON Schema reads it, for the keywords
 * the sort schemas are written with.
 */
function allows(schema: JSONObject, value: unknown): boolean {
  for (const key of Object.keys(schema)) {
    if (
      ![
        ...ANNOTATIONS,
        "$ref",
        "anyOf",
        "type",
        "enum",
        "properties",
        "required",
        "additionalProperties",
      ].includes(key)
    ) {
      throw new Error(`A sort schema says ${key}, which this cannot read.`);
    }
  }

  if (schema["$ref"] !== undefined) {
    return allows(SCHEMAS[nameOfRef(schema)] as JSONObject, value);
  }

  if (schema["anyOf"] !== undefined) {
    return (schema["anyOf"] as Array<JSONObject>).some(
      (variant: JSONObject): boolean => {
        return allows(variant, value);
      },
    );
  }

  const isObject: boolean =
    typeof value === "object" && value !== null && !Array.isArray(value);

  if (schema["type"] === "string" && typeof value !== "string") {
    return false;
  }

  if (schema["type"] === "object" && !isObject) {
    return false;
  }

  if (
    schema["type"] !== undefined &&
    !["string", "object"].includes(schema["type"] as string)
  ) {
    throw new Error(`A sort schema is of type ${String(schema["type"])}.`);
  }

  if (
    schema["enum"] !== undefined &&
    !(schema["enum"] as Array<unknown>).includes(value)
  ) {
    return false;
  }

  if (!isObject) {
    return true;
  }

  const object: Record<string, unknown> = value as Record<string, unknown>;
  const properties: JSONObject = propertiesOf(schema);

  for (const required of (schema["required"] || []) as Array<string>) {
    if (object[required] === undefined) {
      return false;
    }
  }

  for (const [key, member] of Object.entries(object)) {
    const property: JSONObject | undefined = properties[key] as
      | JSONObject
      | undefined;

    if (property) {
      if (!allows(property, member)) {
        return false;
      }
      continue;
    }

    const additional: unknown = schema["additionalProperties"];

    if (additional === false) {
      return false;
    }

    if (
      additional &&
      typeof additional === "object" &&
      !allows(additional as JSONObject, member)
    ) {
      return false;
    }
  }

  return true;
}

// SortValidator's verdict: null when it takes the sort, else its refusal.
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

/*
 * Every order SortFieldOrder takes, read from the schema itself: each
 * direction, and the object with each direction and each place for the
 * records with no value, or none.
 */
function fieldOrders(): Array<unknown> {
  const fieldOrder: JSONObject = SCHEMAS["SortFieldOrder"] as JSONObject;
  const orders: Array<unknown> = [];

  for (const variant of fieldOrder["anyOf"] as Array<JSONObject>) {
    const resolved: JSONObject =
      variant["$ref"] !== undefined
        ? (SCHEMAS[nameOfRef(variant)] as JSONObject)
        : variant;

    if (resolved["enum"]) {
      orders.push(...(resolved["enum"] as Array<unknown>));
      continue;
    }

    const properties: JSONObject = propertiesOf(resolved);
    const directions: Array<unknown> = (
      SCHEMAS[nameOfRef(properties["direction"] as JSONObject)] as JSONObject
    )["enum"] as Array<unknown>;
    const nulls: Array<unknown> = (properties["nulls"] as JSONObject)[
      "enum"
    ] as Array<unknown>;

    for (const direction of directions) {
      orders.push({ direction });

      for (const place of nulls) {
        orders.push({ direction, nulls: place });
      }
    }
  }

  return orders;
}

// What a relation sort schema names: each field of the related record.
function relationFieldsOf(schemaName: string): Array<string> {
  return Object.keys(propertiesOf(SCHEMAS[schemaName] as JSONObject));
}

/*
 * Every sort a model's sort schema allows, one field each: each field with
 * each order, each relation with each field of its record and each order.
 */
function allowedSorts(modelType: DatabaseBaseModelType): Array<JSONObject> {
  const sorts: Array<JSONObject> = [];
  const orders: Array<unknown> = fieldOrders();

  for (const [key, property] of Object.entries(
    propertiesOf(sortSchemaOf(modelType)),
  )) {
    const name: string = nameOfRef(property);

    if (name === "SortFieldOrder") {
      for (const order of orders) {
        sorts.push({ [key]: order as JSONValue });
      }
      continue;
    }

    if (!name.endsWith("RelationSortSchema")) {
      throw new Error(
        `${tableOf(modelType)}SortSchema ${key} refers to ${name}`,
      );
    }

    for (const field of relationFieldsOf(name)) {
      for (const order of orders) {
        sorts.push({ [key]: { [field]: order as JSONValue } });
      }
    }
  }

  return sorts;
}

describe("every sort the spec allows", () => {
  test("covers the models the API lists, so the checks below are not vacuous", () => {
    expect(SORTED_MODELS.length).toBeGreaterThan(400);
    expect(fieldOrders()).toHaveLength(8);
  });

  test("of an incident: by its severity's place in the list, and by when it was declared with the undeclared last", () => {
    const sorts: Array<JSONObject> = [
      { incidentSeverity: { order: SortOrder.Ascending } },
      {
        declaredAt: { direction: SortOrder.Descending, nulls: SortNulls.Last },
      },
      {
        incidentSeverity: { order: SortOrder.Ascending },
        declaredAt: { direction: SortOrder.Descending, nulls: SortNulls.Last },
      },
      { currentIncidentState: { order: SortOrder.Descending } },
      { createdByUser: { name: SortOrder.Ascending } },
    ];

    for (const sort of sorts) {
      expect([sort, allows(sortSchemaOf(Incident), sort)]).toEqual([
        sort,
        true,
      ]);
      expect([sort, refusalOf(Incident, sort)]).toEqual([sort, null]);
    }

    // And still refuses a field it does not have.
    expect(allows(sortSchemaOf(Incident), { nope: SortOrder.Ascending })).toBe(
      false,
    );
    expect(refusalOf(Incident, { nope: SortOrder.Ascending })).toBeInstanceOf(
      BadDataException,
    );
  });

  test("passes the API's check, for every field and relation of every model", () => {
    const problems: Array<string> = [];
    let checked: number = 0;
    let throughRelations: number = 0;

    for (const modelType of SORTED_MODELS) {
      const schema: JSONObject = sortSchemaOf(modelType);

      for (const sort of allowedSorts(modelType)) {
        // The reader agrees the schema allows what it was read from.
        if (!allows(schema, sort)) {
          problems.push(
            `${tableOf(modelType)} schema: ${JSON.stringify(sort)}`,
          );
        }

        const refusal: Error | null = refusalOf(modelType, sort);

        if (refusal) {
          problems.push(
            `${tableOf(modelType)} ${JSON.stringify(sort)}: ${refusal.message}`,
          );
        }

        const value: JSONValue = Object.values(sort)[0] as JSONValue;

        if (
          typeof value === "object" &&
          value !== null &&
          !("direction" in (value as JSONObject))
        ) {
          throughRelations++;
        }

        checked++;
      }
    }

    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(100_000);
    expect(throughRelations).toBeGreaterThan(50_000);
  });

  test("passes it all at once: every field and relation of a model in one sort", () => {
    const problems: Array<string> = [];

    for (const modelType of SORTED_MODELS) {
      const sort: JSONObject = {};

      for (const [key, property] of Object.entries(
        propertiesOf(sortSchemaOf(modelType)),
      )) {
        const name: string = nameOfRef(property);

        sort[key] =
          name === "SortFieldOrder"
            ? { direction: SortOrder.Descending, nulls: SortNulls.Last }
            : {
                [relationFieldsOf(name)[0] as string]: SortOrder.Ascending,
              };
      }

      if (!allows(sortSchemaOf(modelType), sort)) {
        problems.push(`${tableOf(modelType)} schema`);
      }

      const refusal: Error | null = refusalOf(modelType, sort);

      if (refusal) {
        problems.push(`${tableOf(modelType)}: ${refusal.message}`);
      }
    }

    expect(problems).toEqual([]);
  });

  test("the example of each sort and relation sort schema is one it allows and the API takes", () => {
    const problems: Array<string> = [];

    for (const modelType of SORTED_MODELS) {
      const schema: JSONObject = sortSchemaOf(modelType);

      if (!allows(schema, schema["example"])) {
        problems.push(`${tableOf(modelType)}SortSchema`);
      }

      for (const [key, property] of Object.entries(propertiesOf(schema))) {
        const name: string = nameOfRef(property);

        if (name === "SortFieldOrder") {
          continue;
        }

        const example: JSONValue = (SCHEMAS[name] as JSONObject)["example"]!;

        if (
          !allows(SCHEMAS[name] as JSONObject, example) ||
          Object.keys(example as JSONObject).length !== 1 ||
          refusalOf(modelType, { [key]: example })
        ) {
          problems.push(`${name} ${JSON.stringify(example)}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});

describe("every form the API refuses", () => {
  /*
   * Each refused form, for each model: the API refuses it as bad data, and
   * the schema does not allow it, so no client generated from it sends it.
   */
  function expectRefusedByBoth(
    modelType: DatabaseBaseModelType,
    sort: unknown,
    problems: Array<string>,
  ): void {
    const refusal: Error | null = refusalOf(modelType, sort);

    if (!(refusal instanceof BadDataException)) {
      problems.push(
        `${tableOf(modelType)} ${JSON.stringify(sort)}: the API took it`,
      );
    }

    if (allows(sortSchemaOf(modelType), sort)) {
      problems.push(
        `${tableOf(modelType)} ${JSON.stringify(sort)}: the schema allows it`,
      );
    }
  }

  test("a field the model does not have", () => {
    const problems: Array<string> = [];

    for (const modelType of SORTED_MODELS) {
      expectRefusedByBoth(modelType, { notAFieldOfIt: "ASC" }, problems);
      expectRefusedByBoth(
        modelType,
        { createdAt: "ASC", notAFieldOfIt: "DESC" },
        problems,
      );
    }

    expect(problems).toEqual([]);
  });

  test("a relation of one record given only a direction, or a field its record does not have", () => {
    const problems: Array<string> = [];
    let relations: number = 0;

    for (const modelType of SORTED_MODELS) {
      for (const [key, property] of Object.entries(
        propertiesOf(sortSchemaOf(modelType)),
      )) {
        const name: string = nameOfRef(property);

        if (name === "SortFieldOrder") {
          continue;
        }

        const field: string = relationFieldsOf(name)[0] as string;

        for (const sort of [
          { [key]: SortOrder.Descending },
          { [key]: SortOrder.Ascending },
          { [key]: { direction: SortOrder.Descending, nulls: "LAST" } },
          { [key]: { notAFieldOfIt: SortOrder.Ascending } },
          { [key]: { [field]: "UP" } },
          { [key]: { [field]: { direction: "UP" } } },
          { [key]: { [field]: { name: SortOrder.Ascending } } },
        ]) {
          expectRefusedByBoth(modelType, sort, problems);
        }

        relations++;
      }
    }

    expect(problems).toEqual([]);
    expect(relations).toBeGreaterThan(1500);
  });

  test("a relation of many records, which has no one value to sort a list by", () => {
    const problems: Array<string> = [];
    let lists: number = 0;

    for (const modelType of SORTED_MODELS) {
      const columns: Record<string, TableColumnMetadata> = getTableColumns(
        new modelType(),
      );

      for (const [key, column] of Object.entries(columns)) {
        if (column.type !== TableColumnType.EntityArray) {
          continue;
        }

        expect([key, propertiesOf(sortSchemaOf(modelType))[key]]).toEqual([
          key,
          undefined,
        ]);

        expectRefusedByBoth(modelType, { [key]: { _id: "ASC" } }, problems);
        expectRefusedByBoth(modelType, { [key]: "ASC" }, problems);
        lists++;
      }
    }

    expect(problems).toEqual([]);
    expect(lists).toBeGreaterThan(100);
  });

  test("an order the database would read the other way, or not at all", () => {
    const problems: Array<string> = [];

    for (const modelType of SORTED_MODELS) {
      for (const [key, property] of Object.entries(
        propertiesOf(sortSchemaOf(modelType)),
      )) {
        if (nameOfRef(property) !== "SortFieldOrder") {
          continue;
        }

        for (const order of [
          "descending",
          "Desc",
          "UP",
          null,
          true,
          2,
          [SortOrder.Ascending],
          { direction: "UP" },
          { direction: SortOrder.Descending, nulls: "NEVER" },
          { direction: SortOrder.Descending, nulls: SortNulls.Last, more: 1 },
          // A field holds a value of its own, not a related record.
          { name: SortOrder.Ascending },
        ]) {
          expectRefusedByBoth(modelType, { [key]: order }, problems);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test("a sort that is not an object of fields", () => {
    const problems: Array<string> = [];

    for (const modelType of [Incident, Label, IncidentSeverity]) {
      for (const sort of ["createdAt", ["createdAt"]]) {
        expectRefusedByBoth(modelType, sort, problems);
      }
    }

    expect(problems).toEqual([]);
  });
});

/*
 * What the API reads as written takes more than the spec offers - "asc", 1
 * and -1, a lower-case nulls, a nulls with no direction, a relation through
 * a relation. A client is offered one way to write each sort, as each SDK
 * types it; the rest keep working for whoever sends them.
 */
describe("what the API takes beyond the spec", () => {
  test("still passes, and the schema offers one way to write it instead", () => {
    for (const order of [
      "asc",
      "desc",
      1,
      -1,
      { direction: "desc" },
      { direction: SortOrder.Descending, nulls: "last" },
      { nulls: SortNulls.Last },
    ]) {
      expect([order, refusalOf(Incident, { declaredAt: order })]).toEqual([
        order,
        null,
      ]);
      expect([
        order,
        allows(sortSchemaOf(Incident), { declaredAt: order }),
      ]).toEqual([order, false]);
    }

    // A relation through a relation: a severity's project, by its name.
    const deep: JSONObject = {
      incidentSeverity: { project: { name: SortOrder.Ascending } },
    };

    expect(refusalOf(Incident, deep)).toBeNull();
    expect(allows(sortSchemaOf(Incident), deep)).toBe(false);
  });
});

/*
 * Who may sort by what is SortValidator.checkSortPermission's (#8839): a
 * sort is held to the read of each column it names. A relation sort names
 * only fields any reader of the relation may read - the ids and times, and
 * those marked canReadOnRelationQuery - so whoever may read the relation
 * may sort by every field the spec offers through it, whatever they hold of
 * the related model.
 */
describe("who may sort", () => {
  const PROJECT_ID: ObjectID = ObjectID.generate();

  // Somebody of the project who holds exactly these permissions.
  function personWith(
    permissions: Array<Permission>,
  ): DatabaseCommonInteractionProps {
    return {
      userId: ObjectID.generate(),
      userType: UserType.User,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: PROJECT_ID,
          permissions: permissions.map(
            (permission: Permission): UserPermission => {
              return {
                _type: "UserPermission",
                permission: permission,
                labelIds: [],
                isBlockPermission: false,
              };
            },
          ),
        },
      },
    };
  }

  function permissionRefusalOf(
    modelType: DatabaseBaseModelType,
    sort: JSONObject,
    props: DatabaseCommonInteractionProps,
  ): Error | null {
    try {
      SortValidator.checkSortPermission({
        modelType,
        query: {} as Query<DatabaseBaseModel>,
        sort,
        props,
      });
      return null;
    } catch (error) {
      return error as Error;
    }
  }

  test("whoever may read a relation may sort by every field the spec offers through it", () => {
    const problems: Array<string> = [];
    let checked: number = 0;

    for (const modelType of SORTED_MODELS) {
      const model: DatabaseBaseModel = new modelType();

      for (const [key, property] of Object.entries(
        propertiesOf(sortSchemaOf(modelType)),
      )) {
        const name: string = nameOfRef(property);

        if (name === "SortFieldOrder") {
          continue;
        }

        // Only who may read the relation itself: nothing of its record.
        const reader: DatabaseCommonInteractionProps = personWith(
          model.getColumnAccessControlFor(key)?.read || [],
        );

        for (const field of relationFieldsOf(name)) {
          const sort: JSONObject = {
            [key]: { [field]: SortOrder.Ascending },
          };
          const refusal: Error | null = permissionRefusalOf(
            modelType,
            sort,
            reader,
          );

          if (refusal) {
            problems.push(
              `${tableOf(modelType)} ${JSON.stringify(sort)}: ${refusal.message}`,
            );
          }

          checked++;
        }
      }
    }

    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(10_000);
  });

  /*
   * The same readers are refused fields the spec leaves out of a relation
   * sort, where they may not read them: the check above passes because of
   * what the spec offers, not because the check passes everything.
   */
  test("and the same readers are refused a related field the spec leaves out, through most relations", () => {
    // The relations through which one field the spec leaves out is refused.
    let refused: number = 0;

    for (const modelType of SORTED_MODELS) {
      const model: DatabaseBaseModel = new modelType();

      for (const [key, property] of Object.entries(
        propertiesOf(sortSchemaOf(modelType)),
      )) {
        const name: string = nameOfRef(property);

        if (name === "SortFieldOrder") {
          continue;
        }

        const reader: DatabaseCommonInteractionProps = personWith(
          model.getColumnAccessControlFor(key)?.read || [],
        );
        const relatedModel: DatabaseBaseModel = new (getTableColumns(model)[
          key
        ]!.modelType as DatabaseBaseModelType)();
        const offered: Array<string> = relationFieldsOf(name);

        for (const [field, column] of Object.entries(
          getTableColumns(relatedModel),
        )) {
          if (
            offered.includes(field) ||
            column.type === TableColumnType.Entity ||
            column.type === TableColumnType.EntityArray
          ) {
            continue;
          }

          if (
            permissionRefusalOf(
              modelType,
              { [key]: { [field]: SortOrder.Ascending } },
              reader,
            ) instanceof NotAuthorizedException
          ) {
            refused++;
            break;
          }
        }
      }
    }

    expect(refused).toBeGreaterThan(1000);
  });
});

describe("a relation's sort", () => {
  test("is published once per related model, and every relation to it refers to it", () => {
    const relationSorts: Array<string> = Object.keys(SCHEMAS).filter(
      (name: string): boolean => {
        return name.endsWith("RelationSortSchema");
      },
    );

    const referred: Map<string, number> = new Map();

    for (const modelType of SORTED_MODELS) {
      for (const property of Object.values(
        propertiesOf(sortSchemaOf(modelType)),
      )) {
        // Every field and relation of a sort is a reference, never inline.
        const name: string = nameOfRef(property);

        if (name !== "SortFieldOrder") {
          referred.set(name, (referred.get(name) || 0) + 1);
        }
      }
    }

    expect([...referred.keys()].sort()).toEqual(relationSorts.sort());

    const references: number = [...referred.values()].reduce(
      (sum: number, count: number): number => {
        return sum + count;
      },
      0,
    );

    // About 2,000 relations refer to about 130 schemas.
    expect(references).toBeGreaterThan(relationSorts.length * 10);
    expect(referred.get("ProjectRelationSortSchema")).toBeGreaterThan(300);
  });

  test("names the fields of its record a relation read may, each a SortFieldOrder, and nothing else", () => {
    const problems: Array<string> = [];

    for (const modelType of Models as Array<DatabaseBaseModelType>) {
      const model: DatabaseBaseModel = new modelType();
      const schema: JSONObject | undefined = SCHEMAS[
        `${model.tableName}RelationSortSchema`
      ] as JSONObject | undefined;

      if (!schema) {
        continue;
      }

      const expected: Array<string> = Object.entries(getTableColumns(model))
        .filter(([key, column]: [string, TableColumnMetadata]): boolean => {
          const readers: Array<Permission> =
            model.getColumnAccessControlFor(key)?.read ||
            model.getReadPermissions() ||
            [];

          return (
            column.type !== TableColumnType.Entity &&
            column.type !== TableColumnType.EntityArray &&
            !column.hideColumnInDocumentation &&
            (Boolean(column.canReadOnRelationQuery) ||
              (ALWAYS_READABLE_COLUMNS.includes(key) && readers.length > 0)) &&
            ModelSchema.getSortableTypes().includes(column.type) &&
            !column.hashed &&
            !column.encrypted &&
            !column.secret &&
            !isOwnerOnlyColumn(model, key) &&
            !isAccountDateColumn(model.tableName, key)
          );
        })
        .map(([key]: [string, TableColumnMetadata]): string => {
          return key;
        });

      if (
        Object.keys(propertiesOf(schema)).join(",") !== expected.join(",") ||
        schema["additionalProperties"] !== false
      ) {
        problems.push(`${model.tableName}RelationSortSchema`);
      }

      for (const [key, property] of Object.entries(propertiesOf(schema))) {
        if (nameOfRef(property) !== "SortFieldOrder") {
          problems.push(`${model.tableName}RelationSortSchema ${key}`);
        }
      }

      // What a relation read may name is what its select may (#8141).
      const select: JSONObject | undefined = SCHEMAS[
        `${model.tableName}RelationSelectSchema`
      ] as JSONObject | undefined;

      for (const key of Object.keys(propertiesOf(schema))) {
        if (select && !(key in propertiesOf(select))) {
          problems.push(
            `${model.tableName}RelationSortSchema ${key}: no select`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test("is offered on each relation of one record somebody may read, whose record has a field to sort by", () => {
    const problems: Array<string> = [];

    for (const modelType of SORTED_MODELS) {
      const model: DatabaseBaseModel = new modelType();
      const properties: JSONObject = propertiesOf(sortSchemaOf(modelType));

      for (const [key, column] of Object.entries(getTableColumns(model))) {
        if (column.type !== TableColumnType.Entity) {
          continue;
        }

        const offered: boolean =
          Boolean(column.modelType) &&
          !column.hideColumnInDocumentation &&
          (model.getColumnAccessControlFor(key)?.read || []).length > 0 &&
          ModelSchema.getRelationSortFields(
            column.modelType as DatabaseBaseModelType,
          ).length > 0;

        const listed: string | undefined = properties[key]
          ? nameOfRef(properties[key] as JSONObject)
          : undefined;

        const expected: string | undefined = offered
          ? `${new (column.modelType as DatabaseBaseModelType)().tableName}RelationSortSchema`
          : undefined;

        if (listed !== expected) {
          problems.push(`${model.tableName}.${key}: ${listed} not ${expected}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test("of an incident's severity sorts by its place in the list, as the API reference shows", () => {
    expect(
      nameOfRef(propertiesOf(sortSchemaOf(Incident))["incidentSeverity"]!),
    ).toBe("IncidentSeverityRelationSortSchema");

    const severity: JSONObject = SCHEMAS[
      "IncidentSeverityRelationSortSchema"
    ] as JSONObject;

    expect(Object.keys(propertiesOf(severity))).toEqual(
      expect.arrayContaining(["_id", "name", "order", "createdAt"]),
    );
    expect(severity["example"]).toEqual({ order: SortOrder.Ascending });
    expect(severity["description"]).toBe(
      'What a sort may name of the IncidentSeverity a relation of one record points at: a field of it and its order, as in {"order":"ASC"}.',
    );
  });

  /*
   * A person's account dates say when they were last active: the API
   * refuses them as an order through a relation to all but OneUptime and a
   * master admin (#9823, PendingInviteeProfiles). So the spec offers a
   * relation to a person by their other fields, and so does the API's
   * refusal of a relation given only a direction.
   */
  test("of a person leaves out their account dates, which no relation is ordered by", () => {
    const person: Array<string> = Object.keys(
      propertiesOf(SCHEMAS["UserRelationSortSchema"] as JSONObject),
    );
    const refusal: string =
      refusalOf(Incident, { createdByUser: SortOrder.Descending })?.message ||
      "";

    expect(person).toEqual(expect.arrayContaining(["_id", "name"]));
    expect(refusal).toContain("name another of its fields");

    for (const column of ACCOUNT_DATE_COLUMNS) {
      expect(person).not.toContain(column);
      expect(refusal).not.toContain(column);
    }
  });

  /*
   * The API refuses a relation given only a direction, and names a field of
   * its record to send instead (SortValidator). A client generated from the
   * spec can send what it names.
   */
  test("offers the field the API's refusal of a relation given only a direction names", () => {
    const problems: Array<string> = [];
    let refusals: number = 0;

    for (const modelType of SORTED_MODELS) {
      for (const [key, property] of Object.entries(
        propertiesOf(sortSchemaOf(modelType)),
      )) {
        const name: string = nameOfRef(property);

        if (name === "SortFieldOrder") {
          continue;
        }

        const message: string =
          refusalOf(modelType, { [key]: SortOrder.Descending })?.message || "";
        const named: RegExpMatchArray | null = message.match(
          /Send (\{.+?\}) to sort by/,
        );
        const suggested: JSONObject | undefined = named
          ? (JSON.parse(named[1]!) as JSONObject)
          : undefined;

        if (
          !suggested ||
          !allows(sortSchemaOf(modelType), suggested) ||
          refusalOf(modelType, suggested)
        ) {
          problems.push(`${tableOf(modelType)}.${key}: ${message}`);
        }

        refusals++;
      }
    }

    expect(problems).toEqual([]);
    expect(refusals).toBeGreaterThan(1500);
  });

  test("is built once per model, as its select is", () => {
    expect(ModelSchema.getRelationSortSchema(IncidentSeverity)).toBe(
      ModelSchema.getRelationSortSchema(IncidentSeverity),
    );
    expect(ModelSchema.getRelationSortFields(IncidentSeverity)).toBe(
      ModelSchema.getRelationSortFields(IncidentSeverity),
    );
  });
});

describe("a sort schema", () => {
  test("allows no field it does not name, at the top or through a relation", () => {
    for (const modelType of SORTED_MODELS) {
      expect([
        tableOf(modelType),
        sortSchemaOf(modelType)["additionalProperties"],
      ]).toEqual([tableOf(modelType), false]);
    }

    expect(
      (SCHEMAS["IncidentSeverityRelationSortSchema"] as JSONObject)[
        "additionalProperties"
      ],
    ).toBe(false);
  });

  test("orders by every number: a severity's place in its list is a small one", () => {
    expect(propertiesOf(sortSchemaOf(IncidentSeverity))["order"]).toEqual({
      $ref: "#/components/schemas/SortFieldOrder",
    });
  });

  test("says what its fields and relations take", () => {
    expect(sortSchemaOf(Incident)["description"]).toBe(
      "Sort schema for Incident: a field and its order, or a relation of one record and a field of the related record.",
    );
    expect(sortSchemaOf(Incident)["example"]).toEqual({
      createdAt: SortOrder.Descending,
    });
    expect((SCHEMAS["SortFieldOrder"] as JSONObject)["description"]).toBe(
      'How a field orders a list: ASC or DESC, or { "direction": "DESC", "nulls": "LAST" } to say where the records with no value in it go.',
    );
  });

  test("of telemetry keeps ASC or DESC, all ClickHouse is asked", () => {
    const telemetrySorts: Array<JSONObject> = (
      AnalyticsModels as Array<{ new (): AnalyticsBaseModel }>
    )
      .map((modelType: { new (): AnalyticsBaseModel }): JSONValue => {
        return SCHEMAS[`${new modelType().tableName}SortSchema`]!;
      })
      .filter(Boolean) as Array<JSONObject>;

    expect(telemetrySorts.length).toBeGreaterThan(5);

    for (const schema of telemetrySorts) {
      for (const property of Object.values(propertiesOf(schema))) {
        expect(JSON.stringify(property)).not.toContain("SortFieldOrder");
        expect(JSON.stringify(property)).not.toContain("RelationSortSchema");
      }
    }
  });
});
