import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ReadPermission, {
  PLAIN_COLUMNS_NAMING_UNLABELLED_RECORDS,
} from "../../../Server/Types/Database/Permissions/ReadPermission";
import { describe, expect, test } from "@jest/globals";

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

  test("names a relation of the model, to a database model", () => {
    const broken: Array<string> = namingModels
      .filter((model: BaseModel): boolean => {
        const column: TableColumnMetadata | undefined =
          model.getTableColumnMetadata(model.canAccessIfCanReadOn as string);

        return !(
          column &&
          column.modelType &&
          (column.type === TableColumnType.Entity ||
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
 * whose record cannot be told refuses the read instead, so the models that
 * have one are pinned here: a new one is a decision, not an accident.
 */
describe("records with no labels of their own", () => {
  const labelLess: Array<{ new (): BaseModel }> = AllModelTypes.filter(
    (modelType: { new (): BaseModel }): boolean => {
      return !new modelType().getAccessControlColumn();
    },
  );

  test("name records the rule can tell, but for the resource ids several kinds share", () => {
    const refused: Record<string, Array<string>> = {};

    for (const modelType of labelLess) {
      const unresolved: Array<string> =
        ReadPermission.getLabelledReferences(modelType).unresolvedColumns;

      if (unresolved.length > 0) {
        refused[new modelType().tableName || modelType.name] = [
          ...unresolved,
        ].sort();
      }
    }

    expect(refused).toEqual({
      AutoRemediationSuggestion: ["resourceId"],
      InventoryItem: ["resourceId"],
      RecommendationDismissal: ["resourceId"],
      ResourceAiAgent: ["resourceId"],
      RunnerJob: ["assignedAgentId", "resourceId"],
    });
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
