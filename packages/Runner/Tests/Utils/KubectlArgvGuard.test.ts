/*
 * ---------------------------------------------------------------------------
 * KubectlArgvGuard is the Runner's own last look at a kubectl argv, kept
 * deliberately independent of the shared KubectlPolicy. These tests pin two
 * things: every shape of the flags it must refuse (long, short, combined
 * short clusters, inline values, values in the next token, spelled after
 * `--`), and the everyday argv it must NOT refuse — a guard that rejects
 * `kubectl get pods -n web -o wide` is a guard someone will turn off.
 * ---------------------------------------------------------------------------
 */

import KubectlArgvGuard from "../../Utils/KubectlArgvGuard";
import KubectlPolicy, {
  KubectlPolicyResult,
} from "Common/Utils/AiRemediation/KubectlPolicy";
import { KubectlCommandTier } from "Common/Types/Kubernetes/KubernetesClusterAiAccess";

function refusal(args: Array<string>): string | null {
  return KubectlArgvGuard.getRefusalReason(args);
}

describe("KubectlArgvGuard: file-backed output formats", () => {
  /*
   * The exfiltration from the review: kubectl reads the named path as the
   * template and echoes everything outside `{...}` verbatim, so pointing
   * a *-file format at the ServiceAccount token prints the token into the
   * output the Runner ships back — from a Read-tier `get`.
   */
  test.each([
    [
      "-o jsonpath-file as two tokens",
      [
        "get",
        "ns",
        "-o",
        "jsonpath-file=/var/run/secrets/kubernetes.io/serviceaccount/token",
      ],
    ],
    [
      "-ojsonpath-file inline",
      [
        "get",
        "ns",
        "-ojsonpath-file=/var/run/secrets/kubernetes.io/serviceaccount/token",
      ],
    ],
    [
      "-o=jsonpath-file with equals",
      ["get", "ns", "-o=jsonpath-file=/etc/passwd"],
    ],
    [
      "--output=go-template-file",
      ["get", "pods", "--output=go-template-file=/etc/passwd"],
    ],
    [
      "--output go-template-file as two tokens",
      ["get", "pods", "--output", "go-template-file=/etc/passwd"],
    ],
    [
      "--output=custom-columns-file",
      ["get", "pods", "--output=custom-columns-file=/etc/hostname"],
    ],
    ["-o custom-columns-file", ["get", "pods", "-o", "custom-columns-file=/x"]],
    /*
     * kubectl's legacy alias for go-template-file has no dash in it, so a
     * guard that only looked for "-file" let it read the file anyway.
     */
    [
      "-o templatefile (the legacy alias)",
      ["get", "pods", "-o", "templatefile=/x"],
    ],
    ["-otemplatefile inline", ["get", "pods", "-otemplatefile=/x"]],
    ["--output=templatefile", ["get", "pods", "--output=templatefile=/x"]],
    [
      "--output templatefile as two tokens",
      ["get", "pods", "--output", "templatefile=/x"],
    ],
    [
      "a file format with no path yet (kubectl would still open it)",
      ["get", "pods", "-o", "jsonpath-file"],
    ],
    ["upper-cased format name", ["get", "pods", "-o", "JSONPATH-FILE=/x"]],
    [
      "the format after other flags",
      ["get", "pods", "-n", "web", "-l", "app=web", "-o", "jsonpath-file=/x"],
    ],
    [
      "the format inside a short cluster after a boolean flag",
      ["get", "pods", "-Aojsonpath-file=/x"],
    ],
  ])("refuses %s", (_label: string, args: Array<string>) => {
    const reason: string | null = refusal(args);

    expect(reason).not.toBeNull();
    expect(reason).toContain("reads a template file");
  });

  test.each([
    ["--template=/path", ["get", "pods", "-o", "go-template", "--template=/x"]],
    ["--template as two tokens", ["get", "pods", "--template", "/x"]],
    ["bare --template", ["get", "pods", "--template"]],
  ])("refuses %s", (_label: string, args: Array<string>) => {
    const reason: string | null = refusal(args);

    expect(reason).not.toBeNull();
    expect(reason).toContain("--template");
  });

  test.each([
    ["-o wide", ["get", "pods", "-o", "wide"]],
    ["-o json", ["get", "pods", "-o", "json"]],
    ["-ojson inline", ["get", "pods", "-ojson"]],
    ["-o=yaml", ["get", "pods", "-o=yaml"]],
    ["-o name", ["get", "pods", "-o", "name"]],
    ["--output=wide", ["get", "pods", "--output=wide"]],
    ["--output yaml", ["get", "pods", "--output", "yaml"]],
    [
      "inline jsonpath",
      ["get", "pods", "-o", "jsonpath={.items[*].metadata.name}"],
    ],
    [
      "inline custom-columns",
      [
        "get",
        "pods",
        "-o",
        "custom-columns=NAME:.metadata.name,STATUS:.status.phase",
      ],
    ],
    [
      "inline go-template",
      [
        "get",
        "pods",
        "-o",
        "go-template={{range .items}}{{.metadata.name}}{{end}}",
      ],
    ],
    ["jsonpath-as-json", ["get", "pods", "-o", "jsonpath-as-json={.items}"]],
    /*
     * Only the FORMAT is inspected: a template that merely mentions a file
     * in a field path or a column name is inline, and inline is fine.
     */
    [
      "an inline jsonpath whose path mentions a file",
      ["get", "pods", "-o", "jsonpath={.metadata.annotations.config-file}"],
    ],
    [
      "custom-columns with a column named FILE",
      ["get", "pods", "-o", "custom-columns=FILE:.metadata.name"],
    ],
    [
      "a go-template that prints a key named templatefile",
      ["get", "cm", "app", "-o", "go-template={{.data.templatefile}}"],
    ],
  ])("allows %s", (_label: string, args: Array<string>) => {
    expect(refusal(args)).toBeNull();
  });
});

