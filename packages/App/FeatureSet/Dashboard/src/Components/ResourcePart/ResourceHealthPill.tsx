import React, { FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { getResourceHealthLabel } from "../TelemetryResource/ResourceHeroStatus";
import { ResourceAttentionItem, ResourceHealth } from "./ResourceAttention";
import ResourceAttentionPill, {
  RESOURCE_ATTENTION_PILL_TONE_CLASS_NAMES,
} from "./ResourceAttentionPill";
import { ResourcePartTone } from "./ResourcePartTypes";

/*
 * A RESOURCE'S HEALTH BESIDE ITS NAME, AND WHY.
 *
 * Healthy, Degraded or Unhealthy is worked out from what needs attention on
 * the resource (ResourceAttention): Unhealthy when something is broken,
 * Degraded when something needs a look. The pill said the word and nothing
 * else - "Degraded" beside a cluster's name, with the reasons a card further
 * down (#9537). Now a Degraded or Unhealthy pill opens those reasons where
 * the question is asked (ResourceAttentionPill): the same parts the Needs
 * attention card lists, the most urgent first, each a step from its page.
 *
 * Healthy, and Health Unknown while the agent is not connected (its last
 * inventory is no longer the truth), stay plain pills: nothing to explain.
 * Every hero that says its resource's health draws it here, so they look
 * and behave alike.
 */

// The dialog's words when the resource is Degraded or Unhealthy.
export interface ResourceHealthDialogWords {
  // Whole sentences in English, looked up where drawn.
  degradedTitle: string;
  unhealthyTitle: string;
}

export const RESOURCE_HEALTH_DEGRADED_DESCRIPTION: string = translationKey(
  "Nothing is broken, but these need a look soon. The most urgent come first.",
);

export const RESOURCE_HEALTH_UNHEALTHY_DESCRIPTION: string = translationKey(
  "Something is broken. These need attention, the most urgent first.",
);

export const RESOURCE_HEALTH_EMPTY_MESSAGE: string = translationKey(
  "Nothing needs attention now.",
);

export const RESOURCE_HEALTH_HINT: string = translationKey("Show why");

const HEALTH_TONES: Record<ResourceHealth, ResourcePartTone> = {
  Healthy: "positive",
  Degraded: "warning",
  Unhealthy: "danger",
};

export interface ComponentProps {
  health: ResourceHealth;
  // While the agent is not connected the pill says Health Unknown.
  isConnected: boolean;
  // What needs attention: what the health was worked out from.
  items: Array<ResourceAttentionItem>;
  testId: string;
  words: ResourceHealthDialogWords;
  // False when every row is the same kind of part.
  showKind?: boolean | undefined;
}

const ResourceHealthPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const label: string = getResourceHealthLabel({
    translator: translator,
    health: props.health,
    isConnected: props.isConnected,
  });
  const tone: ResourcePartTone = props.isConnected
    ? HEALTH_TONES[props.health] || "danger"
    : "neutral";
  const dataHealth: string = props.isConnected ? props.health : "Unknown";

  const isExplained: boolean =
    props.isConnected &&
    props.health !== "Healthy" &&
    props.items.length > 0;

  if (isExplained) {
    const isUnhealthy: boolean = props.health === "Unhealthy";
    const title: string = isUnhealthy
      ? props.words.unhealthyTitle
      : props.words.degradedTitle;
    return (
      <ResourceAttentionPill
        label={label}
        tone={tone}
        testId={props.testId}
        hint={RESOURCE_HEALTH_HINT}
        dataAttributes={{ "data-health": dataHealth }}
        dialog={{
          title: translator.translateText(title) || title,
          description: isUnhealthy
            ? RESOURCE_HEALTH_UNHEALTHY_DESCRIPTION
            : RESOURCE_HEALTH_DEGRADED_DESCRIPTION,
          items: props.items,
          emptyMessage: RESOURCE_HEALTH_EMPTY_MESSAGE,
          showKind: props.showKind,
        }}
      />
    );
  }

  const classNames: { badge: string; dot: string } =
    RESOURCE_ATTENTION_PILL_TONE_CLASS_NAMES[tone];

  return (
    <span
      data-testid={props.testId}
      data-health={dataHealth}
      data-tone={tone}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${classNames.badge}`}
    >
      <span
        className={`h-1.5 w-1.5 flex-none rounded-full ${classNames.dot}`}
        aria-hidden="true"
      />
      {label}
    </span>
  );
};

export default ResourceHealthPill;
