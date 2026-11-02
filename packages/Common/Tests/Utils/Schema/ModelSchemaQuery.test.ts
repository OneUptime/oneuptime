import { beforeAll, describe, expect, test } from "@jest/globals";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import { FindOperator } from "typeorm";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import Label from "../../../Models/DatabaseModels/Label";
import Models from "../../../Models/DatabaseModels/Index";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import QueryPermission from "../../../Server/Types/Database/Permissions/QueryPermission";
import SelectPermission from "../../../Server/Types/Database/Permissions/SelectPermission";
import QueryUtil from "../../../Server/Types/Database/QueryUtil";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { isOwnerOnlyColumn } from "../../../Types/Database/AccessControl/OwnerOnlyColumn";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { ALWAYS_READABLE_COLUMNS } from "../../../Utils/Schema/BaseSchema";
import { ModelSchema } from "../../../Utils/Schema/ModelSchema";
import { ZodSchema } from "../../../Utils/Schema/Zod";
import "../../Server/TestingUtils/Init";

/*
 * WHAT THE SPEC SAYS A LIST OR COUNT TAKES IS WHAT THE API TAKES.
 *
 * Every documented database model's query, sort, select and group-by schema,
 * rendered as the OpenAPI spec renders it, held to the code the API runs,
 * with no database: JSONFunctions.deserialize reads a filter, QueryPermission
 * and SelectPermission check its fields, QueryUtil.serializeQuery compiles
 * it. Each form of filter the spec documents - each branch of each field's
 * <Type>Filter - is written out and run through all three, on every field of
 * every model.
 *
 * zod-to-openapi took the `type` these schemas gave .openapi() for the whole
 * schema, so the spec documented every one of them as an object that allowed
 * no field at all.
 */

const SCHEMA_KINDS: Array<string> = [
  "QuerySchema",
  "SortSchema",
  "SelectSchema",
  "GroupBySchema",
];

// The names OpenAPIUtil registers for a model (registerModelSchemas).
const MODEL_SCHEMA_SUFFIXES: Array<string> = [
  "",
  "CreateSchema",
  "ReadSchema",
  "UpdateSchema",
  "DeleteSchema",
  ...SCHEMA_KINDS,
];

const A_UUID: string = "5f0e8e3a-1f24-4a2f-9e4c-2b1d3c4e5f60";

const RE_UUID: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const A_TIME: string = "2026-07-01T00:00:00.000Z";

const USER_ID: ObjectID = ObjectID.generate();
const PROJECT_ID: ObjectID = ObjectID.generate();

const callers: Map<string, DatabaseCommonInteractionProps> = new Map();

// Somebody of the project who holds these permissions, and no other.
function callerHolding(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const held: Array<Permission> = [...new Set(permissions)].sort();
  let caller: DatabaseCommonInteractionProps | undefined = callers.get(
    held.join(","),
  );

  if (!caller) {
    caller = {
      userId: USER_ID,
      userType: UserType.User,
      tenantId: PROJECT_ID,
      userGlobalAccessPermission: {
        _type: "UserGlobalAccessPermission",
        globalPermissions: held,
        projectIds: [PROJECT_ID],
      },
    };

    callers.set(held.join(","), caller);
  }

  return caller;
}

/*
 * Who may read a column, as the API asks it: those its own access control
 * names, or its model's readers for a column that names none.
 */
function readersOf(
  modelType: DatabaseBaseModelType,
  column: string,
): Array<Permission> {
  const model: DatabaseBaseModel = new modelType();

  return (
    model.getColumnAccessControlFor(column)?.read ||
    model.getReadPermissions() ||
    []
  );
}

/*
 * Somebody who may read whatever somebody may: every permission there is. A
 * column nobody may read is refused all the same.
 */
const EVERYBODY: DatabaseCommonInteractionProps = callerHolding(
  Object.values(Permission),
);

