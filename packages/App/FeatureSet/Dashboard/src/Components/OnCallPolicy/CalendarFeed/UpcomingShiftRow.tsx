import { NO_BREAK_SPACE } from "./FeedStatusPanel";
import { UpcomingShiftSpan, getCoverWindowForSpan } from "./UpcomingShiftSpans";
import {
  ShiftDateTile,
  formatShiftDateTime,
  formatShiftEnd,
  formatShiftFullDateTime,
  formatShiftLength,
  formatShiftTime,
  getShiftDateTile,
  getShiftDayLabel,
  getShiftLength,
  isSameShiftDay,
} from "./UpcomingShiftTime";
import PageMap from "../../../Utils/PageMap";
import RouteMap from "../../../Utils/RouteMap";
import RouteParams from "../../../Utils/RouteParams";
import Route from "Common/Types/API/Route";
import {
  UserOverrideCoverWindow,
  getUserOverrideCoverQueryParams,
} from "Common/Types/OnCallDutyPolicy/UserOverrideCoverRequest";
import { FeedClock } from "Common/UI/Components/Feed/FeedTime";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One stretch on call in the Upcoming shifts list.
 *
 *   [Oct]  Tomorrow · 09:00 – 17:00                        8 hours
 *   [ 15]  Primary on-call · Weekdays                     Get cover
 *
 * The date tile carries the day the span starts on, so the eye can run down
 * the dates; the line beside it says the day in words and the times, then
 * where (the schedule, its layer when that helps, the project when the list
 * holds more than one) and anything that makes the span different (cover
 * for someone else, a policy it is the only shift on). How long it lasts
 * and "Get cover" sit together at the row's end - side by side under the
 * text on a phone, one under the other at the right from sm up - inside a
 * list no wider than a comfortable reading measure, so on a wide screen
 * they are never a screen away from the row they belong to.
 *
 * The span you are on call for now is today's tile in green, says "On call
 * now" and when it ends, and how much of it is left.
 */
export interface ComponentProps {
  span: UpcomingShiftSpan;
  clock: FeedClock;
  showLayerName: boolean;
  showProjectName: boolean;
}

export const UPCOMING_SHIFT_ROW_CLASS_NAME: string =
  "flex items-start gap-3 px-4 py-3.5 sm:gap-4 sm:px-5";

/*
 * The date tile: the month over the day, like a page of a desk calendar.
 * Green, on today's date, for the span you are on call for now. Its width
 * never depends on a word: "Maintenant" or "Сейчас" would not fit it.
 */
export const UPCOMING_SHIFT_TILE_CLASS_NAME: string =
  "flex h-12 w-12 flex-none flex-col items-center justify-center rounded-lg border border-gray-200 bg-white text-center";

export const UPCOMING_SHIFT_NOW_TILE_CLASS_NAME: string =
  "flex h-12 w-12 flex-none flex-col items-center justify-center rounded-lg border border-green-200 bg-green-50 text-center";

export const UPCOMING_SHIFT_TILE_MONTH_CLASS_NAME: string =
  "max-w-full truncate px-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide";

export const UPCOMING_SHIFT_TILE_DAY_CLASS_NAME: string =
  "mt-1 text-lg font-semibold leading-none";

/*
 * The day and the times. On a 320px phone this column is some 150px wide,
 * so every part of it may wrap - the day's label too ("Сейчас на
 * дежурстве" is wider than that) - except a time, which never breaks
 * inside itself.
 */
export const UPCOMING_SHIFT_WHEN_CLASS_NAME: string =
  "text-sm leading-6 text-gray-900";

/*
 * The facts that make a span different from a plain shift of yours, in the
 * pill shape the link card's status uses. Its corners are a pill's on one
 * line and a soft box's when a long name wraps it onto three, where a full
 * rounding drew a stadium. Colours Theme.css remaps.
 */
export const UPCOMING_SHIFT_BADGE_CLASS_NAME: string =
  "inline-flex max-w-full items-center rounded-xl px-2 py-0.5 text-xs font-medium ring-1 ring-inset";

export const UPCOMING_SHIFT_COVERING_BADGE_CLASS_NAME: string =
  "bg-blue-50 text-blue-700 ring-blue-200";

export const UPCOMING_SHIFT_POLICY_BADGE_CLASS_NAME: string =
  "bg-purple-50 text-purple-700 ring-purple-200";

