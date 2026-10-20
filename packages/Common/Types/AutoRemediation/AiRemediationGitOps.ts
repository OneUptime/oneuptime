import { JSONObject } from "../JSON";

/*
 * GitOps on a kubectl fix: who declares the object a fix changes, and what
 * that means for the fix.
 *
 * A Kubernetes workload is often declared somewhere else: in git, applied
 * by Argo CD or Flux, or in a Helm chart. A kubectl change to what is
 * declared there does not last. Measured on a KinD cluster
 * (HelmChart/Tests/suites/gitops-revert.sh): Argo CD with self-heal puts a
 * `kubectl scale`, `set image`, `rollout undo` or `patch` back within
 * seconds, Flux at its next reconciliation, a Helm release at its next
 * upgrade. A rollout restart or a deleted pod changes nothing git declares,
 * and stays. So OneUptime reads who declares the object before AI changes
 * it (GitOpsOwnership) and records it on the command, and records what the
 * fix changed so verification notices when it is put back
 * (KubectlRevertWatch).
 */

/*
 * What declares the object: a GitOps controller that applies git (Argo CD,
 * Flux), or a Helm release, which only changes when someone upgrades it.
 */
export enum GitOpsController {
  ArgoCD = "ArgoCD",
  Flux = "Flux",
  Helm = "Helm",
}

export interface AiRemediationGitOpsOwner {
  controller: GitOpsController;
  /*
   * The object that declares it, as its markers name it: an Argo CD
   * "Application", a Flux "Kustomization" or "HelmRelease", or a Helm
   * "release".
   */
  ownerKind: string;
  // Empty when the markers say who, but not which one.
  ownerName: string;
  ownerNamespace?: string | undefined;
  // The marker it was read from, e.g. "annotation argocd.argoproj.io/tracking-id".
  evidence: string;
}

/*
 * A kubectl command's GitOps facts, recorded on the command when it was
 * proposed or run: who declares the object it changes, whether that
 * controller puts this change back, and OneUptime's own sentence saying so
 * (shown on the approval card).
 */
export interface AiRemediationCommandGitOps extends AiRemediationGitOpsOwner {
  // The object whose markers were read: the workload a pod belongs to.
  objectKind: string;
  objectName: string;
  objectNamespace: string;
  // The controller puts this change back to what it declares.
  putsBack: boolean;
  /*
   * It does so on its own, without anyone deploying: Argo CD and Flux.
   * False for a Helm release, which puts it back at its next upgrade.
   */
  reconcilesOnItsOwn: boolean;
  // What the controller does with this change, written by OneUptime.
  summary: string;
}

/*
 * One field a kubectl fix changed on its object, as JSON text, so a later
 * read can tell whether the field is back at what it was. A value absent on
 * one side is a field that side did not have.
 */
export interface AiRemediationWatchedField {
  // Dotted, with a list's items by their name: spec.template.spec.containers[app].image
  path: string;
  before?: string | undefined;
  after?: string | undefined;
}

/*
 * What a kubectl fix changed on the one object it named, read just before
 * and just after it ran: verification reads the object again and notices
 * when what the fix changed is back at what it was (put back by a GitOps
 * controller, a Helm upgrade, an operator or an autoscaler).
 */
export interface AiRemediationRevertWatch {
  // The object, as kubectl reads it: get <kind>/<name> -n <namespace>.
  kind: string;
  name: string;
  namespace: string;
  // The fix deleted it: it counts as put back once it exists again.
  deleted?: boolean | undefined;
  fields: Array<AiRemediationWatchedField>;
  // There were more changed fields than are kept.
  moreFields?: boolean | undefined;
  capturedAt: string;
  // The last time verification read it (ISO 8601).
  lastCheckedAt?: string | undefined;
  // When verification found it back at its values from before the fix.
  putBackAt?: string | undefined;
  // The fields it found back.
  putBackFields?: Array<string> | undefined;
}

// Caps on what a stored plan may carry: the values come from the cluster.
export const MAX_WATCHED_FIELDS: number = 20;
export const MAX_WATCHED_VALUE_CHARS: number = 300;
export const MAX_WATCHED_PATH_CHARS: number = 300;
export const MAX_GITOPS_TEXT_CHARS: number = 1000;
const MAX_GITOPS_NAME_CHARS: number = 253;

function readString(
  obj: JSONObject,
  key: string,
  maxChars: number,
): string | undefined {
  const value: unknown = obj[key];

  if (typeof value !== "string") {
    return undefined;
  }

  return value.slice(0, maxChars);
}

function isGitOpsController(value: unknown): value is GitOpsController {
  return (
    typeof value === "string" &&
    (Object.values(GitOpsController) as Array<string>).includes(value)
  );
}

