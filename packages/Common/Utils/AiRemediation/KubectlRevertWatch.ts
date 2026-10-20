import { JSONObject } from "../../Types/JSON";
import {
  AiRemediationRevertWatch,
  AiRemediationWatchedField,
  MAX_WATCHED_FIELDS,
  MAX_WATCHED_PATH_CHARS,
  MAX_WATCHED_VALUE_CHARS,
} from "../../Types/AutoRemediation/AiRemediationGitOps";
import { KubectlNamedObject } from "./KubectlPolicy";

/*
 * What a kubectl fix changed on the one object it named, and whether that
 * is still what the object says (see Types/AutoRemediation/AiRemediationGitOps).
 *
 * The object is read just before the fix and just after it; the fields
 * that differ are the fix. Verification reads it again: a field back at
 * its value from before is a fix put back - by a GitOps controller
 * applying git, a Helm upgrade, an operator or an autoscaler. Nothing here
 * needs to know which: GitOpsOwnership says who, when it can.
 *
 * Fields are compared as JSON text. A list whose items all have a name
 * (containers, env, ports, volumes) is read by name, so an added variable
 * is one field rather than a shifted list; any other list is one value. A
 * long value is kept as its head and a hash, so two long values still
 * compare. Pure: it never touches a cluster.
 */

// What the object says about itself, not what anyone declared.
const IGNORED_TOP_LEVEL_KEYS: Set<string> = new Set<string>([
  "apiVersion",
  "kind",
  "status",
  "metadata",
]);

// Annotations that change with every rollout, or are a controller's bookkeeping.
const IGNORED_ANNOTATIONS: Set<string> = new Set<string>([
  "deployment.kubernetes.io/revision",
  "kubectl.kubernetes.io/last-applied-configuration",
]);

/*
 * Deep enough for any pod template (spec.template.spec.containers[app].
 * resources.limits.memory is 7 levels); a deeper path is kept whole.
 */
const MAX_DEPTH: number = 12;

// How much of a long value's text is kept beside its hash.
const LONG_VALUE_HEAD_CHARS: number = 200;

// 64-bit FNV-1a as two 32-bit halves: equality, not secrecy.
function hashText(text: string): string {
  let h1: number = 0x811c9dc5;
  let h2: number = 0x01000193;

  for (let i: number = 0; i < text.length; i++) {
    const code: number = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ code, 0x811c9dc5) >>> 0;
  }

  return `${h1.toString(16).padStart(8, "0")}${h2
    .toString(16)
    .padStart(8, "0")}`;
}

// A value as it is stored and compared: its JSON, or a head and a hash.
export function toWatchedValue(value: unknown): string {
  const text: string = (JSON.stringify(value) as string | undefined) ?? "null";

  if (text.length <= MAX_WATCHED_VALUE_CHARS) {
    return text;
  }

  return `${text.slice(0, LONG_VALUE_HEAD_CHARS)}… #${hashText(text)}`;
}

function isObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNamedList(value: Array<unknown>): boolean {
  if (value.length === 0) {
    return false;
  }

  const names: Set<string> = new Set<string>();

  for (const item of value) {
    if (!isObject(item) || typeof item["name"] !== "string") {
      return false;
    }

    names.add(item["name"]);
  }

  // Two items with one name could not be told apart.
  return names.size === value.length;
}

function flattenInto(
  value: unknown,
  path: string,
  depth: number,
  into: Map<string, string>,
): void {
  if (depth < MAX_DEPTH && isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      flattenInto(item, `${path}.${key}`, depth + 1, into);
    }
    return;
  }

  if (depth < MAX_DEPTH && Array.isArray(value) && isNamedList(value)) {
    for (const item of value) {
      const named: JSONObject = item as JSONObject;
      const itemPath: string = `${path}[${String(named["name"])}]`;
      const rest: JSONObject = { ...named };
      delete rest["name"];

      if (Object.keys(rest).length === 0) {
        into.set(itemPath, toWatchedValue(named));
        continue;
      }

      flattenInto(rest, itemPath, depth + 1, into);
    }
    return;
  }

  into.set(path, toWatchedValue(value));
}

/*
 * Every field anyone may have declared, by path: the object minus status,
 * and of its metadata only the labels and annotations (less the ones that
 * change with every rollout).
 */