describe("KubectlArgvGuard: credential, cluster, identity and file flags", () => {
  test.each([
    "kubeconfig",
    "kuberc",
    "token",
    "server",
    "as",
    "as-group",
    "as-uid",
    "context",
    "cluster",
    "user",
    "username",
    "password",
    "client-certificate",
    "client-key",
    "certificate-authority",
    "insecure-skip-tls-verify",
    "tls-server-name",
    "raw",
    "filename",
    "kustomize",
    "recursive",
    "patch-file",
    "from-file",
    "from-env-file",
    "cert",
    "key",
    "cache-dir",
    "profile",
    "profile-output",
    "log-file",
    "log-dir",
    "v",
    "vmodule",
  ])(
    "refuses --%s bare, with =value and with a value token",
    (flag: string) => {
      for (const args of [
        ["get", "pods", `--${flag}`],
        ["get", "pods", `--${flag}=x`],
        ["get", "pods", `--${flag}`, "x"],
        [`--${flag}=x`, "get", "pods"],
      ]) {
        const reason: string | null = refusal(args);

        expect(reason).not.toBeNull();
        expect(reason).toContain(`--${flag}`);
      }
    },
  );

  test("refuses any --as-* impersonation flag, including ones kubectl may add later", () => {
    expect(refusal(["get", "pods", "--as-something-new=x"])).not.toBeNull();
  });

  test("matches long flag names case-insensitively (stricter than kubectl, never looser)", () => {
    expect(refusal(["get", "pods", "--KubeConfig=/x"])).not.toBeNull();
    expect(refusal(["get", "pods", "--Server", "https://evil"])).not.toBeNull();
  });

  test.each(["s", "f", "k", "R", "v"])(
    "refuses -%s bare, inline and with =value",
    (flag: string) => {
      for (const args of [
        ["get", "pods", `-${flag}`],
        ["get", "pods", `-${flag}`, "x"],
        ["get", "pods", `-${flag}x`],
        ["get", "pods", `-${flag}=x`],
      ]) {
        const reason: string | null = refusal(args);

        expect(reason).not.toBeNull();
        expect(reason).toContain(`-${flag}`);
      }
    },
  );

  /*
   * pflag walks a short cluster one character at a time, so `-Rf` is
   * --recursive plus --filename and `-pf` on logs is --previous plus
   * --follow. A guard that only looked at the first character would miss
   * the denied flag hiding behind a boolean one.
   */
  test.each([
    ["-Rf", ["apply", "-Rf", "/etc"]],
    ["-Af", ["get", "pods", "-Af", "/x"]],
    ["-pf", ["logs", "web-0", "-pf"]],
    ["-wf", ["get", "pods", "-wf", "/x"]],
    ["-As", ["get", "pods", "-As", "https://evil"]],
    ["-Av9", ["get", "pods", "-Av9"]],
    ["-AR", ["get", "pods", "-AR"]],
    ["-xk", ["get", "pods", "-xk", "/x"]],
  ])(
    "refuses the denied flag inside the cluster %s",
    (_label: string, args: Array<string>) => {
      expect(refusal(args)).not.toBeNull();
    },
  );

  /*
   * An inline value is a value: `-nfoo` is namespace "foo", and the "f"
   * inside it must not read as --filename, or every `-nweb` style argv the
   * model writes would be refused.
   */
  test.each([
    ["-nfs (namespace fs)", ["get", "pods", "-nfs"]],
    ["-n fs", ["get", "pods", "-n", "fs"]],
    ["-lapp=fs", ["get", "pods", "-lapp=fs"]],
    ["-l app=svc", ["get", "pods", "-l", "app=svc"]],
    ["-cfoo (container foo)", ["logs", "web-0", "-cfoo"]],
    ["-Lsomething (label column)", ["get", "pods", "-Lsomething"]],
    ["-n=web", ["get", "pods", "-n=web"]],
    ["-A alone", ["get", "pods", "-A"]],
    ["-w alone", ["get", "pods", "-w"]],
    ["-p on logs", ["logs", "web-0", "-p"]],
    ["-h", ["get", "-h"]],
  ])("allows %s", (_label: string, args: Array<string>) => {
    expect(refusal(args)).toBeNull();
  });

  test("scans after the -- separator too (stricter than kubectl)", () => {
    expect(refusal(["get", "pods", "--", "--kubeconfig=/x"])).not.toBeNull();
    expect(refusal(["get", "pods", "--", "-f", "/x"])).not.toBeNull();
  });

  test("a bare -- separator and a lone - are not flags", () => {
    expect(refusal(["get", "pods", "--"])).toBeNull();
    expect(refusal(["get", "pods", "-"])).toBeNull();
  });
});

