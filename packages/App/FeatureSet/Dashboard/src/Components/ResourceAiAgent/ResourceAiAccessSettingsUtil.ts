import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import { RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS as SERVER_RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS } from "Common/Types/AI/ResourceAiAccessPermissions";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import {
  RESOURCE_AI_ALLOW_WRITES_ENV,
  RESOURCE_AI_WRITE_TARGETS_ENV,
  ResourceAiRemediationMode,
  parseResourceAiRemediationMode,
} from "Common/Types/ResourceAiAgent/ResourceAiAccess";
import ResourceCommandPolicy, {
  RESOURCE_ALLOWLIST_MAX_PATTERNS,
} from "Common/Utils/AiRemediation/Resource/ResourceCommandPolicy";
import type FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ResourceAiAgentDescriptor } from "./ResourceAiAgentDescriptors";
import { joinAiAccessProtections } from "../AiAccess/AiAccessModes";

/*
 * The pure pieces behind "What AI may do" on a resource's AI agent page and
 * its Change modal: the words for each fixes mode (the looks shared with a
 * Kubernetes cluster's page live in ../AiAccess), who may loosen what
 * (relative to the saved settings, as the server decides it), what an edit
 * actually sends, when a save is confirmed first, and how the command
 * allowlist is read and checked — by ResourceCommandPolicy, the matcher's
 * own rules for that resource type. The resource twin of
 * Pages/Kubernetes/Utils/KubernetesAiAccessSettings.ts, without the Runner
 * and credential bindings (a resource is only ever reached through its
 * resource AI agent).
 *
 * Import-clean on purpose (Common types, policy and descriptors; UI types
 * are type-only imports), so the suites read it without a browser.
 */

/*
 * Who may LOOSEN what AI may do on a resource — turn fixes on (Off ->
 * anything) or up (Automatic, Bypass approval), or add an allowlist entry.
 * The server's own set (Common/Types/AI/ResourceAiAccessPermissions.ts),
 * which the resource models' column descriptions promise and every
 * resource service enforces on save: Project Owner, Project Admin or Edit
 * Auto Remediation Rule. Tightening stays open to everyone who may edit the
 * resource.
 */
export const RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS: ReadonlyArray<Permission> =
  SERVER_RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS;

// The mode's short name, as the card, the feed and the refusals say it.
export const RESOURCE_REMEDIATION_MODE_SHORT_NAMES: Record<
  ResourceAiRemediationMode,
  string
> = {
  [ResourceAiRemediationMode.Disabled]: "Off",
  [ResourceAiRemediationMode.RequireApproval]: "Ask for approval",
  [ResourceAiRemediationMode.Automatic]: "Automatic",
  [ResourceAiRemediationMode.BypassApproval]: "Bypass approval",
};

/*
 * What each mode does, in the words of the canonical description on
 * ResourceAiRemediationMode (Common/Types/ResourceAiAgent/
 * ResourceAiAccess.ts): the one line the Fixes row of "What AI may do"
 * shows for the current mode. Off says nothing about investigating — that
 * is the Investigation row's, and may be off too.
 */
export const RESOURCE_REMEDIATION_MODE_SUMMARIES: Record<
  ResourceAiRemediationMode,
  string
> = {
  [ResourceAiRemediationMode.Disabled]: "AI never proposes or runs a fix.",
  [ResourceAiRemediationMode.RequireApproval]:
    "AI proposes fixes. A person approves each one before it runs.",
  [ResourceAiRemediationMode.Automatic]:
    "Safe fixes run on their own. Riskier ones wait for your one-click approval.",
  [ResourceAiRemediationMode.BypassApproval]:
    "Every allowed fix runs on its own. Changes that always need a person still ask.",
};

/*
 * What the Investigation row of "What AI may do" says while investigation
 * is on: what AI may run, and that it changes nothing.
 */
