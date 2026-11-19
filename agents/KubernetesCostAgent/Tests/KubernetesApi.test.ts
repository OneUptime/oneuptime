import { KUBERNETES_API_PORT, TOKEN_PATH } from "./KubernetesApiTestEnv";
import "./TestEnv";
import * as assert from "assert";
import * as fs from "fs";
import * as http from "http";
import { after, before, beforeEach, test } from "node:test";
import {
  KubernetesConfigMap,
  KubernetesPod,
  KubernetesService,
  getConfigMap,
  getKubernetesApiBaseUrl,
  listPods,
  listServices,
} from "../KubernetesApi";

/*
 * #9633: the agent finds the cluster's own cost engine through the
 * Kubernetes API, as its ServiceAccount. These pin what it asks for and how:
 * a filtered list from the API server's cache, with the token read fresh on
 * every request (a projected token rotates on disk).
 */

interface Seen {
  path: string;
  query: URLSearchParams;
  authorization: string | undefined;
}

let server: http.Server;
let seen: Array<Seen> = [];
let respond: (res: http.ServerResponse) => void = (
  res: http.ServerResponse,
): void => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ kind: "ServiceList", items: [] }));
};

before(async (): Promise<void> => {
  server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse): void => {
      const url: URL = new URL(req.url || "/", "http://localhost");
      seen.push({
        path: url.pathname,
        query: url.searchParams,
        authorization: req.headers.authorization,
      });
      respond(res);
    },
  );
  await new Promise<void>((resolve: () => void): void => {
    server.listen(KUBERNETES_API_PORT, "127.0.0.1", resolve);
  });
});

after(async (): Promise<void> => {
  await new Promise<void>((resolve: () => void): void => {
    server.close((): void => {
      resolve();
    });
  });
});

beforeEach((): void => {
  seen = [];
  fs.writeFileSync(TOKEN_PATH, "first-token\n");
});

test("lists Services across the cluster by selector, from the API server's cache", async (): Promise<void> => {
  await listServices({ labelSelector: "app in (opencost,kubecost)" });
  await listServices({ fieldSelector: "metadata.name=opencost" });

  assert.strictEqual(seen.length, 2);
  assert.strictEqual(seen[0]!.path, "/api/v1/services");
  assert.strictEqual(
    seen[0]!.query.get("labelSelector"),
    "app in (opencost,kubecost)",
  );
  assert.strictEqual(seen[0]!.query.get("resourceVersion"), "0");
  assert.strictEqual(seen[0]!.query.get("fieldSelector"), null);
  assert.strictEqual(
    seen[1]!.query.get("fieldSelector"),
    "metadata.name=opencost",
  );
});

test("sends the ServiceAccount token, read again for every request", async (): Promise<void> => {
  await listServices({ labelSelector: "app=opencost" });
  fs.writeFileSync(TOKEN_PATH, "rotated-token");
  await listServices({ labelSelector: "app=opencost" });

  assert.strictEqual(seen[0]!.authorization, "Bearer first-token");
  assert.strictEqual(seen[1]!.authorization, "Bearer rotated-token");
});

test("returns the Services the API listed", async (): Promise<void> => {
  const service: KubernetesService = {
    metadata: { name: "opencost", namespace: "opencost" },
    spec: { ports: [{ name: "http", port: 9003 }] },
  };

  respond = (res: http.ServerResponse): void => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ kind: "ServiceList", items: [service] }));
  };

  assert.deepStrictEqual(
    await listServices({ labelSelector: "app=opencost" }),
    [service],
  );
});

test("a refusal says what the API answered", async (): Promise<void> => {
  respond = (res: http.ServerResponse): void => {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        kind: "Status",
        message: 'services is forbidden: User "x" cannot list resource',
      }),
    );
  };

  await assert.rejects(
    listServices({ labelSelector: "app=opencost" }),
    /HTTP 403.*forbidden/,
  );
});

