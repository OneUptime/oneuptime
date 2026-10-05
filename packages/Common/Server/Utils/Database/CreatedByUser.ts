import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import RelationIdUtil from "./RelationIdUtil";

// The two names of a record's creator, ID column first.
export const CREATED_BY_USER_KEYS: Array<string> = [
  "createdByUserId",
  "createdByUser",
];

/*
 * Who a record being created is by - for the "created by" line a service
 * writes into it (an incident's root cause, a state change's) before it is
 * saved.
 *
 * The person making the request, when there is one: DatabaseService stamps
 * them as the record's creator, and drops a `createdByUser` relation the
 * request sent beside it, so the line names the person the record will be
 * saved under. With no person on the request (a job, a workflow), the creator
 * the write names, under either of its names - the two must agree
 * (RelationIdUtil.readConsistent).
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