// The models the REST API serves, and so the OpenAPI spec documents.
const DOCUMENTED_MODELS: Array<DatabaseBaseModelType> = (
  Models as Array<DatabaseBaseModelType>
).filter((modelType: DatabaseBaseModelType): boolean => {
  const model: DatabaseBaseModel = new modelType();

  return Boolean(
    model.tableName && model.enableDocumentation && model.crudApiPath,
  );
});

// What the spec writes: every model's four schemas, and what they refer to.
let SCHEMAS: JSONObject = {};

function tableOf(modelType: DatabaseBaseModelType): string {
  return new modelType().tableName as string;
}

function schemaOf(modelType: DatabaseBaseModelType, kind: string): JSONObject {
  return SCHEMAS[`${tableOf(modelType)}${kind}`] as JSONObject;
}

function propertiesOf(schema: JSONObject): JSONObject {
  return (schema["properties"] || {}) as JSONObject;
}

// A $ref's schema, or the schema itself.
function resolve(schema: JSONObject): JSONObject {
  const ref: unknown = schema["$ref"];

  if (typeof ref !== "string") {
    return schema;
  }

  return SCHEMAS[ref.replace("#/components/schemas/", "")] as JSONObject;
}

/*
 * The columns a list may name, as the API checks them: those somebody may
 * read, and the ids and times it lets through all the same. Not a relation,
 * filtered and selected through its own fields, nor a hidden column.
 */
function readableColumns(
  modelType: DatabaseBaseModelType,
): Record<string, TableColumnMetadata> {
  const model: DatabaseBaseModel = new modelType();
  const columns: Record<string, TableColumnMetadata> = getTableColumns(model);
  const readable: Record<string, TableColumnMetadata> = {};

  for (const [key, column] of Object.entries(columns)) {
    const readers: Array<Permission> =
      model.getColumnAccessControlFor(key)?.read || [];

    if (
      column.type !== TableColumnType.Entity &&
      !column.hideColumnInDocumentation &&
      (ALWAYS_READABLE_COLUMNS.includes(key) || readers.length > 0)
    ) {
      readable[key] = column;
    }
  }

  return readable;
}

// The name the spec gives a column type's filter: its key in TableColumnType.
function filterNameOf(type: TableColumnType): string {
  const key: string | undefined = Object.keys(TableColumnType).find(
    (name: string): boolean => {
      return TableColumnType[name as keyof typeof TableColumnType] === type;
    },
  );

  return `${key}Filter`;
}

// The first field of each type a documented model's query names.
function fieldsByType(): Map<
  TableColumnType,
  { modelType: DatabaseBaseModelType; key: string }
> {
  const fields: Map<
    TableColumnType,
    { modelType: DatabaseBaseModelType; key: string }
  > = new Map();

  for (const modelType of DOCUMENTED_MODELS) {
    for (const [key, column] of Object.entries(readableColumns(modelType))) {
      if (!fields.has(column.type)) {
        fields.set(column.type, { modelType, key });
      }
    }
  }

  return fields;
}

/*
 * Every value a rendered schema documents, one of each form: each branch of
 * an anyOf, each operator with each form of its value.
 */