describe("KubectlArgvGuard: values that merely look like flags", () => {
  test.each([
    ["--tail -1", ["logs", "web-0", "--tail", "-1"]],
    ["--tail=-1", ["logs", "web-0", "--tail=-1"]],
    ["--since -5s", ["logs", "web-0", "--since", "-5s"]],
    [
      "a negative number positional",
      ["scale", "deploy/web", "--replicas", "-0"],
    ],
  ])(
    "allows negative numbers and durations: %s",
    (_label: string, args: Array<string>) => {
      expect(refusal(args)).toBeNull();
    },
  );

  test("a positional containing a denied flag name is not a flag", () => {
    expect(
      refusal(["label", "pod", "web-0", "note=--kubeconfig", "--overwrite"]),
    ).toBeNull();
    expect(refusal(["get", "pods", "-l", "app=-f"])).toBeNull();
    expect(
      refusal(["get", "pods", "--field-selector=status.phase!=-s"]),
    ).toBeNull();
  });
});

describe("KubectlArgvGuard: everyday argv is untouched", () => {
  test.each([
    ["get pods", ["get", "pods", "-n", "web"]],
    ["get pods wide", ["get", "pods", "-n", "web", "-o", "wide"]],
    ["get all namespaces", ["get", "pods", "-A"]],
    ["describe", ["describe", "deployment", "web", "-n", "web"]],
    [
      "logs",
      ["logs", "web-0", "-n", "web", "--tail=200", "--since=10m", "-c", "app"],
    ],
    ["events", ["get", "events", "-n", "web", "--sort-by=.lastTimestamp"]],
    ["top", ["top", "pods", "-n", "web", "--containers"]],
    ["rollout status", ["rollout", "status", "deployment/web", "-n", "web"]],
    ["rollout restart", ["rollout", "restart", "deployment/web", "-n", "web"]],
    [
      "rollout undo",
      ["rollout", "undo", "deployment/web", "-n", "web", "--to-revision=3"],
    ],
    ["scale", ["scale", "deployment/web", "-n", "web", "--replicas=3"]],
    [
      "delete pod",
      ["delete", "pod", "web-0", "-n", "web", "--grace-period=30"],
    ],
    ["cordon", ["cordon", "node-1"]],
    [
      "label",
      ["label", "pod", "web-0", "-n", "web", "tier=backend", "--overwrite"],
    ],
    ["annotate", ["annotate", "deployment", "web", "-n", "web", "note=x"]],
    [
      "patch",
      [
        "patch",
        "deployment",
        "web",
        "-n",
        "web",
        "-p",
        '{"spec":{"replicas":2}}',
      ],
    ],
    ["set image", ["set", "image", "deployment/web", "web=img:2", "-n", "web"]],
    ["auth can-i", ["auth", "can-i", "list", "pods", "-n", "web"]],
    ["api-resources", ["api-resources", "--namespaced=true"]],
    ["request-timeout", ["get", "pods", "--request-timeout=30s"]],
    ["empty argv", []],
  ])("allows %s", (_label: string, args: Array<string>) => {
    expect(refusal(args)).toBeNull();
  });
});

