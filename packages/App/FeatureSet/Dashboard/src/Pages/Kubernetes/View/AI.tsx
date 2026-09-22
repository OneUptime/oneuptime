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
  KubernetesRunnerPosture,
  KUBERNETES_AGENT_RUNNER_NAME_PREFIX,
  PROTECTED_KUBERNETES_NAMESPACES,
  isInClusterPostureForCluster,
  isKubernetesAgentRunnerName,
  isUnattendedRemediationMode,
  parseKubernetesRunnerPosture,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import {
  KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS,
  KUBERNETES_AI_ACCESS_CREDENTIAL_PERMISSIONS,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import KubectlPolicy, {
  KUBECTL_ALLOWLIST_MAX_PATTERNS,
} from "Common/Utils/AiRemediation/KubectlPolicy";
import {
  KUBERNETES_AGENT_HELM_NAMESPACE,
  KUBERNETES_AGENT_HELM_RELEASE,
} from "../Utils/DocumentationMarkdown";
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

// "a, b and c" / "a, b or c".
function formatNameList(
  names: ReadonlyArray<string>,
  conjunction: string,
): string {
  if (names.length <= 1) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} ${conjunction} ${names[names.length - 1]}`;
}

/*
 * What each mode does, in the words of the canonical description on
 * KubernetesAiRemediationMode (Common/Types/Kubernetes/
 * KubernetesClusterAiAccess.ts). Every sentence on this page about a mode
 * — the labels, the mode field, the banners and the confirmations — says
 * the same thing that comment says.
 */
export const REMEDIATION_MODE_LABELS: Record<
  KubernetesAiRemediationMode,
  string
> = {
  [KubernetesAiRemediationMode.Disabled]: "Off — AI only investigates",
  [KubernetesAiRemediationMode.RequireApproval]:
    "Ask for approval — a human approves each kubectl plan",
  [KubernetesAiRemediationMode.Automatic]:
    "Automatic — safe fixes run on their own, riskier ones are proposed for your one-click approval",
  [KubernetesAiRemediationMode.BypassApproval]:
    "Bypass approval — every allowed fix runs on its own; only protected namespaces, node drains and taints, or a tripped circuit breaker still ask a human",
};

// What holds in every mode, Bypass approval included.
export function getEveryModeProtectionsSentence(): string {
  return `destructive commands (deleting namespaces, volumes, nodes, secrets or CRDs; exec; apply) never run; a write in ${formatNameList(
    PROTECTED_KUBERNETES_NAMESPACES,
    "or",
  )}, a node drain and a taint always need a human; the in-cluster Runner never changes its own namespace; and the hourly circuit breaker turns an unattended run into a proposal`;
}

export function getRemediationModeFieldDescription(): string {
  return `Off: AI only investigates. Ask for approval: AI composes the exact kubectl plan and a human approves it with one click; a follow-up plan asks again. Automatic: safe changes — each on one named object (rollout restart/undo/pause/resume, scale above zero, delete a named pod, cordon/uncordon a node, label/annotate a pod or workload) — run on their own. A riskier change (patch, set image, drain, scale to zero, deleting workloads or jobs, anything touching several objects) never runs without a human: when the round could only find riskier fixes, it ends by proposing exactly those for one-click approval; when it also ran safe fixes, a riskier fix is proposed only if verification shows the safe ones did not recover the signal. Riskier shapes the kubectl allowlist names run on their own. Bypass approval: AI does not ask — every change the policy allows, safe and riskier, runs on its own, follow-up rounds included. In every mode: ${getEveryModeProtectionsSentence()}.`;
}

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
 * use. They are defined once, next to those instructions
 * (Pages/Kubernetes/Utils/DocumentationMarkdown.ts), and the one-command
 * upgrades on this page are built from the same constants: `helm upgrade`
 * of a release that does not exist fails with "has no deployed releases",
 * so a cluster installed the way the product said would not connect.
 */
export { KUBERNETES_AGENT_HELM_NAMESPACE, KUBERNETES_AGENT_HELM_RELEASE };

// The example namespaces the scoped write-access command names.
export const AI_ACCESS_EXAMPLE_WRITE_NAMESPACES: string = "{web,api}";

export interface AiAccessHelmCommands {
  // The default: read-only investigation access. What a plain copy-paste runs.
  readOnly: string;
  /*
   * Write access, the recommended form: the write role bound only in the
   * namespaces AI may fix, and no node operations. A complete command of
   * its own, never a line to append — a dropped last line left a trailing
   * backslash behind.
   */
  enableRemediationScoped: string;
  // Write access bound cluster-wide, node operations included (the chart's defaults).
  enableRemediation: string;
}

/*
 * Every command starts with `helm repo update`: an install from before
 * aiAccess existed keeps a cached chart index, `helm upgrade` then resolves
 * the old chart, and its values schema refuses the flag with "Additional
 * property aiAccess is not allowed" — which reads as "this feature does not
 * exist". Each command is complete on its own, so an operator who skips the
 * read-only step and runs a write-access command directly is covered too.
 * No chart version is named: published charts carry the OneUptime version,
 * not the chart's own.
 */
export function getAiAccessHelmCommands(): AiAccessHelmCommands {
  const upgrade: string = `helm repo update
helm upgrade ${KUBERNETES_AGENT_HELM_RELEASE} oneuptime/kubernetes-agent \\
  --namespace ${KUBERNETES_AGENT_HELM_NAMESPACE} --reuse-values \\
  --set aiAccess.enabled=true`;

  return {
    readOnly: upgrade,
    enableRemediationScoped: `${upgrade} \\
  --set aiAccess.remediation.enabled=true \\
  --set "aiAccess.remediation.namespaces=${AI_ACCESS_EXAMPLE_WRITE_NAMESPACES}" \\
  --set aiAccess.remediation.nodeOperations=false`,
    enableRemediation: `${upgrade} \\
  --set aiAccess.remediation.enabled=true`,
  };
}

/*
 * What granting the in-cluster Runner write access amounts to, said
 * wherever the page offers it — the same disclosure the chart docs make
 * (telemetry/kubernetes-agent.md, ai/ai-sre.md): RBAC bounds WHERE the
 * Runner may write, not what a write may do.
 */
export function getAiAccessWriteDisclosure(): string {
  return `Write access grants patch/update on Deployments, StatefulSets, DaemonSets, ReplicaSets, Jobs, CronJobs, Pods and HPAs, create on Jobs and HPAs, and delete on Pods and Jobs — and, unless aiAccess.remediation.nodeOperations=false, cordon, uncordon, drain and taint on every node. Patch/update on workloads, pods and CronJobs, and create on Jobs, in a namespace is equivalent to running any image as any ServiceAccount in that namespace and reading its Secrets. Without aiAccess.remediation.namespaces the write role is bound cluster-wide — ${formatNameList(
    PROTECTED_KUBERNETES_NAMESPACES,
    "and",
  )} and the agent's own namespace included — and there only the command policy and the Runner hold the line: a write in ${formatNameList(
    PROTECTED_KUBERNETES_NAMESPACES,
    "or",
  )} always needs a human, and the Runner never changes anything in its own namespace. With it, the chart binds the role in exactly the namespaces you list, and the Runner refuses a write anywhere else.`;
}

/*
 * What the bound in-cluster Runner may write, from the posture it reports:
 * where (its writeNamespaces; empty is cluster-wide, absent is an older
 * Runner that did not say) and whether node operations are on. Null for a
 * Runner that is not in a cluster — its credential's RBAC decides.
 */
export function describeRunnerWriteAccess(
  posture: KubernetesRunnerPosture | undefined,
): string | null {
  if (!posture?.inCluster) {
    return null;
  }

  if (!posture.allowWrites) {
    return "read-only RBAC";
  }

  const where: string = !posture.writeNamespaces
    ? "writes allowed"
    : posture.writeNamespaces.length === 0
      ? "writes allowed cluster-wide"
      : `writes allowed in ${posture.writeNamespaces.join(", ")}`;

  return posture.allowNodeOperations === false
    ? `${where}, no node operations`
    : where;
}

/*
 * The card that helps an operator connect a Runner:
 *
 * connect:             no Runner is bound (or the bound one is gone) and
 *                      this cluster's in-cluster Runner is not installed —
 *                      show the one-command helm upgrade.
 * select_agent_runner: no Runner is bound, but this cluster's in-cluster
 *                      Runner is already registered (the server's
 *                      no_runner_bound gap names it): re-running helm would
 *                      change nothing, selecting it on this page is the step.
 * none:                a Runner is bound.
 *
 * The server tells the two no_runner_bound cases apart only in the gap's
 * words: the installed case names the "kubernetes-agent/…" Runner to
 * select. A parity test runs the server's real status through this.
 */
export type AiAccessConnectCardMode =
  | "connect"
  | "select_agent_runner"
  | "none";

export function getAiAccessConnectCardMode(
  status: KubernetesClusterAiAccessStatus,
): AiAccessConnectCardMode {
  const noRunnerBound: KubernetesAiAccessGap | undefined = status.gaps.find(
    (gap: KubernetesAiAccessGap): boolean => {
      return gap.code === "no_runner_bound";
    },
  );

  if (
    noRunnerBound &&
    noRunnerBound.nextStep.includes(`"${KUBERNETES_AGENT_RUNNER_NAME_PREFIX}/`)
  ) {
    return "select_agent_runner";
  }

  if (
    status.runner === null ||
    noRunnerBound ||
    status.gaps.some((gap: KubernetesAiAccessGap): boolean => {
      return gap.code === "runner_missing";
    })
  ) {
    return "connect";
  }

  return "none";
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
 * move remediation up to Automatic or Bypass approval, add a kubectl
 * allowlist pattern, or bind a Runner / credential kubectl runs through. A
 * cluster's mode does the job of a FullAuto auto-remediation rule, so it
 * takes the same permissions (KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS) and
 * the server refuses the write without them. Tightening — a lower mode
 * (Bypass approval -> Automatic included), removing allowlist patterns,
 * unbinding the Runner or credential, the investigation switch — stays
 * open to every cluster editor (getKubernetesAiAccessLooseningChanges).
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
  /*
   * Loosening: a higher unattended mode and new allowlist patterns. Without
   * it the modal still offers every tightening (see the modal's `offered`).
   */
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
 * (describeAllowlistPatternProblem and KUBECTL_ALLOWLIST_MAX_PATTERNS): the
 * form never accepts an entry the matcher would skip, nor refuses one it
 * would read. A leading "kubectl" is optional there, and a bare "kubectl"
 * names no command.
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
 * The stored allowlist exactly as the server reads it — KubernetesCluster
 * Service when it decides whether a write adds a pattern, and the status
 * (so the policy) when it decides what is in effect: trimmed non-blank
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
 * The stored allowlist for the form and the settings card: the patterns
 * the server reads (readStoredKubectlAllowlist), shown whitespace-collapsed
 * like the form shows them, and whether the stored value is a clean list —
 * a list, or a JSON-encoded list, of non-blank strings. A value that is not
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
 * line; an unbound Runner or credential is the empty string. The two clear
 * switches are offered to users who may unbind but not pick (see
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
 * Which of the privileged fields the form offered. Every cluster editor
 * may TIGHTEN (the server's rule, mirrored by
 * getKubernetesAiAccessLooseningChanges), so the fields are offered by what
 * the user may do with them, not only by whether they may loosen:
 *
 * allowlist:           the allowlist field. An admin edits it freely; a
 *                      cluster editor without the admin set gets it only
 *                      when there is something to remove, and may only
 *                      remove (allowlistRemoveOnly).
 * runner / credential: the pickers — the admin set AND permission to list
 *                      the rows (see getKubernetesAiAccessEditCapabilities).
 * runnerClear /
 * credentialClear:     an "Unbind" switch for a bound Runner / credential
 *                      when its picker is not offered. Unbinding is
 *                      tightening and needs no list to read.
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
}): KubernetesAiAccessOfferedFields {
  const savedAllowlist: SavedKubectlAllowlist = normalizeSavedKubectlAllowlist(
    data.saved.aiKubectlCommandAllowlist,
  );

  return {
    allowlist:
      data.canConfigureUnattended ||
      savedAllowlist.patterns.length > 0 ||
      !savedAllowlist.isClean,
    allowlistRemoveOnly: !data.canConfigureUnattended,
    runner: data.isRunnerPickerAvailable,
    credential: data.isCredentialPickerAvailable,
    runnerClear:
      !data.isRunnerPickerAvailable && data.saved.aiAccessRunnerId !== null,
    credentialClear:
      !data.isCredentialPickerAvailable &&
      data.saved.aiAccessCredentialId !== null,
  };
}

