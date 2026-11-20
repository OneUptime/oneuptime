/*
 * A column whose value OneUptime keeps, or changes too, once the record
 * exists, instead of whoever writes the record alone
 * (TableColumnMetadata.serverOwned): a monitor's current status, which its
 * checks move; when a telemetry monitor was last evaluated; how many nodes a
 * Kubernetes cluster's agent last counted; the labels a label rule adds.
 *
 * Clients that keep a record the way a file says - the Terraform and
 * OpenTofu provider, and the Crossplane provider made from it - would
 * otherwise fight OneUptime over it: Crossplane copied the value into the
 * manifest, then set it back after OneUptime moved it, or failed every
 * reconcile when a value only a create may give moved (#9985). The OpenAPI
 * spec names the column's kind (x-oneuptime-server-owned: ModelSchema), and
 * the providers generated from it treat it so.
 *
 * Only what OneUptime changes on its own belongs here. A value OneUptime
 * fills in once, when a create leaves it out, and never changes again (a
 * default, the time an incident was declared) is the writer's.
 *
 * The values are the spec's, and stay as they are: readers compare a column
 * against the kind they handle (=== ServerOwned.Always), and any kind means
 * OneUptime may move the value - a configuration written from what a record
 * holds now leaves every one of them out (DeveloperDocs/TerraformSchema
 * .isServerManagedColumn).
 */
enum ServerOwned {
  /*
   * Only OneUptime writes it - a check, a worker, ingest, an agent's report
   * - and nobody picks it: when a heartbeat last came, when a telemetry
   * monitor runs next, a count an agent reported, whether an owner was told.
   * The spec leaves it out of the create and update schemas and marks it
   * read only, so the providers only read it: Terraform as a read-only
   * attribute, Crossplane in status.atProvider alone. Unless OneUptime
   * itself or a server admin writes it, a create through the API drops a
   * value given for it, and an update that names it is refused
   * (ColumnsOnlyOneUptimeWrites, #10053).
   */
  Always = "always",
  /*
   * A create may give its first value, and OneUptime moves it on from
   * there: the status a new monitor starts in, the state a new incident is
   * declared in, the end of a state timeline row that a back-filled change
   * gives and the next change of state sets. The spec keeps it in the
   * create and update schemas - an update through the API changes it by
   * hand, as the dashboard does - and the providers send it only to create
   * the record: after that, a configuration's value is never compared with
   * OneUptime's, Terraform plans no change and Crossplane never copies it
   * into the manifest or puts it back.
   */
  AfterCreate = "after-create",
  /*
   * People change it and so does OneUptime, on its own (#10052): the labels
   * a label rule adds to a record, an exception OneUptime resolves, the site
   * discovery finds a device at, a postmortem an AI writes. It stays a
   * person's to set - the spec keeps it in the create and update schemas -
   * and the providers never take OneUptime's change for one to undo:
   *
   *   - left out of a configuration or a manifest, it is OneUptime's: no
   *     plan puts back what OneUptime set, even where the attribute has a
   *     default, and Crossplane never copies it into spec.forProvider;
   *   - written in a manifest's spec.forProvider, Crossplane sends a value
   *     to create the record and again whenever the manifest's value
   *     changes, and leaves OneUptime's changes in between; a list (labels)
   *     is held to the entries the manifest declares - one OneUptime added
   *     stays, one taken out of the manifest goes;
   *   - written in a Terraform configuration, every plan holds the record to
   *     it, as Terraform does any attribute: a plan says what it changes, so
   *     it shows OneUptime's change and puts it back, and `ignore_changes`
   *     gives the value at creation alone.
   */
  Shared = "shared",
}

export default ServerOwned;
