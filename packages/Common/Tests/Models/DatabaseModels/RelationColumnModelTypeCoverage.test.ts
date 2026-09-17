import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test: every relation column (Entity / EntityArray) on every
 * database model resolves to a real related model at read time.
 *
 * The case that prompted this: Monitor and NetworkDevice import each other to
 * declare their mutual relation. That is a circular import, and whichever
 * module the loader reached second saw the first as `undefined` while its own
 * @TableColumn decorators ran - so an eager `modelType: TheOtherModel` captured
 * `undefined`. Nothing complained until a query selected that relation (the
 * delete audit snapshot fetches every column), at which point the permission
 * layer threw "Select not supported ... because this column modelType is not
 * found" - a 400 that made the Terraform E2E monitor delete fail every run.
 *
 * Sweeping every model rather than asserting on the one pair is the point: the
 * next two models that import each other fail here, in a fast unit test, rather
 * than in a delete path or a relation query in production.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

function modelName(modelType: ModelType): string {
  return modelType.name;
}

describe("Relation column modelType coverage across database models", () => {
  test("every Entity / EntityArray column resolves a related model", () => {
    const offenders: Array<string> = [];

    for (const modelType of MODEL_TYPES) {
      const model: BaseModel = new modelType();

      for (const column of model.getTableColumns().columns) {
        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata(column);

        if (!metadata) {
          continue;
        }

        const isRelation: boolean =
          metadata.type === TableColumnType.Entity ||
          metadata.type === TableColumnType.EntityArray;

        if (!isRelation) {
          continue;
        }

        if (!metadata.modelType) {
          offenders.push(
            `${modelName(modelType)}.${column} (${metadata.type})`,
          );
          continue;
        }

        // The resolved modelType must be constructable into a real model.
        try {
          const related: BaseModel = new metadata.modelType();

          if (!(related instanceof BaseModel)) {
            offenders.push(
              `${modelName(modelType)}.${column} resolves to a non-model`,
            );
          }
        } catch {
          offenders.push(
            `${modelName(modelType)}.${column} modelType is not constructable`,
          );
        }
      }
    }

    expect(offenders.sort()).toEqual([]);
  });
});