export function getResourceInvestigationOnSentence(
  descriptor: ResourceAiAgentDescriptor,
): string {
  return `AI may run ${descriptor.readOnlyCommandsPhrase} on this ${descriptor.noun}: ${descriptor.readExamples}. They never change anything.`;
}

// A stored mode the page does not know reads as Off, as the server reads it.
export function readResourceRemediationMode(
  value: unknown,
): ResourceAiRemediationMode {
  return parseResourceAiRemediationMode(value);
}

// "a, b and c" / "a, b or c".
export function formatNameList(
  names: ReadonlyArray<string>,
  conjunction: string,
): string {
  if (names.length <= 1) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} ${conjunction} ${names[names.length - 1]}`;
}

export function capitalizeFirst(value: string): string {
  return value.length > 0 ? `${value[0]!.toUpperCase()}${value.slice(1)}` : "";
}

/*
 * What holds in every mode, Bypass approval included — the canonical
 * comment's "In EVERY mode" paragraph, clause for clause, with the
 * resource's own always-a-person changes named. The Change modal lists
 * the clauses under "What stays protected in every mode"; the
 * confirmations say them as one sentence.
 */
export function getEveryModeProtections(
  descriptor: ResourceAiAgentDescriptor,
): Array<string> {
  return [
    "commands the policy denies (a shell, exec, deleting data, anything that reads credentials, anything it does not know) never run",
    ...(descriptor.alwaysHumanExamples
      ? [
          `changes such as ${descriptor.alwaysHumanExamples} always need a human`,
        ]
      : []),
    `the ${descriptor.agentName} changes nothing unless it was started with ${RESOURCE_AI_ALLOW_WRITES_ENV}=true, and then never itself, the collector beside it or a target outside ${RESOURCE_AI_WRITE_TARGETS_ENV}`,
    `an unattended run becomes a proposal when the hourly circuit breaker trips or another unattended round already holds this ${descriptor.noun}`,
  ];
}

export function getEveryModeProtectionsSentence(
  descriptor: ResourceAiAgentDescriptor,
): string {
  return joinAiAccessProtections(getEveryModeProtections(descriptor));
}

/*
 * What each mode does, one card each in the Change modal's Fixes picker:
 * the canonical description on ResourceAiRemediationMode, a mode at a
 * time, with this resource type's riskier and always-a-person changes
 * named. What holds in every mode is listed under the cards
 * (getEveryModeProtections), not repeated on each.
 */
export function getResourceRemediationModeOptionDescriptions(
  descriptor: ResourceAiAgentDescriptor,
): Record<ResourceAiRemediationMode, string> {
  const riskier: string = descriptor.riskierExamples.replace(
    /^riskier changes such as /,
    "",
  );

  return {
    [ResourceAiRemediationMode.Disabled]:
      "AI never proposes or runs a fix. It can still investigate.",
    [ResourceAiRemediationMode.RequireApproval]:
      "AI proposes the exact fix, and a person approves it with one click before it runs. A follow-up fix asks again.",
    [ResourceAiRemediationMode.Automatic]: `Safe changes, each on one named object, run on their own. Riskier ones, such as ${riskier}, wait for one-click approval unless the command allowlist names them.`,
    [ResourceAiRemediationMode.BypassApproval]: `AI does not ask: every change the command policy allows runs on its own, riskier ones and follow-up rounds included.${
      descriptor.alwaysHumanExamples
        ? ` Changes such as ${descriptor.alwaysHumanExamples} still ask a person.`
        : ""
    }`,
  };
}

/*
 * Permission titles, the way PermissionGate names them, read straight from
 * the permission table so this module needs no browser.
 */
let permissionPropsCache: Dictionary<PermissionProps> | null = null;

export function getPermissionTitles(
  permissions: ReadonlyArray<Permission>,
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

export function getResourceAiAccessAdminPermissionTitles(): Array<string> {
  return getPermissionTitles(RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS);
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/*
 * The allowlist is edited one entry per line. Blank lines are layout, not
 * entries, and whitespace runs are collapsed the way the tokenizer reads
 * them.
 */
export function parseResourceAllowlistText(text: unknown): Array<string> {
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
 * Null when the text is a usable allowlist for this resource type,
 * otherwise what is wrong with it. What "usable" means is
 * ResourceCommandPolicy's — describeAllowlistProblems, the one definition
 * the matcher, the server's save validation and this form share — with the
 * failing line named.
 */
export function validateResourceAllowlistText(
  resourceType: AiResourceType,
  text: unknown,
): string | null {
  const patterns: Array<string> = parseResourceAllowlistText(text);

  const problem: string | null =
    ResourceCommandPolicy.describeAllowlistProblems({ resourceType, patterns });

  if (!problem) {
    return null;
  }

  for (let index: number = 0; index < patterns.length; index++) {
    const patternProblem: string | null =
      ResourceCommandPolicy.describeAllowlistPatternProblem({
        resourceType,
        pattern: patterns[index],
      });

    if (patternProblem) {
      return `Entry ${index + 1}: ${patternProblem}`;
    }
  }

  return problem;
}

/*
 * The stored allowlist exactly as the server reads it: trimmed non-blank
 * strings; a JSON-encoded array is read as that array, any other string as
 * ONE entry; anything else is no entry at all.
 */
export function readStoredResourceAllowlist(value: unknown): Array<string> {
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
 * The stored allowlist for the form: the entries the server reads, shown
 * whitespace-collapsed, and whether the stored value is a clean list — a
 * list, or a JSON-encoded list, of non-blank strings. A value that is not
 * clean is rewritten as a clean list when the form saves the allowlist.
 */
export interface SavedResourceAllowlist {
  patterns: Array<string>;
  isClean: boolean;
}

export function normalizeSavedResourceAllowlist(
  value: unknown,
): SavedResourceAllowlist {
  if (value === null || value === undefined) {
    return { patterns: [], isClean: true };
  }

  const patterns: Array<string> = readStoredResourceAllowlist(value).map(
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

// The resource's AI settings as stored, read for the Change modal.
export interface ResourceAiAccessSavedSettings {
  isAiInvestigationEnabled: boolean;
  aiRemediationMode: ResourceAiRemediationMode;
  aiCommandAllowlist: unknown;
}

/*
 * Investigation is off unless the resource says otherwise: unlike a
 * Kubernetes cluster's, the column defaults to false (the agent's first
 * connection turns it on), so a row that does not carry the value is read
 * the way the server reads it.
 */
export function readResourceAiAccessSavedSettings(model: {
  isAiInvestigationEnabled?: boolean | undefined;
  aiRemediationMode?: unknown;
  aiCommandAllowlist?: unknown;
}): ResourceAiAccessSavedSettings {
  return {
    isAiInvestigationEnabled: model.isAiInvestigationEnabled === true,
    aiRemediationMode: readResourceRemediationMode(model.aiRemediationMode),
    aiCommandAllowlist: model.aiCommandAllowlist,
  };
}

// The Change modal's values. The allowlist is edited as text, one per line.
export interface ResourceAiAccessSettingsFormValues {
  isAiInvestigationEnabled: boolean;
  aiRemediationMode: string;
  aiCommandAllowlistText: string;
}

export function getResourceAiAccessSettingsInitialValues(
  saved: ResourceAiAccessSavedSettings,
): FormValues<ResourceAiAccessSettingsFormValues> {
  return {
    isAiInvestigationEnabled: saved.isAiInvestigationEnabled,
    aiRemediationMode: saved.aiRemediationMode,
    aiCommandAllowlistText: normalizeSavedResourceAllowlist(
      saved.aiCommandAllowlist,
    ).patterns.join("\n"),
  };
}

/*
 * Which of the privileged fields the form offers. Every editor may TIGHTEN
 * (the server's rule, mirrored by getResourceAiAccessLooseningChanges):
 *
 * allowlist: an admin edits it freely; an editor without the admin set gets
 *            it only when there is something to remove, and may only remove
 *            (allowlistRemoveOnly).
 */
export interface ResourceAiAccessOfferedFields {
  allowlist: boolean;
  allowlistRemoveOnly: boolean;
}

export function getResourceAiAccessOfferedFields(data: {
  saved: ResourceAiAccessSavedSettings;
  canConfigureUnattended: boolean;
}): ResourceAiAccessOfferedFields {
  const savedAllowlist: SavedResourceAllowlist =
    normalizeSavedResourceAllowlist(data.saved.aiCommandAllowlist);

  return {
    allowlist:
      data.canConfigureUnattended ||
      savedAllowlist.patterns.length > 0 ||
      !savedAllowlist.isClean,
    allowlistRemoveOnly: !data.canConfigureUnattended,
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

/*
 * The allowlist only matters in Automatic mode (Bypass approval runs every
 * allowed change anyway), so the Change modal shows the field only while
 * Automatic is chosen — and a hidden field is never sent, so text typed
 * before switching away from Automatic cannot slip into the save unchecked.
 */
export function isResourceAllowlistFieldShown(
  values: FormValues<ResourceAiAccessSettingsFormValues>,
): boolean {
  return (
    readDropdownId(values.aiRemediationMode) ===
    ResourceAiRemediationMode.Automatic
  );
}

export function getResourceAiAccessSubmittedFields(data: {
  offered: ResourceAiAccessOfferedFields;
  values: FormValues<ResourceAiAccessSettingsFormValues>;
}): ResourceAiAccessOfferedFields {
  return {
    ...data.offered,
    allowlist:
      data.offered.allowlist && isResourceAllowlistFieldShown(data.values),
  };
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
 * The entries to send, each line the stored list already holds in the
 * spelling it is stored in. The form shows entries whitespace-collapsed,
 * but the server decides "does this write add an entry?" by comparing the
 * stored strings exactly: re-sending "docker  stop web" as "docker stop
 * web" would read as a new entry, and an editor who removed one line would
 * be refused for "adding" another.
 */
function withStoredSpellings(
  patterns: Array<string>,
  storedValue: unknown,
): Array<string> {
  const spellings: Map<string, string> = new Map<string, string>();

  for (const stored of readStoredResourceAllowlist(storedValue)) {
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
 * they never made.
 *
 * One deliberate exception: a stored allowlist that is not a clean list is
 * rewritten from the form when the allowlist is offered, so saving the form
 * replaces a value the policy ignores anyway with the list the form shows.
 */
export function getResourceAiAccessSettingsChanges(data: {
  saved: ResourceAiAccessSavedSettings;
  values: FormValues<ResourceAiAccessSettingsFormValues>;
  offered: ResourceAiAccessOfferedFields;
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
    Object.values(ResourceAiRemediationMode).includes(
      mode as ResourceAiRemediationMode,
    ) &&
    mode !== data.saved.aiRemediationMode
  ) {
    changes["aiRemediationMode"] = mode;
  }

  if (data.offered.allowlist) {
    const patterns: Array<string> = parseResourceAllowlistText(
      data.values.aiCommandAllowlistText,
    );
    const saved: SavedResourceAllowlist = normalizeSavedResourceAllowlist(
      data.saved.aiCommandAllowlist,
    );
    if (!saved.isClean || !isSameStringList(patterns, saved.patterns)) {
      changes["aiCommandAllowlist"] = withStoredSpellings(
        patterns,
        data.saved.aiCommandAllowlist,
      );
    }
  }

  return changes;
}

/*
 * How much each mode lets OneUptime AI do, least first. Automatic runs a
 * strict subset of what Bypass approval runs, so Bypass approval ->
 * Automatic is a tightening.
 */
export const RESOURCE_REMEDIATION_MODES_BY_AUTONOMY: Array<ResourceAiRemediationMode> =
  [
    ResourceAiRemediationMode.Disabled,
    ResourceAiRemediationMode.RequireApproval,
    ResourceAiRemediationMode.Automatic,
    ResourceAiRemediationMode.BypassApproval,
  ];

function getRemediationModeAutonomy(mode: ResourceAiRemediationMode): number {
  return RESOURCE_REMEDIATION_MODES_BY_AUTONOMY.indexOf(mode);
}

/*
 * May an editor WITHOUT the admin set choose this mode on a resource saved
 * at `savedMode`? Only modes at or below the saved one. Turning fixes on at
 * all (Off -> Ask for approval) lets AI propose changes, so it is a
 * loosening like any other move up — the server refuses it too.
 */
export function isResourceRemediationModeOpenToEveryEditor(
  mode: ResourceAiRemediationMode,
  savedMode: ResourceAiRemediationMode,
): boolean {
  return (
    getRemediationModeAutonomy(mode) <= getRemediationModeAutonomy(savedMode)
  );
}

/*
 * The changes that LOOSEN what AI may do on a resource whose settings are
 * `saved`, and so need RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS — the server's
 * rule, mirrored so the page offers exactly what the server accepts:
 *
 * - mode: any move up, Off -> Ask for approval included (Bypass approval ->
 *   Automatic and every move down tighten);
 * - allowlist: an entry the stored list does not already hold, compared the
 *   way the server compares them (trimmed stored strings).
 *
 * Each entry names the change for the refusal; empty when nothing loosens.
 */
export function getResourceAiAccessLooseningChanges(data: {
  saved: ResourceAiAccessSavedSettings;
  changes: JSONObject;
}): Array<string> {
  const loosening: Array<string> = [];

  const mode: ResourceAiRemediationMode | undefined = data.changes[
    "aiRemediationMode"
  ] as ResourceAiRemediationMode | undefined;

  if (
    mode !== undefined &&
    RESOURCE_REMEDIATION_MODES_BY_AUTONOMY.includes(mode) &&
    getRemediationModeAutonomy(mode) >
      getRemediationModeAutonomy(data.saved.aiRemediationMode)
  ) {
    loosening.push(
      `switching fixes to ${RESOURCE_REMEDIATION_MODE_SHORT_NAMES[mode]}`,
    );
  }

  const allowlist: unknown = data.changes["aiCommandAllowlist"];

  if (allowlist !== undefined) {
    const stored: Array<string> = readStoredResourceAllowlist(
      data.saved.aiCommandAllowlist,
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
        `adding the allowlist entr${added.length === 1 ? "y" : "ies"} ${added
          .map((pattern: string): string => {
            return `"${pattern}"`;
          })
          .join(", ")}`,
      );
    }
  }

  return loosening;
}

/*
 * What the allowlist field refuses from an editor without the admin set:
 * any line the stored list does not hold (compared whitespace-collapsed,
 * the form's spelling). Removing lines and clearing the list pass.
 */
export function getResourceAllowlistRemovalOnlyError(data: {
  text: unknown;
  storedValue: unknown;
}): string | null {
  const stored: Array<string> = readStoredResourceAllowlist(
    data.storedValue,
  ).map((pattern: string): string => {
    return collapseWhitespace(pattern);
  });
  const patterns: Array<string> = parseResourceAllowlistText(data.text);

  for (let index: number = 0; index < patterns.length; index++) {
    const pattern: string = patterns[index]!;

    if (!stored.includes(pattern)) {
      return `Entry ${index + 1} ("${pattern}") is not in the saved allowlist. You can remove entries or clear the list; adding or changing one needs one of these permissions: ${getResourceAiAccessAdminPermissionTitles().join(", ")}.`;
    }
  }

  return null;
}

export interface ResourceAiAccessConfirmation {
  title: string;
  description: string;
}

/*
 * Saving Bypass approval, or a broad allowlist entry while Automatic mode
 * is on or being turned on, lets riskier changes run with nobody asked.
 * Such a save is confirmed first, in words that name what it unlocks. An
 * entry is broad exactly when ResourceCommandPolicy.isBroadAllowlistPattern
 * says so for this resource type — a `*` standing for the object a change
 * touches. Null when the save needs no confirmation.
 */
export function getResourceAiAccessConfirmation(data: {
  descriptor: ResourceAiAgentDescriptor;
  saved: ResourceAiAccessSavedSettings;
  changes: JSONObject;
}): ResourceAiAccessConfirmation | null {
  const newMode: ResourceAiRemediationMode | undefined = data.changes[
    "aiRemediationMode"
  ] as ResourceAiRemediationMode | undefined;
  const resultingMode: ResourceAiRemediationMode =
    newMode || data.saved.aiRemediationMode;
  const noun: string = data.descriptor.noun;

  if (newMode === ResourceAiRemediationMode.BypassApproval) {
    return {
      title: "Turn on Bypass approval?",
      description: `With Bypass approval OneUptime AI does not ask: it applies every fix the command policy allows on this ${noun} on its own — ${data.descriptor.riskierExamples} included, in follow-up rounds too. Even so, ${getEveryModeProtectionsSentence(
        data.descriptor,
      )}.`,
    };
  }

  const savedPatterns: Array<string> = normalizeSavedResourceAllowlist(
    data.saved.aiCommandAllowlist,
  ).patterns;
  const changedPatterns: unknown = data.changes["aiCommandAllowlist"];
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
      return ResourceCommandPolicy.isBroadAllowlistPattern({
        resourceType: data.descriptor.resourceType,
        pattern,
      });
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
    newMode === ResourceAiRemediationMode.Automatic &&
    getRemediationModeAutonomy(data.saved.aiRemediationMode) <
      getRemediationModeAutonomy(ResourceAiRemediationMode.Automatic);

  if (newBroadPatterns.length === 0 && !isTurningOnAutomatic) {
    return null;
  }

  const isOne: boolean = broadPatterns.length === 1;
  const quoted: string = broadPatterns
    .map((pattern: string): string => {
      return `"${pattern}"`;
    })
    .join(", ");

  return {
    title: "Let riskier changes run without approval?",
    description: `The allowlist entr${isOne ? "y" : "ies"} ${quoted} ${
      isOne ? "uses" : "use"
    } a * for the object a change touches, so ${
      isOne ? "it pre-approves" : "they pre-approve"
    } a whole class of changes, not one. ${
      resultingMode === ResourceAiRemediationMode.Automatic
        ? "In Automatic mode"
        : `Once this ${noun} is switched to Automatic mode`
    }, every riskier change of that shape — to any object the * covers — then runs with nobody asked. Even so, ${getEveryModeProtectionsSentence(
      data.descriptor,
    )}.`,
  };
}

// The allowlist the policy actually uses, as the status reports it.
export function getResourceAllowlistInEffect(
  allowlist: unknown,
): Array<string> {
  return Array.isArray(allowlist)
    ? allowlist.filter((pattern: unknown): pattern is string => {
        return typeof pattern === "string" && pattern.trim().length > 0;
      })
    : [];
}

/*
 * The allowlist field's help text: what an entry does and how it is
 * matched, with an example. The rest is said where it applies — a broken
 * entry by its validation error (validateResourceAllowlistText), a broad
 * one by the confirmation before saving, and what never runs unattended
 * by the modal's every-mode protections.
 */
export function getResourceAllowlistFieldDescription(
  descriptor: ResourceAiAgentDescriptor,
): string {
  return `One command per line, at most ${RESOURCE_ALLOWLIST_MAX_PATTERNS}. A riskier fix that matches an entry runs without approval. Entries are matched word by word: a * stands for exactly one whole word, and flags must be written out — for example: ${descriptor.allowlistPlaceholder}.`;
}
