import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import { URL } from "url";
import {
  KUBERNETES_API_URL,
  KUBERNETES_CA_PATH,
  KUBERNETES_TOKEN_PATH,
} from "./Config";

/*
 * Just enough of the Kubernetes API to find the cluster's own cost engine,
 * and the Prometheus it reads (#9777): read-only lists of Services and of
 * one engine's pods, and single ConfigMaps, as the agent's ServiceAccount
 * (the chart's ClusterRole already grants get/list/watch on services, pods
 * and configmaps, for the collector). Never a Secret. No client library:
 * the agent stays a few files of Node.
 *
 * In a pod it talks to the API server the way every in-cluster client does:
 * https://$KUBERNETES_SERVICE_HOST:$KUBERNETES_SERVICE_PORT, the
 * ServiceAccount's token, and the cluster's CA. KUBERNETES_API_URL points it
 * somewhere else instead - `kubectl proxy`'s http://127.0.0.1:8001 when the
 * agent runs on a laptop, or a test's stub - and then no token is sent
 * unless the token file exists.
 */

const REQUEST_TIMEOUT_MS: number = 30000;

// The subset of a Service the discovery reads.
export interface KubernetesService {
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
  };
  spec?: {
    selector?: Record<string, string>;
    ports?: Array<{
      name?: string;
      port?: number;
    }>;
  };
}

interface KubernetesServiceList {
  items?: Array<KubernetesService>;
}

// One variable of a container's environment, as its pod spec writes it.
export interface KubernetesEnvVar {
  name?: string;
  value?: string;
  valueFrom?: {
    configMapKeyRef?: { name?: string; key?: string; optional?: boolean };
    secretKeyRef?: { name?: string; key?: string; optional?: boolean };
  };
}

// A container's envFrom: every key of a ConfigMap (or Secret) as a variable.
export interface KubernetesEnvFromSource {
  prefix?: string;
  configMapRef?: { name?: string; optional?: boolean };
  secretRef?: { name?: string; optional?: boolean };
}

// The subset of a pod the agent reads: its containers' environment.
export interface KubernetesPod {
  metadata?: {
    name?: string;
    namespace?: string;
  };
  spec?: {
    containers?: Array<{
      name?: string;
      env?: Array<KubernetesEnvVar>;
      envFrom?: Array<KubernetesEnvFromSource>;
    }>;
  };
  status?: {
    phase?: string;
  };
}

interface KubernetesPodList {
  items?: Array<KubernetesPod>;
}

export interface PodQuery {
  namespace: string;
  labelSelector: string;
}

export type ListPods = (query: PodQuery) => Promise<Array<KubernetesPod>>;

export interface KubernetesConfigMap {
  metadata?: {
    name?: string;
    namespace?: string;
  };
  data?: Record<string, string>;
}

// A ConfigMap by namespace and name, or null when there is none.
export type GetConfigMap = (
  namespace: string,
  name: string,
) => Promise<KubernetesConfigMap | null>;

// A namespace's name, as Kubernetes allows it: a DNS label.
const NAMESPACE_PATTERN: RegExp = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

// A ConfigMap's name, as Kubernetes allows it: a DNS subdomain.
const OBJECT_NAME_PATTERN: RegExp =
  /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

export interface ServiceQuery {
  labelSelector?: string | undefined;
  fieldSelector?: string | undefined;
}

export type ListServices = (
  query: ServiceQuery,
) => Promise<Array<KubernetesService>>;

/*
 * The API server's base URL: KUBERNETES_API_URL when set, else the
 * in-cluster address, or null outside a cluster with neither.
 */
export const getKubernetesApiBaseUrl: () => string | null = ():
  | string
  | null => {
  if (KUBERNETES_API_URL) {
    return KUBERNETES_API_URL;
  }

  const host: string = (process.env["KUBERNETES_SERVICE_HOST"] || "").trim();
  const port: string = (process.env["KUBERNETES_SERVICE_PORT"] || "443").trim();

  if (!host) {
    return null;
  }

  // An IPv6 address goes in brackets in a URL.
  const hostPart: string = host.includes(":") ? `[${host}]` : host;

  return `https://${hostPart}:${port}`;
};

