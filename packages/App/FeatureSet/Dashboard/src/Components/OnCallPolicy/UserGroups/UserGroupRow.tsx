import {
  getUserAvatarStyle,
  getUserInitials,
} from "../OnCallScheduleLayer/LayerUserColors";
import {
  getLeftOutText,
  getMention,
  getPersonName,
  getUserGroupProblemText,
  getUserGroupStatus,
  TEAM_SUBTITLE,
  USER_GROUP_LABELS,
  USER_GROUP_STATUS_LABELS,
  USER_GROUP_TIME_TEXT,
  USER_GROUPS_COPY,
  UserGroupStatusKind,
  UserGroupsWorkspaceCopy,
} from "./UserGroupsCopy";
import AppLink from "../../AppLink/AppLink";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  WorkspaceUserGroupLeftOutView,
  WorkspaceUserGroupPersonView,
  WorkspaceUserGroupScheduleView,
  WorkspaceUserGroupView,
} from "Common/Types/Workspace/WorkspaceUserGroup";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import {
  FeedClock,
  formatFeedFullTime,
  formatFeedTimeAgo,
  getFeedClock,
} from "Common/UI/Components/Feed/FeedTime";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One user group on the schedule page's card: how people mention it and
 * whether it is up to date, who is in it now, the schedules it follows,
 * and - when something keeps it from being in step - what, and what to do.
 */

export interface ComponentProps {
  view: WorkspaceUserGroupView;
  // The schedule whose page this is.
  scheduleId: string;
  // Try again: shown while the workspace refuses.
  onTryAgain?: (() => void) | undefined;
  onDisconnect?: (() => void) | undefined;
  // A Try again or a Disconnect of this group is on its way.
  isBusy?: boolean | undefined;
  // What the buttons say when they may not be pressed.
  tryAgainDisabledReason?: string | undefined;
  disconnectDisabledReason?: string | undefined;
  // Injected by tests; the page passes nothing and gets the real clock.
  now?: Date | undefined;
}

interface StatusTone {
  pill: string;
  dot: string;
}

/*
 * The status pill's colours, all classes Theme.css remaps for the dark
 * theme - the calendar feed's pills use the same.
 */
export const USER_GROUP_STATUS_TONES: Readonly<
  Record<UserGroupStatusKind, StatusTone>
> = {
  [UserGroupStatusKind.InStep]: {
    pill: "bg-green-50 text-green-700 ring-green-200",
    dot: "bg-green-500",
  },
  [UserGroupStatusKind.NotYet]: {
    pill: "bg-blue-50 text-blue-700 ring-blue-200",
    dot: "bg-blue-500",
  },
  [UserGroupStatusKind.TurnedOff]: {
    pill: "bg-gray-50 text-gray-700 ring-gray-200",
    dot: "bg-gray-400",
  },
  [UserGroupStatusKind.TurnedOffInWorkspace]: {
    pill: "bg-amber-50 text-amber-800 ring-amber-200",
    dot: "bg-amber-500",
  },
  [UserGroupStatusKind.Problem]: {
    pill: "bg-red-50 text-red-700 ring-red-200",
    dot: "bg-red-500",
  },
};

const PILL_CLASS_NAME: string =
  "inline-flex max-w-full flex-none items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset";

const UserGroupRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const view: WorkspaceUserGroupView = props.view;
  const copy: UserGroupsWorkspaceCopy = USER_GROUPS_COPY[view.workspaceType];
  const status: UserGroupStatusKind = getUserGroupStatus(view);
  const tone: StatusTone = USER_GROUP_STATUS_TONES[status];
  const mention: string = getMention(view);
  const testId: string = `user-group-${view.workspaceUserGroupId}`;

  const clock: FeedClock = getFeedClock({
    language: translator.language,
    now: props.now || OneUptimeDate.getCurrentDate(),
  });

  const timeOf: (iso: string | null) => {
    ago: string;
    full: string;
  } | null = (iso: string | null): { ago: string; full: string } | null => {
    if (!iso) {
      return null;
    }

    const date: Date = OneUptimeDate.fromString(iso);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return {
      ago: formatFeedTimeAgo(date, clock) || OneUptimeDate.fromNow(date),
      full: formatFeedFullTime(date, clock),
    };
  };

  const checked: { ago: string; full: string } | null = timeOf(view.checkedAt);
  const lastInStep: { ago: string; full: string } | null = timeOf(
    view.syncedAt,
  );

  const teamName: string = view.teamName || copy.workspaceName;

  // The schedules besides this one whose people it holds too.
  const otherSchedules: Array<WorkspaceUserGroupScheduleView> =
    view.schedules.filter(
      (schedule: WorkspaceUserGroupScheduleView): boolean => {
        return schedule.scheduleId !== props.scheduleId;
      },
    );

  const problemText: string | null = getUserGroupProblemText(view);

  // The sentence under the people: what the status means, when it needs one.
  let statusSentence: string | null = null;

  if (status === UserGroupStatusKind.NotYet) {
    statusSentence =
      translator.translateText(USER_GROUP_TIME_TEXT.notYet) || null;
  } else if (status === UserGroupStatusKind.TurnedOff) {
    statusSentence = translator.translateTemplate(copy.turnedOffText, {
      mention: mention,
    });
  } else if (problemText) {
    statusSentence = translator.translateTemplate(problemText, {
      mention: mention,
      team: teamName,
      detail: view.problemDetail || "",
    });
  }

  const isWarning: boolean =
    status === UserGroupStatusKind.Problem ||
    status === UserGroupStatusKind.TurnedOffInWorkspace;

  const getAvatar: (person: WorkspaceUserGroupPersonView) => ReactElement = (
    person: WorkspaceUserGroupPersonView,
  ): ReactElement => {
    return (
      <span
        className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-full text-[10px] font-semibold"
        style={getUserAvatarStyle(person.userId)}
        aria-hidden="true"
      >
        {getUserInitials(person.name, person.email)}
      </span>
    );
  };

  const getScheduleLink: (schedule: WorkspaceUserGroupScheduleView) => Route = (
    schedule: WorkspaceUserGroupScheduleView,
  ): Route => {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW] as Route,
      { modelId: new ObjectID(schedule.scheduleId) },
    );
  };

  return (
    <li
      data-testid={testId}
      className="rounded-lg border border-gray-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              data-testid={`${testId}-mention`}
              className="max-w-full break-all rounded bg-indigo-50 px-1.5 py-0.5 text-sm font-semibold text-indigo-700"
            >
              {mention}
            </span>
            <span
              data-testid={`${testId}-status`}
              data-status={status}
              className={`${PILL_CLASS_NAME} ${tone.pill}`}
            >
              <span
                className={`h-1.5 w-1.5 flex-none rounded-full ${tone.dot}`}
                aria-hidden="true"
              ></span>
              {translator.translateText(USER_GROUP_STATUS_LABELS[status])}
            </span>
          </div>
          {view.handle && view.name && view.name !== view.handle ? (
            <div
              data-testid={`${testId}-name`}
              className="mt-1 truncate text-xs text-gray-500"
            >
              {view.name}
            </div>
          ) : (
            <></>
          )}
          {view.teamName ? (
            <div
              data-testid={`${testId}-team`}
              className="mt-1 truncate text-xs text-gray-500"
            >
              {translator.translateTemplate(TEAM_SUBTITLE, {
                team: view.teamName,
              })}
            </div>
          ) : (
            <></>
          )}
        </div>

        <div className="flex flex-none flex-wrap items-center gap-2">
          {props.onTryAgain && status === UserGroupStatusKind.Problem ? (
            <Button
              title={USER_GROUP_LABELS.tryAgain}
              icon={IconProp.Refresh}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              isLoading={props.isBusy}
              disabled={Boolean(props.tryAgainDisabledReason) || props.isBusy}
              tooltip={props.tryAgainDisabledReason}
              dataTestId={`${testId}-try-again`}
              onClick={() => {
                props.onTryAgain?.();
              }}
            />
          ) : (
            <></>
          )}
          {props.onDisconnect ? (
            <Button
              title={USER_GROUP_LABELS.disconnect}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              disabled={Boolean(props.disconnectDisabledReason) || props.isBusy}
              tooltip={props.disconnectDisabledReason}
              dataTestId={`${testId}-disconnect`}
              onClick={() => {
                props.onDisconnect?.();
              }}
            />
          ) : (
            <></>
          )}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(7rem,max-content)_minmax(0,1fr)]">
        {status !== UserGroupStatusKind.NotYet ? (
          <>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 sm:pt-0.5">
              {translator.translateText(USER_GROUP_LABELS.inItNow)}
            </dt>
            <dd data-testid={`${testId}-members`} className="min-w-0">
              {view.members.length > 0 && !view.isTurnedOff ? (
                <ul className="flex flex-wrap gap-2">
                  {view.members.map((person: WorkspaceUserGroupPersonView) => {
                    return (
                      <li
                        key={person.userId}
                        className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-gray-50 py-0.5 pl-0.5 pr-2.5 ring-1 ring-inset ring-gray-200"
                      >
                        {getAvatar(person)}
                        <span className="truncate text-sm font-medium text-gray-900">
                          {getPersonName(person)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <span className="text-gray-500">
                  {translator.translateText(USER_GROUP_LABELS.nobodyInIt)}
                </span>
              )}
            </dd>
          </>
        ) : (
          <></>
        )}

        {otherSchedules.length > 0 ? (
          <>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 sm:pt-0.5">
              {translator.translateText(USER_GROUP_LABELS.alsoFollows)}
            </dt>
            <dd data-testid={`${testId}-schedules`} className="min-w-0">
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {otherSchedules.map(
                  (schedule: WorkspaceUserGroupScheduleView) => {
                    return (
                      <li
                        key={schedule.scheduleId}
                        className="min-w-0 max-w-full"
                      >
                        <AppLink
                          to={getScheduleLink(schedule)}
                          className="font-medium text-indigo-700 hover:underline"
                        >
                          {schedule.name}
                        </AppLink>
                      </li>
                    );
                  },
                )}
              </ul>
            </dd>
          </>
        ) : (
          <></>
        )}
      </dl>

      {statusSentence ? (
        <div
          data-testid={`${testId}-status-text`}
          className={`mt-3 flex items-start gap-2 rounded-md px-3 py-2 text-sm text-pretty ${
            isWarning
              ? "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200"
              : "bg-gray-50 text-gray-700 ring-1 ring-inset ring-gray-200"
          }`}
        >
          <Icon
            icon={isWarning ? IconProp.Alert : IconProp.Info}
            className={`mt-0.5 h-4 w-4 flex-none ${
              isWarning ? "text-amber-600" : "text-gray-400"
            }`}
          />
          <span>{statusSentence}</span>
        </div>
      ) : (
        <></>
      )}

      {view.leftOut.length > 0 ? (
        <ul
          data-testid={`${testId}-left-out`}
          className="mt-3 space-y-1.5 text-sm"
        >
          {view.leftOut.map((person: WorkspaceUserGroupLeftOutView) => {
            return (
              <li
                key={person.userId}
                className="flex items-start gap-2 text-amber-900"
              >
                <Icon
                  icon={IconProp.Alert}
                  className="mt-0.5 h-4 w-4 flex-none text-amber-600"
                />
                <span className="text-pretty">
                  {translator.translateTemplate(
                    getLeftOutText({
                      workspaceType: view.workspaceType,
                      person: person,
                    }),
                    {
                      name: getPersonName(person),
                      team: teamName,
                    },
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <></>
      )}

      {checked ? (
        <div
          data-testid={`${testId}-time`}
          className="mt-3 text-xs text-gray-500"
          title={checked.full}
        >
          {status === UserGroupStatusKind.Problem && lastInStep
            ? translator.translateTemplate(USER_GROUP_TIME_TEXT.lastInStep, {
                when: lastInStep.ago,
              })
            : translator.translateTemplate(USER_GROUP_TIME_TEXT.checked, {
                when: checked.ago,
              })}
        </div>
      ) : (
        <></>
      )}
    </li>
  );
};

export default UserGroupRow;
