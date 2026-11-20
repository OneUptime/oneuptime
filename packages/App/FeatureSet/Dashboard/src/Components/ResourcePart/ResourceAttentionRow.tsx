import React, { FunctionComponent, ReactElement } from "react";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  Translator,
  composedValue,
  toLabelTerm,
  translatableTerm,
} from "Common/UI/Utils/TranslateTemplate";
import { LABEL_WITH_COLON } from "Common/UI/Utils/LabelWithColon";
import { formatRelativeTime } from "../Home/HomeRelativeTime";
import {
  ResourceAttentionEvent,
  ResourceAttentionFact,
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionSince,
  ResourceAttentionText,
} from "./ResourceAttention";
import { withSentenceDigits } from "./SentenceDigits";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";

/*
 * ONE PART THAT NEEDS ATTENTION, AS EVERY LIST OF THEM DRAWS IT.
 *
 * The Needs attention card on a resource's Overview and the dialog a failed
 * count opens (ResourceAttentionDialog) draw the same row, so a crash-looping
 * pod reads the same in both: an icon in its severity's colour, its name,
 * its kind, why it needs attention in chips, and what the resource itself
 * says about it, as it wrote it.
 *
 * A dialog that answers "what failed?" also draws what the card leaves out
 * (ResourceAttentionItem's facts, since and events): which one it is - its
 * namespace, its owner, its node - since when it has been failing, and what
 * the resource reported about it lately. A fact links to its own page only
 * where the row is not itself a link (areFactsLinked): a link inside a link
 * is one control inside another.
 *
 * It draws the row's content - the icon and the text beside it - and leaves
 * the row's frame (a link to the part's page, a list item with a View
 * button) to the list that holds it.
 */

// How many of a part's recent events a row lists: the newest first.
export const RESOURCE_ATTENTION_EVENTS_SHOWN: number = 3;

export const RESOURCE_ATTENTION_SEVERITY_CLASS_NAMES: Record<
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

/*
 * A reason in the reader's language: its numbers in the sentence's digits
 * ("۲ از ۳ در دسترس"), and each value set apart from the words around it
 * (SentenceOptions) - a mount such as /var/lib/postgresql in a Persian
 * reason kept its slash at the wrong end.
 */
export function getResourceAttentionText(
  translator: Translator,
  reason: ResourceAttentionText,
): string {
  if (reason.plural) {
    return translator.translatePlural(
      { one: reason.plural.one, other: reason.text },
      reason.plural.count,
      withSentenceDigits(reason.values),
      { setsValuesApart: true },
    );
  }
  return reason.values
    ? translator.translateTemplate(
        reason.text,
        withSentenceDigits(reason.values),
        { setsValuesApart: true },
      )
    : translator.translateText(reason.text) || reason.text;
}

// "2 hours ago", in the language of the sentence it goes into.
function relativeTimeValue(
  date: Date,
  now: Date,
): ReturnType<typeof composedValue> {
  return composedValue((sentence: Translator): string => {
    return formatRelativeTime({
      date: date,
      now: now,
      language: sentence.language,
    });
  });
}

/*
 * Since when, as a row says it - "Failed 2 hours ago", in the reader's
 * words - so a page saying it beside the row's dialog says the same.
 */
export function getResourceAttentionSinceText(
  translator: Translator,
  since: ResourceAttentionSince,
  now: Date,
): string {
  return translator.translateTemplate(
    since.template,
    { ...(since.values || {}), time: relativeTimeValue(since.at, now) },
    { setsValuesApart: true },
  );
}

export interface ComponentProps {
  item: ResourceAttentionItem;
  // Prefix of the row's test ids: `${testId}-name`, `${testId}-reason`, ...
  testId: string;
  /*
   * False when every row is the same kind of part - a list of hosts - so
   * the kind's chip would say "Host" on every row.
   */
  showKind?: boolean | undefined;
  /*
   * How the part whose page this is reads in place of its name, in English
   * ("This node"): its hero above already names it.
   */
  currentLabel?: string | undefined;
  // Facts link to their pages: never inside a row that is itself a link.
  areFactsLinked?: boolean | undefined;
  // The time "2 hours ago" counts back from; now when left out.
  now?: Date | undefined;
}

const ResourceAttentionRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const item: ResourceAttentionItem = props.item;
  const testId: string = props.testId;
  const classNames: { icon: string; reason: string } =
    RESOURCE_ATTENTION_SEVERITY_CLASS_NAMES[item.severity];
  const isCurrent: boolean = Boolean(props.currentLabel);
  const showKind: boolean = props.showKind !== false;
  const now: Date = props.now || new Date();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const facts: Array<ResourceAttentionFact> = item.facts || [];
  const events: Array<ResourceAttentionEvent> = (item.events || []).slice(
    0,
    RESOURCE_ATTENTION_EVENTS_SHOWN,
  );

  return (
    <>
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
            {/*
             * A name reads the way it is written: a mount's leading slash
             * stays at its start on a Persian page.
             */}
            {isCurrent && props.currentLabel ? (
              tx(props.currentLabel)
            ) : (
              <bdi>
                <BreakableName text={item.name} />
              </bdi>
            )}
          </span>
          {isCurrent || !showKind ? (
            <></>
          ) : (
            <span
              data-testid={`${testId}-kind`}
              className="inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600"
            >
              {/*
               * A chip is a label: a kind some languages word for the middle
               * of a sentence ("clúster de Kubernetes", "zone DNS") starts
               * with a capital.
               */}
              {item.kindAsWritten ? (
                <bdi>{item.kind}</bdi>
              ) : (
                toLabelTerm(tx(item.kind), translator.language)
              )}
            </span>
          )}
          {item.reasons.map((reason: ResourceAttentionText): ReactElement => {
            const text: string = getResourceAttentionText(translator, reason);
            return (
              <span
                key={`${reason.text}-${text}`}
                data-testid={`${testId}-reason`}
                className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${classNames.reason}`}
              >
                {text}
              </span>
            );
          })}
        </div>
        {/*
         * Why, in whole sentences already in the reader's words (a
         * monitor's criteria and what it found): drawn as handed, each
         * value in it as its sentence placed it.
         */}
        {item.explanation ? (
          <p
            data-testid={`${testId}-explanation`}
            className="mt-1 text-sm text-gray-700 [overflow-wrap:anywhere]"
          >
            {item.explanation}
          </p>
        ) : (
          <></>
        )}
        {/*
         * A part that stopped reporting: when it last did, in the
         * sentence's language (the hero's own words).
         */}
        {item.lastReportAt ? (
          <p
            data-testid={`${testId}-last-report`}
            className="mt-0.5 text-xs text-gray-500"
          >
            {translator.translateTemplate(
              "Last reported {{time}}",
              { time: relativeTimeValue(item.lastReportAt, now) },
              { setsValuesApart: true },
            )}
          </p>
        ) : (
          <></>
        )}
        {item.detail && !isCurrent ? (
          <p
            data-testid={`${testId}-detail`}
            className="mt-0.5 font-mono text-xs text-gray-500 [overflow-wrap:anywhere]"
          >
            <bdi>
              <BreakableName text={item.detail} />
            </bdi>
          </p>
        ) : (
          <></>
        )}
        {/*
         * Which one it is: its namespace, its owner, its node - each value
         * as the resource writes it, the owner a step from its own page.
         */}
        {facts.length > 0 ? (
          <dl
            data-testid={`${testId}-facts`}
            className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs"
          >
            {facts.map((fact: ResourceAttentionFact): ReactElement => {
              const value: ReactElement = (
                <bdi>
                  {fact.valueKind ? (
                    <span className="text-gray-500">{fact.valueKind} </span>
                  ) : (
                    <></>
                  )}
                  {fact.isCount && Number.isFinite(Number(fact.value)) ? (
                    translator.formatNumber(Number(fact.value))
                  ) : (
                    <BreakableName text={fact.value} />
                  )}
                </bdi>
              );
              return (
                <div
                  key={fact.key}
                  data-testid={`${testId}-fact`}
                  data-fact={fact.key}
                  className="flex min-w-0 items-baseline gap-1"
                >
                  <dt className="flex-none text-gray-500">
                    {translator.translateTemplate(LABEL_WITH_COLON, {
                      label: translatableTerm(fact.label),
                    })}
                  </dt>
                  <dd className="min-w-0 font-medium text-gray-700 [overflow-wrap:anywhere]">
                    {props.areFactsLinked && fact.route ? (
                      <Link
                        to={fact.route}
                        dataTestId={`${testId}-fact-link`}
                        className="rounded text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        {value}
                      </Link>
                    ) : (
                      value
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : (
          <></>
        )}
        {/*
         * The resource's own words, as it wrote them: two lines at most, the
         * whole of it on hover.
         */}
        {item.message ? (
          <p
            data-testid={`${testId}-message`}
            title={item.message}
            className="mt-1 line-clamp-2 text-xs text-gray-600 [overflow-wrap:anywhere]"
          >
            <bdi>{item.message}</bdi>
          </p>
        ) : (
          <></>
        )}
        {/* Since when: "Failing since 2 hours ago", "Failed 3 days ago". */}
        {item.since ? (
          <p
            data-testid={`${testId}-since`}
            className="mt-1 text-xs text-gray-500"
          >
            {getResourceAttentionSinceText(translator, item.since, now)}
          </p>
        ) : (
          <></>
        )}
        {/*
         * What the resource reported about it lately - an OOM kill, a pull
         * that failed, a scheduler that found no node - newest first, in its
         * own words.
         */}
        {events.length > 0 ? (
          <div className="mt-2" data-testid={`${testId}-events`}>
            <p className="text-xs font-medium text-gray-500">
              {tx("Recent events")}
            </p>
            <ul className="mt-1 space-y-1">
              {events.map((event: ResourceAttentionEvent): ReactElement => {
                return (
                  <li
                    key={event.key}
                    data-testid={`${testId}-event`}
                    className="text-xs text-gray-600 [overflow-wrap:anywhere]"
                  >
                    <span className="font-medium text-gray-800">
                      <bdi>{event.reason}</bdi>
                    </span>
                    {event.message ? (
                      <>
                        {" "}
                        <bdi>{event.message}</bdi>
                      </>
                    ) : (
                      <></>
                    )}
                    {event.lastSeenAt || event.count > 1 ? (
                      <span className="text-gray-500">
                        <InlineSeparator />
                        {event.count > 1 && event.lastSeenAt
                          ? translator.translatePlural(
                              {
                                one: "{{count}} time, last {{time}}",
                                other: "{{count}} times, last {{time}}",
                              },
                              event.count,
                              {
                                time: relativeTimeValue(event.lastSeenAt, now),
                              },
                              { setsValuesApart: true },
                            )
                          : event.count > 1
                            ? translator.translatePlural(
                                {
                                  one: "{{count}} time",
                                  other: "{{count}} times",
                                },
                                event.count,
                              )
                            : formatRelativeTime({
                                date: event.lastSeenAt as Date,
                                now: now,
                                language: translator.language,
                              })}
                      </span>
                    ) : (
                      <></>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <></>
        )}
      </div>
    </>
  );
};

export default ResourceAttentionRow;