function samplesOf(schema: JSONObject): Array<JSONValue> {
  schema = resolve(schema);

  if (schema["anyOf"]) {
    return (schema["anyOf"] as Array<JSONObject>).flatMap(samplesOf);
  }

  if (schema["enum"]) {
    return schema["enum"] as Array<JSONValue>;
  }

  switch (schema["type"]) {
    case "string":
      if (schema["format"] === "uuid") {
        return [A_UUID];
      }

      if (schema["format"] === "date-time") {
        return [A_TIME];
      }

      if (schema["format"] === "email") {
        return ["user@example.com"];
      }

      return ["sample"];

    case "number":
      return [5];

    case "boolean":
      return [true];

    case "array":
      return samplesOf(schema["items"] as JSONObject).map(
        (item: JSONValue): JSONValue => {
          return [item];
        },
      );

    case "object":
      break;

    default:
      throw new Error(`No sample for ${JSON.stringify(schema)}`);
  }

  // A map of keys: one key, with each form of its value.
  if (schema["additionalProperties"]) {
    return samplesOf(schema["additionalProperties"] as JSONObject).map(
      (value: JSONValue): JSONValue => {
        return { Team: value };
      },
    );
  }

  // An operator: each form of each of its properties, one at a time.
  const properties: JSONObject = propertiesOf(schema);
  const first: JSONObject = {};

  for (const [key, property] of Object.entries(properties)) {
    first[key] = samplesOf(property as JSONObject)[0] as JSONValue;
  }

  const samples: Array<JSONValue> = [first];

  for (const [key, property] of Object.entries(properties)) {
    for (const value of samplesOf(property as JSONObject).slice(1)) {
      samples.push({ ...first, [key]: value });
    }
  }

  return samples;
}

/*
 * The operators a rendered filter documents: each branch's `_type`, and
 * EqualTo for a plain value. A JSON column's are under each key.
 */
function operatorsOf(filter: JSONObject): Array<string> {
  const branches: Array<JSONObject> = (filter["anyOf"] as
    | Array<JSONObject>
    | undefined) || [filter];

  return [
    ...new Set(
      branches.map((branch: JSONObject): string => {
        const type: JSONObject | undefined = propertiesOf(branch)["_type"] as
          | JSONObject
          | undefined;

        return type
          ? ((type["enum"] as Array<string>)[0] as string)
          : "EqualTo";
      }),
    ),
  ].sort();
}

/*
 * A query on one field, as a request writes it. An owner-only column is asked
 * for by its owner, on the records they own, as the API requires.
 */
function queryOn(
  modelType: DatabaseBaseModelType,
  field: string,
  filter: JSONValue,
): JSONObject {
  const model: DatabaseBaseModel = new modelType();
  const query: JSONObject = { [field]: filter };
  const userColumn: string | null = model.getUserColumn();

  if (isOwnerOnlyColumn(model, field) && userColumn) {
    query[userColumn] = USER_ID.toString();
  }

  return query;
}

// What the API does with a query, up to the database itself.
function runQuery(
  modelType: DatabaseBaseModelType,
  query: JSONObject,
  caller: DatabaseCommonInteractionProps = EVERYBODY,
): JSONObject {
  const deserialized: JSONObject = JSONFunctions.deserialize(
    JSON.parse(JSON.stringify(query)) as JSONObject,
  );

  QueryPermission.checkQueryPermission(
    modelType,
    deserialized as never,
    caller,
  );

  return QueryUtil.serializeQuery(
    modelType,
    deserialized as never,
  ) as unknown as JSONObject;
}

function isPrimitive(value: unknown): boolean {
  return ["string", "number", "boolean"].includes(typeof value);
}

/*
 * What a compiled filter compares a column with: a value the database binds
 * as it is, or a list of them - never an object, which it would bind as
 * "[object Object]" or as JSON nobody wrote.
 */
function boundValues(compiled: unknown): Array<unknown> {
  if (compiled instanceof FindOperator) {
    const operator: {
      _objectLiteralParameters?: Record<string, unknown>;
      _value?: unknown;
    } = compiled as unknown as {
      _objectLiteralParameters?: Record<string, unknown>;
      _value?: unknown;
    };

    if (operator._objectLiteralParameters) {
      return Object.values(operator._objectLiteralParameters).flat();
    }

    return operator._value === undefined
      ? []
      : boundValues(operator._value).flat();
  }

  if (Array.isArray(compiled)) {
    return compiled.flatMap(boundValues);
  }

  return [compiled];
}

/*
 * Why the API would not run a compiled filter as the spec documents it, or
 * null. A relation list's IsNull and NotNull are a subquery built from the
 * database's own description of the relation, so here, with no database,
 * the API leaves them out; every other filter is compiled.
 */
