import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import {
  KubernetesAiRemediationMode,
  PROTECTED_KUBERNETES_NAMESPACES,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import { KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS } from "Common/Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import RunbookCredentialType from "Common/Types/Runbook/RunbookCredentialType";
import KubectlPolicy, {
  KUBECTL_ALLOWLIST_MAX_PATTERNS,
} from "Common/Utils/AiRemediation/KubectlPolicy";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import RunbookCredential from "Common/Models/DatabaseModels/RunbookCredential";
import Runner from "Common/Models/DatabaseModels/Runner";
import type { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import type FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { isKubernetesAgentRunnerRow } from "./KubernetesAgentRunner";
import { formatNameList } from "./KubernetesAiAccessSetup";
import { joinAiAccessProtections } from "../../../Components/AiAccess/AiAccessModes";
import {
  TranslatableTerm,
  translatableTerm,
  translatePlural,
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The pure pieces behind "What AI may do" on the cluster's AI agent page
 * and its Change modal: the words for each fixes mode, who may loosen what
 * (relative to the saved settings, as the server decides it), what an edit
 * actually sends, when a save is confirmed first, how the kubectl allowlist
 * is read and checked (by KubectlPolicy, the matcher's own rules), and —
 * only for a cluster bound to a Runner outside the chart — which Runners
 * and credentials the pickers offer.
 *
 * Import-clean on purpose (Common types, models and policy only; UI types
 * are type-only imports), so the suites read it without a browser.
 */

// The mode's short name, as the card, the feed and the refusals say it.
export const REMEDIATION_MODE_SHORT_NAMES: Record<
  KubernetesAiRemediationMode,
  string
> = {
  [KubernetesAiRemediationMode.Disabled]: "Off",
  [KubernetesAiRemediationMode.RequireApproval]: "Ask for approval",
  [KubernetesAiRemediationMode.Automatic]: "Automatic",
  [KubernetesAiRemediationMode.BypassApproval]: "Bypass approval",
};

/*
 * What each mode does, in the words of the canonical description on
 * KubernetesAiRemediationMode (Common/Types/Kubernetes/
 * KubernetesClusterAiAccess.ts): the one line the Fixes row of "What AI
 * may do" shows for the current mode. Off says nothing about
 * investigating — that is the Investigation row's, and may be off too.
 */
export const REMEDIATION_MODE_SUMMARIES: Record<
  KubernetesAiRemediationMode,
  string
> = {
  [KubernetesAiRemediationMode.Disabled]: "AI never proposes or runs a fix.",
  [KubernetesAiRemediationMode.RequireApproval]:
    "AI proposes kubectl fixes. A person approves each one before it runs.",
  [KubernetesAiRemediationMode.Automatic]:
    "Safe fixes run on their own. Riskier ones wait for your one-click approval.",
  [KubernetesAiRemediationMode.BypassApproval]:
    "Every allowed fix runs on its own. Protected namespaces and node drains, taints and patches still ask a person.",
};

// A stored mode the page does not know reads as Off, as the server reads it.
export function readRemediationMode(
  value: unknown,
): KubernetesAiRemediationMode {
  return Object.values(KubernetesAiRemediationMode).includes(
    value as KubernetesAiRemediationMode,
  )
    ? (value as KubernetesAiRemediationMode)
    : KubernetesAiRemediationMode.Disabled;
}

/*
 * What the Investigation row of "What AI may do" says while investigation
 * is on: what AI may run, and that it changes nothing.
 */
export const INVESTIGATION_ON_SENTENCE: string =
  "AI may run read-only kubectl on this cluster: get, describe, logs, events, top. It never changes anything.";

/*
 * What holds in every mode, Bypass approval included — the canonical
 * comment's "In EVERY mode" paragraph, clause for clause: the Denied tier,
 * the protected namespaces, a node drain, a node taint and a patch of a
 * node, the in-cluster agent's own namespace and write scope, and the two
 * cases in which an unattended run becomes a proposal. The Change modal
 * lists the clauses under "What stays protected in every mode"; the
 * confirmations say them as one sentence.
 */
export function getEveryModeProtections(): Array<string> {
  return [
    "destructive commands (deleting namespaces, volumes, nodes, secrets or CRDs; exec; apply) never run",
    `a write in ${formatNameList(
      PROTECTED_KUBERNETES_NAMESPACES,
      "or",
    )}, a node drain, a node taint and a patch of a node always need a human`,
    "the in-cluster agent never changes its own namespace or anything outside the namespaces its chart may write",
    "an unattended run becomes a proposal when the hourly per-cluster circuit breaker trips or another unattended round already holds the cluster",
  ];
}

export function getEveryModeProtectionsSentence(): string {
  return joinAiAccessProtections(getEveryModeProtections());
}

/*
 * What each mode does, one card each in the Change modal's Fixes picker:
 * the canonical description on KubernetesAiRemediationMode, a mode at a
 * time, with the kubectl changes that are safe and riskier named. What
 * holds in every mode is listed under the cards (getEveryModeProtections),
 * not repeated on each.
 */
export const REMEDIATION_MODE_OPTION_DESCRIPTIONS: Record<
  KubernetesAiRemediationMode,
  string
> = {
  [KubernetesAiRemediationMode.Disabled]:
    "AI never proposes or runs a fix. It can still investigate.",
  [KubernetesAiRemediationMode.RequireApproval]:
    "AI proposes the exact kubectl fix, and a person approves it with one click before it runs. A follow-up fix asks again.",
  [KubernetesAiRemediationMode.Automatic]:
    "Safe changes on one named object (rollout restart or undo, scale above zero, delete a named pod, cordon a node, …) run on their own. Riskier ones (patch, set image, drain, taint, scale to zero, …) wait for one-click approval unless the kubectl allowlist names them.",
  [KubernetesAiRemediationMode.BypassApproval]:
    "AI does not ask: every change the command policy allows runs on its own, riskier ones and follow-up rounds included. Writes in protected namespaces and node drains, taints and patches still ask a person.",
};

/*
 * The kubectl allowlist field's help text: what a pattern does and how it
 * is matched, with an example. The rest is said where it applies — a
 * broken pattern by its validation error (validateKubectlAllowlistText), a
 * broad one by the confirmation before saving, and what never runs
 * unattended by the modal's every-mode protections.
 */
export const KUBECTL_ALLOWLIST_FIELD_DESCRIPTION: string =
  'One pattern per line. A riskier kubectl command that matches a pattern runs without approval. Patterns are matched word by word: * matches exactly one word, flags must be written out, and a leading "kubectl" is optional — for example: kubectl set image deployment/web * -n web.';

/*
 * Permission titles, the way PermissionGate names them, read straight from
 * the permission table so this module needs no browser.
 */
let permissionPropsCache: Dictionary<PermissionProps> | null = null;

export function getPermissionTitles(
  permissions: Array<Permission>,
): Array<string> {
  if (!permissionPropsCache) {
    permissionPropsCache = PermissionHelper.getAllPermissionPropsAsDictionary();
  }

  const titles: Array<string> = [];

  for (const permission of permissions) {
    const title: string | undefined = permissionPropsCache[permission]?.title;

    if (title && !titles.includes(title)) {
      titles.push(title);
    }
  }

  return titles;
}

export function getKubernetesAiAccessAdminPermissionTitles(): Array<string> {
  return getPermissionTitles(KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS);
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/*
 * The allowlist is edited one pattern per line. Blank lines are layout, not
 * patterns, and whitespace runs are collapsed the way the policy collapses
 * them before matching.
 */
export function parseKubectlAllowlistText(text: unknown): Array<string> {
  if (typeof text !== "string") {
    return [];
  }

  return text
    .split(/\r?\n/)
    .map((line: string): string => {
      return collapseWhitespace(line);
    })
    .filter((line: string): boolean => {
      return line.length > 0;
    });
}

/*
 * Null when the text is a usable allowlist, otherwise what is wrong with it.
 * What "usable" means is KubectlPolicy's, the one definition the matcher,
 * the server's save validation and this form share
 * (describeAllowlistPatternProblem and KUBECTL_ALLOWLIST_MAX_PATTERNS).
 */
export function validateKubectlAllowlistText(text: unknown): string | null {
  const patterns: Array<string> = parseKubectlAllowlistText(text);

  if (patterns.length > KUBECTL_ALLOWLIST_MAX_PATTERNS) {
    return `At most ${KUBECTL_ALLOWLIST_MAX_PATTERNS} patterns; this list has ${patterns.length}.`;
  }

  for (let index: number = 0; index < patterns.length; index++) {
    const problem: string | null =
      KubectlPolicy.describeAllowlistPatternProblem(patterns[index]);

    if (problem) {
      return `Pattern ${index + 1}: ${problem}`;
    }
  }

  return null;
}

/*
 * The stored allowlist exactly as the server reads it: trimmed non-blank
 * strings; a JSON-encoded array is read as that array, any other string as
 * ONE pattern; anything else is no pattern at all.
 */
export function readStoredKubectlAllowlist(value: unknown): Array<string> {
  let raw: unknown = value;

  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [value];
    }
  }

  if (!Array.isArray(raw)) {
    return [];
  }

  const patterns: Array<string> = [];

  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      patterns.push(entry.trim());
    }
  }

  return patterns;
}

/*
 * The stored allowlist for the form: the patterns the server reads, shown
 * whitespace-collapsed, and whether the stored value is a clean list — a
 * list, or a JSON-encoded list, of non-blank strings. A value that is not
 * clean is rewritten as a clean list when the form saves the allowlist.
 */
export interface SavedKubectlAllowlist {
  patterns: Array<string>;
  isClean: boolean;
}

export function normalizeSavedKubectlAllowlist(
  value: unknown,
): SavedKubectlAllowlist {
  if (value === null || value === undefined) {
    return { patterns: [], isClean: true };
  }

  const patterns: Array<string> = readStoredKubectlAllowlist(value).map(
    (pattern: string): string => {
      return collapseWhitespace(pattern);
    },
  );

  let raw: unknown = value;

  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { patterns, isClean: false };
    }
  }

  return {
    patterns,
    isClean:
      Array.isArray(raw) &&
      raw.every((entry: unknown): boolean => {
        return typeof entry === "string" && entry.trim().length > 0;
      }),
  };
}

