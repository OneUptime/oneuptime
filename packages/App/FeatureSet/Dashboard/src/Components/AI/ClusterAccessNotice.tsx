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
 * could reach the clusters this signal is about — and, when it could not,
 * exactly why and where to fix it. Deterministic server data, never the
 * model's prose, so it reads the same on every panel and is right even
 * when the report forgot to mention it.
 */

export interface ComponentProps {
  clusterAccess: Array<KubernetesClusterAiAccessStatus>;
  // Past tense once the run has finished; present while it runs.
  isRunFinished: boolean;
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

  return (
    <div className="space-y-2" data-testid="cluster-access-notice">
      {reachable.length > 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
          <Icon
            icon={IconProp.ShieldCheck}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600"
          />
          <p className="text-xs leading-5 text-emerald-900">
            OneUptime AI {props.isRunFinished ? "had" : "has"} read-only kubectl
            access to{" "}
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
            className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
          >
            <Icon
              icon={IconProp.Alert}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-900">
                {props.isRunFinished
                  ? "Investigated with OneUptime data only"
                  : "Investigating with OneUptime data only"}{" "}
                — no kubectl access to cluster &quot;{status.clusterName}
                &quot;
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
