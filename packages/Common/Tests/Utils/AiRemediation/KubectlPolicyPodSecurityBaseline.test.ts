import KubectlPolicy, {
  KubectlPolicyResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — a `kubectl patch` may not name any Pod Security
 * Standards baseline control, nor the isolation fields beside them (the
 * header's "wiring ... privileges, host access ... into a pod" class):
 *  1. The fields the name check used to miss: a container port's hostPort
 *     (the baseline Host Ports control: it binds the node's own IP),
 *     hostUsers (true takes away the pod's user namespace),
 *     runtimeClassName (it can move a pod off a sandboxed runtime) and
 *     shareProcessNamespace. Each is Denied as a strategic-merge key where a
 *     real change puts it, as a merge-patch key, as a JSON-patch path
 *     segment and inside a JSON-patch value, on a Deployment, a Pod, a
 *     CronJob and a DaemonSet, in any case and through \u escapes.
 *  2. The baseline AppArmor control's annotation,
 *     `container.apparmor.security.beta.kubernetes.io/<container>`, in a pod
 *     or pod template's metadata, in every patch type (the field form,
 *     securityContext.appArmorProfile, was already refused as
 *     securityContext).
 *  3. The baseline Host Probes / Lifecycle Hooks control (Kubernetes
 *     v1.34+): `host` as a member of httpGet or tcpSocket — liveness,
 *     readiness and startup probes, postStart and preStop hooks, on any
 *     container (init and ephemeral containers are refused whole by name) —
 *     in every patch type, including a JSON-patch value placed at
 *     .../httpGet and a whole probe placed at .../livenessProbe.
 *  4. Each stays Denied under Bypass approval and under the allowlist entry
 *     `kubectl patch deployment web -n web -p *` (Denied is never promoted).
 *  5. Negative controls: a ports patch with only containerPort, a probe
 *     whose path or port changes, an Ingress rule's host (not a pod field),
 *     a `host` annotation or label, other annotations, hostname, dnsPolicy,
 *     image and resources all stay RiskyWrite and run under Bypass approval.
 */

function evaluate(command: string): KubectlPolicyResult {
  return KubectlPolicy.evaluateCommand(command);
}

function podTemplatePatch(fragment: string): string {
  return `kubectl patch deployment web -n web -p '{"spec":{"template":{"spec":${fragment}}}}'`;
}

function containerPatch(fragment: string): string {
  return podTemplatePatch(`{"containers":[{"name":"web",${fragment}}]}`);
}

// ---- 1. The newly listed pod-spec and container fields ------------------------

const NEW_POD_SPEC_FIELDS: Array<[string, string]> = [
  ["hostUsers", "true"],
  ["runtimeClassName", '"runc"'],
  ["shareProcessNamespace", "true"],
];

const NEW_FIELD_PATCHES: Array<[string, string]> = [
  // hostPort, where a real change puts it.
  [
    "hostPort",
    containerPatch('"ports":[{"containerPort":8080,"hostPort":80}]'),
  ],
  [
    "hostPort",
    podTemplatePatch(
      '{"containers":[{"name":"web","image":"web:2"},{"name":"dns","ports":[{"containerPort":53,"hostPort":53,"protocol":"UDP"}]}]}',
    ),
  ],
  [
    "hostPort",
    `kubectl patch deployment web -n web --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/ports/0/hostPort","value":80}]'`,
  ],
  [
    "hostPort",
    `kubectl patch deployment web -n web --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/ports","value":[{"containerPort":80,"hostPort":80}]}]'`,
  ],
  [
    "hostPort",
    `kubectl patch deployment web -n web --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/ports/0","value":{"containerPort":80,"hostPort":80}}]'`,
  ],
  [
    "hostPort",
    `kubectl patch pod web-1 -n web -p '{"spec":{"containers":[{"name":"web","ports":[{"containerPort":80,"hostPort":80}]}]}}'`,
  ],
  [
    "hostPort",
    `kubectl patch daemonset agent -n web -p '{"spec":{"template":{"spec":{"containers":[{"name":"agent","ports":[{"containerPort":9100,"hostPort":9100}]}]}}}}'`,
  ],
  [
    "HostPort",
    containerPatch('"ports":[{"containerPort":8080,"HostPort":80}]'),
  ],
  [
    "hostPor\\u0074",
    containerPatch('"ports":[{"containerPort":8080,"hostPor\\u0074":80}]'),
  ],
  // The pod-spec fields: strategic merge, merge, JSON path, JSON value.
  ...NEW_POD_SPEC_FIELDS.flatMap(
    ([field, value]: [string, string]): Array<[string, string]> => {
      return [
        [field, podTemplatePatch(`{"${field}":${value}}`)],
        [
          field,
          `kubectl patch deployment web -n web --type=merge -p '{"spec":{"template":{"spec":{"${field}":${value}}}}}'`,
        ],
        [
          field,
          `kubectl patch deployment web -n web --type=merge -p '{"spec":{"template":{"spec":{"${field}":null}}}}'`,
        ],
        [
          field,
          `kubectl patch deployment web -n web --type=json -p '[{"op":"add","path":"/spec/template/spec/${field}","value":${value}}]'`,
        ],
        [
          field,
          `kubectl patch deployment web -n web --type=json -p '[{"op":"remove","path":"/spec/template/spec/${field}"}]'`,
        ],
        [
          field,
          `kubectl patch pod web-1 -n web -p '{"spec":{"${field}":${value}}}'`,
        ],
        [
          field,
          `kubectl patch cronjob nightly -n web -p '{"spec":{"jobTemplate":{"spec":{"template":{"spec":{"${field}":${value}}}}}}}'`,
        ],
        [
          field.toUpperCase(),
          podTemplatePatch(`{"${field.toUpperCase()}":${value}}`),
        ],
      ];
    },
  ),
];

// ---- 2. The AppArmor annotation -------------------------------------------------

const APPARMOR_KEY: string =
  "container.apparmor.security.beta.kubernetes.io/web";

const APPARMOR_PATCHES: Array<string> = [
  `kubectl patch deployment web -n web -p '{"spec":{"template":{"metadata":{"annotations":{"${APPARMOR_KEY}":"unconfined"}}}}}'`,
  `kubectl patch deployment web -n web --type=merge -p '{"spec":{"template":{"metadata":{"annotations":{"${APPARMOR_KEY}":"unconfined"}}}}}'`,
  `kubectl patch deployment web -n web --type=json -p '[{"op":"add","path":"/spec/template/metadata/annotations/container.apparmor.security.beta.kubernetes.io~1web","value":"unconfined"}]'`,
  `kubectl patch deployment web -n web --type=json -p '[{"op":"add","path":"/spec/template/metadata/annotations","value":{"${APPARMOR_KEY}":"unconfined"}}]'`,
  `kubectl patch deployment web -n web --type=json -p '[{"op":"remove","path":"/spec/template/metadata/annotations/container.apparmor.security.beta.kubernetes.io~1web"}]'`,
  `kubectl patch pod web-1 -n web -p '{"metadata":{"annotations":{"${APPARMOR_KEY}":"unconfined"}}}'`,
  `kubectl patch cronjob nightly -n web -p '{"spec":{"jobTemplate":{"spec":{"template":{"metadata":{"annotations":{"${APPARMOR_KEY}":"unconfined"}}}}}}}'`,
  // Case and escapes do not hide it.
  `kubectl patch deployment web -n web -p '{"spec":{"template":{"metadata":{"annotations":{"Container.AppArmor.Security.Beta.Kubernetes.IO/web":"unconfined"}}}}}'`,
  `kubectl patch deployment web -n web -p '{"spec":{"template":{"metadata":{"annotations":{"container.apparmor.security.beta.kubernetes.io\\u002fweb":"unconfined"}}}}}'`,
];

// ---- 3. A probe's or lifecycle hook's host -------------------------------------

const PROBE_HOLDERS: Array<string> = [
  "livenessProbe",
  "readinessProbe",
  "startupProbe",
];

const HOOK_HOLDERS: Array<string> = ["postStart", "preStop"];

const HANDLERS: Array<[string, string]> = [
  ["httpGet", '{"host":"169.254.169.254","port":80,"path":"/"}'],
  ["tcpSocket", '{"host":"10.0.0.1","port":6443}'],
];

const HOST_PATCHES: Array<string> = [
  // Strategic merge on a container, for every probe and handler...
  ...PROBE_HOLDERS.flatMap((probe: string) => {
    return HANDLERS.map(([handler, body]: [string, string]) => {
      return containerPatch(`"${probe}":{"${handler}":${body}}`);
    });
  }),
  // ... every lifecycle hook ...
  ...HOOK_HOLDERS.flatMap((hook: string) => {
    return HANDLERS.map(([handler, body]: [string, string]) => {
      return containerPatch(`"lifecycle":{"${hook}":{"${handler}":${body}}}`);
    });
  }),
  /*
   * ... a second container, a Pod, a merge patch and a CronJob. (Init and
   * ephemeral containers are refused whole: initContainers and
   * ephemeralContainers are forbidden names of their own.)
   */
  podTemplatePatch(
    '{"containers":[{"name":"web","image":"web:2"},{"name":"proxy","startupProbe":{"httpGet":{"host":"10.0.0.1","port":80}}}]}',
  ),
  `kubectl patch deployment web -n web --type=merge -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","readinessProbe":{"tcpSocket":{"host":"10.0.0.1","port":22}}}]}}}}'`,
  `kubectl patch pod web-1 -n web -p '{"spec":{"containers":[{"name":"web","readinessProbe":{"tcpSocket":{"host":"10.0.0.1","port":22}}}]}}'`,
  `kubectl patch cronjob nightly -n web -p '{"spec":{"jobTemplate":{"spec":{"template":{"spec":{"containers":[{"name":"job","livenessProbe":{"httpGet":{"host":"10.0.0.1","port":80}}}]}}}}}}'`,
  // JSON patch: the path names the host...
  `kubectl patch deployment web -n web --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/livenessProbe/httpGet/host","value":"10.0.0.1"}]'`,
  `kubectl patch deployment web -n web --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/lifecycle/preStop/tcpSocket/host","value":"10.0.0.1"}]'`,
  `kubectl patch deployment web -n web --type=json -p '[{"op":"copy","from":"/metadata/name","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/host"}]'`,
  // ... the value sits at .../httpGet, or holds a whole probe.
  `kubectl patch deployment web -n web --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/livenessProbe/httpGet","value":{"host":"10.0.0.1","port":80}}]'`,
  `kubectl patch deployment web -n web --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/startupProbe/tcpSocket","value":{"host":"10.0.0.1","port":80}}]'`,
  `kubectl patch deployment web -n web --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/livenessProbe","value":{"httpGet":{"host":"10.0.0.1","port":80}}}]'`,
  // Case and escapes do not hide it.
  containerPatch('"livenessProbe":{"HTTPGet":{"Host":"10.0.0.1","port":80}}'),
  containerPatch(
    '"livenessProbe":{"httpGet":{"\\u0068ost":"10.0.0.1","port":80}}',
  ),
  `kubectl patch deployment web -n web --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/livenessProbe/TCPSOCKET/HOST","value":"x"}]'`,
];

// The refusal names the handler and its host, as the patch spelled them.
const HANDLER_HOST_REFUSAL: RegExp =
  /kubectl patch that touches (httpGet|tcpSocket)\.host is never allowed/i;

// ---- 5. Negative controls ------------------------------------------------------

const STILL_PATCHABLE: Array<string> = [
  containerPatch('"ports":[{"containerPort":8080,"protocol":"TCP"}]'),
  `kubectl patch deployment web -n web --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/ports/-","value":{"containerPort":9090}}]'`,
  containerPatch('"livenessProbe":{"httpGet":{"path":"/healthz","port":8080}}'),
  containerPatch(
    '"readinessProbe":{"tcpSocket":{"port":6379},"periodSeconds":5}',
  ),
  containerPatch(
    '"lifecycle":{"preStop":{"httpGet":{"path":"/drain","port":8080}}}',
  ),
  `kubectl patch deployment web -n web --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/livenessProbe/httpGet/path","value":"/ready"}]'`,
  `kubectl patch deployment web -n web --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/livenessProbe/httpGet","value":{"path":"/ready","port":8080}}]'`,
  containerPatch('"image":"nginx:1.27"'),
  containerPatch('"resources":{"limits":{"memory":"512Mi"}}'),
  podTemplatePatch('{"hostname":"web","dnsPolicy":"ClusterFirst"}'),
  // An Ingress rule's host is no pod field.
  `kubectl patch ingress web -n web -p '{"spec":{"rules":[{"host":"shop.example.com"}]}}'`,
  `kubectl patch ingress web -n web --type=json -p '[{"op":"replace","path":"/spec/rules/0/host","value":"shop.example.com"}]'`,
  `kubectl patch ingress web -n web --type=json -p '[{"op":"replace","path":"/spec/tls/0","value":{"hosts":["shop.example.com"]}}]'`,
  // A host label or annotation, and ordinary annotations.
  `kubectl patch deployment web -n web -p '{"spec":{"template":{"metadata":{"annotations":{"host":"a","prometheus.io/scrape":"true"}}}}}'`,
  `kubectl patch deployment web -n web -p '{"metadata":{"labels":{"host":"a"}}}'`,
  `kubectl patch deployment web -n web -p '{"spec":{"template":{"metadata":{"annotations":{"example.com/apparmor":"note"}}}}}'`,
];

describe("KubectlPolicy: patches may not name any Pod Security Standards baseline control", () => {
  describe("hostPort, hostUsers, runtimeClassName and shareProcessNamespace are Denied", () => {
    it.each(NEW_FIELD_PATCHES)(
      "denies %s in %s",
      (field: string, command: string) => {
        const result: KubectlPolicyResult = evaluate(command);

        expect(result.tier).toBe(KubectlCommandTier.Denied);
        expect(result.verb).toBe("patch");
        expect(result.reason).toContain(
          `kubectl patch that touches ${JSON.parse(`"${field}"`)} is never allowed`,
        );
        expect(result.reason).toContain("host access");
      },
    );
  });

  describe("the AppArmor annotation is Denied", () => {
    it.each(APPARMOR_PATCHES)("denies %s", (command: string) => {
      const result: KubectlPolicyResult = evaluate(command);

      expect(result.tier).toBe(KubectlCommandTier.Denied);
      expect(result.reason.toLowerCase()).toContain(
        "kubectl patch that touches container.apparmor.security.beta.kubernetes.io/web is never allowed",
      );
    });
  });

  describe("a probe's or lifecycle hook's host is Denied", () => {
    it.each(HOST_PATCHES)("denies %s", (command: string) => {
      const result: KubectlPolicyResult = evaluate(command);

      expect(result.tier).toBe(KubectlCommandTier.Denied);
      expect(result.reason).toMatch(HANDLER_HOST_REFUSAL);
    });
  });

  describe("Denied is never promoted: not by Bypass approval, not by a patch entry", () => {
    it.each([
      ...NEW_FIELD_PATCHES.map(([, command]: [string, string]) => {
        return command;
      }),
      ...APPARMOR_PATCHES,
      ...HOST_PATCHES,
    ])("%s", (command: string) => {
      for (const bypassApproval of [false, true]) {
        const verdict: AiRemediationCommandPolicyVerdict =
          KubectlPolicy.evaluateForAutoExecution({
            command,
            allowlistPatterns: [
              "kubectl patch deployment web -n web -p *",
              "kubectl patch deployment web -n web --type=json -p *",
              "kubectl patch deployment web -n web --type=merge -p *",
              command,
            ],
            bypassApproval,
          }).verdict;
        expect(verdict).toBe(AiRemediationCommandPolicyVerdict.Denied);
      }
    });
  });

  describe("negative controls: what a fix patches stays RiskyWrite", () => {
    it.each(STILL_PATCHABLE)("%s", (command: string) => {
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
    });
  });
});
