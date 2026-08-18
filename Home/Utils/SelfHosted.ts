/*
 * Structured content for the self-hosted landing page (/enterprise/self-hosted).
 *
 * Everything an enterprise buyer needs to evaluate running OneUptime on their
 * own infrastructure lives here so the page, the tests, and the
 * machine-readable surfaces (/data/self-hosted.json) all read from one source.
 *
 * Every claim on this page must be traceable to something we actually ship:
 * the Helm chart in HelmChart/Public/oneuptime, its docs, or the governed
 * claims matrix in Utils/Claims.ts. Do not add a capability here that a
 * customer cannot switch on from values.yaml or a signed order form.
 */

export type DeploymentModelKey =
  | "kubernetes"
  | "docker-compose"
  | "private-cloud"
  | "cloud";

export interface DeploymentModel {
  key: DeploymentModelKey;
  name: string;
  tagline: string;
  bestFor: string;
  // Who runs the infrastructure the platform sits on.
  infrastructure: string;
  // Who is accountable for upgrades on this model.
  upgrades: string;
  highlights: Array<string>;
  docsUrl: string;
  recommended: boolean;
}

export interface ArchitectureComponent {
  name: string;
  description: string;
  // Scaling story: how this tier grows with load.
  scaling: string;
}

export interface ArchitectureTier {
  key: string;
  name: string;
  description: string;
  accent: string;
  components: Array<ArchitectureComponent>;
}

export interface SizingTier {
  key: string;
  name: string;
  workload: string;
  nodes: string;
  cpu: string;
  memory: string;
  storage: string;
  notes: string;
}

export interface RequirementGroup {
  title: string;
  items: Array<string>;
}

export interface ResilienceControl {
  title: string;
  description: string;
  // The exact values.yaml key(s) that turn this on, so buyers can verify.
  setting: string;
}

export interface ResponsibilityRow {
  area: string;
  oneuptime: string;
  customer: string;
}

export interface SupportTierRow {
  key: string;
  name: string;
  description: string;
  included: Array<string>;
  excluded: Array<string>;
}

export interface AirGapStep {
  title: string;
  description: string;
  setting: string;
}

export interface SelfHostedFaq {
  question: string;
  answer: string;
}

const HELM_DOCS_BASE: string =
  "https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs";

export interface HelmDocLinks {
  installation: string;
  configuration: string;
  databases: string;
  productionChecklist: string;
  upgradeNotes: string;
  troubleshooting: string;
  customDomains: string;
  localAi: string;
  chart: string;
  repository: string;
  releases: string;
}

export const HelmDocs: HelmDocLinks = {
  installation: `${HELM_DOCS_BASE}/installation.md`,
  configuration: `${HELM_DOCS_BASE}/configuration.md`,
  databases: `${HELM_DOCS_BASE}/databases.md`,
  productionChecklist: `${HELM_DOCS_BASE}/production-checklist.md`,
  upgradeNotes: `${HELM_DOCS_BASE}/upgrade-notes.md`,
  troubleshooting: `${HELM_DOCS_BASE}/troubleshooting.md`,
  customDomains: `${HELM_DOCS_BASE}/custom-domains.md`,
  localAi: `${HELM_DOCS_BASE}/ai-vllm.md`,
  chart:
    "https://github.com/OneUptime/oneuptime/tree/master/HelmChart/Public/oneuptime",
  repository: "https://github.com/OneUptime/oneuptime",
  releases: "https://github.com/OneUptime/oneuptime/releases",
};

