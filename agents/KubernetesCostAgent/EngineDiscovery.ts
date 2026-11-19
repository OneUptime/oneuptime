import { URL } from "url";
import { KubernetesService, ListServices, ServiceQuery } from "./KubernetesApi";

/*
 * FINDING THE COST ENGINE A CLUSTER ALREADY RUNS (#9633).
 *
 * Since cost monitoring is on by default, a cluster that already runs
 * Kubecost or OpenCost would be priced by a second engine the chart
 * bundled. The chart cannot see the cluster while it renders: Helm's
 * `lookup` comes back empty under `helm template`, Argo CD and dry runs, so
 * the same values would render differently depending on the tool. The agent
 * runs in the cluster, so it looks there, every time it starts and then
 * hourly, through the Kubernetes API.
 *
 * It asks for Services by the labels the engines' own charts give them,
 * served from the API server's cache, rather than listing every Service:
 *
 *   - Kubecost 2.x: <release>-cost-analyzer, labels app=cost-analyzer and
 *     app.kubernetes.io/name=cost-analyzer, the UI and API on the port named
 *     tcp-frontend (9090), which serves /model/allocation.
 *   - Kubecost 3.x: <release>-frontend, labels app=kubecost and
 *     app.kubernetes.io/name=kubecost, the same tcp-frontend port.
 *   - OpenCost's chart: labels app.kubernetes.io/name=opencost, the API on
 *     9003 (named http).
 *   - OpenCost's plain manifest: a Service named opencost with no labels,
 *     selecting app=opencost, the API on 9003 (named opencost).
 *
 * Anything labelled app.kubernetes.io/part-of=oneuptime is a OneUptime
 * agent's own bundled OpenCost - this agent's, or another install's - and is
 * never taken for the cluster's engine.
 *
 * Kubecost comes first: it is an engine someone chose and configured,
 * often with their cloud bill behind it. Then OpenCost. Ties are broken by
 * namespace and name, so every start picks the same one.
 */

export type EngineKind = "Kubecost" | "OpenCost";

export interface EngineCandidate {
  kind: EngineKind;
  namespace: string;
  name: string;
  // Where the Allocation API answers, e.g. http://opencost.opencost.svc:9003
  url: string;
}

const KUBECOST_APPS: ReadonlyArray<string> = ["cost-analyzer", "kubecost"];
const OPENCOST_APP: string = "opencost";
const KUBECOST_FRONTEND_PORT_NAME: string = "tcp-frontend";
const OPENCOST_API_PORT: number = 9003;
const OPENCOST_API_PORT_NAMES: ReadonlyArray<string> = ["http", "opencost"];

// A DNS label, as Kubernetes allows a Service's name and namespace.
const DNS_LABEL_PATTERN: RegExp = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

// An IPv4 address: compared whole, never read as a Service's name.
const IPV4_PATTERN: RegExp = /^[0-9.]+$/;

const NAME_LABEL: string = "app.kubernetes.io/name";
const APP_LABEL: string = "app";
const PART_OF_LABEL: string = "app.kubernetes.io/part-of";

/*
 * The three reads the discovery makes. Set-based selectors keep each to one
 * request; the field selector finds the manifest's label-less Service.
 */
export const ENGINE_SERVICE_QUERIES: ReadonlyArray<ServiceQuery> = [
  {
    labelSelector: `${NAME_LABEL} in (${[OPENCOST_APP, ...KUBECOST_APPS].join(",")})`,
  },
  {
    labelSelector: `${APP_LABEL} in (${[OPENCOST_APP, ...KUBECOST_APPS].join(",")})`,
  },
  { fieldSelector: `metadata.name=${OPENCOST_APP}` },
];

const labelOf: (
  values: Record<string, string> | undefined,
  key: string,
) => string = (
  values: Record<string, string> | undefined,
  key: string,
): string => {
  const value: unknown = values ? values[key] : undefined;
  return typeof value === "string" ? value.trim().toLowerCase() : "";
};

// Whether a value can stand in a URL's host as a Service's name or namespace.
const isDnsLabel: (value: string) => boolean = (value: string): boolean => {
  return DNS_LABEL_PATTERN.test(value) && value.length <= 63;
};

/*
 * The engine a Service is, and the URL its API answers at, or null for a
 * Service that is no cost engine's API (Kubecost's aggregator, an OpenCost
 * UI-only Service, a OneUptime agent's bundled engine).
 */
