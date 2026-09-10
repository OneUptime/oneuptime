import { formatShiftInstant } from "./LayerSummary";
import { getColorForUserId, getUserInitials } from "./LayerUserColors";
import {
  OverrideScopeKind,
  OverrideSummaryRow,
  OverrideUserDisplayInfo,
} from "./OverridePresentation";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The substitutions in force on this schedule, stated in full above the grid
 * they explain.
 *
 * The calendar can only ever show the RESULT of an override — a block in the
 * substitute's colour — and a block cannot say what it would have said without
 * the override. That leaves the reader of a correct calendar unable to tell a
 * substitution from an ordinary rotation, which is the complaint this card
 * answers: it names the person who was overridden, the person their alerts now
 * reach, the window, and whether the swap applies everywhere or to one policy.
 *
 * Rows come from OverridePresentation.buildOverrideSummaryRows, so this
 * component holds no wording of its own and stays a pure render of props.
 */

export interface ComponentProps {
  rows: Array<OverrideSummaryRow>;
  // Display info for both sides of every row, keyed by user id.
  userById: Dictionary<OverrideUserDisplayInfo>;
  // The zone instants are rendered in; matches the grid below.
  timezone?: string | undefined;
  id?: string | undefined;
}

/*
 * How many rows to list before collapsing the rest into a count. A schedule
 * under heavy hand-off churn can carry dozens of future overrides, and a wall
 * of them above the calendar would push the thing they explain off the screen.
 * In-force overrides sort first (see buildOverrideSummaryRows), so the ones that
 * survive the cut are always the ones that matter now.
 */
export const MAX_SHOWN_OVERRIDE_ROWS: number = 4;

const ActiveOverridesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  if (props.rows.length === 0) {
    return null;
  }

  const shownRows: Array<OverrideSummaryRow> = props.rows.slice(
    0,
    MAX_SHOWN_OVERRIDE_ROWS,
  );
  const hiddenCount: number = props.rows.length - shownRows.length;

  const getAvatar: (userId: string) => ReactElement = (
    userId: string,
  ): ReactElement => {
    const info: OverrideUserDisplayInfo | undefined = props.userById[userId];
    return (
      <span
        className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
        style={{ backgroundColor: getColorForUserId(userId) }}
      >
        {getUserInitials(info?.name || "", info?.email || "")}
      </span>
    );
  };

  /*
   * One side of the swap. The caption under the name is what makes the row
   * self-explanatory: "Alice -> Bob" alone still needs the reader to know which
   * direction an override runs, and getting that backwards means calling the
   * wrong person at 3am.
   */
  const getParty: (data: {
    userId: string;
    name: string;
    caption: string;
    captionClassName: string;
  }) => ReactElement = (data: {
    userId: string;
    name: string;
    caption: string;
    captionClassName: string;
  }): ReactElement => {
    return (
      <div className="flex min-w-0 items-center gap-2">
        {getAvatar(data.userId)}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-900">
            {data.name}
          </div>
          <div
            className={`text-[11px] font-medium uppercase tracking-wide ${data.captionClassName}`}
          >
            {data.caption}
          </div>
        </div>
      </div>
    );
  };

  const getRow: (row: OverrideSummaryRow) => ReactElement = (
    row: OverrideSummaryRow,
  ): ReactElement => {
    return (
      <li
        key={row.key}
        data-testid="active-override-row"
        className="rounded-lg border border-gray-200 bg-white px-3 py-2.5"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {getParty({
            userId: row.originalUserId,
            name: row.originalName,
            caption: "Overridden",
            captionClassName: "text-gray-400",
          })}

          <Icon
            icon={IconProp.ArrowRight}
            className="h-4 w-4 flex-shrink-0 text-indigo-500"
            ariaLabel="alerts routed to"
          />

          {getParty({
            userId: row.substituteUserId,
            name: row.substituteName,
            caption: "Alerts go here",
            captionClassName: "text-indigo-600",
          })}

          {row.isActiveNow && (
            <span className="ml-auto inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-indigo-500" />
              </span>
              In force now
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
          <span>
            {formatShiftInstant(row.startsAt, props.timezone)}
            <span className="mx-1 text-gray-300">&rarr;</span>
            {formatShiftInstant(row.endsAt, props.timezone)}
          </span>
          <span className="text-gray-300">&middot;</span>
          {/*
           * The scope pill is the answer to "will this cover the page I care
           * about". A global override is the wide, reassuring case and is drawn
           * neutrally; a policy-scoped one is the narrow, surprising case and is
           * drawn in amber, because a reader who assumes it is global will be
           * paged by every OTHER policy that escalates here.
           */}
          <span
            data-testid="override-scope-pill"
            title={row.scope.detail}
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
              row.scope.kind === OverrideScopeKind.Global
                ? "bg-gray-50 text-gray-600 ring-gray-200"
                : "bg-amber-50 text-amber-800 ring-amber-200"
            }`}
          >
            <Icon
              icon={
                row.scope.kind === OverrideScopeKind.Global
                  ? IconProp.Globe
                  : IconProp.Alert
              }
              className="h-3 w-3"
            />
            {row.scope.label}
          </span>
        </div>
      </li>
    );
  };

  return (
    <div
      id={props.id}
      data-testid="active-overrides-card"
      className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4"
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-700">
        <Icon icon={IconProp.ArrowUturnRight} className="h-3.5 w-3.5" />
        {props.rows.length === 1
          ? "1 user override on this schedule"
          : `${props.rows.length} user overrides on this schedule`}
      </div>
      {/*
       * Deliberately not "during these windows the calendar shows the
       * substitute": an override only takes effect where its window actually
       * overlaps a shift of the person it overrides, and one booked over a day
       * they were not rostered anyway changes nothing. It is still listed -
       * somebody configured it and would go looking for it - so the wording has
       * to describe what an override DOES without promising every row below
       * changed the grid.
       */}
      <p className="mt-1 text-xs text-gray-600">
        An override sends the alerts that would page one person to somebody
        else. Wherever one covers a shift, the calendar below shows the
        substitute rather than the person the rotation put on call.
      </p>

      <ul className="mt-3 space-y-2">{shownRows.map(getRow)}</ul>

      {hiddenCount > 0 && (
        <div className="mt-2 text-xs text-gray-500">
          + {hiddenCount} more {hiddenCount === 1 ? "override" : "overrides"}{" "}
          scheduled later in this window.
        </div>
      )}
    </div>
  );
};

export default ActiveOverridesCard;
