import { describe, expect, test } from "@jest/globals";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Models from "../../../Models/DatabaseModels/Index";
import QueryUtil from "../../../Server/Types/Database/QueryUtil";
import Dictionary from "../../../Types/Dictionary";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import {
  DeveloperDocsApiBody,
  DeveloperDocsApiFilter,
  DeveloperDocsApiTask,
  DeveloperDocsExampleContext,
  DeveloperDocsTerraformExample,
  DeveloperDocsTerraformRecipe,
  getApiCreateExample,
  getApiFilters,
  getApiReadSelect,
  getApiTasks,
  getApiUpdateExample,
  getDeveloperDocsFieldAbout,
  getTerraformCreateExample,
  getTerraformRecipes,
  isPlaceholderText,
} from "../../../Utils/DeveloperDocs/ExampleBuilder";
import {
  DEVELOPER_DOCS_PROFILES,
  DeveloperDocsField,
  DeveloperDocsFilter,
  DeveloperDocsProfile,
  DeveloperDocsQueryPart,
  DeveloperDocsRecipe,
  DeveloperDocsScopeName,
  DeveloperDocsTask,
  getDeveloperDocsProfileFields,
} from "../../../Utils/DeveloperDocs/ResourceProfiles";
import {
  getNameColumn,
  getTerraformAttributes,
  getTerraformTypeName,
  TerraformAttributeDescriptor,
} from "../../../Utils/DeveloperDocs/TerraformSchema";
import { ModelSchema } from "../../../Utils/Schema/ModelSchema";
import {
  FIXTURE_RECORD_ID,
  getEmptyFixtureLiveData,
  getFixtureLiveData,
} from "./DeveloperDocsLiveFixture";

/*
 * Every resource's profile, held to the models, the Terraform provider's
 * schema (through TerraformSchema, itself held to the real provider by
 * TerraformProviderSchemaContract.test.ts) and the API's own request
 * rules. The profiles are hand-written, so this is what keeps them true:
 *
 *   - every field is a column the resource can be created with, never a
 *     secret, and the examples set every required one;
 *   - every recipe and task builds, in every scope it is for, with the
 *     project's records and without any;
 *   - every request body sends only fields the create or update schema has,
 *     each in a shape the API reads (a list relation as {_id} objects, a
 *     date as an RFC 3339 string, monitor steps as the server parses them);
 *   - every query goes through the server's own query pipeline
 *     (JSONFunctions.deserialize, then QueryUtil.serializeQuery) and uses
 *     an operator the API documents for that column's type.
 */

const PROFILE_TABLES: Array<string> = Object.keys(DEVELOPER_DOCS_PROFILES);

// A sentence: a capital, a few words, a full stop or question mark.
const A_SENTENCE: RegExp = /^[A-Z].{5,200}[.?]$/;
// "...such as e.g." is a sentence cut short.
const ENDS_IN_ABBREVIATION: RegExp = /\b(e\.g|i\.e)\.$/;

function modelFor(tableName: string): DatabaseBaseModelType {
  const modelType: DatabaseBaseModelType | undefined = (
    Models as Array<DatabaseBaseModelType>
  ).find((candidate: DatabaseBaseModelType): boolean => {
    return new candidate().tableName === tableName;
  });

  if (!modelType) {
    throw new Error(`No model for ${tableName}`);
  }

  return modelType;
}

function columnsOf(
  modelType: DatabaseBaseModelType,
): Dictionary<TableColumnMetadata> {
  return getTableColumns(new modelType());
}

function project(): DeveloperDocsExampleContext {
  return { live: getFixtureLiveData() };
}

function recordPage(): DeveloperDocsExampleContext {
  return {
    live: getFixtureLiveData(),
    record: {
      id: FIXTURE_RECORD_ID,
      displayName: "Example",
      json: {},
      terraformAddress: "oneuptime_example.example",
    },
  };
}

function emptyRecordPage(): DeveloperDocsExampleContext {
  return { ...recordPage(), live: getEmptyFixtureLiveData() };
}

const UUID: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isIdOrPlaceholder(value: unknown): boolean {
  return (
    typeof value === "string" && (UUID.test(value) || isPlaceholderText(value))
  );
}

/*
 * Whether a request body's field is one the API takes, in a shape it reads.
 * The documented schema is the oracle, except where the API reads more than
 * the schema describes: a list relation is sent as {_id} objects (what the
 * Terraform provider sends), a date as an RFC 3339 string (ditto), and
 * monitor steps without the ids the server assigns (ditto).
 */
