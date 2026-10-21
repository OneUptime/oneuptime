import { testConfig } from "./Helpers/TestSupport";
import assert from "assert";
import fs from "fs";
import path from "path";
import { after, before, describe, test } from "node:test";
import {
  AgentPosture,
  DEFAULT_SERVICE_ACCOUNT_PATHS,
  KubectlVersionProbe,
  buildPosture,
  getInClusterApiServer,
  isInCluster,
  parseKubectlClientVersion,
  resolvePodNamespace,
} from "../Posture";
import FakeKubectl, {
  FakeKubectlInvocation,
  FakeServiceAccount,
  makeTempDir,
} from "./Helpers/FakeKubectl";

let serviceAccount: FakeServiceAccount;
let noNamespaceMount: FakeServiceAccount;
let kubectl: FakeKubectl;

const IN_POD_ENV: NodeJS.ProcessEnv = {
  KUBERNETES_SERVICE_HOST: "10.96.0.1",
  KUBERNETES_SERVICE_PORT: "443",
};

before((): void => {
  serviceAccount = new FakeServiceAccount({ namespace: "OneUptime-Agent\n" });
  noNamespaceMount = new FakeServiceAccount({ namespace: null });
  kubectl = new FakeKubectl();
});

after((): void => {
  serviceAccount.cleanup();
  noNamespaceMount.cleanup();
  kubectl.cleanup();
});

describe("in-cluster facts", () => {
  test("the production ServiceAccount mount", () => {
    assert.deepStrictEqual(DEFAULT_SERVICE_ACCOUNT_PATHS, {
      token: "/var/run/secrets/kubernetes.io/serviceaccount/token",
      ca: "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
      namespace: "/var/run/secrets/kubernetes.io/serviceaccount/namespace",
    });
  });

  test("the API server needs both host and port", () => {
    assert.deepStrictEqual(getInClusterApiServer(IN_POD_ENV), {
      host: "10.96.0.1",
      port: "443",
    });
    assert.deepStrictEqual(
      getInClusterApiServer({
        KUBERNETES_SERVICE_HOST: " 10.96.0.1 ",
        KUBERNETES_SERVICE_PORT: " 443 ",
      }),
      { host: "10.96.0.1", port: "443" },
    );
    assert.strictEqual(
      getInClusterApiServer({ KUBERNETES_SERVICE_HOST: "10.96.0.1" }),
      null,
    );
    assert.strictEqual(
      getInClusterApiServer({ KUBERNETES_SERVICE_PORT: "443" }),
      null,
    );
    assert.strictEqual(getInClusterApiServer({}), null);
  });

  test("in the cluster means host, port and a token file", () => {
    assert.strictEqual(
      isInCluster({ env: IN_POD_ENV, serviceAccount: serviceAccount.paths() }),
      true,
    );
    assert.strictEqual(
      isInCluster({ env: {}, serviceAccount: serviceAccount.paths() }),
      false,
    );
    assert.strictEqual(
      isInCluster({
        env: IN_POD_ENV,
        serviceAccount: {
          ...serviceAccount.paths(),
          token: path.join(serviceAccount.dir, "missing"),
        },
      }),
      false,
    );
    // A directory in place of the token is not a token.
    assert.strictEqual(
      isInCluster({
        env: IN_POD_ENV,
        serviceAccount: {
          ...serviceAccount.paths(),
          token: serviceAccount.dir,
        },
      }),
      false,
    );
  });

  test("the pod namespace: the chart's value, else the mount's, else null", () => {
    assert.strictEqual(
      resolvePodNamespace({
        configured: "Configured-NS",
        serviceAccount: serviceAccount.paths(),
      }),
      "configured-ns",
    );
    assert.strictEqual(
      resolvePodNamespace({
        configured: null,
        serviceAccount: serviceAccount.paths(),
      }),
      "oneuptime-agent",
    );
    assert.strictEqual(
      resolvePodNamespace({
        configured: "  ",
        serviceAccount: noNamespaceMount.paths(),
      }),
      null,
    );
  });
});

