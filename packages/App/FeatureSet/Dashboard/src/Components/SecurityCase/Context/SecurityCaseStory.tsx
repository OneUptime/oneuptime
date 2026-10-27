import AppLink from "../../AppLink/AppLink";
import { formatNameList } from "../../AiAccess/AiAccessModes";
import {
  SECURITY_CASE_CONTEXT_TEST_IDS,
  STORY_CASE_OPENED,
  STORY_DAY_HEADING_ARIA_LABEL,
  STORY_DESCRIPTION,
  STORY_EMPTY_DESCRIPTION,
  STORY_EMPTY_TITLE,
  STORY_EVENTS_IN_RUN,
  STORY_EXCEPTIONS_UNREADABLE,
  STORY_FAILED,
  STORY_FILTERS_ARIA_LABEL,
  STORY_FILTER_EMPTY,
  STORY_FILTER_LABELS,
  STORY_FIRED,
  STORY_KIND_ICONS,
  STORY_KIND_LABELS,
  STORY_LINKS_ARIA_LABEL,
  STORY_MILESTONE_TITLES,
  STORY_ON_RECORD,
  STORY_OUTCOME_LABELS,
  STORY_OUTCOME_TALLY,
  STORY_SOURCE_NAMES,
  STORY_STARTED_BY,
  STORY_THROWN_BY,
  STORY_TRUNCATED,
  STORY_TRY_AGAIN,
  STORY_UNREADABLE,
  STORY_UNTIL,
  STORY_WINDOW,
  STORY_WRITTEN_BY,
} from "./SecurityCaseContextCopy";
import SecurityCaseContextApi from "./SecurityCaseContextApi";
import {
  StoryDay,
  StoryLink,
  getStoryItemLinks,
  getStoryItemRecordRoute,
  getStoryItemTitleRoute,
  getStoryItemTone,
  getStoryOutcomeTally,
  groupStoryItemsByDay,
} from "./SecurityCaseContextModel";
import Route from "Common/Types/API/Route";
import { Gray500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityCaseStoryFilter,
  SecurityCaseStoryItemJson,
  SecurityCaseStoryItemKind,
  SecurityCaseStoryJson,
  SecurityCaseStorySource,
} from "Common/Types/SecurityCase/SecurityCaseContext";
import SecurityEventRequestOutcome, {
  isSecurityEventRequestOutcome,
} from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  countStoryItemsByFilter,
  filterStoryItems,
} from "Common/Utils/SecurityCase/SecurityCaseStoryItems";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import API from "Common/UI/Utils/API/API";
import { Translator, composedValue } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * A SECURITY CASE'S STORY: what happened, in order, across OneUptime
 * (Server/Utils/SecurityCase/Context/SecurityCaseStory.ts reads it).
 *
 * One column, oldest first, under a heading for each day: each item says
 * what it is (small, above), what happened (its title, the request or the
 * incident it names), how far its requests got, and what it opens - the
 * request's trace, the exception it threw, the events behind it. A scanner's
 * probes are one item with how many there were and how far each got, not a
 * page of rows. Filters narrow it to the attack, what changed, what it set
 * off, or the response; a part with nothing in it is not offered.
 *
 * What the reader's role cannot read, what was cut at a bound and what
 * failed is said above the story, never left as a gap that reads as
 * "nothing happened".
 */

export interface ComponentProps {
  caseId: ObjectID;
  // Change it to read the story again (the case changed), keeping what is shown meanwhile.
  refreshToken?: string | number | undefined;
}

const TONE_DOT_CLASS_NAMES: Record<
  ReturnType<typeof getStoryItemTone>,
  string
> = {
  red: "bg-red-500 text-white",
  amber: "bg-amber-500 text-white",
  indigo: "bg-indigo-500 text-white",
  green: "bg-green-600 text-white",
  gray: "bg-gray-500 text-white",
};

const OUTCOME_COLORS: Record<SecurityEventRequestOutcome, Color> = {
  [SecurityEventRequestOutcome.Rejected]: Gray500,
  [SecurityEventRequestOutcome.ReachedApp]: new Color("#d97706"),
  [SecurityEventRequestOutcome.Errored]: new Color("#dc2626"),
  [SecurityEventRequestOutcome.ReachedDatabase]: new Color("#b91c1c"),
};

const LINK_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const FILTER_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

function sourceNames(
  translator: Translator,
  sources: Array<SecurityCaseStorySource>,
): string {
  return formatNameList(
    sources.map((source: SecurityCaseStorySource): string => {
      return (
        translator.translateText(STORY_SOURCE_NAMES[source]) ||
        STORY_SOURCE_NAMES[source]
      );
    }),
    "and",
    translator,
  );
}

