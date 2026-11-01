import React, { FunctionComponent, ReactElement, useState } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionCounts,
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
  countResourceAttention,
} from "./ResourceAttention";
import ResourcePartRow from "./ResourcePartRow";

/*
 * "What needs me?" first on a resource's Overview, and on a part's own
 * page: the parts that are broken or need a look, the most urgent first,
 * each with why and one step to its page (ResourceAttention says how a
 * product fills the list). Shared by every resource product.
 *
 * It draws nothing while nothing needs attention: the resource's health
 * pill says it is healthy, and an empty card would only push the rest down.
 * A long list shows its first rows and opens the rest in place.
 *
 * Each row is a link to its part's page, the whole row as on Home's Needs
 * attention card (ResourcePartRow). The part whose page this is says so -
 * "This node" - rather than repeating the name, kind and identifier its
 * hero shows just above, and is not a link to the page the reader is on.
 */

// How many items the card shows before "Show all".
export const NEEDS_ATTENTION_SHOWN: number = 6;

/*
 * The item that is the part whose page this is, and how its row names it
 * (English, looked up in the reader's language): "This node".
 */
export interface ResourceAttentionCurrent {
  key: string;
  label: string;
}

export interface ComponentProps {
  items: Array<ResourceAttentionItem>;
  // Defaults to "Needs attention".
  title?: string | undefined;
  description?: string | undefined;
  // Prefix of the card's test ids; "needs-attention" when unset.
  testId?: string | undefined;
  // How many rows show before "Show all" (NEEDS_ATTENTION_SHOWN).
  shown?: number | undefined;
  current?: ResourceAttentionCurrent | undefined;
}

const SEVERITY_CLASS_NAMES: Record<
  ResourceAttentionSeverity,
  { icon: string; reason: string }
> = {
  [ResourceAttentionSeverity.Critical]: {
    icon: "bg-red-50 text-red-600 ring-red-200",
    reason: "bg-red-50 text-red-700 ring-red-200",
  },
  [ResourceAttentionSeverity.Warning]: {
    icon: "bg-amber-50 text-amber-600 ring-amber-200",
    reason: "bg-amber-50 text-amber-700 ring-amber-200",
  },
};

const NeedsAttentionCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const testId: string = props.testId || "needs-attention";
  const limit: number = props.shown ?? NEEDS_ATTENTION_SHOWN;

  if (props.items.length === 0) {
    return <></>;
  }

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const reasonText: (reason: ResourceAttentionText) => string = (
    reason: ResourceAttentionText,
  ): string => {
    if (reason.plural) {
      return translator.translatePlural(
        { one: reason.plural.one, other: reason.text },
        reason.plural.count,
        reason.values,
      );
    }
    return reason.values
      ? translator.translateTemplate(reason.text, reason.values)
      : tx(reason.text);
  };

  const counts: ResourceAttentionCounts = countResourceAttention(props.items);
  const shown: Array<ResourceAttentionItem> = isExpanded
    ? props.items
    : props.items.slice(0, limit);
  const hiddenCount: number = props.items.length - shown.length;

  /*
   * The card's own summary says how bad it is before the list does: "2
   * critical, 3 to look at".
   */
  const summaryParts: Array<string> = [];
  if (counts.critical > 0) {
    summaryParts.push(
      translator.translatePlural(
        { one: "{{count}} critical", other: "{{count}} critical" },
        counts.critical,
      ),
    );
  }
  if (counts.warning > 0) {
    summaryParts.push(
      translator.translatePlural(
        { one: "{{count}} to look at", other: "{{count}} to look at" },
        counts.warning,
      ),
    );
  }

  return (
    <div className="mb-6" data-testid={testId}>
      <Card
        title={props.title || "Needs attention"}
        description={
          props.description ||
          "What is broken or needs a look, the most urgent first."
        }
        rightElement={
          <span
            className="inline-flex flex-wrap gap-1.5"
            data-testid={`${testId}-summary`}
          >
            {summaryParts.map((part: string, index: number): ReactElement => {
              const isCritical: boolean = index === 0 && counts.critical > 0;
              return (
                <span
                  key={part}
                  className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                    isCritical
                      ? SEVERITY_CLASS_NAMES[ResourceAttentionSeverity.Critical]
                          .reason
                      : SEVERITY_CLASS_NAMES[ResourceAttentionSeverity.Warning]
                          .reason
                  }`}
                >
                  {part}
                </span>
              );
            })}
          </span>
        }
      >
        <ul className={listClassName}>
          {shown.map((item: ResourceAttentionItem): ReactElement => {
            const classNames: { icon: string; reason: string } =
              SEVERITY_CLASS_NAMES[item.severity];
            const isCurrent: boolean = Boolean(
              props.current && props.current.key === item.key,
            );
            return (
              <li
                key={item.key}
                data-testid={`${testId}-item`}
                data-key={item.key}
                data-severity={item.severity}
                data-current={isCurrent ? "true" : undefined}
              >
                <ResourcePartRow
                  to={isCurrent ? undefined : item.route}
                  className="flex items-start gap-3"
                >
                  <div
                    className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ring-1 ring-inset ${classNames.icon}`}
                    aria-hidden="true"
                  >
                    <Icon icon={item.icon} className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        data-testid={`${testId}-name`}
                        className="min-w-0 text-sm font-medium text-gray-900 [overflow-wrap:anywhere]"
                      >
                        {isCurrent && props.current ? (
                          tx(props.current.label)
                        ) : (
                          <BreakableName text={item.name} />
                        )}
                      </span>
                      {isCurrent ? (
                        <></>
                      ) : (
                        <span className="inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                          {tx(item.kind)}
                        </span>
                      )}
                      {item.reasons.map(
                        (reason: ResourceAttentionText): ReactElement => {
                          const text: string = reasonText(reason);
                          return (
                            <span
                              key={`${reason.text}-${text}`}
                              data-testid={`${testId}-reason`}
                              className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${classNames.reason}`}
                            >
                              {text}
                            </span>
                          );
                        },
                      )}
                    </div>
                    {item.detail && !isCurrent ? (
                      <p className="mt-0.5 font-mono text-xs text-gray-500 [overflow-wrap:anywhere]">
                        <bdi>
                          <BreakableName text={item.detail} />
                        </bdi>
                      </p>
                    ) : (
                      <></>
                    )}
                  </div>
                </ResourcePartRow>
              </li>
            );
          })}
          {props.items.length > limit ? (
            <li className="px-5 py-3 md:px-6">
              <button
                type="button"
                data-testid={`${testId}-toggle`}
                aria-expanded={isExpanded}
                onClick={() => {
                  setIsExpanded(!isExpanded);
                }}
                className="inline-flex items-center gap-1 rounded text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <Icon
                  icon={isExpanded ? IconProp.ChevronUp : IconProp.ChevronDown}
                  className="h-4 w-4"
                />
                {isExpanded
                  ? tx("Show fewer")
                  : translator.translatePlural(
                      {
                        one: "Show {{count}} more",
                        other: "Show {{count}} more",
                      },
                      hiddenCount,
                    )}
              </button>
            </li>
          ) : (
            <></>
          )}
        </ul>
      </Card>
    </div>
  );
};

export default NeedsAttentionCard;