function fieldProblems(data: {
  modelType: DatabaseBaseModelType;
  body: JSONObject;
  operation: "create" | "update";
}): Array<string> {
  const schema: {
    shape: Dictionary<{
      safeParse: (value: unknown) => { success: boolean; error?: unknown };
      isOptional: () => boolean;
    }>;
  } = (
    data.operation === "create"
      ? ModelSchema.getCreateModelSchema({
          modelType: data.modelType,
          disableOpenApiSchema: true,
        })
      : ModelSchema.getUpdateModelSchema({
          modelType: data.modelType,
          disableOpenApiSchema: true,
        })
  ) as never;
  const columns: Dictionary<TableColumnMetadata> = columnsOf(data.modelType);
  const problems: Array<string> = [];

  for (const key of Object.keys(data.body)) {
    const value: JSONValue = data.body[key] as JSONValue;
    const column: TableColumnMetadata | undefined = columns[key];

    if (!schema.shape[key] || !column) {
      problems.push(`${key} is not in the ${data.operation} schema`);
      continue;
    }

    if (column.type === TableColumnType.EntityArray) {
      if (
        !Array.isArray(value) ||
        !value.every((item: JSONValue): boolean => {
          return (
            typeof item === "object" &&
            item !== null &&
            isIdOrPlaceholder((item as JSONObject)["_id"])
          );
        })
      ) {
        problems.push(`${key} must be a list of {_id} objects`);
      }
      continue;
    }

    if (column.type === TableColumnType.Date) {
      if (typeof value !== "string" || isNaN(Date.parse(value))) {
        problems.push(`${key} must be an RFC 3339 date`);
      }
      continue;
    }

    if (column.type === TableColumnType.MonitorSteps) {
      try {
        MonitorSteps.fromJSON(value as JSONObject);
      } catch (error) {
        problems.push(`${key}: ${String(error)}`);
      }
      continue;
    }

    if (column.type === TableColumnType.ObjectID && isIdOrPlaceholder(value)) {
      continue;
    }

    const parsed: { success: boolean; error?: unknown } =
      schema.shape[key].safeParse(value);

    if (!parsed.success) {
      problems.push(`${key}: ${JSON.stringify(parsed.error)}`);
    }
  }

  if (data.operation === "create") {
    for (const key of Object.keys(schema.shape)) {
      if (!schema.shape[key]?.isOptional() && data.body[key] === undefined) {
        problems.push(`the required ${key} is missing`);
      }
    }
  }

  return problems;
}

// The operators the API documents for a column type (ModelSchema's own list).
function documentedOperators(type: TableColumnType): Array<string> {
  return (
    ModelSchema as unknown as {
      getValidOperatorsForColumnType: (type: TableColumnType) => Array<string>;
    }
  ).getValidOperatorsForColumnType(type);
}

function queryProblems(data: {
  modelType: DatabaseBaseModelType;
  body: JSONObject;
}): Array<string> {
  const columns: Dictionary<TableColumnMetadata> = columnsOf(data.modelType);
  const problems: Array<string> = [];
  const query: JSONObject = (data.body["query"] || {}) as JSONObject;

  for (const key of Object.keys(query)) {
    const column: TableColumnMetadata | undefined = columns[key];
    const value: JSONValue = query[key] as JSONValue;

    if (!column) {
      problems.push(`query: no column ${key}`);
      continue;
    }

    if (column.type === TableColumnType.EntityArray) {
      if (!Array.isArray(value) || !value.every(isIdOrPlaceholder)) {
        problems.push(`query: ${key} takes a plain list of ids`);
      }
      continue;
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const operator: string = String((value as JSONObject)["_type"]);

      if (!documentedOperators(column.type).includes(operator)) {
        problems.push(`query: ${operator} is not documented for ${key}`);
      }
    }
  }

  try {
    QueryUtil.serializeQuery(
      data.modelType,
      JSONFunctions.deserialize(query) as never,
    );
  } catch (error) {
    problems.push(`query: the server refuses it: ${String(error)}`);
  }

  for (const key of Object.keys((data.body["select"] || {}) as JSONObject)) {
    const column: TableColumnMetadata | undefined = columns[key];

    if (!column) {
      problems.push(`select: no column ${key}`);
    } else if (column.type === TableColumnType.Entity) {
      problems.push(`select: ${key} is a relation object`);
    }
  }

  for (const key of Object.keys((data.body["sort"] || {}) as JSONObject)) {
    if (!columns[key]) {
      problems.push(`sort: no column ${key}`);
    }
  }

  return problems;
}

