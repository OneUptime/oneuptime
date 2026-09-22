import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import { Gray500, Green500, Red500, Yellow500 } from "Common/Types/BrandColors";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "Common/Types/Permission";
import {
  KubernetesAiAccessGap,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KUBERNETES_AGENT_RUNNER_NAME_PREFIX,
  PROTECTED_KUBERNETES_NAMESPACES,
  isKubernetesAgentRunnerName,
  isSameKubernetesClusterIdentifier,
  isUnattendedRemediationMode,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import {
  KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
  KUBERNETES_AI_ACCESS_CREDENTIAL_PERMISSIONS,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import RunbookCredentialType from "Common/Types/Runbook/RunbookCredentialType";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "Common/Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "Common/Types/Runbook/RunnerJobStatus";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import RunbookCredential from "Common/Models/DatabaseModels/RunbookCredential";
import Runner from "Common/Models/DatabaseModels/Runner";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import { APP_API_URL, HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import User from "Common/UI/Utils/User";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * The cluster's AI page: one place that answers "can OneUptime AI reach this
 * cluster, what may it do, and what is missing?" and lets an operator fix
 * every gap from here — install the in-cluster Runner with one helm flag,
 * or bind an existing Runner and credential; turn investigation on; choose
 * how remediation works; test the access; and see every kubectl command AI
 * ever ran here.
 */

interface AccessTestResult {
  ok: boolean;
  message: string;
  results: Array<{
    command: string;
    succeeded: boolean;
    exitCode: number | null;
    output: string;
    errorMessage: string | null;
  }>;
}

export const REMEDIATION_MODE_LABELS: Record<
  KubernetesAiRemediationMode,
  string
> = {
  [KubernetesAiRemediationMode.Disabled]: "Off — AI only investigates",
  [KubernetesAiRemediationMode.RequireApproval]:
    "Ask for approval — a human approves each kubectl plan",
  [KubernetesAiRemediationMode.Automatic]:
    "Automatic — safe fixes run on their own, riskier ones are left for you",
  [KubernetesAiRemediationMode.BypassApproval]:
    "Bypass approval — every allowed fix runs on its own, nobody is asked",
};

// How often the page re-reads the status; the Runner heartbeats every minute.
export const AI_ACCESS_STATUS_POLL_INTERVAL_MS: number = 30_000;

export const KUBECTL_JOBS_TABLE_PREFERENCES_KEY: string =
  "kubernetes-cluster-ai-kubectl-jobs";

/*
 * The "Why" column of the commands table, in the reader's words. Only the
 * two AI origins ever carry a Kubectl step; runbook steps are not kubectl.
 */
export const KUBECTL_JOB_ORIGIN_LABELS: Record<
  Extract<
    RunnerJobOrigin,
    RunnerJobOrigin.AiInvestigation | RunnerJobOrigin.AiRemediation
  >,
  string
> = {
  [RunnerJobOrigin.AiInvestigation]: "Investigation or access test",
  [RunnerJobOrigin.AiRemediation]: "Remediation",
};

/*
 * The helm release and namespace the Dashboard's own install instructions
 * use (Pages/Kubernetes/Utils/DocumentationMarkdown.ts: `helm install
 * kubernetes-agent oneuptime/kubernetes-agent --namespace oneuptime-agent`).
 * The one-command upgrade on this page must name the same pair: `helm
 * upgrade` of a release that does not exist fails with "has no deployed
 * releases", so a cluster installed the way the product said would not
 * connect. A parity test reads both and fails when they drift.
 */
export const KUBERNETES_AGENT_HELM_RELEASE: string = "kubernetes-agent";
export const KUBERNETES_AGENT_HELM_NAMESPACE: string = "oneuptime-agent";

export interface AiAccessHelmCommands {
  // The default: read-only investigation access. What a plain copy-paste runs.
  readOnly: string;
  /*
   * Optional second step: also grant the Runner write RBAC so AI can apply
   * fixes. A complete command of its own, never a line to append — a
   * dropped last line left a trailing backslash behind.
   */
  enableRemediation: string;
}

/*
 * `helm repo update` comes first: an install from before aiAccess existed
 * keeps a cached chart index, `helm upgrade` then resolves the old chart,
 * and its values schema refuses the flag with "Additional property
 * aiAccess is not allowed" — which reads as "this feature does not exist".
 * No chart version is named: published charts carry the OneUptime version,
 * not the chart's own.
 */
export function getAiAccessHelmCommands(): AiAccessHelmCommands {
  const upgrade: string = `helm upgrade ${KUBERNETES_AGENT_HELM_RELEASE} oneuptime/kubernetes-agent \\
  --namespace ${KUBERNETES_AGENT_HELM_NAMESPACE} --reuse-values \\
  --set aiAccess.enabled=true`;

  return {
    readOnly: `helm repo update
${upgrade}`,
    enableRemediation: `${upgrade} \\
  --set aiAccess.remediation.enabled=true`,
  };
}

/*
 * Whether the signed-in user holds one of `allowed` in this project, read
 * the way the server reads it: from the project's permission rows only,
 * and a BLOCK row is a denial rather than a grant. A master admin holds
 * everything.
 */
export function holdsKubernetesAiAccessPermission(
  allowed: Array<Permission>,
): boolean {
  if (User.isMasterAdmin()) {
    return true;
  }

  const tenantPermission: UserTenantAccessPermission | null =
    PermissionUtil.getProjectPermissions();

  return Boolean(
    tenantPermission?.permissions?.some((row: UserPermission): boolean => {
      return !row.isBlockPermission && allowed.includes(row.permission);
    }),
  );
}

/*
 * Whether the signed-in user may LOOSEN what AI may do on the cluster:
 * switch remediation to Automatic or Bypass approval, author a kubectl
 * allowlist, or bind the Runner / credential kubectl runs through. A
 * cluster's mode does the job of a FullAuto auto-remediation rule, so it
 * takes the same permissions (KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS) and
 * the server refuses the write without them. Tightening — Off, Ask for
 * approval, the investigation switch — stays open to every cluster editor.
 */
export function canConfigureUnattendedKubernetesAiAccess(): boolean {
  return holdsKubernetesAiAccessPermission(
    KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
  );
}

export function getKubernetesAiAccessAdminPermissionTitles(): Array<string> {
  return PermissionGate.getPermissionTitles(
    KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
  );
}

/*
 * Whether the signed-in user may pick a Kubernetes credential for an
 * out-of-cluster Runner. The picker lists RunbookCredential rows, so a user
 * who may edit the cluster but may not read credentials would get a
 * permissions error in place of a form. Such a user still edits everything
 * else; the in-cluster Runner needs no credential at all.
 *
 * The RunbookCredential read ACL stays as it is: the credential rows carry
 * cluster tokens and are deliberately not readable by every member.
 */
export function canPickKubernetesCredential(): boolean {
  return PermissionGate.check(new RunbookCredential(), ModelAction.Read)
    .isAllowed;
}

/*
 * The permissions that would let the user pick a credential, named for the
 * explanation shown in place of the picker.
 */
export function getKubernetesCredentialPermissionTitles(): Array<string> {
  return PermissionGate.getPermissionTitles(
    new RunbookCredential().getReadPermissions(),
  );
}

/*
 * The Runner picker's sibling of canPickKubernetesCredential. Settings
 * roles and EditKubernetesCluster may edit a cluster but may not read
 * Runners; offering them a picker would only request a list the server
 * refuses. The Runner read ACL is not widened: it exposes every Runner's
 * capabilities and liveness.
 */
export function canPickKubernetesRunner(): boolean {
  return PermissionGate.check(new Runner(), ModelAction.Read).isAllowed;
}

export function getKubernetesRunnerPermissionTitles(): Array<string> {
  return PermissionGate.getPermissionTitles(new Runner().getReadPermissions());
}

/*
 * The command history is RunnerJob rows. Roles that may open this page —
 * Settings*, ReadKubernetesCluster, EditKubernetesCluster — may not read
 * them, and RunnerJob stays that way: its runbook rows carry scripts and
 * their output. Such users get an explanation instead of a table that can
 * only fail.
 */
export function canReadKubectlJobs(): boolean {
  return PermissionGate.check(new RunnerJob(), ModelAction.Read).isAllowed;
}

export function getKubectlJobsPermissionTitles(): Array<string> {
  return PermissionGate.getPermissionTitles(
    new RunnerJob().getReadPermissions(),
  );
}

/*
 * The access test spends Runner time, so its endpoint requires edit access
 * to the cluster (KubernetesClusterAiAccessAPI: assertCanEditCluster,
 * which mirrors KubernetesCluster's update ACL).
 */
export function getAccessTestPermissionGate(): PermissionGateResult {
  return PermissionGate.check(new KubernetesCluster(), ModelAction.Update);
}

// Why the test is locked, for the disabled button's tooltip and note.
export function getAccessTestPermissionRequirement(): string {
  return `Running the access test needs permission to edit this cluster (one of: ${PermissionGate.getPermissionTitles(
    new KubernetesCluster().getUpdatePermissions(),
  ).join(", ")}).`;
}

/*
 * What a refused test says. The server's sentence for this route talks
 * about CHANGING the cluster's AI access, which the user did not try.
 */
export function getAccessTestPermissionMessage(): string {
  return `${getAccessTestPermissionRequirement()} Nothing on the cluster or in its AI access settings was changed.`;
}

/*
 * What the edit modal offers the signed-in user. Computed once when the
 * modal opens: the permission snapshot has long landed by then.
 */
export interface KubernetesAiAccessEditCapabilities {
  // Unattended modes and the allowlist.
  canConfigureUnattended: boolean;
  // The Runner picker: loosening AND able to list Runners.
  canPickRunner: boolean;
  // The credential picker: loosening AND able to read (and bind) credentials.
  canPickCredential: boolean;
}

export function getKubernetesAiAccessEditCapabilities(): KubernetesAiAccessEditCapabilities {
  const canConfigureUnattended: boolean =
    canConfigureUnattendedKubernetesAiAccess();

  return {
    canConfigureUnattended,
    canPickRunner: canConfigureUnattended && canPickKubernetesRunner(),
    canPickCredential:
      canConfigureUnattended &&
      canPickKubernetesCredential() &&
      holdsKubernetesAiAccessPermission(
        KUBERNETES_AI_ACCESS_CREDENTIAL_PERMISSIONS,
      ),
  };
}

// Kept in step with CommandPolicy's MAX_ALLOWLIST_PATTERNS / _LENGTH.
export const MAX_KUBECTL_ALLOWLIST_PATTERNS: number = 100;
export const MAX_KUBECTL_ALLOWLIST_PATTERN_LENGTH: number = 500;

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
 * True for a pattern that matches (nearly) every kubectl command: nothing
 * but wildcards, or "kubectl" followed by nothing but wildcards ("*",
 * "kubectl *", "kubectl * * *", "kubectl*"). In Automatic mode such an
 * allowlist behaves like Bypass approval, so saving one is confirmed the
 * same way.
 */
export function isBroadKubectlAllowlistPattern(pattern: string): boolean {
  const remainder: string = pattern.replace(/\*/g, "").replace(/\s+/g, "");
  return remainder === "" || remainder.toLowerCase() === "kubectl";
}

// Null when the text is a usable allowlist, otherwise what is wrong with it.
export function validateKubectlAllowlistText(text: unknown): string | null {
  const patterns: Array<string> = parseKubectlAllowlistText(text);

  if (patterns.length > MAX_KUBECTL_ALLOWLIST_PATTERNS) {
    return `At most ${MAX_KUBECTL_ALLOWLIST_PATTERNS} patterns; this list has ${patterns.length}.`;
  }

  for (let index: number = 0; index < patterns.length; index++) {
    const pattern: string = patterns[index]!;

    if (pattern.length > MAX_KUBECTL_ALLOWLIST_PATTERN_LENGTH) {
      return `Pattern ${index + 1} is longer than ${MAX_KUBECTL_ALLOWLIST_PATTERN_LENGTH} characters.`;
    }

    /*
     * Patterns are matched against the whole command, which always starts
     * with "kubectl". Anything else can never match — including a JSON
     * array pasted from the old editor — so it is refused rather than
     * saved as a pattern that silently does nothing.
     */
    const firstWord: string = pattern.split(" ")[0] || "";
    if (firstWord !== "kubectl" && firstWord.replace(/\*/g, "") !== "") {
      return `Pattern ${index + 1} ("${pattern}") must start with "kubectl" — patterns are matched against the whole command, for example: kubectl set image deployment/web * -n web`;
    }
  }

  return null;
}

/*
 * The allowlist as stored, read the way the server normalizes it: a list of
 * non-blank strings (or a JSON string of one). Anything else is used as an
 * empty allowlist — isClean says whether the stored value was usable as is.
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

  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return normalizeSavedKubectlAllowlist(parsed);
      }
    } catch {
      // Not JSON; unusable below.
    }
    return { patterns: [], isClean: false };
  }

  if (!Array.isArray(value)) {
    return { patterns: [], isClean: false };
  }

  const patterns: Array<string> = [];
  let isClean: boolean = true;

  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      isClean = false;
      continue;
    }
    patterns.push(collapseWhitespace(entry));
  }

  return { patterns, isClean };
}

// The cluster's AI settings as stored, read for the edit modal.
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

export function readKubernetesAiAccessSavedSettings(
  cluster: KubernetesCluster,
): KubernetesAiAccessSavedSettings {
  const mode: KubernetesAiRemediationMode = Object.values(
    KubernetesAiRemediationMode,
  ).includes(cluster.aiRemediationMode as KubernetesAiRemediationMode)
    ? (cluster.aiRemediationMode as KubernetesAiRemediationMode)
    : KubernetesAiRemediationMode.Disabled;

  return {
    isAiInvestigationEnabled: cluster.isAiInvestigationEnabled === true,
    aiRemediationMode: mode,
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
 * The edit form's values. The allowlist is edited as text, one pattern per
 * line; an unbound Runner or credential is the empty string.
 */
export interface KubernetesAiAccessSettingsFormValues {
  isAiInvestigationEnabled: boolean;
  aiRemediationMode: string;
  kubectlAllowlistText: string;
  aiAccessRunnerId: string;
  aiAccessCredentialId: string;
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
  };
}

// Which of the privileged fields the form actually offered.
export interface KubernetesAiAccessOfferedFields {
  allowlist: boolean;
  runner: boolean;
  credential: boolean;
}

function readDropdownId(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "object" && "value" in (value as object)) {
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
 * The update to send: only what the user changed, and only fields the
 * form offered. A form that re-submits every field would re-write a
 * privileged value the user merely left alone — an editor who only turns
 * investigation off would re-send "Automatic" and be refused for a change
 * they never made — and a field that was never offered must never be
 * written at all.
 *
 * One deliberate exception: a stored allowlist that is not a clean list
 * (an object, a number, blank entries) is rewritten from the form when the
 * allowlist is offered, so saving the form replaces a value the policy
 * ignores anyway with the list the form shows.
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
      changes["aiKubectlCommandAllowlist"] = patterns;
    }
  }

  if (data.offered.runner) {
    const runnerId: string | null = readDropdownId(
      data.values.aiAccessRunnerId,
    );
    if (runnerId !== data.saved.aiAccessRunnerId) {
      changes["aiAccessRunnerId"] = runnerId;
    }
  }

  if (data.offered.credential) {
    const credentialId: string | null = readDropdownId(
      data.values.aiAccessCredentialId,
    );
    if (credentialId !== data.saved.aiAccessCredentialId) {
      changes["aiAccessCredentialId"] = credentialId;
    }
  }

  return changes;
}

