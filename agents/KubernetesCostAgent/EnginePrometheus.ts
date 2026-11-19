import { URL } from "url";
import { DEFAULT_PROMETHEUS_CADVISOR_JOB } from "./Config";
import { EngineKind } from "./EngineDiscovery";
import {
  GetConfigMap,
  KubernetesConfigMap,
  KubernetesEnvFromSource,
  KubernetesEnvVar,
  KubernetesPod,
  KubernetesService,
  ListPods,
  ListServices,
} from "./KubernetesApi";
import Logger from "./Logger";
import { queryPrometheus, PrometheusQuery } from "./PrometheusQuery";

/*
 * THE PROMETHEUS THE COST ENGINE READS (#9777).
 *
 * Right-sizing needs each container's memory PEAK in a window, which no
 * engine's Allocation API gives (PrometheusClient). The chart's bundled
 * Prometheus has it. A cluster priced by its own Kubecost or OpenCost has the
 * Prometheus that engine reads, and the agent finds it the way it finds the
 * engine (#9633): at run time, through the Kubernetes API, as its
 * ServiceAccount. The chart cannot: it reads no cluster objects while it
 * renders (under helm template, Argo CD or a dry run there are none).
 *
 *   - OpenCost reads Prometheus at its PROMETHEUS_SERVER_ENDPOINT, which its
 *     chart sets on its container (opencost.prometheus.internal or
 *     .external).
 *   - Kubecost 2's cost model reads the same variable, from its own
 *     ConfigMap (prometheus-server-endpoint): the Prometheus it bundles,
 *     <release>-prometheus-server, or the one global.prometheus.fqdn names.
 *   - Kubecost 3 reads no Prometheus: its finops agent collects what it
 *     needs itself. There is nothing to find, and the agent says so.
 *
 * The engine's pods are the ones its Service selects, and their containers'
 * environment names the address, as a value or from a ConfigMap (pods and
 * ConfigMaps are read-only grants the chart's ClusterRole already has). One
 * from a Secret is not read, since the agent reads no Secret: it is named as
 * the reason instead. For a Kubecost whose pods name none, its chart's own
 * Prometheus Service beside it is tried (app=prometheus, component=server).
 *
 * An address is used only once it answers a query for cAdvisor's memory
 * series, the series the peaks are read from. The query also says which
 * scrape job carries them: kubernetes-nodes-cadvisor in Kubecost's and the
 * community chart's Prometheus, kubelet in kube-prometheus-stack's, unless
 * cost.engine.prometheusCadvisorJob names one. And a Prometheus that holds
 * several clusters' series is read for this cluster's alone, by the cluster
 * label and ID the engine itself filters by, or not at all: peaks from
 * another cluster's containers would size this one's.
 */

// The variable OpenCost's and Kubecost 2's cost model read Prometheus at.
export const ENGINE_PROMETHEUS_VARIABLE: string = "PROMETHEUS_SERVER_ENDPOINT";

// The engine's name for this cluster, and the label it finds it under.
const CLUSTER_ID_VARIABLE: string = "CLUSTER_ID";
const CLUSTER_LABEL_VARIABLE: string = "PROM_CLUSTER_ID_LABEL";

// The label OpenCost and Kubecost put a cluster's name in (their default).
export const DEFAULT_CLUSTER_LABEL: string = "cluster_id";

// The Prometheus Service of the community chart Kubecost 2 bundles.
export const KUBECOST_PROMETHEUS_SELECTORS: ReadonlyArray<string> = [
  "app=prometheus,component=server",
  "app.kubernetes.io/name=prometheus,app.kubernetes.io/component=server",
];

// A Prometheus label's name.
const LABEL_NAME_PATTERN: RegExp = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// How often a Prometheus that was not found is looked for again.
export const PROMETHEUS_RETRY_MS: number = 10 * 60 * 1000;

// How often one that was found is checked again.
export const PROMETHEUS_REFRESH_MS: number = 60 * 60 * 1000;

// Where the Prometheus the peaks are read from came from.
export type CostPrometheusOrigin = "configured" | "bundled" | "engine";

/*
 * The engine the agent reads, as finding its Prometheus needs it. "bundled"
 * is the chart's own OpenCost, "discovered" the cluster's own engine the
 * agent found, "configured" the one cost.engine.url names.
 */
export interface PrometheusEngine {
  url: string;
  origin: "bundled" | "discovered" | "configured";
  kind: EngineKind | null;
  // The in-cluster Service it was found as or is named by.
  service: { name: string; namespace: string } | null;
}

// A Prometheus's cAdvisor series of this cluster alone.
export interface ClusterFilter {
  label: string;
  value: string;
}