// The cluster's AI settings as stored, read for the Change modal.
export interface KubernetesAiAccessSavedSettings {
  isAiInvestigationEnabled: boolean;
  aiRemediationMode: KubernetesAiRemediationMode;
  aiKubectlCommandAllowlist: unknown;
  aiAccessRunnerId: string | null;
  aiAccessRunnerName: string | null;
  aiAccessCredentialId: string | null;
  aiAccessCredentialName: string | null;
}

function readRelationId(
  id: ObjectID | string | undefined | null,
  relation: { _id?: unknown; id?: unknown } | undefined | null,
): string | null {
  if (id) {
    return id.toString();
  }
  const relationId: unknown = relation?._id || relation?.id;
  return relationId ? String(relationId) : null;
}

/*
 * Investigation is on unless the cluster says otherwise: the column
 * defaults to true, so a row that does not carry the value (never written,
 * or not returned) is read the way the server reads it.
 */
export function readKubernetesAiAccessSavedSettings(
  cluster: KubernetesCluster,
): KubernetesAiAccessSavedSettings {
  return {
    isAiInvestigationEnabled: cluster.isAiInvestigationEnabled !== false,
    aiRemediationMode: readRemediationMode(cluster.aiRemediationMode),
    aiKubectlCommandAllowlist: cluster.aiKubectlCommandAllowlist,
    aiAccessRunnerId: readRelationId(
      cluster.aiAccessRunnerId,
      cluster.aiAccessRunner,
    ),
    aiAccessRunnerName: cluster.aiAccessRunner?.name || null,
    aiAccessCredentialId: readRelationId(
      cluster.aiAccessCredentialId,
      cluster.aiAccessCredential,
    ),
    aiAccessCredentialName: cluster.aiAccessCredential?.name || null,
  };
}

