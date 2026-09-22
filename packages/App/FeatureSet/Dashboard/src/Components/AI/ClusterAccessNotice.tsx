import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
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
 *  - What the run DID comes from the run's own events (clusterCommandCount),
 *    so a finished run reports its kubectl usage in the past tense.
 *  - What the clusters allow NOW comes from clusterAccess, which the API
 *    computes from current configuration at request time. It is always
 *    phrased in the present tense: access switched on or off after a run
 *    finished must not rewrite what that run had.
 */

export interface ComponentProps {
  clusterAccess: Array<KubernetesClusterAiAccessStatus>;
  // True once the run has finished (completed or failed); false while it runs.
  isRunFinished: boolean;
  /*
   * kubectl commands the run actually made, counted from its events. Only
   * read for a finished run. Undefined when the caller cannot tell, in
   * which case the notice describes the current configuration and makes
   * no claim about what the run did.
   */
  clusterCommandCount?: number | undefined;
}

export const DATA_ONLY_RUN_TEXT: string =
  "This investigation used OneUptime data only — no kubectl commands were run.";

/*
 * The past-tense sentence for a finished run, or null when the run's own
 * kubectl usage is unknown (older API replicas, or a run whose events have
 * not been loaded) — never guessed from the current configuration.
 */
export function describeFinishedRunKubectlUsage(
  clusterCommandCount: number | undefined,
): string | null {
  if (typeof clusterCommandCount !== "number") {
    return null;
  }

  const count: number = Math.max(0, Math.floor(clusterCommandCount));

  if (count === 0) {
    return DATA_ONLY_RUN_TEXT;
  }

  return `OneUptime AI ran ${count.toLocaleString()} read-only kubectl ${
    count === 1 ? "command" : "commands"
  } during this investigation.`;
}

const KNOWN_MODES: Array<string> = Object.values(KubernetesAiRemediationMode);

// Older API replicas omit the field; malformed rows are dropped, never trusted.
export function parseClusterAccess(
  value: unknown,
): Array<KubernetesClusterAiAccessStatus> {
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
  }) as Array<KubernetesClusterAiAccessStatus>;
}

function getClusterAiPageRoute(clusterId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI] as Route,
    { modelId: new ObjectID(clusterId) },
  );
}

function describeRemediation(status: KubernetesClusterAiAccessStatus): string {
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

  const unreachable: Array<KubernetesClusterAiAccessStatus> =
    props.clusterAccess.filter((status: KubernetesClusterAiAccessStatus) => {
      return !status.isInvestigationReady;
    });
  const reachable: Array<KubernetesClusterAiAccessStatus> =
    props.clusterAccess.filter((status: KubernetesClusterAiAccessStatus) => {
      return status.isInvestigationReady;
    });

  const finishedRunUsage: string | null = props.isRunFinished
    ? describeFinishedRunKubectlUsage(props.clusterCommandCount)
    : null;
  const didRunKubectl: boolean =
    finishedRunUsage !== null && finishedRunUsage !== DATA_ONLY_RUN_TEXT;

  return (
    <div className="space-y-2" data-testid="cluster-access-notice">
      {finishedRunUsage ? (
        <div
          data-testid="cluster-access-run-usage"
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
            didRunKubectl
              ? "border-emerald-200 bg-emerald-50/70"
              : "border-gray-200 bg-gray-50"
          }`}
        >
          <Icon
            icon={didRunKubectl ? IconProp.ShieldCheck : IconProp.Info}
            className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
              didRunKubectl ? "text-emerald-600" : "text-gray-500"
            }`}
          />
          <p
            className={`text-xs leading-5 ${
              didRunKubectl ? "text-emerald-900" : "text-gray-700"
            }`}
          >
            {finishedRunUsage}
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
            {reachable.map(
              (status: KubernetesClusterAiAccessStatus, index: number) => {
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
              },
            )}
            .
          </p>
        </div>
      ) : (
        <></>
      )}

      {unreachable.map((status: KubernetesClusterAiAccessStatus) => {
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
