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
 * Just enough of the Kubernetes API to find the cluster's own cost engine:
 * read-only lists of Services, as the agent's ServiceAccount (the chart's
 * ClusterRole already grants get/list/watch on services, for the
 * collector). No client library: the agent stays a few files of Node.
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

const getJson: (url: URL) => Promise<unknown> = (
  url: URL,
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
export const listServices: ListServices = async (
  query: ServiceQuery,
): Promise<Array<KubernetesService>> => {
  const base: string | null = getKubernetesApiBaseUrl();

  if (!base) {
    throw new Error(
      "The agent is not running in a Kubernetes cluster (no KUBERNETES_SERVICE_HOST) and KUBERNETES_API_URL is not set, so it cannot look for the cluster's cost engine.",
    );
  }

  const url: URL = new URL(`${base.replace(/\/+$/, "")}/api/v1/services`);
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
