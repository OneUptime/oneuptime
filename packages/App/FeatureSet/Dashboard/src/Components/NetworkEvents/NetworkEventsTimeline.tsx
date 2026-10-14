import {
  NETWORK_EVENT_KIND_TITLES,
  getNetworkEventTitle,
} from "./NetworkEventCopy";
import { NetworkEventRow, NetworkEventSubject } from "./NetworkEventsModel";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import { NetworkEventKind } from "Common/Types/NetworkEvent/NetworkEventType";
import ObjectID from "Common/Types/ObjectID";
import { FeedClock, getFeedClock } from "Common/UI/Components/Feed/FeedTime";
import {
  FeedTimelineDay,
  FeedTimelineEntry,
  FeedTimelineItem,
  FeedTimelineTime,
  buildFeedTimeline,
  hasFeedEntryFromToday,
} from "Common/UI/Components/Feed/FeedTimeline";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useClockTick from "Common/UI/Utils/UseClockTick";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useId,
  useMemo,
} from "react";

/*
 * THE EVENTS OF A PAGE, AS A TIMELINE.
 *
 * What the devices reported is read to work out what happened in what
 * order, so the list is laid out the way every activity feed in the product
 * is (Common/UI/Components/Feed): one heading per day with its full date
 * and the zone the times are in, each event's real time of day in the
 * reader's zone and language, and "12 min. ago" only where it helps - under
 * the time of an event from the last hour. Events of one minute share the
 * first one's time, so a burst reads as one moment.
 *
 *   Wednesday, October 14, 2026   Today   CEST
 *    2:28 AM   ● VPN tunnel down  Tunnel HQ-Branch1              fw-hq-01
 *   2 min. ago   IPSec Connection HQ-Branch1 between 10.171.4.117 and ...
 *
 * On a phone the time moves to the end of the event's first line and the
 * device under it, so the device's own words keep the screen's width.
 *
 * A row is a list item with one control - the event's name, which opens
 * what the device said. Its ::after covers the row, so a click anywhere on
 * it opens the event, while the device's link stays a link of its own.
 */

export interface ComponentProps {
  // The rows to draw, newest first.
  rows: Array<NetworkEventRow>;
  // On one device's page every row is that device's: it is not named again.
  showDevice: boolean;
  onOpen: (row: NetworkEventRow) => void;
  // The row whose details are open beside the list, by its id.
  openRowId?: string | undefined;
}

// The same sentence, and so the same translations, as the feeds' day headings.
const TIMES_ARE_IN: string = translationKey(
  "Times are in {{zone}}, your time zone.",
);

export const KIND_DOT_CLASS_NAMES: Record<NetworkEventKind, string> = {
  [NetworkEventKind.Problem]: "bg-red-500",
  [NetworkEventKind.Recovery]: "bg-emerald-500",
  [NetworkEventKind.Info]: "bg-gray-300",
};

/*
 * The columns of a row. On a phone: the kind's dot, the event, its time.
 * From sm: the time (as wide as the feeds' time column, which fits the
 * longest "N min. ago" the Dashboard's languages write), the dot and the
 * event. From lg the device - on the network's page - has a column of its
 * own at the right; below that it sits under the event's name, where a
 * tablet beside the side menu has no width to spare for a fourth column.
 */
const ROW_GRID_CLASS_NAME: string =
  "grid grid-cols-[0.625rem_minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 sm:grid-cols-[6.25rem_0.625rem_minmax(0,1fr)_auto]";

/*
 * From sm the time stands beside the event, down every line the event has:
 * its name, the device (below lg, where it has no column of its own) and
 * the device's words. It spans exactly the lines there are - a browser
 * gives a spanned line that holds nothing a height of its own, and every
 * row of the list would be that much taller. Full class names, so the
 * stylesheet is built with them.
 */
const TIME_ROWS_FROM_SM_CLASS_NAMES: Record<number, string> = {
  1: "sm:row-span-1",
  2: "sm:row-span-2",
  3: "sm:row-span-3",
};

const TIME_ROWS_FROM_LG_CLASS_NAMES: Record<number, string> = {
  1: "lg:row-span-1",
  2: "lg:row-span-2",
};

// A device's own Events page.
export function getDeviceEventsRoute(networkDeviceId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_VIEW_EVENTS] as Route,
    { modelId: new ObjectID(networkDeviceId) },
  );
}

export const UnknownSourceBadge: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span
      className="flex-shrink-0 whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200"
      data-testid="network-event-unknown-source"
    >
      {translator.translateText("Not a device yet")}
    </span>
  );
};

const SubjectText: FunctionComponent<{
  subject: NetworkEventSubject;
}> = (props: { subject: NetworkEventSubject }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span
      className="min-w-0 text-sm text-gray-500 [overflow-wrap:anywhere]"
      data-testid="network-event-subject"
    >
      {translator.translateText(props.subject.label)}{" "}
      <span className="font-medium text-gray-800">{props.subject.value}</span>
    </span>
  );
};

