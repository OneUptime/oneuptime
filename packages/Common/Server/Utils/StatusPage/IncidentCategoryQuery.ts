import QueryIdCondition from "../Database/QueryIdCondition";
import { FindOperator, Raw } from "typeorm";

export default function incidentCategoryCondition(
  labelIds: Array<string>,
  exclude: boolean,
): FindOperator<unknown> {
  return Raw(
    (idColumn: string): string => {
      const row: string = QueryIdCondition.rowAliasOf(idColumn, "_id");
      return `${exclude ? "NOT " : ""}EXISTS (
        SELECT 1 FROM "IncidentLabel" AS category_label
        WHERE category_label."incidentId" = ${row}."_id"
          AND category_label."labelId" = ANY(CAST(:incidentCategoryLabels AS uuid[]))
      )`;
    },
    { incidentCategoryLabels: labelIds },
  );
}