/*
 * The Change modal's values. The allowlist is edited as text, one pattern
 * per line; an unbound Runner or credential is the empty string. The two
 * clear switches are offered to users who may unbind but not pick (see
 * KubernetesAiAccessOfferedFields).
 */
export interface KubernetesAiAccessSettingsFormValues {
  isAiInvestigationEnabled: boolean;
  aiRemediationMode: string;
  kubectlAllowlistText: string;
  aiAccessRunnerId: string;
  aiAccessCredentialId: string;
  clearAiAccessRunner: boolean;
  clearAiAccessCredential: boolean;
}

export function getKubernetesAiAccessSettingsInitialValues(
  saved: KubernetesAiAccessSavedSettings,
): FormValues<KubernetesAiAccessSettingsFormValues> {
  return {
    isAiInvestigationEnabled: saved.isAiInvestigationEnabled,
    aiRemediationMode: saved.aiRemediationMode,
    kubectlAllowlistText: normalizeSavedKubectlAllowlist(
      saved.aiKubectlCommandAllowlist,
    ).patterns.join("\n"),
    aiAccessRunnerId: saved.aiAccessRunnerId || "",
    aiAccessCredentialId: saved.aiAccessCredentialId || "",
    clearAiAccessRunner: false,
    clearAiAccessCredential: false,
  };
}

/*
 * Which of the privileged fields the form offers. Every cluster editor may
 * TIGHTEN (the server's rule, mirrored by
 * getKubernetesAiAccessLooseningChanges), so the fields are offered by what
 * the user may do with them:
 *
 * allowlist:           an admin edits it freely; a cluster editor without
 *                      the admin set gets it only when there is something
 *                      to remove, and may only remove (allowlistRemoveOnly).
 * runner / credential: the pickers. Only for a cluster already bound to a
 *                      Runner outside the chart (advanced binding) — every
 *                      other cluster is reached through its Kubernetes AI
 *                      agent and has nothing to pick — and only for the
 *                      admin set with permission to list the rows.
 * runnerClear /
 * credentialClear:     an "Unbind" switch for a bound Runner / credential
 *                      of an advanced binding when its picker is not
 *                      offered. Unbinding moves the cluster to its AI agent
 *                      when it has one — a different access target, so a
 *                      loosening only the admin set may make; without an
 *                      agent it only takes access away, which every editor
 *                      may do.
 */
export interface KubernetesAiAccessOfferedFields {
  allowlist: boolean;
  allowlistRemoveOnly: boolean;
  runner: boolean;
  credential: boolean;
  runnerClear: boolean;
  credentialClear: boolean;
}

export function getKubernetesAiAccessOfferedFields(data: {
  saved: KubernetesAiAccessSavedSettings;
  canConfigureUnattended: boolean;
  isRunnerPickerAvailable: boolean;
  isCredentialPickerAvailable: boolean;
  isAdvancedBinding: boolean;
  hasAiAgent: boolean;
}): KubernetesAiAccessOfferedFields {
  const savedAllowlist: SavedKubectlAllowlist = normalizeSavedKubectlAllowlist(
    data.saved.aiKubectlCommandAllowlist,
  );
  const runner: boolean =
    data.isAdvancedBinding && data.isRunnerPickerAvailable;
  const credential: boolean =
    data.isAdvancedBinding && data.isCredentialPickerAvailable;
  const mayUnbind: boolean = data.canConfigureUnattended || !data.hasAiAgent;

  return {
    allowlist:
      data.canConfigureUnattended ||
      savedAllowlist.patterns.length > 0 ||
      !savedAllowlist.isClean,
    allowlistRemoveOnly: !data.canConfigureUnattended,
    runner,
    credential,
    runnerClear:
      data.isAdvancedBinding &&
      !runner &&
      mayUnbind &&
      data.saved.aiAccessRunnerId !== null,
    credentialClear:
      data.isAdvancedBinding &&
      !credential &&
      mayUnbind &&
      data.saved.aiAccessCredentialId !== null,
  };
}

/*
 * The allowlist only matters in Automatic mode (Bypass approval runs every
 * allowed change anyway), so the Change modal shows the field only while
 * Automatic is chosen — and a hidden field is never sent, so text typed
 * before switching away from Automatic cannot slip into the save unchecked.
 */
export function isAllowlistFieldShown(
  values: FormValues<KubernetesAiAccessSettingsFormValues>,
): boolean {
  return (
    readDropdownId(values.aiRemediationMode) ===
    KubernetesAiRemediationMode.Automatic
  );
}

export function getKubernetesAiAccessSubmittedFields(data: {
  offered: KubernetesAiAccessOfferedFields;
  values: FormValues<KubernetesAiAccessSettingsFormValues>;
}): KubernetesAiAccessOfferedFields {
  return {
    ...data.offered,
    allowlist: data.offered.allowlist && isAllowlistFieldShown(data.values),
  };
}

