import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useId,
  useMemo,
  useState,
} from "react";
import FeedItem, { FeedItemProps } from "./FeedItem";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Tooltip from "../Tooltip/Tooltip";
import useClockTick from "../../Utils/UseClockTick";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import { FeedClock, getFeedClock } from "./FeedTime";
import {
  FeedTimelineDay,
  FeedTimelineEntry,
  buildFeedTimeline,
  hasFeedEntryFromToday,
} from "./FeedTimeline";

export interface ComponentProps {
  items: Array<FeedItemProps>;
  noItemsMessage: string;
  hasMore?: boolean | undefined;
  onMore?: (() => void) | undefined;
  isLoadingMore?: boolean | undefined;
  /*
   * The order the items arrived in, which says whether More reaches back
   * to older events or on to newer ones.
   */
  sortOrder?: SortOrder | undefined;
}

export const FEED_TEXT: {
  showOlder: string;
  showNewer: string;
  showMore: string;
  timesAreIn: string;
} = {
  showOlder: translationKey("Show older events"),
  showNewer: translationKey("Show newer events"),
  showMore: translationKey("Show more events"),
  timesAreIn: translationKey("Times are in {{zone}}, your time zone."),
};

const getMoreLabel: (sortOrder: SortOrder | undefined) => string = (
  sortOrder: SortOrder | undefined,
): string => {
  if (sortOrder === SortOrder.Descending) {
    return FEED_TEXT.showOlder;
  }

  if (sortOrder === SortOrder.Ascending) {
    return FEED_TEXT.showNewer;
  }

  return FEED_TEXT.showMore;
};

/*
 * An activity feed drawn as a timeline (see FeedTimeline for the layout):
 * a heading for each day with its full date and the zone the times are in,
 * every entry's real time of day, and bursts of one kind folded into their
 * first entry.
 *
 * Times are read in the reader's zone - User Settings, else the browser's -
 * and their language. While anything shown is from today, the feed re-reads
 * the clock once a minute, so "12 min ago" moves on and "Today" turns into
 * "Yesterday" at midnight; a feed of older entries runs no timer.
 */
const Feed: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // Two feeds on one page must not share their headings' ids.
  const idPrefix: string = useId();
  const [expandedBurstKeys, setExpandedBurstKeys] = useState<Set<string>>(
    () => {
      return new Set<string>();
    },
  );

  const startingClock: FeedClock = getFeedClock({
    language: translator.language,
  });
  const isTicking: boolean = hasFeedEntryFromToday(props.items, startingClock);
  const now: Date = useClockTick(false, { isEnabled: isTicking });

  const clock: FeedClock = useMemo(() => {
    return getFeedClock({ language: translator.language, now: now });
  }, [translator.language, now]);

  const days: Array<FeedTimelineDay<FeedItemProps>> = useMemo(() => {
    return buildFeedTimeline<FeedItemProps>({
      items: props.items,
      clock: clock,
      expandedBurstKeys: expandedBurstKeys,
    });
  }, [props.items, clock, expandedBurstKeys]);

  const toggleBurst: (burstKey: string) => void = useCallback(
    (burstKey: string): void => {
      setExpandedBurstKeys((previous: Set<string>) => {
        const next: Set<string> = new Set<string>(previous);

        if (next.has(burstKey)) {
          next.delete(burstKey);
        } else {
          next.add(burstKey);
        }

        return next;
      });
    },
    [],
  );

  if (props.items.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center px-4 py-10 text-center"
        data-testid="feed-empty"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
          <Icon icon={IconProp.Clock} className="h-5 w-5 text-gray-400" />
        </span>
        <p className="mt-3 max-w-md text-sm text-gray-500">
          {translator.translateText(props.noItemsMessage)}
        </p>
      </div>
    );
  }

  return (
    <div className="flow-root" data-testid="feed">
      {days.map(
        (day: FeedTimelineDay<FeedItemProps>, dayIndex: number) => {
          const headingId: string = `${idPrefix}-day-${day.dayKey}`;

          return (
            <section
              key={day.dayKey}
              aria-labelledby={headingId}
              className={dayIndex > 0 ? "mt-2" : ""}
              data-testid="feed-day"
            >
              <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3
                  id={headingId}
                  className="text-sm font-semibold text-gray-900"
                  data-testid="feed-day-heading"
                >
                  {day.label}
                </h3>
                {day.relativeLabel && (
                  <span
                    className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
                    data-testid="feed-day-relative"
                  >
                    {day.relativeLabel}
                  </span>
                )}
                {day.zoneName && (
                  <Tooltip
                    text={translator.translateTemplate(FEED_TEXT.timesAreIn, {
                      zone: day.zoneName,
                    })}
                  >
                    <span
                      className="text-xs text-gray-500"
                      data-testid="feed-day-zone"
                    >
                      {day.zoneName}
                    </span>
                  </Tooltip>
                )}
                <span
                  className="h-px min-w-4 flex-1 bg-gray-100"
                  aria-hidden="true"
                ></span>
              </div>
              <ol role="list">
                {day.entries.map(
                  (
                    entry: FeedTimelineEntry<FeedItemProps>,
                    entryIndex: number,
                  ) => {
                    return (
                      <FeedItem
                        key={entry.item.key}
                        entry={entry}
                        isLastInDay={entryIndex === day.entries.length - 1}
                        onToggleBurst={toggleBurst}
                      />
                    );
                  },
                )}
              </ol>
            </section>
          );
        },
      )}
      {props.hasMore === true && (
        <div className="mt-1 flex justify-center border-t border-gray-100 pt-4">
          <Button
            title={getMoreLabel(props.sortOrder)}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            onClick={props.onMore}
            isLoading={props.isLoadingMore === true}
            dataTestId="feed-more-button"
          />
        </div>
      )}
    </div>
  );
};

export default Feed;
