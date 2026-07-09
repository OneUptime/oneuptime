import { getColorForUserId, getUserInitials } from "./LayerUserColors";
import {
  formatDurationFromSeconds,
  formatRelativeStart,
  formatShiftInstant,
  summarizeRestriction,
  summarizeRotation,
} from "./LayerSummary";
import CalendarEvent from "Common/Types/Calendar/CalendarEvent";
import IconProp from "Common/Types/Icon/IconProp";
import RestrictionTimes, {
  RestrictionType,
} from "Common/Types/OnCallDutyPolicy/RestrictionTimes";
import ScheduleShiftUtil, {
  OnCallShift,
} from "Common/Types/OnCallDutyPolicy/ScheduleShiftUtil";
import Icon from "Common/UI/Components/Icon/Icon";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import User from "Common/Models/DatabaseModels/User";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  layer: OnCallDutyPolicyScheduleLayer;
  users: Array<OnCallDutyPolicyScheduleLayerUser>;
  timezone?: string | undefined;
  // Pre-computed events + reference instant, so the parent runs LayerUtil once.
  events: Array<CalendarEvent>;
  now: Date;
  // How many upcoming turns to list. Defaults to 5.
  numberOfShifts?: number | undefined;
}

interface UserDisplay {
  name: string;
  color: string;
  initials: string;
}

const LayerRotationSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const numberOfShifts: number = props.numberOfShifts || 5;

  /*
   * usersById is keyed by user id (deduplicated) for name/color lookup by a
   * shift's userId. orderedUsers keeps ONE entry per assignment row, in rotation
   * order — including a user listed twice — because the engine rotates through
   * every row, and because this keeps the count consistent with the collapsed
   * header's row count (a distinct-person count would disagree with it).
   */
  const usersById: Record<string, UserDisplay> = {};
  const orderedUsers: Array<UserDisplay> = [];
  for (const layerUser of props.users) {
    const user: User | undefined = layerUser.user;
    const userId: string = user?.id?.toString() || "";
    if (!userId) {
      continue;
    }
    const name: string =
      user?.name?.toString() || user?.email?.toString() || "Unknown user";
    if (!usersById[userId]) {
      usersById[userId] = {
        name,
        color: getColorForUserId(userId),
        initials: getUserInitials(
          user?.name?.toString() || "",
          user?.email?.toString() || "",
        ),
      };
    }
    orderedUsers.push(usersById[userId]!);
  }

  const getUserDisplay: (userId: string) => UserDisplay = (
    userId: string,
  ): UserDisplay => {
    return (
      usersById[userId] || {
        name: "Unknown user",
        color: getColorForUserId(userId),
        initials: "?",
      }
    );
  };

  const restrictionTimes: RestrictionTimes | undefined =
    props.layer.restrictionTimes;
  const hasRestriction: boolean = Boolean(
    restrictionTimes &&
      restrictionTimes.restictionType &&
      restrictionTimes.restictionType !== RestrictionType.None,
  );

  const rotationSummary: string = summarizeRotation(props.layer.rotation);
  const restrictionSummary: string = summarizeRestriction(
    restrictionTimes,
    props.timezone,
  );

  /*
   * No renderable users (parent shows its own "add users" prompt, or every row
   * is missing a user id) -> render nothing rather than a nonsensical
   * "rotates through 0 people".
   */
  if (orderedUsers.length === 0) {
    return <></>;
  }

  // Group raw coverage into rotation turns (absorb within-turn off-hours gaps).
  const turns: Array<OnCallShift> = ScheduleShiftUtil.groupEventsIntoShifts(
    props.events,
    { mergeAcrossGaps: true },
  );

  const { current }: { current: OnCallShift | null } =
    ScheduleShiftUtil.getCurrentAndNextShift(turns, props.now);

  /*
   * Whether SOMEONE is actively on call in this layer right now, from raw
   * coverage (no across-gap merging). During a restricted layer's off-hours this
   * is null even though a rotation turn is "current" — so the current-turn row
   * can label itself "off-hours" instead of "on call now", staying consistent
   * with the collapsed header (which uses the same raw-coverage signal).
   */
  const rawCurrent: OnCallShift | null =
    ScheduleShiftUtil.getCurrentAndNextShift(
      ScheduleShiftUtil.groupEventsIntoShifts(props.events),
      props.now,
    ).current;
  const isActiveNow: boolean = rawCurrent !== null;

  // Current turn + upcoming turns (drop turns that already ended).
  const upcomingTurns: Array<OnCallShift> = turns
    .filter((turn: OnCallShift) => {
      return props.now.getTime() < turn.end.getTime();
    })
    .slice(0, numberOfShifts);

  const isSingleUser: boolean = orderedUsers.length === 1;

  const getRotationOrderRow: () => ReactElement = (): ReactElement => {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Order
        </span>
        {orderedUsers.map((user: UserDisplay, i: number) => {
          return (
            <React.Fragment key={`order-${i}`}>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white py-0.5 pl-0.5 pr-2 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200">
                <span
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-semibold text-white"
                  style={{ backgroundColor: user.color }}
                >
                  {user.initials}
                </span>
                {user.name}
              </span>
              {i < orderedUsers.length - 1 && (
                <Icon
                  icon={IconProp.ArrowRight}
                  className="h-3 w-3 text-gray-300"
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  const getShiftRow: (turn: OnCallShift, index: number) => ReactElement = (
    turn: OnCallShift,
    index: number,
  ): ReactElement => {
    const user: UserDisplay = getUserDisplay(turn.userId);
    const isCurrent: boolean = Boolean(
      current &&
        current.userId === turn.userId &&
        current.start.getTime() === turn.start.getTime(),
    );

    return (
      <li
        key={`shift-${index}`}
        className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
          isCurrent
            ? "border-indigo-200 bg-indigo-50/50"
            : "border-gray-200 bg-white"
        }`}
      >
        <span
          className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
          style={{ backgroundColor: user.color }}
        >
          {user.initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-semibold text-gray-900">
              {user.name}
            </span>
            {isCurrent &&
              (isActiveNow ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                  On call now
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                  Current turn · off-hours
                </span>
              ))}
          </div>
          <div className="mt-0.5 text-xs text-gray-500">
            {formatShiftInstant(turn.start, props.timezone)}
            <span className="mx-1 text-gray-300">&rarr;</span>
            {formatShiftInstant(turn.end, props.timezone)}
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
          <span className="rounded-md bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600 ring-1 ring-inset ring-gray-200">
            {formatDurationFromSeconds(turn.coverageSeconds)}
            {hasRestriction ? " on call" : ""}
          </span>
          <span className="text-[11px] font-medium text-gray-400">
            {formatRelativeStart(turn.start, props.now)}
          </span>
        </div>
      </li>
    );
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-900">
          Who is on call, and when
        </h4>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200">
          <Icon icon={IconProp.Refresh} className="h-3 w-3 text-gray-400" />
          {rotationSummary}
        </span>
      </div>

      {/* Plain-english framing of the rotation */}
      <p className="mb-3 text-sm leading-relaxed text-gray-600">
        {isSingleUser ? (
          <>
            <span className="font-semibold text-gray-900">
              {orderedUsers[0]?.name}
            </span>{" "}
            is always on call for this layer — there is no rotation.
          </>
        ) : (
          <>
            On-call duty rotates through{" "}
            <span className="font-semibold text-gray-900">
              {orderedUsers.length} people
            </span>
            , {rotationSummary.toLowerCase()}. Each person is on call until the
            next hand-off, then it passes to the next person in order.
          </>
        )}
        {hasRestriction && (
          <>
            {" "}
            Coverage is limited to{" "}
            <span className="font-semibold text-gray-900">
              {restrictionSummary.toLowerCase()}
            </span>
            ; outside those hours, lower-priority layers take over.
          </>
        )}
      </p>

      {!isSingleUser && <div className="mb-3">{getRotationOrderRow()}</div>}

      {/*
       * The upcoming-shifts list only makes sense for a real rotation. With a
       * single user, every period is theirs, so mergeAcrossGaps collapses the
       * whole window into one meaningless span — the "always on call" narrative
       * above already says everything there is to say.
       */}
      {!isSingleUser &&
        (upcomingTurns.length > 0 ? (
          <>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Upcoming shifts
            </div>
            <ol className="space-y-2">
              {upcomingTurns.map((turn: OnCallShift, index: number) => {
                return getShiftRow(turn, index);
              })}
            </ol>
            {hasRestriction && (
              <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
                Each row shows a person&apos;s full rotation turn; the duration
                counts only active on-call hours (
                {restrictionSummary.toLowerCase()}). Outside those hours,
                lower-priority layers take over.
              </p>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-4 text-center text-sm text-gray-500">
            No upcoming shifts in the near future. Check the rotation start and
            hand-off time above.
          </div>
        ))}
    </div>
  );
};

export default LayerRotationSummary;
