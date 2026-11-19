import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { composedValue, Translator } from "Common/UI/Utils/TranslateTemplate";
import { formatRelativeTime } from "../Home/HomeRelativeTime";
import { withSentenceDigits } from "./SentenceDigits";
import {
  NEEDS_ATTENTION_DESCRIPTION,
  NEEDS_ATTENTION_TITLE,
} from "./NeedsAttentionCard";
import ResourceAttentionPill from "./ResourceAttentionPill";
import {
  RESOURCE_HEALTH_EMPTY_MESSAGE,
  RESOURCE_HEALTH_HINT,
} from "./ResourceHealthPill";
import {
  ResourcePartAccent,
  ResourcePartAttention,
  ResourcePartBadge,
  ResourcePartChip,
  ResourcePartStatus,
  ResourcePartTone,
} from "./ResourcePartTypes";

/*
 * The top of a part's own page - a Proxmox node, guest or storage; a
 * Kubernetes node; an ESXi host - above its tabs: what it is, whether it is
 * up, where it sits in its resource, its size and the facts a reader looks
 * for first. Shared by every resource product, so a part's page opens the
 * same way wherever it lives (the ESXi host page's hero, generalized).
 *
 * A status that says something is wrong - "Offline", "CrashLoopBackOff",
 * "1 of 3 available" - opens why (ResourceAttentionPill): what needs
 * attention on the part and what it runs, the list its Needs attention card
 * draws, where the pill only said the word on hover (#9594). So does a chip
 * that counts something wrong ("3 pods failed"): exactly what it counts.
 *
 * The words come from the product, in English; the hero looks them up in
 * the reader's language. A part's name, tags and location values are
 * written as the product reports them.
 */

export interface ComponentProps {
  testId: string;
  icon: IconProp;
  accent?: ResourcePartAccent | undefined;
  name: string;
  status?: ResourcePartStatus | undefined;
  badges?: Array<ResourcePartBadge> | undefined;
  // Where the part sits ("Node of pve-prod"), drawn under its name.
  location?: ReactNode | undefined;
  // When the part last reported; the line is left out without it.
  lastReportAt?: Date | null | undefined;
  chips?: Array<ResourcePartChip> | undefined;
  // Labels the product's own users gave the part (Proxmox tags).
  tags?: Array<string> | undefined;
  /*
   * What needs attention on the part: a warning or danger status opens it.
   * Every part page hands its hero the list its Needs attention card draws.
   */
  attention?: ResourcePartAttention | undefined;
}

// A status that says something is wrong opens why.
export function isResourcePartStatusExplained(data: {
  status: ResourcePartStatus | undefined;
  attention: ResourcePartAttention | undefined;
}): boolean {
  return Boolean(
    data.status &&
      (data.status.tone === "warning" || data.status.tone === "danger") &&
      data.attention &&
      data.attention.items.length > 0,
  );
}

export const RESOURCE_PART_TONE_CLASS_NAMES: Record<
  ResourcePartTone,
  { badge: string; dot: string }