describe("the reported posture", () => {
  test("read-only by default, with every field the server expects", () => {
    const posture: AgentPosture = buildPosture({
      config: testConfig("https://oneuptime.example.com"),
      env: IN_POD_ENV,
      serviceAccount: serviceAccount.paths(),
      kubectlVersion: "v1.36.4",
    });

    assert.deepStrictEqual(posture, {
      clusterIdentifier: "prod-us",
      inCluster: true,
      allowWrites: false,
      allowNodeOperations: false,
      writeNamespaces: [],
      aiSettings: {
        investigation: true,
        fixes: "Disabled",
        isConfigured: false,
      },
      podNamespace: "oneuptime-agent",
      kubectlVersion: "v1.36.4",
      agentChartVersion: "14.0.8",
    });
  });

  test("writes, scope and node operations as the chart set them", () => {
    const posture: AgentPosture = buildPosture({
      config: testConfig("https://oneuptime.example.com", {
        ONEUPTIME_KUBECTL_ALLOW_WRITES: "true",
        ONEUPTIME_KUBECTL_WRITE_NAMESPACES: "web,api",
        ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS: "true",
        ONEUPTIME_AI_AGENT_POD_NAMESPACE: "agents",
      }),
      env: IN_POD_ENV,
      serviceAccount: serviceAccount.paths(),
      kubectlVersion: null,
    });

    assert.strictEqual(posture.allowWrites, true);
    assert.strictEqual(posture.allowNodeOperations, true);
    assert.deepStrictEqual(posture.writeNamespaces, ["web", "api"]);
    assert.strictEqual(posture.podNamespace, "agents");
    assert.strictEqual("kubectlVersion" in posture, false);
  });

  test("node operations are reported off when writes are off, whatever the node switch says", () => {
    const posture: AgentPosture = buildPosture({
      config: testConfig("https://oneuptime.example.com", {
        ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS: "true",
      }),
      env: IN_POD_ENV,
      serviceAccount: serviceAccount.paths(),
      kubectlVersion: null,
    });

    assert.strictEqual(posture.allowWrites, false);
    assert.strictEqual(posture.allowNodeOperations, false);
  });

  test("outside a pod: not in the cluster, and unknown fields are left out", () => {
    const posture: AgentPosture = buildPosture({
      config: testConfig("https://oneuptime.example.com", {
        ONEUPTIME_KUBERNETES_AGENT_CHART_VERSION: "",
      }),
      env: {},
      serviceAccount: noNamespaceMount.paths(),
      kubectlVersion: null,
    });

    assert.strictEqual(posture.inCluster, false);
    assert.strictEqual("podNamespace" in posture, false);
    assert.strictEqual("agentChartVersion" in posture, false);
  });
});

describe("kubectl version detection", () => {
  test("parses the client version and caches it", async () => {
    kubectl.setBehaviour({ clientVersion: "v1.36.4" });
    kubectl.clearInvocations();
    const probe: KubectlVersionProbe = new KubectlVersionProbe({
      path: kubectl.getPath(),
    });

    assert.strictEqual(await probe.detect(), "v1.36.4");
    assert.strictEqual(await probe.detect(), "v1.36.4");

    const invocations: Array<FakeKubectlInvocation> = kubectl.getInvocations();
    assert.strictEqual(invocations.length, 1, "probed once");
    assert.deepStrictEqual(invocations[0]!.argv, [
      "version",
      "--client",
      "-o",
      "json",
    ]);
    // A closed environment with kuberc preferences off.
    assert.strictEqual(invocations[0]!.env["KUBERC"], "off");
    assert.strictEqual(invocations[0]!.env["KUBECTL_KUBERC"], "false");
    assert.deepStrictEqual(Object.keys(invocations[0]!.env).sort(), [
      "HOME",
      "KUBECTL_KUBERC",
      "KUBERC",
      "PATH",
    ]);
  });

  test("a kubectl that fails, or is missing, is null", async () => {
    kubectl.setBehaviour({ clientVersion: null });
    assert.strictEqual(
      await new KubectlVersionProbe({ path: kubectl.getPath() }).detect(),
      null,
    );

    const empty: string = makeTempDir("no-kubectl-");
    assert.strictEqual(
      await new KubectlVersionProbe({
        binary: path.join(empty, "kubectl"),
      }).detect(),
      null,
    );
    fs.rmSync(empty, { recursive: true, force: true });
  });

  test("parseKubectlClientVersion", () => {
    assert.strictEqual(
      parseKubectlClientVersion('{"clientVersion":{"gitVersion":"v1.35.0"}}'),
      "v1.35.0",
    );
    assert.strictEqual(parseKubectlClientVersion("not json"), null);
    assert.strictEqual(parseKubectlClientVersion("[]"), null);
    assert.strictEqual(parseKubectlClientVersion('{"clientVersion":1}'), null);
    assert.strictEqual(
      parseKubectlClientVersion('{"clientVersion":{"gitVersion":""}}'),
      null,
    );
  });
});
