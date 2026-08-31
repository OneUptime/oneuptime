import { FeedUrls } from "./CalendarFeed/CalendarFeedTypes";
import {
  CALENDAR_FEED_DOCS_PATH,
  REACHABILITY_COPY,
  REFRESH_CADENCE_COPY,
  applyScheduleFilter,
} from "./CalendarFeed/CalendarFeedUtil";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import HiddenText from "Common/UI/Components/HiddenText/HiddenText";
import Link from "Common/UI/Components/Link/Link";
import { DOCS_URL } from "Common/UI/Config";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The "put this in your calendar" block that every feed surface shares: the
 * https link itself, the three ways of subscribing, the warnings the server
 * attached to the link, and the refresh-cadence note.
 *
 * Why three buttons and not one. Google Calendar only subscribes through its
 * own "From URL" page, Apple Calendar and most desktop clients register the
 * webcal:// scheme, and Outlook has no reliable deep link at all - it wants
 * the webcal URL pasted into "Subscribe from web". One button that guessed
 * would be wrong for two of the three.
 *
 * Why the link is hidden until clicked. The URL IS the credential: anyone who
 * has it can read the shifts. HiddenText keeps it off a shared screen until
 * the reader asks, and the copy button lets them move it to a clipboard
 * without ever showing it.
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
  lastRenderTruncated?: boolean | undefined;
  /** The refresh-cadence note; off when the page renders it once elsewhere. */
  showRefreshAlert?: boolean | undefined;
  /** Prefix for the data-testids, so two blocks on one page stay distinct. */
  idPrefix?: string | undefined;
}

const CalendarFeedLinks: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const idPrefix: string = props.idPrefix || "calendar-feed";

  const urls: FeedUrls = applyScheduleFilter(
    props.urls,
    props.scheduleId ? props.scheduleId.toString() : null,
  );

  const docsUrl: URL = URL.fromString(DOCS_URL.toString()).addRoute(
    CALENDAR_FEED_DOCS_PATH,
  );

  const openGoogleCalendar: () => void = (): void => {
    window.open(urls.googleAdd, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-4" data-testid={`${idPrefix}-links`}>
      <div>
        <div className="text-sm font-medium text-gray-700 mb-1">
          {translateString("Calendar link")}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HiddenText text={urls.https} isCopyable={true} />
          <CopyTextButton
            textToBeCopied={urls.https}
            label={translateString("Copy link") || "Copy link"}
            copiedLabel={translateString("Copied!") || "Copied!"}
            size="sm"
            variant="soft"
            title={translateString("Copy https link") || "Copy https link"}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          title={translateString("Google Calendar") || "Google Calendar"}
          icon={IconProp.Calendar}
          buttonStyle={ButtonStyleType.OUTLINE}
          onClick={openGoogleCalendar}
          dataTestId={`${idPrefix}-google`}
          tooltip={
            translateString(
              "Opens Google Calendar's 'From URL' page with this link filled in.",
            ) || undefined
          }
        />
        <a
          href={urls.webcal}
          data-testid={`${idPrefix}-webcal`}
          className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          title={
            translateString(
              "Opens the webcal link in the app registered for calendar subscriptions.",
            ) || undefined
          }
        >
          {translateString("Apple / other apps")}
        </a>
        <CopyTextButton
          textToBeCopied={urls.webcal}
          label={translateString("Copy webcal link") || "Copy webcal link"}
          copiedLabel={translateString("Copied!") || "Copied!"}
          size="md"
          variant="ghost"
          title={
            translateString(
              "Outlook: Add calendar, then Subscribe from web, then paste this link.",
            ) ||
            "Outlook: Add calendar, then Subscribe from web, then paste this link."
          }
        />
      </div>

      {props.hostWarning && (
        <Alert
          type={AlertType.WARNING}
          title={props.hostWarning}
          dataTestId={`${idPrefix}-host-warning`}
        />
      )}

      {props.protocolWarning && (
        <Alert
          type={AlertType.WARNING}
          title={props.protocolWarning}
          dataTestId={`${idPrefix}-protocol-warning`}
        />
      )}

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
        <Alert
          type={AlertType.INFO}
          dataTestId={`${idPrefix}-refresh-alert`}
          title={
            <div className="space-y-1">
              <div>{translateString(REFRESH_CADENCE_COPY)}</div>
              <div>{translateString(REACHABILITY_COPY)}</div>
              <div>
                <Link to={docsUrl} openInNewTab={true} className="underline">
                  {translateString("Troubleshooting and per-app steps")}
                </Link>
              </div>
            </div>
          }
        />
      )}
    </div>
  );
};

export default CalendarFeedLinks;
