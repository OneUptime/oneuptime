import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import Models from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import UserAttribution from "../../../Types/Database/UserAttribution";
import { JSONObject } from "../../../Types/JSON";
import {
  getTerraformAttributes,
  getTerraformTypeName,
  TerraformAttributeDescriptor,
  toTerraformSnakeCase,
} from "../../../Utils/DeveloperDocs/TerraformSchema";
import { ModelSchema } from "../../../Utils/Schema/ModelSchema";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import {
  TerraformAttribute,
  TerraformResource,
} from "../../../../../Scripts/TerraformProvider/Core/Types";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * WHO DID SOMETHING TO A RECORD IS FOR ONEUPTIME TO SAY.
 *
 * Every model records who created a record, and many record who archived,
 * acknowledged, triggered or resolved it, in columns named for the act:
 * `createdByUserId`, and the relation over it, `createdByUser`. No request
 * writes them - not a person's, not an API key's, not a workflow's -
 * DatabaseService decides each one (DatabaseServiceUserAttribution.test.ts),
 * and the column decorators close them to every write (UserAttribution).
 *
 * The rule follows the name, so it covers a new model the moment its
 * columns are declared. This holds every model to it: every column that
 * records a person doing something is one the rule covers, it is closed and
 * computed, and the API reference and the Terraform provider - which are
 * generated from that metadata - offer it for reading only.
 */

type ModelType = DatabaseBaseModelType;

interface AttributionColumn {
  table: string;
  column: string;
  modelType: ModelType;
}

/*
 * Columns that name a person by text beside a deleted project: written once,
 * by OneUptime, when the project is deleted, and closed to every request by
 * their own declarations.
 */
const SNAPSHOT_COLUMNS: ReadonlyArray<string> = [
  "DeletedProject.projectCreatedByUserName",
  "DeletedProject.projectCreatedByUserEmail",
  "DeletedProject.projectDeletedByUserName",
  "DeletedProject.projectDeletedByUserEmail",
];

// Anything that reads like "<act> by user": the rule's name, or near it.
const LOOKS_LIKE_A_PERSON_WHO_ACTED: RegExp = /By[A-Z]?\w*User/;

function tableOf(modelType: ModelType): string {
  return new modelType().tableName || modelType.name;
}

const ATTRIBUTION_COLUMNS: Array<AttributionColumn> = (
  Models as Array<ModelType>
).flatMap((modelType: ModelType): Array<AttributionColumn> => {
  const model: DatabaseBaseModel = new modelType();

  return UserAttribution.getColumns(model).map(
    (column: string): AttributionColumn => {
      return { table: tableOf(modelType), column, modelType };
    },
  );
});

function attributionIn(table: string): Array<string> {
  return ATTRIBUTION_COLUMNS.filter((entry: AttributionColumn): boolean => {
    return entry.table === table;
  }).map((entry: AttributionColumn): string => {
    return entry.column;
  });
}

