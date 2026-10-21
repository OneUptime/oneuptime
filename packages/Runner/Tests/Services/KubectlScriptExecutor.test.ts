import KubectlScriptExecutor from "../../Services/KubectlScriptExecutor";
import KubectlExecutor from "../../Services/KubectlExecutor";
import { BashRunResult } from "../../Utils/RunBash";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * ---------------------------------------------------------------------------
 * A kubectl step: the runbook author's bash script of kubectl commands, run
 * on the Runner with KUBECONFIG pointing at the cluster.
 *
 * kubectl here is a stand-in on PATH that prints how it was called and what
 * KUBECONFIG it was given - its path, the file's and directory's modes and
 * the file's first line - so these show what the step really runs with:
 *
 *   - the script runs with bash, kubectl and all, as written;
 *   - the kubeconfig the server sent is in a private file (0600) in a
 *     private directory (0700) of its own, under the directory every
 *     kubeconfig of this Runner is written to (and swept from), and is gone
 *     when the script ends - however it ends;
 *   - with no kubeconfig, kubectl uses the Runner's own access: KUBECONFIG
 *     is what the Runner had, and nothing is written;
 *   - a failing script fails the step with its exit code, and one that runs
 *     too long is killed.
 * ---------------------------------------------------------------------------
 */

const KUBECONFIG_TEXT: string = [
  "apiVersion: v1",
  "kind: Config",
  "clusters:",
  "- name: prod",
  "  cluster:",
  "    server: https://prod.example.com:6443",
].join("\n");

let workDir: string;
let fakeBinDir: string;
let previousTmpDir: string | undefined;

function environment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PATH: `${fakeBinDir}:${process.env["PATH"] || "/usr/bin:/bin"}`,
    HOME: workDir,
    ...extra,
  };
}

// Every kubeconfig directory left under the Runner's kubeconfig parent.
function kubeconfigDirsLeft(): Array<string> {
  const parent: string = KubectlExecutor.getKubeconfigParentDir();

  if (!fs.existsSync(parent)) {
    return [];
  }

  return fs.readdirSync(parent);
}

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "kubectl-script-test-"));
  fakeBinDir = path.join(workDir, "bin");
  fs.mkdirSync(fakeBinDir);

  fs.writeFileSync(
    path.join(fakeBinDir, "kubectl"),
    [
      "#!/usr/bin/env bash",
      'echo "kubectl $*"',
      'echo "KUBECONFIG=${KUBECONFIG:-<none>}"',
      'if [ -n "${KUBECONFIG:-}" ] && [ -f "$KUBECONFIG" ]; then',
      '  echo "file mode $(stat -c %a "$KUBECONFIG")"',
      '  echo "dir mode $(stat -c %a "$(dirname "$KUBECONFIG")")"',
      '  echo "first line $(head -n 1 "$KUBECONFIG")"',
      "fi",
      'if [ "${1:-}" = "fail" ]; then echo "error: the server could not find the requested resource" >&2; exit 1; fi',
    ].join("\n"),
    { mode: 0o755 },
  );

  // The Runner's kubeconfig directories go under this suite's own TMPDIR.
  previousTmpDir = process.env["TMPDIR"];
  process.env["TMPDIR"] = path.join(workDir, "tmp");
  fs.mkdirSync(process.env["TMPDIR"]);
});

