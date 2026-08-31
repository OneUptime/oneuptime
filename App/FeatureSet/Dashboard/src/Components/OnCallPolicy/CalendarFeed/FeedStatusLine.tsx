import { FeedStatus } from "./CalendarFeedTypes";
import {
  getRotatedDaysAgo,
  shouldShowNothingFetchedHint,
} from "./CalendarFeedUtil";
import OneUptimeDate from "Common/Types/Date";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One line of bookkeeping under a feed link: when it was last fetched and by
 * what, roughly how often, which link it is (the last four characters, never
 * more), and how long ago it was minted.
 *
 * The fetch count is prefixed with "~" on purpose. The server keeps it with a
 * read-modify-write it does not lock, and only stamps a fetch every five
 * minutes, so it is an order of magnitude, not a ledger.
 */
export interface ComponentProps {
  status: FeedStatus;
  /** Injected by tests; the page passes nothing and gets the real clock. */
  now?: Date | undefined;
  /** "Last rotated N days ago" is for shared links, whose readers did not mint them. */
  showRotatedAgo?: boolean | undefined;
  idPrefix?: string | undefined;
}

const FeedStatusLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const now: Date = props.now || OneUptimeDate.getCurrentDate();
  const idPrefix: string = props.idPrefix || "calendar-feed";
  const status: FeedStatus = props.status;

  const parts: Array<string> = [];

  if (status.lastFetchedAt) {
    const fetched: Date = OneUptimeDate.fromString(status.lastFetchedAt);
    let sentence: string = `${translateString("Last fetched")} ${OneUptimeDate.fromNow(fetched)}`;

    if (status.lastFetchedClient) {
      sentence += ` ${translateString("by")} ${status.lastFetchedClient}`;
    }

    parts.push(sentence);

    if (status.fetchCount > 0) {
      parts.push(
        `~${status.fetchCount} ${translateString(status.fetchCount === 1 ? "fetch" : "fetches")}`,
      );
    }
  } else {
    parts.push(translateString("Not fetched yet") || "Not fetched yet");
  }

  if (status.tokenHint) {
    parts.push(`${translateString("link ending in")} …${status.tokenHint}`);
  }

  const rotatedDaysAgo: number | null = props.showRotatedAgo
    ? getRotatedDaysAgo(status.rotatedAt, now)
    : null;

  if (rotatedDaysAgo !== null) {
    parts.push(
      rotatedDaysAgo === 0
        ? translateString("Last rotated today") || "Last rotated today"
        : `${translateString("Last rotated")} ${rotatedDaysAgo} ${translateString(rotatedDaysAgo === 1 ? "day ago" : "days ago")}`,
    );
  }

  return (
    <div className="space-y-1">
      <div
        className="text-sm text-gray-500"
        data-testid={`${idPrefix}-status-line`}
      >
        {parts.join(" · ")}
      </div>
      {shouldShowNothingFetchedHint(status, now) && (
        <div
          className="text-sm text-amber-700"
          data-testid={`${idPrefix}-nothing-fetched-hint`}
        >
          {translateString(
            "Nothing has fetched this link yet. Is this server reachable from where your calendar app runs?",
          )}
        </div>
      )}
    </div>
  );
};

export default FeedStatusLine;