// The Prometheus the peaks are read from, and how to read them there.
export interface CostPrometheus {
  url: string;
  origin: CostPrometheusOrigin;
  // How it was found, for /healthz and the log.
  source: string;
  cadvisorJob: string;
  cluster: ClusterFilter | null;
  // Anything someone reading /healthz should know about it.
  note: string;
}

// An address the engine reads Prometheus at, and where it was read.
export interface PrometheusCandidate {
  url: string;
  source: string;
  // The label the engine finds this cluster's series under, and its value.
  clusterLabel: string;
  clusterId: string;
}

export interface FoundPrometheus {
  prometheus: CostPrometheus | null;
  // Why each place looked at did not give one.
  reasons: Array<string>;
}

export interface KubernetesReads {
  listServices: ListServices;
  listPods: ListPods;
  getConfigMap: GetConfigMap;
}

type Container = NonNullable<
  NonNullable<KubernetesPod["spec"]>["containers"]
>[number];

type VariableRead =
  | { status: "set"; value: string; from: string }
  | { status: "unreadable"; reason: string }
  | { status: "unset" };

const describeError: (err: unknown) => string = (err: unknown): string => {
  return err instanceof Error ? err.message : String(err);
};

/*
 * An address as the agent can query it: http(s), no credentials (the agent
 * would not send them, and never repeats them), no query string or fragment,
 * no trailing slash. The reason otherwise, which never repeats the address.
 */
