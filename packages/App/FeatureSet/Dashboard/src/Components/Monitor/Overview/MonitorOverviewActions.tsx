import MonitorChangeStatusMenu from "./MonitorChangeStatusMenu";
import { HERO_ICON_BUTTON_CLASS_NAME } from "./MonitorOverviewHeroButton";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { useWriteDatesInSentenceLanguage } from "Common/UI/Utils/SentenceLanguage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { MonitorOverviewMoreActionKey } from "Common/Utils/Monitor/MonitorOverviewPresentationUtil";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * The top right of the monitor overview's hero: when the page last read the
 * monitor, Refresh, and - when the monitor has any - the More actions (⋯)
 * menu.
 *
 * Refresh only reads the page again; it does not run a check. It used to be
 * a "Refresh" button sitting over the pulse ("No automated checks", "Last
 * checked 2 minutes ago"), which read as if it ran one. Now it is an icon
 * button paired with the ⋯, its tooltip says what it does and that the page
 * refreshes itself every minute (useMonitorOverviewData's poll), and the
 * caption beside it says when the data on screen is from - a clock time,
 * like the failed-refresh notice's, so it holds still between refreshes and
 * reads the same in every language.
 */

export const MONITOR_OVERVIEW_ACTIONS_TEST_ID: string =
  "monitor-overview-actions";
export const MONITOR_OVERVIEW_REFRESH_TEST_ID: string =
  "monitor-overview-refresh";
export const MONITOR_OVERVIEW_REFRESHED_AT_TEST_ID: string =
  "monitor-overview-refreshed-at";
export const MONITOR_OVERVIEW_REFRESH_ANNOUNCEMENT_TEST_ID: string =
  "monitor-overview-refresh-announcement";

/*
 * When what is on screen loaded, as a clock time in the reader's zone. The
 * date is added once it is no longer today, so a page left open overnight
 * cannot point at the wrong 14:05.
 */
export const getLoadedAtText: (loadedAt: Date) => string = (
  loadedAt: Date,
): string => {
  const isToday: boolean =
    OneUptimeDate.getDateAsLocalDayMonthString(loadedAt) ===
    OneUptimeDate.getDateAsLocalDayMonthString(OneUptimeDate.getCurrentDate());

  if (!isToday) {
    return OneUptimeDate.getDateAsLocalShortDateTimeString(loadedAt);
  }

  return OneUptimeDate.getLocalTimeString(loadedAt, {
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
  });
};

/*
 * That time as a <time> element: machine readable, with the full date and
 * time on hover.
 */
export const LoadedAtTime: FunctionComponent<{ loadedAt: Date }> = (props: {
  loadedAt: Date;
}): ReactElement => {
  // In the language of the sentence it is drawn in.
  const writeDates: <T>(write: () => T) => T =
    useWriteDatesInSentenceLanguage();

  return (
    <time
      dateTime={OneUptimeDate.fromString(props.loadedAt).toISOString()}
      title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        props.loadedAt,
      )}
    >
      {writeDates((): string => {
        return getLoadedAtText(props.loadedAt);
      })}
    </time>
  );
};

export interface ComponentProps {
  monitorId: ObjectID;
  isRefreshing: boolean;
  refreshError: string;
  lastLoadedAt: Date | null;
  onRefresh: () => void;
  // What the ⋯ menu offers (MonitorOverviewPresentationUtil.getMoreActions).
  moreActions: Array<MonitorOverviewMoreActionKey>;
  // The status the monitor is in now: Change status leaves it out.
  currentStatusId?: string | undefined;
  // Told after Change status recorded a new status.
  onStatusChanged?: (() => void) | undefined;
}

const MonitorOverviewActions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * A screen reader hears nothing when the page quietly re-reads itself, so
   * a Refresh the reader pressed says when it is done - through a polite
   * status region, emptied when the press starts so the same words are
   * spoken again next time. A failure is the hero's alert's to announce;
   * the every-minute refresh announces nothing.
   */
  const [announcement, setAnnouncement] = useState<string>("");
  const isRefreshRequestedRef: MutableRefObject<boolean> =
    useRef<boolean>(false);
  const wasRefreshingRef: MutableRefObject<boolean> = useRef<boolean>(
    props.isRefreshing,
  );

  useEffect(() => {
    if (
      wasRefreshingRef.current &&
      !props.isRefreshing &&
      isRefreshRequestedRef.current
    ) {
      isRefreshRequestedRef.current = false;

      if (!props.refreshError) {
        setAnnouncement(
          translator.translateText("Monitor refreshed.") ||
            "Monitor refreshed.",
        );
      }
    }

    wasRefreshingRef.current = props.isRefreshing;
  }, [props.isRefreshing, props.refreshError]);

  const refresh: () => void = (): void => {
    // A read is already out; it brings the page up to date when it lands.
    if (props.isRefreshing) {
      return;
    }

    isRefreshRequestedRef.current = true;
    setAnnouncement("");
    props.onRefresh();
  };

  return (
    <div
      role="group"
      aria-label={translator.translateText("Monitor actions")}
      data-testid={MONITOR_OVERVIEW_ACTIONS_TEST_ID}
      className="-my-1.5 flex items-center justify-end gap-2"
    >
      {/*
       * From xl only. The actions' column is as wide as its widest line,
       * and the hero's text gets what is left of the row it shares with
       * the side menu: with the time beside the buttons at 1024px, a manual
       * monitor's explanation ran to five lines beside an empty column.
       * Below lg, on a tablet or a phone, the time would push the badges
       * onto lines of their own.
       */}
      {props.lastLoadedAt ? (
        <span
          data-testid={MONITOR_OVERVIEW_REFRESHED_AT_TEST_ID}
          className="max-xl:hidden xl:inline mr-1 whitespace-nowrap text-xs text-gray-500"
        >
          <TranslatedSentence
            template="Refreshed at {{time}}"
            slots={{ time: <LoadedAtTime loadedAt={props.lastLoadedAt} /> }}
          />
        </span>
      ) : (
        <></>
      )}

      {/*
       * aria-disabled, not disabled, while a read is out: a disabled button
       * drops the keyboard focus the press put on it.
       */}
      <Tooltip text="Refresh now. This page also refreshes every minute.">
        <button
          type="button"
          data-testid={MONITOR_OVERVIEW_REFRESH_TEST_ID}
          aria-label={translator.translateText("Refresh")}
          aria-disabled={props.isRefreshing}
          onClick={refresh}
          className={`${HERO_ICON_BUTTON_CLASS_NAME} ${
            props.isRefreshing ? "cursor-progress" : "cursor-pointer"
          }`}
        >
          <Icon
            icon={IconProp.Refresh}
            className={`h-4 w-4 ${
              props.isRefreshing
                ? "animate-spin motion-reduce:animate-none"
                : ""
            }`}
          />
        </button>
      </Tooltip>

      {props.moreActions.includes("changeStatus") ? (
        <MonitorChangeStatusMenu
          key={props.monitorId.toString()}
          monitorId={props.monitorId}
          currentStatusId={props.currentStatusId}
          onStatusChanged={props.onStatusChanged}
        />
      ) : (
        <></>
      )}

      <span
        role="status"
        className="sr-only"
        data-testid={MONITOR_OVERVIEW_REFRESH_ANNOUNCEMENT_TEST_ID}
      >
        {announcement}
      </span>
    </div>
  );
};

export default MonitorOverviewActions;
