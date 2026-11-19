import "./TestEnv";
import * as assert from "assert";
import { afterEach, test } from "node:test";
import { getKubernetesApiBaseUrl, listServices } from "../KubernetesApi";

/*
 * In a pod, with no KUBERNETES_API_URL (TestEnv sets none), the agent finds
 * the API server where every in-cluster client does: the address the
 * kubelet puts in KUBERNETES_SERVICE_HOST and _PORT.
 */

const saved: { host?: string; port?: string } = {
  host: process.env["KUBERNETES_SERVICE_HOST"],
  port: process.env["KUBERNETES_SERVICE_PORT"],
};

afterEach((): void => {
  for (const [key, value] of [
    ["KUBERNETES_SERVICE_HOST", saved.host],
    ["KUBERNETES_SERVICE_PORT", saved.port],
  ] as const) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("uses the in-cluster address over https", (): void => {
  process.env["KUBERNETES_SERVICE_HOST"] = "10.96.0.1";
  process.env["KUBERNETES_SERVICE_PORT"] = "443";

  assert.strictEqual(getKubernetesApiBaseUrl(), "https://10.96.0.1:443");
});

test("puts an IPv6 address in brackets", (): void => {
  process.env["KUBERNETES_SERVICE_HOST"] = "fd00:10:96::1";
  process.env["KUBERNETES_SERVICE_PORT"] = "6443";

  assert.strictEqual(getKubernetesApiBaseUrl(), "https://[fd00:10:96::1]:6443");
});

test("outside a cluster, with nothing set, there is no API to ask, and the agent says so", async (): Promise<void> => {
  delete process.env["KUBERNETES_SERVICE_HOST"];

  assert.strictEqual(getKubernetesApiBaseUrl(), null);
  await assert.rejects(
    listServices({ labelSelector: "app=opencost" }),
    /not running in a Kubernetes cluster.*KUBERNETES_API_URL/,
  );
});
