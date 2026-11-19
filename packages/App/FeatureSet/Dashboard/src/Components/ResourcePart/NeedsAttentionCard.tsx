import React, { FunctionComponent, ReactElement, useState } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionCounts,
  ResourceAttentionCurrent,
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  countResourceAttention,
} from "./ResourceAttention";
import ResourceAttentionRow, {
  RESOURCE_ATTENTION_SEVERITY_CLASS_NAMES,
} from "./ResourceAttentionRow";
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
 *
 * When what needs attention cannot be read, the card says so in its own
 * frame, with a way to read it again (error, onRetry): a bare sentence
 * under the hero did not say what had failed, and an empty card would be
 * an all-clear nobody gave.
 */

// How many items the card shows before "Show all".
export const NEEDS_ATTENTION_SHOWN: number = 6;

/*
 * The card's own words, which the dialog a part's status opens takes too
 * (ResourcePartHero): the same list, under the same name.
 */
export const NEEDS_ATTENTION_TITLE: string = translationKey("Needs attention");
export const NEEDS_ATTENTION_DESCRIPTION: string = translationKey(
  "What is broken or needs a look, the most urgent first.",
);

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
  /*
   * Why what needs attention could not be read: drawn in the card's frame,
   * in place of its rows, as `${testId}-error`.
   */
  error?: string | undefined;
  // Reads it again; the error offers it as Refresh.
  onRetry?: (() => void) | undefined;
  /*
   * False when every row is the same kind of part - a list of hosts - so
   * the kind's chip would say "Host" on every row.
   */
  showKind?: boolean | undefined;
}

const SEVERITY_CLASS_NAMES: Record<
  ResourceAttentionSeverity,
  { icon: string; reason: string }
> = RESOURCE_ATTENTION_SEVERITY_CLASS_NAMES;

const NeedsAttentionCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const testId: string = props.testId || "needs-attention";
  const limit: number = props.shown ?? NEEDS_ATTENTION_SHOWN;
  const showKind: boolean = props.showKind !== false;

  if (props.error) {
    return (
      <div className="mb-6" data-testid={`${testId}-error`}>
        <Card
          title={props.title || NEEDS_ATTENTION_TITLE}
          description={props.description || NEEDS_ATTENTION_DESCRIPTION}
        >
          <ErrorMessage message={props.error} onRefreshClick={props.onRetry} />
        </Card>
      </div>
    );
  }

  if (props.items.length === 0) {
    return <></>;
  }

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
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
        title={props.title || NEEDS_ATTENTION_TITLE}
        description={props.description || NEEDS_ATTENTION_DESCRIPTION}
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
                {/*
                 * The whole row is the link to the part's page, so its facts
                 * are words, never links of their own.
                 */}
                <ResourcePartRow
                  to={isCurrent ? undefined : item.route}
                  className="flex items-start gap-3"
                >
                  <ResourceAttentionRow
                    item={item}
                    testId={testId}
                    showKind={showKind}
                    currentLabel={
                      isCurrent && props.current
                        ? props.current.label
                        : undefined
                    }
                    areFactsLinked={false}
                  />
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
