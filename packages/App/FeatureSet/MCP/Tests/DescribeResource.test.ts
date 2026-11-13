/*
 * WHAT oneuptime_describe_resource TELLS AN AGENT IS WHAT THE API DOES.
 *
 * The list and count tools take any field, so this helper is the only place an
 * agent learns which fields a resource has and how to filter on them. Every
 * word of it has to hold, so these hold it to the code the API runs, for every
 * resource, with no database: JSONFunctions.deserialize reads the operator,
 * QueryPermission and QueryUtil.serializeQuery take it on a database model, and
 * ModelPermission and StatementGenerator take it on a telemetry one.
 *
 * Nothing an agent could do before is lost: a field the tools used to list is
 * still here, unless no permission lets anybody filter on it. And the MCP
 * server's own check of a filter (Tools/FilterCheck) refuses none of it.
 */

import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../Utils/MCPLogger");

import { getFilterProblem } from "../Tools/FilterCheck";
import { handleHelperTool, isHelperTool } from "../Tools/HelperTools";
import { isPublicStatusPageTool } from "../Tools/PublicStatusPageTools";
import { generateAllTools } from "../Tools/ToolGenerator";
import { isWorkflowTool } from "../Tools/WorkflowTools";
import { McpToolInfo } from "../Types/McpTypes";
import ModelType from "../Types/ModelType";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import {
  findModelClass,
  getSelectableFieldsForModel,
} from "../Services/SelectFieldGenerator";
import AnalyticsBaseModel, {
  AnalyticsBaseModelType,
} from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import {
  DatabaseBaseModelType,
  default as DatabaseBaseModel,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import AnalyticsModelPermission from "Common/Server/Types/AnalyticsDatabase/ModelPermission";
import QueryPermission from "Common/Server/Types/Database/Permissions/QueryPermission";
import QueryUtil from "Common/Server/Types/Database/QueryUtil";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
import {
  getTableColumns,
  TableColumnMetadata,
} from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import { ModelSchema } from "Common/Utils/Schema/ModelSchema";
import { getSchemaFieldNames } from "Common/Utils/Schema/SchemaFields";

interface DescribedField {
  type: string;
  description?: string;
  filter?: boolean;
  sort?: boolean;
  large?: boolean;
  writeOnly?: boolean;
}

interface Description {
  success: boolean;
  resource: string;
  tools: Record<string, string>;
  usage: Record<string, string>;
  operators: Record<string, JSONObject>;
  operatorsByType: Record<string, Array<string>>;
  example: { tool: string; arguments: JSONObject };
  fields: Record<string, DescribedField>;
}

// What a resource's largest answer may cost an agent: 6,000 tokens.
const MAX_DESCRIPTION_BYTES: number = 24_000;

const A_UUID: string = "5f0e8e3a-1f24-4a2f-9e4c-2b1d3c4e5f60";
const A_TIME: string = "2026-07-01T00:00:00.000Z";

const MAP_TYPE: string = "Map(String, String)";

// A database column filtered by its keys, as a telemetry map is.
const JSON_TYPE: string = TableColumnType.JSON;

// The column types, database and telemetry, that hold a number.
const NUMERIC_TYPE: RegExp = /Number|UInt|Decimal|Port/;

// The database number columns the helper sorts on beyond the sort schema.
const NUMBER_COLUMN_TYPES: Array<TableColumnType> = [
  TableColumnType.SmallNumber,
  TableColumnType.SmallPositiveNumber,
  TableColumnType.PositiveNumber,
  TableColumnType.BigNumber,
  TableColumnType.BigPositiveNumber,
];

const PROJECT_ID: ObjectID = ObjectID.generate();

// A project owner: who may do the most, as the API reads an agent's key.
const OWNER: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  userType: UserType.User,
  tenantId: PROJECT_ID,
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectOwner,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    },
  },
};

const allTools: Array<McpToolInfo> = generateAllTools();

const resourceTools: Array<McpToolInfo> = allTools.filter(
  (tool: McpToolInfo): boolean => {
    return (
      !isHelperTool(tool.name) &&
      !isPublicStatusPageTool(tool.name) &&
      !isWorkflowTool(tool.name)
    );
  },
);

const listTools: Array<McpToolInfo> = resourceTools.filter(
  (tool: McpToolInfo): boolean => {
    return tool.operation === OneUptimeOperation.List;
  },
);