function readDropdownId(value: unknown): string | null {
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
 * How much each mode lets OneUptime AI do without a human, least first —
 * the server's REMEDIATION_MODES_BY_AUTONOMY (KubernetesClusterService).
 * Automatic runs a strict subset of what Bypass approval runs, so Bypass
 * approval -> Automatic is a tightening.
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

// The mode's short name, as the feed and the refusals say it.
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
 * May a cluster editor WITHOUT the admin set choose this mode on a cluster
 * saved at `savedMode`? Every mode at or below the saved one: Off and Ask
 * for approval always, Automatic on a Bypass-approval cluster, and the
 * saved mode itself (choosing it is no change).
 */
export function isRemediationModeOpenToEveryEditor(
  mode: KubernetesAiRemediationMode,
  savedMode: KubernetesAiRemediationMode,
): boolean {
  return (
    !isUnattendedRemediationMode(mode) ||
    getRemediationModeAutonomy(mode) <= getRemediationModeAutonomy(savedMode)
  );
}

/*
 * The changes that LOOSEN what AI may do on a cluster whose settings are
 * `saved`, and so need KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS — the
 * server's rule (KubernetesClusterService.getAiAccessLoosening), mirrored
 * so the page offers exactly what the server accepts:
 *
 * - mode: an unattended mode above the saved one (Bypass approval ->
 *   Automatic tightens);
 * - allowlist: a pattern the stored list does not already hold, compared
 *   the way the server compares them (trimmed stored strings); removing
 *   patterns or clearing the list tightens;
 * - Runner or credential: binding one other than the bound one; unbinding
 *   tightens.
 *
 * Each entry names the change for the refusal; empty when nothing loosens.
 */
export function getKubernetesAiAccessLooseningChanges(data: {
  saved: KubernetesAiAccessSavedSettings;
  changes: JSONObject;
}): Array<string> {
  const loosening: Array<string> = [];

  const mode: KubernetesAiRemediationMode | undefined = data.changes[
    "aiRemediationMode"
  ] as KubernetesAiRemediationMode | undefined;

  if (
    mode !== undefined &&
    isUnattendedRemediationMode(mode) &&
    getRemediationModeAutonomy(mode) >
      getRemediationModeAutonomy(data.saved.aiRemediationMode)
  ) {
    loosening.push(
      `switching AI remediation to ${REMEDIATION_MODE_SHORT_NAMES[mode]}`,
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
        `adding the kubectl allowlist pattern${added.length === 1 ? "" : "s"} ${added
          .map((pattern: string): string => {
            return `"${pattern}"`;
          })
          .join(", ")}`,
      );
    }
  }

  const runnerId: unknown = data.changes["aiAccessRunnerId"];

  if (runnerId && String(runnerId) !== data.saved.aiAccessRunnerId) {
    loosening.push("binding a different Runner");
  }

  const credentialId: unknown = data.changes["aiAccessCredentialId"];

  if (
    credentialId &&
    String(credentialId) !== data.saved.aiAccessCredentialId
  ) {
    loosening.push("binding a Kubernetes credential");
  }

  return loosening;
}

