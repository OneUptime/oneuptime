import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { getKubernetesAgentUpgradeCommand } from "./DocumentationMarkdown";

/*
 * What a Kubernetes cluster's Control Plane and Service Mesh tabs say when
 * their charts come back empty: which kubernetes-agent Helm values collect
 * those metrics, the command that sets them, and where the docs explain it.
 *
 * The pages used to open on an always-on blue box with one sentence for all
 * their tabs, so every cluster that already sent the metrics read a setup
 * hint above working charts. It was also wrong in places: it said CoreDNS
 * metrics are available on every cluster (coreDns.enabled is off by
 * default), and it sent Cilium users to serviceMesh.provider, which only
 * accepts istio and linkerd. Each tab now explains itself, in place of its
 * charts, only once they have loaded and found nothing.
 *
 * React-free on purpose: App/Tests/Dashboard/KubernetesMetricsSetupAccuracy
 * holds every value named here to the agent chart's values.yaml and schema,
 * and every link to a heading in the docs.
 */

export enum KubernetesMetricsSource {
  Etcd = "etcd",
  ApiServer = "api-server",
  Scheduler = "scheduler",
  ControllerManager = "controller-manager",
  CoreDns = "coredns",
  KubeProxy = "kube-proxy",
  Cilium = "cilium",
  Istio = "istio",
  Linkerd = "linkerd",
}

export const KUBERNETES_AGENT_DOCS_ROUTE: string =
  "/docs/telemetry/kubernetes-agent";

export const KUBERNETES_CONTROL_PLANE_DOCS_ROUTE: string = `${KUBERNETES_AGENT_DOCS_ROUTE}#enable-control-plane-monitoring`;
export const KUBERNETES_COREDNS_DOCS_ROUTE: string = `${KUBERNETES_AGENT_DOCS_ROUTE}#enable-coredns-metrics`;
export const KUBERNETES_SERVICE_MESH_DOCS_ROUTE: string = `${KUBERNETES_AGENT_DOCS_ROUTE}#enable-service-mesh-metrics`;
export const KUBERNETES_NOT_COLLECTED_DOCS_ROUTE: string = `${KUBERNETES_AGENT_DOCS_ROUTE}#metrics-the-agent-does-not-collect`;

/*
 * Where the API server answers from inside any cluster. The agent's pod has
 * no host network, so the chart's default (localhost:6443) is the pod
 * itself; this address reaches the API server, with the service account
 * token and the /metrics grant the chart already gives the agent.
 */
export const IN_CLUSTER_API_SERVER_METRICS_URL: string =
  "https://kubernetes.default.svc:443/metrics";

// The resource attribute every Kubernetes chart on these pages filters on.
export const KUBERNETES_CLUSTER_NAME_ATTRIBUTE: string = "k8s.cluster.name";

/*
 * The placeholder a description uses for the cluster's own name, which the
 * page fills in.
 */
export const CLUSTER_NAME_PLACEHOLDER: string = "clusterName";

export interface KubernetesMetricsSetup {
  source: KubernetesMetricsSource;
  // The empty state's heading: what is missing.
  title: string;
  /*
   * What collects these metrics, or that the agent does not. A template
   * (the translation key) whose placeholders are drawn as code from `code`,
   * plus {{clusterName}}, which the page fills in.
   */
  description: string;
  // Placeholder -> the Helm value (or other code) it stands for.
  code: Record<string, string>;
  /*
   * The `--set` flags that turn collection on, for a `helm upgrade` of the
   * installed agent. Empty when no agent value collects these metrics.
   */
  helmFlags: Array<string>;
  // The docs section that explains it.
  docsRoute: string;
}

const CONTROL_PLANE_ENABLED: string = "controlPlane.enabled";
const CONTROL_PLANE_FLAG: string = "--set controlPlane.enabled=true";

const KUBERNETES_METRICS_SETUPS: Record<
  KubernetesMetricsSource,
  KubernetesMetricsSetup