export const DeploymentModels: Array<DeploymentModel> = [
  {
    key: "kubernetes",
    name: "Kubernetes (Helm)",
    tagline: "The supported production deployment.",
    bestFor:
      "Production self-hosting, regulated environments, and anything that needs horizontal scale or high availability.",
    infrastructure: "Your cluster, your cloud or data centre",
    upgrades: "You run `helm upgrade` on your own schedule",
    highlights: [
      "One chart deploys the whole platform — ingress, API, workers, probes, and databases",
      "Bundled PostgreSQL (CloudNativePG) and ClickHouse (Altinity) operators for replicated databases",
      "KEDA and HPA autoscaling, Pod Disruption Budgets, and a dedicated worker tier",
      "Runs on any conformant Kubernetes — EKS, AKS, GKE, OpenShift, Rancher, or bare metal",
    ],
    docsUrl: HelmDocs.installation,
    recommended: true,
  },
  {
    key: "docker-compose",
    name: "Docker Compose",
    tagline: "Single host, fastest path to a running instance.",
    bestFor:
      "Proofs of concept, lab environments, and small internal installs that do not need HA.",
    infrastructure: "One Linux VM you control",
    upgrades: "You pull new images and restart the stack",
    highlights: [
      "One install script brings up the full platform on a single machine",
      "Same container images as the Kubernetes deployment — no feature differences",
      "Simple to snapshot, clone, and tear down for evaluation",
      "Not recommended for production: no replica-level redundancy on a single host",
    ],
    docsUrl: HelmDocs.repository,
    recommended: false,
  },
  {
    key: "private-cloud",
    name: "Private cloud (managed by us)",
    tagline: "Single-tenant, we operate it, you choose the region.",
    bestFor:
      "Teams that want isolation and data residency without staffing the operational burden of self-hosting.",
    infrastructure: "Dedicated single-tenant environment in your chosen region",
    upgrades: "We upgrade under an agreed maintenance window",
    highlights: [
      "Dedicated databases and storage — no shared multi-tenant data plane",
      "Region selected at provisioning time on AWS, Azure, GCP, or an agreed data centre",
      "Operational runbooks, backups, and upgrades handled by our team",
      "Commercial terms, SLAs, and support hours defined in the order form",
    ],
    docsUrl: "/legal/data-residency",
    recommended: false,
  },
  {
    key: "cloud",
    name: "OneUptime Cloud",
    tagline: "Multi-tenant SaaS, nothing to operate.",
    bestFor:
      "Teams that want the product without owning any infrastructure, and hybrid setups alongside a self-hosted install.",
    infrastructure: "Operated by OneUptime",
    upgrades: "Continuous — we ship several times a day",
    highlights: [
      "Same open-source platform, operated for you",
      "Uptime commitments and service credits defined in the SLA",
      "Useful as an external vantage point next to a self-hosted install",
      "Export your data and move to self-hosted at any time — same schema, same product",
    ],
    docsUrl: "/pricing",
    recommended: false,
  },
];