/*
 * What the allowlist field refuses from a cluster editor without the admin
 * set: any line the stored list does not hold (compared whitespace-
 * collapsed, the form's spelling — withStoredSpellings sends those lines in
 * their stored spelling). Removing lines and clearing the list pass.
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

const RISKIER_CHANGE_EXAMPLES: string =
  "riskier changes such as kubectl set image, patch, scale to zero and deleting workloads";

/*
 * Saving Bypass approval, or a broad allowlist pattern while Automatic mode
 * is on or being turned on, lets riskier changes run with nobody asked.
 * Such a save is confirmed first, in words that name what it unlocks. A
 * pattern is broad exactly when KubectlPolicy.isBroadAllowlistPattern says
 * so — a wildcard for the verb, the object or the namespace, decided on the
 * tokens the matcher itself reads. Null when the save needs no
 * confirmation.
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
      description: `With Bypass approval OneUptime AI applies every fix the kubectl policy allows on this cluster without asking anyone — ${RISKIER_CHANGE_EXAMPLES} included, in follow-up rounds too. Even so, ${getEveryModeProtectionsSentence()}.`,
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

  const isOne: boolean = broadPatterns.length === 1;
  const quoted: string = broadPatterns
    .map((pattern: string): string => {
      return `"${pattern}"`;
    })
    .join(", ");

  return {
    title: "Let riskier changes run without approval?",
    description: `The allowlist pattern${isOne ? "" : "s"} ${quoted} ${
      isOne ? "uses" : "use"
    } a wildcard for the verb, the object or the namespace, so ${
      isOne ? "it pre-approves" : "they pre-approve"
    } a whole class of changes, not one. ${
      resultingMode === KubernetesAiRemediationMode.Automatic
        ? "In Automatic mode"
        : "Once this cluster is switched to Automatic mode"
    }, every riskier change of that shape — to any object and in any namespace the wildcard covers, ${RISKIER_CHANGE_EXAMPLES} included — then runs with nobody asked. Even so, ${getEveryModeProtectionsSentence()}.`,
  };
}

/*
 * The Runners the edit modal lists, with what the pickers need to know
 * about each: its name, and whether it is a kubernetes-agent Runner (by
 * name, which only the server writes — isKubernetesAgentRunnerName).
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
    directory[id] = { name, isAgent: isKubernetesAgentRunnerName(name) };
  }

  return directory;
}

/*
 * Is this Runner row THIS cluster's in-cluster agent Runner? A kubernetes-
 * agent row (by name) whose reported posture says it runs inside this
 * cluster (isInClusterPostureForCluster) — the pair the server itself
 * matches on. Never by rebuilding the row's name: the server shortens a
 * long cluster identifier with a hash the browser cannot compute
 * (getKubernetesAgentRunnerNameForCluster), so "kubernetes-agent/<id>" is
 * not the name of every cluster's Runner.
 */
