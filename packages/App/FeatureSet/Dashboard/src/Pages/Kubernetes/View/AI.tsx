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
import { Gray500, Green500, Red500, Yellow500 } from "Common/Types/BrandColors";
import {
  KubernetesAiAccessGap,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
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
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
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
 * Whether the signed-in user may pick a Kubernetes credential for an
 * out-of-cluster Runner. The picker lists RunbookCredential rows, and a
 * ModelForm loads every dropdown's options when the edit modal opens — so a
 * user who may edit the cluster (ProjectMember, EditKubernetesCluster) but
 * may not read credentials would get a permissions error across the whole
 * modal instead of a form. Such a user still edits everything else; the
 * in-cluster Runner needs no credential at all.
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
      setTestError(API.getFriendlyMessage(err));
    }
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

  const helmCommand: string = `helm upgrade oneuptime-agent oneuptime/kubernetes-agent \\
  --namespace oneuptime-kubernetes-agent --reuse-values \\
  --set aiAccess.enabled=true \\
  --set aiAccess.remediation.enabled=true`;

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
                    ? " and apply safe fixes on its own."
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
              <CodeBlock language="bash" code={helmCommand} />
              <p className="mt-2 text-xs leading-5 text-gray-500">
                Use the release name and namespace you installed the agent with.
                Drop the last line to give AI read-only access only. The Runner
                reuses the agent&apos;s ingestion key and cluster name, so
                within a minute this page shows it as Connected. Your OneUptime
                URL is {oneuptimeUrl}.
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
          description:
            "What OneUptime AI may do on this cluster, and how it reaches it. Changes apply to the next incident or alert.",
        }}
        isEditable={true}
        editButtonText="Edit AI access"
        refresher={refresher}
        onSaveSuccess={() => {
          setRefresher((value: boolean) => {
            return !value;
          });
        }}
        formFields={[
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
              "Ask for approval: AI composes the exact kubectl plan and a human approves it with one click. Automatic: safe changes (rollout restart/undo, scale, delete a named pod, cordon/uncordon, label/annotate) run on their own; a riskier change is never run without a human — AI leaves the exact command in its recommendations and only a follow-up round proposes it for approval — unless the allowlist below names its shape. Bypass approval: every allowed change, riskier ones included, runs on its own and nobody is ever asked. Destructive commands (deleting namespaces, volumes, nodes, secrets, CRDs; exec; apply) never run in any mode.",
            fieldType: FormFieldSchemaType.Dropdown,
            required: false,
            dropdownOptions: [
              {
                value: KubernetesAiRemediationMode.Disabled,
                label:
                  REMEDIATION_MODE_LABELS[KubernetesAiRemediationMode.Disabled],
              },
              {
                value: KubernetesAiRemediationMode.RequireApproval,
                label:
                  REMEDIATION_MODE_LABELS[
                    KubernetesAiRemediationMode.RequireApproval
                  ],
              },
              {
                value: KubernetesAiRemediationMode.Automatic,
                label:
                  REMEDIATION_MODE_LABELS[
                    KubernetesAiRemediationMode.Automatic
                  ],
              },
              {
                value: KubernetesAiRemediationMode.BypassApproval,
                label:
                  REMEDIATION_MODE_LABELS[
                    KubernetesAiRemediationMode.BypassApproval
                  ],
              },
            ],
          },
          {
            field: { aiKubectlCommandAllowlist: true },
            title: "kubectl allowlist (Automatic mode)",
            description:
              'Optional. Riskier kubectl commands matching one of these patterns (with * wildcards) also run without approval in Automatic mode, e.g. "kubectl set image deployment/web * -n web". Not needed in Bypass approval mode, where every allowed command already runs on its own. Destructive commands never run regardless.',
            fieldType: FormFieldSchemaType.JSON,
            required: false,
            placeholder: '["kubectl set image deployment/web * -n web"]',
          },
          {
            field: { aiAccessRunner: true },
            title: "Runner",
            description:
              "The Runner OneUptime AI uses to run kubectl on this cluster. The in-cluster Runner installed by the agent chart binds itself here automatically.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: Runner,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select a Runner",
          },
          /*
           * The credential picker lists RunbookCredential rows, which not
           * every user who may edit the cluster may read. Leaving the field
           * out (rather than hiding it) means the form never requests those
           * rows, so the modal opens cleanly and the bound credential is
           * left untouched on save.
           */
          ...(canPickCredential
            ? [
                {
                  field: { aiAccessCredential: true },
                  title: "Kubernetes credential",
                  description:
                    "Only for a Runner outside the cluster: a Kubernetes credential assigned to that Runner. Leave empty for the in-cluster Runner.",
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownModal: {
                    type: RunbookCredential,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "None (in-cluster Runner)",
                },
              ]
            : []),
        ]}
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
              fieldType: FieldType.JSON,
              placeholder: "None",
            },
            {
              field: { aiAccessRunner: { name: true } },
              title: "Runner",
              fieldType: FieldType.Element,
              getElement: (item: KubernetesCluster): ReactElement => {
                return (
                  <span>{item.aiAccessRunner?.name || "No Runner bound"}</span>
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

      <Card
        title="Test access"
        description="Runs kubectl version and kubectl auth can-i --list through the bound Runner, so you can see the access work — and exactly what the Runner is allowed to do — before an incident does. Read-only."
        buttons={[
          <Button
            key="test"
            title="Run access test"
            icon={IconProp.Play}
            buttonStyle={ButtonStyleType.PRIMARY}
            buttonSize={ButtonSize.Normal}
            isLoading={isTesting}
            disabled={isTesting || !hasRunner}
            onClick={() => {
              runTest().catch(() => {
                // handled inside runTest
              });
            }}
          />,
        ]}
      >
        <div className="space-y-3">
          {!hasRunner ? (
            <p className="text-sm text-gray-500">
              Bind a Runner first — there is nothing to test yet.
            </p>
          ) : (
            <></>
          )}
          {testError ? (
            <Alert
              type={AlertType.DANGER}
              strongTitle="The test could not run"
              title={testError}
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
                label: KUBECTL_JOB_ORIGIN_LABELS[RunnerJobOrigin.AiRemediation],
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
    </Fragment>
  );
};

export default KubernetesClusterAI;
