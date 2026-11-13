import React, { FunctionComponent, ReactElement, useState } from "react";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import StackedProgressBar, {
  type StackedProgressBarSegment,
} from "Common/UI/Components/StackedProgressBar/StackedProgressBar";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import OneUptimeDate from "Common/Types/Date";
import {
  OpenShiftClusterOperatorState,
  OpenShiftClusterVersionState,
  OpenShiftConditionStatus,
} from "Common/Types/Kubernetes/OpenShiftObjectParser";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  OpenShiftClusterHealth,
  OpenShiftOperatorHealth,
} from "../../Pages/Kubernetes/Utils/KubernetesOpenShiftHealth";

/*
 * THE OPENSHIFT CARD ON A CLUSTER'S OVERVIEW.
 *
 * Three things, in one row, so a healthy cluster's overview grows by no more
 * than that: the version it runs, whether an update is running or failing,
 * and how many of its operators are healthy. Under them, only the operators
 * an admin should look at, each with its three conditions and what it says;
 * every operator is one press away. It draws nothing for a cluster with no
 * ClusterOperators.
 */

const OPERATOR_BADGES: Record<OpenShiftClusterOperatorState, StatusBadgeType> =
  {
    [OpenShiftClusterOperatorState.Available]: StatusBadgeType.Success,
    [OpenShiftClusterOperatorState.Progressing]: StatusBadgeType.Info,
    [OpenShiftClusterOperatorState.Degraded]: StatusBadgeType.Warning,
    [OpenShiftClusterOperatorState.Unavailable]: StatusBadgeType.Danger,
    [OpenShiftClusterOperatorState.Unknown]: StatusBadgeType.Neutral,
  };

const UPDATE_BADGES: Record<OpenShiftClusterVersionState, StatusBadgeType> = {
  [OpenShiftClusterVersionState.Available]: StatusBadgeType.Success,
  [OpenShiftClusterVersionState.Updating]: StatusBadgeType.Info,
  [OpenShiftClusterVersionState.Failing]: StatusBadgeType.Danger,
  [OpenShiftClusterVersionState.Unknown]: StatusBadgeType.Neutral,
};

export interface ComponentProps {
  health: OpenShiftClusterHealth;
}

interface ConditionProps {
  title: string;
  status: string;
  // The status that is good news for this condition.
  healthyStatus: OpenShiftConditionStatus;
}

// A condition and its status, coloured by whether that is good news.
const OperatorCondition: FunctionComponent<ConditionProps> = (
  props: ConditionProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const statusClass: string = !props.status
    ? "text-gray-400"
    : props.status === props.healthyStatus
      ? "text-gray-600"
      : "font-medium text-amber-700";

  return (
    <span className="whitespace-nowrap text-xs">
      <span className="text-gray-500">
        {translator.translateText(props.title)}
      </span>{" "}
      <span className={statusClass}>{props.status || "—"}</span>
    </span>
  );
};

const OperatorRow: FunctionComponent<{
  operator: OpenShiftOperatorHealth;
}> = (props: { operator: OpenShiftOperatorHealth }): ReactElement => {
  const operator: OpenShiftOperatorHealth = props.operator;

  return (
    <li data-testid="openshift-operator" className="py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 break-all font-medium text-gray-900">
          {operator.name}
        </span>
        <StatusBadge
          text={operator.state}
          type={OPERATOR_BADGES[operator.state]}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:ml-auto">
          <OperatorCondition
            title="Available"
            status={operator.available}
            healthyStatus={OpenShiftConditionStatus.True}
          />
          <OperatorCondition
            title="Progressing"
            status={operator.progressing}
            healthyStatus={OpenShiftConditionStatus.False}
          />
          <OperatorCondition
            title="Degraded"
            status={operator.degraded}
            healthyStatus={OpenShiftConditionStatus.False}
          />
          {operator.version && (
            <span dir="ltr" className="font-mono text-xs text-gray-500">
              {operator.version}
            </span>
          )}
        </div>
      </div>
      {(operator.reason || operator.message) && (
        <p className="mt-1 break-words text-sm text-gray-600">
          {operator.reason && (
            <span className="font-medium text-gray-700">
              {operator.reason}
              {operator.message ? ": " : ""}
            </span>
          )}
          {operator.message}
        </p>
      )}
    </li>
  );
};

const OpenShiftHealthCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isShowingAll, setIsShowingAll] = useState<boolean>(false);

  const health: OpenShiftClusterHealth = props.health;
  const operators: Array<OpenShiftOperatorHealth> = isShowingAll
    ? health.operators
    : health.operatorsToReview;

  const segments: Array<StackedProgressBarSegment> = [
    {
      value: health.counts.available,
      color: "bg-emerald-500",
      label: "Available",
    },
    {
      value: health.counts.progressing,
      color: "bg-blue-500",
      label: "Progressing",
    },
    {
      value: health.counts.degraded,
      color: "bg-amber-500",
      label: "Degraded",
    },
    {
      value: health.counts.unavailable,
      color: "bg-red-500",
      label: "Unavailable",
    },
  ];

  const renderUpdateLine: () => string = (): string => {
    if (health.updateState === OpenShiftClusterVersionState.Updating) {
      return health.desiredVersion
        ? translator.translateTemplate("Moving to {{version}}", {
            version: health.desiredVersion,
          })
        : "";
    }

    if (health.updateState === OpenShiftClusterVersionState.Failing) {
      return "";
    }

    if (health.availableUpdateCount > 0) {
      return translator.translatePlural(
        {
          one: "{{count}} update available",
          other: "{{count}} updates available",
        },
        health.availableUpdateCount,
      );
    }

    return translator.translateText("No update running") || "";
  };

  return (
    <div className="mb-6" data-testid="openshift-health-card">
      <Card
        title="OpenShift"
        description="The version this cluster runs, and what its cluster operators report."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div data-testid="openshift-version">
            <div className="text-sm text-gray-500">
              {translator.translateText("Version")}
            </div>
            <div
              dir="ltr"
              className="mt-1 text-start text-lg font-semibold text-gray-900"
            >
              {health.version || translator.translateText("Not reported") || ""}
            </div>
            {health.channel && (
              <div dir="ltr" className="text-start text-xs text-gray-500">
                {health.channel}
              </div>
            )}
          </div>
          <div data-testid="openshift-update">
            <div className="text-sm text-gray-500">
              {translator.translateText("Cluster update")}
            </div>
            <div className="mt-1">
              <StatusBadge
                text={health.updateState}
                type={UPDATE_BADGES[health.updateState]}
              />
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {renderUpdateLine()}
              {health.updateStartedAt
                ? ` · ${translator.translateTemplate("Started {{time}}", {
                    time: OneUptimeDate.fromNow(
                      new Date(health.updateStartedAt),
                    ),
                  })}`
                : ""}
            </div>
          </div>
          <div data-testid="openshift-operators">
            <div className="text-sm text-gray-500">
              {translator.translateText("Operators")}
            </div>
            <div className="mt-1 text-lg font-semibold text-gray-900">
              {translator.translateTemplate(
                "{{healthy}} of {{total}} healthy",
                {
                  healthy: translator.formatNumber(health.counts.healthy),
                  total: translator.formatNumber(health.counts.total),
                },
              )}
            </div>
            <div className="mt-2">
              <StackedProgressBar
                segments={segments}
                totalValue={health.counts.total}
              />
            </div>
          </div>
        </div>

        {health.updateReason || health.updateMessage ? (
          <p
            data-testid="openshift-update-message"
            className="mt-3 break-words rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700"
          >
            {health.updateReason && (
              <span className="font-medium">
                {health.updateReason}
                {health.updateMessage ? ": " : ""}
              </span>
            )}
            {health.updateMessage}
          </p>
        ) : (
          <></>
        )}

        {operators.length > 0 ? (
          <ul className="mt-3 divide-y divide-gray-100 border-t border-gray-100">
            {operators.map(
              (operator: OpenShiftOperatorHealth): ReactElement => {
                return <OperatorRow key={operator.name} operator={operator} />;
              },
            )}
          </ul>
        ) : (
          <></>
        )}

        {health.operators.length > health.operatorsToReview.length ? (
          <div className="mt-2">
            <Button
              title={
                isShowingAll
                  ? translator.translateText("Show only those to review")
                  : translator.translateTemplate(
                      "Show all {{count}} operators",
                      { count: health.counts.total },
                    )
              }
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={() => {
                setIsShowingAll(!isShowingAll);
              }}
            />
          </div>
        ) : (
          <></>
        )}
      </Card>
    </div>
  );
};

export default OpenShiftHealthCard;