export function isThisClustersAgentRunner(
  runner: Pick<Runner, "name" | "hostInfo">,
  clusterIdentifier: string | undefined,
): boolean {
  return (
    isKubernetesAgentRunnerName(runner.name) &&
    isInClusterPostureForCluster(
      parseKubernetesRunnerPosture(runner.hostInfo),
      clusterIdentifier,
    )
  );
}

/*
 * The Runner picker's options: only Runners that can serve this cluster.
 * This cluster's in-cluster agent Runner comes first. An agent Runner of
 * ANOTHER cluster is never offered — it runs kubectl with its own
 * ServiceAccount, so it can only ever reach its own cluster — and a Runner
 * with "Runs AI Remediation Commands" off would be refused every command.
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
    const isThisClustersAgent: boolean = isThisClustersAgentRunner(
      runner,
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

// The Runner the credential would be used through: its id and name.
export interface KubernetesAiCredentialRunner {
  id: string | null;
  name: string | null;
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
 * assigned to it, and the status reports any other pairing as a
 * credential_missing gap. None for a kubernetes-agent Runner, which is
 * never given a credential, and none before a Runner is chosen. The bound
 * credential is always kept, labelled with why it does not fit when it
 * does not, so the form shows the binding it would otherwise hide.
 */
export function buildKubernetesAiCredentialOptions(data: {
  credentials: Array<RunbookCredential>;
  boundCredentialId: string | null;
  boundCredentialName: string | null;
  runner: KubernetesAiCredentialRunner;
}): Array<DropdownOption> {
  const options: Array<DropdownOption> = [];
  const runnerName: string = data.runner.name || "the chosen Runner";
  const isAgentRunner: boolean = isKubernetesAgentRunnerName(data.runner.name);

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
          label: `${name} (currently bound — not a Kubernetes credential)`,
        });
      }
      continue;
    }

    const runnerIds: Array<string> | undefined =
      readCredentialRunnerIds(credential);

    let unusableReason: string | null = null;
    if (isAgentRunner) {
      unusableReason = `${runnerName} is an in-cluster Runner and is never given a credential`;
    } else if (!data.runner.id) {
      unusableReason = "no Runner is chosen to use it";
    } else if (runnerIds && !runnerIds.includes(data.runner.id)) {
      unusableReason = `not assigned to ${runnerName}`;
    }

    if (unusableReason) {
      if (isBound) {
        options.push({
          value: id,
          label: `${name} (currently bound — ${unusableReason})`,
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
      label: `${data.boundCredentialName || "The bound credential"} (currently bound)`,
    });
  }

  return options;
}