export class AiRemediationGitOpsUtil {
  /*
   * A stored command's GitOps facts, or undefined when they are missing or
   * malformed. Never fails a plan: they describe a command, they never
   * decide whether it runs.
   */
  public static parseCommandGitOps(
    value: unknown,
  ): AiRemediationCommandGitOps | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const obj: JSONObject = value as JSONObject;

    if (!isGitOpsController(obj["controller"])) {
      return undefined;
    }

    const objectKind: string | undefined = readString(
      obj,
      "objectKind",
      MAX_GITOPS_NAME_CHARS,
    );
    const objectName: string | undefined = readString(
      obj,
      "objectName",
      MAX_GITOPS_NAME_CHARS,
    );
    const objectNamespace: string | undefined = readString(
      obj,
      "objectNamespace",
      MAX_GITOPS_NAME_CHARS,
    );

    if (!objectKind || !objectName || objectNamespace === undefined) {
      return undefined;
    }

    const ownerNamespace: string | undefined = readString(
      obj,
      "ownerNamespace",
      MAX_GITOPS_NAME_CHARS,
    );

    return {
      controller: obj["controller"],
      ownerKind: readString(obj, "ownerKind", MAX_GITOPS_NAME_CHARS) || "",
      ownerName: readString(obj, "ownerName", MAX_GITOPS_NAME_CHARS) || "",
      ...(ownerNamespace ? { ownerNamespace } : {}),
      evidence: readString(obj, "evidence", MAX_GITOPS_TEXT_CHARS) || "",
      objectKind,
      objectName,
      objectNamespace,
      putsBack: obj["putsBack"] === true,
      reconcilesOnItsOwn: obj["reconcilesOnItsOwn"] === true,
      summary: readString(obj, "summary", MAX_GITOPS_TEXT_CHARS) || "",
    };
  }

  // A stored revert watch, or undefined when it is missing or malformed.
  public static parseRevertWatch(
    value: unknown,
  ): AiRemediationRevertWatch | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const obj: JSONObject = value as JSONObject;

    const kind: string | undefined = readString(
      obj,
      "kind",
      MAX_GITOPS_NAME_CHARS,
    );
    const name: string | undefined = readString(
      obj,
      "name",
      MAX_GITOPS_NAME_CHARS,
    );
    const namespace: string | undefined = readString(
      obj,
      "namespace",
      MAX_GITOPS_NAME_CHARS,
    );
    const capturedAt: string | undefined = readString(obj, "capturedAt", 64);

    if (!kind || !name || !namespace || !capturedAt) {
      return undefined;
    }

    const fieldsRaw: unknown = obj["fields"];
    const fields: Array<AiRemediationWatchedField> = [];

    if (Array.isArray(fieldsRaw)) {
      for (const item of fieldsRaw.slice(0, MAX_WATCHED_FIELDS)) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          continue;
        }

        const field: JSONObject = item as JSONObject;
        const path: string | undefined = readString(
          field,
          "path",
          MAX_WATCHED_PATH_CHARS,
        );

        if (!path) {
          continue;
        }

        const before: string | undefined = readString(
          field,
          "before",
          MAX_WATCHED_VALUE_CHARS,
        );
        const after: string | undefined = readString(
          field,
          "after",
          MAX_WATCHED_VALUE_CHARS,
        );

        fields.push({
          path,
          ...(before !== undefined ? { before } : {}),
          ...(after !== undefined ? { after } : {}),
        });
      }
    }

    const deleted: boolean = obj["deleted"] === true;

    // A watch that watches nothing is no watch.
    if (fields.length === 0 && !deleted) {
      return undefined;
    }

    const putBackFieldsRaw: unknown = obj["putBackFields"];
    const putBackFields: Array<string> = Array.isArray(putBackFieldsRaw)
      ? putBackFieldsRaw
          .filter((item: unknown): item is string => {
            return typeof item === "string";
          })
          .slice(0, MAX_WATCHED_FIELDS)
          .map((item: string): string => {
            return item.slice(0, MAX_WATCHED_PATH_CHARS);
          })
      : [];

    const lastCheckedAt: string | undefined = readString(
      obj,
      "lastCheckedAt",
      64,
    );
    const putBackAt: string | undefined = readString(obj, "putBackAt", 64);

    return {
      kind,
      name,
      namespace,
      ...(deleted ? { deleted: true } : {}),
      fields,
      ...(obj["moreFields"] === true ? { moreFields: true } : {}),
      capturedAt,
      ...(lastCheckedAt ? { lastCheckedAt } : {}),
      ...(putBackAt ? { putBackAt } : {}),
      ...(putBackFields.length > 0 ? { putBackFields } : {}),
    };
  }
}