export function flattenObjectFields(object: JSONObject): Map<string, string> {
  const fields: Map<string, string> = new Map<string, string>();

  for (const [key, value] of Object.entries(object)) {
    if (IGNORED_TOP_LEVEL_KEYS.has(key)) {
      continue;
    }

    flattenInto(value, key, 1, fields);
  }

  const metadata: JSONObject = isObject(object["metadata"])
    ? object["metadata"]
    : {};

  for (const key of ["labels", "annotations"]) {
    const map: unknown = metadata[key];

    if (!isObject(map)) {
      continue;
    }

    for (const [entryKey, entryValue] of Object.entries(map)) {
      if (key === "annotations" && IGNORED_ANNOTATIONS.has(entryKey)) {
        continue;
      }

      fields.set(`metadata.${key}.${entryKey}`, toWatchedValue(entryValue));
    }
  }

  return fields;
}

/*
 * Whether a field that changed between the two reads is the fix's. An
 * autoscaler can change spec.replicas in the seconds between them; only a
 * scale or a patch of the object changes it on purpose.
 */
function isTheFixsField(path: string, target: KubectlNamedObject): boolean {
  if (path === "spec.replicas") {
    return target.verb === "scale" || target.verb === "patch";
  }

  return true;
}

/*
 * The watch for one fix, from the object read just before it ran and just
 * after: the fields that changed (at most MAX_WATCHED_FIELDS), or the
 * deletion. Null when there is nothing to watch: the object was not there
 * before, or nothing changed.
 */
export function buildRevertWatch(data: {
  target: KubectlNamedObject;
  namespace: string;
  before: JSONObject | null;
  after: JSONObject | null;
  capturedAt: string;
}): AiRemediationRevertWatch | null {
  if (!data.before) {
    return null;
  }

  const base: Pick<
    AiRemediationRevertWatch,
    "kind" | "name" | "namespace" | "capturedAt"
  > = {
    kind: data.target.rawKind,
    name: data.target.name,
    namespace: data.namespace,
    capturedAt: data.capturedAt,
  };

  if (!data.after) {
    return { ...base, deleted: true, fields: [] };
  }

  const before: Map<string, string> = flattenObjectFields(data.before);
  const after: Map<string, string> = flattenObjectFields(data.after);
  const paths: Array<string> = Array.from(
    new Set<string>([
      ...Array.from(before.keys()),
      ...Array.from(after.keys()),
    ]),
  ).sort();

  const fields: Array<AiRemediationWatchedField> = [];
  let moreFields: boolean = false;

  for (const path of paths) {
    const beforeValue: string | undefined = before.get(path);
    const afterValue: string | undefined = after.get(path);

    if (beforeValue === afterValue || !isTheFixsField(path, data.target)) {
      continue;
    }

    if (fields.length >= MAX_WATCHED_FIELDS) {
      moreFields = true;
      break;
    }

    fields.push({
      path: path.slice(0, MAX_WATCHED_PATH_CHARS),
      ...(beforeValue !== undefined ? { before: beforeValue } : {}),
      ...(afterValue !== undefined ? { after: afterValue } : {}),
    });
  }

  if (fields.length === 0) {
    return null;
  }

  return { ...base, fields, ...(moreFields ? { moreFields: true } : {}) };
}

/*
 * The watched fields the object is back at its values from before the
 * fix — the fix put back — or, for a deletion, the object itself once it
 * exists again. `current` is null when the object is gone: a deleted
 * object that stays gone is a fix that held, and any other object that is
 * gone tells nothing either way.
 */
export function findPutBackFields(
  watch: AiRemediationRevertWatch,
  current: JSONObject | null,
): Array<string> {
  if (watch.deleted) {
    return current ? [`${watch.kind}/${watch.name}`] : [];
  }

  if (!current) {
    return [];
  }

  const now: Map<string, string> = flattenObjectFields(current);

  return watch.fields
    .filter((field: AiRemediationWatchedField): boolean => {
      return (
        field.before !== field.after && now.get(field.path) === field.before
      );
    })
    .map((field: AiRemediationWatchedField): string => {
      return field.path;
    });
}

// "spec.replicas (2 → back to 1)" — what was put back, for a note.
export function describePutBackFields(
  watch: AiRemediationRevertWatch,
  paths: Array<string>,
): string {
  if (watch.deleted) {
    return `${watch.kind}/${watch.name} exists again`;
  }

  return paths
    .slice(0, 5)
    .map((path: string): string => {
      const field: AiRemediationWatchedField | undefined = watch.fields.find(
        (candidate: AiRemediationWatchedField): boolean => {
          return candidate.path === path;
        },
      );

      if (!field) {
        return path;
      }

      return `${path} (${field.after ?? "removed"} → back to ${
        field.before ?? "not set"
      })`;
    })
    .join(", ")
    .concat(paths.length > 5 ? ` and ${paths.length - 5} more` : "");
}
