import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { composedValue, Translator } from "Common/UI/Utils/TranslateTemplate";
import { formatRelativeTime } from "../Home/HomeRelativeTime";
import {
  ResourcePartAccent,
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
              {status ? (
                <span
                  data-testid={`${props.testId}-status`}
                  data-tone={status.tone}
                  title={
                    status.description ? tx(status.description) : undefined
                  }
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${RESOURCE_PART_TONE_CLASS_NAMES[status.tone].badge}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${RESOURCE_PART_TONE_CLASS_NAMES[status.tone].dot}`}
                    aria-hidden="true"
                  />
                  {tx(status.label)}
                  {status.description ? (
                    <span className="sr-only">{` ${tx(status.description)}`}</span>
                  ) : (
                    <></>
                  )}
                </span>
              ) : (
                <></>
              )}
              {(props.badges || []).map(
                (badge: ResourcePartBadge): ReactElement => {
                  return (
                    <span
                      key={badge.key}
                      data-testid={`${props.testId}-badge`}
                      data-key={badge.key}
                      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${RESOURCE_PART_TONE_CLASS_NAMES[badge.tone].badge}`}
                    >
                      {badge.values
                        ? translator.translateTemplate(
                            badge.label,
                            badge.values,
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
              return (
                <span
                  key={chip.key}
                  data-key={chip.key}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700"
                >
                  <Icon icon={chip.icon} className="h-3 w-3 text-gray-500" />
                  <span className="font-medium">{chip.label}</span>
                </span>
              );
            })}
            {tags.map((tag: string): ReactElement => {
              return (
                <span
                  key={`tag-${tag}`}
                  data-testid={`${props.testId}-tag`}
                  className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200"
                >
                  <Icon icon={IconProp.Tag} className="h-3 w-3" />
                  <bdi>{tag}</bdi>
                </span>
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