/*
 * kubectl normalizes "_" to "-" in long flag names (its flag set uses
 * cliflag.WordSepNormalizeFunc), so `--from_file` IS `--from-file`. The
 * guard used to compare the raw name, which made every dashed denied flag
 * one underscore away from passing the Runner's own check — leaving only
 * the shared policy between `create configmap x --from_file=<token path>`
 * and the pod's ServiceAccount token.
 */
describe("KubectlArgvGuard: underscore spellings kubectl reads as dashes", () => {
  // Built from the guard's own list, so a dashed flag added later is covered too.
  const dashedDeniedFlags: Array<string> =
    KubectlArgvGuard.deniedLongFlags.filter((flag: string) => {
      return flag.includes("-");
    });

  test("the list under test is not empty", () => {
    expect(dashedDeniedFlags.length).toBeGreaterThan(10);
    expect(dashedDeniedFlags).toContain("from-file");
    expect(dashedDeniedFlags).toContain("insecure-skip-tls-verify");
  });

  test.each(dashedDeniedFlags)(
    "refuses --%s spelled with underscores, in every value form, naming it as written",
    (flag: string) => {
      const underscored: string = flag.replace(/-/g, "_");

      for (const args of [
        ["get", "pods", `--${underscored}`],
        ["get", "pods", `--${underscored}=x`],
        ["get", "pods", `--${underscored}`, "x"],
        [`--${underscored}=x`, "get", "pods"],
      ]) {
        const reason: string | null = refusal(args);

        expect(reason).not.toBeNull();
        expect(reason).toContain(`--${underscored}`);
      }
    },
  );

  test.each([
    [
      "the ServiceAccount token copied into a ConfigMap",
      [
        "create",
        "configmap",
        "x",
        "--from_file=/var/run/secrets/kubernetes.io/serviceaccount/token",
      ],
    ],
    [
      "--from_file as two tokens",
      ["create", "configmap", "x", "--from_file", "/path"],
    ],
    [
      "--from_env_file",
      ["create", "secret", "generic", "x", "--from_env_file=/etc/env"],
    ],
    ["--patch_file", ["patch", "deploy", "x", "--patch_file=/etc/passwd"]],
    ["--as_group", ["get", "pods", "--as_group=system:masters"]],
    ["--as_group as two tokens", ["get", "pods", "--as_group", "g"]],
    ["--as_uid", ["get", "pods", "--as_uid=0"]],
    ["--As_Group mixed case", ["get", "pods", "--As_Group=x"]],
    ["--as_user_extra", ["get", "pods", "--as_user_extra=scopes=x"]],
    ["--log_dir", ["get", "pods", "--log_dir=/tmp"]],
  ])("refuses %s", (_label: string, args: Array<string>) => {
    expect(refusal(args)).not.toBeNull();
  });

  test("kubectl 1.33+ preference and impersonation flags are refused in both spellings", () => {
    for (const flag of [
      "--kuberc=/tmp/evil",
      "--kuberc",
      "--as-user-extra=reason=x",
      "--as_user_extra=reason=x",
    ]) {
      expect(refusal(["get", "pods", flag])).not.toBeNull();
    }
  });

  /*
   * Negative controls: normalizing must not make the guard refuse the
   * allowed flags the model writes with underscores.
   */
  test.each([
    ["--all_namespaces", ["get", "pods", "--all_namespaces"]],
    [
      "--field_selector",
      ["get", "pods", "--field_selector=status.phase=Pending"],
    ],
    ["--show_labels", ["get", "pods", "--show_labels"]],
    ["--all_containers", ["logs", "web", "--all_containers=true"]],
    ["--since_time", ["logs", "pod/x", "--since_time=2026-01-01T00:00:00Z"]],
    ["--request_timeout", ["get", "pods", "--request_timeout=5s"]],
  ])("still allows %s", (_label: string, args: Array<string>) => {
    expect(refusal(args)).toBeNull();
  });
});

