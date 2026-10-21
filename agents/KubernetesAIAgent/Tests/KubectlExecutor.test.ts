import "./Helpers/TestSupport";
import assert from "assert";
import fs from "fs";
import path from "path";
import { after, afterEach, before, describe, test } from "node:test";
import KubectlExecutor, {
  KUBECTL_NUL_REPLACEMENT,
  KubectlCommandRequest,
  KubectlExecResult,
  KubectlExecutorSettings,
  MAX_OUTPUT_BYTES,
  PreparedKubectlCommand,
  STDERR_MAX_BYTES,
  formatInClusterServerUrl,
  formatKubectlOutput,
  formatRequestTimeout,
  getPayloadClusterIdentifier,
  getRequestTimeoutMs,
  lastStderrLine,
  replaceNulCharacters,
  rewordScopeRefusalForAgent,
} from "../KubectlExecutor";
import FakeKubectl, {
  FakeKubectlInvocation,
  FakeServiceAccount,
  makeTempDir,
} from "./Helpers/FakeKubectl";
import { KubectlCommandTier } from "../Common/Types/Kubernetes/KubernetesClusterAiAccess";

/*
 * The executor against a FAKE kubectl (Helpers/FakeKubectl): a script first
 * on the PATH the agent spawns with, recording its argv, environment and
 * the kubeconfig it was handed. The ServiceAccount mount is a temporary
 * directory too, so every in-cluster fact is controlled here.
 */

let kubectl: FakeKubectl;
let serviceAccount: FakeServiceAccount;
let tmpDir: string;

before((): void => {
  kubectl = new FakeKubectl();
  serviceAccount = new FakeServiceAccount({ namespace: "oneuptime-agent" });
  tmpDir = makeTempDir("agent-tmp-");
});