/*
 * The changes that LOOSEN what AI may do and so need
 * KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS, named for the refusal.
 */
export function getKubernetesAiAccessLooseningChanges(
  changes: JSONObject,
): Array<string> {
  const loosening: Array<string> = [];

  if (
    isUnattendedRemediationMode(
      changes["aiRemediationMode"] as KubernetesAiRemediationMode | undefined,
    )
  ) {
    loosening.push("an unattended remediation mode");
  }

  const allowlist: unknown = changes["aiKubectlCommandAllowlist"];
  if (Array.isArray(allowlist) && allowlist.length > 0) {
    loosening.push("a kubectl allowlist");
  }

  if (changes["aiAccessRunnerId"]) {
    loosening.push("a Runner binding");
  }

  if (changes["aiAccessCredentialId"]) {
    loosening.push("a credential binding");
  }

  return loosening;
}

export interface KubernetesAiAccessConfirmation {
  title: string;
  description: string;
}

const RISKIER_CHANGE_EXAMPLES: string =
  "riskier changes such as kubectl set image, patch, drain and deleting workloads";

function getNeverUnattendedSentence(): string {
  return `Destructive commands (deleting namespaces, volumes, nodes, secrets or CRDs; exec; apply) and any change in ${PROTECTED_KUBERNETES_NAMESPACES.join(
    ", ",
  )} still never run without a human.`;
}

