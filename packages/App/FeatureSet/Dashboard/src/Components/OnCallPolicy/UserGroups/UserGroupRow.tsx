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
  isMembersShown,
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
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import RowActions from "Common/UI/Components/ActionButton/RowActions";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
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
 * One user group on the schedule page's card, the one important thing
 * first: how people mention it and whether it is up to date - and, when
 * something keeps it from being in step, what and what to do, with Try
 * again right there. Then who is in it now and the other schedules it
 * follows, anybody on call it could not hold, and when OneUptime last
 * looked. Disconnect is rare, so it waits in the row's ⋯, as a table row's
 * delete does (RowActions).
 */

export interface ComponentProps {
  view: WorkspaceUserGroupView;
  // The schedule whose page this is.
  scheduleId: string;
  // Try again: offered while the workspace refuses.
  onTryAgain?: (() => void) | undefined;
  onDisconnect?: (() => void) | undefined;
  // A Try again or a Disconnect of this group is on its way.
  isBusy?: boolean | undefined;
  /*
   * Whether the reader may change the group (Try again, Disconnect), and
   * when they may not, why: Disconnect stays in the menu, locked, saying
   * it. With no reason to give (their permissions have not loaded yet),
   * neither is offered.
   */
  canChange?: boolean | undefined;
  changeDisabledReason?: string | undefined;
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

// The label column of the row's facts: as wide as its longest label.
const FACT_LABEL_CLASS_NAME: string =
  "text-xs font-medium uppercase tracking-wide text-gray-500 sm:pt-0.5";

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

  const isMembersRowShown: boolean = isMembersShown(view);
  const problemText: string | null = getUserGroupProblemText(view);

  const fillProblem: (template: string) => string = (
    template: string,
  ): string => {
    return translator.translateTemplate(template, {
      mention: mention,
      team: teamName,
      detail: view.problemDetail || "",
    });
  };

  /*
   * What the status means, right under it: a refusal in red with Try
   * again, a group turned off in Slack in amber, and the quiet states - off
   * for nobody on call, not looked at yet - in grey.
   */
  let statusNote: ReactElement | null = null;

  if (status === UserGroupStatusKind.Problem && problemText) {
    const canTryAgain: boolean =
      Boolean(props.onTryAgain) && Boolean(props.canChange);

    statusNote = (
      <Alert
        type={AlertType.DANGER}
        dataTestId={`${testId}-status-text`}
        className="mt-3"
        title={fillProblem(problemText)}
        {...(canTryAgain
          ? {
              textOnRight: props.isBusy
                ? USER_GROUP_LABELS.checking
                : USER_GROUP_LABELS.tryAgain,
              onClick: () => {
                if (!props.isBusy) {
                  props.onTryAgain?.();
                }
              },
            }
          : {})}
      />
    );
  } else if (
    status === UserGroupStatusKind.TurnedOffInWorkspace &&
    problemText
  ) {
    statusNote = (
      <Alert
        type={AlertType.WARNING}
        dataTestId={`${testId}-status-text`}
        className="mt-3"
        title={fillProblem(problemText)}
      />
    );
  } else if (
    status === UserGroupStatusKind.NotYet ||
    status === UserGroupStatusKind.TurnedOff
  ) {
    statusNote = (
      <div
        data-testid={`${testId}-status-text`}
        className="mt-3 flex items-start gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700 ring-1 ring-inset ring-gray-200"
      >
        <Icon
          icon={IconProp.Info}
          className="mt-0.5 h-4 w-4 flex-none text-gray-400"
        />
        <span className="min-w-0 text-pretty">
          {status === UserGroupStatusKind.NotYet
            ? translator.translateText(USER_GROUP_TIME_TEXT.notYet)
            : translator.translateTemplate(copy.turnedOffText, {
                mention: mention,
              })}
        </span>
      </div>
    );
  }

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

  /*
   * Disconnect, in the row's ⋯ even when it is the row's only action: one
   * red button on every row of the card would be its loudest thing. Locked,
   * it stays listed and says why.
   */
  const actions: Array<ActionButtonSchema<WorkspaceUserGroupView>> =
    props.onDisconnect && (props.canChange || props.changeDisabledReason)
      ? [
          {
            title: USER_GROUP_LABELS.disconnect,
            icon: IconProp.LinkSlash,
            buttonStyleType: ButtonStyleType.HOVER_DANGER_OUTLINE,
            placement: ActionButtonPlacement.MoreMenu,
            disabled: !props.canChange || props.isBusy,
            tooltip: props.canChange ? undefined : props.changeDisabledReason,
            onClick: (
              _item: WorkspaceUserGroupView,
              onCompleteAction: () => void,
            ) => {
              // The card asks first (its Disconnect dialog).
              onCompleteAction();
              props.onDisconnect?.();
            },
          },
        ]
      : [];

  const hasFacts: boolean = isMembersRowShown || otherSchedules.length > 0;

  return (
    <li
      data-testid={testId}
      className="rounded-lg border border-gray-200 bg-white p-4"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              data-testid={`${testId}-mention`}
              className="max-w-full break-words rounded bg-indigo-50 px-1.5 py-0.5 text-sm font-semibold text-indigo-700"
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

        {actions.length > 0 ? (
          <div className="flex-none" data-testid={`${testId}-actions`}>
            <RowActions<WorkspaceUserGroupView>
              item={view}
              actionButtons={actions}
              itemLabel={mention}
            />
          </div>
        ) : (
          <></>
        )}
      </div>

      {statusNote}

      {hasFacts ? (
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(7rem,max-content)_minmax(0,1fr)]">
          {isMembersRowShown ? (
            <>
              <dt className={FACT_LABEL_CLASS_NAME}>
                {translator.translateText(USER_GROUP_LABELS.members)}
              </dt>
              <dd data-testid={`${testId}-members`} className="min-w-0">
                {view.members.length > 0 && !view.isTurnedOff ? (
                  <ul className="flex flex-wrap gap-2">
                    {view.members.map(
                      (person: WorkspaceUserGroupPersonView) => {
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
                      },
                    )}
                  </ul>
                ) : (
                  <span className="text-gray-500">
                    {translator.translateText(USER_GROUP_LABELS.noMembers)}
                  </span>
                )}
              </dd>
            </>
          ) : (
            <></>
          )}

          {otherSchedules.length > 0 ? (
            <>
              <dt className={FACT_LABEL_CLASS_NAME}>
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
                <span className="min-w-0 text-pretty">
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
