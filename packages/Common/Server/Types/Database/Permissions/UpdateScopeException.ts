import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";

/*
 * A change refused because of the labels the record would carry after it:
 * the caller's permission to update the record is limited to some labels
 * and the record would carry none of them, or a block with labels on that
 * permission names a label the record would carry (UpdateScopePermission).
 *
 * To every API caller it is the NotAuthorizedException it reads as - the
 * same status, the message naming the labels - as a create outside its
 * create permission's labels is (CreateScopeException).
 */
export default class UpdateScopeException extends NotAuthorizedException {}