function describeResource(resource: string): Description {
  return JSON.parse(
    handleHelperTool(
      "oneuptime_describe_resource",
      { resource },
      resourceTools,
    ),
  ) as Description;
}

function databaseModel(tool: McpToolInfo): DatabaseBaseModelType {
  return findModelClass(
    tool.tableName,
    ModelType.Database,
  ) as DatabaseBaseModelType;
}

function telemetryModel(tool: McpToolInfo): AnalyticsBaseModelType {
  return findModelClass(
    tool.tableName,
    ModelType.Analytics,
  ) as AnalyticsBaseModelType;
}

// A value a column of this type holds.
function valueFor(type: string): JSONValue {
  if (type.includes("Object ID") || type.includes("Entity")) {
    return A_UUID;
  }

  if (type.includes("Date")) {
    return A_TIME;
  }

  if (NUMERIC_TYPE.test(type)) {
    return 5;
  }

  if (type === "Boolean") {
    return true;
  }

  return "sample";
}

// An operator's syntax from the answer, with its placeholders filled in.
function fillIn(syntax: JSONObject, type: string): JSONObject {
  const filled: JSONObject = { ...syntax };

  for (const key of ["value", "startValue", "endValue"]) {
    if (key in filled) {
      filled[key] = Array.isArray(filled[key])
        ? ([valueFor(type)] as JSONValue)
        : valueFor(type);
    }
  }

  return filled;
}

// The MCP server's check of a filter lets this one through.
function expectNoFilterProblem(tool: McpToolInfo, query: JSONObject): void {
  expect([tool.name, query, getFilterProblem(tool, query)]).toEqual([
    tool.name,
    query,
    null,
  ]);
}

// What the API does with a database query, up to the database itself.
function runDatabaseQuery(
  modelType: DatabaseBaseModelType,
  query: JSONObject,
): void {
  const deserialized: JSONObject = JSONFunctions.deserialize(query);

  QueryPermission.checkQueryPermission(modelType, deserialized as never, OWNER);
  QueryUtil.serializeQuery(modelType, deserialized as never);
}

// What the API does with a telemetry query, up to ClickHouse itself.
function runTelemetryQuery(
  modelType: AnalyticsBaseModelType,
  query: JSONObject,
): Statement {
  const deserialized: JSONObject = JSONFunctions.deserialize(query);

  (
    AnalyticsModelPermission as unknown as {
      checkQueryPermission: (
        modelType: AnalyticsBaseModelType,
        query: JSONObject,
        props: DatabaseCommonInteractionProps,
      ) => void;
    }
  ).checkQueryPermission(modelType, deserialized, OWNER);

  const statement: Statement = new StatementGenerator({
    modelType,
    database: ClickhouseAppInstance,
  } as never).toWhereStatement(deserialized as never);

  // Reading these binds the parameters, which is where a bad value throws.
  expect(statement.query).not.toBe("");
  expect(statement.query_params).toBeDefined();

  return statement;
}

