import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";

/*
 * A workflow's step that would create, change or delete a record that
 * decides who may do what in a project - a team, a team's members or
 * permissions, a custom role, an API key's permissions
 * (WorkflowPrincipal.ACCESS_TABLES).
 *
 * It is the NotAuthorizedException it would be anywhere else, so whatever
 * maps a refusal to a status still does. It has its own type so that what
 * reports a refusal in plain words - a step's run log (LogComponentError) -
 * says this one as it is, and not as "only what a Project Admin can do": a
 * Project Admin may make the change; a step may not.
 */
export default class WorkflowAccessChangeRefusedException extends NotAuthorizedException {}