describe("which columns record a person doing something", () => {
  test("the sweep sees them on every model", () => {
    expect(ATTRIBUTION_COLUMNS.length).toBeGreaterThan(1500);

    expect(attributionIn("Incident")).toEqual(
      expect.arrayContaining([
        "createdByUser",
        "createdByUserId",
        "deletedByUser",
        "deletedByUserId",
      ]),
    );
    expect(attributionIn("Monitor")).toEqual(
      expect.arrayContaining(["archivedByUser", "archivedByUserId"]),
    );
    expect(attributionIn("TelemetryException")).toEqual(
      expect.arrayContaining([
        "markedAsResolvedByUser",
        "markedAsResolvedByUserId",
        "markedAsArchivedByUser",
        "markedAsArchivedByUserId",
      ]),
    );
    expect(attributionIn("OnCallDutyPolicyExecutionLog")).toEqual(
      expect.arrayContaining([
        "acknowledgedByUserId",
        "triggeredByUser",
        "triggeredByUserId",
      ]),
    );
    expect(attributionIn("IncidentEpisodeMember")).toEqual(
      expect.arrayContaining(["addedByUser", "addedByUserId"]),
    );
    expect(attributionIn("RunbookExecution")).toEqual(
      expect.arrayContaining(["triggeredByUser", "triggeredByUserId"]),
    );
  });

  test("every column named for a person doing something is one the rule covers", () => {
    const uncovered: Array<string> = [];

    for (const modelType of Models as Array<ModelType>) {
      const model: DatabaseBaseModel = new modelType();
      const covered: Array<string> = UserAttribution.getColumns(model);

      for (const column of model.getTableColumns().columns) {
        const name: string = `${tableOf(modelType)}.${column}`;

        if (
          LOOKS_LIKE_A_PERSON_WHO_ACTED.test(column) &&
          !covered.includes(column) &&
          !SNAPSHOT_COLUMNS.includes(name)
        ) {
          uncovered.push(name);
        }
      }
    }

    expect(uncovered).toEqual([]);
  });

  test("the text kept beside a deleted project is closed to every request", () => {
    for (const name of SNAPSHOT_COLUMNS) {
      const [table, column] = name.split(".") as [string, string];
      const modelType: ModelType = (Models as Array<ModelType>).find(
        (candidate: ModelType): boolean => {
          return tableOf(candidate) === table;
        },
      )!;
      const accessControl: ColumnAccessControl | null =
        new modelType().getColumnAccessControlFor(column);

      expect({ name, create: accessControl?.create || [] }).toEqual({
        name,
        create: [],
      });
      expect({ name, update: accessControl?.update || [] }).toEqual({
        name,
        update: [],
      });
    }
  });

  test("each is a user's id, or the relation to that user", () => {
    const wrong: Array<string> = [];

    for (const entry of ATTRIBUTION_COLUMNS) {
      const metadata: TableColumnMetadata = new entry.modelType()
        .getTableColumnMetadata(entry.column);

      const isUserId: boolean = metadata.type === TableColumnType.ObjectID;
      const isUserRelation: boolean =
        metadata.type === TableColumnType.Entity &&
        metadata.modelType?.name === "User";

      if (!isUserId && !isUserRelation) {
        wrong.push(`${entry.table}.${entry.column}: ${metadata.type}`);
      }
    }

    expect(wrong).toEqual([]);
  });

  test("a relation over one of those ID columns is named for the act too", () => {
    const wrong: Array<string> = [];

    for (const entry of ATTRIBUTION_COLUMNS) {
      if (!UserAttribution.isColumn(entry.column)) {
        wrong.push(`${entry.table}.${entry.column}`);
      }
    }

    expect(wrong).toEqual([]);
  });

  test("the analytics models record no person doing something", () => {
    const found: Array<string> = [];

    for (const modelType of AnalyticsModels as Array<{ new (): unknown }>) {
      const model: {
        tableName?: string;
        getTableColumns: () => Array<{ key: string }>;
      } = new modelType() as {
        tableName?: string;
        getTableColumns: () => Array<{ key: string }>;
      };

      for (const column of model.getTableColumns()) {
        if (
          UserAttribution.isColumn(column.key) ||
          LOOKS_LIKE_A_PERSON_WHO_ACTED.test(column.key)
        ) {
          found.push(`${model.tableName}.${column.key}`);
        }
      }
    }

    /*
     * The rule is applied by the database models' column decorators; an
     * analytics model that starts recording who did something needs it too.
     */
    expect(found).toEqual([]);
  });
});

describe("each is closed to every write", () => {
  test("no request creates or updates one, and each is computed", () => {
    const wrong: Array<string> = [];

    for (const entry of ATTRIBUTION_COLUMNS) {
      const model: DatabaseBaseModel = new entry.modelType();
      const accessControl: ColumnAccessControl | null =
        model.getColumnAccessControlFor(entry.column);

      if (
        (accessControl?.create || []).length > 0 ||
        (accessControl?.update || []).length > 0 ||
        !model.getTableColumnMetadata(entry.column).computed
      ) {
        wrong.push(`${entry.table}.${entry.column}`);
      }
    }

    expect(wrong).toEqual([]);
  });

  test("who may read one is left as each model declares it", () => {
    const incidentCreator: ColumnAccessControl | null =
      new (
        (Models as Array<ModelType>).find((modelType: ModelType): boolean => {
          return tableOf(modelType) === "Incident";
        }) as ModelType
      )().getColumnAccessControlFor("createdByUserId");

    expect((incidentCreator?.read || []).length).toBeGreaterThan(0);
  });
});