export const ArchitectureTiers: Array<ArchitectureTier> = [
  {
    key: "edge",
    name: "Edge",
    description:
      "Terminates TLS and routes every request into the platform. The only tier that needs to be reachable from outside the cluster.",
    accent: "blue",
    components: [
      {
        name: "Ingress gateway (nginx)",
        description:
          "Bundled gateway service. Fronts the dashboard, API, status pages, and custom status-page domains.",
        scaling: "Replicas + Pod Disruption Budget",
      },
      {
        name: "Certificate issuance",
        description:
          "Optional cert-manager ClusterIssuer for Let's Encrypt, or bring your own certificates and terminate TLS upstream.",
        scaling: "Cluster-wide",
      },
    ],
  },
  {
    key: "application",
    name: "Application",
    description:
      "Stateless tiers that serve the product and run everything that happens off the request path.",
    accent: "emerald",
    components: [
      {
        name: "API and dashboard (app)",
        description:
          "Serves the dashboard, the REST API, and status pages. Stateless — scale it out horizontally.",
        scaling: "HPA or KEDA on CPU / queue depth",
      },
      {
        name: "Worker",
        description:
          "Dedicated background-job tier: telemetry ingestion, notifications, incident and alert processing, workflows.",
        scaling: "KEDA on queue depth",
      },
      {
        name: "Telemetry writer",
        description:
          "Optional fixed-size tier that owns all ClickHouse insert concurrency so the worker fleet can autoscale without bound.",
        scaling: "Fixed replicas, bounded by ClickHouse capacity",
      },
      {
        name: "Runner",
        description:
          "Executes workflows and scheduled automation in isolation from the API tier.",
        scaling: "Replicas + PDB",
      },
      {
        name: "Probes",
        description:
          "Run the actual monitoring checks. Deploy them inside the cluster, in other networks, or in other regions to monitor from where your users are.",
        scaling: "One deployment per vantage point",
      },
    ],
  },
  {
    key: "data",
    name: "Data",
    description:
      "Where your telemetry and configuration live. All of it stays inside your perimeter.",
    accent: "violet",
    components: [
      {
        name: "PostgreSQL",
        description:
          "Configuration, incidents, users, and platform state. Run the bundled CloudNativePG operator for streaming replication and automatic failover, or point at your own managed PostgreSQL.",
        scaling: "CloudNativePG replicas, or external / managed",
      },
      {
        name: "ClickHouse",
        description:
          "Logs, metrics, traces, and spans. Run the bundled Altinity operator for replication and sharding, or point at your own cluster.",
        scaling: "Altinity shards and replicas",
      },
      {
        name: "Redis",
        description:
          "Queues, caching, and coordination between the API and worker tiers.",
        scaling: "Bundled or external",
      },
      {
        name: "PgBouncer",
        description:
          "Optional transaction-mode connection pooler. Keeps an autoscaling worker fleet from exhausting PostgreSQL connections.",
        scaling: "Pool size tuned to database max_connections",
      },
    ],
  },
  {
    key: "ingest",
    name: "Ingest",
    description:
      "How telemetry gets in. Open standards only — nothing proprietary on the wire.",
    accent: "amber",
    components: [
      {
        name: "OpenTelemetry collector",
        description:
          "OTLP endpoint for logs, metrics, and traces from your services. Use our collector or point your existing one at OneUptime.",
        scaling: "Replicas",
      },
      {
        name: "Agents",
        description:
          "Infrastructure, Docker, Docker Swarm, Podman, Proxmox, Kubernetes, and Ceph agents report into the same ingest path.",
        scaling: "One per host or cluster",
      },
      {
        name: "Migration job",
        description:
          "Schema and data migrations run once per release in a dedicated Job rather than on every pod.",
        scaling: "Runs per upgrade",
      },
    ],
  },
];

export const SizingTiers: Array<SizingTier> = [
  {
    key: "evaluation",
    name: "Evaluation",
    workload: "Proof of concept, a handful of monitors, no HA",
    nodes: "1 node",
    cpu: "4 vCPU",
    memory: "16 GB",
    storage: "100 GB",
    notes:
      "Docker Compose on a single VM, or a single-node cluster with the bundled standalone databases.",
  },
  {
    key: "production",
    name: "Production",
    workload: "A few hundred monitors, moderate telemetry ingest",
    nodes: "3+ nodes",
    cpu: "16 vCPU total",
    memory: "64 GB total",
    storage: "500 GB+ on a replicated storage class",
    notes:
      "Kubernetes with the dedicated worker tier, database operators, and Pod Disruption Budgets enabled.",
  },
  {
    key: "scale",
    name: "Scale",
    workload: "Thousands of monitors, high-volume telemetry ingest",
    nodes: "6+ nodes, dedicated database nodes",
    cpu: "48 vCPU+ total",
    memory: "192 GB+ total",
    storage: "Multi-TB, sized to your retention policy",
    notes:
      "Sharded ClickHouse, the telemetry-writer tier, PgBouncer, and KEDA autoscaling on the worker fleet.",
  },
];