export const toEngineCandidate: (
  service: KubernetesService,
) => EngineCandidate | null = (
  service: KubernetesService,
): EngineCandidate | null => {
  const name: string = (service.metadata?.name || "").trim();
  const namespace: string = (service.metadata?.namespace || "").trim();
  const labels: Record<string, string> | undefined = service.metadata?.labels;
  const selector: Record<string, string> | undefined = service.spec?.selector;
  const ports: Array<{ name?: string; port?: number }> = Array.isArray(
    service.spec?.ports,
  )
    ? service.spec!.ports!
    : [];

  if (!isDnsLabel(name) || !isDnsLabel(namespace)) {
    return null;
  }

  if (labelOf(labels, PART_OF_LABEL) === "oneuptime") {
    return null;
  }

  const appLabels: Array<string> = [
    labelOf(labels, APP_LABEL),
    labelOf(labels, NAME_LABEL),
  ];

  const urlFor: (port: number) => string = (port: number): string => {
    return `http://${name}.${namespace}.svc:${port}`;
  };

  const isPort: (port: number | undefined) => port is number = (
    port: number | undefined,
  ): port is number => {
    return (
      typeof port === "number" &&
      Number.isInteger(port) &&
      port > 0 &&
      port < 65536
    );
  };

  if (
    appLabels.some((value: string): boolean => {
      return KUBECOST_APPS.includes(value);
    })
  ) {
    const frontend: { name?: string; port?: number } | undefined = ports.find(
      (port: { name?: string; port?: number }): boolean => {
        return (
          (port.name || "").toLowerCase() === KUBECOST_FRONTEND_PORT_NAME &&
          isPort(port.port)
        );
      },
    );

    return frontend
      ? { kind: "Kubecost", namespace, name, url: urlFor(frontend.port!) }
      : null;
  }

  const isOpenCost: boolean =
    appLabels.includes(OPENCOST_APP) ||
    name === OPENCOST_APP ||
    labelOf(selector, APP_LABEL) === OPENCOST_APP ||
    labelOf(selector, NAME_LABEL) === OPENCOST_APP;

  if (!isOpenCost) {
    return null;
  }

  const api: { name?: string; port?: number } | undefined =
    ports.find((port: { name?: string; port?: number }): boolean => {
      return port.port === OPENCOST_API_PORT;
    }) ||
    ports.find((port: { name?: string; port?: number }): boolean => {
      return (
        OPENCOST_API_PORT_NAMES.includes((port.name || "").toLowerCase()) &&
        isPort(port.port)
      );
    });

  return api
    ? { kind: "OpenCost", namespace, name, url: urlFor(api.port!) }
    : null;
};

// Kubecost first, then OpenCost; then by namespace and name.
export const rankEngineCandidates: (
  candidates: Array<EngineCandidate>,
) => Array<EngineCandidate> = (
  candidates: Array<EngineCandidate>,
): Array<EngineCandidate> => {
  const kindRank: Record<EngineKind, number> = { Kubecost: 0, OpenCost: 1 };

  return [...candidates].sort(
    (a: EngineCandidate, b: EngineCandidate): number => {
      return (
        kindRank[a.kind] - kindRank[b.kind] ||
        (a.namespace < b.namespace ? -1 : a.namespace > b.namespace ? 1 : 0) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      );
    },
  );
};

/*
 * Every engine the cluster runs, best first, without the ones at
 * `excludeUrls` (the bundled engine this agent would fall back to). One
 * Service matched by two reads is one candidate.
 */
export const discoverEngineCandidates: (data: {
  listServices: ListServices;
  excludeUrls?: Array<string> | undefined;
}) => Promise<Array<EngineCandidate>> = async (data: {
  listServices: ListServices;
  excludeUrls?: Array<string> | undefined;
}): Promise<Array<EngineCandidate>> => {
  const byService: Map<string, EngineCandidate> = new Map<
    string,
    EngineCandidate
  >();

  const excluded: Set<string> = new Set<string>(
    (data.excludeUrls || []).map((url: string): string => {
      return normalizeEngineHost(url);
    }),
  );

  for (const query of ENGINE_SERVICE_QUERIES) {
    for (const service of await data.listServices(query)) {
      const candidate: EngineCandidate | null = toEngineCandidate(service);

      if (!candidate || excluded.has(normalizeEngineHost(candidate.url))) {
        continue;
      }

      byService.set(`${candidate.namespace}/${candidate.name}`, candidate);
    }
  }

  return rankEngineCandidates(Array.from(byService.values()));
};

/*
 * The Service an in-cluster URL names, or null for any other address. A
 * Service is reached as <service>.<namespace>, optionally followed by .svc
 * and the cluster's domain (.svc.cluster.local); an ingress host
 * (kubecost.example.com), an IP address or a bare name is not read as one.
 */
export const serviceOfUrl: (
  url: string,
) => { name: string; namespace: string } | null = (
  url: string,
): { name: string; namespace: string } | null => {
  let host: string;

  try {
    host = new URL(url.trim()).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }

  const parts: Array<string> = host.split(".");
  const isServiceHost: boolean =
    parts.length === 2 || (parts.length >= 3 && parts[2] === "svc");

  if (
    !isServiceHost ||
    IPV4_PATTERN.test(host) ||
    !isDnsLabel(parts[0] || "") ||
    !isDnsLabel(parts[1] || "")
  ) {
    return null;
  }

  return { name: parts[0]!, namespace: parts[1]! };
};

/*
 * "<service>.<namespace>" of an in-cluster URL, however it is spelled
 * (.svc, .svc.cluster.local, a port or none), so the bundled engine's
 * cluster.local URL from the chart matches the .svc one discovery builds.
 */
export const normalizeEngineHost: (url: string) => string = (
  url: string,
): string => {
  const host: string = url
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/:].*$/, "");

  // An address, not a Service's name: compared whole.
  if (IPV4_PATTERN.test(host) || host.startsWith("[")) {
    return host;
  }

  const parts: Array<string> = host.split(".");

  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : host;
};