describe("the API offers each for reading only", () => {
  function shapeKeys(schema: unknown): Array<string> {
    return Object.keys((schema as { shape: Record<string, unknown> }).shape);
  }

  test("no create or update schema has one", () => {
    const writable: Array<string> = [];

    for (const modelType of Models as Array<ModelType>) {
      const columns: Array<string> = UserAttribution.getColumns(
        new modelType(),
      );

      if (columns.length === 0) {
        continue;
      }

      const createKeys: Array<string> = shapeKeys(
        ModelSchema.getCreateModelSchema({ modelType }),
      );
      const updateKeys: Array<string> = shapeKeys(
        ModelSchema.getUpdateModelSchema({ modelType }),
      );

      for (const column of columns) {
        if (createKeys.includes(column)) {
          writable.push(`${tableOf(modelType)}.${column} (create)`);
        }

        if (updateKeys.includes(column)) {
          writable.push(`${tableOf(modelType)}.${column} (update)`);
        }
      }
    }

    expect(writable).toEqual([]);
  });

  describe("in the published OpenAPI document", () => {
    let schemas: Record<string, JSONObject>;

    beforeAll(() => {
      const spec: JSONObject = OpenAPIUtil.generateOpenAPISpec();
      schemas = (spec["components"] as JSONObject)["schemas"] as Record<
        string,
        JSONObject
      >;
    });

    function properties(schemaName: string): Record<string, JSONObject> {
      return (
        ((schemas[schemaName] || {}) as JSONObject)["properties"] as
          | Record<string, JSONObject>
          | undefined
      ) || {};
    }

    test("a read schema marks each read-only, and no write schema has one", () => {
      const wrong: Array<string> = [];
      let readOnlySeen: number = 0;

      for (const entry of ATTRIBUTION_COLUMNS) {
        const read: JSONObject | undefined = properties(
          `${entry.table}ReadSchema`,
        )[entry.column];

        if (read) {
          if (read["readOnly"] !== true) {
            wrong.push(`${entry.table}ReadSchema.${entry.column} is writable`);
          } else {
            readOnlySeen++;
          }
        }

        for (const suffix of ["CreateSchema", "UpdateSchema"]) {
          if (properties(`${entry.table}${suffix}`)[entry.column]) {
            wrong.push(`${entry.table}${suffix}.${entry.column}`);
          }
        }
      }

      expect(wrong).toEqual([]);
      expect(readOnlySeen).toBeGreaterThan(100);
      expect(properties("IncidentReadSchema")["createdByUserId"]).toEqual(
        expect.objectContaining({ readOnly: true }),
      );
    });

    test("the Terraform provider generated from it computes each, never takes it", () => {
      const parser: OpenAPIParser = new OpenAPIParser();
      parser.setSpec(OpenAPIUtil.generateOpenAPISpec() as JSONObject as never);

      const resources: Map<string, TerraformResource> = new Map<
        string,
        TerraformResource
      >();

      for (const resource of parser.getResources()) {
        resources.set(`oneuptime_${resource.name}`, resource);
      }

      const takes: Array<string> = [];
      let computedSeen: number = 0;

      for (const modelType of Models as Array<ModelType>) {
        const typeName: string | null = getTerraformTypeName(modelType);
        const resource: TerraformResource | undefined = typeName
          ? resources.get(typeName)
          : undefined;

        if (!resource) {
          continue;
        }

        for (const column of UserAttribution.getColumns(new modelType())) {
          const attribute: TerraformAttribute | undefined =
            resource.schema[toTerraformSnakeCase(column)];

          if (!attribute) {
            continue;
          }

          if (attribute.required || attribute.optional || !attribute.computed) {
            takes.push(`${typeName}.${toTerraformSnakeCase(column)}`);
          } else {
            computedSeen++;
          }
        }
      }

      expect(takes).toEqual([]);
      expect(computedSeen).toBeGreaterThan(100);

      const incident: TerraformResource | undefined =
        resources.get("oneuptime_incident");

      expect(incident?.schema["created_by_user_id"]).toEqual(
        expect.objectContaining({ computed: true }),
      );
      expect(incident?.schema["created_by_user_id"]?.optional).toBeFalsy();
      expect(incident?.schema["created_by_user_id"]?.required).toBeFalsy();
    });
  });

  test("the dashboard's Terraform pages offer none as an attribute to set", () => {
    const offered: Array<string> = [];

    for (const modelType of Models as Array<ModelType>) {
      for (const descriptor of getTerraformAttributes(modelType)) {
        if (UserAttribution.isColumn(descriptor.columnName)) {
          offered.push(
            `${tableOf(modelType)}.${(descriptor as TerraformAttributeDescriptor).columnName}`,
          );
        }
      }
    }

    expect(offered).toEqual([]);
  });
});
