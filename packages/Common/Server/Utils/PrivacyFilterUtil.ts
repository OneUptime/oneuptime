import Includes from "../../Types/BaseDatabase/Includes";
import { FindWhereProperty } from "../../Types/BaseDatabase/Query";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import { And, Equal, FindOperator } from "typeorm";

/*
 * Combines a caller-supplied filter value with a privacy Raw clause so that
 * BOTH apply. The privacy filters used to overwrite the caller's value, which
 * silently widened per-record queries (e.g. `incidentId: <id>` on the
 * incident's Private Notes page) to every record the user was allowed to see
 * — leaking notes/feed/owner rows across incidents for non-admin users.
 *
 * Runs in onBefore* hooks, i.e. BEFORE QueryUtil.serializeQuery, so the
 * existing value can be a plain value (string/ObjectID/boolean/array), an
 * Includes operator, or an already-built TypeORM FindOperator. Values are
 * converted to TypeORM operators here because serializeQuery does not
 * transform values nested inside And().
 */
export function combineWithPrivacyClause(
  existingValue: unknown,
  privacyClause: FindWhereProperty<any>,
): FindWhereProperty<any> {
  const privacyOperator: FindOperator<any> =
    privacyClause as unknown as FindOperator<any>;

  if (existingValue === undefined || existingValue === null) {
    return privacyClause;
  }

  if (existingValue instanceof FindOperator) {
    return And(existingValue, privacyOperator) as FindWhereProperty<any>;
  }

  if (existingValue instanceof ObjectID) {
    return And(
      Equal(existingValue.toString()),
      privacyOperator,
    ) as FindWhereProperty<any>;
  }

  if (existingValue instanceof Includes) {
    return And(
      QueryHelper.any(existingValue.values) as unknown as FindOperator<any>,
      privacyOperator,
    ) as FindWhereProperty<any>;
  }

  if (Array.isArray(existingValue)) {
    return And(
      QueryHelper.any(
        existingValue as Array<string | ObjectID | number>,
      ) as unknown as FindOperator<any>,
      privacyOperator,
    ) as FindWhereProperty<any>;
  }

  if (
    typeof existingValue === "string" ||
    typeof existingValue === "number" ||
    typeof existingValue === "boolean" ||
    existingValue instanceof Date
  ) {
    return And(Equal(existingValue), privacyOperator) as FindWhereProperty<any>;
  }

  /*
   * Unrecognized operator shape (no caller passes these on privacy-filtered
   * keys today). Fail closed: the privacy clause must always apply.
   */
  return privacyClause;
}