export function readDropdownId(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (
    typeof value === "object" &&
    "value" in (value as Record<string, unknown>)
  ) {
    return readDropdownId((value as { value: unknown }).value);
  }
  return String(value);
}

function isSameStringList(a: Array<string>, b: Array<string>): boolean {
  return (
    a.length === b.length &&
    a.every((item: string, index: number): boolean => {
      return item === b[index];
    })
  );
}

/*
 * The patterns to send, each line the stored list already holds in the
 * spelling it is stored in. The form shows patterns whitespace-collapsed,
 * but the server decides "does this write add a pattern?" by comparing the
 * stored strings exactly: re-sending "kubectl  scale …" as "kubectl scale
 * …" would read as a new pattern, and a cluster editor who removed one
 * line would be refused for "adding" another.
 */
function withStoredSpellings(
  patterns: Array<string>,
  storedValue: unknown,
): Array<string> {
  const spellings: Map<string, string> = new Map<string, string>();

  for (const stored of readStoredKubectlAllowlist(storedValue)) {
    const collapsed: string = collapseWhitespace(stored);

    if (!spellings.has(collapsed)) {
      spellings.set(collapsed, stored);
    }
  }

  return patterns.map((pattern: string): string => {
    return spellings.get(pattern) ?? pattern;
  });
}

/*
 * The update to send: only what the user changed, and only fields the
 * form offered. A form that re-submits every field would re-write a
 * privileged value the user merely left alone — an editor who only turns
 * investigation off would re-send "Automatic" and be refused for a change
 * they never made — and a field that was never offered must never be
 * written at all.
 *
 * One deliberate exception: a stored allowlist that is not a clean list is
 * rewritten from the form when the allowlist is offered, so saving the form
 * replaces a value the policy ignores anyway with the list the form shows.
 */
export function getKubernetesAiAccessSettingsChanges(data: {
  saved: KubernetesAiAccessSavedSettings;
  values: FormValues<KubernetesAiAccessSettingsFormValues>;
  offered: KubernetesAiAccessOfferedFields;
}): JSONObject {
  const changes: JSONObject = {};

  const isInvestigationEnabled: boolean =
    data.values.isAiInvestigationEnabled === true;
  if (isInvestigationEnabled !== data.saved.isAiInvestigationEnabled) {
    changes["isAiInvestigationEnabled"] = isInvestigationEnabled;
  }

  const mode: string | null = readDropdownId(data.values.aiRemediationMode);
  if (
    mode &&
    Object.values(KubernetesAiRemediationMode).includes(
      mode as KubernetesAiRemediationMode,
    ) &&
    mode !== data.saved.aiRemediationMode
  ) {
    changes["aiRemediationMode"] = mode;
  }

  if (data.offered.allowlist) {
    const patterns: Array<string> = parseKubectlAllowlistText(
      data.values.kubectlAllowlistText,
    );
    const saved: SavedKubectlAllowlist = normalizeSavedKubectlAllowlist(
      data.saved.aiKubectlCommandAllowlist,
    );
    if (!saved.isClean || !isSameStringList(patterns, saved.patterns)) {
      changes["aiKubectlCommandAllowlist"] = withStoredSpellings(
        patterns,
        data.saved.aiKubectlCommandAllowlist,
      );
    }
  }

  if (data.offered.runner) {
    const runnerId: string | null = readDropdownId(
      data.values.aiAccessRunnerId,
    );
    if (runnerId !== data.saved.aiAccessRunnerId) {
      changes["aiAccessRunnerId"] = runnerId;
    }
  } else if (
    data.offered.runnerClear &&
    data.values.clearAiAccessRunner === true &&
    data.saved.aiAccessRunnerId !== null
  ) {
    // A clear switch can only ever send null.
    changes["aiAccessRunnerId"] = null;
  }

  if (data.offered.credential) {
    const credentialId: string | null = readDropdownId(
      data.values.aiAccessCredentialId,
    );
    if (credentialId !== data.saved.aiAccessCredentialId) {
      changes["aiAccessCredentialId"] = credentialId;
    }
  } else if (
    data.offered.credentialClear &&
    data.values.clearAiAccessCredential === true &&
    data.saved.aiAccessCredentialId !== null
  ) {
    changes["aiAccessCredentialId"] = null;
  }

  return changes;
}

/*
 * How much each mode lets OneUptime AI do, least first — the server's
 * REMEDIATION_MODES_BY_AUTONOMY (KubernetesClusterService). Automatic runs
 * a strict subset of what Bypass approval runs, so Bypass approval ->
 * Automatic is a tightening.
 */
export const REMEDIATION_MODES_BY_AUTONOMY: Array<KubernetesAiRemediationMode> =
  [
    KubernetesAiRemediationMode.Disabled,
    KubernetesAiRemediationMode.RequireApproval,
    KubernetesAiRemediationMode.Automatic,
    KubernetesAiRemediationMode.BypassApproval,
  ];

function getRemediationModeAutonomy(mode: KubernetesAiRemediationMode): number {
  return REMEDIATION_MODES_BY_AUTONOMY.indexOf(mode);
}

/*
 * May a cluster editor WITHOUT the admin set choose this mode on a cluster
 * saved at `savedMode`? Only modes at or below the saved one. Turning fixes
 * on at all (Off -> Ask for approval) lets AI propose changes to the
 * cluster, so it is a loosening like any other move up — the server
 * refuses it without the admin set too.
 */
export function isRemediationModeOpenToEveryEditor(
  mode: KubernetesAiRemediationMode,
  savedMode: KubernetesAiRemediationMode,
): boolean {
  return (
    getRemediationModeAutonomy(mode) <= getRemediationModeAutonomy(savedMode)
  );
}