// The credential field's help, for the Runner the form has chosen.
export function getKubernetesAiCredentialFieldDescription(
  runner: KubernetesAiCredentialRunner,
): string {
  if (runner.id && isKubernetesAgentRunnerName(runner.name)) {
    return `No credential can be chosen: "${runner.name}" is an in-cluster Runner installed by the Kubernetes agent chart. It runs kubectl with its own ServiceAccount and is never given a credential — leave this empty. A credential is for a Runner outside the cluster.`;
  }

  if (!runner.id) {
    return "Only for a Runner outside the cluster. Choose the Runner first: only Kubernetes credentials (API server URL + ServiceAccount token) assigned to the chosen Runner are listed.";
  }

  return `Only for a Runner outside the cluster: the Kubernetes credentials (API server URL + ServiceAccount token) assigned to "${
    runner.name || "the chosen Runner"
  }" are listed. Assign one to it under Project Settings → Runner Credentials. Leave empty for the in-cluster Runner, which uses its own ServiceAccount.`;
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

  if (data.runner.id && isKubernetesAgentRunnerName(data.runner.name)) {
    return `"${data.runner.name}" is an in-cluster Runner: it runs kubectl with its own ServiceAccount and is never given a credential. Clear the Kubernetes credential, or choose a Runner created under Project Settings → Runners.`;
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
    }". Assign it under Project Settings → Runner Credentials, or choose a credential assigned to that Runner.`;
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
      Letting AI do more — a higher remediation mode (Automatic or Bypass
      approval), new kubectl allowlist patterns, or choosing a Runner or
      Kubernetes credential — needs one of these permissions:{" "}
      {getKubernetesAiAccessAdminPermissionTitles().join(", ")} — the same ones
      an unattended auto-remediation rule needs. You can still turn
      investigation on or off, lower the remediation mode (to Off or Ask for
      approval, or from Bypass approval to Automatic), remove allowlist
      patterns, and unbind the Runner or credential.
    </p>
  );
}

const ALLOWLIST_FIELD_DESCRIPTION: string =
  'Optional, used in Automatic mode only. One pattern per line: a riskier kubectl command (set image, patch, scale to zero, deleting workloads) that matches a pattern also runs without approval. Patterns are compared word by word — * matches exactly one word, and flags must be written out; a leading "kubectl" is optional — for example: kubectl set image deployment/web * -n web. A wildcard for the verb, the object or the namespace pre-approves a whole class of changes, and saving one asks you to confirm. Not needed in Bypass approval mode, where every allowed change already runs on its own. Destructive commands, node drains and taints, and the protected namespaces never run unattended.';

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
 * credential stays bound — unbinding either one is never refused.
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
    runner: { id: runnerId, name: runnerName },
    credentialId,
    credentialName:
      credential?.name ||
      (credentialId === data.saved.aiAccessCredentialId
        ? data.saved.aiAccessCredentialName
        : null),
    credentialRunnerIds: credential?.runnerIds,
  });
}

function capitalizeFirst(value: string): string {
  return value.length > 0 ? `${value[0]!.toUpperCase()}${value.slice(1)}` : "";
}

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
 * changed, offers what the user may do (every cluster editor may tighten;
 * only the admin set may loosen), validates the allowlist as patterns,
 * refuses a Runner and credential that cannot work together, and asks
 * before a save that lets riskier changes run unattended.
 */
