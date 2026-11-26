import WorkflowAccessChangeRefusedException from "./WorkflowAccessChangeRefusedException";

/*
 * A step of a workflow that runs with the default permissions that would
 * create, change or delete a record that holds the project's secrets - a
 * runbook variable, a monitor secret, a BI tool connection, a threat intel
 * feed (WorkflowPrincipal.SECRET_TABLES).
 *
 * A Project Admin may make the change, a step may not, so it is said as it
 * is, as a refused change to who has access is (LogComponentError reads it
 * as one), and is the NotAuthorizedException it would be anywhere else.
 */
export default class WorkflowSecretChangeRefusedException extends WorkflowAccessChangeRefusedException {}