// What an item says, as its title: its source's words, or the case's step.
function useItemTitle(item: SecurityCaseStoryItemJson): string {
  const translator: Translator = useTranslator();

  if (item.kind === SecurityCaseStoryItemKind.CaseOpened) {
    return translator.translateText(STORY_CASE_OPENED) || STORY_CASE_OPENED;
  }

  if (item.kind === SecurityCaseStoryItemKind.Milestone && item.milestone) {
    return (
      translator.translateText(STORY_MILESTONE_TITLES[item.milestone]) ||
      STORY_MILESTONE_TITLES[item.milestone]
    );
  }

  return item.title;
}

const StoryItemLinks: FunctionComponent<{
  item: SecurityCaseStoryItemJson;
  caseId: ObjectID;
  title: string;
}> = (props: {
  item: SecurityCaseStoryItemJson;
  caseId: ObjectID;
  title: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const links: Array<StoryLink> = getStoryItemLinks({
    item: props.item,
    caseId: props.caseId,
  });

  if (links.length === 0) {
    return <></>;
  }

  return (
    <div
      role="group"
      className="mt-2 flex flex-wrap gap-1.5"
      aria-label={translator.translateTemplate(STORY_LINKS_ARIA_LABEL, {
        title: props.title,
      })}
      data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.storyLinks}
    >
      {links.map((link: StoryLink): ReactElement => {
        return (
          <AppLink
            key={link.key}
            to={link.route}
            className={LINK_CLASS_NAME}
            dataTestId={`security-case-story-link-${link.key}`}
          >
            <Icon icon={link.icon} className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            <span>{translator.translateText(link.label) || link.label}</span>
          </AppLink>
        );
      })}
    </div>
  );
};

// The lines under an item's title: how many, until when, on what, by whom.
const StoryItemFacts: FunctionComponent<{
  item: SecurityCaseStoryItemJson;
}> = (props: { item: SecurityCaseStoryItemJson }): ReactElement => {
  const translator: Translator = useTranslator();
  const item: SecurityCaseStoryItemJson = props.item;
  const facts: Array<ReactElement> = [];
  const until: string | null = item.endTime
    ? translator.translateTemplate(STORY_UNTIL, {
        time: OneUptimeDate.getLocalHourAndMinuteFromDate(item.endTime),
      })
    : null;

  if (item.kind === SecurityCaseStoryItemKind.Events && (item.count || 0) > 1) {
    facts.push(
      <span key="count">
        {translator.translatePlural(STORY_EVENTS_IN_RUN, item.count || 0)}
        {until ? ` · ${until}` : ""}
      </span>,
    );
  }

  if (item.kind === SecurityCaseStoryItemKind.Detection) {
    facts.push(
      <span key="fired">
        {translator.translatePlural(STORY_FIRED, item.count || 1)}
        {until ? ` · ${until}` : ""}
      </span>,
    );
  }

  if (item.kind === SecurityCaseStoryItemKind.Exception && item.count) {
    facts.push(
      <span key="thrown">
        {translator.translatePlural(STORY_THROWN_BY, item.count)}
      </span>,
    );
  }

  const recordRoute: Route | null = getStoryItemRecordRoute(item);

  if (item.links.resource) {
    const name: string = item.links.resource.name;

    facts.push(
      <span key="record">
        {recordRoute ? (
          <AppLink
            to={recordRoute}
            className="text-gray-700 hover:text-indigo-700 hover:underline"
          >
            {translator.translateTemplate(STORY_ON_RECORD, { name })}
          </AppLink>
        ) : (
          translator.translateTemplate(STORY_ON_RECORD, { name })
        )}
      </span>,
    );
  }

  if (item.actorName) {
    facts.push(
      <span key="actor">
        {translator.translateTemplate(
          item.kind === SecurityCaseStoryItemKind.Note
            ? STORY_WRITTEN_BY
            : STORY_STARTED_BY,
          { name: item.actorName },
        )}
      </span>,
    );
  }

  const tally: Array<{ outcome: string; count: number }> =
    getStoryOutcomeTally(item);

  if (tally.length > 1) {
    facts.push(
      <span key="tally" className="inline-flex flex-wrap gap-x-2">
        {tally.map((entry: { outcome: string; count: number }): ReactElement => {
          const label: string = isSecurityEventRequestOutcome(entry.outcome)
            ? translator.translateText(STORY_OUTCOME_LABELS[entry.outcome]) ||
              STORY_OUTCOME_LABELS[entry.outcome]
            : "—";

          return (
            <span key={entry.outcome || "none"} className="whitespace-nowrap">
              {translator.translateTemplate(STORY_OUTCOME_TALLY, {
                label,
                count: translator.formatNumber(entry.count),
              })}
            </span>
          );
        })}
      </span>,
    );
  }

  if (facts.length === 0) {
    return <></>;
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
      {facts}
    </div>
  );
};