/*
 * The row beside the tile: its text, then its end (how long, and Get
 * cover). Where the end goes is the screen's choice, never the text's: on
 * a phone it comes under the text on every row; from sm up it stands at
 * the row's right edge on every row, and the text wraps in what is left.
 * Left to wrap on its own, the end sat beside a short row and under a long
 * one - and from sm up a wrapped end kept its right-aligned stack at the
 * LEFT, so on a 768px tablet with the side menu, or a 900px window, every
 * other row had Get cover in a different place.
 */
export const UPCOMING_SHIFT_BODY_CLASS_NAME: string =
  "flex min-w-0 flex-1 flex-col gap-y-2 sm:flex-row sm:items-start sm:gap-x-6";

export const UPCOMING_SHIFT_TEXT_CLASS_NAME: string = "min-w-0 sm:flex-1";

/*
 * How long and Get cover, at the row's end. From sm up they stand under
 * each other at the right of the row and keep their width. On a phone they
 * come under the text, side by side while they fit and one under the other
 * when they do not - "Noch mindestens 31 Tage" and "Vertretung finden" are
 * wider together than a 360px phone leaves them - so the page never scrolls
 * sideways.
 */
export const UPCOMING_SHIFT_END_CLASS_NAME: string =
  "flex min-w-0 flex-wrap items-center gap-x-4 gap-y-0.5 sm:flex-none sm:flex-col sm:flex-nowrap sm:items-end";

/*
 * Get cover: a link to Add User Override, with the focus ring the card's
 * other controls draw (the fold under the list) rather than the browser's
 * own outline.
 */
export const UPCOMING_SHIFT_COVER_CLASS_NAME: string =
  "whitespace-nowrap rounded-sm text-sm font-medium leading-6 text-indigo-600 hover:text-indigo-500 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

/*
 * The dot between two facts. Its spaces are inside it, so a line that has
 * to break can: a separator drawn with margins and no spaces glued the
 * facts on both sides into one unbreakable word, which ran past a 320px
 * phone in Russian. The space before the dot does not break, so a line
 * never starts with one.
 */
export const UPCOMING_SHIFT_SEPARATOR: string = `${NO_BREAK_SPACE}· `;

/*
 * The dot's grey: quieter than the words it parts, but there - gray-300
 * all but vanished on white, and Theme.css drew it as bright as the text
 * in the dark theme. The link card's status line parts its facts with a
 * dot in the line's own grey.
 */
export const UPCOMING_SHIFT_SEPARATOR_CLASS_NAME: string = "text-gray-400";

const SEPARATOR: ReactElement = (
  <span
    className={UPCOMING_SHIFT_SEPARATOR_CLASS_NAME}
    aria-hidden="true"
    data-testid="upcoming-shift-separator"
  >
    {UPCOMING_SHIFT_SEPARATOR}
  </span>
);

// A time that never breaks inside itself: "Sun, Oct 18, 07:00".
const Unbroken: (text: string) => ReactElement = (
  text: string,
): ReactElement => {
  return <span className="whitespace-nowrap">{text}</span>;
};

/*
 * The word next to a time of day keeps to it: "bis" is never left at the
 * end of one line with "22:00" on the next. Only a time of day: glued to a
 * whole date ("до пт, 13 нояб., 19:20") the pair would be wider than a
 * 320px phone's column. The spaces between a phrase's words still break.
 */
export const keepWithTime: (text: string) => string = (
  text: string,
): string => {
  let kept: string = text;

  if (kept.startsWith(" ")) {
    kept = `${NO_BREAK_SPACE}${kept.slice(1)}`;
  }

  if (kept.endsWith(" ")) {
    kept = `${kept.slice(0, -1)}${NO_BREAK_SPACE}`;
  }

  return kept;
};

const UpcomingShiftRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const span: UpcomingShiftSpan = props.span;
  const clock: FeedClock = props.clock;
  const now: Date = clock.now;

  /*
   * "Get cover" opens Add User Override in the span's own project, with you
   * away for the span's window (UserOverrideCoverRequest), so the one
   * question left is who covers. A span that exists only inside one policy
   * - a policy-scoped override made it - is covered on that policy's page,
   * or the cover would not apply to it.
   */
  const coverWindow: UserOverrideCoverWindow | null = getCoverWindowForSpan(
    span,
    now,
  );

  let coverRoute: Route | null = null;

  if (coverWindow) {
    const policyId: string | undefined = span.policyVariant?.policyId;

    coverRoute = new Route(
      (
        RouteMap[
          policyId
            ? PageMap.ON_CALL_DUTY_POLICY_VIEW_USER_OVERRIDES
            : PageMap.ON_CALL_DUTY_POLICY_USER_OVERRIDES
        ] as Route
      ).toString(),
    ).addRouteParam(RouteParams.ProjectID, span.projectId);

    if (policyId) {
      coverRoute.addRouteParam(RouteParams.ModelID, policyId);
    }

    coverRoute.addQueryParams(getUserOverrideCoverQueryParams(coverWindow));
  }

  const fullRange: string = `${formatShiftFullDateTime(
    span.start,
    clock,
  )} – ${formatShiftFullDateTime(span.end, clock)}`;

  /*
   * How long, from the start - or, on call now, what is left of it, as
   * calmly as it can be said: the row already says the end to the minute.
   */
  const length: string = formatShiftLength(
    getShiftLength({
      start: span.isOnCallNow ? now : span.start,
      end: span.end,
      timezone: clock.timezone,
    }),
    clock.language,
    span.isOnCallNow ? { isTimeLeft: true } : undefined,
  );

  let lengthText: string = length;

  if (span.isOnCallNow) {
    lengthText = translator.translateTemplate(
      span.mayContinue ? "At least {{duration}} left" : "{{duration}} left",
      { duration: length },
    );
  } else if (span.mayContinue) {
    lengthText = translator.translateTemplate("At least {{duration}}", {
      duration: length,
    });
  }

  const date: ShiftDateTile = getShiftDateTile(
    span.isOnCallNow ? now : span.start,
    clock,
  );

  /*
   * Read aloud too: the tile is the only place the start's date is written
   * ("Oct 17, Saturday, 23:00 – Sun, Oct 18, 07:00").
   */
  const tile: ReactElement = (
    <time
      className={
        span.isOnCallNow
          ? UPCOMING_SHIFT_NOW_TILE_CLASS_NAME
          : UPCOMING_SHIFT_TILE_CLASS_NAME
      }
      dateTime={(span.isOnCallNow ? now : span.start).toISOString()}
      data-testid="upcoming-shift-tile"
    >
      <span
        className={`${UPCOMING_SHIFT_TILE_MONTH_CLASS_NAME} ${
          span.isOnCallNow ? "text-green-700" : "text-indigo-600"
        }`}
      >
        {date.month}
      </span>
      <span
        className={`${UPCOMING_SHIFT_TILE_DAY_CLASS_NAME} ${
          span.isOnCallNow ? "text-green-800" : "text-gray-900"
        }`}
      >
        {date.day}
      </span>
    </time>
  );

  let when: ReactElement;

  /*
   * The row's when in words, for Get cover's name: a list read link by
   * link - a screen reader's list of links - heard "Get cover" seven times
   * and never which shift each one covers. The start's date is in it
   * because two rows can share a weekday ("Friday"), and the tile that
   * tells them apart is a picture of a date.
   */
  let spokenWhen: string;

  if (span.isOnCallNow) {
    // Today's end as a time, a later one with its day.
    const endsToday: boolean = isSameShiftDay(now, span.end, clock);
    const until: string = endsToday
      ? formatShiftTime(span.end, clock)
      : formatShiftDateTime(span.end, clock);

    spokenWhen = `${translator.translateText(
      "On call now",
    )}, ${translator.translateTemplate(
      span.mayContinue ? "until at least {{time}}" : "until {{time}}",
      { time: until },
    )}`;

    when = (
      <>
        <span
          className="font-semibold text-green-700"
          data-testid="upcoming-shift-day-label"
        >
          {translator.translateText("On call now")}
        </span>
        {SEPARATOR}
        <span data-testid="upcoming-shift-times">
          <TranslatedSentence
            template={
              span.mayContinue ? "until at least {{time}}" : "until {{time}}"
            }
            slots={{ time: Unbroken(until) }}
            renderText={endsToday ? keepWithTime : undefined}
          />
        </span>
      </>
    );
  } else {
    const end: string = formatShiftEnd({
      start: span.start,
      end: span.end,
      clock: clock,
    });
    // formatShiftEnd wrote the end as a bare time: it is on the start's day.
    const endsOnStartDay: boolean = isSameShiftDay(span.start, span.end, clock);

    spokenWhen = `${formatShiftDateTime(span.start, clock)} – ${
      span.mayContinue
        ? translator.translateTemplate("at least {{time}}", { time: end })
        : end
    }`;

    when = (
      <>
        <span className="font-semibold" data-testid="upcoming-shift-day-label">
          {getShiftDayLabel(span.start, clock)}
        </span>
        {SEPARATOR}
        {/*
         * The start and the end each stay whole, so a line that has to
         * break does so between them - never inside "Sun, Oct 18, 07:00".
         * Two times of one day are one piece: on a 320px phone the line
         * breaks after the day ("Tomorrow ·", then "10:00 – 18:00"),
         * rather than leaving "18:00" alone under "Tomorrow · 10:00 –".
         */}
        <span data-testid="upcoming-shift-times">
          {endsOnStartDay && !span.mayContinue ? (
            Unbroken(`${formatShiftTime(span.start, clock)} – ${end}`)
          ) : (
            <>
              {Unbroken(`${formatShiftTime(span.start, clock)} –`)}{" "}
              {span.mayContinue ? (
                <TranslatedSentence
                  template="at least {{time}}"
                  slots={{ time: Unbroken(end) }}
                />
              ) : (
                Unbroken(end)
              )}
            </>
          )}
        </span>
      </>
    );
  }

  const isCovering: boolean = span.coveringFor !== null;

  return (
    <li
      className={UPCOMING_SHIFT_ROW_CLASS_NAME}
      data-testid="upcoming-shift-row"
      data-on-call-now={span.isOnCallNow ? "true" : "false"}
      data-may-continue={span.mayContinue ? "true" : "false"}
      data-span-key={span.key}
    >
      {tile}

      <div
        className={UPCOMING_SHIFT_BODY_CLASS_NAME}
        data-testid="upcoming-shift-body"
      >
        <div className={UPCOMING_SHIFT_TEXT_CLASS_NAME}>
          <p
            className={UPCOMING_SHIFT_WHEN_CLASS_NAME}
            title={fullRange}
            data-testid="upcoming-shift-when"
          >
            {when}
          </p>
          <p
            className="break-words text-sm leading-6 text-gray-500"
            data-testid="upcoming-shift-where"
          >
            <span className="font-medium text-gray-700">
              {span.scheduleName}
            </span>
            {props.showLayerName && span.layerName && (
              <>
                {SEPARATOR}
                <span data-testid="upcoming-shift-layer">{span.layerName}</span>
              </>
            )}
            {props.showProjectName && span.projectName && (
              <>
                {SEPARATOR}
                <span data-testid="upcoming-shift-project">
                  {span.projectName}
                </span>
              </>
            )}
          </p>
          {(isCovering || span.policyVariant) && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {isCovering && (
                <span
                  className={`${UPCOMING_SHIFT_BADGE_CLASS_NAME} ${UPCOMING_SHIFT_COVERING_BADGE_CLASS_NAME}`}
                  data-testid="upcoming-shift-covering"
                >
                  {translator.translateTemplate("Covering for {{name}}", {
                    name: span.coveringFor || "",
                  })}
                </span>
              )}
              {span.policyVariant && (
                <span
                  className={`${UPCOMING_SHIFT_BADGE_CLASS_NAME} ${UPCOMING_SHIFT_POLICY_BADGE_CLASS_NAME}`}
                  data-testid="upcoming-shift-policy"
                >
                  {translator.translateTemplate("Only on policy {{name}}", {
                    name: span.policyVariant.policyName,
                  })}
                </span>
              )}
            </div>
          )}
        </div>

        <div className={UPCOMING_SHIFT_END_CLASS_NAME}>
          <span
            className="text-sm leading-6 text-gray-500 sm:whitespace-nowrap"
            data-testid="upcoming-shift-length"
          >
            {lengthText}
          </span>
          {coverRoute && (
            <Link to={coverRoute} className={UPCOMING_SHIFT_COVER_CLASS_NAME}>
              <span>{translator.translateText("Get cover")}</span>
              {/*
               * In brackets after a space: the hidden text is out of the
               * line, which Chromium reads as a word of its own, so a comma
               * there was heard as "Get cover , Thu, Oct 15".
               */}
              <span
                className="sr-only"
                data-testid="upcoming-shift-cover-context"
              >
                {` (${spokenWhen})`}
              </span>
            </Link>
          )}
        </div>
      </div>
    </li>
  );
};

export default UpcomingShiftRow;