after((): void => {
  kubectl.cleanup();
  serviceAccount.cleanup();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach((): void => {
  kubectl.clearInvocations();
  kubectl.setBehaviour({});
});

function settings(
  overrides: Partial<KubectlExecutorSettings> = {},
): KubectlExecutorSettings {
  return {
    clusterName: "prod-us",
    allowWrites: false,
    allowWritesSetting: null,
    allowNodeOperations: false,
    allowNodeOperationsSetting: null,
    writeNamespaces: [],
    podNamespace: "oneuptime-agent",
    env: {
      PATH: kubectl.getPath(),
      KUBERNETES_SERVICE_HOST: "10.96.0.1",
      KUBERNETES_SERVICE_PORT: "443",
      KUBERNETES_SERVICE_PORT_HTTPS: "443",
      HTTPS_PROXY: "http://proxy.corp:3128",
      NO_PROXY: "10.0.0.0/8",
      ONEUPTIME_API_KEY: "must-never-reach-kubectl",
      KUBECONFIG: "/root/.kube/config",
    },
    serviceAccount: serviceAccount.paths(),
    tmpDir,
    ...overrides,
  };
}

function request(
  overrides: Partial<KubectlCommandRequest> & {
    args?: Array<unknown>;
    clusterIdentifier?: string;
  } = {},
): KubectlCommandRequest {
  return {
    payload: overrides.payload || {
      args: overrides.args || ["get", "pods", "-n", "web"],
      clusterIdentifier: overrides.clusterIdentifier ?? "prod-us",
      kubernetesClusterId: "cluster-1",
    },
    timeoutInMs: overrides.timeoutInMs ?? 30_000,
    origin: overrides.origin || "AiInvestigation",
  };
}

async function run(
  executorSettings: KubectlExecutorSettings,
  commandRequest: KubectlCommandRequest,
): Promise<KubectlExecResult> {
  return new KubectlExecutor(executorSettings).execute(commandRequest);
}

function onlyInvocation(): FakeKubectlInvocation {
  const invocations: Array<FakeKubectlInvocation> =
    kubectl.getCommandInvocations();
  assert.strictEqual(invocations.length, 1, "kubectl ran exactly once");
  return invocations[0]!;
}

describe("how kubectl is started", () => {
  test("the argv starts with --kubeconfig and the request timeout, then the command", async () => {
    const result: KubectlExecResult = await run(settings(), request());

    assert.strictEqual(result.success, true);
    const invocation: FakeKubectlInvocation = onlyInvocation();

    assert.strictEqual(invocation.argv[0], "--kubeconfig");
    assert.ok(invocation.argv[1]);
    assert.deepStrictEqual(invocation.argv.slice(2), [
      "--request-timeout=24s",
      "get",
      "pods",
      "-n",
      "web",
    ]);
  });

  test("the environment is closed: exactly PATH, HOME, KUBECACHEDIR, KUBERC, KUBECTL_KUBERC, KUBECONFIG", async () => {
    await run(settings(), request());
    const invocation: FakeKubectlInvocation = onlyInvocation();

    assert.deepStrictEqual(Object.keys(invocation.env).sort(), [
      "HOME",
      "KUBECACHEDIR",
      "KUBECONFIG",
      "KUBECTL_KUBERC",
      "KUBERC",
      "PATH",
    ]);
    assert.strictEqual(invocation.env["KUBERC"], "off");
    assert.strictEqual(invocation.env["KUBECTL_KUBERC"], "false");
    // Never the service variables, the proxy, the API key or a host KUBECONFIG.
    assert.strictEqual(invocation.env["KUBERNETES_SERVICE_HOST"], undefined);
    assert.strictEqual(invocation.env["HTTPS_PROXY"], undefined);
    assert.strictEqual(invocation.env["NO_PROXY"], undefined);
    assert.strictEqual(invocation.env["ONEUPTIME_API_KEY"], undefined);
    assert.strictEqual(invocation.env["KUBECONFIG"], invocation.kubeconfigPath);
  });

  test("HOME is the job's private, empty directory and the working directory; the cache sits beside it", async () => {
    await run(settings(), request());
    const invocation: FakeKubectlInvocation = onlyInvocation();
    const jobDir: string = path.dirname(invocation.kubeconfigPath!);

    assert.strictEqual(invocation.env["HOME"], path.join(jobDir, "home"));
    // cwd comes back resolved (/private/var/... on macOS), so compare its tail.
    assert.strictEqual(path.basename(invocation.cwd), "home");
    assert.strictEqual(
      path.basename(path.dirname(invocation.cwd)),
      path.basename(jobDir),
    );
    assert.strictEqual(invocation.homeExists, true);
    assert.strictEqual(
      invocation.env["KUBECACHEDIR"],
      path.join(jobDir, "cache"),
    );
    assert.ok(
      jobDir.startsWith(path.join(tmpDir, "oneuptime-kubectl", "job-")),
      jobDir,
    );
  });

  test("the kubeconfig uses the pod's ServiceAccount by path: server, CA, tokenFile and the pod namespace", async () => {
    await run(settings(), request());
    const invocation: FakeKubectlInvocation = onlyInvocation();
    const kubeconfig: string = invocation.kubeconfig!;

    assert.match(kubeconfig, /server: "https:\/\/10\.96\.0\.1:443"/);
    assert.ok(
      kubeconfig.includes(
        `certificate-authority: ${JSON.stringify(serviceAccount.ca)}`,
      ),
    );
    assert.ok(
      kubeconfig.includes(`tokenFile: ${JSON.stringify(serviceAccount.token)}`),
    );
    assert.match(kubeconfig, /namespace: "oneuptime-agent"/);
    assert.match(kubeconfig, /current-context: in-cluster/);
    // The token is referenced, never written out.
    assert.ok(!kubeconfig.includes(FakeServiceAccount.TOKEN_VALUE));
    assert.ok(!kubeconfig.includes("    token:"));
  });

  test("the kubeconfig is 0600 in a 0700 directory, and both are gone afterwards", async () => {
    await run(settings(), request());
    const invocation: FakeKubectlInvocation = onlyInvocation();

    assert.strictEqual(invocation.kubeconfigMode, 0o600);
    assert.strictEqual(invocation.jobDirMode, 0o700);
    assert.strictEqual(fs.existsSync(invocation.kubeconfigPath!), false);
    assert.strictEqual(
      fs.existsSync(path.dirname(invocation.kubeconfigPath!)),
      false,
    );
  });

  test("the production kubeconfig names the real ServiceAccount mount", () => {
    const kubeconfig: string = KubectlExecutor.buildInClusterKubeconfig({
      apiServer: { host: "10.96.0.1", port: "443" },
      namespace: "oneuptime-agent",
      serviceAccount: {
        token: "/var/run/secrets/kubernetes.io/serviceaccount/token",
        ca: "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
        namespace: "/var/run/secrets/kubernetes.io/serviceaccount/namespace",
      },
    });

    assert.strictEqual(
      kubeconfig,
      [
        "apiVersion: v1",
        "kind: Config",
        "clusters:",
        "- name: in-cluster",
        "  cluster:",
        '    server: "https://10.96.0.1:443"',
        '    certificate-authority: "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"',
        "users:",
        "- name: in-cluster",
        "  user:",
        '    tokenFile: "/var/run/secrets/kubernetes.io/serviceaccount/token"',
        "contexts:",
        "- name: in-cluster",
        "  context:",
        "    cluster: in-cluster",
        "    user: in-cluster",
        '    namespace: "oneuptime-agent"',
        "current-context: in-cluster",
        "",
      ].join("\n"),
    );
  });

  test("an unknown pod namespace leaves the context namespace out", () => {
    const kubeconfig: string = KubectlExecutor.buildInClusterKubeconfig({
      apiServer: { host: "10.96.0.1", port: "443" },
      namespace: null,
      serviceAccount: serviceAccount.paths(),
    });

    assert.ok(!kubeconfig.includes("namespace:"));
  });

  test("an IPv6 API server host is bracketed", async () => {
    assert.strictEqual(
      formatInClusterServerUrl({ host: "fd00:10:96::1", port: "443" }),
      "https://[fd00:10:96::1]:443",
    );
    assert.strictEqual(
      formatInClusterServerUrl({ host: "[fd00::1]", port: "6443" }),
      "https://[fd00::1]:6443",
    );
    assert.strictEqual(
      formatInClusterServerUrl({ host: "kubernetes.default.svc", port: "443" }),
      "https://kubernetes.default.svc:443",
    );

    await run(
      settings({
        env: {
          PATH: kubectl.getPath(),
          KUBERNETES_SERVICE_HOST: "fd00:10:96::1",
          KUBERNETES_SERVICE_PORT: "443",
        },
      }),
      request(),
    );
    assert.match(
      onlyInvocation().kubeconfig!,
      /server: "https:\/\/\[fd00:10:96::1\]:443"/,
    );
  });

  test("a --request-timeout the command carries is kept, and no second one is added", async () => {
    for (const flag of ["--request-timeout=5s", "--request_timeout=5s"]) {
      kubectl.clearInvocations();
      await run(
        settings(),
        request({ args: ["get", "pods", flag, "-n", "web"] }),
      );

      assert.deepStrictEqual(onlyInvocation().argv.slice(2), [
        "get",
        "pods",
        flag,
        "-n",
        "web",
      ]);
    }
  });

  test("the argv is passed as it is — never through a shell", async () => {
    const hostile: string = "app=$(touch /tmp/pwned);`id`|cat";
    await run(settings(), request({ args: ["get", "pods", "-l", hostile] }));

    assert.deepStrictEqual(onlyInvocation().argv.slice(-2), ["-l", hostile]);
  });
});

describe("results", () => {
  test("success: exit 0 and the output under [stdout]", async () => {
    kubectl.setBehaviour({ stdout: "NAME   READY\nweb-1  1/1\n" });

    const result: KubectlExecResult = await run(settings(), request());

    assert.deepStrictEqual(result, {
      success: true,
      output: "[stdout]\nNAME   READY\nweb-1  1/1\n",
      exitCode: 0,
    });
  });

  test("failure: the exit code, and kubectl's last stderr line as the reason", async () => {
    kubectl.setBehaviour({
      stderr:
        'Error from server (Forbidden): pods is forbidden: User "system:serviceaccount:oneuptime-agent:ai" cannot list resource "pods"\n',
      exitCode: 1,
    });

    const result: KubectlExecResult = await run(settings(), request());

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);
    assert.match(
      result.errorMessage!,
      /^Exit code 1: Error from server \(Forbidden\)/,
    );
    assert.match(result.output, /^\[stderr\]\nError from server/);
  });

  test("a missing kubectl binary says to use the agent image", async () => {
    const result: KubectlExecResult = await run(
      settings({ kubectlBinary: path.join(tmpDir, "no-such-kubectl") }),
      request(),
    );

    assert.strictEqual(result.success, false);
    assert.match(result.errorMessage!, /kubectl is not installed/);
    assert.match(result.errorMessage!, /oneuptime\/kubernetes-ai-agent/);
  });

  test("a command that outlives its budget is killed, and silence is explained", async () => {
    kubectl.setBehaviour({ sleepMs: 10_000 });

    const started: number = Date.now();
    const result: KubectlExecResult = await run(
      settings(),
      request({ timeoutInMs: 400 }),
    );

    assert.ok(Date.now() - started < 5_000, "killed long before it finished");
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.match(
      result.errorMessage!,
      /^Killed \(timeout 400ms\): kubectl produced no output at all, so the in-cluster Kubernetes API server is probably unreachable/,
    );
  });

  test("a killed command that printed something is just 'Killed'", async () => {
    kubectl.setBehaviour({ stdout: "partial\n", sleepMs: 20_000 });

    // Long enough for the fake to start and print, even on a busy machine.
    const result: KubectlExecResult = await run(
      settings(),
      request({ timeoutInMs: 3_000 }),
    );

    assert.strictEqual(result.errorMessage, "Killed (timeout 3000ms)");
    assert.match(result.output, /partial/);
  });

  test("stdout is capped at the output budget and says so", async () => {
    kubectl.setBehaviour({ stdoutBytes: MAX_OUTPUT_BYTES + 70_000 });

    const result: KubectlExecResult = await run(settings(), request());

    assert.strictEqual(result.success, true);
    assert.match(
      result.output,
      /\.\.\. \[output truncated: stdout cut at \d+ bytes\]$/,
    );
    assert.ok(Buffer.byteLength(result.output) < MAX_OUTPUT_BYTES + 200);
  });

  test("stderr keeps its tail, and is never pushed out by a large stdout", async () => {
    kubectl.setBehaviour({
      stdoutBytes: MAX_OUTPUT_BYTES + 70_000,
      stderr: `${"e".repeat(30_000)}\nError: the real reason\n`,
      exitCode: 1,
    });

    const result: KubectlExecResult = await run(settings(), request());

    assert.match(
      result.output,
      /\[stderr\]\n\.\.\. \[earlier stderr truncated\]/,
    );
    assert.match(result.output, /Error: the real reason\n$/);
    assert.match(result.output, /stderr follows/);
    assert.strictEqual(
      result.errorMessage,
      "Exit code 1: Error: the real reason",
    );
    const stderrSection: string = result.output.split("[stderr]\n")[1]!;
    assert.ok(Buffer.byteLength(stderrSection) <= STDERR_MAX_BYTES + 40);
  });

  test("NUL characters are replaced, in stdout and stderr", async () => {
    kubectl.setBehaviour({
      stdout: "a\u0000b",
      stderr: "c\u0000d",
      exitCode: 1,
    });

    const result: KubectlExecResult = await run(settings(), request());

    assert.ok(!result.output.includes("\u0000"));
    assert.ok(result.output.includes(`a${KUBECTL_NUL_REPLACEMENT}b`));
    assert.ok(result.output.includes(`c${KUBECTL_NUL_REPLACEMENT}d`));
  });

  test("the maxOutputBytes setting bounds the output", async () => {
    kubectl.setBehaviour({ stdoutBytes: 5_000 });

    const result: KubectlExecResult = await run(
      settings({ maxOutputBytes: 1_000 }),
      request(),
    );

    assert.ok(Buffer.byteLength(result.output) < 1_200);
  });
});

describe("refusals before anything spawns", () => {
  async function expectRefused(
    executorSettings: KubectlExecutorSettings,
    commandRequest: KubectlCommandRequest,
    pattern: RegExp,
  ): Promise<string> {
    const executor: KubectlExecutor = new KubectlExecutor(executorSettings);
    const prepared: PreparedKubectlCommand = executor.prepare(commandRequest);

    assert.notStrictEqual(prepared.refusal, null, "refused");
    assert.match(prepared.refusal!, pattern);
    assert.match(prepared.refusal!, /^Refused by the Kubernetes AI agent/);

    const result: KubectlExecResult = await executor.execute(commandRequest);

    assert.deepStrictEqual(result, {
      success: false,
      output: "",
      errorMessage: prepared.refusal,
    });
    assert.strictEqual(
      kubectl.getCommandInvocations().length,
      0,
      "kubectl never ran",
    );
    assert.strictEqual(executor.getActiveJobDirs().length, 0);
    return prepared.refusal!;
  }

  test("a job without an argv", async () => {
    for (const payload of [
      {},
      { args: [] },
      { args: "get pods" },
      { args: ["get", 7] },
    ]) {
      await expectRefused(
        settings(),
        request({ payload: { ...payload, clusterIdentifier: "prod-us" } }),
        /without a kubectl command/,
      );
    }
  });

  test("the argv guard: file-backed output, credential and cluster flags", async () => {
    for (const args of [
      ["get", "pods", "--kubeconfig=/etc/other"],
      [
        "get",
        "pods",
        "-o",
        "jsonpath-file=/var/run/secrets/kubernetes.io/serviceaccount/token",
      ],
      ["get", "pods", "--token=abc"],
      ["get", "pods", "--server=https://evil.example.com"],
      ["get", "pods", "--as=system:admin"],
      ["get", "pods", "-v=9"],
    ]) {
      await expectRefused(settings(), request({ args }), /./);
    }
  });

  test("a command the policy denies", async () => {
    await expectRefused(
      settings({ allowWrites: true }),
      request({
        args: ["exec", "-it", "web-1", "--", "sh"],
        origin: "AiRemediation",
      }),
      /kubectl exec is not allowed/,
    );
    await expectRefused(
      settings(),
      request({ args: ["get", "secrets", "-n", "web"] }),
      /Secret/,
    );
  });

  test("an investigation may only read", async () => {
    await expectRefused(
      settings({ allowWrites: true }),
      request({
        args: ["delete", "pod", "web-1", "-n", "web"],
        origin: "AiInvestigation",
      }),
      /an investigation may only run read-only kubectl, and "kubectl delete pod web-1 -n web" is SafeWrite/,
    );
  });

  test("a write on a read-only agent names the chart value that allows it", async () => {
    const refusal: string = await expectRefused(
      settings({ allowWrites: false }),
      request({
        args: ["rollout", "restart", "deployment/web", "-n", "web"],
        origin: "AiRemediation",
      }),
      /installed read-only \(ONEUPTIME_KUBECTL_ALLOW_WRITES is not set\)/,
    );
    assert.match(refusal, /--set aiAgent\.fixes=ask-for-approval/);
    assert.ok(!refusal.includes("remediation.enabled"), refusal);

    await expectRefused(
      settings({ allowWrites: false, allowWritesSetting: "yes" }),
      request({
        args: ["rollout", "restart", "deployment/web", "-n", "web"],
        origin: "AiRemediation",
      }),
      /ONEUPTIME_KUBECTL_ALLOW_WRITES="yes"/,
    );
  });

  test("a write outside the allowed namespaces, in the agent's own words", async () => {
    const refusal: string = await expectRefused(
      settings({ allowWrites: true, writeNamespaces: ["web"] }),
      request({
        args: ["delete", "pod", "api-1", "-n", "api"],
        origin: "AiRemediation",
      }),
      /outside the namespaces this agent lets OneUptime AI change/,
    );

    assert.ok(!refusal.includes("Runner"), refusal);
    assert.ok(refusal.includes("aiAgent.remediation.namespaces"), refusal);
    assert.ok(refusal.includes("ONEUPTIME_AI_AGENT_POD_NAMESPACE"), refusal);
  });

  test("a write into the agent's own namespace, named or implied", async () => {
    await expectRefused(
      settings({ allowWrites: true, allowNodeOperations: true }),
      request({
        args: ["delete", "pod", "x", "-n", "oneuptime-agent"],
        origin: "AiRemediation",
      }),
      /the namespace this agent itself runs in/,
    );
    await expectRefused(
      settings({ allowWrites: true, allowNodeOperations: true }),
      request({ args: ["delete", "pod", "x"], origin: "AiRemediation" }),
      /names no namespace, so kubectl would run it in "oneuptime-agent"/,
    );
  });

  test("a node operation with node operations off names aiAgent.remediation.nodeOperations", async () => {
    for (const args of [
      ["cordon", "node-1"],
      ["drain", "node-1"],
    ]) {
      await expectRefused(
        settings({ allowWrites: true, allowNodeOperations: false }),
        request({ args, origin: "AiRemediation" }),
        /node operations are off for this agent \(ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS is not set\)\. To allow them, upgrade the Kubernetes agent chart with --set aiAgent\.remediation\.nodeOperations=true/,
      );
    }
  });

  test("a job for another cluster, or naming none", async () => {
    await expectRefused(
      settings(),
      request({ clusterIdentifier: "staging-eu" }),
      /this command is for cluster "staging-eu", but this agent serves cluster "prod-us"/,
    );
    await expectRefused(
      settings(),
      request({ clusterIdentifier: "" }),
      /cluster "\(not specified\)"/,
    );
    await expectRefused(
      settings({ clusterName: "" }),
      request(),
      /this agent serves cluster "\(not specified\)"/,
    );
  });

  test("the cluster name matches case-insensitively, under any spelling of the key", async () => {
    for (const payload of [
      { clusterIdentifier: "PROD-US" },
      { kubernetesClusterIdentifier: "prod-us" },
      { clusterName: " prod-us " },
    ]) {
      kubectl.clearInvocations();
      const result: KubectlExecResult = await run(
        settings(),
        request({
          payload: { args: ["get", "pods", "-n", "web"], ...payload },
        }),
      );
      assert.strictEqual(result.success, true, JSON.stringify(payload));
    }

    assert.strictEqual(
      getPayloadClusterIdentifier({ clusterIdentifier: 5 }),
      "",
    );
  });

  test("not in a pod: no API server address", async () => {
    await expectRefused(
      settings({ env: { PATH: kubectl.getPath() } }),
      request(),
      /KUBERNETES_SERVICE_HOST \/ KUBERNETES_SERVICE_PORT are not set/,
    );
    await expectRefused(
      settings({
        env: { PATH: kubectl.getPath(), KUBERNETES_SERVICE_HOST: "10.96.0.1" },
      }),
      request(),
      /KUBERNETES_SERVICE_PORT are not set/,
    );
  });

  test("the ServiceAccount token or CA is not mounted", async () => {
    const missing: string = path.join(tmpDir, "missing");

    await expectRefused(
      settings({
        serviceAccount: {
          ...serviceAccount.paths(),
          token: `${missing}/token`,
        },
      }),
      request(),
      /token is not mounted in this pod.*automountServiceAccountToken/,
    );
    await expectRefused(
      settings({
        serviceAccount: { ...serviceAccount.paths(), ca: `${missing}/ca.crt` },
      }),
      request(),
      /ca\.crt is not mounted in this pod/,
    );
    // A directory where the token should be is not a token.
    await expectRefused(
      settings({
        serviceAccount: { ...serviceAccount.paths(), token: tmpDir },
      }),
      request(),
      /is not mounted in this pod/,
    );
  });

  test("a command that passes every check is prepared with its tier", () => {
    const prepared: PreparedKubectlCommand = new KubectlExecutor(
      settings({ allowWrites: true }),
    ).prepare(
      request({
        args: ["rollout", "restart", "deployment/web", "-n", "web"],
        origin: "AiRemediation",
      }),
    );

    assert.strictEqual(prepared.refusal, null);
    if (prepared.refusal === null) {
      assert.strictEqual(prepared.tier, KubectlCommandTier.SafeWrite);
      assert.strictEqual(
        prepared.displayCommand,
        "kubectl rollout restart deployment/web -n web",
      );
    }
  });

  test("a scoped write inside the allowed namespaces runs", async () => {
    const result: KubectlExecResult = await run(
      settings({ allowWrites: true, writeNamespaces: ["web"] }),
      request({
        args: ["rollout", "restart", "deployment/web", "-n", "web"],
        origin: "AiRemediation",
      }),
    );

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(onlyInvocation().argv.slice(3), [
      "rollout",
      "restart",
      "deployment/web",
      "-n",
      "web",
    ]);
  });
});

describe("job directories", () => {
  test("the start-up sweep removes what a previous life left behind", () => {
    const executor: KubectlExecutor = new KubectlExecutor(settings());
    const parent: string = executor.getJobDirParent();

    fs.mkdirSync(path.join(parent, "job-abandoned", "home"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(parent, "job-abandoned", "config"), "stale");

    assert.strictEqual(executor.sweepOrphanedJobDirs(), 1);
    assert.deepStrictEqual(fs.readdirSync(parent), []);
    assert.strictEqual(executor.removeAllJobDirs(), 0);
  });

  test("sweeping a parent that does not exist yet is a no-op", () => {
    const executor: KubectlExecutor = new KubectlExecutor(
      settings({ tmpDir: path.join(tmpDir, "never-created") }),
    );

    assert.strictEqual(executor.sweepOrphanedJobDirs(), 0);
  });

  test("shutdown removes the directory of a command still running", async () => {
    kubectl.setBehaviour({ sleepMs: 1_000 });
    const executor: KubectlExecutor = new KubectlExecutor(settings());
    const running: Promise<KubectlExecResult> = executor.execute(request());

    const deadline: number = Date.now() + 5_000;
    while (executor.getActiveJobDirs().length === 0 && Date.now() < deadline) {
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 10);
      });
    }

    const [dir] = executor.getActiveJobDirs();
    assert.ok(dir);
    assert.strictEqual(executor.removeAllJobDirs(), 1);
    assert.strictEqual(fs.existsSync(dir), false);

    await running;
  });

  test("a parent directory with loose permissions is made private", async () => {
    const executor: KubectlExecutor = new KubectlExecutor(settings());
    const parent: string = executor.getJobDirParent();

    fs.mkdirSync(parent, { recursive: true });
    fs.chmodSync(parent, 0o777);

    await executor.execute(request());

    assert.strictEqual(fs.statSync(parent).mode & 0o777, 0o700);
  });

  test("a file where the parent directory should be is refused", async () => {
    const blocked: string = makeTempDir("agent-blocked-");
    fs.writeFileSync(path.join(blocked, "oneuptime-kubectl"), "not a dir");

    const result: KubectlExecResult = await run(
      settings({ tmpDir: blocked }),
      request(),
    );

    assert.strictEqual(result.success, false);
    assert.match(result.errorMessage!, /Could not prepare the kubeconfig/);
    assert.strictEqual(kubectl.getCommandInvocations().length, 0);
    fs.rmSync(blocked, { recursive: true, force: true });
  });
});

