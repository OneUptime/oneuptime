/*
 * The broad, multi-membership vocabulary for OpenTelemetry entities.
 *
 * A single telemetry signal (span / log / metric / …) is a *composition*
 * of several entities — it can simultaneously belong to a `service`, a
 * `host`, a `k8s.pod`, a `k8s.node`, a `k8s.cluster`, a `container` and a
 * `process`. `EntityType` is the type discriminator for each of those.
 *
 * This is intentionally separate from `ServiceType` (the single-owner
 * discriminator stamped in the `serviceId`/`serviceType` slot of every
 * analytics row). `ServiceType` answers "which Postgres table does this
 * row's primary owner live in" and stays the authorization key.
 * `EntityType` answers "what kinds of entities does this signal belong
 * to" and drives the additive `entityKeys` membership + the
 * `TelemetryEntity` registry.
 *
 * Values are the semconv-aligned OTel entity type strings so they line up
 * with `entity_refs` when producers emit them. See
 * https://opentelemetry.io/docs/specs/otel/entities/data-model/
 */
enum EntityType {
  Service = "service",
  ServiceInstance = "service.instance",
  Host = "host",
  KubernetesCluster = "k8s.cluster",
  KubernetesNamespace = "k8s.namespace",
  KubernetesNode = "k8s.node",
  KubernetesPod = "k8s.pod",
  KubernetesDeployment = "k8s.deployment",
  Container = "container",
  Process = "process",
  TelemetrySdk = "telemetry.sdk",
}

export default EntityType;