export const InfrastructureRequirements: Array<RequirementGroup> = [
  {
    title: "Kubernetes",
    items: [
      "Any conformant Kubernetes cluster — EKS, AKS, GKE, OpenShift, Rancher, k3s, or bare metal",
      "Helm 3 and kubectl configured against the cluster",
      "A storage class that supports dynamic provisioning of ReadWriteOnce volumes",
      "A hostname you control, pointed at the ingress gateway service",
    ],
  },
  {
    title: "Networking",
    items: [
      "A LoadBalancer service, MetalLB address pool, or your own ingress in front of the gateway",
      "TLS certificates — bring your own, or let the bundled cert-manager issuer handle Let's Encrypt",
      "Outbound access from probes to whatever you want them to monitor",
      "Optional HTTP/HTTPS proxy settings per probe for egress-restricted networks",
    ],
  },
  {
    title: "Data stores",
    items: [
      "PostgreSQL, ClickHouse, and Redis — bundled with the chart, or point at your own",
      "Database operators (CloudNativePG, Altinity) for replicated production databases",
      "Persistent volume backups — configured with your storage provider or CloudNativePG scheduled backups",
      "Retention policy sized against your telemetry volume; storage is the dominant cost at scale",
    ],
  },
  {
    title: "Optional add-ons",
    items: [
      "KEDA, if you want queue-depth autoscaling on the worker tier",
      "cert-manager, for automatic certificate issuance and custom status-page domains",
      "An in-cluster vLLM deployment, if you want AI features without calling an external model provider",
      "Your own SMTP relay and SMS provider for notifications",
    ],
  },
];

export const AvailabilityControls: Array<ResilienceControl> = [
  {
    title: "Replicated PostgreSQL",
    description:
      "The bundled CloudNativePG operator runs PostgreSQL with streaming replication and automatic failover instead of a single standalone instance.",
    setting: "postgresOperator.cnpg.enabled",
  },
  {
    title: "Replicated and sharded ClickHouse",
    description:
      "The bundled Altinity operator handles replication, sharding, and declarative lifecycle management for the telemetry store.",
    setting: "clickhouseOperator.altinity.enabled",
  },
  {
    title: "Pod Disruption Budgets",
    description:
      "Stops a node drain or cluster upgrade from evicting every replica of a service at once. Pair it with more than one replica per stateless tier.",
    setting: "podDisruptionBudget.enabled",
  },
  {
    title: "Autoscaling",
    description:
      "HPA on CPU and memory for the stateless tiers, and KEDA on queue depth for the worker fleet, so ingest spikes do not become incidents.",
    setting: "autoscaling.enabled / worker.keda",
  },
  {
    title: "Connection pooling",
    description:
      "PgBouncer in transaction mode keeps an autoscaling worker fleet or a connection-limited managed PostgreSQL from running out of connections.",
    setting: "pgbouncer.enabled",
  },
  {
    title: "Scheduled database backups",
    description:
      "CloudNativePG scheduled backups cover PostgreSQL. Volume snapshots and object-storage backups are configured with your infrastructure provider.",
    setting: "postgresOperator.cnpg.scheduledBackup",
  },
];

export const DisasterRecoveryPractices: Array<string> = [
  "Pin the OneUptime image tag and the PostgreSQL, Redis, and ClickHouse versions so a restore is reproducible.",
  "Back up persistent volumes on the cadence your RPO requires — the chart does not do this for you.",
  "Test restores on a schedule. A backup you have never restored is not a backup.",
  "Keep your values.yaml in version control; it is the other half of your recovery plan.",
  "Run probes from more than one failure domain so a regional outage does not blind your monitoring.",
  "Define your own RTO and RPO. On a self-hosted deployment they are properties of your infrastructure, not ours.",
];

export const AirGapSteps: Array<AirGapStep> = [
  {
    title: "Mirror the images",
    description:
      "Pull the OneUptime images into your internal registry and point the chart at it. Nothing needs to reach Docker Hub at runtime.",
    setting: "image.registry / image.repository",
  },
  {
    title: "Turn off the update check",
    description:
      "The platform's outbound version check is a single switch. Disabled, the install makes no calls to oneuptime.com.",
    setting: "updateCheck.disabled",
  },
  {
    title: "Keep DNS internal",
    description:
      "Probes ship with public fallback nameservers for external monitoring. On an air-gapped cluster, drop them so resolution stays inside your network.",
    setting: "probes.<key>.dnsConfig",
  },
  {
    title: "Bring your own notification transports",
    description:
      "Point notifications at your internal SMTP relay and SMS gateway instead of any hosted transport.",
    setting: "smtp / notifications",
  },
  {
    title: "Run AI locally, or not at all",
    description:
      "AI features can call an in-cluster vLLM deployment or a local Ollama endpoint, so no prompt leaves your network. They can also be left off entirely.",
    setting: "vllm.enabled",
  },
  {
    title: "Upgrade from an artifact bundle",
    description:
      "Upgrades are `helm upgrade` against a chart and image set you have already mirrored. No connectivity to us is required to apply one.",
    setting: "helm upgrade",
  },
];

