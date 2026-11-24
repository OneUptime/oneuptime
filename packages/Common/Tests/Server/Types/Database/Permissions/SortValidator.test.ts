import Entities, {
  getModelTypeByName,
} from "../../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import DataSecurityIssue from "../../../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityIssueGroup from "../../../../../Models/DatabaseModels/DataSecurityIssueGroup";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../../Models/DatabaseModels/MonitorStatus";
import Probe from "../../../../../Models/DatabaseModels/Probe";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import UserWebhook from "../../../../../Models/DatabaseModels/UserWebhook";
import SortValidator from "../../../../../Server/Types/Database/Permissions/SortValidator";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import OwnedScopePermission from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Search from "../../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import { isOwnerOnlyColumn } from "../../../../../Types/Database/AccessControl/OwnerOnlyColumn";
import { ListOrderSettings } from "../../../../../Types/Database/ListOrderColumn";
import {
  TableColumnMetadata,
  getTableColumns,
} from "../../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import Dictionary from "../../../../../Types/Dictionary";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import Permission from "../../../../../Types/Permission";
import { getLabelListSort } from "../../../../../Utils/LabelOrder";
import {
  STATE_LISTS,
  StateListDefinition,
} from "../../../../../Utils/StateOrder";
import ModelTableColumn from "../../../../../UI/Components/ModelTable/Column";
import {
  RelationColumnSort,
  getColumnSortForRead,
  getRelationColumnSort,
  getRelationColumnSortValue,
} from "../../../../../UI/Components/ModelTable/ColumnSort";
import FieldType from "../../../../../UI/Components/Types/FieldType";
import { customDomainCaller } from "../../../API/CustomDomainCallers";
import { beforeAll, describe, expect, test } from "@jest/globals";
import {
  DataSource,
  EntityPropertyNotFoundError,
  ObjectLiteral,
  SelectQueryBuilder,
} from "typeorm";
import { EntityMetadata } from "typeorm/metadata/EntityMetadata";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";

/*
 * A LIST'S SORT IS CHECKED AGAINST ITS MODEL BEFORE TYPEORM SEES IT (#8141).
 *
 * `sort: { incidentSeverity: "DESC" }` and `sort: { nope: "ASC" }` reached
 * TypeORM, which threw EntityPropertyNotFoundError - no code, so the API
 * answered 500 and logged a server fault. SortValidator refuses what TypeORM
 * cannot read as written, as bad data (400), and lets everything else
 * through untouched: every list read in the product passes it.
 *
 * Held here, with no database, on a data source built from every OneUptime
 * model (as PagedFindSql.test.ts builds its queries):
 *
 *  - the column metadata the check reads says what TypeORM's own does about
 *    every field of every model;
 *  - every sort the check passes, TypeORM builds, and every sort TypeORM
 *    fails on, the check refuses - field by field, for every model;
 *  - which values a field takes, and why the rest are refused;
 *  - what each refusal says, naming only fields the caller may read;
 *  - every sort the product itself sends passes: the dashboard's tables and
 *    list widgets, each service's own order, the default order.
 */

let dataSource: DataSource;

