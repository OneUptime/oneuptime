import React, { FunctionComponent, ReactElement } from "react";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Feed from "./Feed";
import { UseFeedItemsResult } from "./useFeedItems";

export interface ComponentProps {
  // The feed as useFeedItems reads it.
  feed: UseFeedItemsResult;
  // What an empty feed says (getFeedNoItemsMessage).
  noItemsMessage: string;
  // The order the reader chose, which words the More button.
  sortOrder?: SortOrder | undefined;
}

const LOADING_LABEL: string = translationKey("Loading the feed");

// The rows the skeleton draws while the first page loads.
const SKELETON_ROWS: Array<{ textWidth: string; hasSecondLine: boolean }> = [
  { textWidth: "w-3/5", hasSecondLine: true },
  { textWidth: "w-2/5", hasSecondLine: false },
  { textWidth: "w-1/2", hasSecondLine: true },
];

/*
 * The shape of the timeline - a day heading, then a time, an icon and a line
 * or two of text per row - drawn while the feed loads for the first time, so
 * the card does not jump when the entries land.
 */
export const FeedSkeleton: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div role="status" aria-live="polite" data-testid="feed-skeleton">
      <span className="sr-only">{translator.translateText(LOADING_LABEL)}</span>
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="mb-4 h-4 w-56 max-w-full rounded bg-gray-100"></div>
        {SKELETON_ROWS.map(
          (
            row: { textWidth: string; hasSecondLine: boolean },
            index: number,
          ) => {
            return (
              <div
                key={index}
                className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 pb-6 sm:grid-cols-[5.5rem_1.75rem_minmax(0,1fr)]"
              >
                <div className="col-start-2 row-start-1 pb-1 sm:col-start-1 sm:flex sm:justify-end sm:pt-1">
                  <div className="h-3 w-14 rounded bg-gray-100"></div>
                </div>
                <div className="col-start-1 row-span-2 row-start-1 flex justify-center sm:col-start-2 sm:row-span-1">
                  <div className="h-7 w-7 rounded-full bg-gray-100"></div>
                </div>
                <div className="col-start-2 row-start-2 space-y-2 pt-1.5 sm:col-start-3 sm:row-start-1">
                  <div className={`h-3.5 rounded bg-gray-100 ${row.textWidth}`}></div>
                  {row.hasSecondLine && (
                    <div className="h-3.5 w-4/5 rounded bg-gray-100"></div>
                  )}
                </div>
              </div>
            );
          },
        )}
      </div>
    </div>
  );
};

/*
 * Everything a feed card shows under its header, the same for every feed:
 * the skeleton until the feed has loaded for the resource on screen, the
 * error with a way to try again, the timeline, and an error from More.
 *
 * A refresh - the ⋯ menu's, a poll, a new note - keeps the entries on screen
 * and swaps them when the new page arrives, so a feed never blanks while it
 * is being read.
 */
const FeedContent: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.feed.isCurrentFeedLoaded) {
    return <FeedSkeleton />;
  }

  return (
    <div>
      {props.feed.error ? (
        <ErrorMessage
          message={props.feed.error}
          onRefreshClick={() => {
            props.feed.refresh().catch(() => {
              // The feed shows its own error when a read fails.
            });
          }}
        />
      ) : (
        <Feed
          items={props.feed.feedItems}
          noItemsMessage={props.noItemsMessage}
          hasMore={props.feed.hasMore}
          isLoadingMore={props.feed.isLoadingMore}
          onMore={props.feed.loadMore}
          sortOrder={props.sortOrder}
        />
      )}
      {props.feed.loadMoreError && (
        <ErrorMessage message={props.feed.loadMoreError} />
      )}
    </div>
  );
};

export default FeedContent;
