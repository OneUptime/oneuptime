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
  Alert = "Alert",
  Incident = "Incident",
  Host = "Host",
  DockerHost = "DockerHost",
  KubernetesCluster = "KubernetesCluster",
  ServerlessFunction = "ServerlessFunction",
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