describe("pure helpers", () => {
  test("the request timeout leaves headroom inside the budget", () => {
    assert.strictEqual(getRequestTimeoutMs(30_000), 24_000);
    assert.strictEqual(getRequestTimeoutMs(120_000), 96_000);
    assert.strictEqual(getRequestTimeoutMs(1_000), 500);
    assert.strictEqual(getRequestTimeoutMs(0), 100);
    assert.strictEqual(formatRequestTimeout(24_000), "24s");
    assert.strictEqual(formatRequestTimeout(2_500), "2s");
    assert.strictEqual(formatRequestTimeout(500), "500ms");
  });

  test("formatKubectlOutput sections and markers", () => {
    assert.strictEqual(formatKubectlOutput({ stdout: "", stderr: "" }), "");
    assert.strictEqual(
      formatKubectlOutput({ stdout: "out", stderr: "err" }),
      "[stdout]\nout\n[stderr]\nerr",
    );
    assert.strictEqual(
      formatKubectlOutput({ stdout: "out", stderr: "", stdoutTruncated: true }),
      "[stdout]\nout\n... [output truncated: stdout cut at 3 bytes]",
    );
    assert.strictEqual(
      formatKubectlOutput({ stdout: "", stderr: "err", stderrTruncated: true }),
      "[stderr]\n... [earlier stderr truncated]\nerr",
    );
  });

  test("lastStderrLine takes the last non-empty line, capped", () => {
    assert.strictEqual(lastStderrLine("a\n\nb\n  \n"), "b");
    assert.strictEqual(lastStderrLine(""), "");
    assert.strictEqual(lastStderrLine("x".repeat(600)).length, 503);
  });

  test("replaceNulCharacters", () => {
    assert.strictEqual(replaceNulCharacters("a\u0000b\u0000"), "a�b�");
  });

  test("rewordScopeRefusalForAgent speaks for the agent and its chart values", () => {
    assert.strictEqual(
      rewordScopeRefusalForAgent(
        'This Runner only lets OneUptime AI change "web" (ONEUPTIME_KUBECTL_WRITE_NAMESPACES, from aiAccess.remediation.namespaces). It never changes its own namespace "x" (ONEUPTIME_RUNNER_POD_NAMESPACE); this Runner refuses.',
      ),
      'This agent only lets OneUptime AI change "web" (ONEUPTIME_KUBECTL_WRITE_NAMESPACES, from aiAgent.remediation.namespaces). It never changes its own namespace "x" (ONEUPTIME_AI_AGENT_POD_NAMESPACE); this agent refuses.',
    );
  });

  test("buildSpawnEnv falls back to a standard PATH", () => {
    assert.deepStrictEqual(
      KubectlExecutor.buildSpawnEnv({
        path: undefined,
        homeDir: "/j/home",
        cacheDir: "/j/cache",
        kubeconfigPath: "/j/config",
      }),
      {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        HOME: "/j/home",
        KUBECACHEDIR: "/j/cache",
        KUBERC: "off",
        KUBECTL_KUBERC: "false",
        KUBECONFIG: "/j/config",
      },
    );
  });

  test("describeKill", () => {
    assert.strictEqual(
      KubectlExecutor.describeKill({ timeoutInMs: 5, producedOutput: true }),
      "Killed (timeout 5ms)",
    );
    assert.match(
      KubectlExecutor.describeKill({ timeoutInMs: 5, producedOutput: false }),
      /network policies/,
    );
  });
});
