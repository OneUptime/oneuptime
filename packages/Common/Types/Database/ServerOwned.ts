/*
 * A column whose value OneUptime keeps once the record exists, instead of
 * whoever writes the record (TableColumnMetadata.serverOwned): a monitor's
 * current status, which its checks move; when a telemetry monitor was last
 * evaluated; how many nodes a Kubernetes cluster's agent last counted.
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
 */
enum ServerOwned {
  /*
   * Only OneUptime writes it - a check, a worker, ingest, an agent's report
   * - and nobody picks it: when a heartbeat last came, when a telemetry
   * monitor runs next, a count an agent reported, whether an owner was told.
   * The spec leaves it out of the create and update schemas and marks it
   * read only, so the providers only read it: Terraform as a read-only
   * attribute, Crossplane in status.atProvider alone. The API still takes
   * a value from whoever its permissions let write it, as before.
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
}

export default ServerOwned;
