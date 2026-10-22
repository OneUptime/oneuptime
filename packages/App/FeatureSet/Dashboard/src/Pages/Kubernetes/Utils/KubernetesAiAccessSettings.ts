import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import {
  KubernetesAiRemediationMode,
  PROTECTED_KUBERNETES_NAMESPACES,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import { KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS } from "Common/Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import KubectlPolicy, {
  KUBECTL_ALLOWLIST_MAX_PATTERNS,
} from "Common/Utils/AiRemediation/KubectlPolicy";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import type FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  capitalizeFirst,
  formatNameList,
  joinAiAccessProtections,
} from "../../../Components/AiAccess/AiAccessModes";
import {
  ComposedValue,
  composedValue,
  getGlobalTranslator,
  TranslatableTerm,
  translatableTerm,
  translatePlural,
  translateTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The pure pieces behind "What AI may do" on the cluster's AI agent page
 * and its Change modal: the words for each fixes mode, who may loosen what
 * (relative to the saved settings, as the server decides it), what an edit
 * actually sends, when a save is confirmed first, and how the kubectl
 * allowlist is read and checked (by KubectlPolicy, the matcher's own
 * rules).
 *
 * The words are the Dashboard's translation keys (src/Locales/README.md). A
 * constant or a map's label is the English key, looked up where the page
 * shows it; a function answers in the reader's language, each sentence
 * whole with its values in {{placeholders}}.
 *
 * Import-clean on purpose (Common types, models and policy only; UI types
 * are type-only imports), so the suites read it without a browser.
 */

// The mode's short name, as the card, the feed and the refusals say it.
export const REMEDIATION_MODE_SHORT_NAMES: Record<
  KubernetesAiRemediationMode,
  string
> = {
  [KubernetesAiRemediationMode.Disabled]: translationKey("Off"),
  [KubernetesAiRemediationMode.RequireApproval]:
    translationKey("Ask for approval"),
  [KubernetesAiRemediationMode.Automatic]: translationKey("Automatic"),
  [KubernetesAiRemediationMode.BypassApproval]:
    translationKey("Bypass approval"),
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
  [KubernetesAiRemediationMode.Disabled]: translationKey(
    "AI never proposes or runs a fix.",
  ),
  [KubernetesAiRemediationMode.RequireApproval]: translationKey(
    "AI proposes kubectl fixes. A person approves each one before it runs.",
  ),
  [KubernetesAiRemediationMode.Automatic]: translationKey(
    "Safe fixes run on their own. Riskier ones wait for your one-click approval.",
  ),
  [KubernetesAiRemediationMode.BypassApproval]: translationKey(
    "Every allowed fix runs on its own. Protected namespaces and node drains, taints and patches still ask a person.",
  ),
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
export const INVESTIGATION_ON_SENTENCE: string = translationKey(
  "AI may run read-only kubectl on this cluster: get, describe, logs, events, top. It never changes anything.",
);

/*
 * What holds in every mode, Bypass approval included — the canonical
 * comment's "In EVERY mode" paragraph, clause for clause: the Denied tier,
 * the protected namespaces, a node drain, a node taint and a patch of a
 * node, the in-cluster agent's own namespace and write scope, and the two
 * cases in which an unattended run becomes a proposal. The Change modal
 * lists the clauses under "What stays protected in every mode"; the
 * confirmations say them as one sentence.
 *
 * In `translator`'s language: the reader's, unless they go into a sentence
 * as a composedValue() of it.
 */
export function getEveryModeProtections(
  translator: Translator = getGlobalTranslator(),
): Array<string> {
  return [
    translator.translateTemplate(
      "destructive commands (deleting namespaces, volumes, nodes, secrets or CRDs; exec; apply) never run",
    ),
    translator.translateTemplate(
      "a write in {{namespaces}}, a node drain, a node taint and a patch of a node always need a human",
      {
        namespaces: composedValue((sentence: Translator): string => {
          return formatNameList(
            PROTECTED_KUBERNETES_NAMESPACES,
            "or",
            sentence,
          );
        }),
      },
    ),
    translator.translateTemplate(
      "the in-cluster agent never changes its own namespace or anything outside the namespaces its chart may write",
    ),
    translator.translateTemplate(
      "an unattended run becomes a proposal when the hourly per-cluster circuit breaker trips or another unattended round already holds the cluster",
    ),
  ];
}

export function getEveryModeProtectionsSentence(
  translator: Translator = getGlobalTranslator(),
): string {
  return joinAiAccessProtections(
    getEveryModeProtections(translator),
    translator,
  );
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
  [KubernetesAiRemediationMode.Disabled]: translationKey(
    "AI never proposes or runs a fix. It can still investigate.",
  ),
  [KubernetesAiRemediationMode.RequireApproval]: translationKey(
    "AI proposes the exact kubectl fix, and a person approves it with one click before it runs. A follow-up fix asks again.",
  ),
  [KubernetesAiRemediationMode.Automatic]: translationKey(
    "Safe changes on one named object (rollout restart or undo, scale above zero, delete a named pod, cordon a node, …) run on their own. Riskier ones (patch, set image, drain, taint, scale to zero, …) wait for one-click approval unless the kubectl allowlist names them.",
  ),
  [KubernetesAiRemediationMode.BypassApproval]: translationKey(
    "AI does not ask: every change the command policy allows runs on its own, riskier ones and follow-up rounds included. Writes in protected namespaces and node drains, taints and patches still ask a person.",
  ),
};

/*
 * The kubectl allowlist field's help text: what a pattern does and how it
 * is matched (the field's placeholder is an example). The rest is said where it applies — a
 * broken pattern by its validation error (validateKubectlAllowlistText), a
 * broad one by the confirmation before saving, and what never runs
 * unattended by the modal's every-mode protections.
 */
export const KUBECTL_ALLOWLIST_FIELD_DESCRIPTION: string = translationKey(
  'One pattern per line; a match runs without approval. * matches exactly one word, flags must be written out, and a leading "kubectl" is optional.',
);

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
    return translateTemplate(
      "At most {{max}} patterns; this list has {{count}}.",
      { max: KUBECTL_ALLOWLIST_MAX_PATTERNS, count: patterns.length },
    );
  }

  for (let index: number = 0; index < patterns.length; index++) {
    const problem: string | null =
      KubectlPolicy.describeAllowlistPatternProblem(patterns[index]);

    // The policy's own words (Common/Utils) are English.
    if (problem) {
      return translateTemplate("Pattern {{number}}: {{problem}}", {
        number: index + 1,
        problem: problem,
      });
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
  };
}

/*
 * The Change modal's values. The allowlist is edited as text, one pattern
 * per line.
 */
export interface KubernetesAiAccessSettingsFormValues {
  isAiInvestigationEnabled: boolean;
  aiRemediationMode: string;
  kubectlAllowlistText: string;
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
 * investigationAndFixes: false while the cluster's Kubernetes AI agent
 *                      sets the investigation switch and the fixes modes
 *                      (its chart does; the server refuses a change here):
 *                      the form then edits the allowlist alone. Offered
 *                      when left out.
 */
export interface KubernetesAiAccessOfferedFields {
  investigationAndFixes?: boolean | undefined;
  allowlist: boolean;
  allowlistRemoveOnly: boolean;
}

export function getKubernetesAiAccessOfferedFields(data: {
  saved: KubernetesAiAccessSavedSettings;
  canConfigureUnattended: boolean;
  // The cluster's Kubernetes AI agent sets investigation and fixes.
  isSetByAgent?: boolean | undefined;
}): KubernetesAiAccessOfferedFields {
  const savedAllowlist: SavedKubectlAllowlist = normalizeSavedKubectlAllowlist(
    data.saved.aiKubectlCommandAllowlist,
  );

  return {
    ...(data.isSetByAgent ? { investigationAndFixes: false } : {}),
    allowlist:
      data.canConfigureUnattended ||
      savedAllowlist.patterns.length > 0 ||
      !savedAllowlist.isClean,
    allowlistRemoveOnly: !data.canConfigureUnattended,
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

  // Never sent while the agent sets them: the form does not offer them.
  if (data.offered.investigationAndFixes !== false) {
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
 *   the way the server compares them (trimmed stored strings).
 *
 * Each entry names the change for the refusal (getAiAccessLooseningRefusal),
 * in `translator`'s language; empty when nothing loosens.
 */
export function getKubernetesAiAccessLooseningChanges(
  data: {
    saved: KubernetesAiAccessSavedSettings;
    changes: JSONObject;
  },
  translator: Translator = getGlobalTranslator(),
): Array<string> {
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
    loosening.push(
      translator.translateTemplate("switching fixes to {{mode}}", {
        mode: translatableTerm(REMEDIATION_MODE_SHORT_NAMES[mode]),
      }),
    );
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
        translator.translatePlural(
          {
            one: "adding the kubectl allowlist pattern {{patterns}}",
            other: "adding the kubectl allowlist patterns {{patterns}}",
          },
          added.length,
          {
            patterns: added
              .map((pattern: string): string => {
                return `"${pattern}"`;
              })
              .join(", "),
          },
        ),
      );
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
      return translateTemplate(
        'Pattern {{number}} ("{{pattern}}") is not in the saved allowlist. You can remove patterns or clear the list; adding or changing one needs one of these permissions: {{permissions}}.',
        {
          number: index + 1,
          pattern: pattern,
          permissions: getKubernetesAiAccessAdminPermissionTitles().join(", "),
        },
      );
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
      // A key: ConfirmModal looks its title up.
      title: translationKey("Turn on Bypass approval?"),
      description: translateTemplate(
        "With Bypass approval OneUptime AI does not ask: it applies every fix the kubectl policy allows on this cluster on its own — {{examples}} included, in follow-up rounds too. Even so, {{protections}}.",
        {
          examples: translatableTerm(RISKIER_CHANGE_EXAMPLES),
          protections: composedValue(getEveryModeProtectionsSentence),
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
    protections: ComposedValue;
  } = {
    patterns: quoted,
    examples: translatableTerm(RISKIER_CHANGE_EXAMPLES),
    protections: composedValue(getEveryModeProtectionsSentence),
  };

  return {
    title: translationKey("Let riskier changes run without approval?"),
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

// The allowlist the policy actually uses, as the status reports it.
export function getAllowlistInEffect(allowlist: unknown): Array<string> {
  return Array.isArray(allowlist)
    ? allowlist.filter((pattern: unknown): pattern is string => {
        return typeof pattern === "string" && pattern.trim().length > 0;
      })
    : [];
}

export { capitalizeFirst };