export const normalizePrometheusUrl: (
  raw: string,
) => { url: string } | { reason: string } = (
  raw: string,
): { url: string } | { reason: string } => {
  const value: string = raw.trim();

  if (!value) {
    return { reason: "is empty" };
  }

  if (value.includes("$(")) {
    return {
      reason:
        "refers to other variables ($(...)), which the agent does not expand",
    };
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return { reason: "is not a URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { reason: "is not an http:// or https:// address" };
  }

  if (url.username || url.password) {
    return {
      reason:
        "carries credentials, which the agent does not send; set cost.engine.prometheusUrl to an address it can read",
    };
  }

  if (url.search || url.hash) {
    return { reason: "has a query string or a fragment" };
  }

  return { url: value.replace(/\/+$/, "") };
};

/*
 * The address as it was written, without anything secret in it (the
 * credentials before an @), for the log and /healthz.
 */
export const redactUrl: (raw: string) => string = (raw: string): string => {
  return raw
    .trim()
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/?#]*@/i, "$1")
    .replace(/\/+$/, "");
};

// A Service's selector as a label selector, in a stable order.
export const toLabelSelector: (
  selector: Record<string, string> | undefined,
) => string = (selector: Record<string, string> | undefined): string => {
  return Object.keys(selector || {})
    .sort()
    .map((key: string): string => {
      return `${key}=${selector![key]}`;
    })
    .join(",");
};

/*
 * What one container's environment sets a variable to, as Kubernetes would:
 * the last env entry of that name, else the last envFrom ConfigMap holding
 * it. A value from a Secret, the pod's own fields or another variable is not
 * read, and says why.
 */
export const readContainerVariable: (data: {
  namespace: string;
  container: Container;
  name: string;
  getConfigMap: GetConfigMap;
}) => Promise<VariableRead> = async (data: {
  namespace: string;
  container: Container;
  name: string;
  getConfigMap: GetConfigMap;
}): Promise<VariableRead> => {
  const readConfigMap: (
    name: string,
  ) => Promise<KubernetesConfigMap | null | Error> = async (
    name: string,
  ): Promise<KubernetesConfigMap | null | Error> => {
    try {
      return await data.getConfigMap(data.namespace, name);
    } catch (err: unknown) {
      return err instanceof Error ? err : new Error(String(err));
    }
  };

  const entries: Array<KubernetesEnvVar> = (
    Array.isArray(data.container.env) ? data.container.env : []
  ).filter((entry: KubernetesEnvVar): boolean => {
    return entry?.name === data.name;
  });

  const entry: KubernetesEnvVar | undefined = entries[entries.length - 1];

  if (entry) {
    if (typeof entry.value === "string") {
      return entry.value.trim()
        ? {
            status: "set",
            value: entry.value.trim(),
            from: `${data.name} of container ${data.container.name || ""}`,
          }
        : { status: "unset" };
    }

    const configMapKey: { name?: string; key?: string } | undefined =
      entry.valueFrom?.configMapKeyRef;

    if (configMapKey?.name && configMapKey.key) {
      const configMap: KubernetesConfigMap | null | Error = await readConfigMap(
        configMapKey.name,
      );

      if (configMap instanceof Error) {
        return {
          status: "unreadable",
          reason: `${data.name} comes from ConfigMap ${data.namespace}/${configMapKey.name}, which could not be read: ${configMap.message}`,
        };
      }

      const value: unknown = configMap?.data?.[configMapKey.key];

      if (typeof value !== "string" || !value.trim()) {
        return {
          status: "unreadable",
          reason: `${data.name} comes from ConfigMap ${data.namespace}/${configMapKey.name}, which has no ${configMapKey.key}`,
        };
      }

      return {
        status: "set",
        value: value.trim(),
        from: `${data.name} of container ${data.container.name || ""}, from ConfigMap ${data.namespace}/${configMapKey.name}`,
      };
    }

    if (entry.valueFrom?.secretKeyRef) {
      return {
        status: "unreadable",
        reason: `${data.name} comes from Secret ${data.namespace}/${entry.valueFrom.secretKeyRef.name || ""}, which the agent does not read`,
      };
    }

    return {
      status: "unreadable",
      reason: `${data.name} comes from the pod's own fields, which the agent does not read`,
    };
  }

  const sources: Array<KubernetesEnvFromSource> = Array.isArray(
    data.container.envFrom,
  )
    ? data.container.envFrom
    : [];

  let found: VariableRead = { status: "unset" };
  const secrets: Array<string> = [];

  for (const source of sources) {
    const prefix: string = source?.prefix || "";

    if (!data.name.startsWith(prefix)) {
      continue;
    }

    const key: string = data.name.slice(prefix.length);

    if (source.secretRef?.name) {
      secrets.push(`${data.namespace}/${source.secretRef.name}`);
      continue;
    }

    if (!source.configMapRef?.name) {
      continue;
    }

    const configMap: KubernetesConfigMap | null | Error = await readConfigMap(
      source.configMapRef.name,
    );

    if (configMap instanceof Error) {
      found = {
        status: "unreadable",
        reason: `the variables of container ${data.container.name || ""} come from ConfigMap ${data.namespace}/${source.configMapRef.name}, which could not be read: ${configMap.message}`,
      };
      continue;
    }

    const value: unknown = configMap?.data?.[key];

    if (typeof value === "string" && value.trim()) {
      found = {
        status: "set",
        value: value.trim(),
        from: `${data.name} of container ${data.container.name || ""}, from ConfigMap ${data.namespace}/${source.configMapRef.name}`,
      };
    }
  }

  if (found.status === "unset" && secrets.length > 0) {
    return {
      status: "unreadable",
      reason: `the variables of container ${data.container.name || ""} may come from Secret ${secrets.join(", ")}, which the agent does not read`,
    };
  }

  return found;
};

// Running pods first, then by name: the pods an engine serves from.
const podOrder: (a: KubernetesPod, b: KubernetesPod) => number = (
  a: KubernetesPod,
  b: KubernetesPod,
): number => {
  const running: (pod: KubernetesPod) => number = (
    pod: KubernetesPod,
  ): number => {
    return pod.status?.phase === "Running" ? 0 : 1;
  };
  const left: string = a.metadata?.name || "";
  const right: string = b.metadata?.name || "";

  return running(a) - running(b) || (left < right ? -1 : left > right ? 1 : 0);
};

/*
 * The addresses the engine's pods read Prometheus at, best first, each once,
 * and why none was found where none was.
 */
export const enginePrometheusCandidates: (data: {
  engine: PrometheusEngine;
  kubernetes: KubernetesReads;
}) => Promise<{
  candidates: Array<PrometheusCandidate>;
  reasons: Array<string>;
}> = async (data: {
  engine: PrometheusEngine;
  kubernetes: KubernetesReads;
}): Promise<{
  candidates: Array<PrometheusCandidate>;
  reasons: Array<string>;
}> => {
  const candidates: Array<PrometheusCandidate> = [];
  const reasons: Array<string> = [];
  const service: { name: string; namespace: string } | null =
    data.engine.service;

  if (!service) {
    return {
      candidates,
      reasons: [
        `${redactUrl(data.engine.url)} names no Service in this cluster, so there are no pods to read the engine's Prometheus from`,
      ],
    };
  }

  const name: string = `${service.namespace}/${service.name}`;
  let services: Array<KubernetesService>;

  try {
    services = await data.kubernetes.listServices({
      fieldSelector: `metadata.name=${service.name},metadata.namespace=${service.namespace}`,
    });
  } catch (err: unknown) {
    return {
      candidates,
      reasons: [`could not read Service ${name}: ${describeError(err)}`],
    };
  }

  const found: KubernetesService | undefined = services.find(
    (candidate: KubernetesService): boolean => {
      return (
        candidate.metadata?.name === service.name &&
        candidate.metadata?.namespace === service.namespace
      );
    },
  );

  if (!found) {
    return { candidates, reasons: [`there is no Service ${name}`] };
  }

  const selector: string = toLabelSelector(found.spec?.selector);

  if (!selector) {
    return {
      candidates,
      reasons: [`Service ${name} selects no pods, so it names no Prometheus`],
    };
  }

  let pods: Array<KubernetesPod>;

  try {
    pods = await data.kubernetes.listPods({
      namespace: service.namespace,
      labelSelector: selector,
    });
  } catch (err: unknown) {
    return {
      candidates,
      reasons: [`could not read the pods of ${name}: ${describeError(err)}`],
    };
  }

  if (pods.length === 0) {
    return { candidates, reasons: [`Service ${name} has no pods`] };
  }

  const seen: Set<string> = new Set<string>();

  for (const pod of [...pods].sort(podOrder)) {
    const containers: Array<Container> = Array.isArray(pod.spec?.containers)
      ? pod.spec!.containers!
      : [];
    const podName: string = `${service.namespace}/${pod.metadata?.name || ""}`;

    for (const container of containers) {
      const read: (variable: string) => Promise<VariableRead> = (
        variable: string,
      ): Promise<VariableRead> => {
        return readContainerVariable({
          namespace: service.namespace,
          container,
          name: variable,
          getConfigMap: data.kubernetes.getConfigMap,
        });
      };

      const endpoint: VariableRead = await read(ENGINE_PROMETHEUS_VARIABLE);

      if (endpoint.status === "unreadable") {
        reasons.push(`pod ${podName}: ${endpoint.reason}`);
        continue;
      }

      if (endpoint.status !== "set") {
        continue;
      }

      const normalized: { url: string } | { reason: string } =
        normalizePrometheusUrl(endpoint.value);

      if ("reason" in normalized) {
        reasons.push(
          `pod ${podName}: ${ENGINE_PROMETHEUS_VARIABLE} ${normalized.reason}`,
        );
        continue;
      }

      if (seen.has(normalized.url)) {
        continue;
      }

      seen.add(normalized.url);

      const clusterId: VariableRead = await read(CLUSTER_ID_VARIABLE);
      const clusterLabel: VariableRead = await read(CLUSTER_LABEL_VARIABLE);

      candidates.push({
        url: normalized.url,
        source: `${endpoint.from} of pod ${podName}`,
        clusterLabel:
          clusterLabel.status === "set" &&
          LABEL_NAME_PATTERN.test(clusterLabel.value)
            ? clusterLabel.value
            : DEFAULT_CLUSTER_LABEL,
        clusterId: clusterId.status === "set" ? clusterId.value : "",
      });
    }
  }

  if (candidates.length === 0 && reasons.length === 0) {
    reasons.push(
      `the pods of ${name} set no ${ENGINE_PROMETHEUS_VARIABLE}${
        data.engine.kind === "Kubecost"
          ? " (Kubecost 3 reads no Prometheus)"
          : ""
      }`,
    );
  }

  return { candidates, reasons };
};

/*
 * A Kubecost's own Prometheus Service beside it: the community chart's
 * server, as Kubecost 2 bundles it. One of the same release first, when
 * several are there.
 */
export const kubecostPrometheusServices: (data: {
  engine: PrometheusEngine;
  listServices: ListServices;
}) => Promise<{
  candidates: Array<PrometheusCandidate>;
  reasons: Array<string>;
}> = async (data: {
  engine: PrometheusEngine;
  listServices: ListServices;
}): Promise<{
  candidates: Array<PrometheusCandidate>;
  reasons: Array<string>;
}> => {
  const namespace: string | undefined = data.engine.service?.namespace;

  if (!namespace || data.engine.kind !== "Kubecost") {
    return { candidates: [], reasons: [] };
  }

  const byName: Map<string, KubernetesService> = new Map<
    string,
    KubernetesService
  >();

  try {
    for (const labelSelector of KUBECOST_PROMETHEUS_SELECTORS) {
      for (const service of await data.listServices({
        labelSelector,
        fieldSelector: `metadata.namespace=${namespace}`,
      })) {
        const name: string = (service.metadata?.name || "").trim();
        if (name && service.metadata?.namespace === namespace) {
          byName.set(name, service);
        }
      }
    }
  } catch (err: unknown) {
    return {
      candidates: [],
      reasons: [
        `could not look for Kubecost's Prometheus in namespace ${namespace}: ${describeError(err)}`,
      ],
    };
  }

  if (byName.size === 0) {
    return {
      candidates: [],
      reasons: [`no Kubecost Prometheus Service in namespace ${namespace}`],
    };
  }

  const candidates: Array<PrometheusCandidate> = [];

  for (const name of Array.from(byName.keys()).sort()) {
    const service: KubernetesService = byName.get(name)!;
    const ports: Array<{ name?: string; port?: number }> = (
      Array.isArray(service.spec?.ports) ? service.spec!.ports! : []
    ).filter((port: { name?: string; port?: number }): boolean => {
      return (
        typeof port.port === "number" &&
        Number.isInteger(port.port) &&
        port.port > 0 &&
        port.port < 65536
      );
    });
    const port: { name?: string; port?: number } | undefined =
      ports.find((candidate: { name?: string; port?: number }): boolean => {
        return (candidate.name || "").toLowerCase() === "http";
      }) || ports[0];

    if (port) {
      candidates.push({
        url: `http://${name}.${namespace}.svc:${port.port}`,
        source: `Kubecost's Prometheus Service ${namespace}/${name}`,
        clusterLabel: DEFAULT_CLUSTER_LABEL,
        clusterId: "",
      });
    }
  }

  return { candidates, reasons: [] };
};

// One group of the check's answer: a job, a cluster, how many containers.
export interface CadvisorSeriesCount {
  job: string;
  cluster: string;
  containers: number;
}

// Escapes a value for a PromQL string literal.
export const promqlString: (value: string) => string = (
  value: string,
): string => {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")}"`;
};

// The check's query: cAdvisor's memory series, counted by job and cluster.
export const cadvisorSeriesQuery: (clusterLabel: string) => string = (
  clusterLabel: string,
): string => {
  return `count by (job, ${clusterLabel}) (container_memory_working_set_bytes{container!="",container!="POD"})`;
};

/*
 * Which of a Prometheus's cAdvisor memory series the peaks are read from:
 * the job cost.engine.prometheusCadvisorJob names, else
 * kubernetes-nodes-cadvisor, else the job with the most; and in a Prometheus
 * that holds several clusters, this cluster's alone. Pure, so every case is
 * tested without a Prometheus.
 */
export const chooseCadvisorSeries: (data: {
  counts: Array<CadvisorSeriesCount>;
  configuredJob: string | null;
  clusterLabel: string;
  clusterId: string;
}) =>
  | { ok: true; job: string; cluster: ClusterFilter | null; containers: number }
  | { ok: false; reason: string } = (data: {
  counts: Array<CadvisorSeriesCount>;
  configuredJob: string | null;
  clusterLabel: string;
  clusterId: string;
}):
  | { ok: true; job: string; cluster: ClusterFilter | null; containers: number }
  | { ok: false; reason: string } => {
  const byJob: Map<string, Map<string, number>> = new Map<
    string,
    Map<string, number>
  >();

  for (const count of data.counts) {
    if (!Number.isFinite(count.containers) || count.containers <= 0) {
      continue;
    }

    const clusters: Map<string, number> =
      byJob.get(count.job) || new Map<string, number>();
    clusters.set(
      count.cluster,
      (clusters.get(count.cluster) || 0) + count.containers,
    );
    byJob.set(count.job, clusters);
  }

  const total: (clusters: Map<string, number>) => number = (
    clusters: Map<string, number>,
  ): number => {
    return Array.from(clusters.values()).reduce(
      (sum: number, value: number): number => {
        return sum + value;
      },
      0,
    );
  };

  if (byJob.size === 0) {
    return {
      ok: false,
      reason:
        "has no cAdvisor memory series (container_memory_working_set_bytes) to read peaks from",
    };
  }

  const jobs: Array<string> = Array.from(byJob.keys()).sort();
  let job: string;

  if (data.configuredJob) {
    if (!byJob.has(data.configuredJob)) {
      return {
        ok: false,
        reason: `has no cAdvisor memory series under job ${data.configuredJob} (cost.engine.prometheusCadvisorJob), only under ${jobs
          .map((name: string): string => {
            return name || "no job";
          })
          .join(", ")}`,
      };
    }
    job = data.configuredJob;
  } else if (byJob.has(DEFAULT_PROMETHEUS_CADVISOR_JOB)) {
    job = DEFAULT_PROMETHEUS_CADVISOR_JOB;
  } else {
    job = jobs.reduce((best: string, name: string): string => {
      return total(byJob.get(name)!) > total(byJob.get(best)!) ? name : best;
    }, jobs[0]!);
  }

  const clusters: Map<string, number> = byJob.get(job)!;
  const named: Array<string> = Array.from(clusters.keys())
    .filter((cluster: string): boolean => {
      return cluster !== "";
    })
    .sort();

  if (named.length <= 1) {
    return { ok: true, job, cluster: null, containers: total(clusters) };
  }

  if (data.clusterId && clusters.has(data.clusterId)) {
    return {
      ok: true,
      job,
      cluster: { label: data.clusterLabel, value: data.clusterId },
      containers: clusters.get(data.clusterId)!,
    };
  }

  const shown: Array<string> = named.slice(0, 5);

  return {
    ok: false,
    reason: `holds the cAdvisor series of ${named.length} clusters (${data.clusterLabel}: ${shown.join(", ")}${
      named.length > shown.length ? ", ..." : ""
    }), and ${
      data.clusterId
        ? `none of them is this one (${data.clusterId})`
        : "the engine does not say which is this one"
    }, so its peaks would mix clusters`,
  };
};

/*
 * Whether a Prometheus answers for this cluster's cAdvisor memory series,
 * and which of them the peaks are read from.
 */
export const checkPrometheus: (data: {
  candidate: PrometheusCandidate;
  configuredJob: string | null;
  query: PrometheusQuery;
}) => Promise<
  | { ok: true; job: string; cluster: ClusterFilter | null; containers: number }
  | { ok: false; reason: string }
> = async (data: {
  candidate: PrometheusCandidate;
  configuredJob: string | null;
  query: PrometheusQuery;
}): Promise<
  | { ok: true; job: string; cluster: ClusterFilter | null; containers: number }
  | { ok: false; reason: string }
> => {
  const label: string = LABEL_NAME_PATTERN.test(data.candidate.clusterLabel)
    ? data.candidate.clusterLabel
    : DEFAULT_CLUSTER_LABEL;

  let counts: Array<CadvisorSeriesCount>;

  try {
    const samples: Array<{
      metric: Record<string, string>;
      value: number;
    }> = await data.query(data.candidate.url, cadvisorSeriesQuery(label));

    counts = samples.map(
      (sample: {
        metric: Record<string, string>;
        value: number;
      }): CadvisorSeriesCount => {
        return {
          job: sample.metric["job"] || "",
          cluster: sample.metric[label] || "",
          containers: sample.value,
        };
      },
    );
  } catch (err: unknown) {
    return { ok: false, reason: describeError(err) };
  }

  return chooseCadvisorSeries({
    counts,
    configuredJob: data.configuredJob,
    clusterLabel: label,
    clusterId: data.candidate.clusterId,
  });
};

/*
 * The engine's own Prometheus: the first address its pods read (or, for a
 * Kubecost, its Prometheus Service) that answers with this cluster's
 * cAdvisor memory series. Null with every reason when none does.
 */
export const findEnginePrometheus: (data: {
  engine: PrometheusEngine;
  kubernetes: KubernetesReads;
  configuredJob: string | null;
  query: PrometheusQuery;
}) => Promise<FoundPrometheus> = async (data: {
  engine: PrometheusEngine;
  kubernetes: KubernetesReads;
  configuredJob: string | null;
  query: PrometheusQuery;
}): Promise<FoundPrometheus> => {
  const reasons: Array<string> = [];
  const tried: Set<string> = new Set<string>();

  const firstThatAnswers: (
    candidates: Array<PrometheusCandidate>,
  ) => Promise<CostPrometheus | null> = async (
    candidates: Array<PrometheusCandidate>,
  ): Promise<CostPrometheus | null> => {
    for (const candidate of candidates) {
      if (tried.has(candidate.url)) {
        continue;
      }
      tried.add(candidate.url);

      const checked:
        | {
            ok: true;
            job: string;
            cluster: ClusterFilter | null;
            containers: number;
          }
        | { ok: false; reason: string } = await checkPrometheus({
        candidate,
        configuredJob: data.configuredJob,
        query: data.query,
      });

      if (checked.ok) {
        return {
          url: candidate.url,
          origin: "engine",
          source: candidate.source,
          cadvisorJob: checked.job,
          cluster: checked.cluster,
          note: "",
        };
      }

      reasons.push(
        `${redactUrl(candidate.url)} (${candidate.source}) ${checked.reason}`,
      );
    }

    return null;
  };

  const named: {
    candidates: Array<PrometheusCandidate>;
    reasons: Array<string>;
  } = await enginePrometheusCandidates({
    engine: data.engine,
    kubernetes: data.kubernetes,
  });
  reasons.push(...named.reasons);

  const fromPods: CostPrometheus | null = await firstThatAnswers(
    named.candidates,
  );

  if (fromPods) {
    return { prometheus: fromPods, reasons: [] };
  }

  const beside: {
    candidates: Array<PrometheusCandidate>;
    reasons: Array<string>;
  } = await kubecostPrometheusServices({
    engine: data.engine,
    listServices: data.kubernetes.listServices,
  });

  /*
   * Only worth saying when nothing named one: "no Prometheus Service beside
   * it" adds nothing to an address that was named and did not answer.
   */
  if (named.candidates.length === 0) {
    reasons.push(...beside.reasons);
  }

  const fromService: CostPrometheus | null = await firstThatAnswers(
    beside.candidates,
  );

  if (fromService) {
    return { prometheus: fromService, reasons: [] };
  }

  return { prometheus: null, reasons };
};

// What the peaks query reads: the Prometheus in use, looked for again when due.
export interface CostPrometheusSource {
  current(): CostPrometheus | null;
  // Why there is none, once a look has failed.
  reason(): string;
  refreshIfDue(): Promise<void>;
}

/*
 * Which Prometheus the peaks are read from, looked for again when the engine
 * changes, hourly once found, and every ten minutes while it is not:
 *
 *   1. cost.engine.prometheusUrl, whatever the engine: someone named it. It
 *      is checked only to read its cAdvisor job, and used even when the
 *      check fails.
 *   2. For the chart's bundled engine, the chart's bundled Prometheus.
 *   3. For the cluster's own engine (found, or named in cost.engine.url),
 *      that engine's own Prometheus (findEnginePrometheus).
 *   4. Failing that, the bundled Prometheus when the chart runs one: it
 *      scrapes this cluster's cAdvisor too, whichever engine prices it.
 *   5. Otherwise none, with every reason: allocations ship without peaks,
 *      and /healthz and the log say why.
 *
 * One look at a time.
 */
export class CostPrometheusTarget implements CostPrometheusSource {
  private readonly configuredUrl: string;
  private readonly bundledUrl: string;
  private readonly configuredJob: string | null;
  private readonly engine: () => PrometheusEngine | null;
  private readonly kubernetes: KubernetesReads;
  private readonly query: PrometheusQuery;
  private readonly now: () => number;
  private readonly retryMs: number;
  private readonly refreshMs: number;

  // The engine the answer below is for.
  private engineKey: string | null = null;
  private found: CostPrometheus | null = null;
  private reasons: Array<string> = [];
  private settled: boolean = false;
  private lookedAtMs: number = 0;
  private inFlight: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  public constructor(options: {
    // COST_PROMETHEUS_URL, and whether it is the chart's bundled one.
    prometheusUrl: string;
    prometheusUrlIsBundled: boolean;
    configuredJob: string | null;
    engine: () => PrometheusEngine | null;
    kubernetes: KubernetesReads;
    query?: PrometheusQuery | undefined;
    now?: (() => number) | undefined;
    retryMs?: number | undefined;
    refreshMs?: number | undefined;
  }) {
    const normalized: { url: string } | { reason: string } =
      normalizePrometheusUrl(options.prometheusUrl);
    const url: string = "url" in normalized ? normalized.url : "";

    this.configuredUrl = options.prometheusUrlIsBundled ? "" : url;
    this.bundledUrl = options.prometheusUrlIsBundled ? url : "";
    this.configuredJob = options.configuredJob || null;
    this.engine = options.engine;
    this.kubernetes = options.kubernetes;
    this.query = options.query || queryPrometheus;
    this.now =
      options.now ||
      ((): number => {
        return Date.now();
      });
    this.retryMs = options.retryMs ?? PROMETHEUS_RETRY_MS;
    this.refreshMs = options.refreshMs ?? PROMETHEUS_REFRESH_MS;

    if (options.prometheusUrl.trim() && "reason" in normalized) {
      Logger.warn(
        "COST_PROMETHEUS_URL is not an address the agent can read; memory peaks come from elsewhere",
        { reason: normalized.reason },
      );
    }
  }

  // Looks now, then whenever a look is due, until stopped.
  public start(intervalMs: number = 60 * 1000): void {
    void this.refreshIfDue();
    this.timer = setInterval((): void => {
      void this.refreshIfDue();
    }, intervalMs);
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private keyOf(engine: PrometheusEngine | null): string {
    return engine
      ? `${engine.origin}|${engine.url}|${engine.kind || ""}`
      : "none";
  }

  // The Prometheus to read peaks from for the engine in use, when known.
  public current(): CostPrometheus | null {
    if (this.configuredUrl) {
      return (
        this.found || {
          url: this.configuredUrl,
          origin: "configured",
          source: "cost.engine.prometheusUrl",
          cadvisorJob: this.configuredJob || DEFAULT_PROMETHEUS_CADVISOR_JOB,
          cluster: null,
          note: "",
        }
      );
    }

    return this.keyOf(this.engine()) === this.engineKey ? this.found : null;
  }

  public reason(): string {
    return this.current() ? "" : this.reasons.join("; ");
  }

  public refreshIfDue(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight;
    }

    const engine: PrometheusEngine | null = this.engine();
    const key: string = this.keyOf(engine);
    const due: boolean =
      key !== this.engineKey ||
      this.now() - this.lookedAtMs >=
        (this.settled ? this.refreshMs : this.retryMs);

    if (!due) {
      return Promise.resolve();
    }

    this.inFlight = this.look(engine, key)
      .catch((err: unknown): void => {
        Logger.warn("could not look for the Prometheus to read peaks from", {
          error: describeError(err),
        });
      })
      .finally((): void => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  private bundled(note: string): CostPrometheus {
    return {
      url: this.bundledUrl,
      origin: "bundled",
      source: "the chart's bundled Prometheus",
      cadvisorJob: this.configuredJob || DEFAULT_PROMETHEUS_CADVISOR_JOB,
      cluster: null,
      note,
    };
  }

  private async look(
    engine: PrometheusEngine | null,
    key: string,
  ): Promise<void> {
    this.lookedAtMs = this.now();

    let found: CostPrometheus | null = null;
    let reasons: Array<string> = [];
    let settled: boolean = true;

    if (this.configuredUrl) {
      // Checked only to read its cAdvisor job; used either way.
      const checked:
        | {
            ok: true;
            job: string;
            cluster: ClusterFilter | null;
            containers: number;
          }
        | { ok: false; reason: string } = await checkPrometheus({
        candidate: {
          url: this.configuredUrl,
          source: "cost.engine.prometheusUrl",
          clusterLabel: DEFAULT_CLUSTER_LABEL,
          clusterId: "",
        },
        configuredJob: this.configuredJob,
        query: this.query,
      });

      found = {
        url: this.configuredUrl,
        origin: "configured",
        source: "cost.engine.prometheusUrl",
        cadvisorJob: checked.ok
          ? checked.job
          : this.configuredJob || DEFAULT_PROMETHEUS_CADVISOR_JOB,
        cluster: checked.ok ? checked.cluster : null,
        note: checked.ok ? "" : `it ${checked.reason}`,
      };
      settled = checked.ok;
    } else if (!engine) {
      reasons = ["no cost engine is in use yet"];
      settled = false;
    } else if (engine.origin === "bundled") {
      if (this.bundledUrl) {
        found = this.bundled("");
      } else {
        reasons = ["the chart bundled no Prometheus beside its engine"];
      }
    } else {
      const own: FoundPrometheus = await findEnginePrometheus({
        engine,
        kubernetes: this.kubernetes,
        configuredJob: this.configuredJob,
        query: this.query,
      });

      if (own.prometheus) {
        found = own.prometheus;
      } else if (
        key === this.engineKey &&
        this.found &&
        this.found.origin === "engine"
      ) {
        /*
         * The same engine's Prometheus, found before, did not answer this
         * time: keep it, as a Prometheus that restarts is back in a minute,
         * and look again soon. A peak query that fails meanwhile ships the
         * window without peaks, as it always has.
         */
        found = {
          ...this.found,
          note: `its last check failed (${own.reasons.join("; ")})`,
        };
        settled = false;
      } else if (this.bundledUrl) {
        found = this.bundled(
          `the engine's own Prometheus was not found (${own.reasons.join("; ")})`,
        );
        settled = false;
      } else {
        reasons = own.reasons;
        settled = false;
      }
    }

    this.report(engine, key, found, reasons);

    this.engineKey = key;
    this.found = found;
    this.reasons = reasons;
    this.settled = settled;
  }

  // Says what changed, once: not every ten minutes while nothing does.
  private report(
    engine: PrometheusEngine | null,
    key: string,
    found: CostPrometheus | null,
    reasons: Array<string>,
  ): void {
    const before: string = JSON.stringify({
      key: this.engineKey,
      url: this.found?.url || "",
      job: this.found?.cadvisorJob || "",
      cluster: this.found?.cluster || null,
      note: this.found?.note || "",
      reasons: this.reasons,
    });
    const after: string = JSON.stringify({
      key,
      url: found?.url || "",
      job: found?.cadvisorJob || "",
      cluster: found?.cluster || null,
      note: found?.note || "",
      reasons,
    });

    if (before === after) {
      return;
    }

    if (found) {
      Logger.info("reading memory peaks from this Prometheus", {
        costPrometheusUrl: redactUrl(found.url),
        origin: found.origin,
        source: found.source,
        cadvisorJob: found.cadvisorJob,
        ...(found.cluster ? { cluster: found.cluster } : {}),
        ...(found.note ? { note: found.note } : {}),
      });
      return;
    }

    if (engine) {
      Logger.warn(
        "found no Prometheus to read memory peaks from, so memory recommendations are unavailable. Set cost.engine.prometheusUrl to name one.",
        {
          costEngineUrl: redactUrl(engine.url),
          reasons,
        },
      );
    }
  }
}