export const HardenedImageFeatures: Array<string> = [
  "Enterprise Edition container images built with additional security controls, selected with `image.type: enterprise-edition`",
  "Non-root pod and container security contexts, with a RuntimeDefault seccomp profile applied across the chart",
  "Service-account token mounting disabled by default on probe pods, which need no Kubernetes API credentials",
  "Optional Chromium OS sandbox for synthetic monitors, with per-execution UID, memory, and disk ceilings",
  "Dependency scanning, static analysis, and secret scanning on every build of the images you run",
  "IP allow-listing, external secret references, and your own KMS-backed storage encryption underneath",
];

export const UpgradeResponsibilities: Array<ResponsibilityRow> = [
  {
    area: "Release cadence",
    oneuptime:
      "We ship releases frequently — often several times a day — and publish release notes and upgrade notes for each.",
    customer:
      "You choose when to apply them. We recommend at least monthly, and pinning a specific tag rather than tracking `release`.",
  },
  {
    area: "Breaking changes",
    oneuptime:
      "Documented in the upgrade notes before they ship, with the deprecation policy defining how long older versions are supported.",
    customer:
      "Read the upgrade notes before upgrading and test in a non-production environment first.",
  },
  {
    area: "Database migrations",
    oneuptime:
      "Shipped as a dedicated migration Job that runs once per release, designed to be backwards-compatible.",
    customer:
      "Take a database backup before upgrading and confirm the migration Job completed.",
  },
  {
    area: "Supported versions",
    oneuptime:
      "The latest three major versions are fully supported; older versions receive security fixes for an additional 12 months, per the deprecation policy.",
    customer:
      "Stay inside the supported window. Support cannot help with a version that has left it.",
  },
  {
    area: "Rollback",
    oneuptime:
      "Chart releases are versioned and every image tag stays available, so `helm rollback` works.",
    customer:
      "Keep the previous values.yaml and a restorable database backup — a schema migration is not always reversible by rollback alone.",
  },
];

export const SharedResponsibilities: Array<ResponsibilityRow> = [
  {
    area: "Platform code and security fixes",
    oneuptime:
      "We build, test, and publish the platform, and patch vulnerabilities in it.",
    customer: "You apply the release that contains the fix.",
  },
  {
    area: "Infrastructure",
    oneuptime:
      "We publish the chart, sizing guidance, and a production readiness checklist.",
    customer:
      "You own the cluster, nodes, storage, network, and their patch levels.",
  },
  {
    area: "Availability",
    oneuptime:
      "We ship the HA building blocks: database operators, PDBs, autoscaling, and a dedicated worker tier.",
    customer:
      "You configure them, size the cluster, and own the uptime of your own deployment.",
  },
  {
    area: "Data protection",
    oneuptime:
      "We encrypt data in transit and support encryption at rest on the stores you configure.",
    customer:
      "You own key management, backups, retention, and where the data physically sits.",
  },
  {
    area: "Access control",
    oneuptime: "We ship SSO/SAML, SCIM, RBAC, API-key scoping, and audit logs.",
    customer: "You configure your identity provider and review access.",
  },
  {
    area: "Compliance",
    oneuptime:
      "We provide our own certifications, evidence, and control documentation for the software and for OneUptime Cloud.",
    customer:
      "Certification of your self-hosted deployment covers your environment and is yours to obtain.",
  },
];

