import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import {
  CREATED_BY_USER_COLUMN,
  CREATED_BY_USER_ID_COLUMN,
} from "../../../Types/Database/UserAttribution";
import RelationIdUtil from "./RelationIdUtil";

// The two names of a record's creator, ID column first.
export const CREATED_BY_USER_KEYS: Array<string> = [
  CREATED_BY_USER_ID_COLUMN,
  CREATED_BY_USER_COLUMN,
];

/*
 * Who a record being created is by - for the "created by" line a service
 * writes into it (an incident's root cause, a state change's) before it is
 * saved.
 *
 * The person making the request, when there is one: DatabaseService stamps
 * them as the record's creator. With no person on the request, the creator
 * the write names, under either of its names - the two must agree
 * (RelationIdUtil.readConsistent) - which only OneUptime's own server code
 * can still name by the time a hook runs: DatabaseService has taken it out
 * of every other write, an API key's or a workflow's included
 * (UserAttribution), so those create a record by nobody.
 */
export default class CreatedByUser {
  public static getId(
    data: unknown,
    props: DatabaseCommonInteractionProps,
  ): ObjectID | null {
    if (props.userId) {
      return props.userId;
    }

    return RelationIdUtil.readConsistent(
      data && typeof data === "object" ? (data as Record<string, unknown>) : {},
      CREATED_BY_USER_KEYS,
      "Created By User",
    );
  }
}
