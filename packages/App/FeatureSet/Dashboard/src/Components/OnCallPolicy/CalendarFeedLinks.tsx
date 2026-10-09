import { FeedUrls } from "./CalendarFeed/CalendarFeedTypes";
import {
  CALENDAR_FEED_DOCS_PATH,
  REACHABILITY_COPY,
  REFRESH_CADENCE_COPY,
  applyScheduleFilter,
} from "./CalendarFeed/CalendarFeedUtil";
import FeedDeploymentWarnings from "./CalendarFeed/FeedDeploymentWarnings";
import URL from "Common/Types/API/URL";
import CalendarSubscriptionLinks from "Common/Types/Calendar/CalendarSubscriptionLinks";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import HiddenText from "Common/UI/Components/HiddenText/HiddenText";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { BILLING_ENABLED, DOCS_URL } from "Common/UI/Config";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The "put this in your calendar" block that every feed surface shares: one
 * subscribe flow, in the order people use it.
 *
 *   1. Add to your calendar - two one-click buttons. "Google Calendar" opens
 *      Google's add-by-URL page, which asks to add the calendar; "Apple
 *      Calendar / Outlook" opens the webcal:// link, which the operating
 *      system hands to the calendar app registered for subscriptions (Apple
 *      Calendar on a Mac, iPhone or iPad, Outlook on Windows).
 *   2. Or copy the link - for every other app: Outlook on the web, Thunderbird,
 *      or Google's own "From URL" box.
 *   3. A short note: Google refreshes on its own schedule (hours, sometimes a
 *      day), and - on a self-hosted install - Google reads the link from its
 *      own servers, so the server must be reachable from the internet.
 *
 * Both subscribe links are built here from the https address, never taken
 * from the payload (CalendarSubscriptionLinks): Google's `cid` must carry the
 * webcal:// address - with https:// Google answers "Unable to add calendar.
 * Check the URL." - and the webcal link must be webcal://, which every
 * platform opens, not webcals://, which iOS refuses.
 *
 * Why the link is hidden until clicked. The URL IS the credential: anyone who
 * has it can read the shifts. HiddenText keeps it off a shared screen until
 * the reader asks, and the copy button moves it to the clipboard without ever
 * showing it. The two buttons are real links (an <a> each) so they can be
 * opened in a new tab, and neither shows the address on the page.
 */
export interface ComponentProps {
  urls: FeedUrls;
  /**
   * Personal feeds accept a `schedule` filter; when set, every link is
   * narrowed to that schedule.
   */
  scheduleId?: ObjectID | string | undefined;
  hostWarning?: string | null | undefined;
  protocolWarning?: string | null | undefined;
  privateHost?: string | null | undefined;
  lastRenderTruncated?: boolean | undefined;
  /** The refresh note; off when the page renders it once elsewhere. */
  showRefreshAlert?: boolean | undefined;
  /** Prefix for the data-testids, so two blocks on one page stay distinct. */
  idPrefix?: string | undefined;
}

/*
 * The look of an outline button, for the two subscribe links. Kept in step
 * with Button's NORMAL style (border, white, gray text) so the pair reads as
 * two buttons of equal weight; colours are the classes Theme.css remaps for
 * dark mode. Full width on a phone, where two unequal buttons stacked under
 * each other read as a mistake.
 */
export const SUBSCRIBE_LINK_CLASS_NAME: string =
  "inline-flex w-full items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors duration-150 ease-out hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 sm:w-auto";

const CalendarFeedLinks: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const idPrefix: string = props.idPrefix || "calendar-feed";

  const urls: FeedUrls = CalendarSubscriptionLinks.build(
    applyScheduleFilter(
      props.urls,
      props.scheduleId ? props.scheduleId.toString() : null,
    ).https,
  );

  const docsUrl: URL = URL.fromString(DOCS_URL.toString()).addRoute(
    CALENDAR_FEED_DOCS_PATH,
  );

  /*
   * OneUptime Cloud is always reachable from the internet, so the sentence
   * only earns its place on a self-hosted install - and not there either
   * when a warning above already says this server cannot be reached.
   */
  const showReachability: boolean =
    !BILLING_ENABLED && !props.hostWarning && !props.privateHost;

  return (
    <div className="space-y-5" data-testid={`${idPrefix}-links`}>
      <div>
        <div className="text-sm font-medium text-gray-900">
          {translateString("Add to your calendar")}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <a
            href={urls.googleAdd}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`${idPrefix}-google`}
            className={SUBSCRIBE_LINK_CLASS_NAME}
            title={
              translateString(
                "Opens Google Calendar, which asks you to add this calendar.",
              ) || undefined
            }
          >
            <Icon
              icon={IconProp.Calendar}
              className="h-4 w-4 flex-none text-gray-500"
            />
            <span>{translateString("Google Calendar")}</span>
            <Icon
              icon={IconProp.ExternalLink}
              className="h-3.5 w-3.5 flex-none text-gray-400"
            />
          </a>
          <a
            href={urls.webcal}
            data-testid={`${idPrefix}-webcal`}
            className={SUBSCRIBE_LINK_CLASS_NAME}
            title={
              translateString(
                "Opens the calendar app on this device that subscribes to calendar links: Apple Calendar on a Mac, iPhone or iPad, or Outlook on Windows.",
              ) || undefined
            }
          >
            <Icon
              icon={IconProp.Calendar}
              className="h-4 w-4 flex-none text-gray-500"
            />
            <span>{translateString("Apple Calendar / Outlook")}</span>
          </a>
        </div>
      </div>

      <div>
        <div className="text-sm font-medium text-gray-900">
          {translateString("Or copy the link")}
        </div>
        <div className="text-sm text-gray-500">
          {translateString(
            "Paste it into any calendar app that can subscribe to a calendar by URL.",
          )}
        </div>
        <div
          className="mt-2 flex flex-wrap items-center gap-2"
          data-testid={`${idPrefix}-copy`}
        >
          <HiddenText text={urls.https} isCopyable={true} />
          <CopyTextButton
            textToBeCopied={urls.https}
            label={translateString("Copy link") || "Copy link"}
            copiedLabel={translateString("Copied!") || "Copied!"}
            size="md"
            variant="soft"
            title={translateString("Copy https link") || "Copy https link"}
          />
        </div>
      </div>

      <FeedDeploymentWarnings
        hostWarning={props.hostWarning}
        protocolWarning={props.protocolWarning}
        privateHost={props.privateHost}
        idPrefix={idPrefix}
      />

      {props.lastRenderTruncated && (
        <Alert
          type={AlertType.WARNING}
          title={
            translateString(
              "The last calendar was shortened because it would have exceeded the event limit. Reduce the days ahead in the settings to see every shift.",
            ) || ""
          }
          dataTestId={`${idPrefix}-truncated-warning`}
        />
      )}

      {props.showRefreshAlert !== false && (
        <div
          className="flex gap-2 text-sm text-gray-500"
          data-testid={`${idPrefix}-refresh-alert`}
        >
          <Icon
            icon={IconProp.Info}
            className="mt-0.5 h-4 w-4 flex-none text-gray-400"
          />
          <div className="space-y-1">
            <div>{translateString(REFRESH_CADENCE_COPY)}</div>
            {showReachability && (
              <div data-testid={`${idPrefix}-reachability`}>
                {translateString(REACHABILITY_COPY)}
              </div>
            )}
            <div>
              <Link
                to={docsUrl}
                openInNewTab={true}
                className="font-medium text-indigo-600 hover:underline"
              >
                {translateString("Troubleshooting and per-app steps")}
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarFeedLinks;