function compileProblem(
  column: TableColumnMetadata,
  filter: JSONValue,
  compiled: JSONObject,
  field: string,
): string | null {
  const value: unknown = compiled[field];

  if (column.type === TableColumnType.EntityArray) {
    if (value === undefined) {
      const type: unknown = (filter as JSONObject)["_type"];

      return type === "IsNull" || type === "NotNull"
        ? null
        : "the filter was dropped";
    }

    // Records related to any of the ids: {_id: In(ids)} on the relation.
    const ids: unknown = (value as JSONObject)["_id"];

    return ids instanceof FindOperator &&
      boundValues(ids).every((id: unknown): boolean => {
        return typeof id === "string" && RE_UUID.test(id);
      })
      ? null
      : `compiled to ${JSON.stringify(value)}`;
  }

  if (value === undefined) {
    return "the filter was dropped";
  }

  if (!(value instanceof FindOperator) && !isPrimitive(value)) {
    return `left uncompiled: ${String((value as { constructor?: { name?: string } }).constructor?.name)}`;
  }

  const unbound: Array<unknown> = boundValues(value).filter(
    (bound: unknown): boolean => {
      return !isPrimitive(bound) || bound === "[object Object]";
    },
  );

  return unbound.length > 0 ? `binds ${JSON.stringify(unbound)}` : null;
}

beforeAll(() => {
  const registry: OpenAPIRegistry = new OpenAPIRegistry();

  for (const modelType of DOCUMENTED_MODELS) {
    const table: string = tableOf(modelType);

    registry.register(
      `${table}QuerySchema`,
      ModelSchema.getQueryModelSchema({ modelType }),
    );
    registry.register(
      `${table}SortSchema`,
      ModelSchema.getSortModelSchema({ modelType }),
    );
    registry.register(
      `${table}SelectSchema`,
      ModelSchema.getSelectModelSchema({ modelType }),
    );
    registry.register(
      `${table}GroupBySchema`,
      ModelSchema.getGroupByModelSchema({ modelType }),
    );
  }

  SCHEMAS = (new OpenApiGeneratorV3(registry.definitions).generateComponents()
    .components?.schemas || {}) as JSONObject;
});