describe("KubectlArgvGuard: the verb, when it is certain", () => {
  test.each([
    [["explain", "pods"], "explain"],
    [["-n", "web", "patch", "deployment", "web"], "patch"],
    [["-nweb", "patch", "deployment", "web"], "patch"],
    [["-n=web", "get", "pods"], "get"],
    [["--namespace", "web", "get", "pods"], "get"],
    [["--namespace=web", "get", "pods"], "get"],
    [["--request-timeout", "5s", "get", "pods"], "get"],
    [["--request_timeout=5s", "get", "pods"], "get"],
    [["--match-server-version", "get", "pods"], "get"],
    // `-n` swallows the next word, whatever it is.
    [["-n", "explain", "get", "pods"], "get"],
  ])("%j runs %s", (args: Array<string>, verb: string) => {
    expect(KubectlArgvGuard.getCertainVerb(args)).toBe(verb);
  });

  test.each([
    [["--overwrite", "explain", "pods"]],
    [["-A", "explain", "pods"]],
    [["--", "explain", "pods"]],
    [["-n", "web"]],
    [[]],
  ])("%j has no certain verb", (args: Array<string>) => {
    expect(KubectlArgvGuard.getCertainVerb(args)).toBeNull();
  });
});

/*
 * The shared policy allows `explain --recursive` (it prints every field of
 * a resource's documentation and reads nothing), but the guard refused
 * --recursive on every verb, so the Runner refused a command the model had
 * been told was Read.
 */
describe("KubectlArgvGuard: explain --recursive", () => {
  test.each([
    ["explain pods --recursive", ["explain", "pods", "--recursive"]],
    [
      "explain deployment.spec --recursive=true",
      ["explain", "deployment.spec", "--recursive=true"],
    ],
    ["--recursive=false", ["explain", "pods", "--recursive=false"]],
    ["after a global -n", ["-n", "web", "explain", "pods", "--recursive"]],
  ])("allows %s", (_label: string, args: Array<string>) => {
    expect(refusal(args)).toBeNull();
  });

  test.each([
    ["on get", ["get", "pods", "--recursive"]],
    ["on apply", ["apply", "--recursive", "-f", "/x"]],
    ["-R on explain (explain has no -R)", ["explain", "pods", "-R"]],
    [
      "when -n swallowed the word explain",
      ["-n", "explain", "get", "pods", "--recursive"],
    ],
    [
      "when the verb is uncertain",
      ["--overwrite", "explain", "pods", "--recursive"],
    ],
    [
      "with a value that is not a boolean",
      ["explain", "pods", "--recursive=/etc"],
    ],
    [
      "with a denied flag beside it",
      ["explain", "pods", "--recursive", "--kubeconfig=/x"],
    ],
  ])("still refuses --recursive %s", (_label: string, args: Array<string>) => {
    expect(refusal(args)).not.toBeNull();
  });
});

/*
 * On `patch`, -p is --patch and takes a value, so pflag reads everything
 * after the `p` of `-p'{"spec":...}'` as the patch. The guard walked it as
 * a cluster of boolean flags and refused a human-approved patch with "the
 * -s flag is not allowed" — a flag the command never had.
 */
