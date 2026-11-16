import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import QueryUtil from "../../../Server/Types/Database/QueryUtil";
import { jest } from "@jest/globals";
import { FindOperator } from "typeorm";

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

/*
 * THE LABELS A QUERY KEEPS A LABELLED MODEL'S RECORDS TO, one list per
 * condition - a record must carry one label of each list. A grant limited
 * to labels is a condition on the record's id that the label join table
 * answers, `_id IN (SELECT "<Table>Label"."<table>Id" ...)`
 * (AccessControlPermission.addLabelIdsToQuery, #8113); without the join
 * table's names it is a filter through the relation itself, `labels: [ids]`.
 * A block's `NOT IN` keeps the records to no label, and is not one.
 */
export function getLabelListsKeptTo(
  modelType: { new (): BaseModel },
  query: unknown,
): Array<Array<string>> {
  const { joinTableName, ownerColumnName } = getLabelJoinTable(modelType);
  const grantPrefix: string = `(record._id IN (SELECT "${joinTableName}"."${ownerColumnName}" FROM "${joinTableName}"`;
  const lists: Array<Array<string>> = [];
  const conditions: Record<string, unknown> = (query || {}) as Record<
    string,
    unknown
  >;

  const visit: (condition: unknown) => void = (condition: unknown): void => {
    if (!(condition instanceof FindOperator)) {
      return;
    }

    if (condition.type === "and") {
      (condition.value as unknown as Array<unknown>).forEach(visit);
      return;
    }

    const sql: string =
      typeof condition.getSql === "function"
        ? condition.getSql("record._id")
        : "";

    if (sql.startsWith(grantPrefix)) {
      lists.push(
        Object.values(condition.objectLiteralParameters || {})
          .flat()
          .map((labelId: unknown): string => {
            return String(labelId);
          })
          .sort(),
      );
    }
  };

  visit(conditions["_id"]);

  if (Array.isArray(conditions["labels"])) {
    lists.push(
      (conditions["labels"] as Array<unknown>)
        .map((labelId: unknown): string => {
          return String(labelId);
        })
        .sort(),
    );
  }

  return lists;
}

// Every label of getLabelListsKeptTo, as one sorted list.
export function getLabelsKeptTo(
  modelType: { new (): BaseModel },
  query: unknown,
): Array<string> {
  return getLabelListsKeptTo(modelType, query).flat().sort();
}
