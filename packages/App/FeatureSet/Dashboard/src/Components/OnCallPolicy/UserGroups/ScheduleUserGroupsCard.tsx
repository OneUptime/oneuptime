import ConnectUserGroupModal from "./ConnectUserGroupModal";
import UserGroupRow from "./UserGroupRow";
import UserGroupsAPI from "./UserGroupsAPI";
import {
  DISCONNECT_MANY_OTHERS,
  DISCONNECT_TEXT,
  getMention,
  USER_GROUP_LABELS,
  USER_GROUPS_COPY,
  UserGroupsWorkspaceCopy,
} from "./UserGroupsCopy";
import { FEED_PANEL_BUTTON_CLASS_NAME } from "../CalendarFeed/CalendarFeedLayout";
import FeedEmptyState from "../CalendarFeed/FeedEmptyState";
import { useWorkspaceConnections } from "../../../Utils/Workspace/ConnectedWorkspaces";
import WorkspaceUserGroup from "Common/Models/DatabaseModels/WorkspaceUserGroup";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { WorkspaceUserGroupView } from "Common/Types/Workspace/WorkspaceUserGroup";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

/*
 * THE SCHEDULE PAGE'S USER GROUPS.
 *
 * "We have a number of @teamname-oncall user group in Slack that is always
 * updated with the on-call person(s) - usually primary and sometimes
 * primary + secondary oncall." A card for each chat workspace the project
 * has connected - Slack user groups, Microsoft Teams tags - lists the groups
 * that follow this schedule, each with who is in it now, the schedules it
 * follows and whether it is up to date, and connects one in a click. A
 * project that connected neither is shown neither.
 *
 * It sits between the on-call banner and the calendar subscription cards,
 * and speaks their language: an empty card is the same panel as theirs
 * (FeedEmptyState), and a list that could not be read, or a press that
 * failed, is the same red alert with its way to try again.
 */

export interface ComponentProps {
  scheduleId: ObjectID;
  scheduleName: string;
  // Injected by tests; the page passes nothing and gets the real clock.
  now?: Date | undefined;
}

interface WorkspaceCardProps {
  workspaceType: WorkspaceType;
  scheduleId: string;
  scheduleName: string;
  views: Array<WorkspaceUserGroupView>;
  isLoading: boolean;
  error: string;
  onReload: () => void;
  onChanged: (view: WorkspaceUserGroupView | null, removedId?: string) => void;
  now?: Date | undefined;
}

