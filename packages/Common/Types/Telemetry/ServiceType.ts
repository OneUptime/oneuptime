/*
 * Discriminator stored in the `serviceType` column of every telemetry
 * row. Tells the read side which Postgres table the row's `serviceId`
 * points at (the column name is historical — semantically it's a
 * resource-type discriminator, since hosts, docker hosts, k8s clusters
 * and monitors all reuse the `serviceId` slot to avoid synthesising
 * placeholder Service rows just to satisfy the ClickHouse primary key).
 */
enum ServiceType {
  OpenTelemetry = "OpenTelemetry",
  Monitor = "Monitor",
  NetworkDevice = "NetworkDevice",
  Alert = "Alert",
  Incident = "Incident",
  ScheduledMaintenance = "ScheduledMaintenance",
  /*
   * The `oneuptime.slo.*` readings the SLO evaluation worker posts. Like
   * Monitor / Alert / Incident rows they are OneUptime's own operational
   * data, so TelemetryUsageBillingService never bills them as ingested
   * telemetry.
   */
  ServiceLevelObjective = "ServiceLevelObjective",
  Host = "Host",
  DockerHost = "DockerHost",
  PodmanHost = "PodmanHost",
  KubernetesCluster = "KubernetesCluster",
  ProxmoxCluster = "ProxmoxCluster",
  OpenStackCloud = "OpenStackCloud",
  CephCluster = "CephCluster",
  StorageArray = "StorageArray",
  DockerSwarmCluster = "DockerSwarmCluster",
  VMwareVCenter = "VMwareVCenter",
  IoTDevice = "IoTDevice",
  ServerlessFunction = "ServerlessFunction",
  CloudResource = "CloudResource",
  RealUserMonitor = "RealUserMonitor",
  /*
   * A DatabaseServer row: telemetry collected from the database itself by an
   * OTel Collector database receiver / the OneUptime Database Agent, when the
   * resource carries no service.name. Application CLIENT spans that merely
   * call the database keep their own service as primary entity and reach the
   * database through its endpoint entity keys instead.
   */
  DatabaseServer = "DatabaseServer",
  /*
   * The oneuptime.data.table.* readings Data Observability writes for each
   * table of a data store at every collection. Like Monitor and SLO rows they
   * are OneUptime's own operational data, so TelemetryUsageBillingService
   * never bills them as ingested telemetry.
   */
  DataStore = "DataStore",
  /*
   * Data Observability's pipeline run rows (oneuptime.data.pipeline.*),
   * from OpenLineage events: the pipeline whose runs they describe. Like
   * table health, never billed as ingested telemetry.
   */
  DataPipeline = "DataPipeline",
  /*
   * Data Observability's data product rows (oneuptime.data.product.*):
   * whether a product's tables are fresh by its SLA. Like table health and
   * pipeline runs, never billed as ingested telemetry.
   */
  DataProduct = "DataProduct",
  /*
   * Data Observability's reconciliation rows (oneuptime.data.reconciliation.*):
   * whether two copies of the same data agree. Like table health, never
   * billed as ingested telemetry.
   */
  DataReconciliation = "DataReconciliation",
  /*
   * Telemetry that arrived without an OTel service.name and with no
   * host / docker / k8s resource signal. Instead of synthesising a
   * placeholder "Unknown Service" Postgres row (which collected every
   * oneuptime.label.* attribute from unrelated sources), the row's
   * `serviceId` slot holds the projectId and no Service row is created.
   * The read side renders these under a synthetic "Unknown Service"
   * bucket.
   */
  Unknown = "Unknown",
}

export default ServiceType;
