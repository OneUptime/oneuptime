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
 *  1. Changes to who may do what: creating RBAC kinds or ServiceAccounts,
 *     patching roles and bindings, set subject, set serviceaccount, auth
 *     reconcile, certificate approve/deny, ClusterRole aggregation labels,
 *     deleting roles and bindings.
 *  2. Wiring identity, privileges, host access, Secrets or a new program into
 *     a pod: patch bodies that touch POD_SECURITY_PATCH_KEYS (by key name, in
 *     JSON, YAML, strategic-merge directives and JSON-patch paths, escapes
 *     decoded), Pod Security Admission labels on namespaces, set env
 *     --from=secret/..., and create job --image (only `create job NAME
 *     --from=cronjob/NAME` stays, as RiskyWrite).
 *  3. Resource categories in any write (all, api-extensions, ...), and every
 *     NEVER_DELETE kind in every spelling kubectl accepts.
 *  4. Anything that could run something other than the command we read: the
 *     kuberc and plugin verbs, any unknown verb or create/set subcommand
 *     (kubectl would run a kubectl-<word> plugin), a verb or subcommand not
 *     in lowercase, and a namespace set twice (the last one wins).
 *  5. Every kubectl v1.36 global flag except -n/--namespace,
 *     --request-timeout and --match-server-version, in every spelling —
 *     "_" for "-" included, because kubectl normalizes it.
 *  6. Property: every command in every Denied table here stays Denied under
 *     bypassApproval and under an allowlist of ["*"] or ["kubectl *"].
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
  // Labels and annotations on RBAC objects that are not aggregation: RiskyWrite.
  ["kubectl label clusterrole x team=a", KubectlCommandTier.RiskyWrite],
  [
    "kubectl annotate rolebinding x -n web owner=sre",
    KubectlCommandTier.RiskyWrite,
  ],
  // Aggregation reads LABELS; the same key as an annotation grants nothing.
  [
    "kubectl annotate clusterrole x rbac.authorization.k8s.io/aggregate-to-admin=true",
    KubectlCommandTier.RiskyWrite,
  ],
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
  [
    "kubectl create deployment web --image=nginx -n web",
    KubectlCommandTier.RiskyWrite,
  ],
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
  // ... as a JSON-patch path segment ...
  ...POD_SECURITY_FIELDS.map((field: string) => {
    return `kubectl patch deployment web -n web --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/${field}","value":1}]'`;
  }),
  // ... and as a YAML key.
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
  // A YAML body with an escape could spell a key we would not see.
  "kubectl patch deployment web -n web -p 'spec: {template: {spec: {\"serviceAccount\\x4eame\": admin}}}'",
  // Pod Security Admission labels, through patch.
  'kubectl patch ns web -p \'{"metadata":{"labels":{"pod-security.kubernetes.io/enforce":"privileged"}}}\'',
  'kubectl patch namespace web --type=json -p \'[{"op":"remove","path":"/metadata/labels/pod-security.kubernetes.io~1enforce"}]\'',
  "kubectl patch ns web -p 'metadata: {labels: {pod-security.kubernetes.io/enforce: privileged}}'",
  // Both spellings of the flag.
  'kubectl patch deployment web -n web --patch \'{"spec":{"template":{"spec":{"hostPID":true}}}}\'',
  'kubectl patch deployment web -n web --patch=\'{"spec":{"template":{"spec":{"hostIPC":true}}}}\'',
];

const ALLOWED_PATCH_BODIES: Array<string> = [
  'kubectl patch deployment web -n web -p \'{"spec":{"replicas":2}}\'',
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
  'kubectl patch deployment web -n web --type=json -p \'[{"op":"replace","path":"/spec/replicas","value":3}]\'',
  'kubectl patch cronjob nightly -n web -p \'{"spec":{"suspend":true}}\'',
  'kubectl patch hpa web -n web -p \'{"spec":{"minReplicas":3}}\'',
  "kubectl patch deployment web -n web -p 'spec: {replicas: 2}'",
  'kubectl patch pdb web -n web -p \'{"spec":{"minAvailable":1}}\'',
];

// ---- 3. Categories and never-delete kinds, in every spelling ---------------------

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

// ---- 4. Verbs and subcommands kubectl would not run as written --------------------

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

// ---- 5. Global flags ------------------------------------------------------------

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
  ...DENIED_CREATE_JOB_SHAPES,
  ...DENIED_PATCH_BODIES,
  ...DENIED_CATEGORY_WRITES,
  ...DENIED_NEVER_DELETE_SPELLINGS,
  ...DENIED_VERB_SHAPES,
  ...DENIED_GLOBAL_FLAG_SHAPES,
];

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
        for (const allowlistPatterns of [["*"], ["kubectl *"], [command], []]) {
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
