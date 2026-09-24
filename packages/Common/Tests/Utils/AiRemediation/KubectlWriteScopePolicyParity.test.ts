/*
 * ---------------------------------------------------------------------------
 * KubectlWriteScope's own tables against the shared KubectlPolicy.
 *
 * The scope reads an argv again (on the Runner before it spawns kubectl,
 * and on the server against the Runner's reported posture), with its own
 * copy of two tables the policy also keeps:
 *
 *   - the arity of every kubectl flag (does it take the next word as its
 *     value?). If the two ever disagree, `label --flag node n1 ...` or
 *     `--flag -n web` reads differently here than in the policy, and a
 *     write can land somewhere the scope did not check;
 *   - which kinds live outside every namespace. A kind the scope wrongly
 *     calls cluster-scoped is judged by nothing but RBAC on an unscoped
 *     Runner, so a namespaced write with no -n could reach the Runner's own
 *     namespace.
 *
 * The policy does not export its tables, so they are held against the
 * policy's own VERDICTS: a probe argv whose parse differs by the flag's
 * arity (or by the kind's scope), evaluated exactly as the executor does.
 * ---------------------------------------------------------------------------
 */

import KubectlWriteScope from "../../../Utils/AiRemediation/KubectlWriteScope";
import KubectlPolicy, {
  KubectlPolicyResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { describe, expect, test } from "@jest/globals";

type Arity = "value" | "none";

function flagToken(name: string): string {
  return name.length === 1 ? `-${name}` : `--${name}`;
}

/*
 * How the POLICY reads a flag, or null when the probe cannot tell. In
 * `kubectl <verb> <object> <flag> -n web`, a flag that takes a value
 * swallows "-n" (and "web" becomes a positional), so the policy reports no
 * namespace; a boolean or optional-value flag leaves "-n web" alone.
 */
function policyArity(data: {
  name: string;
  verb: Array<string>;
}): Arity | null {
  const result: KubectlPolicyResult = KubectlPolicy.evaluateArgs([
    ...data.verb,
    flagToken(data.name),
    "-n",
    "web",
  ]);

  if (result.tier === KubectlCommandTier.Denied) {
    return null;
  }

  return result.namespace === undefined ? "value" : "none";
}

/*
 * The namespace flag itself is what the probe reads, so it cannot probe
 * it; kubectl's -n / --namespace always takes a value.
 */
const NAMESPACE_FLAGS: Array<string> = ["n", "namespace"];

/*
 * Flags the policy refuses in the probe, with the arity kubectl gives them:
 * the output flag (the policy refuses "-n" as an output format before the
 * namespace is reported) and the streaming flags, which the policy only
 * allows as "=false" and so refuses bare.
 */
const REFUSED_BY_THE_PROBE: Record<string, Arity> = {
  o: "value",
  output: "value",
  w: "none",
  watch: "none",
  "watch-only": "none",
  follow: "none",
};

describe("the scope's flag arities match the policy's", () => {
  test("every flag the scope knows is read the same way by the policy", () => {
    const mismatches: Array<string> = [];
    const unobservable: Array<string> = [];

    for (const name of KubectlWriteScope.knownFlagNames) {
      if (NAMESPACE_FLAGS.includes(name)) {
        continue;
      }

      const scope: Arity | null = KubectlWriteScope.getFlagArity(name);
      const policy: Arity | null = policyArity({
        name,
        verb: ["get", "pods"],
      });

      if (policy === null) {
        unobservable.push(name);
        continue;
      }

      if (scope !== policy) {
        mismatches.push(`${name}: scope ${scope}, policy ${policy}`);
      }
    }

    expect(mismatches).toEqual([]);
    /*
     * If this set changes, the policy changed how it treats one of these
     * flags — look at it again rather than widening the list.
     */
    expect(unobservable.sort()).toEqual(
      Object.keys(REFUSED_BY_THE_PROBE).sort(),
    );
  });

  test.each([
    ...NAMESPACE_FLAGS.map((name: string): [string, Arity] => {
      return [name, "value"];
    }),
    ...Object.entries(REFUSED_BY_THE_PROBE),
  ])("the scope reads %s as %s, like kubectl", (name: string, arity: Arity) => {
    expect(KubectlWriteScope.getFlagArity(name)).toBe(arity);
  });

  /*
   * The same letter or name means something else on some verbs (-p is
   * --previous on logs, --containers a boolean on top). Probed on the verb
   * where the override applies, with a positional the verb accepts.
   */
  test.each([
    ["logs", ["logs", "web-1"]],
    ["top", ["top", "pod"]],
    ["explain", ["explain", "pods"]],
  ])(
    "the verb-specific arities on %s match the policy's",
    (verb: string, probe: Array<string>) => {
      const overrides: Array<{ flag: string; arity: Arity }> =
        KubectlWriteScope.verbFlagArityOverrides.filter(
          (override: { verb: string }) => {
            return override.verb === verb;
          },
        );

      expect(overrides.length).toBeGreaterThan(0);

      for (const override of overrides) {
        expect({
          flag: override.flag,
          scope: KubectlWriteScope.getFlagArity(override.flag, verb),
        }).toEqual({
          flag: override.flag,
          scope: policyArity({ name: override.flag, verb: probe }),
        });
      }
    },
  );

  // Negative control: the probe does tell the two arities apart.
  test("the probe itself tells a value flag from a boolean one", () => {
    expect(policyArity({ name: "selector", verb: ["get", "pods"] })).toBe(
      "value",
    );
    expect(policyArity({ name: "show-labels", verb: ["get", "pods"] })).toBe(
      "none",
    );
    expect(policyArity({ name: "cascade", verb: ["get", "pods"] })).toBe(
      "none",
    );
  });

  test("a flag neither table knows has no arity (the scope then refuses)", () => {
    expect(KubectlWriteScope.getFlagArity("brand-new-flag")).toBeNull();
    expect(KubectlWriteScope.getFlagArity("X")).toBeNull();
  });
});

/*
 * Which kinds the policy treats as cluster-scoped, observed through its
 * protected-namespace rule: `annotate <kind> x1 note=y -n kube-system` is
 * marked as changing kube-system only when <kind> is namespaced (kubectl
 * ignores -n for a cluster-scoped object, and so does the policy). A
 * Denied result says nothing about the kind, so it is skipped.
 */
function policySaysClusterScoped(spelling: string): boolean | null {
  const result: KubectlPolicyResult = KubectlPolicy.evaluateArgs([
    "annotate",
    spelling,
    "x1",
    "note=y",
    "-n",
    "kube-system",
  ]);

  if (result.tier === KubectlCommandTier.Denied) {
    return null;
  }

  return result.protectedNamespace === undefined;
}

/*
 * Built-in cluster-scoped kinds the scope knows and the policy does not
 * (yet): upstream Kubernetes serves each of these outside every namespace.
 * The policy treats an unknown kind as namespaced, which only ever makes it
 * stricter (a write "in kube-system" needs a human). When the policy learns
 * one of these, move it out of this list.
 */
const KINDS_ONLY_THE_SCOPE_KNOWS: Array<string> = [
  "componentstatus",
  "volumeattributesclass",
  "ipaddress",
  "servicecidr",
  "clustertrustbundle",
  "deviceclass",
  "resourceslice",
  // Round 4: the rest of upstream's built-in cluster-scoped kinds.
  "storageversionmigration",
  "tokenreview",
  "selfsubjectreview",
  "subjectaccessreview",
  "selfsubjectaccessreview",
  "selfsubjectrulesreview",
  "storageversion",
  "devicetaintrule",
  "resourcepoolstatusrequest",
];

/*
 * Namespaced spellings kubectl accepts (the policy's own alias table has
 * each of them), for the other direction: the scope must never call one of
 * these cluster-scoped.
 */
const NAMESPACED_SPELLINGS: Array<string> = [
  "po",
  "pods",
  "pod",
  "deploy",
  "deployments",
  "sts",
  "statefulsets",
  "ds",
  "daemonsets",
  "rs",
  "replicasets",
  "rc",
  "replicationcontrollers",
  "jobs",
  "cj",
  "cronjobs",
  "hpa",
  "horizontalpodautoscalers",
  "svc",
  "services",
  "ep",
  "endpoints",
  "cm",
  "configmaps",
  "sa",
  "serviceaccounts",
  "ing",
  "ingresses",
  "netpol",
  "networkpolicies",
  "pdb",
  "poddisruptionbudgets",
  "quota",
  "resourcequotas",
  "limits",
  "limitranges",
  "pvc",
  "persistentvolumeclaims",
  "roles",
  "rolebindings",
  "secrets",
];

describe("the scope's cluster-scoped kinds match the policy's", () => {
  test("every spelling the scope calls cluster-scoped is one the policy does too, or a listed extra", () => {
    const disagreements: Array<string> = [];

    for (const spelling of KubectlWriteScope.clusterScopedKindSpellings) {
      const kind: string | null =
        KubectlWriteScope.getClusterScopedKind(spelling);
      const policy: boolean | null = policySaysClusterScoped(spelling);

      expect(kind).not.toBeNull();

      if (policy === null) {
        // The policy refuses every write to it; the scope holds on its own.
        continue;
      }

      const expected: boolean = !KINDS_ONLY_THE_SCOPE_KNOWS.includes(kind!);

      if (policy !== expected) {
        disagreements.push(
          `${spelling} (${kind}): policy says ${
            policy ? "cluster-scoped" : "namespaced"
          }`,
        );
      }
    }

    expect(disagreements).toEqual([]);
  });

  test.each(NAMESPACED_SPELLINGS)(
    "%s is namespaced to both",
    (spelling: string) => {
      expect(KubectlWriteScope.getClusterScopedKind(spelling)).toBeNull();

      const policy: boolean | null = policySaysClusterScoped(spelling);

      if (policy !== null) {
        expect(policy).toBe(false);
      }
    },
  );

  // Negative control: the probe does tell a cluster-scoped kind apart.
  test("the probe itself tells a node from a pod", () => {
    expect(policySaysClusterScoped("node")).toBe(true);
    expect(policySaysClusterScoped("pod")).toBe(false);
  });

  test("every extra is a kind the scope knows", () => {
    const kinds: Set<string> = new Set<string>(
      KubectlWriteScope.clusterScopedKindSpellings.map((spelling: string) => {
        return KubectlWriteScope.getClusterScopedKind(spelling)!;
      }),
    );

    for (const extra of KINDS_ONLY_THE_SCOPE_KNOWS) {
      expect(kinds.has(extra)).toBe(true);
    }
  });

  /*
   * kubectl reads RESOURCE.VERSION.GROUP, then RESOURCE.GROUP: a
   * group-qualified spelling is the built-in kind in that kind's own group,
   * in ANY PREFIX of it (client-go's "group prefixing": "sc.storage",
   * "storageclasses.stor"; after a version, for a short name only:
   * "sc.v1.storage"), and with no group at all ("sc.", "nodes.v1."). Any
   * other group is some custom resource, which the scope judges by -n like
   * a namespaced one; the core group never matches a prefix. (Round 3
   * pinned "only in that kind's own group", which kubectl does not follow;
   * KubectlWriteScopeKubectlSpellings holds the reading to what the real
   * kubectl resolved.)
   */
  test.each([
    ["nodes.v1.", "node"],
    ["namespaces.v1.", "namespace"],
    ["storageclasses.storage.k8s.io", "storageclass"],
    ["storageclasses.v1.storage.k8s.io", "storageclass"],
    ["ingressclasses.networking.k8s.io", "ingressclass"],
    ["clusterroles.rbac.authorization.k8s.io", "clusterrole"],
    [
      "customresourcedefinitions.apiextensions.k8s.io",
      "customresourcedefinition",
    ],
    ["Nodes", "node"],
    ["sc.storage", "storageclass"],
    ["sc.stor", "storageclass"],
    ["sc.v1.storage", "storageclass"],
    ["sc.", "storageclass"],
    ["sc.foo.", "storageclass"],
    ["storageclasses.stor", "storageclass"],
    ["storageclasses.v1.", "storageclass"],
    ["StorageClass.storage", "storageclass"],
    ["pc.scheduling", "priorityclass"],
    ["csr.cert", "certificatesigningrequest"],
    ["csr.certificates", "certificatesigningrequest"],
    ["vac.storage", "volumeattributesclass"],
    ["ip", "ipaddress"],
    ["ip.networking", "ipaddress"],
    ["ingressclasses.networking", "ingressclass"],
    ["crd.apiext", "customresourcedefinition"],
    ["no.x.", "node"],
  ])("%s is the built-in %s", (spelling: string, kind: string) => {
    expect(KubectlWriteScope.getClusterScopedKind(spelling)).toBe(kind);
  });

  test.each([
    "nodes.example.com",
    "namespaces.example.com",
    "storageclasses.example.io",
    "nodes.v1.example.com",
    "widgets.example.com",
    "pods",
    // kubectl rejects each of these.
    "sc.foo",
    "sc.x.storage",
    "storageclasses.v1.storage",
    "clusterroles.v1.rbac",
    "nodes.core",
    "no.x",
    "nodes.x.",
  ])("%s is not a built-in cluster-scoped kind", (spelling: string) => {
    expect(KubectlWriteScope.getClusterScopedKind(spelling)).toBeNull();
  });
});