/*
 * Saving Bypass approval, or an allowlist that matches (nearly) everything
 * while Automatic mode is on or being turned on, lets riskier changes run
 * with nobody asked. Such a save is confirmed first, in words that name
 * what it unlocks. Null when the save needs no confirmation.
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
      description: `With Bypass approval OneUptime AI applies every fix the kubectl policy allows on this cluster without asking anyone — ${RISKIER_CHANGE_EXAMPLES} included, in follow-up rounds too. ${getNeverUnattendedSentence()}`,
    };
  }

  const savedPatterns: Array<string> = normalizeSavedKubectlAllowlist(
    data.saved.aiKubectlCommandAllowlist,
  ).patterns;
  const isAllowlistChanged: boolean = Array.isArray(
    data.changes["aiKubectlCommandAllowlist"],
  );
  const resultingPatterns: Array<string> = isAllowlistChanged
    ? (data.changes["aiKubectlCommandAllowlist"] as Array<string>)
    : savedPatterns;

  const broadPatterns: Array<string> = resultingPatterns.filter(
    (pattern: string): boolean => {
      return isBroadKubectlAllowlistPattern(pattern);
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
  const isTurningOnAutomatic: boolean =
    newMode === KubernetesAiRemediationMode.Automatic;

  if (newBroadPatterns.length === 0 && !isTurningOnAutomatic) {
    return null;
  }

  const quoted: string = broadPatterns
    .map((pattern: string): string => {
      return `"${pattern}"`;
    })
    .join(", ");

  return {
    title: "Let riskier changes run without approval?",
    description: `The allowlist pattern ${quoted} matches (nearly) every kubectl command. ${
      resultingMode === KubernetesAiRemediationMode.Automatic
        ? "In Automatic mode"
        : "Once this cluster is switched to Automatic mode"
    }, ${RISKIER_CHANGE_EXAMPLES} will then run with nobody asked — the same as Bypass approval. ${getNeverUnattendedSentence()}`,
  };
}

/*
 * The Runner picker's options: only Runners that can serve this cluster.
 * This cluster's in-cluster agent Runner comes first. An agent Runner of
 * ANOTHER cluster is never offered — it runs kubectl with its own
 * ServiceAccount, so it can only ever reach its own cluster — and a Runner
 * with "Runs AI Remediation Commands" off would be refused every command.
 * Agent rows are recognised by their name (isKubernetesAgentRunnerName),
 * which only the server writes, never by the posture a Runner reports.
 *
 * The currently bound Runner is always kept, labelled with why it cannot
 * serve the cluster when it cannot, so the form shows the binding it would
 * otherwise silently hide.
 */
export function buildKubernetesAiRunnerOptions(data: {
  runners: Array<Runner>;
  clusterIdentifier: string | undefined;
  boundRunnerId: string | null;
  boundRunnerName: string | null;
}): Array<DropdownOption> {
  const thisCluster: Array<DropdownOption> = [];
  const others: Array<DropdownOption> = [];
  let isBoundRunnerListed: boolean = false;

  for (const runner of data.runners) {
    const id: string | null = runner._id ? String(runner._id) : null;
    if (!id) {
      continue;
    }

    const name: string = runner.name || id;
    const isBound: boolean = id === data.boundRunnerId;
    const isAgent: boolean = isKubernetesAgentRunnerName(name);
    const isThisClustersAgent: boolean =
      isAgent &&
      isSameKubernetesClusterIdentifier(
        name.slice(KUBERNETES_AGENT_RUNNER_NAME_PREFIX.length + 1),
        data.clusterIdentifier,
      );
    const canRunAiCommands: boolean = runner.canRunAiCommands === true;

    let unusableReason: string | null = null;
    if (isAgent && !isThisClustersAgent) {
      unusableReason =
        "runs inside another cluster and can only reach that cluster";
    } else if (!canRunAiCommands) {
      unusableReason = "“Runs AI Remediation Commands” is off";
    }

    if (unusableReason && !isBound) {
      continue;
    }

    if (isBound) {
      isBoundRunnerListed = true;
    }

    const option: DropdownOption = {
      value: id,
      label: unusableReason
        ? `${name} (currently bound — ${unusableReason})`
        : isThisClustersAgent
          ? `${name} (in-cluster Runner for this cluster)`
          : name,
    };

    if (isThisClustersAgent) {
      thisCluster.push(option);
    } else {
      others.push(option);
    }
  }

  const options: Array<DropdownOption> = [...thisCluster, ...others];

  if (data.boundRunnerId && !isBoundRunnerListed) {
    options.unshift({
      value: data.boundRunnerId,
      label: `${data.boundRunnerName || "The bound Runner"} (currently bound)`,
    });
  }

  return options;
}

/*
 * The credential picker's options: Kubernetes credentials only (the server
 * refuses anything else on save), plus the bound one so the form can show
 * it.
 */
export function buildKubernetesAiCredentialOptions(data: {
  credentials: Array<RunbookCredential>;
  boundCredentialId: string | null;
  boundCredentialName: string | null;
}): Array<DropdownOption> {
  const options: Array<DropdownOption> = [];

  for (const credential of data.credentials) {
    const id: string | null = credential._id ? String(credential._id) : null;
    if (!id) {
      continue;
    }
    if (
      credential.credentialType &&
      credential.credentialType !== RunbookCredentialType.Kubernetes &&
      id !== data.boundCredentialId
    ) {
      continue;
    }
    options.push({ value: id, label: credential.name || id });
  }

  if (
    data.boundCredentialId &&
    !options.some((option: DropdownOption): boolean => {
      return option.value === data.boundCredentialId;
    })
  ) {
    options.unshift({
      value: data.boundCredentialId,
      label: `${data.boundCredentialName || "The bound credential"} (currently bound)`,
    });
  }

  return options;
}

export function parseStatus(
  value: unknown,
): KubernetesClusterAiAccessStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const status: Partial<KubernetesClusterAiAccessStatus> =
    value as Partial<KubernetesClusterAiAccessStatus>;
  if (typeof status.clusterId !== "string" || !Array.isArray(status.gaps)) {
    return null;
  }
  return status as KubernetesClusterAiAccessStatus;
}

// The allowlist the policy actually uses, as the status reports it.
function getAllowlistInEffect(
  status: KubernetesClusterAiAccessStatus,
): Array<string> {
  return Array.isArray(status.kubectlAllowlist)
    ? status.kubectlAllowlist.filter((pattern: unknown): boolean => {
        return typeof pattern === "string" && pattern.trim().length > 0;
      })
    : [];
}

function GapRow({ gap }: { gap: KubernetesAiAccessGap }): ReactElement {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
      <Icon
        icon={IconProp.Alert}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
      />
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{gap.title}</p>
        <p className="mt-0.5 text-xs leading-5 text-gray-600">
          {gap.description}
        </p>
        <p className="mt-1 text-xs leading-5 text-gray-800">
          <span className="font-semibold">Fix: </span>
          {gap.nextStep}
        </p>
        <p className="mt-1 text-[11px] uppercase tracking-wide text-gray-400">
          Blocks{" "}
          {gap.blocks === "both" ? "investigation and remediation" : gap.blocks}
        </p>
      </div>
    </li>
  );
}

function AdminPermissionNote(): ReactElement {
  return (
    <p
      className="text-xs leading-5 text-gray-500"
      data-testid="kubernetes-ai-access-admin-note"
    >
      Automatic and Bypass approval, the kubectl allowlist and choosing the
      Runner or Kubernetes credential need one of these permissions:{" "}
      {getKubernetesAiAccessAdminPermissionTitles().join(", ")} — the same ones
      an unattended auto-remediation rule needs. You can still turn
      investigation on or off and switch remediation to Off or Ask for approval.
    </p>
  );
}

const ALLOWLIST_FIELD_DESCRIPTION: string =
  "Optional, used in Automatic mode only. One pattern per line: a riskier kubectl command (set image, patch, drain, deleting workloads) that matches a pattern also runs without approval. Patterns are compared word by word — * matches exactly one word, and flags must be written out — for example: kubectl set image deployment/web * -n web. Not needed in Bypass approval mode, where every allowed change already runs on its own. Destructive commands and the protected namespaces never run unattended.";

interface SettingsModalProps {
  clusterId: ObjectID;
  clusterIdentifier: string | undefined;
  capabilities: KubernetesAiAccessEditCapabilities;
  onClose: () => void;
  onSaved: () => void;
}

/*
 * The "Edit AI access" modal. Not a ModelForm: a ModelForm submits every
 * field it shows, so an editor who only switched investigation off would
 * re-send the unchanged Automatic mode, allowlist and Runner binding —
 * writes the server refuses unless they hold the admin set — and the save
 * of a perfectly allowed change would fail. This form sends only what
 * changed, offers only what the user may set, validates the allowlist as
 * patterns, and asks before a save that lets riskier changes run
 * unattended.
 */