const StoryItem: FunctionComponent<{
  item: SecurityCaseStoryItemJson;
  caseId: ObjectID;
  isLast: boolean;
}> = (props: {
  item: SecurityCaseStoryItemJson;
  caseId: ObjectID;
  isLast: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const item: SecurityCaseStoryItemJson = props.item;
  const title: string = useItemTitle(item);
  const titleRoute: Route | null = getStoryItemTitleRoute(item);
  const tone: ReturnType<typeof getStoryItemTone> = getStoryItemTone(item);
  const outcome: SecurityEventRequestOutcome | null =
    isSecurityEventRequestOutcome(item.requestOutcome)
      ? item.requestOutcome
      : null;
  const titleText: ReactElement = (
    <bdi>
      {item.number ? (
        <span className="font-medium text-gray-500">{item.number} </span>
      ) : (
        <></>
      )}
      {title}
    </bdi>
  );

  return (
    <li
      className="relative flex gap-3 pb-5 last:pb-0"
      data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.storyItem}
      data-kind={item.kind}
    >
      {/* The line that joins one item's marker to the next. */}
      {!props.isLast ? (
        <span
          className="absolute left-[4.5rem] top-7 -bottom-1 w-px bg-gray-200"
          aria-hidden="true"
        />
      ) : (
        <></>
      )}
      <time
        dateTime={item.time}
        className="w-12 shrink-0 pt-1.5 text-right text-xs tabular-nums text-gray-500"
        title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          new Date(item.time),
        )}
      >
        {OneUptimeDate.getLocalHourAndMinuteFromDate(item.time)}
      </time>
      <span
        className={`relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${TONE_DOT_CLASS_NAMES[tone]}`}
        aria-hidden="true"
      >
        <Icon icon={STORY_KIND_ICONS[item.kind]} className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {translator.translateText(STORY_KIND_LABELS[item.kind]) ||
              STORY_KIND_LABELS[item.kind]}
          </span>
          {outcome ? (
            <Pill
              text={STORY_OUTCOME_LABELS[outcome]}
              color={OUTCOME_COLORS[outcome]}
              size={PillSize.Small}
            />
          ) : (
            <></>
          )}
          {item.stateName && !outcome ? (
            <Pill
              text={item.stateName}
              color={item.stateColor ? new Color(item.stateColor) : Gray500}
              size={PillSize.Small}
            />
          ) : (
            <></>
          )}
        </div>
        <p className="mt-0.5 text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
          {titleRoute ? (
            <AppLink
              to={titleRoute}
              className="text-gray-900 hover:text-indigo-700 hover:underline"
            >
              {titleText}
            </AppLink>
          ) : (
            titleText
          )}
        </p>
        {item.detail ? (
          <p className="mt-0.5 font-mono text-xs text-gray-600 [overflow-wrap:anywhere]">
            <bdi>{item.detail}</bdi>
          </p>
        ) : (
          <></>
        )}
        <StoryItemFacts item={item} />
        <StoryItemLinks item={item} caseId={props.caseId} title={title} />
      </div>
    </li>
  );
};