> = {
  positive: {
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  warning: {
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  danger: {
    badge: "bg-red-50 text-red-700 ring-red-200",
    dot: "bg-red-500",
  },
  neutral: {
    badge: "bg-gray-50 text-gray-600 ring-gray-200",
    dot: "bg-gray-400",
  },
};

const ACCENT_CLASS_NAMES: Record<
  ResourcePartAccent,
  { gradient: string; ring: string; icon: string }
> = {
  orange: {
    gradient: "from-orange-50",
    ring: "ring-orange-200",
    icon: "text-orange-600",
  },
  indigo: {
    gradient: "from-indigo-50",
    ring: "ring-indigo-200",
    icon: "text-indigo-600",
  },
  sky: { gradient: "from-sky-50", ring: "ring-sky-200", icon: "text-sky-600" },
  emerald: {
    gradient: "from-emerald-50",
    ring: "ring-emerald-200",
    icon: "text-emerald-600",
  },
  violet: {
    gradient: "from-violet-50",
    ring: "ring-violet-200",
    icon: "text-violet-600",
  },
};

const ResourcePartHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const accent: { gradient: string; ring: string; icon: string } =
    ACCENT_CLASS_NAMES[props.accent || "indigo"];
  const status: ResourcePartStatus | undefined = props.status;
  const chips: Array<ResourcePartChip> = props.chips || [];
  const tags: Array<string> = (props.tags || []).filter((tag: string) => {
    return tag.trim().length > 0;
  });

  const renderStatus: (status: ResourcePartStatus) => ReactElement = (
    status: ResourcePartStatus,
  ): ReactElement => {
    const words: string = status.values
      ? translator.translateTemplate(
          status.label,
          withSentenceDigits(status.values),
        )
      : tx(status.label);
    const description: string | undefined = status.description
      ? tx(status.description)
      : undefined;
    // What the word means, after it, for a screen reader.
    const meaning: ReactElement = description ? (
      <span className="sr-only">{` ${description}`}</span>
    ) : (
      <></>
    );
    const attention: ResourcePartAttention | undefined = props.attention;

    if (attention && isResourcePartStatusExplained({ status, attention })) {
      return (
        <ResourceAttentionPill
          testId={`${props.testId}-status`}
          tone={status.tone}
          label={
            <>
              {words}
              {meaning}
            </>
          }
          hint={RESOURCE_HEALTH_HINT}
          dialog={{
            title: tx(NEEDS_ATTENTION_TITLE),
            description: attention.description || NEEDS_ATTENTION_DESCRIPTION,
            items: attention.items,
            emptyMessage: RESOURCE_HEALTH_EMPTY_MESSAGE,
            showKind: attention.showKind,
            current: attention.current,
          }}
        />
      );
    }

    return (
      <span
        data-testid={`${props.testId}-status`}
        data-tone={status.tone}
        title={description}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${RESOURCE_PART_TONE_CLASS_NAMES[status.tone].badge}`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${RESOURCE_PART_TONE_CLASS_NAMES[status.tone].dot}`}
          aria-hidden="true"
        />
        {words}
        {meaning}
      </span>
    );
  };

  return (
    <div
      data-testid={props.testId}
      className="relative mb-6 rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
        <div
          className={`absolute inset-x-0 top-0 h-24 bg-gradient-to-br ${accent.gradient} via-white to-white`}
          aria-hidden="true"
        />
      </div>
      <div className="relative px-5 py-5 md:px-6">
        <div className="flex min-w-0 items-start gap-4">
          <div
            className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-inset ${accent.ring}`}
          >
            <Icon icon={props.icon} className={`h-6 w-6 ${accent.icon}`} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {/*
               * A long name breaks after its own dots and slashes first
               * (BreakableName), anywhere only where a part is still too
               * long - never mid-word in a name that fits.
               */}
              <h2
                className="min-w-0 text-xl font-semibold text-gray-900 [overflow-wrap:anywhere]"
                data-testid={`${props.testId}-name`}
              >
                <BreakableName text={props.name} />
              </h2>
              {status ? renderStatus(status) : <></>}
              {(props.badges || []).map(
                (badge: ResourcePartBadge): ReactElement => {
                  return (
                    <span
                      key={badge.key}
                      data-testid={`${props.testId}-badge`}
                      data-key={badge.key}
                      data-tone={badge.tone}
                      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${RESOURCE_PART_TONE_CLASS_NAMES[badge.tone].badge}`}
                    >
                      {badge.values
                        ? translator.translateTemplate(
                            badge.label,
                            withSentenceDigits(badge.values),
                          )
                        : tx(badge.label)}
                    </span>
                  );
                },
              )}
            </div>
            {props.location ? (
              <div
                className="mt-1 text-sm text-gray-500"
                data-testid={`${props.testId}-location`}
              >
                {props.location}
              </div>
            ) : (
              <></>
            )}
            {props.lastReportAt ? (
              <div
                className="mt-1 text-xs text-gray-500"
                data-testid={`${props.testId}-last-report`}
                title={OneUptimeDate.getDateAsLocalFormattedString(
                  props.lastReportAt,
                )}
              >
                {translator.translateTemplate("Last reported {{time}}", {
                  // In the language the sentence is shown in.
                  time: composedValue((sentence: Translator): string => {
                    return formatRelativeTime({
                      date: props.lastReportAt as Date,
                      now: new Date(),
                      language: sentence.language,
                    });
                  }),
                })}
              </div>
            ) : (
              <></>
            )}
          </div>
        </div>

        {chips.length > 0 || tags.length > 0 ? (
          <div
            className="mt-4 flex flex-wrap items-center gap-1.5"
            data-testid={`${props.testId}-chips`}
          >
            {chips.map((chip: ResourcePartChip): ReactElement => {
              // A count of something wrong opens what it counts, and why.
              if (chip.attention) {
                return (
                  <ResourceAttentionPill
                    key={chip.key}
                    testId={
                      chip.attention.testId ||
                      `${props.testId}-chip-${chip.key}`
                    }
                    dataAttributes={{ "data-chip": chip.key }}
                    tone={chip.attention.tone}
                    label={chip.label}
                    hint={chip.attention.hint}
                    dialog={chip.attention.dialog}
                  />
                );
              }
              return (
                <Pill
                  key={chip.key}
                  text={chip.label}
                  isUserContent={true}
                  tone={PillTone.Neutral}
                  icon={chip.icon}
                />
              );
            })}
            {tags.map((tag: string): ReactElement => {
              return (
                <Pill
                  key={`tag-${tag}`}
                  text={tag}
                  isUserContent={true}
                  tone={PillTone.Info}
                  icon={IconProp.Tag}
                  dataTestId={`${props.testId}-tag`}
                />
              );
            })}
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default ResourcePartHero;