> = {
  [KubernetesMetricsSource.Etcd]: {
    source: KubernetesMetricsSource.Etcd,
    title: translationKey("No etcd metrics from this cluster"),
    description: translationKey(
      "Turn on {{enabled}} and point {{endpoints}} at an etcd metrics address the agent's pod can reach. Managed clusters such as EKS, GKE and AKS don't expose etcd.",
    ),
    code: {
      enabled: CONTROL_PLANE_ENABLED,
      endpoints: "controlPlane.etcd.endpoints",
    },
    helmFlags: [CONTROL_PLANE_FLAG],
    docsRoute: KUBERNETES_CONTROL_PLANE_DOCS_ROUTE,
  },
  [KubernetesMetricsSource.ApiServer]: {
    source: KubernetesMetricsSource.ApiServer,
    title: translationKey("No API server metrics from this cluster"),
    description: translationKey(
      "Turn on {{enabled}} and point {{endpoints}} at the API server. The command below uses the address it answers on inside the cluster, {{address}}.",
    ),
    code: {
      enabled: CONTROL_PLANE_ENABLED,
      endpoints: "controlPlane.apiServer.endpoints",
      address: IN_CLUSTER_API_SERVER_METRICS_URL,
    },
    helmFlags: [
      CONTROL_PLANE_FLAG,
      `--set "controlPlane.apiServer.endpoints={${IN_CLUSTER_API_SERVER_METRICS_URL}}"`,
    ],
    docsRoute: KUBERNETES_CONTROL_PLANE_DOCS_ROUTE,
  },
  [KubernetesMetricsSource.Scheduler]: {
    source: KubernetesMetricsSource.Scheduler,
    title: translationKey("No scheduler metrics from this cluster"),
    description: translationKey(
      "Turn on {{enabled}} and point {{endpoints}} at a scheduler metrics address the agent's pod can reach. Managed clusters such as EKS, GKE and AKS don't expose the scheduler.",
    ),
    code: {
      enabled: CONTROL_PLANE_ENABLED,
      endpoints: "controlPlane.scheduler.endpoints",
    },
    helmFlags: [CONTROL_PLANE_FLAG],
    docsRoute: KUBERNETES_CONTROL_PLANE_DOCS_ROUTE,
  },
  [KubernetesMetricsSource.ControllerManager]: {
    source: KubernetesMetricsSource.ControllerManager,
    title: translationKey("No controller manager metrics from this cluster"),
    description: translationKey(
      "Turn on {{enabled}} and point {{endpoints}} at a controller manager metrics address the agent's pod can reach. Managed clusters such as EKS, GKE and AKS don't expose the controller manager.",
    ),
    code: {
      enabled: CONTROL_PLANE_ENABLED,
      endpoints: "controlPlane.controllerManager.endpoints",
    },
    helmFlags: [CONTROL_PLANE_FLAG],
    docsRoute: KUBERNETES_CONTROL_PLANE_DOCS_ROUTE,
  },
  [KubernetesMetricsSource.CoreDns]: {
    source: KubernetesMetricsSource.CoreDns,
    title: translationKey("No CoreDNS metrics from this cluster"),
    description: translationKey(
      "Turn on {{enabled}}. If your cluster's CoreDNS is not kube-dns in kube-system on port 9153, also set {{namespace}}, {{service}} and {{port}}.",
    ),
    code: {
      enabled: "coreDns.enabled",
      namespace: "coreDns.namespace",
      service: "coreDns.service",
      port: "coreDns.port",
    },
    helmFlags: ["--set coreDns.enabled=true"],
    docsRoute: KUBERNETES_COREDNS_DOCS_ROUTE,
  },
  [KubernetesMetricsSource.KubeProxy]: {
    source: KubernetesMetricsSource.KubeProxy,
    title: translationKey("No kube-proxy metrics from this cluster"),
    description: translationKey(
      "The kubernetes-agent doesn't collect kube-proxy metrics. They appear here when another collector sends them to OneUptime with {{attribute}} set to {{clusterName}}.",
    ),
    code: {
      attribute: KUBERNETES_CLUSTER_NAME_ATTRIBUTE,
    },
    helmFlags: [],
    docsRoute: KUBERNETES_NOT_COLLECTED_DOCS_ROUTE,
  },
  [KubernetesMetricsSource.Cilium]: {
    source: KubernetesMetricsSource.Cilium,
    title: translationKey("No Cilium metrics from this cluster"),
    description: translationKey(
      "The kubernetes-agent doesn't collect Cilium or Hubble metrics. They appear here when another collector sends them to OneUptime with {{attribute}} set to {{clusterName}}.",
    ),
    code: {
      attribute: KUBERNETES_CLUSTER_NAME_ATTRIBUTE,
    },
    helmFlags: [],
    docsRoute: KUBERNETES_NOT_COLLECTED_DOCS_ROUTE,
  },
  [KubernetesMetricsSource.Istio]: {
    source: KubernetesMetricsSource.Istio,
    title: translationKey("No Istio metrics from this cluster"),
    description: translationKey(
      "Turn on {{enabled}} and set {{provider}} to {{value}}. The agent then reads the metrics of every Istio sidecar.",
    ),
    code: {
      enabled: "serviceMesh.enabled",
      provider: "serviceMesh.provider",
      value: "istio",
    },
    helmFlags: [
      "--set serviceMesh.enabled=true",
      "--set serviceMesh.provider=istio",
    ],
    docsRoute: KUBERNETES_SERVICE_MESH_DOCS_ROUTE,
  },
  [KubernetesMetricsSource.Linkerd]: {
    source: KubernetesMetricsSource.Linkerd,
    title: translationKey("No Linkerd metrics from this cluster"),
    description: translationKey(
      "Turn on {{enabled}} and set {{provider}} to {{value}}. The agent then reads the metrics of every Linkerd proxy.",
    ),
    code: {
      enabled: "serviceMesh.enabled",
      provider: "serviceMesh.provider",
      value: "linkerd",
    },
    helmFlags: [
      "--set serviceMesh.enabled=true",
      "--set serviceMesh.provider=linkerd",
    ],
    docsRoute: KUBERNETES_SERVICE_MESH_DOCS_ROUTE,
  },
};

export function getKubernetesMetricsSetup(
  source: KubernetesMetricsSource,
): KubernetesMetricsSetup {
  return KUBERNETES_METRICS_SETUPS[source];
}

export function getAllKubernetesMetricsSetups(): Array<KubernetesMetricsSetup> {
  return Object.values(KubernetesMetricsSource).map(
    (source: KubernetesMetricsSource): KubernetesMetricsSetup => {
      return getKubernetesMetricsSetup(source);
    },
  );
}

/*
 * The `helm upgrade` of the installed agent that collects these metrics, or
 * null when no agent value does. --reuse-values keeps the install's URL, key,
 * cluster name and everything else.
 */
export function getKubernetesMetricsSetupCommand(
  source: KubernetesMetricsSource,
): string | null {
  const setup: KubernetesMetricsSetup = getKubernetesMetricsSetup(source);

  if (setup.helmFlags.length === 0) {
    return null;
  }

  return getKubernetesAgentUpgradeCommand(setup.helmFlags);
}