describe("every documented model's query, sort and select", () => {
  test("covers the models the API serves, so the checks below are not vacuous", () => {
    expect(DOCUMENTED_MODELS.length).toBeGreaterThan(400);
  });

  test("lists the fields a query and a select may name: those somebody may read, and the ids and times", () => {
    const problems: Array<string> = [];

    for (const modelType of DOCUMENTED_MODELS) {
      const readable: Array<string> = Object.keys(readableColumns(modelType));

      for (const kind of ["QuerySchema", "SelectSchema"]) {
        const listed: Array<string> = Object.keys(
          propertiesOf(schemaOf(modelType, kind)),
        );

        if (listed.join(",") !== readable.join(",")) {
          problems.push(
            `${tableOf(modelType)}${kind}: ${listed.length} fields, ${readable.length} readable`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test("lists the readable fields of a sortable type as sort fields, each ASC or DESC", () => {
    const problems: Array<string> = [];

    for (const modelType of DOCUMENTED_MODELS) {
      const sortable: Array<string> = Object.entries(readableColumns(modelType))
        .filter(([, column]: [string, TableColumnMetadata]): boolean => {
          return ModelSchema.getSortableTypes().includes(column.type);
        })
        .map(([key]: [string, TableColumnMetadata]): string => {
          return key;
        });
      const properties: JSONObject = propertiesOf(
        schemaOf(modelType, "SortSchema"),
      );

      if (Object.keys(properties).join(",") !== sortable.join(",")) {
        problems.push(`${tableOf(modelType)}SortSchema`);
      }

      for (const [key, property] of Object.entries(properties)) {
        if (
          JSON.stringify(resolve(property as JSONObject)["enum"]) !==
          JSON.stringify([SortOrder.Ascending, SortOrder.Descending])
        ) {
          problems.push(`${tableOf(modelType)}SortSchema ${key}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test("lists no field nobody may read: an incident's deletedByUserId, which the API refuses", () => {
    for (const kind of SCHEMA_KINDS) {
      expect(propertiesOf(schemaOf(Incident, kind))).not.toHaveProperty(
        "deletedByUserId",
      );
    }

    expect(() => {
      runQuery(Incident, { deletedByUserId: A_UUID });
    }).toThrow("You do not have permissions to query on - deletedByUserId.");

    expect(() => {
      SelectPermission.checkSelectPermission(
        Incident,
        { deletedByUserId: true } as never,
        EVERYBODY,
      );
    }).toThrow();
  });

  /*
   * A query also filters by the fields of a record a relation names, and by
   * owners, as the API reference describes, so it does not refuse other
   * keys; the API refuses a column a model does not have.
   */
  test("allows no other field in a sort, select or group by, and leaves a query open to relations and owners", () => {
    for (const kind of ["SortSchema", "SelectSchema", "GroupBySchema"]) {
      expect(schemaOf(Incident, kind)["additionalProperties"]).toBe(false);
    }

    expect(schemaOf(Incident, "QuerySchema")).not.toHaveProperty(
      "additionalProperties",
    );

    runQuery(Incident, {
      currentIncidentState: { name: { _type: "Search", value: "Resolved" } },
    });

    expect(() => {
      runQuery(Incident, { nope: "sample" });
    }).toThrow("Invalid column on Incident - nope. Column does not exist.");
  });
});

describe("a query field", () => {
  test("refers to its type's filter, one schema each type has", () => {
    const problems: Array<string> = [];

    for (const modelType of DOCUMENTED_MODELS) {
      const columns: Record<string, TableColumnMetadata> =
        readableColumns(modelType);

      for (const [key, property] of Object.entries(
        propertiesOf(schemaOf(modelType, "QuerySchema")),
      )) {
        const name: string = filterNameOf(
          (columns[key] as TableColumnMetadata).type,
        );

        if (
          (property as JSONObject)["$ref"] !== `#/components/schemas/${name}`
        ) {
          problems.push(
            `${tableOf(modelType)}.${key}: ${JSON.stringify(property)}`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test("documents exactly the operators its type takes", () => {
    const types: Array<TableColumnType> = [...fieldsByType().keys()];

    for (const type of types) {
      const filter: JSONObject = SCHEMAS[filterNameOf(type)] as JSONObject;
      const operators: Array<string> = [
        ...ModelSchema.getValidOperatorsForColumnType(type),
      ].sort();

      if (type !== TableColumnType.JSON) {
        expect([type, operatorsOf(filter)]).toEqual([type, operators]);
        continue;
      }

      // On the field itself, whether it holds anything; on each key, the rest.
      const branches: Array<JSONObject> = filter["anyOf"] as Array<JSONObject>;
      const byKey: JSONObject = branches.find((branch: JSONObject): boolean => {
        return Boolean(branch["additionalProperties"]);
      }) as JSONObject;

      expect(
        operatorsOf({
          anyOf: branches.filter((branch: JSONObject): boolean => {
            return branch !== byKey;
          }),
        }),
      ).toEqual(["IsNull", "NotNull"]);
      expect(operatorsOf(byKey["additionalProperties"] as JSONObject)).toEqual(
        operators,
      );
    }

    expect(types.length).toBeGreaterThan(25);
  });

  test("the API takes every filter the spec documents, on every field of every model", () => {
    const problems: Array<string> = [];
    let checked: number = 0;

    for (const modelType of DOCUMENTED_MODELS) {
      const columns: Record<string, TableColumnMetadata> =
        readableColumns(modelType);

      for (const [key, property] of Object.entries(
        propertiesOf(schemaOf(modelType, "QuerySchema")),
      )) {
        const column: TableColumnMetadata = columns[key] as TableColumnMetadata;

        for (const filter of samplesOf(property as JSONObject)) {
          let problem: string | null;

          try {
            problem = compileProblem(
              column,
              filter,
              runQuery(
                modelType,
                queryOn(modelType, key, filter),
                callerHolding(readersOf(modelType, key)),
              ),
              key,
            );
          } catch (error) {
            problem = `refused: ${(error as Error).message}`;
          }

          if (problem) {
            problems.push(
              `${tableOf(modelType)}.${key} ${JSON.stringify(filter)}: ${problem}`,
            );
          }

          checked++;
        }
      }
    }

    expect(problems.slice(0, 20)).toEqual([]);
    expect(checked).toBeGreaterThan(50000);
  });

  // The checks above would pass anything if the API's checks passed anything.
  test("leaves out what the API refuses or misreads: NotEqual on a relation list, an operator on a whole JSON column, a value written as a response writes it", () => {
    expect(() => {
      runQuery(Incident, { labels: { _type: "NotEqual", value: [A_UUID] } });
    }).toThrow('Invalid ID for "labels"');

    // Read as a filter on a key named "_value".
    const notEqual: unknown = runQuery(Incident, {
      customFields: { _type: "NotEqual", value: { Team: "Payments" } },
    })["customFields"];

    expect(boundValues(notEqual)).toContain("_value");

    const colorNotEqual: unknown = runQuery(Label, {
      color: { _type: "NotEqual", value: { _type: "Color", value: "#ff0000" } },
    })["color"];

    expect(boundValues(colorNotEqual)).toEqual(["[object Object]"]);
  });

  test("filters a JSON column by key, with any operator on a key", () => {
    const team: unknown = runQuery(Incident, {
      customFields: { Team: { _type: "Search", value: "Pay" } },
    })["customFields"];

    expect(boundValues(team)).toEqual(["Team", "%Pay%"]);
  });
});

describe("a select field", () => {
  test("the API takes every one the spec documents, a relation list's own fields among them", () => {
    const problems: Array<string> = [];
    let relationLists: number = 0;

    for (const modelType of DOCUMENTED_MODELS) {
      const columns: Record<string, TableColumnMetadata> = getTableColumns(
        new modelType(),
      );

      for (const [key, property] of Object.entries(
        propertiesOf(schemaOf(modelType, "SelectSchema")),
      )) {
        const relation: DatabaseBaseModelType | undefined = (
          property as JSONObject
        )["$ref"]
          ? ((columns[key] as TableColumnMetadata)
              .modelType as DatabaseBaseModelType)
          : undefined;
        const select: JSONObject = {
          [key]: relation
            ? Object.fromEntries(
                Object.keys(propertiesOf(resolve(property as JSONObject))).map(
                  (name: string): [string, boolean] => {
                    return [name, true];
                  },
                ),
              )
            : true,
        };

        // Who may read the field, and the records a relation list holds.
        const caller: DatabaseCommonInteractionProps = callerHolding([
          ...readersOf(modelType, key),
          ...(relation ? new relation().getReadPermissions() || [] : []),
        ]);

        if (relation) {
          relationLists++;
        }

        try {
          SelectPermission.checkSelectPermission(
            modelType,
            select as never,
            caller,
          );
          QueryPermission.checkRelationQueryPermission(
            modelType,
            queryOn(modelType, key, null) as never,
            select as never,
            caller,
          );
        } catch (error) {
          problems.push(
            `${tableOf(modelType)} ${JSON.stringify(select)}: ${(error as Error).message}`,
          );
        }
      }
    }

    expect(problems.slice(0, 20)).toEqual([]);
    expect(relationLists).toBeGreaterThan(300);
  });

  test("selects a relation list by the fields its records offer on a relation, which the API refuses any other", () => {
    const labels: JSONObject = resolve(
      propertiesOf(schemaOf(Incident, "SelectSchema"))["labels"] as JSONObject,
    );

    expect(Object.keys(propertiesOf(labels))).toEqual(
      expect.arrayContaining(["_id", "name", "color"]),
    );
    expect(propertiesOf(labels)).not.toHaveProperty("description");

    expect(() => {
      QueryPermission.checkRelationQueryPermission(
        Incident,
        {} as never,
        { labels: { description: true } } as never,
        EVERYBODY,
      );
    }).toThrow("does not support read on relation query");
  });
});

describe("a group by", () => {
  test("names no field of a database model: findBy refuses any groupBy", () => {
    for (const modelType of DOCUMENTED_MODELS) {
      const groupBy: JSONObject = schemaOf(modelType, "GroupBySchema");

      expect([tableOf(modelType), propertiesOf(groupBy)]).toEqual([
        tableOf(modelType),
        {},
      ]);
      expect(groupBy["additionalProperties"]).toBe(false);
    }
  });
});

describe("each schema's example", () => {
  test("is one the schema takes, and a query the API runs", () => {
    const problems: Array<string> = [];

    for (const modelType of DOCUMENTED_MODELS) {
      const schemas: Array<[string, ZodSchema]> = [
        ["QuerySchema", ModelSchema.getQueryModelSchema({ modelType })],
        ["SortSchema", ModelSchema.getSortModelSchema({ modelType })],
        ["SelectSchema", ModelSchema.getSelectModelSchema({ modelType })],
        ["GroupBySchema", ModelSchema.getGroupByModelSchema({ modelType })],
      ];

      for (const [kind, schema] of schemas) {
        const example: JSONObject = schemaOf(modelType, kind)[
          "example"
        ] as JSONObject;

        if (!schema.safeParse(example).success) {
          problems.push(
            `${tableOf(modelType)}${kind} ${JSON.stringify(example)}`,
          );
        }
      }

      try {
        runQuery(
          modelType,
          schemaOf(modelType, "QuerySchema")["example"] as JSONObject,
        );
      } catch (error) {
        problems.push(`${tableOf(modelType)}: ${(error as Error).message}`);
      }
    }

    expect(problems).toEqual([]);
  });

  test("of every filter is one the filter takes, and a query the API runs", () => {
    for (const [type, { modelType, key }] of fieldsByType()) {
      const example: JSONValue = (SCHEMAS[filterNameOf(type)] as JSONObject)[
        "example"
      ] as JSONValue;

      expect([
        type,
        ModelSchema.getQueryFilterSchema(type).safeParse(example).success,
      ]).toEqual([type, true]);

      expect(
        compileProblem(
          readableColumns(modelType)[key] as TableColumnMetadata,
          example,
          runQuery(
            modelType,
            queryOn(modelType, key, example),
            callerHolding(readersOf(modelType, key)),
          ),
          key,
        ),
      ).toBeNull();
    }
  });
});

describe("the schemas the spec publishes once", () => {
  test("are named apart from every model's own", () => {
    const modelNames: Set<string> = new Set();

    for (const modelType of [
      ...(Models as Array<DatabaseBaseModelType>),
      ...(AnalyticsModels as Array<{ new (): { tableName: string | null } }>),
    ]) {
      const table: string | null = new modelType().tableName;

      for (const suffix of MODEL_SCHEMA_SUFFIXES) {
        modelNames.add(`${table}${suffix}`);
      }
    }

    const shared: Array<string> = Object.keys(SCHEMAS).filter(
      (name: string): boolean => {
        return !DOCUMENTED_MODELS.some(
          (modelType: DatabaseBaseModelType): boolean => {
            return SCHEMA_KINDS.some((kind: string): boolean => {
              return name === `${tableOf(modelType)}${kind}`;
            });
          },
        );
      },
    );

    expect(shared).toEqual(
      expect.arrayContaining(["SortOrder", "ObjectIDFilter", "DateFilter"]),
    );
    expect(
      shared.filter((name: string): boolean => {
        return modelNames.has(name);
      }),
    ).toEqual([]);
  });
});
