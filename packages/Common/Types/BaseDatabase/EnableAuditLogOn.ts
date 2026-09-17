/*
 * Where a child row's audit entries roll up to.
 *
 * Every AuditLog row records the resource it changed (resourceType /
 * resourceId) and the top-level resource that change belongs to
 * (rootResourceType / rootResourceId). A resource's audit page filters on the
 * root pointer, so it lists the history of the rows it owns as well as its
 * own - an SLO's page shows edits to its burn-rate rules, monitor rules and
 * owners. It is a column rather than a query because analytics queries have
 * no cross-column OR, and a list of current child ids would lose every child
 * that has since been deleted.
 */
export interface AuditLogRootResource {
  /*
   * The root model's singularName, exactly as AuditLogService writes it on
   * the root's own rows (AuditLog.resourceType).
   */
  resourceType: string;
  // The ObjectID column on this model that holds the root resource's id.
  column: string;
}

export default interface EnableAuditLogOn {
  create?: boolean | undefined;
  update?: boolean | undefined;
  delete?: boolean | undefined;
  /*
   * Unset for a top-level resource, whose rows point at themselves.
   */
  rootResource?: AuditLogRootResource | undefined;
  /*
   * Columns the audit trail does not track. They are left out of create and
   * delete snapshots and out of update diffs, so a write that touches only
   * these columns records nothing. Meant for bookkeeping that a background
   * worker rewrites on every tick (an SLO's current SLI, a rule's last-fired
   * stamp): recorded, it would bury every change a person made.
   */
  ignoreColumns?: Array<string> | undefined;
  /*
   * An Entity (many-to-one) column whose target names this row, for rows with
   * no name, title or displayName of their own - an owner row is just a user
   * id or a team id. A user is named by their name, else their email; any
   * other model by its `name` column, looked up inside the row's project.
   */
  resourceNameRelation?: string | undefined;
}