describe("profiles", () => {
  test("there is one for every kind of resource with Developer pages (the Dashboard registry is checked in its own suite)", () => {
    expect(PROFILE_TABLES.length).toBeGreaterThanOrEqual(37);
  });
});

describe.each(PROFILE_TABLES)("%s", (tableName: string) => {
  const modelType: DatabaseBaseModelType = modelFor(tableName);
  const profile: DeveloperDocsProfile = DEVELOPER_DOCS_PROFILES[
    tableName
  ] as DeveloperDocsProfile;
  const fields: Array<DeveloperDocsField> =
    getDeveloperDocsProfileFields(profile);
  const attributes: Array<TerraformAttributeDescriptor> =
    getTerraformAttributes(modelType);
  const columns: Dictionary<TableColumnMetadata> = columnsOf(modelType);

  test("its fields are columns it can be created with, none of them a secret or a name Terraform reserves", () => {
    for (const field of fields) {
      const descriptor: TerraformAttributeDescriptor | undefined =
        attributes.find((item: TerraformAttributeDescriptor): boolean => {
          return item.columnName === field.column;
        });

      expect({
        field: field.column,
        column: Boolean(columns[field.column]),
      }).toEqual({
        field: field.column,
        column: true,
      });
      expect({
        field: field.column,
        creatable: Boolean(descriptor?.inCreateSchema),
        secret: Boolean(descriptor?.secretKind),
        reserved: Boolean(descriptor?.isReservedName),
      }).toEqual({
        field: field.column,
        creatable: true,
        secret: false,
        reserved: false,
      });
    }
  });

  test("no field twice", () => {
    const names: Array<string> = fields.map((field: DeveloperDocsField) => {
      return field.column;
    });

    expect(new Set(names).size).toBe(names.length);
  });

  test("its name field comes first, and its example reads as a name", () => {
    const nameColumn: string | null = getNameColumn(modelType);

    expect(fields[0]?.column).toBe(nameColumn);

    const value: unknown =
      fields[0]?.value?.kind === "literal" ? fields[0].value.value : undefined;

    expect(typeof value).toBe("string");
    expect((value as string).length).toBeLessThanOrEqual(60);
  });

  test("every field says what it is for, in a sentence", () => {
    for (const field of fields) {
      const about: string = getDeveloperDocsFieldAbout({ modelType, field });

      expect({
        field: field.column,
        about,
        ok: A_SENTENCE.test(about) && !ENDS_IN_ABBREVIATION.test(about),
      }).toEqual({ field: field.column, about, ok: true });
    }
  });

  test("as Terraform: a new one with the project's records has nothing to fill in", () => {
    const example: DeveloperDocsTerraformExample | null =
      getTerraformCreateExample({ modelType, context: project() });

    if (profile.terraformCannotCreate) {
      expect(example).toBeNull();
      return;
    }

    expect(example).not.toBeNull();
    expect(example!.isPlaceholder).toBe(false);
    expect(example!.hcl).toContain(
      `resource "${getTerraformTypeName(modelType)}"`,
    );

    // Every required attribute is written.
    for (const descriptor of attributes) {
      if (descriptor.isRequired) {
        expect(example!.hcl).toMatch(
          new RegExp(`\\n\\s+${descriptor.attributeName}\\s+=`),
        );
      }
    }
  });

  test("as Terraform: a new one with nothing looked up still builds, with placeholders only where it must", () => {
    const example: DeveloperDocsTerraformExample | null =
      getTerraformCreateExample({
        modelType,
        context: { live: getEmptyFixtureLiveData() },
      });

    if (profile.terraformCannotCreate) {
      expect(example).toBeNull();
      return;
    }

    for (const line of (example?.hcl || "").split("\n")) {
      if (line.includes("<")) {
        const attributeName: string = line.trim().split(/\s+/)[0] || "";
        const descriptor: TerraformAttributeDescriptor | undefined =
          attributes.find((item: TerraformAttributeDescriptor): boolean => {
            return item.attributeName === attributeName;
          });

        // Inside monitor steps, or a required attribute.
        expect({
          line: line.trim(),
          ok: !descriptor || descriptor.isRequired,
        }).toEqual({ line: line.trim(), ok: true });
      }
    }
  });

  test.each(["list", "view"] as Array<DeveloperDocsScopeName>)(
    "its recipes build on the %s page, with and without the project's records",
    (scope: DeveloperDocsScopeName) => {
      const recipes: Array<DeveloperDocsRecipe> = (
        profile.recipes || []
      ).filter((recipe: DeveloperDocsRecipe): boolean => {
        return recipe.scopes.includes(scope);
      });
      const withProject: Array<DeveloperDocsTerraformRecipe> =
        getTerraformRecipes({
          modelType,
          scope,
          context: scope === "view" ? recordPage() : project(),
        });
      const without: Array<DeveloperDocsTerraformRecipe> = getTerraformRecipes({
        modelType,
        scope,
        context:
          scope === "view"
            ? emptyRecordPage()
            : { live: getEmptyFixtureLiveData() },
      });

      expect(withProject).toHaveLength(recipes.length);
      expect(without).toHaveLength(recipes.length);
      expect(
        new Set(
          recipes.map((recipe: DeveloperDocsRecipe): string => {
            return recipe.title;
          }),
        ).size,
      ).toBe(recipes.length);

      for (const recipe of withProject) {
        expect({
          recipe: recipe.title,
          placeholder: recipe.isPlaceholder,
        }).toEqual({
          recipe: recipe.title,
          placeholder: false,
        });
        expect(recipe.description.length).toBeGreaterThan(10);
      }
    },
  );

  test("as an API request: a new one sends only fields the create schema has, in shapes the API reads", () => {
    const create: DeveloperDocsApiBody = getApiCreateExample({
      modelType,
      context: project(),
    });

    expect(
      fieldProblems({ modelType, body: create.body, operation: "create" }),
    ).toEqual([]);
    expect(create.isPlaceholder).toBe(false);
  });

  test("as an API request: the change it makes is to fields the update schema has", () => {
    const update: { data: JSONObject } | null = getApiUpdateExample({
      modelType,
      context: recordPage(),
    });

    expect(update).not.toBeNull();
    expect(
      fieldProblems({ modelType, body: update!.data, operation: "update" }),
    ).toEqual([]);
  });

  test("as an API request: a read asks for columns, never a relation object", () => {
    expect(
      queryProblems({
        modelType,
        body: { select: getApiReadSelect(modelType) },
      }),
    ).toEqual([]);
  });

  test("as an API request: every filter goes through the server's query pipeline", () => {
    const filters: Array<DeveloperDocsApiFilter> = getApiFilters({
      modelType,
      context: project(),
    });

    // With the project's records, none is left out.
    expect(filters).toHaveLength((profile.filters || []).length);

    for (const filter of filters) {
      expect({
        filter: filter.title,
        problems: queryProblems({ modelType, body: filter.body }),
      }).toEqual({ filter: filter.title, problems: [] });
      expect(filter.description).not.toContain("{name}");
    }
  });

  test("as an API request: every task is a valid request on its own resource", () => {
    const tasks: Array<DeveloperDocsApiTask> = getApiTasks({
      modelType,
      scope: "view",
      context: recordPage(),
    });

    expect(tasks).toHaveLength(
      (profile.tasks || []).filter((task: DeveloperDocsTask): boolean => {
        return task.scopes.includes("view");
      }).length,
    );

    for (const task of tasks) {
      const problems: Array<string> =
        task.operation === "create"
          ? fieldProblems({
              modelType: task.modelType,
              body: task.body["data"] as JSONObject,
              operation: "create",
            })
          : queryProblems({ modelType: task.modelType, body: task.body });

      expect({
        task: task.title,
        problems,
        placeholder: task.isPlaceholder,
      }).toEqual({
        task: task.title,
        problems: [],
        placeholder: false,
      });
      expect(task.description).not.toContain("{name}");
    }
  });

  test("filters and tasks only name columns that exist", () => {
    const parts: Array<{
      modelType: DatabaseBaseModelType;
      part: DeveloperDocsQueryPart;
    }> = [
      ...(profile.filters || []).flatMap((filter: DeveloperDocsFilter) => {
        return filter.query.map((part: DeveloperDocsQueryPart) => {
          return { modelType, part };
        });
      }),
      ...(profile.tasks || []).flatMap((task: DeveloperDocsTask) => {
        return (task.query || []).map((part: DeveloperDocsQueryPart) => {
          return { modelType: task.modelType, part };
        });
      }),
    ];

    for (const { modelType: partModel, part } of parts) {
      expect({
        column: part.column,
        exists: Boolean(columnsOf(partModel)[part.column]),
      }).toEqual({ column: part.column, exists: true });
    }
  });
});
