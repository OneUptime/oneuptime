import React, { FunctionComponent, ReactElement } from "react";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionItem,
  ResourceHealth,
} from "../ResourcePart/ResourceAttention";
import ResourceHealthPill, {
  ResourceHealthDialogWords,
} from "../ResourcePart/ResourceHealthPill";
import { CONTAINER_HOST_METRIC_DESCRIPTIONS } from "../MetricDescriptions/ContainerHostMetricDescriptions";

/*
 * A Docker or Podman host's health beside its connection pill: Healthy,
 * Degraded or Unhealthy by its containers' latest readings
 * (ContainerHostHealth), with an (i) that says the rules. While the agent is
 * not connected the readings are stale, so it says Health Unknown in grey,
 * as every resource hero does. Degraded or Unhealthy opens which containers
 * and why (ResourceHealthPill): the rows its Needs attention card lists.
 */

export const CONTAINER_HOST_HEALTH_TEST_ID: string = "container-host-health";

export const CONTAINER_HOST_HEALTH_WORDS: ResourceHealthDialogWords = {
  degradedTitle: translationKey("Why this host is Degraded"),
  unhealthyTitle: translationKey("Why this host is Unhealthy"),
};

export interface ComponentProps {
  health: ResourceHealth;
  isConnected: boolean;
  // What needs attention on the host: what its health was worked out from.
  items: Array<ResourceAttentionItem>;
}

const ContainerHostHealthPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <span className="inline-flex items-center gap-1">
      <ResourceHealthPill
        health={props.health}
        isConnected={props.isConnected}
        items={props.items}
        testId={CONTAINER_HOST_HEALTH_TEST_ID}
        words={CONTAINER_HOST_HEALTH_WORDS}
      />
      <InfoTooltip
        label="Host health"
        text={CONTAINER_HOST_METRIC_DESCRIPTIONS.hostHealth}
      />
    </span>
  );
};

export default ContainerHostHealthPill;
