import { FeedUrls } from "./CalendarFeed/CalendarFeedTypes";
import { applyScheduleFilter } from "./CalendarFeed/CalendarFeedUtil";
import FeedLinkField from "./CalendarFeed/FeedLinkField";
import CalendarSubscriptionLinks from "Common/Types/Calendar/CalendarSubscriptionLinks";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ProviderLogo from "Common/Types/ProviderLogo/ProviderLogo";
import Icon from "Common/UI/Components/Icon/Icon";
import ProviderLogoImage from "Common/UI/Components/ProviderLogo/ProviderLogoImage";
import ProviderLogoOrIcon from "Common/UI/Components/ProviderLogo/ProviderLogoOrIcon";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The "put this in your calendar" block that every feed surface shares: one
 * subscribe flow, in the order people use it.
 *
 *   1. Add to your calendar - one option per app, each saying what it opens.
 *      "Google Calendar" opens Google's add-by-URL page, which asks to add
 *      the calendar; "Apple Calendar / Outlook" opens the webcal:// link,
 *      which the operating system hands to the calendar app registered for
 *      subscriptions (Apple Calendar on a Mac, iPhone or iPad, Outlook on
 *      Windows).
 *   2. Or copy the link - for every other app: Outlook on the web,
 *      Thunderbird, or Google's own "From URL" box. One field holds the
 *      link, Show / Hide and Copy link (FeedLinkField).
 *
 * What the link's state is - whether a calendar app has read it, Google's
 * refresh schedule, the server's warnings - is the card's to say, next to
 * this block (FeedStatusPanel), not inside it: this block is what a reader
 * does, the panel is what they check.
 *
 * Both subscribe links are built here from the https address, never taken
 * from the payload (CalendarSubscriptionLinks): Google's `cid` must carry the
 * webcal:// address - with https:// Google answers "Unable to add calendar.
 * Check the URL." - and the webcal link must be webcal://, which every
 * platform opens, not webcals://, which iOS refuses. The two options are real
 * links (an <a> each) so they can be opened in a new tab, and neither shows
 * the address on the page.
 */
export interface ComponentProps {
  urls: FeedUrls;
  /**
   * Personal feeds accept a `schedule` filter; when set, every link is
   * narrowed to that schedule.
   */
  scheduleId?: ObjectID | string | undefined;
  // The last four characters of the token, shown at the end of the hidden link.
  tokenHint?: string | null | undefined;
  /** Prefix for the data-testids, so two blocks on one page stay distinct. */
  idPrefix?: string | undefined;
  /*
   * The block has its card's whole width to itself (the schedule page's
   * "Only my shifts on this schedule"), rather than sharing it with the
   * status from xl up (FeedStatusPanel beside it).
   */
  isAlone?: boolean | undefined;
}

/*
 * One subscribe option: a tile with the app's mark, its name and what a
 * click does. The colours are the classes Theme.css remaps for dark mode.
 *
 * The mark is Google Calendar's official logo for Google Calendar, and a
 * calendar for "the calendar app on this device" - two apps, so no one
 * brand's logo - on the same neutral tile, so the pair reads as one set
 * (Common/UI/Components/ProviderLogo).
 */
export const SUBSCRIBE_OPTION_CLASS_NAME: string =
  "group flex min-w-0 items-center gap-3 rounded-lg border border-gray-200 bg-white px-3.5 py-3 shadow-sm transition-colors duration-150 ease-out hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

/*
 * The two options side by side only where each gets about 270px - enough
 * for "Apple Calendar / Outlook" and what it opens on one line each - and
 * one above the other everywhere else. The breakpoints are the screen's, so
 * they follow what the screen leaves the block: the whole width of a phone
 * turned sideways (sm); a card squeezed beside the side menu (md: one above
 * the other); the card's width with the menu beside it (lg); a column three
 * fifths of the card, beside the status (xl: one above the other); and that
 * column on a wide screen (2xl).
 */
export const SUBSCRIBE_OPTIONS_GRID_CLASS_NAME: string =
  "mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2";