test("an answer with no items is an empty list, not an error", async (): Promise<void> => {
  respond = (res: http.ServerResponse): void => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ kind: "ServiceList" }));
  };

  assert.deepStrictEqual(
    await listServices({ labelSelector: "app=opencost" }),
    [],
  );
});

test("KUBERNETES_API_URL wins, and is used without its trailing slash", (): void => {
  assert.strictEqual(
    getKubernetesApiBaseUrl(),
    `http://127.0.0.1:${KUBERNETES_API_PORT}`,
  );
});

/*
 * #9777: the Prometheus a cluster's own engine reads is named in its pods'
 * environment, as a value or from a ConfigMap. The agent reads one engine's
 * pods, by its Service's selector in its namespace, and one ConfigMap at a
 * time; never a Secret.
 */

test("lists one namespace's pods by a selector, from the API server's cache", async (): Promise<void> => {
  const pod: KubernetesPod = {
    metadata: { name: "opencost-1", namespace: "opencost" },
    spec: {
      containers: [
        {
          name: "opencost",
          env: [
            {
              name: "PROMETHEUS_SERVER_ENDPOINT",
              value: "http://prometheus-server.prometheus-system.svc:80",
            },
          ],
        },
      ],
    },
  };
  respond = (res: http.ServerResponse): void => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ kind: "PodList", items: [pod] }));
  };

  assert.deepStrictEqual(
    await listPods({
      namespace: "opencost",
      labelSelector:
        "app.kubernetes.io/instance=opencost,app.kubernetes.io/name=opencost",
    }),
    [pod],
  );
  assert.strictEqual(seen[0]!.path, "/api/v1/namespaces/opencost/pods");
  assert.strictEqual(
    seen[0]!.query.get("labelSelector"),
    "app.kubernetes.io/instance=opencost,app.kubernetes.io/name=opencost",
  );
  assert.strictEqual(seen[0]!.query.get("resourceVersion"), "0");
  assert.strictEqual(seen[0]!.authorization, "Bearer first-token");
});

test("reads one ConfigMap by its namespace and name", async (): Promise<void> => {
  const configMap: KubernetesConfigMap = {
    metadata: { name: "kubecost-cost-analyzer", namespace: "kubecost" },
    data: {
      "prometheus-server-endpoint":
        "http://kubecost-prometheus-server.kubecost",
    },
  };
  respond = (res: http.ServerResponse): void => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(configMap));
  };

  assert.deepStrictEqual(
    await getConfigMap("kubecost", "kubecost-cost-analyzer"),
    configMap,
  );
  assert.strictEqual(
    seen[0]!.path,
    "/api/v1/namespaces/kubecost/configmaps/kubecost-cost-analyzer",
  );
});

test("a ConfigMap that is not there is null, not an error", async (): Promise<void> => {
  respond = (res: http.ServerResponse): void => {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ kind: "Status", reason: "NotFound" }));
  };

  assert.strictEqual(await getConfigMap("kubecost", "gone"), null);

  // A pod list that is not there is still an error: that namespace's pods.
  await assert.rejects(
    listPods({ namespace: "kubecost", labelSelector: "app=cost-analyzer" }),
    /HTTP 404/,
  );
});

test("a refused ConfigMap read says what the API answered", async (): Promise<void> => {
  respond = (res: http.ServerResponse): void => {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ kind: "Status", message: "configmaps is forbidden" }),
    );
  };

  await assert.rejects(
    getConfigMap("kubecost", "kubecost-cost-analyzer"),
    /HTTP 403.*forbidden/,
  );
});

test("a namespace or name that is no Kubernetes name is never put in a path", async (): Promise<void> => {
  await assert.rejects(
    getConfigMap("../secrets", "x"),
    /not a namespace's name/,
  );
  await assert.rejects(
    getConfigMap("kubecost", "a/../../secrets/b"),
    /not a ConfigMap's name/,
  );
  await assert.rejects(
    listPods({ namespace: "Kube System", labelSelector: "app=x" }),
    /not a namespace's name/,
  );
  assert.strictEqual(seen.length, 0);
});