describe("KubectlArgvGuard: an inline patch is a value, not a flag cluster", () => {
  test.each([
    [
      "a strategic-merge patch starting with spec",
      ["patch", "deployment", "web", "-n", "web", '-p{"spec":{"replicas":3}}'],
    ],
    [
      "a node patch",
      ["patch", "node", "n1", '-p{"spec":{"unschedulable":true}}'],
    ],
    [
      "a YAML flow patch",
      ["patch", "deployment", "web", "-n", "web", "-pspec: {replicas: 3}"],
    ],
    ["-p=<patch>", ["patch", "deployment", "web", '-p={"spec":{}}']],
    ["the patch value f", ["patch", "deployment", "web", "-pf"]],
    [
      "after a global -n",
      ["-n", "web", "patch", "deployment", "web", '-p{"spec":{}}'],
    ],
  ])("allows %s", (_label: string, args: Array<string>) => {
    expect(refusal(args)).toBeNull();
  });

  test.each([
    ["-pf on logs (--previous plus --follow's -f)", ["logs", "web-0", "-pf"]],
    ["-psf on logs", ["logs", "web-0", "-psf"]],
    ["-Rf on get", ["get", "pods", "-Rf", "/x"]],
    ["-f before the p", ["patch", "deploy", "web", "-fp{}"]],
    [
      "a separate -f after the patch",
      ["patch", "deployment", "web", "-p{}", "-f", "/x"],
    ],
    [
      "a separate --kubeconfig after the patch",
      ["patch", "deployment", "web", "-p{}", "--kubeconfig=/x"],
    ],
    [
      "-pf when the verb is uncertain",
      ["--overwrite", "patch", "deployment", "web", "-pf"],
    ],
    ["-pf on get", ["get", "pods", "-pf"]],
  ])("still refuses %s", (_label: string, args: Array<string>) => {
    expect(refusal(args)).not.toBeNull();
  });
});

/*
 * The two layers must agree on every argv the policy lets through: a
 * command the model was told it may run (and a human may have approved)
 * must never be refused by the guard on the Runner. This table is the
 * check that would have caught both false refusals above, and it catches
 * the next one the first time the policy gains a verb-specific meaning.
 */
describe("KubectlArgvGuard agrees with the shared policy", () => {
  test.each([
    "kubectl get pods -n web",
    "kubectl get pods -nweb -o jsonpath={.items}",
    "kubectl get pods --all_namespaces --show_labels",
    "kubectl explain pods --recursive",
    "kubectl explain deployment.spec --recursive=true",
    "kubectl logs web-0 -n web -p",
    "kubectl logs web-0 -n web --previous --tail=100",
    "kubectl top pods -n web --containers",
    "kubectl -n web rollout restart deployment/web",
    "kubectl rollout restart deployment/web -n web",
    "kubectl scale deployment/web -n web --replicas=3",
    "kubectl label pod web-0 -n web tier=backend --overwrite",
    "kubectl delete pod web-0 -n web",
    "kubectl cordon node-1",
    `kubectl patch deployment web -n web -p'{"spec":{"paused":false}}'`,
    `kubectl patch deployment web -n web -p '{"spec":{"replicas":2}}'`,
    `kubectl patch deployment web -n web --type=merge -p'{"spec":{"replicas":3}}'`,
    `kubectl patch node n1 -p'{"spec":{"unschedulable":true}}'`,
    "kubectl set image deployment/web web=img:2 -n web",
  ])("the guard lets `%s` through", (command: string) => {
    const policy: KubectlPolicyResult = KubectlPolicy.evaluateCommand(command);

    // Precondition: the policy allows it (Read, SafeWrite or RiskyWrite).
    expect(policy.tier).not.toBe(KubectlCommandTier.Denied);
    expect(refusal(policy.args)).toBeNull();
  });

  test.each([
    "kubectl get pods --kubeconfig=/x",
    "kubectl create configmap x --from_file=/etc/passwd",
    "kubectl get pods -o jsonpath-file=/etc/passwd",
  ])("both layers refuse `%s`", (command: string) => {
    const policy: KubectlPolicyResult = KubectlPolicy.evaluateCommand(command);

    expect(policy.tier).toBe(KubectlCommandTier.Denied);
    expect(refusal(policy.args)).not.toBeNull();
  });
});
