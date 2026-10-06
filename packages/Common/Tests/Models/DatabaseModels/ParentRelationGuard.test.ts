import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
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