/*
 * The changes that LOOSEN what AI may do on a cluster whose settings are
 * `saved`, and so need KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS — the
 * server's rule (KubernetesClusterService.getAiAccessLoosening), mirrored
 * so the page offers exactly what the server accepts:
 *
 * - mode: any move up, Off -> Ask for approval included (Bypass approval ->
 *   Automatic and every move down tighten);
 * - allowlist: a pattern the stored list does not already hold, compared
 *   the way the server compares them (trimmed stored strings);
 * - Runner or credential: binding one other than the bound one; and, when
 *   the cluster has a Kubernetes AI agent, clearing either one — that
 *   changes which identity AI reaches the cluster through (the agent may
 *   hold broader write RBAC than the Runner's credential).
 *
 * Each entry names the change for the refusal; empty when nothing loosens.
 */
export function getKubernetesAiAccessLooseningChanges(data: {
  saved: KubernetesAiAccessSavedSettings;
  changes: JSONObject;
  hasAiAgent: boolean;
}): Array<string> {
  const loosening: Array<string> = [];

  const mode: KubernetesAiRemediationMode | undefined = data.changes[
    "aiRemediationMode"
  ] as KubernetesAiRemediationMode | undefined;

  if (
    mode !== undefined &&
    REMEDIATION_MODES_BY_AUTONOMY.includes(mode) &&
    getRemediationModeAutonomy(mode) >
      getRemediationModeAutonomy(data.saved.aiRemediationMode)
  ) {
    loosening.push(`switching fixes to ${REMEDIATION_MODE_SHORT_NAMES[mode]}`);
  }

  const allowlist: unknown = data.changes["aiKubectlCommandAllowlist"];

  if (allowlist !== undefined) {
    const stored: Array<string> = readStoredKubectlAllowlist(
      data.saved.aiKubectlCommandAllowlist,
    );
    const added: Array<string> = (Array.isArray(allowlist) ? allowlist : [])
      .filter((pattern: unknown): pattern is string => {
        return typeof pattern === "string";
      })
      .filter((pattern: string): boolean => {
        return !stored.includes(pattern.trim());
      });

    if (added.length > 0) {
      loosening.push(
        `adding the kubectl allowlist pattern${added.length === 1 ? "" : "s"} ${added
          .map((pattern: string): string => {
            return `"${pattern}"`;
          })
          .join(", ")}`,
      );
    }
  }

  if ("aiAccessRunnerId" in data.changes) {
    const runnerId: unknown = data.changes["aiAccessRunnerId"];

    if (runnerId && String(runnerId) !== data.saved.aiAccessRunnerId) {
      loosening.push("binding a different Runner");
    } else if (
      !runnerId &&
      data.saved.aiAccessRunnerId !== null &&
      data.hasAiAgent
    ) {
      loosening.push("switching this cluster to its Kubernetes AI agent");
    }
  }

  if ("aiAccessCredentialId" in data.changes) {
    const credentialId: unknown = data.changes["aiAccessCredentialId"];

    if (
      credentialId &&
      String(credentialId) !== data.saved.aiAccessCredentialId
    ) {
      loosening.push("binding a Kubernetes credential");
    } else if (
      !credentialId &&
      data.saved.aiAccessCredentialId !== null &&
      data.hasAiAgent
    ) {
      loosening.push("removing the Kubernetes credential");
    }
  }

  return loosening;
}

/*
 * What the allowlist field refuses from a cluster editor without the admin
 * set: any line the stored list does not hold (compared whitespace-
 * collapsed, the form's spelling). Removing lines and clearing the list
 * pass.
 */
export function getKubectlAllowlistRemovalOnlyError(data: {
  text: unknown;
  storedValue: unknown;
}): string | null {
  const stored: Array<string> = readStoredKubectlAllowlist(
    data.storedValue,
  ).map((pattern: string): string => {
    return collapseWhitespace(pattern);
  });
  const patterns: Array<string> = parseKubectlAllowlistText(data.text);

  for (let index: number = 0; index < patterns.length; index++) {
    const pattern: string = patterns[index]!;

    if (!stored.includes(pattern)) {
      return `Pattern ${index + 1} ("${pattern}") is not in the saved allowlist. You can remove patterns or clear the list; adding or changing one needs one of these permissions: ${getKubernetesAiAccessAdminPermissionTitles().join(", ")}.`;
    }
  }

  return null;
}

export interface KubernetesAiAccessConfirmation {
  title: string;
  description: string;
}

const RISKIER_CHANGE_EXAMPLES: string = translationKey(
  "riskier changes such as kubectl set image, patch, scale to zero and deleting workloads",
);

/*
 * Saving Bypass approval, or a broad allowlist pattern while Automatic mode
 * is on or being turned on, lets riskier changes run with nobody asked.
 * Such a save is confirmed first, in words that name what it unlocks. A
 * pattern is broad exactly when KubectlPolicy.isBroadAllowlistPattern says
 * so, decided on the tokens the matcher itself reads. Null when the save
 * needs no confirmation.
 */