export const SupportBoundaries: Array<SupportTierRow> = [
  {
    key: "community",
    name: "Community Edition",
    description:
      "The full platform, Apache-2.0 licensed, supported by the community and the maintainers on GitHub.",
    included: [
      "GitHub issues and discussions",
      "Public documentation, Helm chart docs, and upgrade notes",
      "Every product feature — the community edition is not feature-limited",
      "Security fixes shipped in public releases",
    ],
    excluded: [
      "No response-time commitment",
      "No private support channel or named contact",
      "No architecture review or migration assistance",
      "No hardened Enterprise Edition images",
    ],
  },
  {
    key: "enterprise",
    name: "Enterprise Edition",
    description:
      "A commercial agreement on top of the same platform, for teams that need accountability alongside the source code.",
    included: [
      "Hardened Enterprise Edition container images",
      "A private support channel with agreed severity levels and response targets",
      "A named engineering contact and architecture reviews",
      "Migration and upgrade assistance, plus custom data residency and retention",
      "Roadmap input and prioritisation of features you depend on",
    ],
    excluded: [
      "We do not receive alerts from, or hold credentials to, your cluster unless you grant them",
      "Uptime of a self-hosted deployment is not covered by the OneUptime Cloud SLA",
      "Support scope, hours, and response targets are those written in your order form",
      "Third-party infrastructure — your cloud, storage, and network — remains your vendor's responsibility",
    ],
  },
];

export const SelfHostedFaqs: Array<SelfHostedFaq> = [
  {
    question: "Is the self-hosted edition feature-limited?",
    answer:
      "No. The Community Edition is the full platform under Apache 2.0 — monitoring, incidents, on-call, status pages, logs, metrics, traces, dashboards, and workflows. The Enterprise Edition adds hardened images and a commercial support agreement, not product features you would otherwise be missing.",
  },
  {
    question: "Does a self-hosted install phone home?",
    answer:
      "The only outbound call the platform makes on its own is a version check, and it is a single switch to disable. With it off and images mirrored into your registry, an install runs with no connectivity to us at all.",
  },
  {
    question: "Who is responsible for uptime when we self-host?",
    answer:
      "You are. The OneUptime Cloud SLA covers our hosted service, not infrastructure you operate. What we provide for self-hosted deployments is the HA building blocks, sizing guidance, a production readiness checklist, and — on an enterprise agreement — support with agreed response targets.",
  },
  {
    question:
      "Can we start self-hosted and move to cloud later, or the reverse?",
    answer:
      "Yes, in both directions. It is the same platform and the same schema, so a migration is a data move rather than a re-platform. Enterprise agreements can include migration assistance.",
  },
  {
    question: "What does an architecture assessment cover?",
    answer:
      "A working session with our engineers on your topology: deployment model, cluster and storage sizing against your telemetry volume, HA and DR posture, upgrade process, network and air-gap constraints, and where the responsibility boundaries sit. You leave with a reference architecture and a sizing sheet for your environment.",
  },
];

export interface SelfHostedContent {
  deploymentModels: Array<DeploymentModel>;
  architectureTiers: Array<ArchitectureTier>;
  sizingTiers: Array<SizingTier>;
  infrastructureRequirements: Array<RequirementGroup>;
  availabilityControls: Array<ResilienceControl>;
  disasterRecoveryPractices: Array<string>;
  airGapSteps: Array<AirGapStep>;
  hardenedImageFeatures: Array<string>;
  upgradeResponsibilities: Array<ResponsibilityRow>;
  sharedResponsibilities: Array<ResponsibilityRow>;
  supportBoundaries: Array<SupportTierRow>;
  faqs: Array<SelfHostedFaq>;
  helmDocs: HelmDocLinks;
}

export function getSelfHostedContent(): SelfHostedContent {
  return {
    deploymentModels: DeploymentModels,
    architectureTiers: ArchitectureTiers,
    sizingTiers: SizingTiers,
    infrastructureRequirements: InfrastructureRequirements,
    availabilityControls: AvailabilityControls,
    disasterRecoveryPractices: DisasterRecoveryPractices,
    airGapSteps: AirGapSteps,
    hardenedImageFeatures: HardenedImageFeatures,
    upgradeResponsibilities: UpgradeResponsibilities,
    sharedResponsibilities: SharedResponsibilities,
    supportBoundaries: SupportBoundaries,
    faqs: SelfHostedFaqs,
    helmDocs: HelmDocs,
  };
}

export default getSelfHostedContent;