const KubernetesAiAccessSettingsModal: FunctionComponent<SettingsModalProps> = (
  props: SettingsModalProps,
): ReactElement => {
  const [saved, setSaved] = useState<KubernetesAiAccessSavedSettings | null>(
    null,
  );
  const [runners, setRunners] = useState<Array<Runner>>([]);
  const [credentials, setCredentials] = useState<Array<RunbookCredential>>([]);
  const [isRunnerPickerAvailable, setIsRunnerPickerAvailable] =
    useState<boolean>(false);
  const [isCredentialPickerAvailable, setIsCredentialPickerAvailable] =
    useState<boolean>(false);
  /*
   * The Runner the form currently has chosen. The credential options follow
   * it: only credentials assigned to it are offered.
   */
  const [chosenRunnerId, setChosenRunnerId] = useState<string | null>(null);
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
       * whose list failed is left out, which leaves its binding as it is
       * (it can still be unbound).
       */
      const errors: Array<string> = [];

      const loadRunners: () => Promise<Array<Runner> | null> =
        async (): Promise<Array<Runner> | null> => {
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
                // The posture: which cluster an agent Runner runs in.
                hostInfo: true,
              },
              sort: { name: SortOrder.Ascending },
            });
            return result.data || [];
          } catch (err) {
            errors.push(
              `The Runner list could not be loaded, so the Runner binding is left as it is: ${API.getFriendlyMessage(err)}`,
            );
            return null;
          }
        };

      const loadCredentials: () => Promise<Array<RunbookCredential> | null> =
        async (): Promise<Array<RunbookCredential> | null> => {
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
                select: {
                  _id: true,
                  name: true,
                  credentialType: true,
                  // Which Runners may use each one: the picker follows the Runner.
                  runners: { _id: true },
                },
                sort: { name: SortOrder.Ascending },
              });
            return result.data || [];
          } catch (err) {
            errors.push(
              `The credential list could not be loaded, so the credential binding is left as it is: ${API.getFriendlyMessage(err)}`,
            );
            return null;
          }
        };

      const [runnerRows, credentialRows]: [
        Array<Runner> | null,
        Array<RunbookCredential> | null,
      ] = await Promise.all([loadRunners(), loadCredentials()]);

      if (!isMounted) {
        return;
      }

      setSaved(settings);
      setChosenRunnerId(settings.aiAccessRunnerId);
      setRunners(runnerRows || []);
      setIsRunnerPickerAvailable(runnerRows !== null);
      setCredentials(credentialRows || []);
      setIsCredentialPickerAvailable(credentialRows !== null);
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

  const offered: KubernetesAiAccessOfferedFields | null = useMemo(() => {
    if (!saved) {
      return null;
    }

    return getKubernetesAiAccessOfferedFields({
      saved,
      canConfigureUnattended,
      isRunnerPickerAvailable,
      isCredentialPickerAvailable,
    });
  }, [
    saved,
    canConfigureUnattended,
    isRunnerPickerAvailable,
    isCredentialPickerAvailable,
  ]);

  const runnerDirectory: Record<string, KubernetesAiRunnerDirectoryEntry> =
    useMemo(() => {
      return buildKubernetesAiRunnerDirectory(runners);
    }, [runners]);

  const credentialDirectory: Record<
    string,
    KubernetesAiCredentialDirectoryEntry
  > = useMemo(() => {
    return buildKubernetesAiCredentialDirectory(credentials);
  }, [credentials]);

  const runnerOptions: Array<DropdownOption> = useMemo(() => {
    if (!saved) {
      return [];
    }

    return buildKubernetesAiRunnerOptions({
      runners,
      clusterIdentifier: props.clusterIdentifier,
      boundRunnerId: saved.aiAccessRunnerId,
      boundRunnerName: saved.aiAccessRunnerName,
    });
  }, [saved, runners, props.clusterIdentifier]);

  const chosenRunner: KubernetesAiCredentialRunner = useMemo(() => {
    if (!chosenRunnerId) {
      return { id: null, name: null };
    }

    return {
      id: chosenRunnerId,
      name:
        runnerDirectory[chosenRunnerId]?.name ||
        (chosenRunnerId === saved?.aiAccessRunnerId
          ? saved.aiAccessRunnerName
          : null),
    };
  }, [chosenRunnerId, runnerDirectory, saved]);

  /*
   * Built once everything has loaded — BasicForm reads its initial values
   * once, on the first render in which the fields exist — and again when
   * the chosen Runner changes, so the credential options follow it (the
   * form keeps its values across that).
   */
  const fields: Fields<KubernetesAiAccessSettingsFormValues> = useMemo(() => {
    if (!saved || !offered) {
      return [];
    }

    /*
     * Without the admin set a cluster editor may still lower the mode, so
     * every mode at or below the saved one is offered (Automatic on a
     * Bypass-approval cluster) — the saved one marked, since choosing it is
     * no change and sends nothing.
     */
    const modes: Array<KubernetesAiRemediationMode> = canConfigureUnattended
      ? Object.values(KubernetesAiRemediationMode)
      : Object.values(KubernetesAiRemediationMode).filter(
          (mode: KubernetesAiRemediationMode): boolean => {
            return isRemediationModeOpenToEveryEditor(
              mode,
              saved.aiRemediationMode,
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
        dataTestId: "ai-investigation-field",
      },
      {
        field: { aiRemediationMode: true },
        title: "AI remediation",
        description: getRemediationModeFieldDescription(),
        fieldType: FormFieldSchemaType.Dropdown,
        required: true,
        dataTestId: "ai-remediation-mode-field",
        dropdownOptions: modes.map(
          (mode: KubernetesAiRemediationMode): DropdownOption => {
            return {
              value: mode,
              label:
                !canConfigureUnattended &&
                isUnattendedRemediationMode(mode) &&
                mode === saved.aiRemediationMode
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
        description: offered.allowlistRemoveOnly
          ? `You can remove patterns or clear the list; adding or changing one needs one of these permissions: ${getKubernetesAiAccessAdminPermissionTitles().join(", ")}. ${ALLOWLIST_FIELD_DESCRIPTION}`
          : ALLOWLIST_FIELD_DESCRIPTION,
        fieldType: FormFieldSchemaType.LongText,
        required: false,
        placeholder: "kubectl set image deployment/web * -n web",
        dataTestId: "kubectl-allowlist-field",
        customValidation: (
          values: FormValues<KubernetesAiAccessSettingsFormValues>,
        ): string | null => {
          return (
            validateKubectlAllowlistText(values.kubectlAllowlistText) ||
            (offered.allowlistRemoveOnly
              ? getKubectlAllowlistRemovalOnlyError({
                  text: values.kubectlAllowlistText,
                  storedValue: saved.aiKubectlCommandAllowlist,
                })
              : null)
          );
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
    } else if (offered.runnerClear) {
      result.push({
        field: { clearAiAccessRunner: true },
        title: "Unbind the Runner",
        description: `Bound now: ${
          saved.aiAccessRunnerName || "a Runner"
        }. Unbinding stops OneUptime AI from running kubectl on this cluster until a Runner is bound again. Choosing a Runner needs ${
          canConfigureUnattended
            ? `permission to read Runners (one of: ${getKubernetesRunnerPermissionTitles().join(", ")})`
            : `one of these permissions: ${getKubernetesAiAccessAdminPermissionTitles().join(", ")}`
        }.`,
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        dataTestId: "ai-access-clear-runner-field",
      });
    }

    if (offered.credential) {
      result.push({
        field: { aiAccessCredentialId: true },
        title: "Kubernetes credential",
        description: getKubernetesAiCredentialFieldDescription(chosenRunner),
        fieldType: FormFieldSchemaType.Dropdown,
        required: false,
        placeholder: "None (in-cluster Runner)",
        dataTestId: "ai-access-credential-field",
        dropdownOptions: buildKubernetesAiCredentialOptions({
          credentials,
          boundCredentialId: saved.aiAccessCredentialId,
          boundCredentialName: saved.aiAccessCredentialName,
          runner: chosenRunner,
        }),
      });
    } else if (offered.credentialClear) {
      result.push({
        field: { clearAiAccessCredential: true },
        title: "Unbind the Kubernetes credential",
        description: `Bound now: ${
          saved.aiAccessCredentialName || "a Kubernetes credential"
        }. Unbinding it leaves an in-cluster Runner working as before; a Runner outside the cluster cannot reach it without one. Choosing a credential needs ${
          canConfigureUnattended
            ? `permission to read Runner credentials (one of: ${getKubernetesCredentialPermissionTitles().join(", ")})`
            : `one of these permissions: ${getKubernetesAiAccessAdminPermissionTitles().join(", ")}`
        }.`,
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        dataTestId: "ai-access-clear-credential-field",
      });
    }

    return result;
  }, [saved, offered, runnerOptions, credentials, chosenRunner]);

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
    if (!saved || !offered || isSavingRef.current) {
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
      const loosening: Array<string> = getKubernetesAiAccessLooseningChanges({
        saved,
        changes,
      });
      if (loosening.length > 0) {
        setSaveError(
          `${capitalizeFirst(loosening.join(", "))} needs one of these permissions: ${getKubernetesAiAccessAdminPermissionTitles().join(", ")}.`,
        );
        return;
      }
    }

    const bindingError: string | null = getKubernetesAiAccessBindingError({
      saved,
      changes,
      runners: runnerDirectory,
      credentials: credentialDirectory,
    });

    if (bindingError) {
      setSaveError(bindingError);
      return;
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
          The Runner picker is not shown: choosing a Runner needs permission to
          read Runners (one of:{" "}
          {getKubernetesRunnerPermissionTitles().join(", ")}). The binding is
          left as it is unless you unbind it.
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
          The credential picker is not shown: choosing a credential needs
          permission to read Runner credentials (one of:{" "}
          {getKubernetesCredentialPermissionTitles().join(", ")}). The binding
          is left as it is unless you unbind it; the in-cluster Runner needs no
          credential.
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
          ) : isLoading || !saved || !offered ? (
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
              onChange={(
                values: FormValues<KubernetesAiAccessSettingsFormValues>,
              ) => {
                const runnerId: string | null =
                  getKubernetesAiAccessChosenRunnerId({
                    saved,
                    values,
                    offered,
                  });
                setChosenRunnerId((previous: string | null): string | null => {
                  return previous === runnerId ? previous : runnerId;
                });
              }}
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
  const connectCardMode: AiAccessConnectCardMode =
    getAiAccessConnectCardMode(status);
  const agentRunnerNotSelectedGap: KubernetesAiAccessGap | undefined =
    connectCardMode === "select_agent_runner"
      ? status.gaps.find((gap: KubernetesAiAccessGap): boolean => {
          return gap.code === "no_runner_bound";
        })
      : undefined;
  const runnerWriteAccess: string | null = describeRunnerWriteAccess(
    status.runner?.posture,
  );
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
                    {runnerWriteAccess ? (
                      <span data-testid="ai-access-runner-write-access">
                        {` · ${runnerWriteAccess}`}
                      </span>
                    ) : (
                      <></>
                    )}
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
                  ? " and apply every fix the policy allows on its own, riskier ones included — only a write in a protected namespace, a node drain or taint, or a run past the hourly circuit breaker still asks a human."
                  : status.remediationMode ===
                      KubernetesAiRemediationMode.Automatic
                    ? allowlistInEffect.length > 0
                      ? " and apply safe fixes on its own — plus riskier ones that match the kubectl allowlist. Any other riskier fix is proposed for your one-click approval."
                      : " and apply safe fixes on its own. A riskier fix is proposed for your one-click approval."
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

      {connectCardMode === "select_agent_runner" &&
      agentRunnerNotSelectedGap ? (
        /*
         * This cluster's in-cluster Runner is registered but no Runner is
         * bound: re-running helm would change nothing, so the helm card is
         * not shown — selecting the Runner is the step.
         */
        <Card
          title="Select this cluster's in-cluster Runner"
          description="The in-cluster Runner is already installed on this cluster. No helm change is needed: select it as this cluster's Runner."
        >
          <div
            className="space-y-2"
            data-testid="ai-access-select-agent-runner"
          >
            <p className="text-sm text-gray-900">
              {agentRunnerNotSelectedGap.nextStep}
            </p>
            <p className="text-xs leading-5 text-gray-500">
              {canConfigureUnattended && canPickRunner
                ? "Open Edit AI access below and choose it as the Runner."
                : `Choosing a Runner needs one of these permissions: ${getKubernetesAiAccessAdminPermissionTitles().join(
                    ", ",
                  )}, and permission to read Runners (one of: ${getKubernetesRunnerPermissionTitles().join(
                    ", ",
                  )}).`}
            </p>
          </div>
        </Card>
      ) : connectCardMode === "connect" ? (
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
                under another name or namespace, use yours. It runs{" "}
                <code>helm repo update</code> first: an older cached chart does
                not know aiAccess and fails with &quot;Additional property
                aiAccess is not allowed&quot;. The Runner reuses the
                agent&apos;s ingestion key and cluster name, so within a minute
                this page shows it as Connected. Your OneUptime URL is{" "}
                {oneuptimeUrl}.
              </p>
            </div>
            <p className="text-xs leading-5 text-gray-500">
              Prefer an existing Runner? Bind it below together with a
              Kubernetes credential (API server URL + ServiceAccount token from
              Project Settings → Runner Credentials) assigned to that Runner,
              and make sure &quot;Runs AI Remediation Commands&quot; is on for
              it.
            </p>
          </div>
        </Card>
      ) : (
        <></>
      )}

      {/*
       * Write access for the in-cluster Runner. Always here — not only
       * before a Runner connects — because the recommended first step is
       * read-only, and the step after it must still be on the page once
       * that Runner is bound.
       */}
      <Card
        title="Let AI apply fixes (write access)"
        description="Optional. The in-cluster Runner starts read-only; one more helm upgrade grants the write access OneUptime AI's fixes use. The AI remediation mode below still decides whether a fix waits for a human."
      >
        <div className="space-y-4" data-testid="ai-access-remediation-setup">
          <p className="text-xs leading-5 text-gray-600">
            {status.runner && !status.runner.posture?.inCluster
              ? `OneUptime AI reaches this cluster through Runner "${status.runner.name}"${
                  status.credentialName
                    ? ` and its Kubernetes credential "${status.credentialName}"`
                    : ""
                }: what a fix may change there is bounded by that credential's RBAC, not by these commands, which apply to the Kubernetes agent's in-cluster Runner.`
              : runnerWriteAccess === "read-only RBAC"
                ? "The in-cluster Runner has read-only RBAC, so the cluster would refuse every kubectl change. Grant write access with one of these commands."
                : runnerWriteAccess
                  ? `The in-cluster Runner reports: ${runnerWriteAccess}. Run one of these commands again to change where it may write.`
                  : "Run one of these instead of the read-only command, or after it — each is a complete command."}
          </p>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Recommended: write access only where AI may fix
            </p>
            <div data-testid="ai-access-helm-remediation-scoped-command">
              <CodeBlock
                language="bash"
                code={helmCommands.enableRemediationScoped}
              />
            </div>
            <p className="mt-2 text-xs leading-5 text-gray-500">
              Replace {AI_ACCESS_EXAMPLE_WRITE_NAMESPACES} with the namespaces
              AI may fix: the chart binds the write role in those alone
              (aiAccess.remediation.namespaces), and the Runner refuses a write
              anywhere else. aiAccess.remediation.nodeOperations=false keeps
              fixes off nodes — leave that line out to let AI cordon, uncordon,
              drain and taint nodes (a drain or taint still waits for a human).
            </p>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Or: write access across the cluster
            </p>
            <div data-testid="ai-access-helm-remediation-command">
              <CodeBlock
                language="bash"
                code={helmCommands.enableRemediation}
              />
            </div>
          </div>
          <p
            className="text-xs leading-5 text-gray-700"
            data-testid="ai-access-write-disclosure"
          >
            {getAiAccessWriteDisclosure()}
          </p>
          <p className="text-xs leading-5 text-gray-500">
            If this is the cluster&apos;s first registration, remediation starts
            in Ask for approval, so nothing changes without a human until you
            choose otherwise below. A cluster that was already registered keeps
            its remediation mode: choose it with Edit AI access after the
            upgrade.
          </p>
        </div>
      </Card>

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
                        itself, and a bound Runner can be unbound in Edit AI
                        access.
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
                        needs no credential, and a bound credential can be
                        unbound in Edit AI access.
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