export function getKubernetesAiAccessConfirmation(data: {
  saved: KubernetesAiAccessSavedSettings;
  changes: JSONObject;
}): KubernetesAiAccessConfirmation | null {
  const newMode: KubernetesAiRemediationMode | undefined = data.changes[
    "aiRemediationMode"
  ] as KubernetesAiRemediationMode | undefined;
  const resultingMode: KubernetesAiRemediationMode =
    newMode || data.saved.aiRemediationMode;

  if (newMode === KubernetesAiRemediationMode.BypassApproval) {
    return {
      title: "Turn on Bypass approval?",
      description: translateTemplate(
        "With Bypass approval OneUptime AI does not ask: it applies every fix the kubectl policy allows on this cluster on its own — {{examples}} included, in follow-up rounds too. Even so, {{protections}}.",
        {
          examples: translatableTerm(RISKIER_CHANGE_EXAMPLES),
          protections: getEveryModeProtectionsSentence(),
        },
      ),
    };
  }

  const savedPatterns: Array<string> = normalizeSavedKubectlAllowlist(
    data.saved.aiKubectlCommandAllowlist,
  ).patterns;
  const changedPatterns: unknown = data.changes["aiKubectlCommandAllowlist"];
  const resultingPatterns: Array<string> = Array.isArray(changedPatterns)
    ? changedPatterns
        .filter((pattern: unknown): pattern is string => {
          return typeof pattern === "string";
        })
        .map((pattern: string): string => {
          return collapseWhitespace(pattern);
        })
    : savedPatterns;

  const broadPatterns: Array<string> = resultingPatterns.filter(
    (pattern: string): boolean => {
      return KubectlPolicy.isBroadAllowlistPattern(pattern);
    },
  );

  if (broadPatterns.length === 0) {
    return null;
  }

  const newBroadPatterns: Array<string> = broadPatterns.filter(
    (pattern: string): boolean => {
      return !savedPatterns.includes(pattern);
    },
  );
  // Up to Automatic: from Bypass approval it is a step down, not a new risk.
  const isTurningOnAutomatic: boolean =
    newMode === KubernetesAiRemediationMode.Automatic &&
    getRemediationModeAutonomy(data.saved.aiRemediationMode) <
      getRemediationModeAutonomy(KubernetesAiRemediationMode.Automatic);

  if (newBroadPatterns.length === 0 && !isTurningOnAutomatic) {
    return null;
  }

  const quoted: string = broadPatterns
    .map((pattern: string): string => {
      return `"${pattern}"`;
    })
    .join(", ");

  const descriptionValues: {
    patterns: string;
    examples: TranslatableTerm;
    protections: string;
  } = {
    patterns: quoted,
    examples: translatableTerm(RISKIER_CHANGE_EXAMPLES),
    protections: getEveryModeProtectionsSentence(),
  };

  return {
    title: "Let riskier changes run without approval?",
    description:
      resultingMode === KubernetesAiRemediationMode.Automatic
        ? translatePlural(
            {
              one: "The allowlist pattern {{patterns}} uses a wildcard for an object, the namespace, a selector or a --from source, so it pre-approves a whole class of changes, not one. In Automatic mode, every riskier change of that shape — to any object and in any namespace the wildcard covers, {{examples}} included — then runs with nobody asked. Even so, {{protections}}.",
              other:
                "The allowlist patterns {{patterns}} use a wildcard for an object, the namespace, a selector or a --from source, so they pre-approve a whole class of changes, not one. In Automatic mode, every riskier change of that shape — to any object and in any namespace the wildcard covers, {{examples}} included — then runs with nobody asked. Even so, {{protections}}.",
            },
            broadPatterns.length,
            descriptionValues,
          )
        : translatePlural(
            {
              one: "The allowlist pattern {{patterns}} uses a wildcard for an object, the namespace, a selector or a --from source, so it pre-approves a whole class of changes, not one. Once this cluster is switched to Automatic mode, every riskier change of that shape — to any object and in any namespace the wildcard covers, {{examples}} included — then runs with nobody asked. Even so, {{protections}}.",
              other:
                "The allowlist patterns {{patterns}} use a wildcard for an object, the namespace, a selector or a --from source, so they pre-approve a whole class of changes, not one. Once this cluster is switched to Automatic mode, every riskier change of that shape — to any object and in any namespace the wildcard covers, {{examples}} included — then runs with nobody asked. Even so, {{protections}}.",
            },
            broadPatterns.length,
            descriptionValues,
          ),
  };
}

/*
 * The Runners the Change modal lists for an advanced binding, with what
 * the pickers need to know about each: its name, and whether it is a
 * kubernetes-agent Runner — by the server's rule (isKubernetesAgentRunnerRow:
 * the name marker, compared case-insensitively, or an agent posture).
 */
export interface KubernetesAiRunnerDirectoryEntry {
  name: string;
  isAgent: boolean;
}

export function buildKubernetesAiRunnerDirectory(
  runners: Array<Runner>,
): Record<string, KubernetesAiRunnerDirectoryEntry> {
  const directory: Record<string, KubernetesAiRunnerDirectoryEntry> = {};

  for (const runner of runners) {
    const id: string | null = runner._id ? String(runner._id) : null;

    if (!id) {
      continue;
    }

    const name: string = runner.name || id;
    directory[id] = { name, isAgent: isKubernetesAgentRunnerRow(runner) };
  }

  return directory;
}

/*
 * The Runner picker's options for an advanced binding: Runners outside the
 * chart with "Runs AI Remediation Commands" on. A kubernetes-agent Runner is
 * never offered — the cluster's Kubernetes AI agent replaces the chart's
 * previous in-cluster Runner, and another cluster's can only reach its own
 * cluster — and a Runner with the switch off would be refused every
 * command. The bound Runner is always kept, labelled with why it cannot
 * serve the cluster when it cannot, so the form shows the binding it would
 * otherwise silently hide.
 */
