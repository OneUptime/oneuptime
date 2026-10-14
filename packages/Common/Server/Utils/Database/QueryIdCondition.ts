import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { And, FindOperator } from "typeorm";

/*
 * A condition added to a query on the row's own id, beside whatever the query
 * already says there - the way DatabaseService narrows a delete by query to
 * the rows it may take (keepRowsOnDeleteByQuery).
 */

// A table alias that is safe to write into SQL as it is.
const PLAIN_IDENTIFIER: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/;

export default class QueryIdCondition {
  /*
   * The query, with `condition` on the row id as well. What the query already
   * says about the id stays beside it: an id, a list of ids, or a condition
   * of its own (a permission check's, a hold's). A shape that cannot be kept
   * beside it is refused, never dropped: dropping it would widen the query.
   */
  public static withIdCondition<TBaseModel extends BaseModel>(
    query: Query<TBaseModel>,
    condition: FindOperator<unknown>,
  ): Query<TBaseModel> {
    const asked: unknown = (query as Record<string, unknown>)["_id"];

    if (asked === undefined) {
      return { ...query, _id: condition } as Query<TBaseModel>;
    }

    const askedCondition: FindOperator<unknown> | null =
      QueryIdCondition.asCondition(asked);

    if (!askedCondition) {
      throw new BadDataException(
        "This query names its rows by an id in a form that cannot be combined with another condition. Name them by one id, or by a list of ids.",
      );
    }

    return {
      ...query,
      _id: And(askedCondition, condition),
    } as Query<TBaseModel>;
  }

  /*
   * The table a Raw condition on a column is written for: TypeORM hands the
   * condition its column as `<alias>.<column>` (the alias quoted or not), and
   * a condition that reads the row's other columns needs the alias alone.
   * Answered quoted. Refuses anything but a plain alias: what goes into the
   * SQL must be the statement's own name for the table.
   */
  public static rowAliasOf(columnPath: string, column: string): string {
    const suffixes: Array<string> = [`."${column}"`, `.${column}`];

    for (const suffix of suffixes) {
      if (!columnPath.endsWith(suffix)) {
        continue;
      }

      let alias: string = columnPath.slice(0, -suffix.length);

      if (alias.length >= 2 && alias.startsWith('"') && alias.endsWith('"')) {
        alias = alias.slice(1, -1);
      }

      if (PLAIN_IDENTIFIER.test(alias)) {
        return `"${alias}"`;
      }
    }

    throw new BadDataException(
      `Cannot tell which table "${columnPath}" belongs to.`,
    );
  }

  // What the query says about the id, as a condition, or null for a shape it cannot be.
  private static asCondition(asked: unknown): FindOperator<unknown> | null {
    if (asked instanceof FindOperator) {
      return asked as FindOperator<unknown>;
    }

    if (asked instanceof ObjectID || typeof asked === "string") {
      return QueryHelper.equalTo(asked.toString()) as FindOperator<unknown>;
    }

    if (
      Array.isArray(asked) &&
      asked.every((id: unknown): boolean => {
        return id instanceof ObjectID || typeof id === "string";
      })
    ) {
      return QueryHelper.any(
        asked.map((id: ObjectID | string): string => {
          return id.toString();
        }),
      ) as unknown as FindOperator<unknown>;
    }

    return null;
  }
}
