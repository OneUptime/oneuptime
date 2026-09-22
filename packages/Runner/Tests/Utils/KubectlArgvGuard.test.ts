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
