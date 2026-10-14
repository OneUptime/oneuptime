import DatabaseService from "../../../../Services/DatabaseService";
import { RowsKeptOnDeleteRule } from "../../../../Utils/Database/StateTimelineRowsKept";
import logger from "../../../../Utils/Logger";
import Query from "../../../Database/Query";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { describeRowsKeptByDelete } from "../../../../../Types/StateTimeline/RowsKeptOnDelete";

/*
 * After a Delete One or Delete Many step: what the table kept of the rows
 * the step's query names, said in the run's log. A state timeline keeps each
 * record's current row - a monitor's current status, an incident's current
 * state - and a status timeline its last 90 days, whatever a delete by query
 * asks (DatabaseService.keepRowsOnDeleteByQuery). Without this line a step
 * that deleted fewer rows than it matched, or none, would not say why.
 *
 * Counted as the step reads its rows. Nothing for a table that keeps no
 * rows, or a query that names one row by its id. A count that fails is
 * logged for OneUptime and left out of the run's log: the delete itself has
 * already happened, and the step still takes Success.
 */
export default async function logRowsKeptByDelete<
  TBaseModel extends BaseModel,
>(data: {
  service: DatabaseService<TBaseModel>;
  query: Query<TBaseModel>;
  props: DatabaseCommonInteractionProps;
  log: (message: string) => void;
}): Promise<number> {
  const rule: RowsKeptOnDeleteRule | null =
    data.service.getRowsKeptOnDeleteByQuery();

  if (!rule) {
    return 0;
  }

  let kept: number | null = null;

  try {
    kept = await data.service.countRowsKeptOnDeleteByQuery({
      query: data.query,
      props: data.props,
    });
  } catch (err) {
    logger.error(err);
    return 0;
  }

  if (!kept) {
    return 0;
  }

  const model: TBaseModel = data.service.getModel();

  data.log(
    describeRowsKeptByDelete({
      count: kept,
      kept: rule.kept,
      one: model.singularName || rule.tableName,
      many: model.pluralName || model.singularName || rule.tableName,
    }),
  );

  return kept;
}