export function buildKubernetesAiRunnerOptions(data: {
  runners: Array<Runner>;
  boundRunnerId: string | null;
  boundRunnerName: string | null;
}): Array<DropdownOption> {
  const options: Array<DropdownOption> = [];
  let isBoundRunnerListed: boolean = false;

  for (const runner of data.runners) {
    const id: string | null = runner._id ? String(runner._id) : null;
    if (!id) {
      continue;
    }

    const name: string = runner.name || id;
    const isBound: boolean = id === data.boundRunnerId;

    // Why a listed Runner cannot be picked, as its whole option label.
    let unusableLabel: string | null = null;
    if (isKubernetesAgentRunnerRow(runner)) {
      unusableLabel = translationKey(
        "{{name}} (currently bound — installed by the Kubernetes agent chart, which now uses the Kubernetes AI agent)",
      );
    } else if (runner.canRunAiCommands !== true) {
      unusableLabel = translationKey(
        "{{name}} (currently bound — “Runs AI Remediation Commands” is off)",
      );
    }

    if (unusableLabel && !isBound) {
      continue;
    }

    if (isBound) {
      isBoundRunnerListed = true;
    }

    options.push({
      value: id,
      label: unusableLabel
        ? translateTemplate(unusableLabel, { name: name })
        : name,
    });
  }

  if (data.boundRunnerId && !isBoundRunnerListed) {
    options.unshift({
      value: data.boundRunnerId,
      label: translateTemplate("{{name}} (currently bound)", {
        name: data.boundRunnerName || translatableTerm("The bound Runner"),
      }),
    });
  }

  return options;
}

/*
 * The Runner the credential would be used through: its id and name, and
 * whether it is a kubernetes-agent Runner when the picker read its row.
 * Without the row — a bound Runner the list did not return — its name
 * decides.
 */
export interface KubernetesAiCredentialRunner {
  id: string | null;
  name: string | null;
  isAgent?: boolean | undefined;
}

// Fails closed: the row's verdict when read, and its name marker in any case.
function isAgentCredentialRunner(
  runner: KubernetesAiCredentialRunner,
): boolean {
  return (
    runner.isAgent === true || isKubernetesAgentRunnerRow({ name: runner.name })
  );
}

// The Runners a credential row is assigned to; undefined when not read.
function readCredentialRunnerIds(
  credential: RunbookCredential,
): Array<string> | undefined {
  if (!Array.isArray(credential.runners)) {
    return undefined;
  }

  return credential.runners
    .map((runner: Runner): string => {
      return String(runner?._id || runner?.id || "");
    })
    .filter((id: string): boolean => {
      return id.length > 0;
    });
}

/*
 * The credential picker's options: Kubernetes credentials (the server
 * refuses anything else on save) assigned to the Runner the form has
 * chosen — the Runner uses a credential only when the credential is
 * assigned to it. None for a kubernetes-agent Runner, which is never given
 * a credential, and none before a Runner is chosen. The bound credential is
 * always kept, labelled with why it does not fit when it does not.
 */
export function buildKubernetesAiCredentialOptions(data: {
  credentials: Array<RunbookCredential>;
  boundCredentialId: string | null;
  boundCredentialName: string | null;
  runner: KubernetesAiCredentialRunner;
}): Array<DropdownOption> {
  const options: Array<DropdownOption> = [];
  const runnerName: string | TranslatableTerm =
    data.runner.name || translatableTerm("the chosen Runner");
  const isAgentRunner: boolean = isAgentCredentialRunner(data.runner);

  for (const credential of data.credentials) {
    const id: string | null = credential._id ? String(credential._id) : null;
    if (!id) {
      continue;
    }

    const isBound: boolean = id === data.boundCredentialId;
    const name: string = credential.name || id;

    if (
      credential.credentialType &&
      credential.credentialType !== RunbookCredentialType.Kubernetes
    ) {
      if (isBound) {
        options.push({
          value: id,
          label: translateTemplate(
            "{{name}} (currently bound — not a Kubernetes credential)",
            { name: name },
          ),
        });
      }
      continue;
    }

    const runnerIds: Array<string> | undefined =
      readCredentialRunnerIds(credential);

    // Why the credential cannot be picked, as its whole option label.
    let unusableLabel: string | null = null;
    if (isAgentRunner) {
      unusableLabel = translationKey(
        "{{name}} (currently bound — {{runner}} is an in-cluster Runner and is never given a credential)",
      );
    } else if (!data.runner.id) {
      unusableLabel = translationKey(
        "{{name}} (currently bound — no Runner is chosen to use it)",
      );
    } else if (runnerIds && !runnerIds.includes(data.runner.id)) {
      unusableLabel = translationKey(
        "{{name}} (currently bound — not assigned to {{runner}})",
      );
    }

    if (unusableLabel) {
      if (isBound) {
        options.push({
          value: id,
          label: translateTemplate(unusableLabel, {
            name: name,
            runner: runnerName,
          }),
        });
      }
      continue;
    }

    options.push({ value: id, label: name });
  }

  if (
    data.boundCredentialId &&
    !options.some((option: DropdownOption): boolean => {
      return option.value === data.boundCredentialId;
    })
  ) {
    options.unshift({
      value: data.boundCredentialId,
      label: translateTemplate("{{name}} (currently bound)", {
        name:
          data.boundCredentialName || translatableTerm("The bound credential"),
      }),
    });
  }

  return options;
}

// The credential field's help, for the Runner the form has chosen.
export function getKubernetesAiCredentialFieldDescription(
  runner: KubernetesAiCredentialRunner,
): string {
  if (runner.id && isAgentCredentialRunner(runner)) {
    return `No credential can be chosen: "${runner.name}" is an in-cluster Runner installed by the Kubernetes agent chart and is never given a credential.`;
  }

  if (!runner.id) {
    return "Choose the Runner first: only Kubernetes credentials (API server URL + ServiceAccount token) assigned to it are listed.";
  }

  return `The Kubernetes credentials (API server URL + ServiceAccount token) assigned to "${
    runner.name || "the chosen Runner"
  }". Assign one under Runbooks → Runner Credentials.`;
}

