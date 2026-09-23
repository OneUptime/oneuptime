import KubectlPolicy, {
  KubectlAutoExecutionVerdict,
  KubectlPolicyResult,
  KubectlTokenizeResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — a `kubectl patch` may not drop a pod's
 * pod-security fields (securityContext, serviceAccountName, command, args,
 * volumes, volumeMounts, Secret references) by replacing or removing what
 * holds them, without naming any. The name check (KubectlPolicyDenials)
 * refuses a body that spells one of those fields; these bodies spell none.
 * Each Denied body below was applied with the pinned kubectl v1.36.4
 * (`patch --local`) to a Deployment whose pod runs as a restricted
 * ServiceAccount with a securityContext, a command, a Secret env reference,
 * a volume and a second container, and dropped or reset at least one of
 * them:
 *  1. strategic merge (the default type): a directive — `$patch`,
 *     `$retainKeys`, `$setElementOrder/...` — in the object, spec, template,
 *     jobTemplate, the pod spec, the containers list, a container, its env
 *     list, an env entry or its valueFrom; null for one of those; a value of
 *     the wrong shape for one of those;
 *  2. merge (--type=merge, any case): any value for the containers list
 *     (RFC 7386 replaces a list wholesale), null, or a scalar for the pod
 *     spec or what holds it;
 *  3. JSON patch: remove, replace, move or copy whose path — or from — is the
 *     whole object, spec, template, jobTemplate, the pod spec, the
 *     containers list, one container, its env list, one env entry or its
 *     valueFrom; and an add whose path is one of those as an object member
 *     (add replaces an existing member).
 * Each is Denied, so it stays Denied under Bypass approval and every
 * allowlist entry. Negative controls: the ordinary fixes — a strategic merge
 * of one container's image or resources by name, a JSON-patch replace of
 * /spec/replicas or of /spec/template/spec/containers/0/image, a merge
 * patch of metadata/annotations, a directive OFF that path (the update
 * strategy's `$retainKeys`) — stay RiskyWrite and still run under Bypass
 * approval or a matching entry.
 */

function patch(body: string, flags: string = ""): string {
  return `kubectl patch deployment web -n web${flags} -p '${body}'`;
}

function strategic(body: string): string {
  return patch(body);
}

function merge(body: string): string {
  return patch(body, " --type=merge");
}

function jsonPatch(operations: Array<Record<string, unknown>>): string {
  return patch(JSON.stringify(operations), " --type=json");
}

// Every allowlist entry an operator could write for these patches (all valid).
const PATCH_ENTRIES: Array<string> = [
  "kubectl patch deployment web -n web -p *",
  "kubectl patch deployment web -n web --type=merge -p *",
  "kubectl patch deployment web -n web --type=json -p *",
  "kubectl patch deployment web -n web --type=Json -p *",
  "kubectl patch deployment web -n web --type=MERGE -p *",
  "kubectl patch deployment web -n web --type=strategic -p *",
  "kubectl patch * * -n * -p *",
  "kubectl patch * * -n * --type=merge -p *",
  "kubectl patch * * -n * --type=json -p *",
  "kubectl patch pod web -n web -p *",
  "kubectl patch pod web -n web --type=json -p *",
  "kubectl patch cronjob nightly -n web -p *",
  "kubectl patch cronjob nightly -n web --type=json -p *",
];

const ONE_CONTAINER: string = '[{"name":"web","image":"x"}]';

// [command, the location the refusal names]
const DENIED_STRATEGIC: Array<[string, string]> = [
  [
    strategic(
      `{"spec":{"template":{"spec":{"$patch":"replace","containers":${ONE_CONTAINER}}}}}`,
    ),
    "/spec/template/spec",
  ],
  [
    strategic(
      `{"spec":{"template":{"$patch":"replace","spec":{"containers":${ONE_CONTAINER}}}}}`,
    ),
    "/spec/template",
  ],
  [strategic('{"spec":{"$patch":"replace","replicas":2}}'), "/spec"],
  [strategic('{"$patch":"replace","spec":{"replicas":1}}'), "the whole object"],
  [
    strategic('{"spec":{"template":{"spec":{"$patch":"delete"}}}}'),
    "/spec/template/spec",
  ],
  // A list-level replace: every container keeps only what the patch lists.
  [
    strategic(
      '{"spec":{"template":{"spec":{"containers":[{"name":"web","image":"x"},{"$patch":"replace"}]}}}}',
    ),
    "/spec/template/spec/containers/1",
  ],
  [
    strategic(
      '{"spec":{"template":{"spec":{"containers":[{"name":"web","image":"x","$patch":"replace"}]}}}}',
    ),
    "/spec/template/spec/containers/0",
  ],
  // Deletes the second container outright.
  [
    strategic(
      '{"spec":{"template":{"spec":{"containers":[{"name":"authproxy","$patch":"delete"}]}}}}',
    ),
    "/spec/template/spec/containers/0",
  ],
  [
    strategic(
      `{"spec":{"template":{"spec":{"$retainKeys":["containers"],"containers":${ONE_CONTAINER}}}}}`,
    ),
    "/spec/template/spec",
  ],
  [
    strategic('{"spec":{"template":{"$retainKeys":["metadata"]}}}'),
    "/spec/template",
  ],
  [
    strategic(
      '{"spec":{"template":{"spec":{"$setElementOrder/containers":[{"name":"authproxy"}]}}}}',
    ),
    "/spec/template/spec",
  ],
  [
    strategic(
      '{"spec":{"template":{"spec":{"containers":[{"name":"web","env":[{"$patch":"replace"}]}]}}}}',
    ),
    "/spec/template/spec/containers/0/env/0",
  ],
  [
    strategic(
      '{"spec":{"template":{"spec":{"containers":[{"name":"web","env":[{"name":"DB","valueFrom":{"$patch":"replace","configMapKeyRef":{"name":"c","key":"k"}}}]}]}}}}',
    ),
    "/spec/template/spec/containers/0/env/0/valueFrom",
  ],
  // null deletes what it names.
  [strategic('{"spec":{"template":{"spec":null}}}'), "/spec/template/spec"],
  [strategic('{"spec":{"template":null}}'), "/spec/template"],
  [strategic('{"spec":null}'), "/spec"],
  [
    strategic('{"spec":{"template":{"spec":{"containers":null}}}}'),
    "/spec/template/spec/containers",
  ],
  [
    strategic(
      '{"spec":{"template":{"spec":{"containers":[{"name":"web","env":null}]}}}}',
    ),
    "/spec/template/spec/containers/0/env",
  ],
  // A value of the wrong shape replaces what is there.
  [strategic('{"spec":{"template":{"spec":"x"}}}'), "/spec/template/spec"],
  [strategic('{"spec":{"template":[]}}'), "/spec/template"],
  [
    strategic('{"spec":{"template":{"spec":{"containers":{"name":"web"}}}}}'),
    "/spec/template/spec/containers",
  ],
  // The CronJob and Pod layouts, and --type=strategic written out.
  [
    `kubectl patch cronjob nightly -n web -p '{"spec":{"jobTemplate":{"spec":{"template":{"spec":{"$patch":"replace","containers":[{"name":"job","image":"x"}]}}}}}}'`,
    "/spec/jobTemplate/spec/template/spec",
  ],
  [
    `kubectl patch pod web -n web -p '{"spec":{"$patch":"replace","containers":${ONE_CONTAINER}}}'`,
    "/spec",
  ],
  [
    patch(
      '{"spec":{"template":{"spec":{"$patch":"replace"}}}}',
      " --type=strategic",
    ),
    "/spec/template/spec",
  ],
  // JSON escapes are decoded before the walk, and keys match in any case.
  [
    strategic('{"spec":{"template":{"spec":{"\\u0024patch":"replace"}}}}'),
    "/spec/template/spec",
  ],
  [strategic('{"Spec":{"Template":{"Spec":null}}}'), "/Spec/Template/Spec"],
];

const DENIED_MERGE: Array<[string, string]> = [
  [
    merge(`{"spec":{"template":{"spec":{"containers":${ONE_CONTAINER}}}}}`),
    "/spec/template/spec/containers",
  ],
  [
    merge('{"spec":{"template":{"spec":{"containers":[]}}}}'),
    "/spec/template/spec/containers",
  ],
  [merge('{"spec":{"template":{"spec":null}}}'), "/spec/template/spec"],
  [merge('{"spec":{"template":{"spec":"x"}}}'), "/spec/template/spec"],
  [merge('{"spec":{"template":null}}'), "/spec/template"],
  [
    patch(
      `{"spec":{"template":{"spec":{"containers":${ONE_CONTAINER}}}}}`,
      " --type merge",
    ),
    "/spec/template/spec/containers",
  ],
  [
    patch(
      `{"spec":{"template":{"spec":{"containers":${ONE_CONTAINER}}}}}`,
      " --type=MERGE",
    ),
    "/spec/template/spec/containers",
  ],
  [
    `kubectl patch pod web -n web --type=merge -p '{"spec":{"containers":${ONE_CONTAINER}}}'`,
    "/spec/containers",
  ],
  [
    `kubectl patch cronjob nightly -n web --type=merge -p '{"spec":{"jobTemplate":{"spec":{"template":{"spec":{"containers":[{"name":"job","image":"x"}]}}}}}}'`,
    "/spec/jobTemplate/spec/template/spec/containers",
  ],
  // pflag keeps the last --type; every one given is read (the safe side).
  [
    patch(
      `{"spec":{"template":{"spec":{"containers":${ONE_CONTAINER}}}}}`,
      " --type=strategic --type=merge",
    ),
    "/spec/template/spec/containers",
  ],
  [
    patch(
      `{"spec":{"template":{"spec":{"containers":${ONE_CONTAINER}}}}}`,
      " --type=merge --type=strategic",
    ),
    "/spec/template/spec/containers",
  ],
  // A --type kubectl does not know is read as every type.
  [
    patch(
      `{"spec":{"template":{"spec":{"containers":${ONE_CONTAINER}}}}}`,
      " --type=apply",
    ),
    "/spec/template/spec/containers",
  ],
];

const DENIED_JSON: Array<[string, string]> = [
  [
    jsonPatch([
      {
        op: "replace",
        path: "/spec/template/spec",
        value: { containers: [{ name: "web", image: "x" }] },
      },
    ]),
    "/spec/template/spec",
  ],
  [
    jsonPatch([
      {
        op: "replace",
        path: "/spec/template/spec/containers",
        value: [{ name: "web", image: "x" }],
      },
    ]),
    "/spec/template/spec/containers",
  ],
  [
    jsonPatch([
      {
        op: "replace",
        path: "/spec/template/spec/containers/0",
        value: { name: "web", image: "x" },
      },
    ]),
    "/spec/template/spec/containers/0",
  ],
  [
    jsonPatch([{ op: "remove", path: "/spec/template/spec/containers/1" }]),
    "/spec/template/spec/containers/1",
  ],
  [jsonPatch([{ op: "remove", path: "/spec/template" }]), "/spec/template"],
  [jsonPatch([{ op: "remove", path: "/spec" }]), "/spec"],
  [
    jsonPatch([
      {
        op: "replace",
        path: "",
        value: { apiVersion: "apps/v1", kind: "Deployment" },
      },
    ]),
    "the whole object",
  ],
  // add replaces an existing object member.
  [
    jsonPatch([
      {
        op: "add",
        path: "/spec/template/spec",
        value: { containers: [{ name: "web", image: "x" }] },
      },
    ]),
    "/spec/template/spec",
  ],
  [
    jsonPatch([
      {
        op: "add",
        path: "/spec/template/spec/containers",
        value: [{ name: "web", image: "x" }],
      },
    ]),
    "/spec/template/spec/containers",
  ],
  [
    jsonPatch([
      {
        op: "add",
        path: "/spec/template/spec/containers/0/env",
        value: [{ name: "A", value: "b" }],
      },
    ]),
    "/spec/template/spec/containers/0/env",
  ],
  [jsonPatch([{ op: "add", path: "", value: {} }]), "the whole object"],
  [
    jsonPatch([
      {
        op: "replace",
        path: "/spec/template/spec/containers/0/env/0/valueFrom",
        value: { configMapKeyRef: { name: "c", key: "k" } },
      },
    ]),
    "/spec/template/spec/containers/0/env/0/valueFrom",
  ],
  [
    jsonPatch([
      { op: "remove", path: "/spec/template/spec/containers/0/env/0" },
    ]),
    "/spec/template/spec/containers/0/env/0",
  ],
  // move and copy: the path, and the from.
  [
    jsonPatch([
      {
        op: "move",
        from: "/spec/template/spec/containers/0/env",
        path: "/metadata/annotations/x",
      },
    ]),
    "/spec/template/spec/containers/0/env",
  ],
  [
    jsonPatch([
      { op: "copy", from: "/spec/selector", path: "/spec/template/spec" },
    ]),
    "/spec/template/spec",
  ],
  [
    jsonPatch([
      {
        op: "copy",
        from: "/spec/template/spec",
        path: "/metadata/annotations/x",
      },
    ]),
    "/spec/template/spec",
  ],
  // The Pod and CronJob layouts.
  [
    `kubectl patch pod web -n web --type=json -p '[{"op":"replace","path":"/spec/containers/0","value":{"name":"web","image":"x"}}]'`,
    "/spec/containers/0",
  ],
  [
    `kubectl patch cronjob nightly -n web --type=json -p '[{"op":"replace","path":"/spec/jobTemplate/spec/template/spec/containers/0","value":{"name":"job","image":"x"}}]'`,
    "/spec/jobTemplate/spec/template/spec/containers/0",
  ],
  // A path without the leading "/": json-patch drops its first segment.
  [
    jsonPatch([
      {
        op: "replace",
        path: "x/spec/template/spec",
        value: { containers: [{ name: "web", image: "x" }] },
      },
    ]),
    "x/spec/template/spec",
  ],
  // Escapes are decoded; an op in another case is read as a removal.
  [
    patch(
      '[{"op":"replace","path":"/spec/template/\\u0073pec","value":{}}]',
      " --type=json",
    ),
    "/spec/template/spec",
  ],
  [
    jsonPatch([{ op: "Remove", path: "/spec/template/spec/containers/0" }]),
    "/spec/template/spec/containers/0",
  ],
  // One bad operation among good ones, and --type=Json.
  [
    jsonPatch([
      { op: "replace", path: "/spec/replicas", value: 3 },
      { op: "remove", path: "/spec/template/spec/containers/1" },
    ]),
    "/spec/template/spec/containers/1",
  ],
  [
    patch(
      '[{"op":"replace","path":"/spec/template/spec","value":{}}]',
      " --type=Json",
    ),
    "/spec/template/spec",
  ],
];

const DENIED: Array<[string, string]> = [
  ...DENIED_STRATEGIC,
  ...DENIED_MERGE,
  ...DENIED_JSON,
];

// ---- Negative controls: ordinary fixes stay RiskyWrite -------------------------------

const ORDINARY_FIXES: Array<string> = [
  // strategic merge of one container, by name.
  strategic(
    '{"spec":{"template":{"spec":{"containers":[{"name":"web","image":"nginx:1.28"}]}}}}',
  ),
  strategic(
    '{"spec":{"template":{"spec":{"containers":[{"name":"web","resources":{"limits":{"memory":"1Gi"}}}]}}}}',
  ),
  strategic(
    '{"spec":{"template":{"spec":{"containers":[{"name":"web","env":[{"name":"LOG_LEVEL","value":"debug"}]}]}}}}',
  ),
  `kubectl patch cronjob nightly -n web -p '{"spec":{"jobTemplate":{"spec":{"template":{"spec":{"containers":[{"name":"job","image":"busybox:1.37"}]}}}}}}'`,
  // Directives off the pod-spec path.
  strategic('{"spec":{"strategy":{"$retainKeys":["type"],"type":"Recreate"}}}'),
  strategic(
    '{"spec":{"template":{"spec":{"containers":[{"name":"web","resources":{"$patch":"replace","limits":{"memory":"1Gi"}}}]}}}}',
  ),
  strategic('{"metadata":{"labels":{"$patch":"replace","app":"web"}}}'),
  // Other pod spec fields are not above a pod-security field.
  strategic(
    '{"spec":{"template":{"spec":{"tolerations":[{"key":"k","operator":"Exists"}]}}}}',
  ),
  strategic('{"spec":{"template":{"spec":{"nodeSelector":null}}}}'),
  strategic('{"spec":{"replicas":2}}'),
  strategic(
    '{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"2026-09-23T00:00:00Z"}}}}}',
  ),
  // Words that look like a JSON-patch operation, as annotation text.
  strategic(
    '{"metadata":{"annotations":{"op":"remove","path":"/spec/template/spec"}}}',
  ),
  // merge patches of what is not a list on the path.
  merge('{"metadata":{"annotations":{"note":"x"}}}'),
  merge('{"spec":{"replicas":3}}'),
  merge(
    '{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"2026-09-23T00:00:00Z"}}}}}',
  ),
  merge('{"spec":{"template":{"spec":{"terminationGracePeriodSeconds":60}}}}'),
  merge('{"spec":{"template":{"spec":{"nodeSelector":{"pool":"b"}}}}}'),
  `kubectl patch cronjob nightly -n web --type=merge -p '{"spec":{"suspend":true}}'`,
  // JSON patches below the path, and additions to a list.
  jsonPatch([{ op: "replace", path: "/spec/replicas", value: 3 }]),
  jsonPatch([
    {
      op: "replace",
      path: "/spec/template/spec/containers/0/image",
      value: "nginx:1.28",
    },
  ]),
  jsonPatch([
    {
      op: "replace",
      path: "/spec/template/spec/containers/0/resources/limits/memory",
      value: "1Gi",
    },
  ]),
  jsonPatch([
    {
      op: "add",
      path: "/spec/template/spec/containers/0/env/-",
      value: { name: "A", value: "b" },
    },
  ]),
  jsonPatch([
    {
      op: "replace",
      path: "/spec/template/spec/containers/0/env/0/value",
      value: "debug",
    },
  ]),
  jsonPatch([{ op: "add", path: "/metadata/annotations/note", value: "x" }]),
  jsonPatch([
    { op: "test", path: "/spec/template/spec", value: {} },
    { op: "replace", path: "/spec/replicas", value: 2 },
  ]),
  jsonPatch([
    {
      op: "replace",
      path: "/spec/template/metadata/annotations",
      value: { note: "x" },
    },
  ]),
  jsonPatch([
    {
      op: "add",
      path: "/spec/template/spec/tolerations/-",
      value: { key: "k", operator: "Exists" },
    },
  ]),
  `kubectl patch pod web -n web --type=json -p '[{"op":"replace","path":"/spec/containers/0/image","value":"nginx:1.28"}]'`,
];

describe("KubectlPolicy: a patch may not drop pod-security fields by replacing what holds them", () => {
  it.each(DENIED)("denies %s (at %s)", (command: string, where: string) => {
    const result: KubectlPolicyResult = KubectlPolicy.evaluateCommand(command);
    expect(result.tier).toBe(KubectlCommandTier.Denied);
    expect(result.verb).toBe("patch");
    expect(result.reason).toContain("without naming any of them");
    expect(result.reason).toContain(where);
  });

  it.each(DENIED)(
    "keeps %s Denied under Bypass approval and every allowlist entry",
    (command: string) => {
      for (const options of [
        { bypassApproval: true },
        { allowlistPatterns: [command] },
        { allowlistPatterns: PATCH_ENTRIES },
        {
          allowlistPatterns: [command, ...PATCH_ENTRIES],
          bypassApproval: true,
        },
      ]) {
        const verdict: KubectlAutoExecutionVerdict =
          KubectlPolicy.evaluateForAutoExecution({
            command,
            allowlistPatterns: options.allowlistPatterns || [],
            bypassApproval: options.bypassApproval,
          });
        expect(verdict.verdict).toBe(AiRemediationCommandPolicyVerdict.Denied);
      }
    },
  );

  it("says what to do instead", () => {
    const strategicReason: string = KubectlPolicy.evaluateCommand(
      DENIED_STRATEGIC[0]![0],
    ).reason;
    expect(strategicReason).toContain('strategic-merge directive "$patch"');
    expect(strategicReason).toContain("set image");

    const mergeReason: string = KubectlPolicy.evaluateCommand(
      DENIED_MERGE[0]![0],
    ).reason;
    expect(mergeReason).toContain("a merge patch replaces a list wholesale");
    expect(mergeReason).toContain(
      "use a strategic-merge patch that names the container",
    );

    const jsonReason: string = KubectlPolicy.evaluateCommand(
      DENIED_JSON[0]![0],
    ).reason;
    expect(jsonReason).toContain('JSON-patch "replace" of /spec/template/spec');
    expect(jsonReason).toContain("/spec/template/spec/containers/0/image");
  });

  it("keeps the name check's own reason when the body also names a field", () => {
    const reason: string = KubectlPolicy.evaluateCommand(
      strategic(
        '{"spec":{"template":{"spec":{"$patch":"replace","serviceAccountName":"admin"}}}}',
      ),
    ).reason;
    expect(reason).toContain("kubectl patch that touches serviceAccountName");
  });

  it.each(ORDINARY_FIXES)(
    "negative control: %s stays RiskyWrite and still runs under Bypass approval or a matching entry",
    (command: string) => {
      const result: KubectlPolicyResult =
        KubectlPolicy.evaluateCommand(command);
      expect({ command, tier: result.tier, reason: result.reason }).toEqual({
        command,
        tier: KubectlCommandTier.RiskyWrite,
        reason: result.reason,
      });
      expect(
        KubectlPolicy.evaluateForAutoExecution({
          command,
          allowlistPatterns: [],
          bypassApproval: true,
        }).verdict,
      ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
      expect(
        KubectlPolicy.evaluateForAutoExecution({
          command,
          allowlistPatterns: PATCH_ENTRIES,
        }).verdict,
      ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
    },
  );

  it("negative control: the same containers list is a merge by name under strategic merge, and wholesale under merge", () => {
    const body: string = `{"spec":{"template":{"spec":{"containers":${ONE_CONTAINER}}}}}`;
    expect(KubectlPolicy.evaluateCommand(strategic(body)).tier).toBe(
      KubectlCommandTier.RiskyWrite,
    );
    expect(
      KubectlPolicy.evaluateCommand(patch(body, " --type=strategic")).tier,
    ).toBe(KubectlCommandTier.RiskyWrite);
    expect(KubectlPolicy.evaluateCommand(merge(body)).tier).toBe(
      KubectlCommandTier.Denied,
    );
  });

  describe("evaluateCommand and evaluateArgs agree on every table above", () => {
    it.each([
      ...DENIED.map(([command]: [string, string]) => {
        return command;
      }),
      ...ORDINARY_FIXES,
    ])("returns the same verdict for %s", (command: string) => {
      const tokenized: KubectlTokenizeResult = KubectlPolicy.tokenize(command);
      expect(tokenized.args).toBeDefined();
      expect(KubectlPolicy.evaluateArgs(tokenized.args!)).toEqual(
        KubectlPolicy.evaluateCommand(command),
      );
    });
  });
});
