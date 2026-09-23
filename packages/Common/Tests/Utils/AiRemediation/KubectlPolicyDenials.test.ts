import KubectlPolicy, {
  KubectlAutoExecutionVerdict,
  KubectlPolicyResult,
  KubectlTokenizeResult,
  normalizeKubectlFlagName,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — what the kubectl policy refuses in EVERY mode, even
 * with a human approving (Denied), beyond the verb and flag basics pinned in
 * KubectlPolicy.test.ts:
 *  1. Changes to who may do what, or to what the API server admits and
 *     serves: creating RBAC kinds or ServiceAccounts, set subject, set
 *     serviceaccount, auth reconcile, certificate approve/deny, and EVERY
 *     write verb (label, annotate, patch, set, scale, rollout, ...; delete
 *     through the never-delete list) on roles, cluster roles, their
 *     bindings, admission webhook configurations, admission policies and
 *     their bindings, APIServices and CRDs, in every spelling kubectl
 *     accepts. Reading them stays Read.
 *  2. Wiring identity, privileges, host access, Secrets or a new program into
 *     a pod: patch bodies that touch POD_SECURITY_PATCH_KEYS (by key name,
 *     in strategic-merge and merge keys, strategic-merge directives and
 *     JSON-patch paths, escapes decoded), Pod Security Admission labels on
 *     namespaces, set env --from=secret/..., and every create subcommand
 *     that starts a workload from an image named in the command (create
 *     deployment, create cronjob, create job --image; only `create job NAME
 *     --from=cronjob/NAME` stays, as RiskyWrite, and `set image` on an
 *     existing workload stays RiskyWrite).
 *  3. A patch body that is not JSON, whatever it says: kubectl decodes any
 *     other body as YAML, whose tags, anchors and merge keys can spell a
 *     forbidden field that appears nowhere in the text (checked against the
 *     pinned kubectl v1.36.4 with `patch --local`: each tagged body below
 *     really changed serviceAccountName, hostNetwork or hostPID).
 *  4. Resource categories in any write (all, api-extensions, ...), and every
 *     NEVER_DELETE kind in every spelling kubectl accepts.
 *  5. Anything that could run something other than the command we read: the
 *     kuberc and plugin verbs, any unknown verb or create/set subcommand
 *     (kubectl would run a kubectl-<word> plugin), a verb or subcommand not
 *     in lowercase, and a namespace set twice (the last one wins).
 *  6. Every kubectl v1.36 global flag except -n/--namespace,
 *     --request-timeout and --match-server-version, in every spelling —
 *     "_" for "-" included, because kubectl normalizes it.
 *  7. Property: every command in every Denied table here stays Denied under
 *     bypassApproval, under an allowlist entry that is the command itself,
 *     and under the broadest valid entry of its shape (every word after the
 *     verb a wildcard).
 */

function tier(command: string): KubectlCommandTier {
  return KubectlPolicy.evaluateCommand(command).tier;
}

function reason(command: string): string {
  return KubectlPolicy.evaluateCommand(command).reason;
}

// ---- 1. RBAC, identity and certificates -------------------------------------

const DENIED_IDENTITY_AND_RBAC_SHAPES: Array<string> = [
  "kubectl create clusterrolebinding x --clusterrole=cluster-admin --serviceaccount=ns:sa",
  "kubectl create clusterrolebinding x --clusterrole=view --group=system:authenticated",
  "kubectl create rolebinding x --clusterrole=admin --group=system:authenticated -n web",
  "kubectl create rolebinding x --role=r --user=alice -n web",
  "kubectl create role x --verb=* --resource=* -n web",
  "kubectl create role x --verb=get --resource=pods -n web",
  "kubectl create clusterrole x --verb=* --resource=*",
  "kubectl create clusterrole x --aggregation-rule=rbac.example.com/aggregate=true",
  "kubectl create serviceaccount runner -n web",
  "kubectl create sa runner -n web",
  "kubectl create -n web serviceaccount runner",
  "kubectl create rolebinding x --clusterrole=edit --serviceaccount=web:default -n web --dry-run=client -o yaml",
  "kubectl set subject clusterrolebinding view --serviceaccount=web:sa",
  "kubectl set subject rolebinding/admin -n web --group=system:unauthenticated",
  "kubectl set subject rolebinding admin -n web --user=mallory",
  "kubectl set serviceaccount deployment web privileged-sa -n web",
  "kubectl set serviceaccount deployment/web privileged-sa -n prod",
  "kubectl set sa deployment/web privileged-sa -n prod",
  "kubectl set serviceaccount cronjob nightly admin -n web",
  "kubectl auth reconcile -f rbac.yaml",
  "kubectl auth reconcile",
  "kubectl auth reconcile --remove-extra-permissions",
  "kubectl certificate approve csr-1",
  "kubectl certificate deny csr-1",
  "kubectl certificate approve csr-1 --force",
  'kubectl patch clusterrolebinding view -p \'{"roleRef":{"name":"cluster-admin"}}\'',
  'kubectl patch clusterrolebinding view --type=json -p \'[{"op":"add","path":"/subjects/-","value":{"kind":"Group","name":"system:authenticated"}}]\'',
  'kubectl patch clusterrole view --type=json -p \'[{"op":"add","path":"/rules/0/verbs/-","value":"*"}]\'',
  "kubectl patch rolebindings.rbac.authorization.k8s.io x -n web -p '{}'",
  "kubectl patch role/x -n web -p '{\"rules\":[]}'",
  "kubectl patch roles x -n web -p '{}'",
  "kubectl label clusterrole x rbac.authorization.k8s.io/aggregate-to-admin=true",
  "kubectl label clusterrole x rbac.authorization.k8s.io/aggregate-to-view=true --overwrite",
  "kubectl label clusterrole/x rbac.authorization.k8s.io/aggregate-to-edit=true",
  "kubectl label clusterroles.rbac.authorization.k8s.io x rbac.authorization.k8s.io/aggregate-to-view=true",
  /*
   * These three were pinned RiskyWrite before: a plain label or annotation
   * on an RBAC object. Every write verb on an RBAC kind is Denied now — a
   * label on a ClusterRole can aggregate its rules, and none of them is a
   * workload fix.
   */
  "kubectl label clusterrole x team=a",
  "kubectl annotate rolebinding x -n web owner=sre",
  // Aggregation reads LABELS, but an annotation on a role is still an RBAC write.
  "kubectl annotate clusterrole x rbac.authorization.k8s.io/aggregate-to-admin=true",
  "kubectl delete rolebinding x -n web",
  "kubectl delete role x -n web",
  "kubectl delete roles/x -n web",
  "kubectl delete rolebindings.rbac.authorization.k8s.io x -n web",
  "kubectl delete clusterrolebinding admin",
  "kubectl delete clusterrole/admin",
  // set env --from=secret/... wires a Secret into the workload.
  "kubectl set env deployment/web -n web --from=secret/db-creds",
  "kubectl set env deployment/web -n web --from=secrets/db-creds --prefix=DB_",
  "kubectl set env deployment/web -n web --from=Secret/db-creds",
  // A set subcommand kubectl does not have.
  "kubectl set frobnicate deployment/web -n web",
  "kubectl set",
];

// Neighbours that must keep their tiers: reading RBAC, and plain workload changes.
const ALLOWED_IDENTITY_NEIGHBOURS: Array<[string, KubectlCommandTier]> = [
  ["kubectl get clusterrolebindings -o yaml", KubectlCommandTier.Read],
  ["kubectl get roles -n web", KubectlCommandTier.Read],
  ["kubectl describe rolebinding x -n web", KubectlCommandTier.Read],
  ["kubectl describe clusterrole admin", KubectlCommandTier.Read],
  ["kubectl auth can-i --list", KubectlCommandTier.Read],
  ["kubectl auth can-i create clusterrolebindings", KubectlCommandTier.Read],
  ["kubectl auth whoami", KubectlCommandTier.Read],
  ["kubectl get csr", KubectlCommandTier.Read],
  ["kubectl get serviceaccounts -n web", KubectlCommandTier.Read],
  // A label key that names a kind is not that kind.
  [
    "kubectl label pod web-1 -n web rolebinding=x",
    KubectlCommandTier.SafeWrite,
  ],
  [
    "kubectl label pod web-1 -n web serviceaccount=x",
    KubectlCommandTier.SafeWrite,
  ],
  [
    "kubectl create job x --from=cronjob/y -n web",
    KubectlCommandTier.RiskyWrite,
  ],
  /*
   * `create deployment web --image=nginx` used to be pinned RiskyWrite here;
   * it starts a new workload from an image named in the command and is
   * Denied now (see DENIED_IMAGE_WORKLOAD_CREATES). Changing an EXISTING
   * workload's image stays RiskyWrite (set image, below).
   */
  [
    "kubectl create configmap app --from-literal=a=b -n web",
    KubectlCommandTier.RiskyWrite,
  ],
  ["kubectl create namespace scratch", KubectlCommandTier.RiskyWrite],
  ["kubectl create ns scratch", KubectlCommandTier.RiskyWrite],
  [
    "kubectl create pdb web --selector=app=web --min-available=1 -n web",
    KubectlCommandTier.RiskyWrite,
  ],
  [
    "kubectl create cm app --from-literal=a=b -n web",
    KubectlCommandTier.RiskyWrite,
  ],
  [
    "kubectl set image deployment/web web=nginx:1.27 -n web",
    KubectlCommandTier.RiskyWrite,
  ],
  [
    "kubectl set resources deployment/web -n web --limits=cpu=1",
    KubectlCommandTier.RiskyWrite,
  ],
  [
    "kubectl set env deployment/web -n web LOG_LEVEL=debug",
    KubectlCommandTier.RiskyWrite,
  ],
  [
    "kubectl set env deployment/web -n web --from=configmap/app-config",
    KubectlCommandTier.RiskyWrite,
  ],
  [
    "kubectl set selector svc/web app=web -n web",
    KubectlCommandTier.RiskyWrite,
  ],
];

/*
 * The cluster-control kinds, each in the spellings kubectl accepts: plural,
 * singular, Kind case, short name and group-qualified (with and without a
 * version). The second element says whether the kind is namespaced.
 */
const CLUSTER_CONTROL_KIND_SPELLINGS: Array<[string, boolean]> = [
  ["role", true],
  ["roles", true],
  ["Role", true],
  ["roles.rbac.authorization.k8s.io", true],
  ["roles.v1.rbac.authorization.k8s.io", true],
  ["rolebinding", true],
  ["rolebindings", true],
  ["RoleBinding", true],
  ["rolebindings.rbac.authorization.k8s.io", true],
  ["clusterrole", false],
  ["clusterroles", false],
  ["ClusterRole", false],
  ["clusterroles.rbac.authorization.k8s.io", false],
  ["clusterrolebinding", false],
  ["clusterrolebindings", false],
  ["clusterrolebindings.rbac.authorization.k8s.io", false],
  ["validatingwebhookconfiguration", false],
  ["validatingwebhookconfigurations", false],
  ["ValidatingWebhookConfiguration", false],
  ["validatingwebhookconfigurations.admissionregistration.k8s.io", false],
  ["validatingwebhookconfigurations.v1.admissionregistration.k8s.io", false],
  ["mutatingwebhookconfiguration", false],
  ["mutatingwebhookconfigurations", false],
  ["MutatingWebhookConfiguration", false],
  ["mutatingwebhookconfigurations.admissionregistration.k8s.io", false],
  ["validatingadmissionpolicy", false],
  ["validatingadmissionpolicies", false],
  ["validatingadmissionpolicies.admissionregistration.k8s.io", false],
  ["validatingadmissionpolicybinding", false],
  ["validatingadmissionpolicybindings", false],
  ["validatingadmissionpolicybindings.admissionregistration.k8s.io", false],
  ["mutatingadmissionpolicy", false],
  ["mutatingadmissionpolicies", false],
  ["mutatingadmissionpolicies.v1beta1.admissionregistration.k8s.io", false],
  ["mutatingadmissionpolicybinding", false],
  ["mutatingadmissionpolicybindings", false],
  ["apiservice", false],
  ["apiservices", false],
  ["APIService", false],
  ["apiservices.apiregistration.k8s.io", false],
  ["apiservices.v1.apiregistration.k8s.io", false],
  ["crd", false],
  ["crds", false],
  ["customresourcedefinition", false],
  ["CustomResourceDefinition", false],
  ["customresourcedefinitions.apiextensions.k8s.io", false],
  ["customresourcedefinitions.v1.apiextensions.k8s.io", false],
];

/*
 * Every write verb that takes objects, for one object of `kind` (named
 * "KIND NAME" or "KIND/NAME", by selector, by --all, or in a comma list with
 * an ordinary kind). delete is covered by the never-delete table.
 */
function clusterControlWrites(
  kind: string,
  namespaced: boolean,
): Array<string> {
  const ns: string = namespaced ? " -n web" : "";
  return [
    `kubectl label ${kind} x team=a${ns}`,
    `kubectl label ${kind}/x team=a --overwrite${ns}`,
    `kubectl label ${kind} -l app=x team=a${ns}`,
    `kubectl label pod,${kind} x team=a -n web`,
    `kubectl annotate ${kind} x owner=sre${ns}`,
    `kubectl annotate ${kind} --all owner=sre${ns}`,
    `kubectl patch ${kind} x -p '{"metadata":{"labels":{"a":"b"}}}'${ns}`,
    `kubectl patch ${kind}/x --type=merge -p '{"spec":{}}'${ns}`,
    `kubectl patch ${kind} x --type=json -p '[{"op":"replace","path":"/webhooks/0/rules","value":[]}]'${ns}`,
    `kubectl scale ${kind}/x --replicas=1${ns}`,
    `kubectl set env ${kind}/x A=b${ns}`,
    `kubectl set image ${kind}/x c=img:1${ns}`,
    `kubectl set resources ${kind}/x --limits=cpu=1${ns}`,
    `kubectl set selector ${kind}/x app=x${ns}`,
    `kubectl rollout restart ${kind}/x${ns}`,
    `kubectl rollout undo ${kind} x${ns}`,
    `kubectl taint ${kind} x k=v:NoSchedule${ns}`,
    `kubectl expose ${kind} x --port=80${ns}`,
    `kubectl autoscale ${kind} x --min=1 --max=2${ns}`,
  ];
}

// A few of the rows above, for the property tests at the bottom.
const DENIED_CLUSTER_CONTROL_WRITES: Array<string> = [
  'kubectl patch validatingwebhookconfiguration gatekeeper --type=json -p \'[{"op":"replace","path":"/webhooks/0/rules","value":[]}]\'',
  'kubectl patch validatingwebhookconfigurations.admissionregistration.k8s.io/gatekeeper --type=json -p \'[{"op":"replace","path":"/webhooks/0/failurePolicy","value":"Ignore"}]\'',
  'kubectl patch mutatingwebhookconfiguration istio-sidecar-injector -p \'{"webhooks":[{"name":"x","rules":[]}]}\'',
  'kubectl patch validatingadmissionpolicybinding restricted-pods --type=merge -p \'{"spec":{"validationActions":["Audit"]}}\'',
  'kubectl patch apiservice v1beta1.metrics.k8s.io --type=merge -p \'{"spec":{"service":{"name":"x","namespace":"web"}}}\'',
  'kubectl patch crd certificates.cert-manager.io --type=merge -p \'{"spec":{"conversion":{"strategy":"None"}}}\'',
  "kubectl label validatingwebhookconfiguration gatekeeper a=b",
  "kubectl label mutatingwebhookconfigurations/x a=b",
  "kubectl annotate crd certificates.cert-manager.io a=b",
  "kubectl label clusterrole my-role a=b",
  "kubectl label clusterrolebinding x a=b",
  "kubectl label role/x -n web a=b",
  "kubectl label rolebinding x -n web a=b",
  "kubectl patch validatingwebhookconfiguration -l app=gatekeeper -p '{}'",
  "kubectl label rolebinding x -n kube-system a=b",
];

// Reading the same kinds stays Read: an investigation needs to see them.
const CLUSTER_CONTROL_READS: Array<string> = [
  "kubectl get validatingwebhookconfiguration gatekeeper -o yaml",
  "kubectl get validatingwebhookconfigurations",
  "kubectl describe apiservice v1beta1.metrics.k8s.io",
  "kubectl get crd certificates.cert-manager.io -o yaml",
  "kubectl get validatingadmissionpolicybindings",
  "kubectl describe mutatingwebhookconfiguration istio-sidecar-injector",
  "kubectl get clusterroles",
  "kubectl describe rolebinding x -n web",
];

// Neighbours: the same verbs on ordinary kinds keep their tiers.
const CLUSTER_CONTROL_NEIGHBOURS: Array<[string, KubectlCommandTier]> = [
  ["kubectl label pod web-1 -n web team=a", KubectlCommandTier.SafeWrite],
  ["kubectl label ns web team=a", KubectlCommandTier.RiskyWrite],
  [
    "kubectl annotate svc web -n web example.com/owner=sre",
    KubectlCommandTier.RiskyWrite,
  ],
  [
    'kubectl patch deployment web -n web -p \'{"spec":{"replicas":2}}\'',
    KubectlCommandTier.RiskyWrite,
  ],
  [
    'kubectl patch certificates.cert-manager.io web -n web --type=merge -p \'{"spec":{"renewBefore":"48h"}}\'',
    KubectlCommandTier.RiskyWrite,
  ],
  [
    "kubectl label pod web-1 -n web validatingwebhookconfiguration=x",
    KubectlCommandTier.SafeWrite,
  ],
];

// ---- 2. Running a different program or identity ------------------------------

const DENIED_CREATE_JOB_SHAPES: Array<string> = [
  "kubectl create job pwn --image=evil/img -n kube-system",
  "kubectl create job x --image=busybox -n web",
  "kubectl create job x --image=busybox -n web -- sh -c 'cat /var/run/secrets/*'",
  "kubectl create job x --from=cronjob/y --image=busybox -n web",
  "kubectl create job x -n web",
  "kubectl create job x --from=deployment/web -n web",
  "kubectl create job x --from=cronjob/ -n web",
  "kubectl create job x --from=cronjob -n web",
  "kubectl create job x --from=cronjobs.example.com/y -n web",
  "kubectl create job x --from=cronjob/y --from=cronjob/z -n web",
  "kubectl create job x y --from=cronjob/z -n web",
  "kubectl create job x --from=cronjob/y -n web -- sh",
];

/*
 * Every create subcommand that makes a pod template, with an image named in
 * the command or a program after `--`: a new program in the cluster, the
 * same thing `create job --image` and a patch touching command/args are
 * refused for. kubectl requires --image for create deployment and create
 * cronjob (checked against the pinned v1.36.4: `required flag(s) "image" not
 * set`), so both are Denied in every form — with and without a command, in
 * every alias.
 */
const DENIED_IMAGE_WORKLOAD_CREATES: Array<string> = [
  "kubectl create deployment web --image=nginx -n web",
  "kubectl create deployment x --image=busybox -n web -- sh -c evil",
  "kubectl create deploy x --image=busybox --replicas=2 -n web -- sh",
  "kubectl create deployment x --image=busybox -r 3 --port=80 -n web",
  "kubectl create deployment x -n web",
  "kubectl create cronjob x --image=busybox --schedule='* * * * *' -n web -- sh -c evil",
  "kubectl create cj x --image=busybox --schedule='* * * * *' -n web -- date",
  "kubectl create cronjob x --image=nginx --schedule='0 * * * *' -n web",
  "kubectl create cronjob x --schedule='0 * * * *' -n web",
  "kubectl create -n web cronjob x --image=nginx --schedule='0 * * * *'",
  "kubectl create deployment x --image=busybox -n web --dry-run=client -o yaml",
];

/*
 * The pod-template create subcommands in every alias kubectl accepts, for
 * the parity test: each one refuses an image named in the command and a
 * program after `--`.
 */
const POD_TEMPLATE_CREATE_SUBCOMMANDS: Array<string> = [
  "deployment",
  "deploy",
  "cronjob",
  "cj",
  "job",
];

const ALLOWED_CREATE_JOB_SHAPES: Array<string> = [
  "kubectl create job manual-run --from=cronjob/nightly -n web",
  "kubectl create job manual-run --from=cronjobs/nightly -n web",
  "kubectl create job manual-run --from=cj/nightly -n web",
  "kubectl create job manual-run --from=cronjob.batch/nightly -n web",
  "kubectl create job --from=cronjob/nightly manual-run -n web",
  "kubectl create -n web job manual-run --from=cronjob/nightly",
  "kubectl create job manual-run --from=cronjob/nightly -n web --dry-run=client -o yaml",
];

/*
 * Patch bodies that touch a field that changes which identity, privileges,
 * host access, Secrets or program a pod runs with.
 */
const POD_SECURITY_FIELDS: Array<string> = [
  "serviceAccountName",
  "serviceAccount",
  "automountServiceAccountToken",
  "securityContext",
  "privileged",
  "capabilities",
  "hostPath",
  "hostNetwork",
  "hostPID",
  "hostIPC",
  "volumes",
  "volumeMounts",
  "initContainers",
  "ephemeralContainers",
  "command",
  "args",
  "envFrom",
  "secretKeyRef",
  "secretRef",
  "secretName",
];

function podTemplatePatch(fragment: string): string {
  return `kubectl patch deployment web -n web -p '{"spec":{"template":{"spec":${fragment}}}}'`;
}

const DENIED_PATCH_BODIES: Array<string> = [
  // Every forbidden key as a strategic-merge key...
  ...POD_SECURITY_FIELDS.map((field: string) => {
    return podTemplatePatch(`{"${field}":true}`);
  }),
  // ... as a merge-patch key ...
  ...POD_SECURITY_FIELDS.map((field: string) => {
    return `kubectl patch deployment web -n web --type=merge -p '{"spec":{"template":{"spec":{"${field}":true}}}}'`;
  }),
  // ... as a JSON-patch path segment ...
  ...POD_SECURITY_FIELDS.map((field: string) => {
    return `kubectl patch deployment web -n web --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/${field}","value":1}]'`;
  }),
  /*
   * ... and as a YAML key. Still Denied, but now because the body is not
   * JSON at all (see NON_JSON_PATCH_BODIES), not because the word was found.
   */
  ...POD_SECURITY_FIELDS.map((field: string) => {
    return `kubectl patch deployment web -n web -p 'spec: {template: {spec: {${field}: x}}}'`;
  }),
  // Nested where a real escalation puts them.
  podTemplatePatch(
    '{"containers":[{"name":"web","securityContext":{"privileged":true}}]}',
  ),
  podTemplatePatch(
    '{"volumes":[{"name":"creds","secret":{"secretName":"db-creds"}}]}',
  ),
  podTemplatePatch(
    '{"containers":[{"name":"web","env":[{"name":"P","valueFrom":{"secretKeyRef":{"name":"db","key":"p"}}}]}]}',
  ),
  podTemplatePatch(
    '{"containers":[{"name":"web","command":["sh","-c","id"]}]}',
  ),
  podTemplatePatch('{"hostNetwork":true,"hostPID":true}'),
  'kubectl patch pod web-abc -n prod -p \'{"spec":{"ephemeralContainers":[{"name":"x","image":"busybox"}]}}\'',
  'kubectl patch cronjob nightly -n web -p \'{"spec":{"jobTemplate":{"spec":{"template":{"spec":{"serviceAccountName":"admin"}}}}}}\'',
  'kubectl patch daemonset kube-proxy -n web --type=json -p \'[{"op":"replace","path":"/spec/template/spec/hostNetwork","value":true}]\'',
  'kubectl patch deployment web -n web --type=json -p \'[{"op":"move","from":"/spec/template/spec/initContainers","path":"/spec/x"}]\'',
  // Case does not matter, and neither do escapes: JSON is decoded first.
  podTemplatePatch('{"ServiceAccountName":"admin"}'),
  podTemplatePatch('{"HOSTNETWORK":true}'),
  podTemplatePatch('{"serviceAccount\\u004eame":"admin"}'),
  'kubectl patch deployment web -n web --type=json -p \'[{"op":"add","path":"/spec/template/spec/serviceAccount\\u004eame","value":"admin"}]\'',
  // Strategic-merge directives name the list they edit after the slash.
  podTemplatePatch('{"$setElementOrder/volumes":[{"name":"x"}]}'),
  podTemplatePatch(
    '{"containers":[{"name":"web","$deleteFromPrimitiveList/args":["--safe"]}]}',
  ),
  // Pod Security Admission labels, through patch.
  'kubectl patch ns web -p \'{"metadata":{"labels":{"pod-security.kubernetes.io/enforce":"privileged"}}}\'',
  'kubectl patch namespace web --type=json -p \'[{"op":"remove","path":"/metadata/labels/pod-security.kubernetes.io~1enforce"}]\'',
  // Both spellings of the flag.
  'kubectl patch deployment web -n web --patch \'{"spec":{"template":{"spec":{"hostPID":true}}}}\'',
  'kubectl patch deployment web -n web --patch=\'{"spec":{"template":{"spec":{"hostIPC":true}}}}\'',
  // The body kubectl uses is the last one; every body is checked.
  'kubectl patch deployment web -n web -p \'{"spec":{"replicas":2}}\' --patch=\'{"spec":{"template":{"spec":{"hostPID":true}}}}\'',
];

/*
 * ---- 3. Patch bodies that are not JSON ---------------------------------------
 *
 * kubectl sends a body starting with "{" to the API server unchanged and
 * decodes every other body — a JSON patch's "[" included — as YAML 1.1. A
 * YAML tag builds a key or a JSON-patch path out of base64, so the field
 * name appears nowhere in the text: `!!binary c2VydmljZUFjY291bnROYW1l` is
 * serviceAccountName, aG9zdE5ldHdvcms= is hostNetwork, aG9zdFBJRA== is
 * hostPID. The old check scanned a non-JSON body for literal words and tiered
 * these RiskyWrite (AutoApproved under Bypass approval); the pinned kubectl
 * applied every one of them.
 */
const TAGGED_YAML_PATCH_BODIES: Array<string> = [
  // strategic merge (the default type)
  "kubectl patch deployment web -n web -p 'spec: {template: {spec: {!!binary c2VydmljZUFjY291bnROYW1l: default}}}'",
  "kubectl patch deployment web -n web --type=strategic -p 'spec: {template: {spec: {!!binary aG9zdE5ldHdvcms=: true}}}'",
  "kubectl patch deployment web -n web -p 'spec: {template: {spec: {? !!binary aG9zdFBJRA== : true}}}'",
  // merge
  "kubectl patch deployment web -n web --type=merge -p 'spec: {template: {spec: {? !!binary aG9zdE5ldHdvcms= : true}}}'",
  "kubectl patch deployment web -n web --type merge -p 'spec: {template: {spec: {!!binary c2VydmljZUFjY291bnROYW1l: default}}}'",
  // json: the path is the tagged value
  "kubectl patch deployment web -n web --type=json -p '[{op: replace, path: !!binary L3NwZWMvdGVtcGxhdGUvc3BlYy9zZXJ2aWNlQWNjb3VudE5hbWU=, value: default}]'",
  "kubectl patch deployment web -n web --type=json -p '[{op: add, path: !!binary L3NwZWMvdGVtcGxhdGUvc3BlYy9ob3N0TmV0d29yaw==, value: true}]'",
  // The verbatim tag form, and a %TAG-free local tag.
  "kubectl patch deployment web -n web -p 'spec: {template: {spec: {!<tag:yaml.org,2002:binary> aG9zdFBJRA==: true}}}'",
  "kubectl patch deployment web -n web --type=merge -p 'spec: {template: {spec: {!<tag:yaml.org,2002:binary> c2VydmljZUFjY291bnROYW1l: default}}}'",
  // A Pod Security Admission label spelled through a tag.
  "kubectl patch ns web -p 'metadata: {labels: {!!binary cG9kLXNlY3VyaXR5Lmt1YmVybmV0ZXMuaW8vZW5mb3JjZQ==: privileged}}'",
  // Anchors, aliases and merge keys.
  "kubectl patch deployment web -n web -p 'spec: {template: {spec: {a: &k hostNetwork, *k : true}}}'",
  "kubectl patch deployment web -n web --type=merge -p 'spec: {<<: {replicas: 4}}'",
  "kubectl patch deployment web -n web --type=json -p '[&op {op: replace, path: /spec/replicas, value: 2}, *op]'",
];

/*
 * Plain YAML with only harmless fields is Denied too, although kubectl
 * would apply it: the policy cannot tell harmless YAML from tagged YAML
 * without decoding YAML exactly as kubectl does, and every patch a fix needs
 * can be written as JSON (the refusal says so). These were RiskyWrite
 * before.
 */
const PLAIN_YAML_PATCH_BODIES: Array<string> = [
  "kubectl patch deployment web -n web -p 'spec: {replicas: 2}'",
  "kubectl patch deployment web -n web --type=merge -p 'spec: {replicas: 2}'",
  "kubectl patch deployment web -n web --type=json -p '[{op: replace, path: /spec/replicas, value: 3}]'",
  "kubectl patch cronjob nightly -n web -p 'spec: {suspend: true}'",
  "kubectl patch ns web -p 'metadata: {labels: {pod-security.kubernetes.io/enforce: privileged}}'",
  // A YAML escape, the old check's only refusal besides the word scan.
  "kubectl patch deployment web -n web -p 'spec: {template: {spec: {\"serviceAccount\\x4eame\": admin}}}'",
  // Not a body at all.
  "kubectl patch deployment web -n web -p ''",
  "kubectl patch deployment web -n web -p replicas=2",
  /*
   * Almost JSON: a JSON patch with a trailing comment (kubectl decodes a "["
   * body as YAML and would apply it), and a trailing comma.
   */
  'kubectl patch deployment web -n web --type=json -p \'[{"op":"replace","path":"/spec/replicas","value":3}] # c\'',
  'kubectl patch deployment web -n web -p \'{"spec":{"replicas":2},}\'',
];

const NON_JSON_PATCH_BODIES: Array<string> = [
  ...TAGGED_YAML_PATCH_BODIES,
  ...PLAIN_YAML_PATCH_BODIES,
];

/*
 * Negative controls: JSON bodies that change only what a fix changes stay
 * RiskyWrite — and so still run under Bypass approval or a matching
 * allowlist entry.
 */
const ALLOWED_PATCH_BODIES: Array<string> = [
  'kubectl patch deployment web -n web -p \'{"spec":{"replicas":2}}\'',
  'kubectl patch deployment web -n web --type=merge -p \'{"spec":{"replicas":2}}\'',
  podTemplatePatch(
    '{"containers":[{"name":"web","resources":{"limits":{"memory":"1Gi"}}}]}',
  ),
  podTemplatePatch('{"containers":[{"name":"web","image":"nginx:1.27"}]}'),
  podTemplatePatch(
    '{"containers":[{"name":"web","env":[{"name":"LOG_LEVEL","value":"debug"}]}]}',
  ),
  'kubectl patch deployment web -n web -p \'{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"2026-09-22T00:00:00Z"}}}}}\'',
  // A forbidden word as a VALUE is just text in a JSON body.
  'kubectl patch deployment web -n web -p \'{"metadata":{"annotations":{"note":"fixed command args volumes"}}}\'',
  'kubectl patch deployment web -n web -p \'{"metadata":{"annotations":{"path":"/spec/command"}}}\'',
  // YAML syntax inside a JSON string is only text, to JSON and YAML alike.
  'kubectl patch deployment web -n web -p \'{"metadata":{"annotations":{"note":"!!binary c2VydmljZUFjY291bnROYW1l &a *a <<"}}}\'',
  'kubectl patch deployment web -n web --type=json -p \'[{"op":"replace","path":"/spec/replicas","value":3}]\'',
  'kubectl patch deployment web -n web --type=json -p \'[ {"op":"replace","path":"/spec/replicas","value":3} ]\'',
  'kubectl patch cronjob nightly -n web -p \'{"spec":{"suspend":true}}\'',
  'kubectl patch hpa web -n web -p \'{"spec":{"minReplicas":3}}\'',
  'kubectl patch pdb web -n web -p \'{"spec":{"minAvailable":1}}\'',
  "kubectl patch deployment web -n web -p '{}'",
];

// Allowlist entries an operator could write for patches (all valid, none broad).
const PATCH_ALLOWLIST_ENTRIES: Array<string> = [
  "kubectl patch deployment web -n web -p *",
  "kubectl patch deployment web -n web --type=merge -p *",
  "kubectl patch deployment web -n web --type=json -p *",
  "kubectl patch deployment web -n web --type=strategic -p *",
  "kubectl patch deployment web -n web --type merge -p *",
];

// ---- 4. Categories and never-delete kinds, in every spelling ---------------------

const DENIED_CATEGORY_WRITES: Array<string> = [
  "kubectl delete api-extensions -l app.kubernetes.io/instance=cert-manager",
  "kubectl delete api-extensions -l '!x'",
  "kubectl delete api-extensions foo",
  "kubectl delete api-extensions/foo",
  "kubectl delete API-Extensions -l app=x",
  "kubectl delete pods,api-extensions -l app=x",
  "kubectl delete api-extensions,pods -l app=x",
  "kubectl delete deployments,api-extensions -l app=x -n web",
  "kubectl delete all -l app=web -n web",
  "kubectl delete all web -n web",
  "kubectl delete all --all -n web",
  "kubectl delete ALL -l app=web -n web",
  "kubectl delete managed -l crossplane.io/claim-name=db",
  "kubectl delete crossplane -l x=y",
  "kubectl delete gateway-api -l x=y -n web",
  "kubectl delete cert-manager -l x=y -n web",
  "kubectl delete knative -l x=y -n web",
  "kubectl label api-extensions -l x=y a=b",
  "kubectl label all -l app=web a=b -n web",
  "kubectl annotate all -n web --all a=b",
  "kubectl patch all web -n web -p '{}'",
  "kubectl rollout restart all -n web",
  "kubectl rollout undo all/web -n web",
  "kubectl scale all --all --replicas=1 -n web",
  "kubectl set image all web=nginx -n web",
];

// Reading a category is fine.
const ALLOWED_CATEGORY_READS: Array<string> = [
  "kubectl get all -n web",
  "kubectl get api-extensions",
  "kubectl get all -A",
  "kubectl describe all -n web",
];

/*
 * Every NEVER_DELETE kind, in the spellings kubectl accepts: plural,
 * singular, short name, Kind case, group-qualified, TYPE/NAME, comma lists,
 * and behind optional-value flags.
 */
const DENIED_NEVER_DELETE_SPELLINGS: Array<string> = [
  "kubectl delete namespace prod",
  "kubectl delete namespaces prod",
  "kubectl delete ns prod",
  "kubectl delete Namespace prod",
  "kubectl delete namespaces.v1. prod",
  "kubectl delete ns/prod",
  "kubectl delete node worker-1",
  "kubectl delete nodes worker-1",
  "kubectl delete no worker-1",
  "kubectl delete node/worker-1",
  "kubectl delete pv data-1",
  "kubectl delete persistentvolumes data-1",
  "kubectl delete PersistentVolume data-1",
  "kubectl delete pvc data-0 -n web",
  "kubectl delete persistentvolumeclaims data-0 -n web",
  "kubectl delete persistentvolumeclaim/data-0 -n web",
  "kubectl delete crd certificates.cert-manager.io",
  "kubectl delete crds certificates.cert-manager.io",
  "kubectl delete CustomResourceDefinition certificates.cert-manager.io",
  "kubectl delete customresourcedefinitions.apiextensions.k8s.io certificates.cert-manager.io",
  "kubectl delete customresourcedefinitions.v1.apiextensions.k8s.io/certificates.cert-manager.io",
  "kubectl delete clusterrole admin",
  "kubectl delete clusterroles.rbac.authorization.k8s.io admin",
  "kubectl delete clusterrolebinding admin",
  "kubectl delete clusterrolebindings/admin",
  "kubectl delete role x -n web",
  "kubectl delete rolebinding x -n web",
  "kubectl delete sc standard",
  "kubectl delete storageclasses.storage.k8s.io standard",
  "kubectl delete secret db -n web",
  "kubectl delete secrets.v1. db -n web",
  "kubectl delete pc high",
  "kubectl delete priorityclasses.scheduling.k8s.io high",
  "kubectl delete apiservice v1beta1.metrics.k8s.io",
  "kubectl delete apiservices.apiregistration.k8s.io v1beta1.metrics.k8s.io",
  "kubectl delete mutatingwebhookconfiguration istio-sidecar-injector",
  "kubectl delete mutatingwebhookconfigurations.admissionregistration.k8s.io x",
  "kubectl delete validatingwebhookconfiguration gatekeeper",
  "kubectl delete validatingwebhookconfigurations/gatekeeper",
  "kubectl delete validatingadmissionpolicy p",
  "kubectl delete validatingadmissionpolicies.admissionregistration.k8s.io p",
  "kubectl delete validatingadmissionpolicybindings foo",
  "kubectl delete mutatingadmissionpolicy p",
  "kubectl delete mutatingadmissionpolicybindings/p",
  "kubectl delete csr csr-1",
  "kubectl delete certificatesigningrequests csr-1",
  "kubectl delete pod,ns web-1 prod -n web",
  "kubectl delete deployment,crd web x -n web",
  "kubectl delete --cascade=orphan crd x",
  "kubectl delete --cascade node worker-1",
  "kubectl delete -n web --dry-run=server pvc data-0",
];

// ---- 5. Verbs and subcommands kubectl would not run as written --------------------

const DENIED_VERB_SHAPES: Array<string> = [
  "kubectl kuberc view",
  "kubectl kuberc set --section defaults --command get --option output=wide",
  "kubectl plugin list",
  "kubectl frobnicate pods",
  "kubectl get-pods",
  "kubectl pods",
  "kubectl node-shell worker-1",
  "kubectl krew install x",
  "kubectl ctx prod",
  "kubectl whoami",
  // cobra matches commands case-sensitively; kubectl would look for a plugin.
  "kubectl Get pods",
  "kubectl GET pods -n web",
  "kubectl Describe pod x",
  "kubectl Delete pod web-1 -n web",
  "kubectl Rollout restart deployment/web -n web",
  "kubectl rollout Restart deployment/web -n web",
  "kubectl rollout STATUS deployment/web -n web",
  "kubectl set Image deployment/web web=nginx -n web",
  "kubectl create Job x --from=cronjob/y -n web",
  "kubectl create ConfigMap x --from-literal=a=b -n web",
  "kubectl auth Can-I get pods",
  "kubectl top Pod -n web",
  "kubectl cluster-info Dump",
  // create subcommands kubectl does not have (kubectl-create-<name> plugins).
  "kubectl create frobnicate x -n web",
  "kubectl create deployments web --image=nginx -n web",
  "kubectl create secrets generic x --from-literal=a=b -n web",
  "kubectl create pod x -n web",
  "kubectl create",
  // A namespace set twice (pflag keeps the last one).
  "kubectl get pods -n a -n b",
  "kubectl -n a get pods --namespace=b",
  "kubectl get pods -na --namespace b",
  "kubectl -n web get pods -n kube-system",
  "kubectl -n web patch deployment web -p '{}' -n kube-system",
  "kubectl patch deployment web -n web -p '{}' --namespace=kube-system",
  "kubectl scale deployment web --replicas=1 -n prod -n kube-system",
  "kubectl delete pod web-1 -n web -nkube-system",
  "kubectl get pods -n web -n web",
];

// ---- 6. Global flags ------------------------------------------------------------

/*
 * kubectl v1.36.4's global flags. Every one may change which credentials,
 * identity or cluster kubectl uses, write a file on the Runner, or log
 * request bodies — except these four, which the policy allows.
 */
const ALLOWED_GLOBAL_FLAGS: Array<string> = [
  "n",
  "namespace",
  "request-timeout",
  "match-server-version",
];

const KUBECTL_1_36_GLOBAL_FLAGS: Array<string> = [
  "as",
  "as-group",
  "as-uid",
  "as-user-extra",
  "cache-dir",
  "certificate-authority",
  "client-certificate",
  "client-key",
  "cluster",
  "context",
  "disable-compression",
  "insecure-skip-tls-verify",
  "kubeconfig",
  "kuberc",
  "log-flush-frequency",
  "match-server-version",
  "n",
  "namespace",
  "password",
  "profile",
  "profile-output",
  "request-timeout",
  "s",
  "server",
  "tls-server-name",
  "token",
  "user",
  "username",
  "v",
  "vmodule",
  "warnings-as-errors",
];

const DENIED_GLOBAL_FLAGS: Array<string> = KUBECTL_1_36_GLOBAL_FLAGS.filter(
  (flag: string) => {
    return !ALLOWED_GLOBAL_FLAGS.includes(flag);
  },
);

function flagSpellings(flag: string): Array<string> {
  const dash: string = flag.length === 1 ? `-${flag}` : `--${flag}`;
  const spellings: Array<string> = [
    `kubectl get pods ${dash}=x`,
    `kubectl get pods ${dash} x`,
    `kubectl get pods -n web ${dash}=x`,
    `kubectl delete pod web-1 -n web ${dash}=x`,
    `kubectl rollout restart deployment/web -n web ${dash}=x`,
  ];
  if (flag.length > 1) {
    spellings.push(`kubectl ${dash}=x get pods`);
  }
  if (flag.includes("-")) {
    // kubectl reads "_" as "-" in a long flag name.
    const underscored: string = `--${flag.replace(/-/g, "_")}`;
    spellings.push(`kubectl get pods ${underscored}=x`);
    spellings.push(`kubectl get pods ${underscored} x`);
    spellings.push(
      `kubectl scale deployment/web --replicas=2 -n web ${underscored}=x`,
    );
  }
  if (flag.length === 1) {
    // Hidden in a short-flag cluster.
    spellings.push(`kubectl get pods -A${flag} x`);
  }
  return spellings;
}

const DENIED_GLOBAL_FLAG_SHAPES: Array<string> = DENIED_GLOBAL_FLAGS.flatMap(
  (flag: string) => {
    return flagSpellings(flag);
  },
);

const ALLOWED_GLOBAL_FLAG_SHAPES: Array<[string, KubectlCommandTier]> = [
  ["kubectl get pods -n web", KubectlCommandTier.Read],
  ["kubectl get pods --namespace=web", KubectlCommandTier.Read],
  ["kubectl get pods --request-timeout=30s -n web", KubectlCommandTier.Read],
  ["kubectl get pods --request_timeout=30s -n web", KubectlCommandTier.Read],
  ["kubectl get pods --match-server-version -n web", KubectlCommandTier.Read],
  ["kubectl get pods --match_server_version -n web", KubectlCommandTier.Read],
  [
    "kubectl --request-timeout=5s -n web delete pod web-1",
    KubectlCommandTier.SafeWrite,
  ],
  ["kubectl get pods --all_namespaces", KubectlCommandTier.Read],
  [
    "kubectl get pods --field_selector=status.phase=Pending",
    KubectlCommandTier.Read,
  ],
  [
    "kubectl scale deployment web --replicas=2 --current_replicas=1 -n web",
    KubectlCommandTier.SafeWrite,
  ],
];

// ---- Every Denied table, for the property tests -----------------------------------

const ALL_DENIED_COMMANDS: Array<string> = [
  ...DENIED_IDENTITY_AND_RBAC_SHAPES,
  ...DENIED_CLUSTER_CONTROL_WRITES,
  ...DENIED_CREATE_JOB_SHAPES,
  ...DENIED_IMAGE_WORKLOAD_CREATES,
  ...DENIED_PATCH_BODIES,
  ...NON_JSON_PATCH_BODIES,
  ...DENIED_CATEGORY_WRITES,
  ...DENIED_NEVER_DELETE_SPELLINGS,
  ...DENIED_VERB_SHAPES,
  ...DENIED_GLOBAL_FLAG_SHAPES,
];

/*
 * The broadest allowlist entry of a command's shape: the verb (and a
 * subcommand) kept, every flag spelled as written with any "=value" globbed,
 * and every other word a wildcard. It is a valid entry whenever the verb is
 * one OneUptime AI may run, and it matches the command whenever no word has
 * a space in it.
 */
function broadestShapeOf(command: string): string {
  const args: Array<string> = KubectlPolicy.tokenize(command).args || [];
  const keep: number = [
    "rollout",
    "set",
    "create",
    "auth",
    "cluster-info",
    "top",
  ].includes(args[0] || "")
    ? 2
    : 1;
  return [
    "kubectl",
    ...args.map((arg: string, index: number) => {
      if (index < keep) {
        return arg;
      }
      if (arg.startsWith("-") && arg !== "-") {
        return arg.includes("=") ? `${arg.slice(0, arg.indexOf("="))}=*` : arg;
      }
      return "*";
    }),
  ].join(" ");
}

describe("KubectlPolicy denials", () => {
  describe("changes to who may do what are Denied", () => {
    it.each(DENIED_IDENTITY_AND_RBAC_SHAPES)("denies %s", (command: string) => {
      const result: KubectlPolicyResult =
        KubectlPolicy.evaluateCommand(command);
      expect(result.tier).toBe(KubectlCommandTier.Denied);
      expect(result.reason.length).toBeGreaterThan(0);
    });

    it.each(ALLOWED_IDENTITY_NEIGHBOURS)(
      "keeps %s at %s",
      (command: string, expected: KubectlCommandTier) => {
        expect(tier(command)).toBe(expected);
      },
    );

    it("explains an RBAC grant as a privilege grant", () => {
      expect(
        reason(
          "kubectl create clusterrolebinding x --clusterrole=cluster-admin --serviceaccount=ns:sa",
        ),
      ).toContain("privilege grant");
      expect(
        reason(
          "kubectl set subject clusterrolebinding view --serviceaccount=web:sa",
        ),
      ).toContain("privilege grant");
      expect(
        reason(
          'kubectl patch clusterrolebinding view -p \'{"roleRef":{"name":"cluster-admin"}}\'',
        ),
      ).toContain("clusterrolebinding objects is never allowed");
      expect(
        reason("kubectl set serviceaccount deployment web sa -n web"),
      ).toContain("identity");
      expect(
        reason(
          "kubectl label clusterrole x rbac.authorization.k8s.io/aggregate-to-admin=true",
        ),
      ).toContain("admin/edit/view");
      expect(
        KubectlPolicy.evaluateCommand("kubectl create sa x -n web").verb,
      ).toBe("create serviceaccount");
    });
  });

  describe("every write to an RBAC, admission or API-extension kind is Denied", () => {
    it.each(CLUSTER_CONTROL_KIND_SPELLINGS)(
      "denies every write verb on %s, and nothing lifts it",
      (kind: string, namespaced: boolean) => {
        for (const command of clusterControlWrites(kind, namespaced)) {
          const result: KubectlPolicyResult =
            KubectlPolicy.evaluateCommand(command);
          expect({ command, tier: result.tier }).toEqual({
            command,
            tier: KubectlCommandTier.Denied,
          });
          expect(result.reason).toContain("is never allowed for OneUptime AI");

          const verdict: KubectlAutoExecutionVerdict =
            KubectlPolicy.evaluateForAutoExecution({
              command,
              allowlistPatterns: [command, broadestShapeOf(command)],
              bypassApproval: true,
            });
          expect({ command, verdict: verdict.verdict }).toEqual({
            command,
            verdict: AiRemediationCommandPolicyVerdict.Denied,
          });
        }

        // Deleting one is refused by the never-delete list.
        expect(
          tier(`kubectl delete ${kind} x${namespaced ? " -n web" : ""}`),
        ).toBe(KubectlCommandTier.Denied);
        // Reading one stays Read.
        expect(tier(`kubectl get ${kind} x -o yaml`)).toBe(
          KubectlCommandTier.Read,
        );
        expect(tier(`kubectl describe ${kind}/x`)).toBe(
          KubectlCommandTier.Read,
        );
      },
    );

    it.each(DENIED_CLUSTER_CONTROL_WRITES)("denies %s", (command: string) => {
      expect(tier(command)).toBe(KubectlCommandTier.Denied);
    });

    it.each(CLUSTER_CONTROL_READS)("keeps %s Read", (command: string) => {
      expect(tier(command)).toBe(KubectlCommandTier.Read);
      expect(
        KubectlPolicy.evaluateForAutoExecution({
          command,
          allowlistPatterns: [],
        }).verdict,
      ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
    });

    it.each(CLUSTER_CONTROL_NEIGHBOURS)(
      "keeps the neighbour %s at %s",
      (command: string, expected: KubectlCommandTier) => {
        expect(tier(command)).toBe(expected);
      },
    );

    it("says what an admission or API-extension change does, and who makes it", () => {
      const text: string = reason(
        'kubectl patch validatingadmissionpolicybinding restricted-pods --type=merge -p \'{"spec":{"validationActions":["Audit"]}}\'',
      );
      expect(text).toContain(
        "validatingadmissionpolicybinding objects is never allowed",
      );
      expect(text).toContain("what the API server admits and serves");
      expect(text).toContain("a human makes that change");
      expect(
        KubectlPolicy.evaluateCommand(
          "kubectl label apiservices.apiregistration.k8s.io/v1beta1.metrics.k8s.io a=b",
        ).verb,
      ).toBe("label apiservice");
      expect(reason("kubectl annotate rolebinding x -n web a=b")).toContain(
        "privilege grant",
      );
    });
  });

  describe("create job only re-runs an existing CronJob", () => {
    it.each(DENIED_CREATE_JOB_SHAPES)("denies %s", (command: string) => {
      expect(tier(command)).toBe(KubectlCommandTier.Denied);
    });

    it.each(ALLOWED_CREATE_JOB_SHAPES)(
      "keeps %s RiskyWrite",
      (command: string) => {
        expect(tier(command)).toBe(KubectlCommandTier.RiskyWrite);
      },
    );

    it("says what to write instead", () => {
      expect(reason("kubectl create job x --image=busybox -n web")).toContain(
        "--from=cronjob/NAME",
      );
      expect(reason("kubectl create job x -n web")).toContain(
        "--from=cronjob/NAME",
      );
    });
  });

  describe("no create subcommand starts a workload from an image named in the command", () => {
    it.each(DENIED_IMAGE_WORKLOAD_CREATES)("denies %s", (command: string) => {
      const result: KubectlPolicyResult =
        KubectlPolicy.evaluateCommand(command);
      expect(result.tier).toBe(KubectlCommandTier.Denied);
      expect(result.verb).toMatch(/^create (deployment|cronjob)$/);
      // It says why (a new program running an image) and what to do instead.
      expect(result.reason).toContain("image");
      expect(result.reason).toContain("new program");
      expect(result.reason).toContain("--from=cronjob/NAME");
      expect(
        KubectlPolicy.evaluateForAutoExecution({
          command,
          allowlistPatterns: [command, broadestShapeOf(command)],
          bypassApproval: true,
        }).verdict,
      ).toBe(AiRemediationCommandPolicyVerdict.Denied);
    });

    it.each(POD_TEMPLATE_CREATE_SUBCOMMANDS)(
      "create %s: an image in the command or a program after -- is Denied, whatever else it says",
      (subcommand: string) => {
        const schedule: string =
          subcommand === "cronjob" || subcommand === "cj"
            ? " --schedule='*/5 * * * *'"
            : "";
        for (const command of [
          `kubectl create ${subcommand} x --image=busybox${schedule} -n web`,
          `kubectl create ${subcommand} x --image busybox${schedule} -n web`,
          `kubectl create ${subcommand} x --image=busybox${schedule} -n web -- sh -c 'id'`,
          `kubectl create ${subcommand} x --image=registry.example.com/web:1.2.3${schedule} -n web --dry-run=client`,
          `kubectl create -n web ${subcommand} x --image=busybox${schedule}`,
          `kubectl create ${subcommand} x --image=busybox${schedule} -n kube-system`,
        ]) {
          expect({ command, tier: tier(command) }).toEqual({
            command,
            tier: KubectlCommandTier.Denied,
          });
          expect(
            KubectlPolicy.evaluateForAutoExecution({
              command,
              allowlistPatterns: [command],
              bypassApproval: true,
            }).verdict,
          ).toBe(AiRemediationCommandPolicyVerdict.Denied);
        }
      },
    );

    it("keeps re-running an existing CronJob, and changing an existing workload's image, RiskyWrite (negative controls)", () => {
      for (const command of [
        "kubectl create job x --from=cronjob/y -n web",
        "kubectl create job manual-run --from=cj/nightly -n web",
        "kubectl set image deployment/web web=img:2 -n web",
        "kubectl set image cronjob/nightly job=img:2 -n web",
      ]) {
        expect({ command, tier: tier(command) }).toEqual({
          command,
          tier: KubectlCommandTier.RiskyWrite,
        });
        // A human, the allowlist or Bypass approval decides.
        expect(
          KubectlPolicy.evaluateForAutoExecution({
            command,
            allowlistPatterns: [],
          }).verdict,
        ).toBe(AiRemediationCommandPolicyVerdict.RequiresApproval);
        expect(
          KubectlPolicy.evaluateForAutoExecution({
            command,
            allowlistPatterns: [command],
          }).verdict,
        ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
        expect(
          KubectlPolicy.evaluateForAutoExecution({
            command,
            allowlistPatterns: [],
            bypassApproval: true,
          }).verdict,
        ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
      }

      // The other create subcommands make no pod template and keep their tier.
      expect(
        tier("kubectl create configmap app --from-literal=a=b -n web"),
      ).toBe(KubectlCommandTier.RiskyWrite);
      expect(
        tier("kubectl create service clusterip web --tcp=80:8080 -n web"),
      ).toBe(KubectlCommandTier.RiskyWrite);
    });
  });

  describe("patch bodies that change a pod's identity, privileges, host access, Secrets or program are Denied", () => {
    it("forbids exactly the documented fields", () => {
      expect(POD_SECURITY_FIELDS).toHaveLength(20);
    });

    it.each(DENIED_PATCH_BODIES)("denies %s", (command: string) => {
      const result: KubectlPolicyResult =
        KubectlPolicy.evaluateCommand(command);
      expect(result.tier).toBe(KubectlCommandTier.Denied);
      expect(result.verb).toBe("patch");
    });

    it.each(ALLOWED_PATCH_BODIES)("keeps %s RiskyWrite", (command: string) => {
      expect(tier(command)).toBe(KubectlCommandTier.RiskyWrite);
    });

    it("names the field, decoded", () => {
      expect(
        reason(podTemplatePatch('{"serviceAccount\\u004eame":"admin"}')),
      ).toContain("serviceAccountName");
      expect(reason(podTemplatePatch('{"hostNetwork":true}'))).toContain(
        "hostNetwork",
      );
      expect(
        reason(
          'kubectl patch ns web -p \'{"metadata":{"labels":{"pod-security.kubernetes.io/enforce":"privileged"}}}\'',
        ),
      ).toContain("Pod Security Admission");
    });

    it("denies the same argv when the Runner evaluates it directly", () => {
      expect(
        KubectlPolicy.evaluateArgs([
          "patch",
          "deployment",
          "web",
          "-n",
          "web",
          "-p",
          '{"spec":{"template":{"spec":{"serviceAccountName":"admin"}}}}',
        ]).tier,
      ).toBe(KubectlCommandTier.Denied);
    });

    it("refuses a body nested deeper than any fix needs", () => {
      const deep: string = `${"[".repeat(70)}1${"]".repeat(70)}`;
      const result: KubectlPolicyResult = KubectlPolicy.evaluateArgs([
        "patch",
        "deployment",
        "web",
        "-n",
        "web",
        "--type=json",
        "-p",
        deep,
      ]);
      expect(result.tier).toBe(KubectlCommandTier.Denied);
      expect(result.reason).toContain("nested more than 64 levels deep");
      // Nested within the bound, the same body is walked and allowed.
      const shallow: string = `${"[".repeat(10)}1${"]".repeat(10)}`;
      expect(
        KubectlPolicy.evaluateArgs([
          "patch",
          "deployment",
          "web",
          "-n",
          "web",
          "--type=json",
          "-p",
          shallow,
        ]).tier,
      ).toBe(KubectlCommandTier.RiskyWrite);
    });
  });

  describe("a patch body that is not JSON is Denied, whatever it spells", () => {
    it.each(TAGGED_YAML_PATCH_BODIES)(
      "denies the YAML-tagged body %s",
      (command: string) => {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(result.tier).toBe(KubectlCommandTier.Denied);
        expect(result.verb).toBe("patch");
        expect(result.reason).toContain("not JSON");
      },
    );

    it.each(PLAIN_YAML_PATCH_BODIES)(
      "denies the non-JSON body %s, harmless fields or not",
      (command: string) => {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(result.tier).toBe(KubectlCommandTier.Denied);
        expect(result.reason).toContain("not JSON");
      },
    );

    it.each(NON_JSON_PATCH_BODIES)(
      "denies %s in the Runner too, and neither Bypass approval nor any allowlist entry lifts it",
      (command: string) => {
        const args: Array<string> = KubectlPolicy.tokenize(command).args!;
        // The Runner re-evaluates the argv it received, with the same result.
        expect(KubectlPolicy.evaluateArgs(args).tier).toBe(
          KubectlCommandTier.Denied,
        );

        for (const allowlistPatterns of [
          [],
          [command],
          PATCH_ALLOWLIST_ENTRIES,
          [broadestShapeOf(command)],
        ]) {
          for (const bypassApproval of [true, false]) {
            const verdict: KubectlAutoExecutionVerdict =
              KubectlPolicy.evaluateForAutoExecution({
                command,
                allowlistPatterns,
                bypassApproval,
              });
            expect(verdict.verdict).toBe(
              AiRemediationCommandPolicyVerdict.Denied,
            );
          }
        }
      },
    );

    it("tells the model to write the body as JSON", () => {
      const text: string = reason(
        "kubectl patch deployment web -n web -p 'spec: {replicas: 2}'",
      );
      expect(text).toContain("write the patch body as JSON");
      expect(text).toContain("tags, anchors and merge keys");
    });

    it.each(ALLOWED_PATCH_BODIES)(
      "negative control: the JSON body %s stays RiskyWrite, and Bypass approval runs it",
      (command: string) => {
        expect(tier(command)).toBe(KubectlCommandTier.RiskyWrite);
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
            allowlistPatterns: [],
          }).verdict,
        ).toBe(AiRemediationCommandPolicyVerdict.RequiresApproval);
      },
    );

    it("negative control: the same change written as JSON is Denied for the field it touches, not for its syntax", () => {
      for (const command of [
        podTemplatePatch('{"serviceAccountName":"default"}'),
        `kubectl patch deployment web -n web --type=merge -p '{"spec":{"template":{"spec":{"hostNetwork":true}}}}'`,
        `kubectl patch deployment web -n web --type=json -p '[{"op":"replace","path":"/spec/template/spec/serviceAccountName","value":"default"}]'`,
        podTemplatePatch('{"hostPID":true}'),
      ]) {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(result.tier).toBe(KubectlCommandTier.Denied);
        expect(result.reason).toContain("kubectl patch that touches");
        expect(result.reason).not.toContain("not JSON");
      }
    });
  });

  describe("Pod Security Admission labels on namespaces are Denied", () => {
    it.each([
      "kubectl label ns web pod-security.kubernetes.io/enforce=privileged --overwrite",
      "kubectl label namespace web pod-security.kubernetes.io/enforce-",
      "kubectl label namespaces.v1. prod pod-security.kubernetes.io/warn=baseline",
      "kubectl label ns/web pod-security.kubernetes.io/audit=privileged",
      "kubectl label ns --all pod-security.kubernetes.io/enforce=privileged",
      "kubectl label ns -l team=a pod-security.kubernetes.io/enforce=privileged",
      "kubectl annotate ns web pod-security.kubernetes.io/enforce=privileged",
      "kubectl label ns kube-system pod-security.kubernetes.io/enforce=privileged",
      "kubectl label ns web a=b Pod-Security.Kubernetes.IO/enforce=privileged",
    ])("denies %s", (command: string) => {
      expect(tier(command)).toBe(KubectlCommandTier.Denied);
      expect(reason(command)).toContain("Pod Security Admission");
      expect(
        KubectlPolicy.evaluateForAutoExecution({
          command,
          allowlistPatterns: ["*", command],
          bypassApproval: true,
        }).verdict,
      ).toBe(AiRemediationCommandPolicyVerdict.Denied);
    });

    it("keeps other namespace labels RiskyWrite", () => {
      expect(tier("kubectl label ns web team=a")).toBe(
        KubectlCommandTier.RiskyWrite,
      );
      expect(tier("kubectl label pod web-1 -n web pod-security=x")).toBe(
        KubectlCommandTier.SafeWrite,
      );
    });
  });

  describe("resource categories are never written", () => {
    it.each(DENIED_CATEGORY_WRITES)("denies %s", (command: string) => {
      expect(tier(command)).toBe(KubectlCommandTier.Denied);
    });

    it.each(ALLOWED_CATEGORY_READS)("keeps %s Read", (command: string) => {
      expect(tier(command)).toBe(KubectlCommandTier.Read);
    });

    it("explains that a category expands into many kinds", () => {
      const text: string = reason("kubectl delete api-extensions -l app=x");
      expect(text).toContain('resource category "api-extensions"');
      expect(text).toContain("CRDs, APIServices and admission webhooks");
    });
  });

  describe("never-delete kinds are Denied in every spelling", () => {
    it.each(DENIED_NEVER_DELETE_SPELLINGS)("denies %s", (command: string) => {
      expect(tier(command)).toBe(KubectlCommandTier.Denied);
    });

    it("keeps a custom resource that merely shares a word RiskyWrite", () => {
      expect(
        tier("kubectl delete certificates.cert-manager.io web -n web"),
      ).toBe(KubectlCommandTier.RiskyWrite);
      expect(tier("kubectl delete configmap app -n web")).toBe(
        KubectlCommandTier.RiskyWrite,
      );
    });
  });

  describe("verbs and subcommands kubectl would not run as written are Denied", () => {
    it.each(DENIED_VERB_SHAPES)("denies %s", (command: string) => {
      expect(tier(command)).toBe(KubectlCommandTier.Denied);
    });

    it("says an unknown verb would run a plugin", () => {
      expect(reason("kubectl frobnicate pods")).toContain(
        "kubectl-frobnicate plugin",
      );
      expect(reason("kubectl Get pods")).toContain("case-sensitively");
      expect(reason("kubectl create frobnicate x")).toContain(
        "kubectl-create-frobnicate plugin",
      );
      expect(reason("kubectl kuberc view")).toContain(
        "kubectl kuberc is not allowed",
      );
    });

    it("says a repeated namespace is ambiguous and names both values", () => {
      const text: string = reason("kubectl get pods -n a -n b");
      expect(text).toContain("more than once");
      expect(text).toContain('"a"');
      expect(text).toContain('"b"');
    });
  });

  describe("kubectl's global flags", () => {
    it("lists every v1.36 global flag once, and denies all but four", () => {
      expect(new Set(KUBECTL_1_36_GLOBAL_FLAGS).size).toBe(
        KUBECTL_1_36_GLOBAL_FLAGS.length,
      );
      expect(DENIED_GLOBAL_FLAGS).toHaveLength(
        KUBECTL_1_36_GLOBAL_FLAGS.length - ALLOWED_GLOBAL_FLAGS.length,
      );
      expect(DENIED_GLOBAL_FLAGS).toEqual(
        expect.arrayContaining(["as-user-extra", "kuberc", "kubeconfig"]),
      );
    });

    it.each(DENIED_GLOBAL_FLAG_SHAPES)("denies %s", (command: string) => {
      const result: KubectlPolicyResult =
        KubectlPolicy.evaluateCommand(command);
      expect(result.tier).toBe(KubectlCommandTier.Denied);
      // Refused for the flag itself, not for some other reason.
      expect(result.reason).toMatch(/flag/);
    });

    it.each(ALLOWED_GLOBAL_FLAG_SHAPES)(
      "keeps %s at %s",
      (command: string, expected: KubectlCommandTier) => {
        expect(tier(command)).toBe(expected);
      },
    );

    it("normalizes '_' to '-' in a flag name exactly as kubectl does", () => {
      expect(normalizeKubectlFlagName("as_group")).toBe("as-group");
      expect(normalizeKubectlFlagName("insecure_skip_tls_verify")).toBe(
        "insecure-skip-tls-verify",
      );
      expect(normalizeKubectlFlagName("from_file")).toBe("from-file");
      expect(normalizeKubectlFlagName("namespace")).toBe("namespace");
      expect(normalizeKubectlFlagName("")).toBe("");
    });

    it("names the flag as it was written", () => {
      expect(reason("kubectl get pods --as_user_extra=a=b")).toContain(
        "--as_user_extra",
      );
      expect(reason("kubectl get pods --as-user-extra=a=b")).toContain(
        "cluster access it was given",
      );
    });
  });

  describe("property: nothing lifts a Denied command", () => {
    it.each(ALL_DENIED_COMMANDS)(
      "keeps %s Denied under bypass and a permissive allowlist",
      (command: string) => {
        expect(tier(command)).toBe(KubectlCommandTier.Denied);
        /*
         * ["*"] and ["kubectl *"] used to be the permissive entries here;
         * a wildcard verb is no longer a valid entry (the matcher skips it),
         * so the broadest VALID entry of the command's own shape stands in.
         */
        for (const allowlistPatterns of [
          [broadestShapeOf(command)],
          [command],
          [command, broadestShapeOf(command)],
          [],
        ]) {
          for (const bypassApproval of [true, false, undefined]) {
            const verdict: KubectlAutoExecutionVerdict =
              KubectlPolicy.evaluateForAutoExecution({
                command,
                allowlistPatterns,
                bypassApproval,
              });
            expect(verdict.verdict).toBe(
              AiRemediationCommandPolicyVerdict.Denied,
            );
            expect(verdict.tier).toBe(KubectlCommandTier.Denied);
            expect(verdict.reason).toContain(
              "cannot run even with human approval",
            );
          }
        }
      },
    );
  });

  describe("evaluateCommand and evaluateArgs agree on every table above", () => {
    const allCommands: Array<string> = [
      ...ALL_DENIED_COMMANDS,
      ...ALLOWED_IDENTITY_NEIGHBOURS.map(
        ([command]: [string, KubectlCommandTier]) => {
          return command;
        },
      ),
      ...ALLOWED_CREATE_JOB_SHAPES,
      ...ALLOWED_PATCH_BODIES,
      ...CLUSTER_CONTROL_READS,
      ...CLUSTER_CONTROL_NEIGHBOURS.map(
        ([command]: [string, KubectlCommandTier]) => {
          return command;
        },
      ),
      ...ALLOWED_CATEGORY_READS,
      ...ALLOWED_GLOBAL_FLAG_SHAPES.map(
        ([command]: [string, KubectlCommandTier]) => {
          return command;
        },
      ),
    ];

    it.each(allCommands)(
      "returns the same verdict for %s",
      (command: string) => {
        const tokenized: KubectlTokenizeResult =
          KubectlPolicy.tokenize(command);
        expect(tokenized.args).toBeDefined();
        const viaCommand: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(KubectlPolicy.evaluateArgs(tokenized.args!)).toEqual(viaCommand);
        expect(KubectlPolicy.tokenize(viaCommand.displayCommand).args).toEqual(
          tokenized.args,
        );
      },
    );
  });
});