export const NetworkEventRowItem: FunctionComponent<{
  row: NetworkEventRow;
  // When it happened; absent for a log that came without a time.
  time?: FeedTimelineTime | undefined;
  showDevice: boolean;
  onOpen: (row: NetworkEventRow) => void;
  // Its details are open beside the list: the row says which one they are of.
  isOpen?: boolean | undefined;
}> = (props: {
  row: NetworkEventRow;
  time?: FeedTimelineTime | undefined;
  showDevice: boolean;
  onOpen: (row: NetworkEventRow) => void;
  isOpen?: boolean | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const row: NetworkEventRow = props.row;
  const title: string = getNetworkEventTitle(row.name, translator);
  const hasDevice: boolean = props.showDevice && Boolean(row.device);
  const time: FeedTimelineTime | undefined = props.time;
  const messageLines: number = row.message ? 1 : 0;
  const timeRowsClassName: string = `${
    TIME_ROWS_FROM_SM_CLASS_NAMES[1 + (hasDevice ? 1 : 0) + messageLines]
  } ${TIME_ROWS_FROM_LG_CLASS_NAMES[1 + messageLines]}`;

  return (
    <li
      className={`relative ${ROW_GRID_CLASS_NAME} rounded-md px-2 py-3 hover:bg-gray-50${
        props.isOpen ? " bg-gray-50" : ""
      }`}
      data-testid="network-event-row"
      data-event-name={row.name}
      data-event-kind={row.kind}
      data-open={props.isOpen ? "true" : undefined}
    >
      <div
        className={`col-start-3 row-start-1 whitespace-nowrap text-right text-xs sm:col-start-1 sm:pt-0.5 ${timeRowsClassName}`}
        data-testid="network-event-time"
      >
        {time && time.isShown ? (
          <Fragment>
            {/*
             * Above the row's control, so the full time shows on hover; a
             * click on it still opens the event, like the rest of the row.
             */}
            <span
              className="relative z-10 cursor-pointer"
              onClick={() => {
                props.onOpen(row);
              }}
            >
              <Tooltip text={time.fullLabel} lazy={true}>
                <time
                  dateTime={time.isoString}
                  className="font-medium tabular-nums text-gray-600"
                >
                  {time.label}
                  {time.zoneName ? (
                    <span className="ml-1 font-normal text-gray-500">
                      {time.zoneName}
                    </span>
                  ) : (
                    <></>
                  )}
                </time>
              </Tooltip>
            </span>
            {time.relativeHint ? (
              <div
                className="max-sm:hidden text-gray-500 sm:mt-0.5"
                data-testid="network-event-relative-time"
              >
                {time.relativeHint}
              </div>
            ) : (
              <></>
            )}
          </Fragment>
        ) : (
          <></>
        )}
        {time && !time.isShown ? (
          // The same minute as the row above: said once, for a screen reader each time.
          <time dateTime={time.isoString} className="sr-only">
            {time.label}
          </time>
        ) : (
          <></>
        )}
      </div>

      <span
        className={`col-start-1 row-start-1 mt-[0.3125rem] h-2.5 w-2.5 rounded-full sm:col-start-2 ${KIND_DOT_CLASS_NAMES[row.kind]}`}
        aria-hidden="true"
      />

      <div className="col-start-2 row-start-1 flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5 sm:col-start-3">
        {/*
         * The row's one control. Its ::after covers the whole row, so a
         * click anywhere on the row opens it, while the row stays a list
         * item and the device's link stays a link of its own.
         */}
        <button
          type="button"
          className="min-w-0 text-left text-sm font-semibold text-gray-900 [overflow-wrap:anywhere] after:absolute after:inset-0 after:rounded-md after:content-[''] focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-indigo-500"
          aria-haspopup="dialog"
          onClick={() => {
            props.onOpen(row);
          }}
          data-testid="network-event-open"
        >
          {title}
        </button>
        <span className="sr-only">
          {translator.translateText(NETWORK_EVENT_KIND_TITLES[row.kind])}
        </span>
        {row.subject ? <SubjectText subject={row.subject} /> : <></>}
      </div>

      {hasDevice ? (
        <div
          className="col-span-2 col-start-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-5 sm:col-start-3 lg:col-span-1 lg:col-start-4 lg:row-start-1 lg:max-w-[13rem] lg:flex-nowrap lg:justify-end lg:self-start xl:max-w-[20rem]"
          data-testid="network-event-device"
        >
          {/*
           * A long name is cut to the column, and said whole on hover: the
           * name sits above the row's control for that, so the link goes to
           * the device - and a name that is no link still opens the event.
           */}
          {row.networkDeviceId ? (
            <span className="relative z-10 min-w-0 truncate" title={row.device}>
              <AppLink
                to={getDeviceEventsRoute(row.networkDeviceId)}
                className="font-medium text-gray-700 hover:text-indigo-600 hover:underline"
              >
                {row.device}
              </AppLink>
            </span>
          ) : (
            <span
              className="relative z-10 min-w-0 cursor-pointer truncate font-medium text-gray-700"
              title={row.device}
              onClick={() => {
                props.onOpen(row);
              }}
            >
              {row.device}
            </span>
          )}
          {row.isFromUnknownSource ? (
            <span className="flex lg:order-first">
              <UnknownSourceBadge />
            </span>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}

      {row.message ? (
        <div
          className={`col-span-2 col-start-2 ${
            hasDevice ? "row-start-3 lg:row-start-2" : "row-start-2"
          } line-clamp-2 min-w-0 font-mono text-xs text-gray-500 [overflow-wrap:anywhere] sm:col-start-3 sm:line-clamp-1`}
          data-testid="network-event-message"
        >
          {row.message}
        </div>
      ) : (
        <></>
      )}
    </li>
  );
};

interface TimelineItem extends FeedTimelineItem {
  row: NetworkEventRow;
}

const NetworkEventsTimeline: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // Two lists on one page must not share their headings' ids.
  const idPrefix: string = useId();

  /*
   * A log always comes with its time; one that somehow does not is listed
   * after the days, without one, rather than under a day it was not on.
   */
  const timed: Array<TimelineItem> = useMemo((): Array<TimelineItem> => {
    const items: Array<TimelineItem> = [];

    for (const row of props.rows) {
      if (row.time) {
        items.push({ key: row.id, itemDateTime: row.time, row: row });
      }
    }

    return items;
  }, [props.rows]);

  const untimed: Array<NetworkEventRow> = props.rows.filter(
    (row: NetworkEventRow): boolean => {
      return !row.time;
    },
  );

  /*
   * While anything shown is from today the clock is re-read once a minute,
   * so "12 min. ago" moves on and "Today" turns into "Yesterday" at
   * midnight; a list of older events runs no timer.
   */
  const startingClock: FeedClock = getFeedClock({
    language: translator.language,
  });
  const isTicking: boolean = hasFeedEntryFromToday(timed, startingClock);
  const now: Date = useClockTick(false, { isEnabled: isTicking });

  const clock: FeedClock = useMemo((): FeedClock => {
    return getFeedClock({ language: translator.language, now: now });
  }, [translator.language, now]);

  const days: Array<FeedTimelineDay<TimelineItem>> = useMemo((): Array<
    FeedTimelineDay<TimelineItem>
  > => {
    return buildFeedTimeline<TimelineItem>({ items: timed, clock: clock });
  }, [timed, clock]);

  return (
    /*
     * A row is padded so its hover and focus have room to show (px-2). The
     * list reaches that far past the card's own padding on both sides, so
     * what a row says still lines up with the card's title, its filters
     * and its buttons.
     */
    <div className="-mx-2 mt-5 space-y-5" data-testid="network-events-list">
      {days.map((day: FeedTimelineDay<TimelineItem>): ReactElement => {
        const headingId: string = `${idPrefix}-day-${day.dayKey}`;

        return (
          <section
            key={day.dayKey}
            aria-labelledby={headingId}
            data-testid="network-events-day"
          >
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 px-2">
              <h3
                id={headingId}
                className="text-sm font-semibold text-gray-900"
                data-testid="network-events-day-heading"
              >
                {day.label}
              </h3>
              {day.relativeLabel ? (
                <span
                  className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
                  data-testid="network-events-day-relative"
                >
                  {day.relativeLabel}
                </span>
              ) : (
                <></>
              )}
              {day.zoneName ? (
                <Tooltip
                  text={translator.translateTemplate(TIMES_ARE_IN, {
                    zone: day.zoneName,
                  })}
                >
                  <span
                    className="text-xs text-gray-500"
                    data-testid="network-events-day-zone"
                  >
                    {day.zoneName}
                  </span>
                </Tooltip>
              ) : (
                <></>
              )}
              <span
                className="h-px min-w-4 flex-1 bg-gray-100"
                aria-hidden="true"
              />
            </div>
            <ol role="list" className="divide-y divide-gray-100">
              {day.entries.map(
                (entry: FeedTimelineEntry<TimelineItem>): ReactElement => {
                  return (
                    <NetworkEventRowItem
                      key={entry.item.key}
                      row={entry.item.row}
                      time={entry.time}
                      showDevice={props.showDevice}
                      onOpen={props.onOpen}
                      isOpen={entry.item.row.id === props.openRowId}
                    />
                  );
                },
              )}
            </ol>
          </section>
        );
      })}
      {untimed.length > 0 ? (
        <ol role="list" className="divide-y divide-gray-100">
          {untimed.map((row: NetworkEventRow): ReactElement => {
            return (
              <NetworkEventRowItem
                key={row.id}
                row={row}
                showDevice={props.showDevice}
                onOpen={props.onOpen}
                isOpen={row.id === props.openRowId}
              />
            );
          })}
        </ol>
      ) : (
        <></>
      )}
    </div>
  );
};

export default NetworkEventsTimeline;
