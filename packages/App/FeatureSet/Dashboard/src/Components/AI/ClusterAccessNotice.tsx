import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import type { KubectlActivitySummary } from "../AIChat/ChatActivityFeed";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  KubernetesAiAccessGap,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Tells the reader of an investigation, in one glance, whether OneUptime AI
 * can reach the clusters this signal is about — and, when it cannot,
 * exactly why and where to fix it. Deterministic server data, never the
 * model's prose, so it reads the same on every panel and is right even
 * when the report forgot to mention it.
 *
 * Two different facts live here and are never mixed up:
 *
 *  - What the run DID comes from the run's own events (kubectlActivity),
 *    so a finished run reports its kubectl usage in the past tense — and
 *    only commands that actually ran on the cluster count as run.
 *  - What the clusters allow NOW comes from clusterAccess, which the API
 *    computes from current configuration at request time. It is always
 *    phrased in the present tense: access switched on or off after a run
 *    finished must not rewrite what that run had.
 */

/*
 * One cluster's row as the panel receives it. Every reader of the signal
 * gets these fields; the Runner, credential, allowlist and last error only
 * reach a viewer who can read the cluster itself, and the notice never
 * needs them.
 */
export type ClusterAccessNoticeRow = Pick<
  KubernetesClusterAiAccessStatus,
  | "clusterId"
  | "clusterName"
  | "isInvestigationReady"
  | "isRemediationReady"
  | "remediationMode"
  | "gaps"
> &
  Partial<KubernetesClusterAiAccessStatus>;

export interface ComponentProps {
  clusterAccess: Array<ClusterAccessNoticeRow>;
  // True once the run has finished (completed or failed); false while it runs.
  isRunFinished: boolean;
  /*
   * What the run's kubectl calls did, from its events. Only read for a
   * finished run. Undefined when the caller cannot tell, in which case the
   * notice describes the current configuration and makes no claim about
   * what the run did.
   */
  kubectlActivity?: KubectlActivitySummary | undefined;
}

export const DATA_ONLY_RUN_TEXT: string =
  "This investigation used OneUptime data only — no kubectl commands were run.";

/*
 * How the sentence is presented:
 *  - "ran": at least one kubectl command completed on the cluster — the
 *    notice's "had access" styling;
 *  - "failed": kubectl was tried but nothing completed — a run whose every
 *    command failed or never ran must not look like one that inspected the
 *    cluster;
 *  - "none": the run never tried kubectl.
 */
export type FinishedRunKubectlUsageTone = "ran" | "failed" | "none";

export interface FinishedRunKubectlUsage {
  text: string;
  tone: FinishedRunKubectlUsageTone;
}

function pluralizeCommands(count: number): string {
  return `${count.toLocaleString()} read-only kubectl ${
    count === 1 ? "command" : "commands"
  }`;
}

function toCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

/*
 * The past-tense sentence for a finished run, or null when the run's own
 * kubectl usage is unknown (older API replicas, or a run whose events have
 * not been loaded) — never guessed from the current configuration.
 *
 * "Ran" is only ever said of commands that reached kubectl. Commands that
 * returned an error, and commands that never ran (the cluster's Runner did
 * not pick them up, or they were refused), are named separately, so an
 * unreachable cluster is never reported as inspected.
 */
