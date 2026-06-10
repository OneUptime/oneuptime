/*
 * The relationship taxonomy between OpenTelemetry entities. The upstream
 * OTel spec deliberately leaves entity relationships unstandardized
 * ("refined in future specification work"), so OneUptime infers a small,
 * durable set of directed relationships from resource co-occurrence — the
 * entities that appear together in one resource are, by construction,
 * related. See Internal/Docs/OpenTelemetryEntities.md §4.
 */
enum EntityRelationshipType {
  /** e.g. a pod runs on a node; a process runs on a host. */
  RunsOn = "runs-on",
  /** e.g. a pod / node / namespace is a member of a cluster. */
  MemberOf = "member-of",
  /** e.g. a service is hosted on a host. */
  HostedOn = "hosted-on",
  /** e.g. a container is part of a pod; a process is part of a container. */
  PartOf = "part-of",
  /** e.g. a service.instance is an instance of a service. */
  InstanceOf = "instance-of",
  /**
   * Service → service dependency (the service map; the resurrected
   * ServiceDependency capability). Unlike the co-occurrence types above,
   * this is NOT inferred from one resource's entity set — caller and
   * callee never share a resource. It is derived from parent/child span
   * pairs that cross a service boundary (see the
   * TelemetryEntity:ComputeServiceDependencies worker cron).
   */
  DependsOn = "depends-on",
}

export default EntityRelationshipType;
