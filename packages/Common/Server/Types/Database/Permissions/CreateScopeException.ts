import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";

/*
 * A create refused because the record it makes is not one the caller's
 * create permission reaches: a permission limited to some labels, to the
 * records the caller owns, or a block with labels (CreateScopePermission).
 *
 * To every API caller it is the NotAuthorizedException it reads as - the
 * same status, the message saying what would let the record through. Its
 * own type lets a service that makes records for a person right after they
 * made the record those belong to (the first escalation rule of a new
 * on-call policy, the owners picked for a new status page) tell it from a
 * missing permission.
 */
export default class CreateScopeException extends NotAuthorizedException {}
