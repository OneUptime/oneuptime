/*
 * The vocabulary of OpenTelemetry-aligned entity types OneUptime can
 * derive from a resource. One OTLP resource is a *composition* of many
 * entities — a span can simultaneously belong to a `service`, a `host`,
 * a `k8s.pod`, a `k8s.node`, a `k8s.cluster`, a `container` and a
 * `process`. Each value is the entity's immutable `type` per the OTel
 * entity data model (https://opentelemetry.io/docs/specs/otel/entities/).
 *
 * This is the broader *membership* vocabulary used by the `entityKeys`
 * column on signals and by the `TelemetryEntity` registry. It is distinct
 * from `ServiceType`, which is the narrower discriminator for a signal's
 * single *primary* entity (`primaryEntityType`) and additionally covers
 * OneUptime-specific primary owners (Monitor, RealUserMonitor, Unknown,
 * ...) that are not OTel resource entities.
 *
 * The string values are the semconv-style dotted type names so they read
 * naturally in stored identity sets and in the registry.
 */
enum EntityType {
  Service = "service",
  ServiceInstance = "service.instance",
  Host = "host",
  Container = "container",
  Process = "process",
  KubernetesCluster = "k8s.cluster",
  KubernetesNamespace = "k8s.namespace",
  KubernetesNode = "k8s.node",
  KubernetesPod = "k8s.pod",
  KubernetesDeployment = "k8s.deployment",
  /*
   * Proxmox VE / Ceph types are OneUptime-defined (no upstream semconv
   * exists for either) but follow the same dotted naming convention. The
   * identifying attributes (`proxmox.cluster.name`, `proxmox.node.name`,
   * `proxmox.guest.vmid`, `ceph.cluster.name`) are stamped by our agent
   * collector configs — see Internal/Roadmap/ProxmoxCephProducts.md §1.
   */
  ProxmoxCluster = "proxmox.cluster",
  ProxmoxNode = "proxmox.node",
  ProxmoxGuest = "proxmox.guest",
  CephCluster = "ceph.cluster",
  /*
   * Docker Swarm types are OneUptime-defined (no upstream semconv
   * exists) but follow the same dotted naming convention. The
   * identifying attributes (`docker.swarm.cluster.name`,
   * `docker.swarm.node.id`, `docker.swarm.service.id`) are stamped by
   * the OneUptime Docker Swarm agent's collector config / inventory
   * poller.
   */
  DockerSwarmCluster = "docker.swarm.cluster",
  DockerSwarmNode = "docker.swarm.node",
  DockerSwarmService = "docker.swarm.service",
  DockerSwarmTask = "docker.swarm.task",
  TelemetrySdk = "telemetry.sdk",
  /*
   * Inventory-mirrored types. Unlike everything above, these are never
   * derived from an OTLP resource — the estate they describe is collected
   * by pollers (SNMP, cloud APIs, MQTT) into rich typed tables, and the
   * registry row is a mirror of that row so the entity explorer can show
   * one estate instead of one telemetry pipeline. Their identity is the
   * owning row's own project-unique key, and their lifecycle follows it
   * (see InventoryEntityRegistry); they carry EntitySource.Inventory and
   * are deliberately absent from the prune TTL map.
   */
  NetworkDevice = "network.device",
  CloudResource = "cloud.resource",
  ServerlessFunction = "serverless.function",
  RumApplication = "rum.application",
  IoTDevice = "iot.device",
  DockerHost = "docker.host",
  PodmanHost = "podman.host",
  /*
   * Manual (user-authored) types, for the parts of an estate that emit no
   * telemetry and appear in no inventory table: a third-party payment API,
   * a vendor-managed database, a physical appliance. They exist so a
   * dependency edge can terminate somewhere real instead of dangling at
   * the boundary of what OneUptime can see. Carry EntitySource.Manual.
   */
  ExternalService = "external.service",
  ExternalDatabase = "external.database",
  Appliance = "appliance",
}

export default EntityType;
