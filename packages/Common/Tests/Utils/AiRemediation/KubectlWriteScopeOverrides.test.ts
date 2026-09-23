/*
 * ---------------------------------------------------------------------------
 * KubectlWriteScope and flags that replace the object kubectl creates.
 *
 * The finding this pins (PR #3953 review, round 4): the scope read every
 * `kubectl expose` as making a namespaced Service in the namespace -n
 * names. kubectl merges --overrides (a JSON merge, strategic merge or JSON
 * patch, per --override-type) into the object it generates and creates
 * whatever the merge describes: real kubectl v1.36.4 POSTed a cluster-admin
 * ClusterRoleBinding, a globalDefault PriorityClass, a Namespace and a
 * privileged Job for `kubectl expose deployment web -n prod --port=80
 * --overrides=...`, and every write-scope check let each through on the
 * strength of -n prod.
 *
 * Now a write carrying --overrides or --override-type — in any spelling
 * kubectl accepts, on any verb — cannot be read for certain: refused as a
 * possible node operation while node operations are off, and as uncertain
 * whenever a scope is set. Independent of the shared policy, which denies
 * the flag on its own: every command here is handed to the scope as a
 * RiskyWrite verdict.
 * ---------------------------------------------------------------------------
 */

import KubectlWriteScope, {
  KubectlWriteScopeRefusal,
  KubectlWriteTargets,
} from "../../../Utils/AiRemediation/KubectlWriteScope";
import KubectlPolicy, {
  KubectlTokenizeResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import {
  KubectlWriteScopeObjectReplacingCase,
  OBJECT_REPLACING_SCOPE_CASES,
} from "./KubectlWriteScopeParityCases";
import { describe, expect, test } from "@jest/globals";

const LEAVE_OUT_OVERRIDES: string =
  "Leave out --overrides and --override-type, so kubectl creates only the object the command itself describes.";

const CLUSTER_ROLE_BINDING: string = `'{"apiVersion":"rbac.authorization.k8s.io/v1","kind":"ClusterRoleBinding","metadata":{"name":"ai-escape"},"roleRef":{"apiGroup":"rbac.authorization.k8s.io","kind":"ClusterRole","name":"cluster-admin"},"subjects":[{"kind":"ServiceAccount","name":"default","namespace":"prod"}]}'`;

function argsOf(command: string): Array<string> {
  const tokenized: KubectlTokenizeResult = KubectlPolicy.tokenize(command);
  const args: Array<string> = tokenized.args || [];

  expect(args.length).toBeGreaterThan(0);

  return args;
}

interface Posture {
  writeNamespaces: Array<string>;
  podNamespace: string | null;
  allowNodeOperations: boolean;
  usesCredential: boolean;
}

// The external Runner from the review: a credential, scoped to prod.
const CREDENTIAL_SCOPED_TO_PROD: Posture = {
  writeNamespaces: ["prod"],
  podNamespace: null,
  allowNodeOperations: true,
  usesCredential: true,
};

// The in-cluster Runner, scoped to prod, node operations off.
const IN_CLUSTER_NODES_OFF: Posture = {
  writeNamespaces: ["prod"],
  podNamespace: "oneuptime-agent",
  allowNodeOperations: false,
  usesCredential: false,
};

// Scoped nowhere, node operations on: nothing to judge by but RBAC.
const UNSCOPED: Posture = {
  writeNamespaces: [],
  podNamespace: null,
  allowNodeOperations: true,
  usesCredential: true,
};

// Scoped nowhere, node operations off.
const UNSCOPED_NODES_OFF: Posture = { ...UNSCOPED, allowNodeOperations: false };

// The scope's verdict on a command the policy is taken to let through.
function refusalOf(
  command: string,
  posture: Posture,
): KubectlWriteScopeRefusal | null {
  const args: Array<string> = argsOf(command);

  return KubectlWriteScope.getRefusal({
    command: {
      args,
      tier: KubectlCommandTier.RiskyWrite,
      verb: args[0] || "",
      displayCommand: KubectlPolicy.renderDisplayCommand(args),
    },
    ...posture,
  });
}

describe("resolveTargets: --overrides makes what a write creates uncertain", () => {
  test.each([
    [
      "--overrides=<json>",
      `kubectl expose deployment web -n prod --port=80 --overrides=${CLUSTER_ROLE_BINDING}`,
      "--overrides",
    ],
    [
      "--overrides <json>",
      `kubectl expose deployment web -n prod --port=80 --overrides ${CLUSTER_ROLE_BINDING}`,
      "--overrides",
    ],
    [
      "--override-type alone",
      "kubectl expose deployment web -n prod --port=80 --override-type=json",
      "--override-type",
    ],
    [
      "--override_type, which kubectl reads as --override-type",
      "kubectl expose deployment web -n prod --port=80 --override_type=merge",
      "--override_type",
    ],
    [
      "--override-type with its value as the next word",
      "kubectl expose deployment web -n prod --override-type strategic --port=80",
      "--override-type",
    ],
    [
      "the flag before the objects",
      `kubectl expose --overrides=${CLUSTER_ROLE_BINDING} deployment web -n prod --port=80`,
      "--overrides",
    ],
    [
      "another verb: run",
      `kubectl run debug --image=busybox -n prod --overrides=${CLUSTER_ROLE_BINDING}`,
      "--overrides",
    ],
  ])("%s", (_label: string, command: string, flag: string) => {
    const targets: KubectlWriteTargets = KubectlWriteScope.resolveTargets(
      argsOf(command),
    );

    expect(targets.uncertainty).toContain(`"${flag}"`);
    expect(targets.uncertainty).toContain("any kind, in any namespace");
    expect(targets.uncertaintyFix).toBe(LEAVE_OUT_OVERRIDES);
    // Nothing is claimed about what it changes.
    expect(targets.namespaced).toBe(false);
    expect(targets.clusterScopedKinds).toEqual([]);
    expect(targets.touchesNodes).toBe(false);
  });

  // Negative controls: the words appear, but not as the flag.
  test.each([
    [
      "expose without the flag makes a Service in -n",
      "kubectl expose deployment web -n prod --port=80 --target-port=8080",
    ],
    [
      "autoscale makes a HorizontalPodAutoscaler in -n",
      "kubectl autoscale deployment web -n prod --max=3",
    ],
    [
      "--overrides as another flag's value",
      "kubectl label --selector --overrides pods team=a -n prod",
    ],
    [
      "--overrides after --, where kubectl reads no flags",
      "kubectl annotate pod web-1 -n prod note=x -- --overrides=x",
    ],
  ])("%s", (_label: string, command: string) => {
    const targets: KubectlWriteTargets = KubectlWriteScope.resolveTargets(
      argsOf(command),
    );

    expect(targets.uncertainty).toBeNull();
    expect(targets.uncertaintyFix).toBe("");
    expect(targets.namespaced).toBe(true);
  });

  // The fix for any other uncertainty is still to name the objects.
  test("an unknown flag keeps its own fix", () => {
    const targets: KubectlWriteTargets = KubectlWriteScope.resolveTargets(
      argsOf("kubectl label --brand-new-flag node node-1 x=y"),
    );

    expect(targets.uncertainty).toContain('"--brand-new-flag"');
    expect(targets.uncertaintyFix).toContain("TYPE NAME or TYPE/NAME");
  });
});

describe("getRefusal: a write whose object --overrides replaces", () => {
  const COMMAND: string = `kubectl expose deployment web -n prod --port=80 --overrides=${CLUSTER_ROLE_BINDING}`;

  test("is uncertain on a credential Runner scoped to prod, node operations on", () => {
    const refusal: KubectlWriteScopeRefusal | null = refusalOf(
      COMMAND,
      CREDENTIAL_SCOPED_TO_PROD,
    );

    expect(refusal?.code).toBe("objects_uncertain");
    expect(refusal?.uncertainty).toContain('"--overrides"');
    expect(refusal?.fix).toBe(LEAVE_OUT_OVERRIDES);
    expect(refusal?.reason).toContain(
      "this Runner cannot tell for certain which objects",
    );
    expect(refusal?.reason).toContain(LEAVE_OUT_OVERRIDES);
    // -n prod is not what is wrong; never suggest another one.
    expect(refusal?.reason).not.toContain("-n <namespace>");
  });

  test("could be a node operation on the in-cluster Runner with node operations off", () => {
    const refusal: KubectlWriteScopeRefusal | null = refusalOf(
      COMMAND,
      IN_CLUSTER_NODES_OFF,
    );

    expect(refusal?.code).toBe("node_operations");
    expect(refusal?.uncertainty).toContain('"--overrides"');
    expect(refusal?.fix).toBe(LEAVE_OUT_OVERRIDES);
  });

  test("could be a node operation on an unscoped Runner with node operations off", () => {
    expect(refusalOf(COMMAND, UNSCOPED_NODES_OFF)?.code).toBe(
      "node_operations",
    );
  });

  // Nothing is configured to judge it by: RBAC decides, as for any write.
  test("is left to RBAC on a Runner scoped nowhere with node operations on", () => {
    expect(refusalOf(COMMAND, UNSCOPED)).toBeNull();
  });

  test.each(
    OBJECT_REPLACING_SCOPE_CASES.map(
      (entry: KubectlWriteScopeObjectReplacingCase) => {
        return [entry.label, entry] as [
          string,
          KubectlWriteScopeObjectReplacingCase,
        ];
      },
    ),
  )(
    "%s: refused on every scoped Runner",
    (_label: string, entry: KubectlWriteScopeObjectReplacingCase) => {
      for (const posture of [
        CREDENTIAL_SCOPED_TO_PROD,
        IN_CLUSTER_NODES_OFF,
        { ...IN_CLUSTER_NODES_OFF, allowNodeOperations: true },
      ]) {
        const refusal: KubectlWriteScopeRefusal | null = refusalOf(
          entry.command,
          posture,
        );

        expect(refusal).not.toBeNull();
        expect(refusal?.uncertainty).toContain(`"${entry.flag}"`);
      }
    },
  );

  // Negative controls: the same expose, judged by -n as before.
  test("without --overrides, expose is a Service in the namespace -n names", () => {
    const plain: string = "kubectl expose deployment web -n prod --port=80";

    expect(refusalOf(plain, CREDENTIAL_SCOPED_TO_PROD)).toBeNull();
    expect(
      refusalOf("kubectl expose deployment web --port=80", {
        ...CREDENTIAL_SCOPED_TO_PROD,
      })?.code,
    ).toBe("outside_scope");
    expect(
      refusalOf(
        "kubectl expose deployment web -n kube-public --port=80",
        CREDENTIAL_SCOPED_TO_PROD,
      )?.code,
    ).toBe("outside_scope");
    expect(
      refusalOf(
        "kubectl autoscale deployment web -n prod --max=3",
        CREDENTIAL_SCOPED_TO_PROD,
      ),
    ).toBeNull();
    expect(
      refusalOf(
        "kubectl create job x --from=cronjob/y -n prod",
        CREDENTIAL_SCOPED_TO_PROD,
      ),
    ).toBeNull();
  });
});
