import { JSONObject } from "../../Types/JSON";
import {
  AiRemediationCommandGitOps,
  AiRemediationGitOpsOwner,
  GitOpsController,
  MAX_GITOPS_TEXT_CHARS,
} from "../../Types/AutoRemediation/AiRemediationGitOps";
import { KubectlNamedObject } from "./KubectlPolicy";

/*
 * Who declares a Kubernetes object — Argo CD, Flux or a Helm release — read
 * from the markers each one leaves on the objects it manages, and what that
 * means for a kubectl fix of it (see Types/AutoRemediation/AiRemediationGitOps).
 *
 * The markers, as the controllers write them (checked against Argo CD,
 * Flux and Helm on a KinD cluster, HelmChart/Tests/suites/gitops-revert.sh):
 *
 *   Argo CD   annotation argocd.argoproj.io/tracking-id
 *             ("<app>:<group>/<kind>:<namespace>/<name>", the default since
 *             Argo CD 3.0; "<namespace>_<app>" for an Application outside
 *             Argo CD's own namespace), or the label argocd.argoproj.io/instance
 *             (the instance label key Argo CD recommends), or Argo CD's field
 *             manager on the object.
 *   Flux      labels kustomize.toolkit.fluxcd.io/name and /namespace (a
 *             Kustomization), helm.toolkit.fluxcd.io/name and /namespace (a
 *             HelmRelease), or Flux's field managers.
 *   Helm      annotations meta.helm.sh/release-name and /release-namespace,
 *             the label app.kubernetes.io/managed-by=Helm, or Helm's field
 *             manager.
 *
 * A controller wins over Helm: Flux's HelmReleases install through Helm
 * (both markers), and Argo CD renders charts with `helm template` (a chart's
 * own managed-by: Helm label, no release annotations). The label
 * app.kubernetes.io/instance alone - Argo CD's label before 3.0, but also
 * every Helm chart's and many hand-written manifests' - names nobody: a fix
 * on such an object is still watched (KubectlRevertWatch), so a controller
 * this misses is caught putting the fix back.
 *
 * Pure: it reads an object's JSON (`kubectl get -o json
 * --show-managed-fields`) and never touches a cluster.
 */

export const ARGOCD_TRACKING_ID_ANNOTATION: string =
  "argocd.argoproj.io/tracking-id";
export const ARGOCD_INSTANCE_LABEL: string = "argocd.argoproj.io/instance";
export const FLUX_KUSTOMIZATION_NAME_LABEL: string =
  "kustomize.toolkit.fluxcd.io/name";
export const FLUX_KUSTOMIZATION_NAMESPACE_LABEL: string =
  "kustomize.toolkit.fluxcd.io/namespace";
export const FLUX_HELMRELEASE_NAME_LABEL: string =
  "helm.toolkit.fluxcd.io/name";
export const FLUX_HELMRELEASE_NAMESPACE_LABEL: string =
  "helm.toolkit.fluxcd.io/namespace";
export const HELM_RELEASE_NAME_ANNOTATION: string = "meta.helm.sh/release-name";
export const HELM_RELEASE_NAMESPACE_ANNOTATION: string =
  "meta.helm.sh/release-namespace";
export const MANAGED_BY_LABEL: string = "app.kubernetes.io/managed-by";
export const APP_INSTANCE_LABEL: string = "app.kubernetes.io/instance";
const LAST_APPLIED_ANNOTATION: string =
  "kubectl.kubernetes.io/last-applied-configuration";

// metadata.managedFields[].manager of each controller's writes.
export const ARGOCD_FIELD_MANAGERS: Array<string> = ["argocd-controller"];
export const FLUX_KUSTOMIZATION_FIELD_MANAGERS: Array<string> = [
  "kustomize-controller",
];
export const FLUX_HELMRELEASE_FIELD_MANAGERS: Array<string> = [
  "helm-controller",
];
export const HELM_FIELD_MANAGERS: Array<string> = ["helm"];

// What a marker value may be: a Kubernetes name, give or take.
const MAX_MARKER_VALUE_CHARS: number = 253;

/*
 * The kubectl read that gives this module what it reads: the object, with
 * the field managers kubectl hides by default.
 */