const readFileIfPresent: (path: string) => string | null = (
  path: string,
): string | null => {
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/*
 * GET a URL of the API as JSON. A 404 resolves to null when `orNull` is set
 * (an object that is not there), and is an error otherwise.
 */
const getJson: (url: URL, orNull?: boolean) => Promise<unknown> = (
  url: URL,
  orNull?: boolean,
): Promise<unknown> => {
  /*
   * Read on every call: a projected ServiceAccount token is rotated on disk
   * by the kubelet, and a token read once at start expires within the hour.
   */
  const token: string | null = readFileIfPresent(KUBERNETES_TOKEN_PATH);
  const isHttps: boolean = url.protocol === "https:";
  const ca: string | null = isHttps
    ? readFileIfPresent(KUBERNETES_CA_PATH)
    : null;

  return new Promise(
    (resolve: (value: unknown) => void, reject: (err: Error) => void): void => {
      const options: https.RequestOptions = {
        method: "GET",
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token.trim()}` } : {}),
        },
        timeout: REQUEST_TIMEOUT_MS,
        ...(ca ? { ca } : {}),
      };

      const req: http.ClientRequest = (isHttps ? https : http).request(
        options,
        (res: http.IncomingMessage): void => {
          const chunks: Array<Buffer> = [];
          res.on("data", (chunk: Buffer): void => {
            chunks.push(chunk);
          });
          res.on("end", (): void => {
            const body: string = Buffer.concat(chunks).toString("utf8");
            const status: number = res.statusCode || 0;

            if (status === 404 && orNull) {
              resolve(null);
              return;
            }

            if (status < 200 || status >= 300) {
              reject(
                new Error(
                  `Kubernetes API answered HTTP ${status} for ${url.pathname}: ${body.slice(0, 300)}`,
                ),
              );
              return;
            }

            try {
              resolve(JSON.parse(body));
            } catch {
              reject(
                new Error(
                  `Kubernetes API answered ${url.pathname} with something that is not JSON`,
                ),
              );
            }
          });
        },
      );

      req.on("timeout", (): void => {
        req.destroy(
          new Error(
            `Kubernetes API request timed out after ${REQUEST_TIMEOUT_MS}ms`,
          ),
        );
      });
      req.on("error", (err: Error): void => {
        reject(err);
      });
      req.end();
    },
  );
};

/*
 * Services across every namespace that match the selectors, served from
 * the API server's watch cache (resourceVersion=0): a cheap, filtered read,
 * not a walk of etcd.
 */
const apiBaseUrl: () => string = (): string => {
  const base: string | null = getKubernetesApiBaseUrl();

  if (!base) {
    throw new Error(
      "The agent is not running in a Kubernetes cluster (no KUBERNETES_SERVICE_HOST) and KUBERNETES_API_URL is not set, so it cannot look for the cluster's cost engine.",
    );
  }

  return base.replace(/\/+$/, "");
};

export const listServices: ListServices = async (
  query: ServiceQuery,
): Promise<Array<KubernetesService>> => {
  const url: URL = new URL(`${apiBaseUrl()}/api/v1/services`);
  url.searchParams.set("resourceVersion", "0");

  if (query.labelSelector) {
    url.searchParams.set("labelSelector", query.labelSelector);
  }

  if (query.fieldSelector) {
    url.searchParams.set("fieldSelector", query.fieldSelector);
  }

  const list: KubernetesServiceList = (await getJson(
    url,
  )) as KubernetesServiceList;

  return Array.isArray(list?.items) ? list.items : [];
};

/*
 * The pods of one namespace that a selector matches (an engine's Service's
 * selector), from the API server's watch cache: the engine's pods alone,
 * never a walk of the cluster's.
 */
export const listPods: ListPods = async (
  query: PodQuery,
): Promise<Array<KubernetesPod>> => {
  if (!NAMESPACE_PATTERN.test(query.namespace)) {
    throw new Error(`"${query.namespace}" is not a namespace's name`);
  }

  const url: URL = new URL(
    `${apiBaseUrl()}/api/v1/namespaces/${query.namespace}/pods`,
  );
  url.searchParams.set("resourceVersion", "0");
  url.searchParams.set("labelSelector", query.labelSelector);

  const list: KubernetesPodList = (await getJson(url)) as KubernetesPodList;

  return Array.isArray(list?.items) ? list.items : [];
};

// One ConfigMap, or null when its namespace has none of that name.
export const getConfigMap: GetConfigMap = async (
  namespace: string,
  name: string,
): Promise<KubernetesConfigMap | null> => {
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new Error(`"${namespace}" is not a namespace's name`);
  }

  if (name.length > 253 || !OBJECT_NAME_PATTERN.test(name)) {
    throw new Error(`"${name}" is not a ConfigMap's name`);
  }

  const configMap: unknown = await getJson(
    new URL(
      `${apiBaseUrl()}/api/v1/namespaces/${namespace}/configmaps/${name}`,
    ),
    true,
  );

  return configMap && typeof configMap === "object"
    ? (configMap as KubernetesConfigMap)
    : null;
};
