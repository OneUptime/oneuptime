import React, { FunctionComponent, ReactElement } from "react";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { ResourceHealth } from "../ResourcePart/ResourceAttention";
import { getResourceHealthLabel } from "../TelemetryResource/ResourceHeroStatus";
import { CONTAINER_HOST_METRIC_DESCRIPTIONS } from "../MetricDescriptions/ContainerHostMetricDescriptions";

/*
 * A Docker or Podman host's health beside its connection pill: Healthy,
 * Degraded or Unhealthy by its containers' latest readings
 * (ContainerHostHealth), with an (i) that says the rules. While the agent is
 * not connected the readings are stale, so it says Health Unknown in grey,
 * as every resource hero does.
 */

export const CONTAINER_HOST_HEALTH_TEST_ID: string = "container-host-health";

const HEALTH_CLASS_NAMES: Record<
  ResourceHealth,
  { badge: string; dot: string }
> = {
  Healthy: {
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  Degraded: {
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  Unhealthy: {
    badge: "bg-red-50 text-red-700 ring-red-200",
    dot: "bg-red-500",
  },
};

const UNKNOWN_CLASS_NAMES: { badge: string; dot: string } = {
  badge: "bg-gray-50 text-gray-600 ring-gray-200",
  dot: "bg-gray-400",
};

export interface ComponentProps {
  health: ResourceHealth;
  isConnected: boolean;
}

const ContainerHostHealthPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const classNames: { badge: string; dot: string } = props.isConnected
    ? HEALTH_CLASS_NAMES[props.health]
    : UNKNOWN_CLASS_NAMES;

  return (
    <span className="inline-flex items-center gap-1">
      <span
        data-testid={CONTAINER_HOST_HEALTH_TEST_ID}
        data-health={props.isConnected ? props.health : "Unknown"}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${classNames.badge}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${classNames.dot}`} />
        {getResourceHealthLabel({
          translator: translator,
          health: props.health,
          isConnected: props.isConnected,
        })}
      </span>
      <InfoTooltip
        label="Host health"
        text={CONTAINER_HOST_METRIC_DESCRIPTIONS.hostHealth}
      />
    </span>
  );
};

export default ContainerHostHealthPill;
