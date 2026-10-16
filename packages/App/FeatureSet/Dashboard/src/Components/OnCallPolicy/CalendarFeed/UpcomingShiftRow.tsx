import {
  UpcomingShiftSpan,
  getCoverWindowForSpan,
} from "./UpcomingShiftSpans";
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
 * and "Get cover" sit together at the row's end - beside the text on a
 * phone, under each other from sm up - inside a list no wider than a
 * comfortable reading measure, so on a wide screen they are never a screen
 * away from the row they belong to.
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
 * The facts that make a span different from a plain shift of yours, in the
 * pill shape the link card's status uses. Colours Theme.css remaps.
 */
export const UPCOMING_SHIFT_BADGE_CLASS_NAME: string =
  "inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset";

export const UPCOMING_SHIFT_COVERING_BADGE_CLASS_NAME: string =
  "bg-blue-50 text-blue-700 ring-blue-200";

export const UPCOMING_SHIFT_POLICY_BADGE_CLASS_NAME: string =
  "bg-purple-50 text-purple-700 ring-purple-200";

const SEPARATOR: ReactElement = (
  <span className="mx-1.5 text-gray-300" aria-hidden="true">
    ·
  </span>
);

// A time that never breaks inside itself: "Sun, Oct 18, 07:00".
const Unbroken: (text: string) => ReactElement = (
  text: string,
): ReactElement => {
  return <span className="whitespace-nowrap">{text}</span>;
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

  // How long, from the start - or, on call now, what is left of it.
  const length: string = formatShiftLength(
    getShiftLength({
      start: span.isOnCallNow ? now : span.start,
      end: span.end,
      timezone: clock.timezone,
    }),
    clock.language,
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

  if (span.isOnCallNow) {
    // Today's end as a time, a later one with its day.
    const until: string = isSameShiftDay(now, span.end, clock)
      ? formatShiftTime(span.end, clock)
      : formatShiftDateTime(span.end, clock);

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

    when = (
      <>
        <span
          className="font-semibold"
          data-testid="upcoming-shift-day-label"
        >
          {getShiftDayLabel(span.start, clock)}
        </span>
        {SEPARATOR}
        {/*
         * The start and the end each stay whole, so a line that has to
         * break does so between them - never inside "Sun, Oct 18, 07:00".
         */}
        <span data-testid="upcoming-shift-times">
          {Unbroken(`${formatShiftTime(span.start, clock)} –`)}{" "}
          {span.mayContinue ? (
            <TranslatedSentence
              template="at least {{time}}"
              slots={{ time: Unbroken(end) }}
            />
          ) : (
            Unbroken(end)
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

      <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p
            className="text-sm leading-6 text-gray-900"
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
                <span data-testid="upcoming-shift-layer">
                  {span.layerName}
                </span>
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

        <div className="flex flex-none items-center gap-4 sm:flex-col sm:items-end sm:gap-0.5">
          <span
            className="whitespace-nowrap text-sm leading-6 text-gray-500"
            data-testid="upcoming-shift-length"
          >
            {lengthText}
          </span>
          {coverRoute && (
            <Link
              to={coverRoute}
              className="whitespace-nowrap text-sm font-medium leading-6 text-indigo-600 hover:text-indigo-500 hover:underline"
            >
              {translator.translateText("Get cover")}
            </Link>
          )}
        </div>
      </div>
    </li>
  );
};

export default UpcomingShiftRow;
