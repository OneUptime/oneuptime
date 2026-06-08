/*
 * Relationship taxonomy for `TelemetryEntityRelationship` edges.
 *
 * OpenTelemetry has NOT standardized entity relationships yet ("refined
 * in future specification work"), so we keep our own small, inferred set.
 * `relType` is derived purely from the type pair of two entities that
 * co-occur in the same resource — e.g. a pod co-occurring with a node is
 * a `runs-on` edge. See `EntityExtractor.inferRelationships`.
 */
enum EntityRelationshipType {
  // pod -> node
  RunsOn = "runs-on",
  // pod -> cluster, node -> cluster, namespace -> cluster, deployment -> namespace
  MemberOf = "member-of",
  // service -> host, container -> host
  HostedOn = "hosted-on",
  // container -> pod, process -> container
  PartOf = "part-of",
  // service.instance -> service
  InstanceOf = "instance-of",
  // service -> service (derived from span client/server boundaries; phase 5 fast-follow)
  DependsOn = "depends-on",
}

export default EntityRelationshipType;
