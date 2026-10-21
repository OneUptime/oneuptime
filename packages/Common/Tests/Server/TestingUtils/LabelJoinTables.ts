import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import QueryUtil from "../../../Server/Types/Database/QueryUtil";
import { jest } from "@jest/globals";

export type ManyToManyMetadata = ReturnType<
  typeof QueryUtil.getManyToManyRelationMetadata
>;

/*
 * The label join tables, as a migrated database describes them, for a test
 * that runs the permission checks without one.
 *
 * The label rule (ReadPermission.addLabelRulesToQuery) writes its
 * conditions against a model's label join table - "<Table>Label", the
 * record's id beside each label's - so a read, update or delete under a
 * block with labels, or under grants limited to labels on a record with no
 * labels of its own, needs that table's names. Without a database
 * QueryUtil cannot resolve them, and the check refuses rather than let the
 * rows through. Every other relation resolves as it would without this.
 */
export function withLabelJoinTables(): void {
  const original: typeof QueryUtil.getManyToManyRelationMetadata =
    QueryUtil.getManyToManyRelationMetadata.bind(QueryUtil);

  jest
    .spyOn(QueryUtil, "getManyToManyRelationMetadata")
    .mockImplementation(
      <TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        propertyPath: string,
      ): ManyToManyMetadata => {
        const model: TBaseModel = new modelType();

        if (propertyPath !== model.getAccessControlColumn()) {
          return original(modelType, propertyPath);
        }

        return getLabelJoinTable(modelType);
      },
    );
}

// The label join table of a model that carries labels.
export function getLabelJoinTable(modelType: {
  new (): BaseModel;
}): NonNullable<ManyToManyMetadata> {
  const tableName: string = new modelType().tableName || modelType.name;

  return {
    joinTableName: `${tableName}Label`,
    ownerColumnName: `${tableName.charAt(0).toLowerCase()}${tableName.slice(1)}Id`,
    relationColumnName: "labelId",
  };
}