export function buildOwnershipReadCommand(data: {
  kind: string;
  name: string;
  namespace: string;
}): string {
  return `kubectl get ${data.kind}/${data.name} -n ${data.namespace} -o json --show-managed-fields`;
}

function asObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function asStringMap(value: unknown): Record<string, string> {
  const map: Record<string, string> = {};

  for (const [key, item] of Object.entries(asObject(value))) {
    if (typeof item === "string") {
      map[key] = item;
    }
  }

  return map;
}

/*
 * A Kubernetes object name (a DNS-1123 subdomain: lowercase letters,
 * digits, "-" and "."), which every name a marker gives is - an Argo CD
 * Application's, a Flux object's, a Helm release's, a workload's.
 */
const KUBERNETES_NAME: RegExp = /^[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?$/;

// A kind as an owner reference gives it, lowercased: one word.
const KUBERNETES_KIND: RegExp = /^[a-z][a-z0-9]{0,62}$/;

/*
 * A name a marker gives, or "" when it is not a Kubernetes name. Markers
 * are cluster data that reach prompts, cards and feed items, so text that
 * cannot be a name - words, an instruction - names nobody (the controller
 * is still told by the marker's key).
 */
function cleanMarkerValue(value: string | undefined): string {
  const trimmed: string = (value || "").trim();

  return trimmed.length <= MAX_MARKER_VALUE_CHARS &&
    KUBERNETES_NAME.test(trimmed)
    ? trimmed
    : "";
}

// A marker is there when its key carries any value at all.
function hasMarker(value: string | undefined): boolean {
  return (value || "").trim().length > 0;
}

interface ManagedFieldsEntry {
  manager: string;
  fields: JSONObject;
}

function readManagedFields(object: JSONObject): Array<ManagedFieldsEntry> {
  const raw: unknown = asObject(object["metadata"])["managedFields"];

  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: Array<ManagedFieldsEntry> = [];

  for (const item of raw) {
    const entry: JSONObject = asObject(item);
    const manager: unknown = entry["manager"];

    if (typeof manager !== "string" || !manager) {
      continue;
    }

    entries.push({ manager, fields: asObject(entry["fieldsV1"]) });
  }

  return entries;
}

function hasManager(
  entries: Array<ManagedFieldsEntry>,
  managers: Array<string>,
): string | undefined {
  return entries.find((entry: ManagedFieldsEntry): boolean => {
    return managers.includes(entry.manager);
  })?.manager;
}

/*
 * "<app>:<group>/<kind>:<namespace>/<name>", with "<namespace>_<app>" for
 * an Application outside Argo CD's own namespace ("_" is never in a
 * Kubernetes name, so it can only be that separator).
 */
export function parseArgoCdTrackingId(trackingId: string): {
  name: string;
  namespace?: string | undefined;
} {
  const app: string = (trackingId.split(":")[0] || "").trim();
  const underscore: number = app.indexOf("_");

  if (underscore > 0) {
    const namespace: string = cleanMarkerValue(app.slice(0, underscore));
    const name: string = cleanMarkerValue(app.slice(underscore + 1));

    return namespace && name ? { namespace, name } : { name: "" };
  }

  return { name: cleanMarkerValue(app) };
}

/*
 * Who declares this object, or null when nothing it carries says so. The
 * object is untrusted cluster data: every value it yields is cut to a
 * Kubernetes name's length.
 */
export function readGitOpsOwner(
  object: JSONObject,
): AiRemediationGitOpsOwner | null {
  const metadata: JSONObject = asObject(object["metadata"]);
  const labels: Record<string, string> = asStringMap(metadata["labels"]);
  const annotations: Record<string, string> = asStringMap(
    metadata["annotations"],
  );
  const managedFields: Array<ManagedFieldsEntry> = readManagedFields(object);

  const trackingId: string = (
    annotations[ARGOCD_TRACKING_ID_ANNOTATION] || ""
  ).trim();

  if (trackingId) {
    const app: { name: string; namespace?: string | undefined } =
      parseArgoCdTrackingId(trackingId);

    return {
      controller: GitOpsController.ArgoCD,
      ownerKind: "Application",
      ownerName: app.name,
      ...(app.namespace ? { ownerNamespace: app.namespace } : {}),
      evidence: `annotation ${ARGOCD_TRACKING_ID_ANNOTATION}`,
    };
  }

  if (hasMarker(labels[ARGOCD_INSTANCE_LABEL])) {
    return {
      controller: GitOpsController.ArgoCD,
      ownerKind: "Application",
      ownerName: cleanMarkerValue(labels[ARGOCD_INSTANCE_LABEL]),
      evidence: `label ${ARGOCD_INSTANCE_LABEL}`,
    };
  }

  const argoManager: string | undefined = hasManager(
    managedFields,
    ARGOCD_FIELD_MANAGERS,
  );

  if (argoManager) {
    return {
      controller: GitOpsController.ArgoCD,
      ownerKind: "Application",
      // Argo CD's label tracking names the Application in this label.
      ownerName: cleanMarkerValue(labels[APP_INSTANCE_LABEL]),
      evidence: `field manager ${argoManager}`,
    };
  }

  if (hasMarker(labels[FLUX_HELMRELEASE_NAME_LABEL])) {
    const namespace: string = cleanMarkerValue(
      labels[FLUX_HELMRELEASE_NAMESPACE_LABEL],
    );

    return {
      controller: GitOpsController.Flux,
      ownerKind: "HelmRelease",
      ownerName: cleanMarkerValue(labels[FLUX_HELMRELEASE_NAME_LABEL]),
      ...(namespace ? { ownerNamespace: namespace } : {}),
      evidence: `label ${FLUX_HELMRELEASE_NAME_LABEL}`,
    };
  }

  if (hasMarker(labels[FLUX_KUSTOMIZATION_NAME_LABEL])) {
    const namespace: string = cleanMarkerValue(
      labels[FLUX_KUSTOMIZATION_NAMESPACE_LABEL],
    );

    return {
      controller: GitOpsController.Flux,
      ownerKind: "Kustomization",
      ownerName: cleanMarkerValue(labels[FLUX_KUSTOMIZATION_NAME_LABEL]),
      ...(namespace ? { ownerNamespace: namespace } : {}),
      evidence: `label ${FLUX_KUSTOMIZATION_NAME_LABEL}`,
    };
  }

  const fluxHelmManager: string | undefined = hasManager(
    managedFields,
    FLUX_HELMRELEASE_FIELD_MANAGERS,
  );

  if (fluxHelmManager) {
    return {
      controller: GitOpsController.Flux,
      ownerKind: "HelmRelease",
      ownerName: "",
      evidence: `field manager ${fluxHelmManager}`,
    };
  }

  const fluxKustomizeManager: string | undefined = hasManager(
    managedFields,
    FLUX_KUSTOMIZATION_FIELD_MANAGERS,
  );

  if (fluxKustomizeManager) {
    return {
      controller: GitOpsController.Flux,
      ownerKind: "Kustomization",
      ownerName: "",
      evidence: `field manager ${fluxKustomizeManager}`,
    };
  }

  if (hasMarker(annotations[HELM_RELEASE_NAME_ANNOTATION])) {
    const namespace: string = cleanMarkerValue(
      annotations[HELM_RELEASE_NAMESPACE_ANNOTATION],
    );

    return {
      controller: GitOpsController.Helm,
      ownerKind: "release",
      ownerName: cleanMarkerValue(annotations[HELM_RELEASE_NAME_ANNOTATION]),
      ...(namespace ? { ownerNamespace: namespace } : {}),
      evidence: `annotation ${HELM_RELEASE_NAME_ANNOTATION}`,
    };
  }

  if ((labels[MANAGED_BY_LABEL] || "").trim().toLowerCase() === "helm") {
    return {
      controller: GitOpsController.Helm,
      ownerKind: "release",
      ownerName: cleanMarkerValue(labels[APP_INSTANCE_LABEL]),
      evidence: `label ${MANAGED_BY_LABEL}=Helm`,
    };
  }

  const helmManager: string | undefined = hasManager(
    managedFields,
    HELM_FIELD_MANAGERS,
  );

  if (helmManager) {
    return {
      controller: GitOpsController.Helm,
      ownerKind: "release",
      ownerName: "",
      evidence: `field manager ${helmManager}`,
    };
  }

  return null;
}

/*
 * The object that controls this one (ownerReferences with controller:
 * true): a pod's ReplicaSet or StatefulSet, a ReplicaSet's Deployment, a
 * Job's CronJob. The workload is what git declares; the pods it makes are
 * not.
 */
export function readControllerReference(
  object: JSONObject,
): { kind: string; name: string } | null {
  const references: unknown = asObject(object["metadata"])["ownerReferences"];

  if (!Array.isArray(references)) {
    return null;
  }

  for (const item of references) {
    const reference: JSONObject = asObject(item);

    if (reference["controller"] !== true) {
      continue;
    }

    const kind: unknown = reference["kind"];
    const name: unknown = reference["name"];

    if (typeof kind !== "string" || typeof name !== "string") {
      continue;
    }

    /*
     * Both are read again from the cluster with kubectl: a kind is a word,
     * a name a Kubernetes name, or the reference is not followed.
     */
    const cleanKind: string = kind.toLowerCase();
    const cleanName: string = cleanMarkerValue(name);

    if (KUBERNETES_KIND.test(cleanKind) && cleanName) {
      return { kind: cleanKind, name: cleanName };
    }
  }

  return null;
}

// The field managers that write for this owner.
function getOwnerFieldManagers(owner: AiRemediationGitOpsOwner): Array<string> {
  if (owner.controller === GitOpsController.ArgoCD) {
    return ARGOCD_FIELD_MANAGERS;
  }

  if (owner.controller === GitOpsController.Flux) {
    return owner.ownerKind === "HelmRelease"
      ? FLUX_HELMRELEASE_FIELD_MANAGERS
      : FLUX_KUSTOMIZATION_FIELD_MANAGERS;
  }

  return HELM_FIELD_MANAGERS;
}

/*
 * Whether what declares the object sets spec.replicas: the owner's field
 * manager owns it, or the manifest kubectl's client-side apply recorded
 * names it. Undefined when the object says neither way.
 */
export function declaresReplicas(
  object: JSONObject,
  owner: AiRemediationGitOpsOwner,
): boolean | undefined {
  const managers: Array<string> = getOwnerFieldManagers(owner);
  const entries: Array<ManagedFieldsEntry> = readManagedFields(object).filter(
    (entry: ManagedFieldsEntry): boolean => {
      return managers.includes(entry.manager);
    },
  );

  if (entries.length > 0) {
    return entries.some((entry: ManagedFieldsEntry): boolean => {
      return "f:replicas" in asObject(entry.fields["f:spec"]);
    });
  }

  const lastApplied: string | undefined = asStringMap(
    asObject(object["metadata"])["annotations"],
  )[LAST_APPLIED_ANNOTATION];

  if (lastApplied) {
    try {
      const manifest: JSONObject = asObject(JSON.parse(lastApplied));
      return "replicas" in asObject(manifest["spec"]);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/*
 * What a kubectl change of an object does to what its owner declares: the
 * owner puts it back, or it stays — as Argo CD, Flux and Helm were seen to
 * treat each change (HelmChart/Tests/suites/gitops-revert.sh). `edits` says
 * what the change touches, for the summary.
 */
export interface GitOpsChangeEffect {
  putsBack: boolean;
  edits: string;
}

export function classifyGitOpsChange(data: {
  target: KubectlNamedObject;
  object: JSONObject;
  owner: AiRemediationGitOpsOwner;
}): GitOpsChangeEffect {
  const { target } = data;

  if (target.verb === "rollout") {
    if (target.subcommand === "restart") {
      return {
        putsBack: false,
        edits:
          "a restart annotation on its pod template, which is not something git declares",
      };
    }

    if (target.subcommand === "pause" || target.subcommand === "resume") {
      return {
        putsBack: false,
        edits:
          "its paused flag, which manifests rarely declare (while it is paused, a deploy from git does not roll out)",
      };
    }

    return {
      putsBack: true,
      edits: "its pod template, back to an earlier revision",
    };
  }

  if (target.verb === "scale") {
    const declared: boolean | undefined = declaresReplicas(
      data.object,
      data.owner,
    );

    if (declared === false) {
      return {
        putsBack: false,
        edits:
          "its replica count, which it leaves to the cluster (as with an autoscaler)",
      };
    }

    return { putsBack: true, edits: "its replica count" };
  }

  if (target.verb === "set") {
    const what: string =
      target.subcommand === "image"
        ? "a container image"
        : target.subcommand === "env"
          ? "a container's environment"
          : target.subcommand === "resources"
            ? "a container's resources"
            : `its ${target.subcommand || "fields"}`;

    return { putsBack: true, edits: what };
  }

  if (target.verb === "delete") {
    return { putsBack: true, edits: "deletes it, and it is recreated" };
  }

  if (target.verb === "label" || target.verb === "annotate") {
    return {
      putsBack: false,
      edits: `${target.verb === "label" ? "a label" : "an annotation"} it does not declare`,
    };
  }

  if (target.verb === "create") {
    return { putsBack: false, edits: "a new object it does not track" };
  }

  return { putsBack: true, edits: "fields it declares" };
}

// 'Argo CD Application "shop"', 'Flux Kustomization "apps" (namespace flux-system)'.
export function describeGitOpsOwner(owner: AiRemediationGitOpsOwner): string {
  const controller: string =
    owner.controller === GitOpsController.ArgoCD
      ? "Argo CD"
      : owner.controller === GitOpsController.Flux
        ? "Flux"
        : "Helm";
  const kind: string = owner.ownerKind || "release";
  const name: string = owner.ownerName ? ` "${owner.ownerName}"` : "";
  const namespace: string = owner.ownerNamespace
    ? ` (namespace ${owner.ownerNamespace})`
    : "";

  if (owner.controller === GitOpsController.Helm) {
    return owner.ownerName
      ? `Helm release${name}${namespace}`
      : "a Helm release";
  }

  return `${controller} ${kind}${name}${namespace}`;
}

/*
 * How and when this owner puts a change back to what it declares, as the
 * end of a sentence ("... and Argo CD puts it back ...").
 */
function describeWhenPutBack(owner: AiRemediationGitOpsOwner): string {
  if (owner.controller === GitOpsController.ArgoCD) {
    return "Argo CD puts it back to what git declares: within seconds when the Application has self-heal on, otherwise at its next sync";
  }

  if (owner.controller === GitOpsController.Flux) {
    return owner.ownerKind === "HelmRelease"
      ? "Flux puts it back at its next reconciliation when the HelmRelease has drift detection on, otherwise at the release's next upgrade"
      : "Flux puts it back to what git declares at its next reconciliation (its interval, often a few minutes)";
  }

  return "nothing puts it back on its own, but the release's next helm upgrade does";
}

// Where the lasting change goes: "the lasting fix is the same change in ...".
export function describeLastingFix(owner: AiRemediationGitOpsOwner): string {
  if (owner.controller === GitOpsController.Helm) {
    return "the lasting fix is the same change in the release's chart values";
  }

  if (owner.ownerKind === "HelmRelease") {
    return "the lasting fix is the same change in the HelmRelease's values in git";
  }

  return "the lasting fix is the same change in git (the manifest, Helm values or Kustomize overlay it is built from)";
}

/*
 * The GitOps facts a command carries: who declares the object it changes,
 * whether that owner puts this change back, and OneUptime's sentence
 * saying so — "a stopgap, the lasting fix is in git" when it does.
 */
export function describeGitOpsChange(data: {
  owner: AiRemediationGitOpsOwner;
  effect: GitOpsChangeEffect;
  objectKind: string;
  objectName: string;
  objectNamespace: string;
}): AiRemediationCommandGitOps {
  const { owner, effect } = data;
  const object: string = `${data.objectKind}/${data.objectName}`;
  const ownerText: string = describeGitOpsOwner(owner);
  const ownerSentenceStart: string =
    ownerText.charAt(0).toUpperCase() + ownerText.slice(1);

  const summary: string = effect.putsBack
    ? `${ownerSentenceStart} declares ${object} (${owner.evidence}), and this change ${
        effect.edits.startsWith("deletes")
          ? effect.edits
          : `edits ${effect.edits}`
      }: ${describeWhenPutBack(owner)}. Treat it as a stopgap - ${describeLastingFix(owner)}.`
    : `${ownerSentenceStart} declares ${object} (${owner.evidence}), but this change edits ${effect.edits}, so it stays.`;

  return {
    ...owner,
    objectKind: data.objectKind,
    objectName: data.objectName,
    objectNamespace: data.objectNamespace,
    putsBack: effect.putsBack,
    reconcilesOnItsOwn: owner.controller !== GitOpsController.Helm,
    summary: summary.slice(0, MAX_GITOPS_TEXT_CHARS),
  };
}