/*
 * The block on its own across a card: side by side from lg up, and no wider
 * than a comfortable reading measure, so two tiles never stretch across a
 * 1,300px card.
 */
export const SUBSCRIBE_OPTIONS_ALONE_GRID_CLASS_NAME: string =
  "mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2";

export const SUBSCRIBE_BLOCK_ALONE_CLASS_NAME: string = "max-w-3xl";

/*
 * What a click on an option does, under its name. Wrapped the way a person
 * would set it: on a phone "Opens Google Calendar in a new tab" breaks
 * before "new tab" rather than leaving "tab" alone on the second line.
 */
export const SUBSCRIBE_OPTION_HINT_CLASS_NAME: string =
  "mt-0.5 text-pretty text-xs leading-5 text-gray-500";

// A section's heading in the block, and in the status panel beside it.
export const FEED_SECTION_HEADING_CLASS_NAME: string =
  "text-sm font-semibold text-gray-900";

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

  const addHeadingId: string = `${idPrefix}-add-heading`;
  const copyHeadingId: string = `${idPrefix}-copy-heading`;

  return (
    <div
      className={`space-y-6 ${props.isAlone ? SUBSCRIBE_BLOCK_ALONE_CLASS_NAME : ""}`}
      data-testid={`${idPrefix}-links`}
    >
      <section aria-labelledby={addHeadingId}>
        <h3 id={addHeadingId} className={FEED_SECTION_HEADING_CLASS_NAME}>
          {translateString("Add to your calendar")}
        </h3>
        <div
          className={
            props.isAlone
              ? SUBSCRIBE_OPTIONS_ALONE_GRID_CLASS_NAME
              : SUBSCRIBE_OPTIONS_GRID_CLASS_NAME
          }
        >
          <a
            href={urls.googleAdd}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`${idPrefix}-google`}
            className={SUBSCRIBE_OPTION_CLASS_NAME}
            title={
              translateString(
                "Opens Google Calendar, which asks you to add this calendar.",
              ) || undefined
            }
          >
            {/* The name is written beside it, so the logo is not read out. */}
            <ProviderLogoImage
              logo={ProviderLogo.GoogleCalendar}
              size={36}
              isDecorative={true}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-gray-900">
                {translateString("Google Calendar")}
              </div>
              <div className={SUBSCRIBE_OPTION_HINT_CLASS_NAME}>
                {translateString("Opens Google Calendar in a new tab")}
              </div>
            </div>
            <Icon
              icon={IconProp.ExternalLink}
              className="h-4 w-4 flex-none text-gray-400 group-hover:text-gray-600"
            />
          </a>
          <a
            href={urls.webcal}
            data-testid={`${idPrefix}-webcal`}
            className={SUBSCRIBE_OPTION_CLASS_NAME}
            title={
              translateString(
                "Opens the calendar app on this device that subscribes to calendar links: Apple Calendar on a Mac, iPhone or iPad, or Outlook on Windows.",
              ) || undefined
            }
          >
            <ProviderLogoOrIcon
              icon={IconProp.Calendar}
              size={36}
              isDecorative={true}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-gray-900">
                {translateString("Apple Calendar / Outlook")}
              </div>
              <div className={SUBSCRIBE_OPTION_HINT_CLASS_NAME}>
                {translateString("Opens the calendar app on this device")}
              </div>
            </div>
            <Icon
              icon={IconProp.ChevronRight}
              className="h-4 w-4 flex-none text-gray-400 group-hover:text-gray-600"
            />
          </a>
        </div>
      </section>

      <section aria-labelledby={copyHeadingId}>
        <h3 id={copyHeadingId} className={FEED_SECTION_HEADING_CLASS_NAME}>
          {translateString("Or copy the link")}
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          {translateString(
            "Paste it into any calendar app that can subscribe to a calendar by URL.",
          )}
        </p>
        <div className="mt-3">
          <FeedLinkField
            url={urls.https}
            tokenHint={props.tokenHint}
            idPrefix={idPrefix}
          />
        </div>
      </section>
    </div>
  );
};

export default CalendarFeedLinks;