describe("oneuptime_describe_resource", () => {
  test("is a helper: it needs no credential, like the other two", () => {
    expect(isHelperTool("oneuptime_describe_resource")).toBe(true);

    const tool: McpToolInfo | undefined = allTools.find(
      (candidate: McpToolInfo): boolean => {
        return candidate.name === "oneuptime_describe_resource";
      },
    );

    expect(tool?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(tool?.inputSchema.required).toEqual(["resource"]);
  });

  test("covers every resource the tools were generated for", () => {
    expect(listTools.length).toBeGreaterThanOrEqual(52);

    for (const tool of listTools) {
      expect([tool.name, describeResource(tool.name).tools["list"]]).toEqual([
        tool.name,
        tool.name,
      ]);
    }
  });

  test.each([
    ["Incident"],
    ["Incidents"],
    ["incident"],
    ["list_incidents"],
    ["count_incidents"],
    ["create_incident"],
    ["get_incident"],
    ["update_incident"],
    ["delete_incident"],
  ])("finds a resource by %s", (name: string) => {
    expect(describeResource(name).resource).toBe("Incident");
  });

  /*
   * By the name people read (#6817), by the API name its tools keep, by its
   * model's name and by a tool's name.
   */
  test.each([
    ["Maintenance Event"],
    ["Scheduled Maintenance Event"],
    ["ScheduledMaintenance"],
    ["list_scheduled_maintenance_events"],
  ])("finds a resource of several words by %s", (name: string) => {
    expect(describeResource(name).resource).toBe("Maintenance Event");
  });

  test("finds telemetry by its name and not only its table", () => {
    expect(describeResource("Log").tools).toEqual({
      list: "list_logs",
      count: "count_logs",
    });
    expect(describeResource("list_logs").resource).toBe("Log");
    expect(describeResource("LogItemV3").resource).toBe("Log");
  });

  test.each([[{ resource: "nope" }], [{ resource: 5 }], [{}]])(
    "refuses %j, and says where the resources are",
    (args: Record<string, unknown>) => {
      expect(() => {
        return handleHelperTool(
          "oneuptime_describe_resource",
          args,
          resourceTools,
        );
      }).toThrow("Use oneuptime_list_resources to see the resources.");
    },
  );

  test("gives every field its type, what it means and what can be done with it", () => {
    const { fields, operatorsByType }: Description =
      describeResource("Incident");

    expect(fields["title"]).toEqual({
      type: "Long Text",
      description: "Title of this incident",
      filter: true,
      sort: true,
    });
    expect(operatorsByType["Long Text"]).toContain("Search");
    expect(operatorsByType["Date"]).toContain("GreaterThan");
    expect(operatorsByType["Date"]).toContain("InBetween");
    expect(operatorsByType["Object ID"]).toContain("Includes");
    expect(operatorsByType["Entity Array"]).toContain("Includes");
  });

  test("marks the fields that come back only when selected", () => {
    for (const tool of listTools.filter((candidate: McpToolInfo): boolean => {
      return candidate.modelType === ModelType.Database;
    })) {
      const heavyFields: Array<string> = getSelectableFieldsForModel(
        new (databaseModel(tool))() as DatabaseBaseModel,
      ).heavyFields;
      const { fields }: Description = describeResource(tool.name);

      expect([
        tool.name,
        Object.keys(fields).filter((name: string): boolean => {
          return fields[name]?.large === true;
        }),
      ]).toEqual([tool.name, heavyFields]);
    }

    expect(
      Object.values(describeResource("list_incidents").fields).some(
        (field: DescribedField): boolean => {
          return field.large === true;
        },
      ),
    ).toBe(true);
  });

  test("says a field can be written and not read, rather than leave it out", () => {
    expect(
      describeResource("list_data_stores").fields["connectionString"],
    ).toMatchObject({ writeOnly: true });
    expect(
      describeResource("list_data_stores").fields["connectionString"]?.filter,
    ).toBeUndefined();
  });

  test("gives an operator's syntax for each operator a type takes, and none it does not", () => {
    for (const tool of listTools) {
      const { operators, operatorsByType }: Description = describeResource(
        tool.name,
      );

      const taken: Array<string> = [
        ...new Set(Object.values(operatorsByType).flat()),
      ].sort();

      expect([tool.name, Object.keys(operators).sort()]).toEqual([
        tool.name,
        taken,
      ]);
    }
  });

  test("writes each operator as the API reads it, InBetween's two ends among them", () => {
    const { operators }: Description = describeResource("Incident");

    expect(operators["InBetween"]).toEqual({
      _type: "InBetween",
      startValue: expect.any(String),
      endValue: expect.any(String),
    });
    expect(operators["IsNull"]).toEqual({ _type: "IsNull" });
    expect(operators["NotNull"]).toEqual({ _type: "NotNull" });
    expect(operators["Includes"]).toEqual({
      _type: "Includes",
      value: [expect.any(String)],
    });
  });

  test(`costs an agent at most ${MAX_DESCRIPTION_BYTES} bytes, whichever resource it asks about`, () => {
    const overBudget: Array<[string, number]> = listTools
      .map((tool: McpToolInfo): [string, number] => {
        return [
          tool.name,
          Buffer.byteLength(
            handleHelperTool(
              "oneuptime_describe_resource",
              { resource: tool.name },
              resourceTools,
            ),
          ),
        ];
      })
      .filter(([, bytes]: [string, number]): boolean => {
        return bytes > MAX_DESCRIPTION_BYTES;
      });

    expect(overBudget).toEqual([]);
  });
});

describe("what it says of a database resource is what the API does", () => {
  const databaseTools: Array<McpToolInfo> = listTools.filter(
    (tool: McpToolInfo): boolean => {
      return tool.modelType === ModelType.Database;
    },
  );

  test("covers the records, so the checks below are not vacuous", () => {
    expect(databaseTools.length).toBeGreaterThanOrEqual(43);
  });

  test("offers every filter and sort the tools used to list, but for columns nobody may read", () => {
    for (const tool of databaseTools) {
      const modelType: DatabaseBaseModelType = databaseModel(tool);
      const model: DatabaseBaseModel = new modelType();
      const readable: Array<string> = getSelectableFieldsForModel(
        model as DatabaseBaseModel,
      ).allFields;
      const columns: Record<string, TableColumnMetadata> =
        getTableColumns(model);

      const { fields }: Description = describeResource(tool.name);

      expect([
        tool.name,
        Object.keys(fields)
          .filter((name: string): boolean => {
            return fields[name]?.filter === true;
          })
          .sort(),
      ]).toEqual([
        tool.name,
        getSchemaFieldNames(ModelSchema.getQueryModelSchema({ modelType }))
          .filter((name: string): boolean => {
            return readable.includes(name);
          })
          .sort(),
      ]);

      expect([
        tool.name,
        Object.keys(fields)
          .filter((name: string): boolean => {
            return fields[name]?.sort === true;
          })
          .sort(),
      ]).toEqual([
        tool.name,
        [
          ...new Set([
            ...getSchemaFieldNames(
              ModelSchema.getSortModelSchema({ modelType }),
            ),
            // And the number columns the sort schema leaves out.
            ...Object.keys(columns).filter((name: string): boolean => {
              return NUMBER_COLUMN_TYPES.includes(
                (columns[name] as TableColumnMetadata).type,
              );
            }),
          ]),
        ]
          .filter((name: string): boolean => {
            return readable.includes(name);
          })
          .sort(),
      ]);
    }
  });

  test("a JSON field is filtered by its keys, as the answer says", () => {
    const { usage, operatorsByType }: Description =
      describeResource("Incident");

    expect(usage["json"]).toBe(
      'A JSON field is filtered by its keys: {"customFields": {"<key>": <value or operator>}}. IsNull and NotNull on the field itself ask whether it holds anything.',
    );
    expect(operatorsByType[JSON_TYPE]).toEqual(
      expect.arrayContaining(["Search", "GreaterThan", "InBetween"]),
    );
  });

  test("offers no NotEqual on a relation list, which the API refuses", () => {
    const modelType: DatabaseBaseModelType = databaseModel(
      listTools.find((tool: McpToolInfo): boolean => {
        return tool.name === "list_incidents";
      }) as McpToolInfo,
    );

    expect(
      describeResource("Incident").operatorsByType["Entity Array"],
    ).toEqual(["EqualTo", "IsNull", "NotNull", "Includes"]);
    expect(() => {
      runDatabaseQuery(modelType, {
        labels: { _type: "NotEqual", value: [A_UUID] },
      });
    }).toThrow('Invalid ID for "labels"');
  });

  test("sorts on a number the sort schema leaves out, as the API does: a severity's order", () => {
    expect(describeResource("Incident Severity").fields["order"]).toMatchObject(
      { type: "Small Number", filter: true, sort: true },
    );
  });

  test("the API takes every operator it offers, on every field of every record", () => {
    let checked: number = 0;

    for (const tool of databaseTools) {
      const modelType: DatabaseBaseModelType = databaseModel(tool);
      const { fields, operators, operatorsByType }: Description =
        describeResource(tool.name);

      for (const [name, field] of Object.entries(fields)) {
        if (!field.filter) {
          continue;
        }

        // A JSON field is filtered by its keys, each key with a text value.
        const isJson: boolean = field.type === JSON_TYPE;
        const filterOn: (filter: JSONValue) => JSONObject = (
          filter: JSONValue,
        ): JSONObject => {
          return { [name]: isJson ? { aKey: filter } : filter };
        };

        // A plain value matches exactly.
        runDatabaseQuery(
          modelType,
          filterOn(valueFor(isJson ? "Text" : field.type)),
        );
        checked++;

        for (const operator of operatorsByType[field.type] || []) {
          const query: JSONObject = filterOn(
            fillIn(
              operators[operator] as JSONObject,
              isJson ? "Text" : field.type,
            ),
          );

          expectNoFilterProblem(tool, query);
          runDatabaseQuery(modelType, query);
          checked++;
        }
      }
    }

    expect(checked).toBeGreaterThan(8000);
  });

  // The check above would pass anything if the API's checks passed anything.
  test("the API refuses a field that does not exist, and one nobody may read", () => {
    const modelType: DatabaseBaseModelType = databaseModel(
      listTools.find((tool: McpToolInfo): boolean => {
        return tool.name === "list_incidents";
      }) as McpToolInfo,
    );

    expect(() => {
      runDatabaseQuery(modelType, { nope: "sample" });
    }).toThrow("Invalid column on Incident - nope. Column does not exist.");

    expect(() => {
      runDatabaseQuery(modelType, { deletedByUserId: A_UUID });
    }).toThrow("You do not have permissions to query on - deletedByUserId.");

    expect(
      describeResource("Incident").fields["deletedByUserId"],
    ).toBeUndefined();
  });

  test("the example of every record is a query the API takes", () => {
    for (const tool of databaseTools) {
      const { example, fields }: Description = describeResource(tool.name);
      const query: JSONObject = example.arguments["query"] as JSONObject;

      expect(example.tool).toBe(tool.name);

      for (const [name, syntax] of Object.entries(query)) {
        const filled: JSONObject = {
          [name]: fillIn(
            syntax as JSONObject,
            (fields[name] as DescribedField).type,
          ),
        };

        expectNoFilterProblem(tool, filled);
        runDatabaseQuery(databaseModel(tool), filled);
      }

      expect(example.arguments["sort"]).toEqual({ createdAt: "DESC" });
      expect(fields["createdAt"]?.sort).toBe(true);
    }
  });
});

describe("what it says of telemetry is what the API does", () => {
  const telemetryTools: Array<McpToolInfo> = listTools.filter(
    (tool: McpToolInfo): boolean => {
      return tool.modelType === ModelType.Analytics;
    },
  );

  test("covers the telemetry, so the checks below are not vacuous", () => {
    expect(telemetryTools.length).toBeGreaterThanOrEqual(9);
  });

  /*
   * Every telemetry table's time column is a DateTime64. The analytics schema
   * this reads once gave one no range operators and no sort, which told an
   * agent it could not do the one thing it must do on every query.
   */
  test("filters and sorts every table on its time column, which its tool names", () => {
    for (const tool of telemetryTools) {
      const model: AnalyticsBaseModel = new (telemetryModel(tool))();
      const timeColumn: string = model.defaultSortColumn;
      const { fields, operatorsByType, usage }: Description = describeResource(
        tool.name,
      );

      const field: DescribedField = fields[timeColumn] as DescribedField;

      expect([tool.name, field.filter, field.sort]).toEqual([
        tool.name,
        true,
        true,
      ]);
      expect(operatorsByType[field.type]).toEqual(
        expect.arrayContaining(["GreaterThan", "LessThan", "InBetween"]),
      );
      expect(usage["time"]).toContain(`always filter on ${timeColumn}`);
      expect(tool.description).toContain(`always filter on ${timeColumn}`);
      expect(tool.inputSchema.properties?.["sort"]?.description).toContain(
        `{"${timeColumn}":"DESC"}`,
      );
    }
  });

  test("offers every field the tools used to list, but for columns nobody may read", () => {
    for (const tool of telemetryTools) {
      const model: AnalyticsBaseModel = new (telemetryModel(tool))();
      const { fields }: Description = describeResource(tool.name);

      const unlisted: Array<string> = model
        .getTableColumns()
        .map((column: { key: string }): string => {
          return column.key;
        })
        .filter((name: string): boolean => {
          return fields[name]?.filter !== true;
        });

      expect([tool.name, unlisted.filter(Boolean)]).toEqual([
        tool.name,
        tool.name === "list_threat_intel_indicators" ? [] : ["retentionDate"],
      ]);
    }
  });

  test("the API takes every operator it offers, on every field of every table", () => {
    let checked: number = 0;

    for (const tool of telemetryTools) {
      const modelType: AnalyticsBaseModelType = telemetryModel(tool);
      const { fields, operators, operatorsByType }: Description =
        describeResource(tool.name);

      for (const [name, field] of Object.entries(fields)) {
        for (const operator of operatorsByType[field.type] || []) {
          const filled: JSONObject = fillIn(
            operators[operator] as JSONObject,
            field.type === MAP_TYPE ? "Text" : field.type,
          );

          const query: JSONObject = {
            [name]: field.type === MAP_TYPE ? { aKey: filled } : filled,
          };

          expectNoFilterProblem(tool, query);
          runTelemetryQuery(modelType, query);
          checked++;
        }
      }
    }

    expect(checked).toBeGreaterThan(1500);
  });

  test("the API sorts on every field it marks, and orders on no other", () => {
    for (const tool of telemetryTools) {
      const modelType: AnalyticsBaseModelType = telemetryModel(tool);
      const generator: StatementGenerator<AnalyticsBaseModel> =
        new StatementGenerator({
          modelType,
          database: ClickhouseAppInstance,
        } as never);

      for (const [name, field] of Object.entries(
        describeResource(tool.name).fields,
      )) {
        if (field.sort) {
          expect(
            generator.toSortStatement({ [name]: "DESC" } as never).query,
          ).toContain("DESC");
        }
      }
    }
  });

  test("a time filter reaches ClickHouse as a time, from the ISO-8601 an agent writes", () => {
    const log: AnalyticsBaseModelType = telemetryModel(
      listTools.find((tool: McpToolInfo): boolean => {
        return tool.name === "list_logs";
      }) as McpToolInfo,
    );

    const statement: Statement = runTelemetryQuery(log, {
      time: { _type: "GreaterThan", value: A_TIME },
    });

    expect(statement.query).toContain("{p1:DateTime64(9)}");
    expect(statement.query_params["p1"]).toBe("2026-07-01 00:00:00.000000000");
  });

  test("a map field is filtered by its keys, as the answer says", () => {
    const log: AnalyticsBaseModelType = telemetryModel(
      listTools.find((tool: McpToolInfo): boolean => {
        return tool.name === "list_logs";
      }) as McpToolInfo,
    );

    expect(describeResource("Log").usage["maps"]).toBe(
      'A Map(String, String) field is filtered by its keys: {"attributes": {"<key>": <value or operator>}}.',
    );
    expect(
      runTelemetryQuery(log, { attributes: { "http.method": "GET" } }).query,
    ).toContain("[{p4:String}]");
  });

  // The checks above would pass anything if the API's checks passed anything.
  test("the API refuses a field that does not exist, and one nobody may read", () => {
    const log: AnalyticsBaseModelType = telemetryModel(
      listTools.find((tool: McpToolInfo): boolean => {
        return tool.name === "list_logs";
      }) as McpToolInfo,
    );

    expect(() => {
      runTelemetryQuery(log, { nope: "sample" });
    }).toThrow("Invalid column on Log - nope. Column does not exist.");

    expect(() => {
      runTelemetryQuery(log, {
        retentionDate: { _type: "GreaterThan", value: A_TIME },
      });
    }).toThrow("You do not have permissions to query on - retentionDate.");

    expect(describeResource("Log").fields["retentionDate"]).toBeUndefined();
  });

  test("the example of every table is a query the API takes, on its time column", () => {
    for (const tool of telemetryTools) {
      const { example, fields }: Description = describeResource(tool.name);
      const model: AnalyticsBaseModel = new (telemetryModel(tool))();
      const query: JSONObject = example.arguments["query"] as JSONObject;

      expect(query).toHaveProperty(model.defaultSortColumn);
      expect(example.arguments["sort"]).toEqual({
        [model.defaultSortColumn]: "DESC",
      });

      for (const [name, syntax] of Object.entries(query)) {
        const filled: JSONObject = {
          [name]: fillIn(
            syntax as JSONObject,
            (fields[name] as DescribedField).type,
          ),
        };

        expectNoFilterProblem(tool, filled);
        runTelemetryQuery(telemetryModel(tool), filled);
      }
    }
  });

  test("searches a log's body and a span's name in its example, not the first text column", () => {
    const logQuery: JSONObject = describeResource("Log").example.arguments[
      "query"
    ] as JSONObject;
    const spanQuery: JSONObject = describeResource("Span").example.arguments[
      "query"
    ] as JSONObject;

    expect(Object.keys(logQuery)).toContain("body");
    expect(Object.keys(spanQuery)).toContain("name");
  });

  test("says telemetry has no large fields to ask for, and to select little", () => {
    expect(describeResource("Log").usage["select"]).toContain(
      "telemetry rows can be large",
    );
    expect(describeResource("Incident").usage["select"]).toContain(
      "marked large",
    );
  });
});