export function describeFinishedRunKubectlUsage(
  activity: KubectlActivitySummary | undefined,
): FinishedRunKubectlUsage | null {
  if (!activity) {
    return null;
  }

  const executed: number = toCount(activity.executed);
  const succeeded: number = Math.min(executed, toCount(activity.succeeded));
  const failed: number = executed - succeeded;
  const notRun: number = toCount(activity.notRun);

  if (executed === 0 && notRun === 0) {
    return { text: DATA_ONLY_RUN_TEXT, tone: "none" };
  }

  if (executed === 0) {
    return {
      text: `OneUptime AI tried ${pluralizeCommands(
        notRun,
      )}, but none ran on the cluster — the cluster's Runner did not pick ${
        notRun === 1 ? "it" : "them"
      } up, or ${
        notRun === 1 ? "it was" : "they were"
      } refused. This investigation used OneUptime data only; see Investigation activity for why.`,
      tone: "failed",
    };
  }

  if (succeeded === 0) {
    return {
      text: `OneUptime AI tried ${pluralizeCommands(
        executed + notRun,
      )}, but none succeeded — kubectl returned an error for ${
        executed === 1 ? "the one that ran" : `all ${executed} that ran`
      }${
        notRun > 0 ? ` and ${notRun.toLocaleString()} could not run` : ""
      }. See Investigation activity for each result.`,
      tone: "failed",
    };
  }

  const notes: Array<string> = [];

  if (failed > 0) {
    notes.push(`${failed.toLocaleString()} returned an error`);
  }

  if (notRun > 0) {
    notes.push(`${notRun.toLocaleString()} more could not run`);
  }

  return {
    text: `OneUptime AI ran ${pluralizeCommands(
      executed,
    )} during this investigation${
      notes.length > 0
        ? ` (${notes.join("; ")} — see Investigation activity)`
        : ""
    }.`,
    tone: "ran",
  };
}

const KNOWN_MODES: Array<string> = Object.values(KubernetesAiRemediationMode);

// Older API replicas omit the field; malformed rows are dropped, never trusted.
export function parseClusterAccess(
  value: unknown,
): Array<ClusterAccessNoticeRow> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item: unknown): boolean => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }
    const status: Partial<KubernetesClusterAiAccessStatus> =
      item as Partial<KubernetesClusterAiAccessStatus>;
    return (
      typeof status.clusterId === "string" &&
      ObjectID.isValidUUID(status.clusterId) &&
      typeof status.clusterName === "string" &&
      typeof status.isInvestigationReady === "boolean" &&
      typeof status.isRemediationReady === "boolean" &&
      KNOWN_MODES.includes(String(status.remediationMode)) &&
      Array.isArray(status.gaps)
    );
  }) as Array<ClusterAccessNoticeRow>;
}

/*
 * The part of the rows this notice renders, for a caller deciding whether
 * a poll changed anything. The API stamps every row with the time it was
 * evaluated and the Runner's latest heartbeat, so the raw rows differ on
 * every poll even when nothing a reader can see did. Gap text is kept in
 * full: one gap code has several descriptions.
 */
export function getClusterAccessSignature(
  rows: Array<ClusterAccessNoticeRow>,
): Array<unknown> {
  return rows.map((row: ClusterAccessNoticeRow): Array<unknown> => {
    return [
      row.clusterId,
      row.clusterName,
      row.isInvestigationReady,
      row.isRemediationReady,
      row.remediationMode,
      (row.gaps || []).map((gap: KubernetesAiAccessGap): Array<unknown> => {
        return [gap.code, gap.title, gap.description, gap.nextStep, gap.blocks];
      }),
    ];
  });
}

function getClusterAiPageRoute(clusterId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI] as Route,
    { modelId: new ObjectID(clusterId) },
  );
}

function describeRemediation(status: ClusterAccessNoticeRow): string {
  if (status.remediationMode === KubernetesAiRemediationMode.Disabled) {
    return "fixes are off";
  }
  if (!status.isRemediationReady) {
    return "fixes are not ready";
  }
  if (status.remediationMode === KubernetesAiRemediationMode.BypassApproval) {
    return "fixes run automatically, approvals bypassed";
  }
  return status.remediationMode === KubernetesAiRemediationMode.Automatic
    ? "safe fixes run automatically"
    : "fixes ask for your approval";
}

const ClusterAccessNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.clusterAccess.length === 0) {
    return <></>;
  }

  const unreachable: Array<ClusterAccessNoticeRow> = props.clusterAccess.filter(
    (status: ClusterAccessNoticeRow) => {
      return !status.isInvestigationReady;
    },
  );
  const reachable: Array<ClusterAccessNoticeRow> = props.clusterAccess.filter(
    (status: ClusterAccessNoticeRow) => {
      return status.isInvestigationReady;
    },
  );

  const finishedRunUsage: FinishedRunKubectlUsage | null = props.isRunFinished
    ? describeFinishedRunKubectlUsage(props.kubectlActivity)
    : null;
  const didInspectCluster: boolean = finishedRunUsage?.tone === "ran";
  // Tried kubectl but nothing came back: worth the reader's attention.
  const didKubectlFail: boolean = finishedRunUsage?.tone === "failed";

  return (
    <div className="space-y-2" data-testid="cluster-access-notice">
      {finishedRunUsage ? (
        <div
          data-testid="cluster-access-run-usage"
          data-tone={finishedRunUsage.tone}
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
            didInspectCluster
              ? "border-emerald-200 bg-emerald-50/70"
              : didKubectlFail
                ? "border-amber-200 bg-amber-50"
                : "border-gray-200 bg-gray-50"
          }`}
        >
          <Icon
            icon={
              didInspectCluster
                ? IconProp.ShieldCheck
                : didKubectlFail
                  ? IconProp.Alert
                  : IconProp.Info
            }
            className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
              didInspectCluster
                ? "text-emerald-600"
                : didKubectlFail
                  ? "text-amber-600"
                  : "text-gray-500"
            }`}
          />
          <p
            className={`text-xs leading-5 ${
              didInspectCluster
                ? "text-emerald-900"
                : didKubectlFail
                  ? "text-amber-900"
                  : "text-gray-700"
            }`}
          >
            {finishedRunUsage.text}
          </p>
        </div>
      ) : (
        <></>
      )}

      {reachable.length > 0 ? (
        <div
          data-testid="cluster-access-reachable"
          className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3"
        >
          <Icon
            icon={IconProp.ShieldCheck}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600"
          />
          <p className="text-xs leading-5 text-emerald-900">
            OneUptime AI {props.isRunFinished ? "currently has" : "has"}{" "}
            read-only kubectl access to{" "}
            {reachable.map((status: ClusterAccessNoticeRow, index: number) => {
              return (
                <span key={status.clusterId}>
                  {index > 0 ? ", " : ""}
                  <Link
                    to={getClusterAiPageRoute(status.clusterId)}
                    className="font-medium underline decoration-emerald-300 hover:text-emerald-950"
                  >
                    {status.clusterName}
                  </Link>{" "}
                  ({describeRemediation(status)})
                </span>
              );
            })}
            .
          </p>
        </div>
      ) : (
        <></>
      )}

      {unreachable.map((status: ClusterAccessNoticeRow) => {
        const blocking: Array<KubernetesAiAccessGap> = status.gaps.filter(
          (gap: KubernetesAiAccessGap) => {
            return gap.blocks === "investigation" || gap.blocks === "both";
          },
        );
        const first: KubernetesAiAccessGap | undefined = blocking[0];

        return (
          <div
            key={status.clusterId}
            data-testid="cluster-access-unreachable"
            className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
          >
            <Icon
              icon={IconProp.Alert}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-900">
                {props.isRunFinished
                  ? `OneUptime AI cannot currently reach cluster "${status.clusterName}" with kubectl`
                  : `Investigating with OneUptime data only — no kubectl access to cluster "${status.clusterName}"`}
              </p>
              {first ? (
                <p className="mt-1 text-xs leading-5 text-amber-800">
                  <span className="font-semibold">Why: </span>
                  {first.title}. {first.description}
                </p>
              ) : (
                <></>
              )}
              {first ? (
                <p className="mt-1 text-xs leading-5 text-amber-800">
                  <span className="font-semibold">What to do: </span>
                  {first.nextStep}
                  {blocking.length > 1
                    ? ` (${blocking.length - 1} more to fix on the cluster's AI page.)`
                    : ""}
                </p>
              ) : (
                <></>
              )}
              <Link
                to={getClusterAiPageRoute(status.clusterId)}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 hover:text-indigo-900"
              >
                <span>Give OneUptime AI access to this cluster</span>
                <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ClusterAccessNotice;
