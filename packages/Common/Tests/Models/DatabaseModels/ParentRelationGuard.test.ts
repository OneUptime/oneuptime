import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ReadPermission, {
  PLAIN_COLUMNS_NAMING_UNLABELLED_RECORDS,
} from "../../../Server/Types/Database/Permissions/ReadPermission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * EVERY MODEL THAT NAMES THE RECORD IT IS READ THROUGH NAMES A REAL ONE.
 *
 * canAccessIfCanReadOn names the relation a model's records belong to (an
 * incident note's incident, an announcement's status pages): a label grant
 * on the parent reaches the record through it (BasePermission), and a block
 * with labels on reading the record leaves it out when the parent carries
 * them (ReadPermission.checkReadBlockPermission). A name that is not a
 * relation of the model reaches nothing - the grant silently does not
 * apply, and the read is refused - so each one must be a relation column
 * (one record or several) of a model the database knows.
 */
describe("canAccessIfCanReadOn", () => {
  const namingModels: Array<BaseModel> = AllModelTypes.map(
    (modelType: { new (): BaseModel }): BaseModel => {
      return new modelType();
    },
  ).filter((model: BaseModel): boolean => {
    return Boolean(model.canAccessIfCanReadOn);
  });

  test("is set on the models whose records are read through a parent", () => {
    expect(namingModels.length).toBeGreaterThan(50);
  });

  test("names a relation of the model - one record by its key column, or several - to a database model", () => {
    const broken: Array<string> = namingModels
      .filter((model: BaseModel): boolean => {
        const column: TableColumnMetadata | undefined =
          model.getTableColumnMetadata(model.canAccessIfCanReadOn as string);

        // One record named by a key column, or several through a join table.
        return !(
          column &&
          column.modelType &&
          ((column.type === TableColumnType.Entity &&
            column.manyToOneRelationColumn) ||
            column.type === TableColumnType.EntityArray)
        );
      })
      .map((model: BaseModel): string => {
        return `${model.tableName}.${model.canAccessIfCanReadOn}`;
      });

    expect(broken).toEqual([]);
  });
});

/*
 * A RECORD WITH NO LABELS OF ITS OWN IS READ THROUGH THE RECORDS IT NAMES.
 *
 * A block with labels on reading such a record leaves it out when a record
 * it names by key carries one of the labels (ReadPermission
 * .getLabelledReferences): a relation's record, the owner key's resource, a
 * plain id column's record by the model its name ends with. A key column
 * whose record's kind cannot be told is weighed against every model that
 * carries labels - one condition per model on every read under such a
 * block - so the models that have one are pinned here: a new one is a
 * decision (or a column for PLAIN_COLUMNS_NAMING_UNLABELLED_RECORDS), not an
 * accident.
 */
describe("records with no labels of their own", () => {
  const labelLess: Array<{ new (): BaseModel }> = AllModelTypes.filter(
    (modelType: { new (): BaseModel }): boolean => {
      return !new modelType().getAccessControlColumn();
    },
  );

  const labelled: Array<{ new (): BaseModel }> = AllModelTypes.filter(
    (modelType: { new (): BaseModel }): boolean => {
      return Boolean(new modelType().getAccessControlColumn());
    },
  );

  test("name records the rule can tell, but for the resource ids several kinds share", () => {
    const anyKind: Record<string, Array<string>> = {};

    for (const modelType of labelLess) {
      const columns: Array<string> =
        ReadPermission.getLabelledReferences(modelType).anyKindColumns;

      if (columns.length > 0) {
        anyKind[new modelType().tableName || modelType.name] = [
          ...columns,
        ].sort();
      }
    }

    expect(anyKind).toEqual({
      AutoRemediationSuggestion: ["resourceId"],
      InventoryItem: ["resourceId"],
      RecommendationDismissal: ["resourceId"],
      ResourceAiAgent: ["resourceId"],
      RunnerJob: ["assignedAgentId", "resourceId"],
    });
  });

  test("a resource id of any kind is weighed on its own, not as a key to one model", () => {
    const references: ReturnType<typeof ReadPermission.getLabelledReferences> =
      ReadPermission.getLabelledReferences(
        labelLess.find((modelType: { new (): BaseModel }): boolean => {
          return new modelType().tableName === "InventoryItem";
        })!,
      );

    expect(references.anyKindColumns).toEqual(["resourceId"]);
    expect(
      references.keys.some((key: { column: string }): boolean => {
        return key.column === "resourceId";
      }),
    ).toBe(false);
  });

  /*
   * A block with labels reaches a labelled record's labels through the join
   * table its labels are kept in, so every model that carries labels names
   * one, many-to-many, with the columns on both sides.
   */
  test("every model that carries labels names the join table they are kept in", () => {
    const unnamed: Array<string> = [];

    for (const modelType of labelled) {
      const labelsColumn: string = new modelType().getAccessControlColumn()!;
      let joinTable: JoinTableMetadataArgs | undefined = undefined;
      let relation: RelationMetadataArgs | undefined = undefined;

      // The labels may be declared on a model the model extends.
      for (
        let target: unknown = modelType;
        target && target !== Function.prototype && !joinTable;
        target = Object.getPrototypeOf(target)
      ) {
        joinTable = getMetadataArgsStorage().joinTables.find(
          (candidate: JoinTableMetadataArgs): boolean => {
            return (
              candidate.target === target &&
              candidate.propertyName === labelsColumn
            );
          },
        );
        relation = getMetadataArgsStorage().relations.find(
          (candidate: RelationMetadataArgs): boolean => {
            return (
              candidate.target === target &&
              candidate.propertyName === labelsColumn
            );
          },
        );
      }

      if (
        !joinTable ||
        !joinTable.name ||
        joinTable.joinColumns?.length !== 1 ||
        joinTable.inverseJoinColumns?.length !== 1 ||
        relation?.relationType !== "many-to-many"
      ) {
        unnamed.push(`${new modelType().tableName}.${labelsColumn}`);
      }
    }

    expect(unnamed).toEqual([]);
  });

  test("the plain columns known to name records without labels are real columns", () => {
    for (const entry of PLAIN_COLUMNS_NAMING_UNLABELLED_RECORDS) {
      const [tableName, column] = entry.split(".") as [string, string];
      const modelType: { new (): BaseModel } | undefined = AllModelTypes.find(
        (candidate: { new (): BaseModel }): boolean => {
          return new candidate().tableName === tableName;
        },
      );

      expect([entry, Boolean(modelType)]).toEqual([entry, true]);
      expect([
        entry,
        new modelType!().getTableColumnMetadata(column)?.type,
      ]).toEqual([entry, TableColumnType.ObjectID]);
    }
  });
});