const SecurityCaseStory: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [story, setStory] = useState<SecurityCaseStoryJson | null>(null);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [filter, setFilter] = useState<SecurityCaseStoryFilter>(
    SecurityCaseStoryFilter.All,
  );

  useEffect(() => {
    let isCurrent: boolean = true;

    setError("");

    SecurityCaseContextApi.getStory(props.caseId)
      .then((result: SecurityCaseStoryJson) => {
        if (isCurrent) {
          setStory(result);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err as Error));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.caseId.toString(), props.refreshToken, readCount]);

  const reread: () => void = (): void => {
    setReadCount((count: number): number => {
      return count + 1;
    });
  };

  const counts: Record<SecurityCaseStoryFilter, number> | null = useMemo(() => {
    return story ? countStoryItemsByFilter(story.items) : null;
  }, [story]);

  const days: Array<StoryDay> = useMemo(() => {
    return story ? groupStoryItemsByDay(filterStoryItems(story.items, filter)) : [];
  }, [story, filter]);

  let body: ReactElement;

  if (error) {
    body = (
      <div data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.error}>
        <ErrorMessage message={error} onRefreshClick={reread} />
      </div>
    );
  } else if (!story || !counts) {
    body = <ComponentLoader />;
  } else if (story.items.length === 0) {
    body = (
      <div data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.storyEmpty}>
        <TableEmptyState
          kind={TableEmptyStateKind.Empty}
          icon={IconProp.BookOpen}
          title={translator.translateText(STORY_EMPTY_TITLE) || ""}
          description={translator.translateText(STORY_EMPTY_DESCRIPTION)}
          isCompact={true}
        />
      </div>
    );
  } else {
    const exceptionsUnreadable: boolean = story.unreadableSources.includes(
      SecurityCaseStorySource.Exceptions,
    );
    const unreadable: Array<SecurityCaseStorySource> =
      story.unreadableSources.filter(
        (source: SecurityCaseStorySource): boolean => {
          return source !== SecurityCaseStorySource.Exceptions;
        },
      );
    const offered: Array<SecurityCaseStoryFilter> = Object.values(
      SecurityCaseStoryFilter,
    ).filter((option: SecurityCaseStoryFilter): boolean => {
      return option === SecurityCaseStoryFilter.All || counts[option] > 0;
    });

    body = (
      <div className="space-y-4">
        {offered.length > 2 ? (
          <div
            role="group"
            aria-label={translator.translateText(STORY_FILTERS_ARIA_LABEL)}
            className="flex flex-wrap gap-1.5"
            data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.storyFilters}
          >
            {offered.map((option: SecurityCaseStoryFilter): ReactElement => {
              const isActive: boolean = option === filter;

              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={isActive}
                  className={`${FILTER_CLASS_NAME} ${
                    isActive
                      ? "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                  onClick={() => {
                    setFilter(option);
                  }}
                  data-testid={`security-case-story-filter-${option}`}
                >
                  <span>
                    {translator.translateText(STORY_FILTER_LABELS[option]) ||
                      STORY_FILTER_LABELS[option]}
                  </span>
                  <span className="tabular-nums text-gray-400">
                    {translator.formatNumber(counts[option])}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <></>
        )}

        {story.windowStart && story.windowEnd ? (
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <Icon
              icon={IconProp.Clock}
              className="h-3.5 w-3.5 shrink-0 text-gray-400"
            />
            <span>
              {translator.translateTemplate(STORY_WINDOW, {
                start: OneUptimeDate.getDateAsLocalShortDateTimeString(
                  story.windowStart,
                ),
                end: OneUptimeDate.getDateAsLocalShortDateTimeString(
                  story.windowEnd,
                ),
              })}
            </span>
          </div>
        ) : (
          <></>
        )}

        {story.truncatedSources.length > 0 ||
        unreadable.length > 0 ||
        exceptionsUnreadable ||
        story.failedSources.length > 0 ? (
          <div
            className="space-y-1 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600"
            data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.storyNotes}
          >
            {story.truncatedSources.length > 0 ? (
              <p>
                {translator.translateTemplate(STORY_TRUNCATED, {
                  sources: composedValue((sentence: Translator): string => {
                    return sourceNames(sentence, story.truncatedSources);
                  }),
                })}
              </p>
            ) : (
              <></>
            )}
            {unreadable.length > 0 ? (
              <p>
                {translator.translateTemplate(STORY_UNREADABLE, {
                  sources: composedValue((sentence: Translator): string => {
                    return sourceNames(sentence, unreadable);
                  }),
                })}
              </p>
            ) : (
              <></>
            )}
            {exceptionsUnreadable ? (
              <p>{translator.translateText(STORY_EXCEPTIONS_UNREADABLE)}</p>
            ) : (
              <></>
            )}
            {story.failedSources.length > 0 ? (
              <p className="flex flex-wrap items-center gap-x-2 text-amber-700">
                <span>
                  {translator.translateTemplate(STORY_FAILED, {
                    sources: composedValue((sentence: Translator): string => {
                      return sourceNames(sentence, story.failedSources);
                    }),
                  })}
                </span>
                <button
                  type="button"
                  className="rounded font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  onClick={reread}
                >
                  {translator.translateText(STORY_TRY_AGAIN)}
                </button>
              </p>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        {days.length === 0 ? (
          <p
            className="text-sm text-gray-500"
            data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.storyFilterEmpty}
          >
            {translator.translateText(STORY_FILTER_EMPTY)}
          </p>
        ) : (
          days.map((day: StoryDay): ReactElement => {
            const dayLabel: string =
              OneUptimeDate.getDateAsLocalDayMonthString(day.time);

            return (
              <section
                key={day.key}
                aria-label={translator.translateTemplate(
                  STORY_DAY_HEADING_ARIA_LABEL,
                  { day: dayLabel },
                )}
                data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.storyDay}
              >
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {dayLabel}
                </h3>
                <ol>
                  {day.items.map(
                    (
                      item: SecurityCaseStoryItemJson,
                      index: number,
                    ): ReactElement => {
                      return (
                        <StoryItem
                          key={item.key}
                          item={item}
                          caseId={props.caseId}
                          isLast={index === day.items.length - 1}
                        />
                      );
                    },
                  )}
                </ol>
              </section>
            );
          })
        )}
      </div>
    );
  }

  return (
    <div data-testid={SECURITY_CASE_CONTEXT_TEST_IDS.story}>
      <Card title="Story" description={STORY_DESCRIPTION}>
        {body}
      </Card>
    </div>
  );
};

export default SecurityCaseStory;