/*
 * Why the Runner and credential the form would save cannot work together,
 * or null. The status would report the pairing as a gap that blocks
 * investigation and remediation, so the save is refused with the reason
 * instead. Only a credential that is being set, or kept while a new Runner
 * is bound, is checked: unbinding either one never is.
 */
export function getKubernetesAiCredentialAssignmentError(data: {
  runner: KubernetesAiCredentialRunner;
  credentialId: string | null;
  credentialName: string | null;
  // The Runners the credential is assigned to; undefined when not known.
  credentialRunnerIds: Array<string> | undefined;
}): string | null {
  if (!data.credentialId) {
    return null;
  }

  const credential: string = data.credentialName
    ? `"${data.credentialName}"`
    : "The Kubernetes credential";

  if (data.runner.id && isAgentCredentialRunner(data.runner)) {
    return `"${data.runner.name}" is an in-cluster Runner: it runs kubectl with its own ServiceAccount and is never given a credential. Clear the Kubernetes credential, or choose a Runner created under Runbooks → Runners.`;
  }

  if (!data.runner.id) {
    return `${credential} is only used through a Runner it is assigned to: choose that Runner, or clear the credential.`;
  }

  if (
    data.credentialRunnerIds &&
    !data.credentialRunnerIds.includes(data.runner.id)
  ) {
    return `${credential} is not assigned to Runner "${
      data.runner.name || data.runner.id
    }". Assign it under Runbooks → Runner Credentials, or choose a credential assigned to that Runner.`;
  }

  return null;
}

// The credential rows the picker read, by id: name and assigned Runners.
export interface KubernetesAiCredentialDirectoryEntry {
  name: string;
  runnerIds: Array<string> | undefined;
}

export function buildKubernetesAiCredentialDirectory(
  credentials: Array<RunbookCredential>,
): Record<string, KubernetesAiCredentialDirectoryEntry> {
  const directory: Record<string, KubernetesAiCredentialDirectoryEntry> = {};

  for (const credential of credentials) {
    const id: string | null = credential._id ? String(credential._id) : null;

    if (!id) {
      continue;
    }

    directory[id] = {
      name: credential.name || id,
      runnerIds: readCredentialRunnerIds(credential),
    };
  }

  return directory;
}

/*
 * The Runner the form would bind: the picker's value when the picker is
 * offered, nothing once the clear switch is on, otherwise the saved one.
 */
export function getKubernetesAiAccessChosenRunnerId(data: {
  saved: KubernetesAiAccessSavedSettings;
  values: FormValues<KubernetesAiAccessSettingsFormValues>;
  offered: KubernetesAiAccessOfferedFields;
}): string | null {
  if (data.offered.runner) {
    return readDropdownId(data.values.aiAccessRunnerId);
  }

  if (data.offered.runnerClear && data.values.clearAiAccessRunner === true) {
    return null;
  }

  return data.saved.aiAccessRunnerId;
}

/*
 * Why the Runner and credential this save leaves bound cannot work
 * together (getKubernetesAiCredentialAssignmentError), or null. Checked
 * only when the save sets a credential, or binds a new Runner while a
 * credential stays bound — unbinding either one is never refused here.
 */
export function getKubernetesAiAccessBindingError(data: {
  saved: KubernetesAiAccessSavedSettings;
  changes: JSONObject;
  runners: Record<string, KubernetesAiRunnerDirectoryEntry>;
  credentials: Record<string, KubernetesAiCredentialDirectoryEntry>;
}): string | null {
  const isRunnerChanged: boolean = "aiAccessRunnerId" in data.changes;
  const isCredentialChanged: boolean = "aiAccessCredentialId" in data.changes;
  const runnerId: string | null = isRunnerChanged
    ? readDropdownId(data.changes["aiAccessRunnerId"])
    : data.saved.aiAccessRunnerId;
  const credentialId: string | null = isCredentialChanged
    ? readDropdownId(data.changes["aiAccessCredentialId"])
    : data.saved.aiAccessCredentialId;

  const isChecked: boolean =
    (isCredentialChanged && credentialId !== null) ||
    (isRunnerChanged && runnerId !== null && credentialId !== null);

  if (!isChecked) {
    return null;
  }

  const runnerName: string | null = runnerId
    ? data.runners[runnerId]?.name ||
      (runnerId === data.saved.aiAccessRunnerId
        ? data.saved.aiAccessRunnerName
        : null)
    : null;
  const credential: KubernetesAiCredentialDirectoryEntry | undefined =
    credentialId ? data.credentials[credentialId] : undefined;

  return getKubernetesAiCredentialAssignmentError({
    runner: {
      id: runnerId,
      name: runnerName,
      isAgent: runnerId ? data.runners[runnerId]?.isAgent : undefined,
    },
    credentialId,
    credentialName:
      credential?.name ||
      (credentialId === data.saved.aiAccessCredentialId
        ? data.saved.aiAccessCredentialName
        : null),
    credentialRunnerIds: credential?.runnerIds,
  });
}

// The allowlist the policy actually uses, as the status reports it.
export function getAllowlistInEffect(allowlist: unknown): Array<string> {
  return Array.isArray(allowlist)
    ? allowlist.filter((pattern: unknown): pattern is string => {
        return typeof pattern === "string" && pattern.trim().length > 0;
      })
    : [];
}

export function capitalizeFirst(value: string): string {
  return value.length > 0 ? `${value[0]!.toUpperCase()}${value.slice(1)}` : "";
}