export const WorkspaceUserGroupsCard: FunctionComponent<WorkspaceCardProps> = (
  props: WorkspaceCardProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const copy: UserGroupsWorkspaceCopy = USER_GROUPS_COPY[props.workspaceType];
  const idPrefix: string = `user-groups-${props.workspaceType}`;

  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [toDisconnect, setToDisconnect] =
    useState<WorkspaceUserGroupView | null>(null);
  const [busyId, setBusyId] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");

  const model: WorkspaceUserGroup = new WorkspaceUserGroup();

  /*
   * Disconnect and Try again change OneUptime's record of a group: a reader
   * who may not is told so ("You do not have permission to update this user
   * group."). The model gives creating, updating and deleting one the same
   * roles, so this locks exactly what the server refuses.
   */
  const changeGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Update,
    { singularName: copy.groupNoun },
  );

  const connectButton: CardButtonSchema | null = PermissionGate.gateCardButton(
    {
      title: copy.connectButton,
      icon: IconProp.Add,
      buttonStyle: ButtonStyleType.NORMAL,
      onClick: () => {
        setIsConnecting(true);
      },
    },
    model,
    ModelAction.Create,
    { singularName: copy.groupNoun },
  );

  const tryAgain: (view: WorkspaceUserGroupView) => Promise<void> = async (
    view: WorkspaceUserGroupView,
  ): Promise<void> => {
    setBusyId(view.workspaceUserGroupId);
    setActionError("");

    try {
      props.onChanged(
        await UserGroupsAPI.syncAgain({
          workspaceUserGroupId: view.workspaceUserGroupId,
          scheduleId: props.scheduleId,
        }),
      );
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    } finally {
      setBusyId("");
    }
  };

  const disconnect: (view: WorkspaceUserGroupView) => Promise<void> = async (
    view: WorkspaceUserGroupView,
  ): Promise<void> => {
    setBusyId(view.workspaceUserGroupId);
    setActionError("");

    try {
      await UserGroupsAPI.disconnect({
        workspaceUserGroupId: view.workspaceUserGroupId,
        scheduleId: props.scheduleId,
      });
      setToDisconnect(null);
      props.onChanged(null, view.workspaceUserGroupId);
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    } finally {
      setBusyId("");
    }
  };

  // The schedules a group keeps following once this one is let go.
  const getOtherScheduleNames: (
    view: WorkspaceUserGroupView,
  ) => Array<string> = (view: WorkspaceUserGroupView): Array<string> => {
    return view.schedules
      .filter((schedule: { scheduleId: string }): boolean => {
        return schedule.scheduleId !== props.scheduleId;
      })
      .map((schedule: { name: string }): string => {
        return schedule.name;
      });
  };

  const getDisconnectDescription: (
    view: WorkspaceUserGroupView,
  ) => ReactElement = (view: WorkspaceUserGroupView): ReactElement => {
    const others: Array<string> = getOtherScheduleNames(view);
    const mention: ReactElement = (
      <strong className="break-words">{getMention(view)}</strong>
    );

    if (others.length === 0) {
      return (
        <TranslatedSentence
          template={DISCONNECT_TEXT.last}
          slots={{ mention: mention }}
        />
      );
    }

    if (others.length === 1) {
      return (
        <TranslatedSentence
          template={DISCONNECT_TEXT.oneOther}
          slots={{ mention: mention }}
          values={{ schedule: others[0]! }}
        />
      );
    }

    return (
      <TranslatedSentence
        template={DISCONNECT_MANY_OTHERS}
        count={others.length}
        slots={{ mention: mention }}
      />
    );
  };

  /*
   * The empty panel's one action: Connect, or - for a reader who may not -
   * the same button locked, saying which permission it needs.
   */
  const getEmptyControl: () => ReactElement = (): ReactElement => {
    if (!connectButton) {
      return <></>;
    }

    return (
      <Button
        title={copy.connectButton}
        icon={IconProp.Add}
        buttonStyle={ButtonStyleType.PRIMARY}
        disabled={connectButton.disabled}
        tooltip={connectButton.tooltip}
        dataTestId={`${idPrefix}-connect`}
        className={FEED_PANEL_BUTTON_CLASS_NAME}
        onClick={() => {
          if (!connectButton.disabled) {
            setIsConnecting(true);
          }
        }}
      />
    );
  };

  let body: ReactElement;

  if (props.isLoading) {
    body = <ComponentLoader />;
  } else if (props.error) {
    body = (
      <Alert
        type={AlertType.DANGER}
        strongTitle={copy.loadError}
        title={props.error}
        textOnRight={USER_GROUP_LABELS.tryAgain}
        dataTestId={`${idPrefix}-load-error`}
        onClick={props.onReload}
      />
    );
  } else if (props.views.length === 0) {
    body = (
      <FeedEmptyState
        idPrefix={idPrefix}
        icon={IconProp.UserGroup}
        title={copy.emptyTitle}
        description={copy.emptyText}
        control={getEmptyControl()}
      />
    );
  } else {
    body = (
      <ul data-testid={idPrefix} className="space-y-3">
        {props.views.map((view: WorkspaceUserGroupView) => {
          return (
            <UserGroupRow
              key={view.workspaceUserGroupId}
              view={view}
              scheduleId={props.scheduleId}
              now={props.now}
              isBusy={busyId === view.workspaceUserGroupId}
              canChange={changeGate.isAllowed}
              changeDisabledReason={changeGate.disabledReason}
              onTryAgain={() => {
                tryAgain(view).catch(() => {
                  // tryAgain keeps its own error.
                });
              }}
              onDisconnect={() => {
                setActionError("");
                setToDisconnect(view);
              }}
            />
          );
        })}
      </ul>
    );
  }

  return (
    <Card
      title={copy.title}
      description={copy.description}
      buttons={connectButton && props.views.length > 0 ? [connectButton] : []}
    >
      <div data-testid={`user-groups-card-${props.workspaceType}`}>
        {/*
         * A Try again that failed, said above the list in red - unless the
         * Disconnect dialog that failed is still open and says it there.
         */}
        {actionError && !toDisconnect ? (
          <Alert
            type={AlertType.DANGER}
            title={actionError}
            dataTestId={`${idPrefix}-error`}
            className="mb-3"
          />
        ) : (
          <></>
        )}

        {body}

        {isConnecting ? (
          <ConnectUserGroupModal
            workspaceType={props.workspaceType}
            scheduleId={props.scheduleId}
            scheduleName={props.scheduleName}
            followingIds={props.views.map(
              (view: WorkspaceUserGroupView): string => {
                return view.workspaceUserGroupId;
              },
            )}
            onClose={() => {
              setIsConnecting(false);
            }}
            onConnected={(view: WorkspaceUserGroupView) => {
              setIsConnecting(false);
              props.onChanged(view);
            }}
          />
        ) : (
          <></>
        )}

        {toDisconnect ? (
          <ConfirmModal
            title={translator.translateTemplate(DISCONNECT_TEXT.title, {
              mention: getMention(toDisconnect),
            })}
            description={getDisconnectDescription(toDisconnect)}
            submitButtonText={USER_GROUP_LABELS.disconnect}
            submitButtonType={ButtonStyleType.DANGER}
            isLoading={busyId === toDisconnect.workspaceUserGroupId}
            error={actionError || undefined}
            onClose={() => {
              setToDisconnect(null);
              setActionError("");
            }}
            onSubmit={() => {
              disconnect(toDisconnect).catch(() => {
                // disconnect keeps its own error.
              });
            }}
          />
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

const ScheduleUserGroupsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const connected: ReadonlyArray<WorkspaceType> | null =
    useWorkspaceConnections().connected;

  const [views, setViews] = useState<Array<WorkspaceUserGroupView>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const scheduleId: string = props.scheduleId.toString();
  const hasWorkspace: boolean = Boolean(connected && connected.length > 0);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      setViews(await UserGroupsAPI.getForSchedule(scheduleId));
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [scheduleId]);

  useEffect(() => {
    if (!hasWorkspace) {
      return;
    }

    load().catch(() => {
      // load keeps its own error.
    });
  }, [hasWorkspace, load]);

  if (!connected || connected.length === 0) {
    return <></>;
  }

  // A group connected or looked at again replaces its row; one removed goes.
  const onChanged: (
    view: WorkspaceUserGroupView | null,
    removedId?: string,
  ) => void = (view: WorkspaceUserGroupView | null, removedId?: string) => {
    setViews((current: Array<WorkspaceUserGroupView>) => {
      const index: number = view
        ? current.findIndex((existing: WorkspaceUserGroupView): boolean => {
            return existing.workspaceUserGroupId === view.workspaceUserGroupId;
          })
        : -1;

      // Looked at again: the row keeps its place.
      if (view && index >= 0) {
        const next: Array<WorkspaceUserGroupView> = [...current];
        next[index] = view;
        return next;
      }

      const kept: Array<WorkspaceUserGroupView> = current.filter(
        (existing: WorkspaceUserGroupView): boolean => {
          return existing.workspaceUserGroupId !== removedId;
        },
      );

      return view ? [...kept, view] : kept;
    });
  };

  return (
    <Fragment>
      {connected.map((workspaceType: WorkspaceType) => {
        return (
          <WorkspaceUserGroupsCard
            key={workspaceType}
            workspaceType={workspaceType}
            scheduleId={scheduleId}
            scheduleName={props.scheduleName}
            views={views.filter((view: WorkspaceUserGroupView): boolean => {
              return view.workspaceType === workspaceType;
            })}
            isLoading={isLoading}
            error={error}
            onReload={() => {
              load().catch(() => {
                // load keeps its own error.
              });
            }}
            onChanged={onChanged}
            now={props.now}
          />
        );
      })}
    </Fragment>
  );
};

export default ScheduleUserGroupsCard;