beforeAll(async () => {
  dataSource = new DataSource({ type: "postgres", entities: Entities });
  await (
    dataSource as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();

  /*
   * The first read by a member builds the registry of the tables that say
   * who owns what (OwnedScopePermission), once for the process - as every
   * read already does in production. Built here, so no test below carries it.
   */
  OwnedScopePermission.getColumnsKeptToOwners(Incident, member());
});

type ModelType = { new (): BaseModel };

const ASC: SortOrder = SortOrder.Ascending;
const DESC: SortOrder = SortOrder.Descending;

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

const member: (
  permissions?: Array<Permission>,
) => DatabaseCommonInteractionProps = (
  permissions?: Array<Permission>,
): DatabaseCommonInteractionProps => {
  return customDomainCaller({
    permissions: permissions || [Permission.ProjectMember],
  });
};

// The check's verdict: null when it passes, else what it refused with.
const refusalOf: (
  modelType: ModelType,
  sort: unknown,
  props?: DatabaseCommonInteractionProps,
) => BadDataException | null = (
  modelType: ModelType,
  sort: unknown,
  props?: DatabaseCommonInteractionProps,
): BadDataException | null => {
  try {
    SortValidator.checkSort({
      modelType: modelType,
      sort: sort,
      props: props || ROOT,
    });

    return null;
  } catch (error) {
    if (error instanceof BadDataException) {
      return error;
    }

    throw error;
  }
};

const messageOf: (
  modelType: ModelType,
  sort: unknown,
  props?: DatabaseCommonInteractionProps,
) => string = (
  modelType: ModelType,
  sort: unknown,
  props?: DatabaseCommonInteractionProps,
): string => {
  const refusal: BadDataException | null = refusalOf(modelType, sort, props);

  if (!refusal) {
    throw new Error(`Expected ${JSON.stringify(sort)} to be refused.`);
  }

  return refusal.message;
};

// TypeORM's own builder, as repository.find makes it, ordered by `order`.
const typeOrmBuilder: (
  modelType: ModelType,
  order: unknown,
) => SelectQueryBuilder<ObjectLiteral> = (
  modelType: ModelType,
  order: unknown,
): SelectQueryBuilder<ObjectLiteral> => {
  const metadata: EntityMetadata = dataSource.getMetadata(modelType);

  return dataSource.manager
    .createQueryBuilder(modelType, metadata.name)
    .setFindOptions({ order: order as never, take: 10 });
};

// What TypeORM does with `order`: builds it, or fails with what.
const typeOrmFailureOf: (modelType: ModelType, order: unknown) => unknown = (
  modelType: ModelType,
  order: unknown,
): unknown => {
  try {
    typeOrmBuilder(modelType, order);
    return null;
  } catch (error) {
    return error;
  }
};

// The ORDER BY TypeORM builds: each term and its direction.
const typeOrmOrderOf: (
  modelType: ModelType,
  order: unknown,
) => Dictionary<unknown> = (
  modelType: ModelType,
  order: unknown,
): Dictionary<unknown> => {
  return typeOrmBuilder(modelType, order).expressionMap
    .orderBys as Dictionary<unknown>;
};

interface FieldOfModel {
  name: string;
  column: TableColumnMetadata;
}

const fieldsOf: (modelType: ModelType) => Array<FieldOfModel> = (
  modelType: ModelType,
): Array<FieldOfModel> => {
  const columns: Dictionary<TableColumnMetadata> = getTableColumns(
    new modelType(),
  );

  return Object.keys(columns).map((name: string): FieldOfModel => {
    return { name: name, column: columns[name]! };
  });
};

const isRelationOfOne: (field: FieldOfModel) => boolean = (
  field: FieldOfModel,
): boolean => {
  return field.column.type === TableColumnType.Entity;
};

const isRelationOfMany: (field: FieldOfModel) => boolean = (
  field: FieldOfModel,
): boolean => {
  return field.column.type === TableColumnType.EntityArray;
};

const isPlainField: (field: FieldOfModel) => boolean = (
  field: FieldOfModel,
): boolean => {
  return !isRelationOfOne(field) && !isRelationOfMany(field);
};

const MODELS: Array<ModelType> = Entities as Array<ModelType>;

describe("the column metadata the check reads is TypeORM's own, for every model", () => {
  test("every model is a TypeORM entity with no embedded columns", () => {
    expect(MODELS.length).toBeGreaterThan(400);

    for (const modelType of MODELS) {
      const metadata: EntityMetadata = dataSource.getMetadata(modelType);

      expect([modelType.name, metadata.allEmbeddeds.length]).toEqual([
        modelType.name,
        0,
      ]);
    }
  });

  test("every field is a TypeORM column, a relation of one record or a relation of many, as its metadata says", () => {
    const misread: Array<string> = [];

    for (const modelType of MODELS) {
      const metadata: EntityMetadata = dataSource.getMetadata(modelType);

      for (const field of fieldsOf(modelType)) {
        /*
         * TypeORM's buildOrder looks a field up in this order: a column
         * first, then a relation.
         */
        const isTypeOrmColumn: boolean = Boolean(
          metadata.findColumnWithPropertyPathStrict(field.name),
        );
        const relation: RelationMetadata | undefined =
          metadata.findRelationWithPropertyPath(field.name);

        let read: string = "unknown";

        if (isTypeOrmColumn) {
          read = "column";
        } else if (relation) {
          read =
            relation.relationType === "many-to-one" ||
            relation.relationType === "one-to-one"
              ? "one"
              : "many";
        }

        let expected: string = "column";

        if (isRelationOfOne(field)) {
          expected = "one";
        }

        if (isRelationOfMany(field)) {
          expected = "many";
        }

        if (read !== expected) {
          misread.push(
            `${modelType.name}.${field.name}: TypeORM ${read}, metadata ${expected}`,
          );
        }

        if (
          relation &&
          !isTypeOrmColumn &&
          relation.inverseEntityMetadata.target !== field.column.modelType
        ) {
          misread.push(
            `${modelType.name}.${field.name}: another related model`,
          );
        }
      }
    }

    expect(misread).toEqual([]);
  });

  test("TypeORM knows no field the metadata leaves out", () => {
    const unknown: Array<string> = [];

    for (const modelType of MODELS) {
      const metadata: EntityMetadata = dataSource.getMetadata(modelType);
      const model: BaseModel = new modelType();

      for (const column of metadata.columns) {
        if (!model.hasColumn(column.propertyPath)) {
          unknown.push(`${modelType.name}.${column.propertyPath}`);
        }
      }

      for (const relation of metadata.relations) {
        if (!model.hasColumn(relation.propertyPath)) {
          unknown.push(`${modelType.name}.${relation.propertyPath}`);
        }
      }
    }

    expect(unknown).toEqual([]);
  });
});

describe("every sort the check passes, TypeORM builds - and every sort TypeORM fails on, the check refuses", () => {
  test("a field of every model, sorted either way: passes, and TypeORM builds it", () => {
    const disagreements: Array<string> = [];

    for (const modelType of MODELS) {
      for (const field of fieldsOf(modelType).filter(isPlainField)) {
        for (const value of [
          ASC,
          DESC,
          { direction: DESC, nulls: "LAST" },
        ] as Array<unknown>) {
          const sort: JSONObject = { [field.name]: value } as JSONObject;

          if (refusalOf(modelType, sort) || typeOrmFailureOf(modelType, sort)) {
            disagreements.push(
              `${modelType.name} ${JSON.stringify(sort)}: refused or not built`,
            );
          }
        }
      }
    }

    expect(disagreements).toEqual([]);
  });

  test("through every relation of one record, by each field of the related record: passes, and TypeORM builds it", () => {
    const disagreements: Array<string> = [];
    let checked: number = 0;

    for (const modelType of MODELS) {
      for (const relation of fieldsOf(modelType).filter(isRelationOfOne)) {
        const relatedType: ModelType = relation.column.modelType as ModelType;

        for (const relatedField of fieldsOf(relatedType).filter(isPlainField)) {
          const sort: JSONObject = {
            [relation.name]: { [relatedField.name]: ASC },
          } as JSONObject;

          checked++;

          if (refusalOf(modelType, sort) || typeOrmFailureOf(modelType, sort)) {
            disagreements.push(`${modelType.name} ${JSON.stringify(sort)}`);
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(10000);
    expect(disagreements).toEqual([]);
  });

  test("a relation of one record given only a direction: TypeORM fails on it, and the check refuses it - for every relation", () => {
    const disagreements: Array<string> = [];

    for (const modelType of MODELS) {
      for (const relation of fieldsOf(modelType).filter(isRelationOfOne)) {
        for (const value of [DESC, ASC, "asc"]) {
          const sort: JSONObject = { [relation.name]: value };

          if (
            !(
              typeOrmFailureOf(modelType, sort) instanceof
              EntityPropertyNotFoundError
            ) ||
            !refusalOf(modelType, sort)
          ) {
            disagreements.push(`${modelType.name} ${JSON.stringify(sort)}`);
          }
        }
      }
    }

    expect(disagreements).toEqual([]);
  });

  test("a field no model has: TypeORM fails on it, and the check refuses it - for every model, and through every relation", () => {
    const disagreements: Array<string> = [];

    for (const modelType of MODELS) {
      const sorts: Array<JSONObject> = [
        { nope: ASC },
        ...fieldsOf(modelType)
          .filter(isRelationOfOne)
          .map((relation: FieldOfModel): JSONObject => {
            return { [relation.name]: { nope: ASC } };
          }),
      ];

      for (const sort of sorts) {
        if (
          !(
            typeOrmFailureOf(modelType, sort) instanceof
            EntityPropertyNotFoundError
          ) ||
          !refusalOf(modelType, sort)
        ) {
          disagreements.push(`${modelType.name} ${JSON.stringify(sort)}`);
        }
      }
    }

    expect(disagreements).toEqual([]);
  });

  test("a relation of many records is refused, whatever it is given - every one of every model", () => {
    const passed: Array<string> = [];
    let checked: number = 0;

    for (const modelType of MODELS) {
      for (const relation of fieldsOf(modelType).filter(isRelationOfMany)) {
        for (const value of [{ _id: ASC }, { createdAt: DESC }, DESC]) {
          checked++;

          if (!refusalOf(modelType, { [relation.name]: value })) {
            passed.push(`${modelType.name}.${relation.name}`);
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(100);
    expect(passed).toEqual([]);
  });

  test("TypeORM builds an order through a relation of many records - it is the one refusal TypeORM would have sent to the database", () => {
    /*
     * It joins every label of every incident and orders the rows by them:
     * an incident with three labels has three places in the order, and the
     * page is cut from rows, not incidents. Refused all the same: a list of
     * records has no one value to put a list in order by.
     */
    expect(typeOrmFailureOf(Incident, { labels: { name: ASC } })).toBeNull();
    expect(refusalOf(Incident, { labels: { name: ASC } })).not.toBeNull();
  });

  test("a value TypeORM throws a TypeError on is refused: no direction to read in null, nulls that is not text", () => {
    for (const value of [null, { direction: DESC, nulls: 5 }]) {
      expect(typeOrmFailureOf(Incident, { title: value })).toBeInstanceOf(
        TypeError,
      );
      expect(refusalOf(Incident, { title: value })).not.toBeNull();
    }
  });

  test("a direction TypeORM does not know, it reads as ascending - so the check refuses it rather than sort the list the other way", () => {
    for (const value of ["Desc", "descending", "DESCENDING", "-1", 2, true]) {
      expect(typeOrmOrderOf(Incident, { title: value })).toEqual({
        "Incident.title": "ASC",
      });
      expect(refusalOf(Incident, { title: value })).not.toBeNull();
    }
  });

  test("a direction TypeORM reads as written passes, and TypeORM builds what it says", () => {
    const expected: Array<[unknown, unknown]> = [
      [ASC, "ASC"],
      [DESC, "DESC"],
      ["asc", "ASC"],
      ["desc", "DESC"],
      [1, "ASC"],
      [-1, "DESC"],
      [{ direction: DESC }, "DESC"],
      [{ direction: "desc" }, "DESC"],
      [{ direction: -1 }, "DESC"],
      [
        { direction: ASC, nulls: "FIRST" },
        { order: "ASC", nulls: "NULLS FIRST" },
      ],
      [
        { direction: DESC, nulls: "LAST" },
        { order: "DESC", nulls: "NULLS LAST" },
      ],
      [
        { direction: DESC, nulls: "last" },
        { order: "DESC", nulls: "NULLS LAST" },
      ],
      [
        { direction: DESC, nulls: "Last" },
        { order: "DESC", nulls: "NULLS LAST" },
      ],
      [{ nulls: "LAST" }, { order: "ASC", nulls: "NULLS LAST" }],
      // Nothing to say but the default: ascending, as TypeORM reads it.
      [{}, "ASC"],
      [{ direction: null, nulls: null }, "ASC"],
    ];

    for (const [value, built] of expected) {
      expect([value, refusalOf(Incident, { title: value })]).toEqual([
        value,
        null,
      ]);
      expect([value, typeOrmOrderOf(Incident, { title: value })]).toEqual([
        value,
        { "Incident.title": built },
      ]);
    }
  });
});

describe("which values a field takes", () => {
  test.each([
    ["an unknown direction", "SIDEWAYS"],
    ["a direction in other capitals", "Desc"],
    ["a direction spelled out", "descending"],
    ["an empty direction", ""],
    ["a number other than 1 and -1", 0],
    ["a number as text", "-1"],
    ["true", true],
    ["false", false],
    ["null", null],
    ["a list", [DESC]],
    ["an empty list", []],
    ["an order through a relation, on a field that is none", { order: ASC }],
    ["a direction it does not know, in an object", { direction: "UP" }],
    ["nulls it does not know", { nulls: "MIDDLE" }],
    ["nulls that is not text", { nulls: true }],
    ["anything else beside direction and nulls", { direction: DESC, as: 1 }],
    ["a date", new Date()],
    ["a search", new Search("x")],
  ])("%s is refused", (_name: string, value: unknown) => {
    expect(refusalOf(Incident, { title: value })).toBeInstanceOf(
      BadDataException,
    );
  });

  test("a field with no order is left out, as TypeORM leaves it out", () => {
    expect(refusalOf(Incident, { title: undefined })).toBeNull();
    expect(
      refusalOf(Incident, { title: undefined, declaredAt: DESC }),
    ).toBeNull();
    expect(
      refusalOf(Incident, { incidentSeverity: { order: undefined } }),
    ).toBeNull();
  });

  test("a sort with no field in it is no sort: the list is read in its own order, as before", () => {
    for (const sort of [undefined, null, {}, [], 0, 5, true, false, ""]) {
      expect([sort, refusalOf(Incident, sort)]).toEqual([sort, null]);
    }
  });

  test("a sort that is not an object of fields is refused", () => {
    for (const sort of ["DESC", ["title"], new Search("x")]) {
      expect(messageOf(Incident, sort)).toBe(
        'The sort of a list of Incidents is not an object of fields. Name each field to sort by and its direction, as in { "createdAt": "DESC" }.',
      );
    }
  });

  test("a relation of one record takes an object of its own fields, to any depth", () => {
    expect(
      refusalOf(Incident, { incidentSeverity: { order: ASC } }),
    ).toBeNull();
    expect(
      refusalOf(Incident, {
        incidentSeverity: { order: { direction: DESC, nulls: "LAST" } },
      }),
    ).toBeNull();
    expect(
      refusalOf(Incident, {
        incidentSeverity: { order: ASC, name: DESC },
        title: ASC,
      }),
    ).toBeNull();
    // Two relations deep: TypeORM joins both.
    expect(
      refusalOf(Alert, {
        monitor: { currentMonitorStatus: { priority: DESC } },
      }),
    ).toBeNull();
    expect(
      typeOrmFailureOf(Alert, {
        monitor: { currentMonitorStatus: { priority: DESC } },
      }),
    ).toBeNull();
    // Nothing named in it: TypeORM joins it and orders by none of it.
    expect(refusalOf(Incident, { incidentSeverity: {} })).toBeNull();
  });

  test("the verdict is the same whoever asks: who they are only changes what a refusal names", () => {
    const callers: Array<DatabaseCommonInteractionProps> = [
      ROOT,
      { isMasterAdmin: true },
      member(),
      member([Permission.ProjectOwner]),
      {},
    ];

    for (const sort of [
      { title: ASC },
      { incidentSeverity: { order: ASC } },
      { incidentSeverity: DESC },
      { nope: ASC },
      { labels: { name: ASC } },
    ] as Array<JSONObject>) {
      const verdicts: Array<boolean> = callers.map(
        (props: DatabaseCommonInteractionProps): boolean => {
          return refusalOf(Incident, sort, props) === null;
        },
      );

      expect(new Set(verdicts).size).toBe(1);
    }
  });

  test("a field named like an object's own properties is no field", () => {
    for (const field of [
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
    ]) {
      const sort: Dictionary<unknown> = JSON.parse(`{ "${field}": "ASC" }`);

      expect([field, refusalOf(Incident, sort)]).not.toEqual([field, null]);
    }
  });
});

describe("what a refusal says", () => {
  test("a relation given only a direction: which field to send, and the fields it has (#8141)", () => {
    expect(messageOf(Incident, { incidentSeverity: DESC })).toBe(
      'Incidents cannot be sorted by "incidentSeverity" with "DESC": it is a related record (Incident Severity), and a related record sorts the list by one of its own fields. Send { "incidentSeverity": { "order": "ASC" } } to sort by its place in its list, top first, or name another of its fields: ' +
        relatedFieldsOf(IncidentSeverity).join(", ") +
        ".",
    );
  });

  test("a relation of a record that is in no ordered list is sorted by its name", () => {
    expect(messageOf(Alert, { monitor: ASC })).toContain(
      'Send { "monitor": { "name": "ASC" } } to sort by its name, A to Z',
    );
  });

  /*
   * A record read only through other records - a Data Security issue
   * group, which only Data Security's own routes answer (#10370) - has no
   * time a select through the relation names, and none the API reference
   * publishes for its sort (ModelSchema.getRelationSortFields). So a
   * refusal suggests its id, which a client generated from the reference
   * can send, and offers no time.
   */
  test("a relation of a record read only through other records is sorted by its id", () => {
    const message: string = messageOf(DataSecurityIssue, {
      dataSecurityIssueGroup: DESC,
    });

    expect(message).toContain(
      'Send { "dataSecurityIssueGroup": { "_id": "ASC" } } to sort by its id, which keeps the records of each one together, or name another of its fields: ' +
        relatedFieldsOf(DataSecurityIssueGroup).join(", ") +
        ".",
    );
    expect(relatedFieldsOf(DataSecurityIssueGroup)).toContain("_id");
    expect(message).not.toContain("createdAt");
    expect(message).not.toContain("updatedAt");
    expect(
      refusalOf(DataSecurityIssue, { dataSecurityIssueGroup: { _id: ASC } }),
    ).toBeNull();
  });

  test("a relation two deep names the whole path, and an example to match", () => {
    const message: string = messageOf(Alert, {
      monitor: { currentMonitorStatus: DESC },
    });

    expect(message).toContain(
      'Alerts cannot be sorted by "monitor.currentMonitorStatus" with "DESC": it is a related record (Monitor Status)',
    );
    expect(message).toContain(
      'Send { "monitor": { "currentMonitorStatus": { "priority": "ASC" } } } to sort by its place in its list, top first',
    );
  });

  test("a relation given something that is not a direction says what it was given", () => {
    expect(messageOf(Incident, { incidentSeverity: null })).toContain(
      'Incidents cannot be sorted by "incidentSeverity" with null:',
    );
    expect(messageOf(Incident, { incidentSeverity: [] })).toContain(
      '"incidentSeverity" with a list:',
    );
    expect(messageOf(Incident, { incidentSeverity: true })).toContain(
      '"incidentSeverity" with true:',
    );
    expect(messageOf(Incident, { incidentSeverity: -1 })).toContain(
      '"incidentSeverity" with -1:',
    );
  });

  test("a relation of many records: a list of records cannot order a list (#8141)", () => {
    expect(messageOf(Incident, { labels: { name: ASC } })).toBe(
      'Incidents cannot be sorted by "labels": it holds a list of Labels for each Incident, and a list of records cannot order a list, as it has no one value to sort by. Sort by a field that holds one value, as in { "createdAt": "DESC" }.',
    );
    expect(messageOf(Incident, { labels: DESC })).toBe(
      messageOf(Incident, { labels: { name: ASC } }),
    );
  });

  test("a relation of many records through a relation of one names the path", () => {
    expect(messageOf(Alert, { monitor: { labels: { name: ASC } } })).toBe(
      'Alerts cannot be sorted by "monitor.labels": it holds a list of Labels for each Monitor, and a list of records cannot order a list, as it has no one value to sort by. Sort by a field that holds one value, as in { "createdAt": "DESC" }.',
    );
  });

  test("a field the model does not have: the fields the caller may sort by (#8141)", () => {
    const message: string = messageOf(Incident, { nope: ASC }, member());

    expect(message).toBe(
      `Incidents have no field "nope" to sort by. Sort by one of these fields: ${readableColumnsOf(Incident, member()).join(", ")}. Or sort by a field of a related record (${readableRelationsOf(Incident, member()).join(", ")}), as in { "project": { "name": "ASC" } }.`,
    );
    expect(message).toContain("title");
    expect(message).toContain("declaredAt");
    expect(message).toContain("incidentSeverity");
    // A relation of many records sorts nothing, so it is not offered.
    expect(message).not.toMatch(/\blabels\b/);
  });

  test("a field through a relation that its record does not have: the fields any reader of the relation may read", () => {
    expect(
      messageOf(Incident, { incidentSeverity: { nope: ASC } }, member()),
    ).toBe(
      `Incident Severities have no field "nope" to sort Incidents by, through "incidentSeverity". Sort by one of these fields of Incident Severity: ${relatedFieldsOf(IncidentSeverity).join(", ")}.`,
    );
  });

  test("a field given an order it does not take: what it takes", () => {
    expect(messageOf(Incident, { title: "SIDEWAYS" })).toBe(
      'Incidents cannot be sorted by "title" with "SIDEWAYS". Sort it "ASC" or "DESC", or { "direction": "DESC", "nulls": "LAST" } to say where records with no value go.',
    );
  });

  test("a field given the order of a relation: it has no fields of its own", () => {
    expect(messageOf(Incident, { title: { name: ASC } })).toBe(
      'Incidents cannot be sorted by "title" with {"name":"ASC"}. Sort it "ASC" or "DESC", or { "direction": "DESC", "nulls": "LAST" } to say where records with no value go. "title" holds a value of its own, not a related record, so it has no fields to sort by.',
    );
  });

  test("a field of a related record given an order it does not take names the path", () => {
    expect(
      messageOf(Incident, { incidentSeverity: { order: "Desc" } }),
    ).toContain(
      'Incidents cannot be sorted by "incidentSeverity.order" with "Desc".',
    );
  });

  test("what the caller sent is quoted back short, and as text", () => {
    const longField: string = "x".repeat(500);
    const message: string = messageOf(Incident, { [longField]: ASC });

    expect(message).toContain(`"${"x".repeat(60)}..."`);
    expect(message).not.toContain("x".repeat(61));

    expect(messageOf(Incident, { 'a"b': ASC })).toContain('"a\\"b"');
    expect(
      messageOf(Incident, { title: { direction: "x".repeat(200) } }),
    ).toContain("with an object.");
  });

  test("every refusal is a sentence: a capital letter first and a full stop last", () => {
    for (const sort of [
      "DESC",
      { nope: ASC },
      { incidentSeverity: DESC },
      { incidentSeverity: { nope: ASC } },
      { labels: { name: ASC } },
      { title: "SIDEWAYS" },
      { title: { name: ASC } },
    ]) {
      const message: string = messageOf(Incident, sort, member());

      expect(message[0]).toBe(message[0]!.toUpperCase());
      expect(message[0]).toMatch(/[A-Z]/);
      expect(message.endsWith(".")).toBe(true);
    }
  });
});

describe("a refusal names only the fields the caller may read", () => {
  test("a column the caller's permissions hide is not named: a member reads no team member's invitation date", () => {
    expect(
      new TeamMember().getColumnAccessControlFor("invitationAcceptedAt")?.read,
    ).not.toContain(Permission.ProjectMember);

    expect(messageOf(TeamMember, { nope: ASC }, member())).not.toContain(
      "invitationAcceptedAt",
    );
    expect(
      messageOf(TeamMember, { nope: ASC }, member([Permission.ProjectOwner])),
    ).toContain("invitationAcceptedAt");
  });

  test("the fields named are exactly those the select would let the caller read", () => {
    for (const permissions of [
      [Permission.ProjectMember],
      [Permission.ProjectOwner],
      [Permission.Viewer],
      [],
    ]) {
      const props: DatabaseCommonInteractionProps = member(permissions);
      const named: Array<string> = namedColumnsOf(
        messageOf(Incident, { nope: ASC }, props),
      );
      const readable: Array<string> =
        ColumnPermissions.getModelColumnsByPermissions(
          Incident,
          ColumnPermissions.getColumnCheckRows(member(permissions)),
          DatabaseRequestType.Read,
        ).columns;

      for (const column of named) {
        expect([
          column,
          readable.includes(column) ||
            ColumnPermissions.getExcludedColumnNames().includes(column),
        ]).toEqual([column, true]);
      }
    }
  });

  test("a secret is never named, even to root: a probe's key", () => {
    expect(new Probe().getTableColumnMetadata("key").secret).toBe(true);

    for (const props of [ROOT, member([Permission.ProjectOwner])]) {
      expect(
        namedColumnsOf(messageOf(Probe, { nope: ASC }, props)),
      ).not.toContain("key");
    }
  });

  test("a column read only by its own user is not named to anyone else: a webhook's address", () => {
    expect(isOwnerOnlyColumn(new UserWebhook(), "webhookUrl")).toBe(true);
    expect(
      namedColumnsOf(
        messageOf(
          UserWebhook,
          { nope: ASC },
          member([Permission.ProjectOwner]),
        ),
      ),
    ).not.toContain("webhookUrl");
  });

  test("root and a master admin pass every check, so every column is named to them", () => {
    for (const props of [ROOT, { isMasterAdmin: true }]) {
      expect(
        namedColumnsOf(messageOf(TeamMember, { nope: ASC }, props)),
      ).toContain("invitationAcceptedAt");
    }
  });

  test("a field through a relation is named only when any reader of the relation may read it", () => {
    for (const modelType of [IncidentSeverity, MonitorStatus, Monitor, Label]) {
      for (const field of relatedFieldsOf(modelType)) {
        const column: TableColumnMetadata =
          new modelType().getTableColumnMetadata(field);

        expect([
          `${modelType.name}.${field}`,
          Boolean(column.canReadOnRelationQuery) ||
            ColumnPermissions.getExcludedColumnNames().includes(field),
        ]).toEqual([`${modelType.name}.${field}`, true]);
      }
    }
  });
});

describe("every sort the product sends passes", () => {
  test("the order a list is read in when nobody asks for one - newest first - and the primary key DatabaseService breaks ties by", () => {
    for (const modelType of MODELS) {
      for (const sort of [
        { createdAt: DESC },
        { createdAt: DESC, _id: ASC },
        { _id: ASC },
      ]) {
        expect([modelType.name, refusalOf(modelType, sort)]).toEqual([
          modelType.name,
          null,
        ]);
      }
    }
  });

  test("every list people put in order, as ListOrderMaintainer reads it", () => {
    let lists: number = 0;

    for (const modelType of MODELS) {
      const listOrder: ListOrderSettings | null =
        new modelType().getListOrder();

      if (!listOrder) {
        continue;
      }

      lists++;

      const sort: JSONObject = {
        [listOrder.column]: listOrder.sortOrder,
        createdAt: ASC,
      } as JSONObject;

      expect([modelType.name, refusalOf(modelType, sort)]).toEqual([
        modelType.name,
        null,
      ]);
      expect(typeOrmFailureOf(modelType, sort)).toBeNull();
    }

    expect(lists).toBeGreaterThan(5);
  });

  test("every state, severity and status list, as StateOrderGuard reads it", () => {
    for (const definition of Object.values(
      STATE_LISTS,
    ) as Array<StateListDefinition>) {
      const modelType: ModelType | null = getModelTypeByName(definition.type);

      expect(modelType).not.toBeNull();

      expect(
        refusalOf(modelType as ModelType, {
          [definition.orderColumn]: ASC,
          createdAt: ASC,
        }),
      ).toBeNull();
    }
  });

  test("labels, read by name in natural order (LabelService.getReadSort)", () => {
    for (const asked of [
      undefined,
      {},
      { name: ASC },
      { name: DESC },
      { createdAt: DESC },
      { name: ASC, createdAt: DESC },
    ]) {
      expect(
        refusalOf(
          Label,
          getLabelListSort(asked as Dictionary<SortOrder> | undefined),
        ),
      ).toBeNull();
    }
  });

  test("a dashboard table sorted by any column that shows a field of the record, either way (ColumnSort.getColumnSortForRead)", () => {
    for (const modelType of MODELS) {
      const model: BaseModel = new modelType();

      for (const field of fieldsOf(modelType).filter(isPlainField)) {
        for (const sortOrder of [ASC, DESC]) {
          const sort: unknown = getColumnSortForRead({
            model: model,
            sortBy: field.name,
            sortOrder: sortOrder,
            relationSorts: new Map(),
          });

          expect([
            modelType.name,
            field.name,
            refusalOf(modelType, sort),
          ]).toEqual([modelType.name, field.name, null]);
        }
      }
    }
  });

  test("a dashboard table sorted by any column that shows a related record, either way (ColumnSort.getRelationColumnSort)", () => {
    let sorted: number = 0;

    for (const modelType of MODELS) {
      const model: BaseModel = new modelType();

      for (const relation of fieldsOf(modelType).filter(isRelationOfOne)) {
        // A column that shows the related record's name, as most do.
        const column: ModelTableColumn<BaseModel> = {
          field: { [relation.name]: { name: true, title: true } },
          title: "Column",
          type: FieldType.Entity,
        } as unknown as ModelTableColumn<BaseModel>;

        const relationSort: RelationColumnSort | null = getRelationColumnSort(
          model,
          column,
        );

        if (!relationSort) {
          continue;
        }

        for (const sortOrder of [ASC, DESC]) {
          const sort: JSONObject = getRelationColumnSortValue(
            relationSort,
            sortOrder,
          );

          sorted++;

          expect([modelType.name, refusalOf(modelType, sort)]).toEqual([
            modelType.name,
            null,
          ]);
          expect(typeOrmFailureOf(modelType, sort)).toBeNull();
        }
      }
    }

    expect(sorted).toBeGreaterThan(1000);
  });

  test("a stale relation sort a dashboard drops instead of sending is no sort at all", () => {
    expect(
      refusalOf(
        Incident,
        getColumnSortForRead({
          model: new Incident(),
          sortBy: "labels",
          sortOrder: ASC,
          relationSorts: new Map(),
        }),
      ),
    ).toBeNull();
  });

  test("the orders services ask for themselves", () => {
    const sorts: Array<[ModelType, JSONObject]> = [
      // Severities and states in their list's order (TeamComplianceService, the state guards).
      [IncidentSeverity, { order: ASC }],
      [MonitorStatus, { priority: ASC, createdAt: ASC }],
      // An incident's state's place, worst first (the incident list widget).
      [Incident, { currentIncidentState: { order: ASC }, createdAt: DESC }],
      // Descending with rows that have no value last (the dashboard's list widgets).
      [
        Monitor,
        {
          disableActiveMonitoring: ASC,
          currentMonitorStatus: {
            priority: { direction: DESC, nulls: "LAST" },
          },
          name: ASC,
        },
      ],
      // A string literal rather than the enum (CustomNotificationChannelService).
      [Monitor, { name: "ASC" }],
      // The CLI and MCP tools, as their users write them.
      [Incident, { createdAt: "DESC" }],
      [IncidentSeverity, { order: "ASC" }],
    ];

    for (const [modelType, sort] of sorts) {
      expect([modelType.name, sort, refusalOf(modelType, sort)]).toEqual([
        modelType.name,
        sort,
        null,
      ]);
      expect(typeOrmFailureOf(modelType, sort)).toBeNull();
    }
  });
});

// The columns a refusal of an unknown field names to `props`, as it orders them.
function readableColumnsOf(
  modelType: ModelType,
  props: DatabaseCommonInteractionProps,
): Array<string> {
  return readableFieldsOf(modelType, props).filter((name: string): boolean => {
    return !new modelType().isEntityColumn(name);
  });
}

function readableRelationsOf(
  modelType: ModelType,
  props: DatabaseCommonInteractionProps,
): Array<string> {
  return readableFieldsOf(modelType, props).filter((name: string): boolean => {
    return new modelType().isEntityColumn(name);
  });
}

function readableFieldsOf(
  modelType: ModelType,
  props: DatabaseCommonInteractionProps,
): Array<string> {
  const model: BaseModel = new modelType();
  const readable: Array<string> =
    ColumnPermissions.getModelColumnsByPermissions(
      modelType,
      ColumnPermissions.getColumnCheckRows(props),
      DatabaseRequestType.Read,
    ).columns;

  return fieldsOf(modelType)
    .filter((field: FieldOfModel): boolean => {
      return (
        !isRelationOfMany(field) &&
        !["deletedAt", "version"].includes(field.name) &&
        !field.column.hashed &&
        !field.column.encrypted &&
        !field.column.secret &&
        !isOwnerOnlyColumn(model, field.name) &&
        (readable.includes(field.name) ||
          ColumnPermissions.getExcludedColumnNames().includes(field.name))
      );
    })
    .map((field: FieldOfModel): string => {
      return field.name;
    });
}

// The fields of a related record any reader of the relation may sort by.
function relatedFieldsOf(modelType: ModelType): Array<string> {
  const model: BaseModel = new modelType();

  return fieldsOf(modelType)
    .filter((field: FieldOfModel): boolean => {
      // An id or a time with the record's own read permissions (#10370).
      const readers: Array<Permission> =
        model.getColumnAccessControlFor(field.name)?.read ||
        model.getReadPermissions() ||
        [];

      return (
        isPlainField(field) &&
        !["deletedAt", "version"].includes(field.name) &&
        !field.column.hashed &&
        !field.column.encrypted &&
        !field.column.secret &&
        !isOwnerOnlyColumn(model, field.name) &&
        (Boolean(field.column.canReadOnRelationQuery) ||
          (ColumnPermissions.getExcludedColumnNames().includes(field.name) &&
            readers.length > 0))
      );
    })
    .map((field: FieldOfModel): string => {
      return field.name;
    });
}

// The columns a refusal of an unknown field names, read back out of it.
function namedColumnsOf(message: string): Array<string> {
  const match: RegExpMatchArray | null = message.match(
    /Sort by one of these fields: ([^.]*)\./,
  );

  return match ? match[1]!.split(", ") : [];
}