afterAll(() => {
  if (previousTmpDir === undefined) {
    delete process.env["TMPDIR"];
  } else {
    process.env["TMPDIR"] = previousTmpDir;
  }

  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("a kubectl step with a kubeconfig", () => {
  test("runs the script with KUBECONFIG at a private copy of it", async () => {
    const result: BashRunResult = await KubectlScriptExecutor.execute({
      script: "kubectl get pods --namespace web\necho done",
      kubeconfig: KUBECONFIG_TEXT,
      timeoutInMs: 20_000,
      environment: environment(),
    });

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);

    const lines: Array<string> = result.output.split("\n");
    expect(lines[0]).toBe("[stdout]");
    expect(lines[1]).toBe("kubectl get pods --namespace web");

    const kubeconfigLine: string = lines[2]!;
    const kubeconfigPath: string = kubeconfigLine.slice("KUBECONFIG=".length);
    expect(
      kubeconfigPath.startsWith(
        `${KubectlExecutor.getKubeconfigParentDir()}${path.sep}`,
      ),
    ).toBe(true);
    expect(lines[3]).toBe("file mode 600");
    expect(lines[4]).toBe("dir mode 700");
    expect(lines[5]).toBe("first line apiVersion: v1");
    expect(lines[6]).toBe("done");

    // Gone once the script ended.
    expect(fs.existsSync(kubeconfigPath)).toBe(false);
    expect(kubeconfigDirsLeft()).toEqual([]);
  });

  test("a failing script fails the step with its exit code, and the kubeconfig is still removed", async () => {
    const result: BashRunResult = await KubectlScriptExecutor.execute({
      script: "echo checking\nkubectl fail",
      kubeconfig: KUBECONFIG_TEXT,
      timeoutInMs: 20_000,
      environment: environment(),
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toBe("Exit code 1");
    expect(result.output.startsWith("[stdout]\nchecking\nkubectl fail\n")).toBe(
      true,
    );
    expect(result.output).toContain(
      "[stderr]\nerror: the server could not find the requested resource",
    );
    expect(kubeconfigDirsLeft()).toEqual([]);
  });

  test("a script that runs too long is killed, and the kubeconfig is still removed", async () => {
    const result: BashRunResult = await KubectlScriptExecutor.execute({
      script: "kubectl wait --for=condition=ready pod/api\nsleep 30",
      kubeconfig: KUBECONFIG_TEXT,
      timeoutInMs: 300,
      environment: environment(),
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe("Killed (timeout 300ms)");
    expect(kubeconfigDirsLeft()).toEqual([]);
  });
});

describe("a kubectl step with no kubeconfig", () => {
  test("uses the Runner's own access: its KUBECONFIG, and nothing is written", async () => {
    const result: BashRunResult = await KubectlScriptExecutor.execute({
      script: "kubectl version --client",
      kubeconfig: "",
      timeoutInMs: 20_000,
      environment: environment({ KUBECONFIG: "/home/runner/.kube/config" }),
    });

    expect(result).toEqual({
      success: true,
      output:
        "[stdout]\nkubectl version --client\nKUBECONFIG=/home/runner/.kube/config\n",
      exitCode: 0,
    });
    expect(kubeconfigDirsLeft()).toEqual([]);
  });

  test("and none when the Runner has none: kubectl's own default, or its service account in a cluster", async () => {
    const result: BashRunResult = await KubectlScriptExecutor.execute({
      script: "kubectl get nodes",
      timeoutInMs: 20_000,
      environment: environment(),
    });

    expect(result.output).toBe(
      "[stdout]\nkubectl get nodes\nKUBECONFIG=<none>\n",
    );
  });
});

describe("what a kubectl step is handed beside its script", () => {
  test("the run's inputs are in its environment, as a Bash step's are", async () => {
    const result: BashRunResult = await KubectlScriptExecutor.execute({
      script: 'kubectl rollout restart "deployment/$ONEUPTIME_INPUT_SERVICE"',
      timeoutInMs: 20_000,
      environment: environment({ ONEUPTIME_INPUT_SERVICE: "checkout-api" }),
    });

    expect(result.output).toContain(
      "kubectl rollout restart deployment/checkout-api",
    );
  });

  test("an empty script is refused before anything runs", async () => {
    const result: BashRunResult = await KubectlScriptExecutor.execute({
      script: "  \n ",
      kubeconfig: KUBECONFIG_TEXT,
      timeoutInMs: 20_000,
      environment: environment(),
    });

    expect(result).toEqual({
      success: false,
      output: "",
      errorMessage: "kubectl step has no script to run.",
    });
    expect(kubeconfigDirsLeft()).toEqual([]);
  });
});