const KubernetesAiAccessSettingsModal: FunctionComponent<SettingsModalProps> = (
  props: SettingsModalProps,
): ReactElement => {
  const [saved, setSaved] = useState<KubernetesAiAccessSavedSettings | null>(
    null,
  );
  const [runnerOptions, setRunnerOptions] = useState<Array<DropdownOption>>([]);
  const [credentialOptions, setCredentialOptions] = useState<
    Array<DropdownOption>
  >([]);
  const [isRunnerPickerAvailable, setIsRunnerPickerAvailable] =
    useState<boolean>(false);
  const [isCredentialPickerAvailable, setIsCredentialPickerAvailable] =
    useState<boolean>(false);
  const [pickerErrors, setPickerErrors] = useState<Array<string>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  const [pendingSave, setPendingSave] = useState<{
    changes: JSONObject;
    confirmation: KubernetesAiAccessConfirmation;
  } | null>(null);
  const formRef: MutableRefObject<any> = useRef<any>(null);
  // Blocks a second save while one is in flight (double click, Enter + click).
  const isSavingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const canConfigureUnattended: boolean =
    props.capabilities.canConfigureUnattended;
  const canPickRunner: boolean = props.capabilities.canPickRunner;
  const canPickCredential: boolean = props.capabilities.canPickCredential;

  useEffect(() => {
    let isMounted: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      let settings: KubernetesAiAccessSavedSettings;

      try {
        const cluster: KubernetesCluster | null =
          await ModelAPI.getItem<KubernetesCluster>({
            modelType: KubernetesCluster,
            id: props.clusterId,
            select: {
              _id: true,
              isAiInvestigationEnabled: true,
              aiRemediationMode: true,
              aiKubectlCommandAllowlist: true,
              aiAccessRunnerId: true,
              aiAccessCredentialId: true,
              // Names only: the ids come from the FK columns above.
              aiAccessRunner: { name: true },
              aiAccessCredential: { name: true },
            },
          });

        if (!cluster) {
          throw new Error(
            "Could not read this cluster's AI access settings. It may have been deleted, or you may no longer have access to it.",
          );
        }

        settings = readKubernetesAiAccessSavedSettings(cluster);
      } catch (err) {
        if (isMounted) {
          setLoadError(API.getFriendlyMessage(err));
          setIsLoading(false);
        }
        return;
      }

      /*
       * Each picker loads on its own: one list failing must not take the
       * other picker — or the rest of the form — down with it. A picker
       * whose list failed is left out, which leaves its binding as it is.
       */
      const errors: Array<string> = [];

      const loadRunners: () => Promise<Array<DropdownOption> | null> =
        async (): Promise<Array<DropdownOption> | null> => {
          if (!canPickRunner) {
            return null;
          }
          try {
            const result: ListResult<Runner> = await ModelAPI.getList<Runner>({
              modelType: Runner,
              query: {},
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              select: {
                _id: true,
                name: true,
                canRunAiCommands: true,
              },
              sort: { name: SortOrder.Ascending },
            });
            return buildKubernetesAiRunnerOptions({
              runners: result.data || [],
              clusterIdentifier: props.clusterIdentifier,
              boundRunnerId: settings.aiAccessRunnerId,
              boundRunnerName: settings.aiAccessRunnerName,
            });
          } catch (err) {
            errors.push(
              `The Runner list could not be loaded, so the Runner binding is left as it is: ${API.getFriendlyMessage(err)}`,
            );
            return null;
          }
        };

      const loadCredentials: () => Promise<Array<DropdownOption> | null> =
        async (): Promise<Array<DropdownOption> | null> => {
          if (!canPickCredential) {
            return null;
          }
          try {
            const result: ListResult<RunbookCredential> =
              await ModelAPI.getList<RunbookCredential>({
                modelType: RunbookCredential,
                query: { credentialType: RunbookCredentialType.Kubernetes },
                limit: LIMIT_PER_PROJECT,
                skip: 0,
                select: { _id: true, name: true, credentialType: true },
                sort: { name: SortOrder.Ascending },
              });
            return buildKubernetesAiCredentialOptions({
              credentials: result.data || [],
              boundCredentialId: settings.aiAccessCredentialId,
              boundCredentialName: settings.aiAccessCredentialName,
            });
          } catch (err) {
            errors.push(
              `The credential list could not be loaded, so the credential binding is left as it is: ${API.getFriendlyMessage(err)}`,
            );
            return null;
          }
        };

      const [runners, credentials]: [
        Array<DropdownOption> | null,
        Array<DropdownOption> | null,
      ] = await Promise.all([loadRunners(), loadCredentials()]);

      if (!isMounted) {
        return;
      }

      setSaved(settings);
      setRunnerOptions(runners || []);
      setIsRunnerPickerAvailable(runners !== null);
      setCredentialOptions(credentials || []);
      setIsCredentialPickerAvailable(credentials !== null);
      setPickerErrors(errors);
      setIsLoading(false);
    };

    load().catch(() => {
      // handled inside load
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const offered: KubernetesAiAccessOfferedFields = useMemo(() => {
    return {
      allowlist: canConfigureUnattended,
      runner: isRunnerPickerAvailable,
      credential: isCredentialPickerAvailable,
    };
  }, [
    canConfigureUnattended,
    isRunnerPickerAvailable,
    isCredentialPickerAvailable,
  ]);

  /*
   * Built only once everything has loaded: BasicForm reads its initial
   * values once, on the first render in which the fields exist.
   */
  const fields: Fields<KubernetesAiAccessSettingsFormValues> = useMemo(() => {
    if (!saved) {
      return [];
    }

    /*
     * Without the admin set the unattended modes are not offered — except
     * the one already saved, so the dropdown can show it. Leaving it
     * selected is no change and sends nothing.
     */
    const modes: Array<KubernetesAiRemediationMode> = canConfigureUnattended
      ? Object.values(KubernetesAiRemediationMode)
      : Object.values(KubernetesAiRemediationMode).filter(
          (mode: KubernetesAiRemediationMode): boolean => {
            return (
              !isUnattendedRemediationMode(mode) ||
              mode === saved.aiRemediationMode
            );
          },
        );

    const result: Fields<KubernetesAiAccessSettingsFormValues> = [
      {
        field: { isAiInvestigationEnabled: true },
        title: "Let AI investigate with kubectl",
        description:
          "Read-only: get, describe, logs, events, top, rollout status. Nothing on the cluster is ever changed by an investigation.",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
      },
      {
        field: { aiRemediationMode: true },
        title: "AI remediation",
        description:
          "Ask for approval: AI composes the exact kubectl plan and a human approves it with one click. Automatic: safe changes (rollout restart/undo, scale, delete a named pod, cordon/uncordon, label/annotate) run on their own; a riskier change is never run without a human — AI leaves the exact command in its recommendations and only a follow-up round proposes it for approval — unless the allowlist names its shape. Bypass approval: every allowed change, riskier ones included, runs on its own and nobody is ever asked. Destructive commands (deleting namespaces, volumes, nodes, secrets, CRDs; exec; apply) never run in any mode.",
        fieldType: FormFieldSchemaType.Dropdown,
        required: true,
        dataTestId: "ai-remediation-mode-field",
        dropdownOptions: modes.map(
          (mode: KubernetesAiRemediationMode): DropdownOption => {
            return {
              value: mode,
              label:
                !canConfigureUnattended && isUnattendedRemediationMode(mode)
                  ? `${REMEDIATION_MODE_LABELS[mode]} (current)`
                  : REMEDIATION_MODE_LABELS[mode],
            };
          },
        ),
      },
    ];

    if (offered.allowlist) {
      result.push({
        field: { kubectlAllowlistText: true },
        title: "kubectl allowlist (Automatic mode)",
        description: ALLOWLIST_FIELD_DESCRIPTION,
        fieldType: FormFieldSchemaType.LongText,
        required: false,
        placeholder: "kubectl set image deployment/web * -n web",
        dataTestId: "kubectl-allowlist-field",
        customValidation: (
          values: FormValues<KubernetesAiAccessSettingsFormValues>,
        ): string | null => {
          return validateKubectlAllowlistText(values.kubectlAllowlistText);
        },
      });
    }

    if (offered.runner) {
      result.push({
        field: { aiAccessRunnerId: true },
        title: "Runner",
        description:
          "The Runner OneUptime AI uses to run kubectl on this cluster. Only Runners that can serve it are listed: this cluster's in-cluster Runner (it binds itself when the agent chart installs it) and Runners with “Runs AI Remediation Commands” on. In-cluster Runners of other clusters are not listed — they can only reach their own cluster.",
        fieldType: FormFieldSchemaType.Dropdown,
        required: false,
        placeholder: "No Runner bound",
        dataTestId: "ai-access-runner-field",
        dropdownOptions: runnerOptions,
      });
    }

    if (offered.credential) {
      result.push({
        field: { aiAccessCredentialId: true },
        title: "Kubernetes credential",
        description:
          "Only for a Runner outside the cluster: a Kubernetes credential (API server URL + ServiceAccount token) assigned to that Runner. Leave empty for the in-cluster Runner, which uses its own ServiceAccount.",
        fieldType: FormFieldSchemaType.Dropdown,
        required: false,
        placeholder: "None (in-cluster Runner)",
        dataTestId: "ai-access-credential-field",
        dropdownOptions: credentialOptions,
      });
    }

    return result;
  }, [saved, offered, runnerOptions, credentialOptions]);

  const initialValues: FormValues<KubernetesAiAccessSettingsFormValues> =
    useMemo(() => {
      return saved ? getKubernetesAiAccessSettingsInitialValues(saved) : {};
    }, [saved]);

  const save: (changes: JSONObject) => Promise<void> = async (
    changes: JSONObject,
  ): Promise<void> => {
    if (isSavingRef.current) {
      return;
    }
    isSavingRef.current = true;
    setIsSaving(true);
    setSaveError("");

    try {
      await ModelAPI.updateById<KubernetesCluster>({
        modelType: KubernetesCluster,
        id: props.clusterId,
        data: changes,
      });
    } catch (err) {
      isSavingRef.current = false;
      setIsSaving(false);
      setSaveError(API.getFriendlyMessage(err));
      return;
    }

    isSavingRef.current = false;
    props.onSaved();
  };

  const onSubmit: (
    values: FormValues<KubernetesAiAccessSettingsFormValues>,
  ) => void = (values: FormValues<KubernetesAiAccessSettingsFormValues>) => {
    if (!saved || isSavingRef.current) {
      return;
    }

    setSaveError("");

    const changes: JSONObject = getKubernetesAiAccessSettingsChanges({
      saved,
      values,
      offered,
    });

    if (Object.keys(changes).length === 0) {
      // Nothing changed; there is nothing to write.
      props.onClose();
      return;
    }

    if (!canConfigureUnattended) {
      const loosening: Array<string> =
        getKubernetesAiAccessLooseningChanges(changes);
      if (loosening.length > 0) {
        setSaveError(
          `Setting ${loosening.join(", ")} needs one of these permissions: ${getKubernetesAiAccessAdminPermissionTitles().join(", ")}.`,
        );
        return;
      }
    }

    const confirmation: KubernetesAiAccessConfirmation | null =
      getKubernetesAiAccessConfirmation({ saved, changes });

    if (confirmation) {
      setPendingSave({ changes, confirmation });
      return;
    }

    save(changes).catch(() => {
      // handled inside save
    });
  };

  const notes: Array<ReactElement> = [];

  if (!canConfigureUnattended) {
    notes.push(<AdminPermissionNote key="admin" />);
  } else {
    if (!canPickRunner) {
      notes.push(
        <p
          key="runner"
          className="text-xs leading-5 text-gray-500"
          data-testid="kubernetes-runner-picker-permission-note"
        >
          The Runner binding is not shown: choosing a Runner needs permission to
          read Runners (one of:{" "}
          {getKubernetesRunnerPermissionTitles().join(", ")}). It is left as it
          is.
        </p>,
      );
    }
    if (!canPickCredential) {
      notes.push(
        <p
          key="credential"
          className="text-xs leading-5 text-gray-500"
          data-testid="kubernetes-credential-picker-permission-note"
        >
          The credential binding is not shown: choosing a credential needs
          permission to read Runner credentials (one of:{" "}
          {getKubernetesCredentialPermissionTitles().join(", ")}). It is left as
          it is; the in-cluster Runner needs no credential.
        </p>,
      );
    }
  }

  return (
    <>
      <Modal
        title="Edit AI access to this cluster"
        submitButtonText="Save Changes"
        submitButtonType={ButtonType.Submit}
        modalWidth={ModalWidth.Medium}
        isLoading={isSaving}
        disableSubmitButton={isLoading || !saved || isSaving}
        onClose={props.onClose}
        onSubmit={() => {
          formRef.current?.submitForm();
        }}
      >
        <div className="space-y-4">
          {notes.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              {notes}
            </div>
          ) : (
            <></>
          )}

          {pickerErrors.map((message: string): ReactElement => {
            return (
              <Alert key={message} type={AlertType.WARNING} title={message} />
            );
          })}

          {loadError ? (
            <ErrorMessage message={loadError} />
          ) : isLoading || !saved ? (
            <ComponentLoader />
          ) : (
            <BasicForm
              ref={formRef}
              id="kubernetes-cluster-ai-access-form"
              name="Edit Kubernetes Cluster AI Access"
              fields={fields}
              initialValues={initialValues}
              hideSubmitButton={true}
              footer={<></>}
              onSubmit={onSubmit}
            />
          )}

          {saveError ? (
            <Alert
              type={AlertType.DANGER}
              strongTitle="Could not save"
              title={saveError}
              dataTestId="ai-access-save-error"
            />
          ) : (
            <></>
          )}
        </div>
      </Modal>

      {pendingSave ? (
        <ConfirmModal
          title={pendingSave.confirmation.title}
          description={pendingSave.confirmation.description}
          submitButtonText="Confirm and save"
          submitButtonType={ButtonStyleType.DANGER}
          onClose={() => {
            setPendingSave(null);
          }}
          onSubmit={() => {
            const changes: JSONObject = pendingSave.changes;
            setPendingSave(null);
            save(changes).catch(() => {
              // handled inside save
            });
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

const KubernetesClusterAI: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelIdString: string = Navigation.getLastParamAsString(1);
  /*
   * Memoized on the string it was read from: a fresh ObjectID every render
   * would recreate fetchStatus (which depends on it) and re-run the load
   * effect after every state update — an unbounded loop of status
   * requests, each answer triggering the next.
   */
  const modelId: ObjectID = useMemo((): ObjectID => {
    return new ObjectID(modelIdString);
  }, [modelIdString]);

  const [status, setStatus] = useState<KubernetesClusterAiAccessStatus | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  /*
   * The last status request's failure. Fatal only while there is no status
   * to show: once the page has one, a failed background poll keeps the last
   * good status on screen — with the operator's open edit modal, test
   * results and table — and reports the failure inline instead. A later
   * successful poll clears it.
   */
  const [error, setError] = useState<string>("");
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<AccessTestResult | null>(null);
  const [testError, setTestError] = useState<string>("");
  const [refresher, setRefresher] = useState<boolean>(false);
  const [isEditingSettings, setIsEditingSettings] = useState<boolean>(false);
  /*
   * What the edit modal offers, read when it opens. Kept in state so a
   * status poll re-rendering the page cannot rebuild the open form.
   */
  const [editCapabilities, setEditCapabilities] =
    useState<KubernetesAiAccessEditCapabilities | null>(null);
  const isTestingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const fetchStatus: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/kubernetes-cluster/ai-access/status",
            ),
            data: { clusterId: modelId.toString() },
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const parsed: KubernetesClusterAiAccessStatus | null = parseStatus(
          response.data,
        );

        if (!parsed) {
          throw new Error(
            "The server returned an AI access status this page cannot read.",
          );
        }

        setStatus(parsed);
        setError("");
      } catch (err) {
        /*
         * Keep whatever is already on screen. The render below decides
         * whether this is the fatal first-load case or an inline warning.
         */
        setError(API.getFriendlyMessage(err));
      }
      setIsLoading(false);
    }, [modelId]);

  useEffect(() => {
    fetchStatus().catch(() => {
      // handled inside fetchStatus
    });
  }, [fetchStatus, refresher]);

  // The Runner heartbeats every minute; keep the checklist honest.
  useEffect(() => {
    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      fetchStatus().catch(() => {
        // handled inside fetchStatus
      });
    }, AI_ACCESS_STATUS_POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [fetchStatus]);

  const runTest: () => Promise<void> = async (): Promise<void> => {
    if (isTestingRef.current) {
      return;
    }
    isTestingRef.current = true;
    setIsTesting(true);
    setTestError("");
    setTestResult(null);
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/kubernetes-cluster/ai-access/test",
          ),
          data: { clusterId: modelId.toString() },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const data: JSONObject = response.data as JSONObject;
      setTestResult({
        ok: data["ok"] === true,
        message: String(data["message"] || ""),
        results: ((data["results"] as JSONArray) || []).map(
          (row: unknown): AccessTestResult["results"][number] => {
            const item: JSONObject = (row || {}) as JSONObject;
            return {
              command: String(item["command"] || ""),
              succeeded: item["succeeded"] === true,
              exitCode:
                typeof item["exitCode"] === "number"
                  ? (item["exitCode"] as number)
                  : null,
              output: String(item["output"] || ""),
              errorMessage:
                typeof item["errorMessage"] === "string"
                  ? (item["errorMessage"] as string)
                  : null,
            };
          },
        ),
      });
      const refreshed: KubernetesClusterAiAccessStatus | null = parseStatus(
        data["status"],
      );
      if (refreshed) {
        setStatus(refreshed);
      }
    } catch (err) {
      /*
       * A permission refusal is about RUNNING the test. The route shares
       * its check with the settings writes, and the server's sentence
       * talks about changing AI access — which this user did not try.
       */
      setTestError(
        err instanceof HTTPErrorResponse &&
          err.statusCode === ExceptionCode.NotAuthorizedException
          ? getAccessTestPermissionMessage()
          : API.getFriendlyMessage(err),
      );
    }
    isTestingRef.current = false;
    setIsTesting(false);
  };

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  // Nothing to show yet: the first load failed, so the error is the page.
  if (!status) {
    return <ErrorMessage message={error || "Could not load AI access."} />;
  }

  const oneuptimeUrl: string = `${HTTP_PROTOCOL}${HOST}`;
  const hasRunner: boolean = status.runner !== null;
  /*
   * Read after the status has loaded: the permission snapshot arrives on
   * API response headers, so checking it during the first paint of a fresh
   * session would hide affordances the user actually has.
   */
  const canPickCredential: boolean = canPickKubernetesCredential();
  const canPickRunner: boolean = canPickKubernetesRunner();
  const canConfigureUnattended: boolean =
    canConfigureUnattendedKubernetesAiAccess();
  const settingsGate: PermissionGateResult = PermissionGate.check(
    new KubernetesCluster(),
    ModelAction.Update,
  );
  const testGate: PermissionGateResult = getAccessTestPermissionGate();
  const allowlistInEffect: Array<string> = getAllowlistInEffect(status);
  const helmCommands: AiAccessHelmCommands = getAiAccessHelmCommands();
  const lastCheckedAt: string = status.evaluatedAt
    ? OneUptimeDate.getDateAsFormattedString(
        OneUptimeDate.fromString(status.evaluatedAt),
      )
    : "";
  const investigationGaps: Array<KubernetesAiAccessGap> = status.gaps.filter(
    (gap: KubernetesAiAccessGap) => {
      return gap.blocks === "investigation" || gap.blocks === "both";
    },
  );
  const remediationGaps: Array<KubernetesAiAccessGap> = status.gaps.filter(
    (gap: KubernetesAiAccessGap) => {
      return gap.blocks === "remediation";
    },
  );

  /*
   * Without update permission the button stays, locked, with the reason in
   * its tooltip — the same rule CardModelDetail applies to its own Edit
   * button. It is dropped only when there is nothing honest to say (the
   * permission snapshot has not landed).
   */
  const settingsButtons: Array<CardButtonSchema> =
    settingsGate.isAllowed || settingsGate.disabledReason
      ? [
          {
            title: "Edit AI access",
            icon: IconProp.Edit,
            buttonStyle: ButtonStyleType.NORMAL,
            disabled: !settingsGate.isAllowed,
            tooltip: settingsGate.disabledReason,
            onClick: () => {
              if (!settingsGate.isAllowed) {
                return;
              }
              setEditCapabilities(getKubernetesAiAccessEditCapabilities());
              setIsEditingSettings(true);
            },
          },
        ]
      : [];

  const statusBadge: ReactElement = (
    <div className="flex flex-wrap items-center gap-2">
      <Pill
        text={
          status.isInvestigationReady
            ? "Investigation: ready"
            : status.isInvestigationEnabled
              ? "Investigation: not ready"
              : "Investigation: off"
        }
        color={
          status.isInvestigationReady
            ? Green500
            : status.isInvestigationEnabled
              ? Yellow500
              : Gray500
        }
        icon={status.isInvestigationReady ? IconProp.Check : IconProp.Info}
      />
      <Pill
        text={
          status.remediationMode === KubernetesAiRemediationMode.Disabled
            ? "Remediation: off"
            : status.isRemediationReady
              ? `Remediation: ${
                  status.remediationMode ===
                  KubernetesAiRemediationMode.BypassApproval
                    ? "bypass approval"
                    : status.remediationMode ===
                        KubernetesAiRemediationMode.Automatic
                      ? "automatic"
                      : "ask for approval"
                }`
              : "Remediation: not ready"
        }
        color={
          status.remediationMode === KubernetesAiRemediationMode.Disabled
            ? Gray500
            : status.isRemediationReady
              ? Green500
              : Yellow500
        }
        icon={status.isRemediationReady ? IconProp.Check : IconProp.Info}
      />
    </div>
  );

  return (
    <Fragment>
      {error ? (
        <Alert
          type={AlertType.WARNING}
          strongTitle="Could not refresh the AI access status"
          title={`${error}${
            lastCheckedAt
              ? ` Showing the last status from ${lastCheckedAt}; this page retries on its own.`
              : " Showing the last known status; this page retries on its own."
          }`}
          dataTestId="ai-access-refresh-warning"
        />
      ) : (
        <></>
      )}

      <Card
        title="OneUptime AI access to this cluster"
        description="When an incident or alert is raised on this cluster, OneUptime AI investigates it. With access, it also runs kubectl the way an on-call engineer would — and, if you allow it, fixes the problem. Every command appears on the incident."
        rightElement={statusBadge}
      >
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-gray-200 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Runner
              </p>
              {status.runner ? (
                <div className="mt-1">
                  <p className="text-sm font-medium text-gray-900">
                    {status.runner.name}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {status.runner.isOnline ? "Connected" : "Offline"}
                    {status.runner.lastAliveAt
                      ? ` · last seen ${OneUptimeDate.getDateAsFormattedString(
                          OneUptimeDate.fromString(status.runner.lastAliveAt),
                        )}`
                      : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {status.accessMethod === "in_cluster"
                      ? "In-cluster (installed by the Kubernetes agent chart)"
                      : status.credentialName
                        ? `Credential: ${status.credentialName}`
                        : "No Kubernetes credential"}
                    {status.runner.posture?.kubectlVersion
                      ? ` · kubectl ${status.runner.posture.kubectlVersion}`
                      : ""}
                    {status.runner.posture?.inCluster
                      ? status.runner.posture.allowWrites
                        ? " · writes allowed"
                        : " · read-only RBAC"
                      : ""}
                  </p>
                  <Link
                    to={RouteUtil.populateRouteParams(
                      RouteMap[PageMap.SETTINGS_RUNNER_VIEW] as Route,
                      { modelId: new ObjectID(status.runner.id) },
                    )}
                    className="mt-1 inline-flex text-xs font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    View Runner
                  </Link>
                </div>
              ) : (
                <p className="mt-1 text-sm text-gray-600">
                  No Runner is bound to this cluster yet.
                </p>
              )}
            </div>
            <div className="rounded-xl border border-gray-200 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Investigation
              </p>
              <p className="mt-1 text-sm text-gray-900">
                {status.isInvestigationEnabled
                  ? "AI runs read-only kubectl (get, describe, logs, events, top) while investigating."
                  : "Off — AI investigates with OneUptime data only."}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Remediation
              </p>
              <p className="mt-1 text-sm text-gray-900">
                {REMEDIATION_MODE_LABELS[status.remediationMode] ||
                  REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.Disabled]}
              </p>
              {/*
               * The allowlist actually in effect — the server's normalized
               * list, not the stored value — so nobody reads "riskier ones
               * are left for you" while allowlisted ones run unattended.
               */}
              {allowlistInEffect.length > 0 ? (
                <div className="mt-2" data-testid="kubectl-allowlist-in-effect">
                  <p className="text-xs text-gray-600">
                    {status.remediationMode ===
                    KubernetesAiRemediationMode.Automatic
                      ? "Riskier changes matching the kubectl allowlist also run on their own:"
                      : status.remediationMode ===
                          KubernetesAiRemediationMode.BypassApproval
                        ? "kubectl allowlist (not needed in Bypass approval, where every allowed change already runs on its own):"
                        : "kubectl allowlist (used only in Automatic mode):"}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {allowlistInEffect.map(
                      (pattern: string, index: number): ReactElement => {
                        return (
                          <li
                            key={`${index}:${pattern}`}
                            className="break-words font-mono text-xs text-gray-800"
                          >
                            {pattern}
                          </li>
                        );
                      },
                    )}
                  </ul>
                </div>
              ) : (
                <></>
              )}
            </div>
          </div>

          {status.lastVerifiedAt || status.lastError ? (
            <p className="text-xs text-gray-500">
              {status.lastVerifiedAt
                ? `Last successful kubectl command: ${OneUptimeDate.getDateAsFormattedString(
                    OneUptimeDate.fromString(status.lastVerifiedAt),
                  )}.`
                : ""}
              {status.lastError ? (
                <span className="ml-1 text-rose-600">
                  Last error: {status.lastError}
                </span>
              ) : (
                <></>
              )}
            </p>
          ) : (
            <></>
          )}

          {status.gaps.length === 0 ? (
            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <Icon
                icon={IconProp.CheckCircle}
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600"
              />
              <p className="text-sm text-emerald-900">
                Everything is in place. OneUptime AI will inspect this cluster
                with kubectl during investigations
                {status.remediationMode ===
                KubernetesAiRemediationMode.BypassApproval
                  ? " and apply fixes on its own without asking anyone."
                  : status.remediationMode ===
                      KubernetesAiRemediationMode.Automatic
                    ? allowlistInEffect.length > 0
                      ? " and apply safe fixes on its own — plus riskier ones that match the kubectl allowlist."
                      : " and apply safe fixes on its own."
                    : status.remediationMode ===
                        KubernetesAiRemediationMode.RequireApproval
                      ? " and propose kubectl fixes for your approval."
                      : "."}
              </p>
            </div>
          ) : (
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                What is missing
              </h3>
              <p className="mt-0.5 text-xs text-gray-500">
                Each item below stops OneUptime AI from doing part of its job on
                this cluster. Fix them in any order.
              </p>
              {investigationGaps.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {investigationGaps.map((gap: KubernetesAiAccessGap) => {
                    return <GapRow key={gap.code} gap={gap} />;
                  })}
                </ul>
              ) : (
                <></>
              )}
              {remediationGaps.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {remediationGaps.map((gap: KubernetesAiAccessGap) => {
                    return <GapRow key={gap.code} gap={gap} />;
                  })}
                </ul>
              ) : (
                <></>
              )}
            </div>
          )}
        </div>
      </Card>

      {!hasRunner ||
      status.gaps.some((gap: KubernetesAiAccessGap) => {
        return gap.code === "runner_missing" || gap.code === "no_runner_bound";
      }) ? (
        <Card
          title="Connect a Runner (one command)"
          description="OneUptime AI runs kubectl through a Runner inside your infrastructure. The quickest way is the Kubernetes agent you already installed: one extra flag deploys a small in-cluster Runner that registers itself to this cluster."
        >
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Icon
                  icon={IconProp.Terminal}
                  className="h-4 w-4 text-gray-500"
                />
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Upgrade the Kubernetes agent on cluster{" "}
                  {status.clusterIdentifier || status.clusterName}
                </span>
              </div>
              <div data-testid="ai-access-helm-command">
                <CodeBlock language="bash" code={helmCommands.readOnly} />
              </div>
              <p className="mt-2 text-xs leading-5 text-gray-500">
                This gives AI read-only access for investigations. It uses the
                release name and namespace from the install instructions (
                {KUBERNETES_AGENT_HELM_RELEASE} in{" "}
                {KUBERNETES_AGENT_HELM_NAMESPACE}); if you installed the agent
                under another name or namespace, use yours. Run{" "}
                <code>helm repo update</code> first: an older cached chart does
                not know aiAccess and fails with &quot;Additional property
                aiAccess is not allowed&quot;. The Runner reuses the
                agent&apos;s ingestion key and cluster name, so within a minute
                this page shows it as Connected. Your OneUptime URL is{" "}
                {oneuptimeUrl}.
              </p>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Optional: also let AI apply fixes
              </p>
              <div data-testid="ai-access-helm-remediation-command">
                <CodeBlock
                  language="bash"
                  code={helmCommands.enableRemediation}
                />
              </div>
              <p className="mt-2 text-xs leading-5 text-gray-500">
                Run this instead of — or after — the command above only if AI
                should be able to change the cluster. It grants the Runner write
                access (restart, scale, patch, delete pods) across the cluster.
                When this cluster&apos;s AI access has never been configured,
                remediation then starts in Ask for approval, so nothing changes
                without a human until you choose otherwise below.
              </p>
            </div>
            <p className="text-xs leading-5 text-gray-500">
              Prefer an existing Runner? Bind it below together with a
              Kubernetes credential (API server URL + ServiceAccount token from
              Project Settings → Runner Credentials) and make sure &quot;Runs AI
              Remediation Commands&quot; is on for that Runner.
            </p>
          </div>
        </Card>
      ) : (
        <></>
      )}

      <CardModelDetail<KubernetesCluster>
        name="AI access settings"
        cardProps={{
          title: "AI access settings",
          description: (
            <div className="space-y-1">
              <p>
                What OneUptime AI may do on this cluster, and how it reaches it.
                Changes apply to the next incident or alert.
              </p>
              {settingsGate.isAllowed && !canConfigureUnattended ? (
                <AdminPermissionNote />
              ) : (
                <></>
              )}
            </div>
          ),
          buttons: settingsButtons,
        }}
        /*
         * Edited through the modal below, not CardModelDetail's own
         * ModelForm: see KubernetesAiAccessSettingsModal.
         */
        isEditable={false}
        refresher={refresher}
        modelDetailProps={{
          modelType: KubernetesCluster,
          id: "kubernetes-cluster-ai-access",
          modelId: modelId,
          fields: [
            {
              field: { isAiInvestigationEnabled: true },
              title: "Let AI investigate with kubectl",
              fieldType: FieldType.Boolean,
            },
            {
              field: { aiRemediationMode: true },
              title: "AI remediation",
              fieldType: FieldType.Element,
              getElement: (item: KubernetesCluster): ReactElement => {
                const mode: KubernetesAiRemediationMode =
                  (item.aiRemediationMode as KubernetesAiRemediationMode) ||
                  KubernetesAiRemediationMode.Disabled;
                return (
                  <span>
                    {REMEDIATION_MODE_LABELS[mode] ||
                      REMEDIATION_MODE_LABELS[
                        KubernetesAiRemediationMode.Disabled
                      ]}
                  </span>
                );
              },
            },
            {
              field: { aiKubectlCommandAllowlist: true },
              title: "kubectl allowlist (Automatic mode)",
              fieldType: FieldType.Element,
              getElement: (item: KubernetesCluster): ReactElement => {
                const saved: SavedKubectlAllowlist =
                  normalizeSavedKubectlAllowlist(
                    item.aiKubectlCommandAllowlist,
                  );
                /*
                 * The stored value can say one thing while the policy uses
                 * another: a non-list is used as an empty allowlist. Say so,
                 * rather than showing a value that has no effect as if it
                 * were active.
                 */
                const isIgnored: boolean =
                  !saved.isClean ||
                  (saved.patterns.length > 0 && allowlistInEffect.length === 0);
                return (
                  <div>
                    {saved.patterns.length > 0 ? (
                      <ul className="space-y-0.5">
                        {saved.patterns.map(
                          (pattern: string, index: number): ReactElement => {
                            return (
                              <li
                                key={`${index}:${pattern}`}
                                className="break-words font-mono text-xs text-gray-800"
                              >
                                {pattern}
                              </li>
                            );
                          },
                        )}
                      </ul>
                    ) : (
                      <span>None</span>
                    )}
                    {isIgnored ? (
                      <p
                        className="mt-1 text-xs text-amber-700"
                        data-testid="kubectl-allowlist-ignored-warning"
                      >
                        {saved.isClean
                          ? "No allowlist pattern is in effect: the server could not use the saved patterns."
                          : saved.patterns.length === 0
                            ? "The saved allowlist is not a list of kubectl patterns, so it is ignored: no allowlist pattern is in effect. Edit AI access to replace it."
                            : "Some saved entries are not kubectl patterns and are ignored; only the patterns listed above can take effect. Edit AI access to clean the list up."}
                      </p>
                    ) : (
                      <></>
                    )}
                  </div>
                );
              },
            },
            {
              field: { aiAccessRunner: { name: true } },
              title: "Runner",
              fieldType: FieldType.Element,
              getElement: (item: KubernetesCluster): ReactElement => {
                return (
                  <div>
                    <span>
                      {item.aiAccessRunner?.name || "No Runner bound"}
                    </span>
                    {canPickRunner ? (
                      <></>
                    ) : (
                      <p
                        className="mt-1 text-xs text-gray-500"
                        data-testid="kubernetes-runner-permission-note"
                      >
                        Choosing a Runner here needs permission to read Runners
                        (one of:{" "}
                        {getKubernetesRunnerPermissionTitles().join(", ")}). The
                        in-cluster Runner installed by the agent chart binds
                        itself.
                      </p>
                    )}
                  </div>
                );
              },
            },
            {
              field: { aiAccessCredential: { name: true } },
              title: "Kubernetes credential",
              fieldType: FieldType.Element,
              getElement: (item: KubernetesCluster): ReactElement => {
                return (
                  <div>
                    <span>
                      {item.aiAccessCredential?.name ||
                        "None (in-cluster Runner)"}
                    </span>
                    {canPickCredential ? (
                      <></>
                    ) : (
                      <p
                        className="mt-1 text-xs text-gray-500"
                        data-testid="kubernetes-credential-permission-note"
                      >
                        Choosing a credential here needs permission to read
                        Runner credentials (one of:{" "}
                        {getKubernetesCredentialPermissionTitles().join(", ")}
                        ). The in-cluster Runner installed by the agent chart
                        needs no credential.
                      </p>
                    )}
                  </div>
                );
              },
            },
          ],
        }}
      />

      {isEditingSettings && editCapabilities ? (
        <KubernetesAiAccessSettingsModal
          clusterId={modelId}
          clusterIdentifier={status.clusterIdentifier}
          capabilities={editCapabilities}
          onClose={() => {
            setIsEditingSettings(false);
          }}
          onSaved={() => {
            setIsEditingSettings(false);
            setRefresher((value: boolean) => {
              return !value;
            });
          }}
        />
      ) : (
        <></>
      )}

      <Card
        title="Test access"
        description="Runs kubectl version and kubectl auth can-i --list through the bound Runner, so you can see the access work — and exactly what the Runner is allowed to do — before an incident does. Read-only."
        buttons={
          /*
           * The test route requires edit access to the cluster. Without it
           * the button stays, locked, with the reason in its tooltip; it
           * is dropped only while the permission snapshot has not landed.
           */
          testGate.isAllowed || testGate.disabledReason
            ? [
                <Button
                  key="test"
                  title="Run access test"
                  icon={IconProp.Play}
                  buttonStyle={ButtonStyleType.PRIMARY}
                  buttonSize={ButtonSize.Normal}
                  isLoading={isTesting}
                  disabled={isTesting || !hasRunner || !testGate.isAllowed}
                  tooltip={
                    testGate.isAllowed
                      ? undefined
                      : getAccessTestPermissionRequirement()
                  }
                  dataTestId="ai-access-test-button"
                  onClick={() => {
                    if (!testGate.isAllowed || !hasRunner) {
                      return;
                    }
                    runTest().catch(() => {
                      // handled inside runTest
                    });
                  }}
                />,
              ]
            : []
        }
      >
        <div className="space-y-3">
          {!hasRunner ? (
            <p className="text-sm text-gray-500">
              Bind a Runner first — there is nothing to test yet.
            </p>
          ) : (
            <></>
          )}
          {!testGate.isAllowed && testGate.disabledReason ? (
            <p
              className="text-xs text-gray-500"
              data-testid="ai-access-test-permission-note"
            >
              {getAccessTestPermissionRequirement()}
            </p>
          ) : (
            <></>
          )}
          {testError ? (
            <Alert
              type={AlertType.DANGER}
              strongTitle="The test could not run"
              title={testError}
              dataTestId="ai-access-test-error"
            />
          ) : (
            <></>
          )}
          {testResult ? (
            <div className="space-y-3">
              <Alert
                type={testResult.ok ? AlertType.SUCCESS : AlertType.WARNING}
                strongTitle={
                  testResult.ok ? "Access works" : "Access is not working yet"
                }
                title={testResult.message}
              />
              {testResult.results.map(
                (
                  row: AccessTestResult["results"][number],
                  index: number,
                ): ReactElement => {
                  return (
                    <div
                      key={index}
                      className="rounded-lg border border-gray-200 bg-gray-50 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-gray-800">
                          {row.command}
                        </span>
                        <Pill
                          text={
                            row.succeeded
                              ? "succeeded"
                              : `failed${
                                  row.exitCode !== null
                                    ? ` (exit ${row.exitCode})`
                                    : ""
                                }`
                          }
                          color={row.succeeded ? Green500 : Red500}
                        />
                      </div>
                      {row.errorMessage ? (
                        <p className="mt-1 text-xs text-rose-600">
                          {row.errorMessage}
                        </p>
                      ) : (
                        <></>
                      )}
                      {row.output ? (
                        <pre className="mt-2 max-h-72 overflow-auto rounded border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-800">
                          {row.output}
                        </pre>
                      ) : (
                        <></>
                      )}
                    </div>
                  );
                },
              )}
            </div>
          ) : (
            <></>
          )}
        </div>
      </Card>

      {canReadKubectlJobs() ? (
        <ModelTable<RunnerJob>
          modelType={RunnerJob}
          id="kubernetes-cluster-ai-kubectl-jobs"
          name="Commands OneUptime AI ran on this cluster"
          isDeleteable={false}
          isEditable={false}
          isCreateable={false}
          isViewable={false}
          showViewIdButton={false}
          query={{
            kubernetesClusterId: modelId,
            stepType: RunbookStepType.Kubectl,
          }}
          cardProps={{
            title: "Commands OneUptime AI ran on this cluster",
            description:
              "Every kubectl command OneUptime AI ran here — during investigations (read-only), approved fixes, automatic fixes and access tests — with its outcome.",
          }}
          userPreferencesKey={KUBECTL_JOBS_TABLE_PREFERENCES_KEY}
          /*
           * The table fetches exactly the column fields plus these, so every
           * field a cell reads must be named here or it is undefined on the
           * row: aiRunId tells an investigation from an access test, exitCode
           * and errorMessage say how a command ended.
           */
          selectMoreFields={{
            aiRunId: true,
            exitCode: true,
            errorMessage: true,
          }}
          noItemsMessage="OneUptime AI has not run any kubectl commands on this cluster yet."
          sortBy="createdAt"
          sortOrder={SortOrder.Descending}
          showRefreshButton={true}
          filters={[
            {
              field: { status: true },
              title: "Result",
              type: FieldType.Dropdown,
              filterDropdownOptions:
                DropdownUtil.getDropdownOptionsFromEnum(RunnerJobStatus),
            },
            {
              field: { origin: true },
              title: "Why",
              type: FieldType.Dropdown,
              filterDropdownOptions: [
                {
                  value: RunnerJobOrigin.AiInvestigation,
                  label:
                    KUBECTL_JOB_ORIGIN_LABELS[RunnerJobOrigin.AiInvestigation],
                },
                {
                  value: RunnerJobOrigin.AiRemediation,
                  label:
                    KUBECTL_JOB_ORIGIN_LABELS[RunnerJobOrigin.AiRemediation],
                },
              ],
            },
            {
              field: { createdAt: true },
              title: "When",
              type: FieldType.Date,
            },
          ]}
          columns={[
            {
              field: { createdAt: true },
              title: "When",
              type: FieldType.DateTime,
            },
            {
              field: { payload: true },
              title: "Command",
              type: FieldType.Element,
              getElement: (item: RunnerJob): ReactElement => {
                const payload: JSONObject = (item.payload || {}) as JSONObject;
                return (
                  <span className="font-mono text-xs text-gray-800">
                    {String(payload["displayCommand"] || "kubectl …")}
                  </span>
                );
              },
            },
            {
              field: { origin: true },
              title: "Why",
              type: FieldType.Element,
              getElement: (item: RunnerJob): ReactElement => {
                const origin: string = String(item.origin || "");
                return (
                  <span className="text-xs text-gray-700">
                    {origin === RunnerJobOrigin.AiInvestigation
                      ? item.aiRunId
                        ? "Investigation (read-only)"
                        : "Access test (read-only)"
                      : origin === RunnerJobOrigin.AiRemediation
                        ? "Remediation"
                        : origin}
                  </span>
                );
              },
            },
            {
              field: { status: true },
              title: "Result",
              type: FieldType.Element,
              getElement: (item: RunnerJob): ReactElement => {
                const statusText: string = String(item.status || "");
                const color: typeof Green500 =
                  statusText === RunnerJobStatus.Succeeded
                    ? Green500
                    : statusText === RunnerJobStatus.Pending ||
                        statusText === RunnerJobStatus.Claimed ||
                        statusText === RunnerJobStatus.Running
                      ? Yellow500
                      : Red500;
                return (
                  <div>
                    <Pill
                      text={
                        typeof item.exitCode === "number"
                          ? `${statusText} (exit ${item.exitCode})`
                          : statusText
                      }
                      color={color}
                    />
                    {item.errorMessage ? (
                      <p className="mt-1 max-w-md break-words text-xs text-rose-600">
                        {item.errorMessage}
                      </p>
                    ) : (
                      <></>
                    )}
                  </div>
                );
              },
            },
          ]}
        />
      ) : (
        /*
         * Settings roles and ReadKubernetesCluster may open this page but
         * not read RunnerJob rows, so the table could only fail. Explain
         * instead; RunnerJob's ACL stays as it is.
         */
        <Card
          title="Commands OneUptime AI ran on this cluster"
          description="Every kubectl command OneUptime AI ran here — during investigations (read-only), approved fixes, automatic fixes and access tests — with its outcome."
        >
          <p
            className="text-sm text-gray-600"
            data-testid="kubectl-jobs-permission-note"
          >
            Seeing the commands needs permission to read Runner jobs (one of:{" "}
            {getKubectlJobsPermissionTitles().join(", ")}). Commands AI ran
            while investigating or fixing an incident or alert also appear on
            that incident or alert.
          </p>
        </Card>
      )}
    </Fragment>
  );
};

export default KubernetesClusterAI;
