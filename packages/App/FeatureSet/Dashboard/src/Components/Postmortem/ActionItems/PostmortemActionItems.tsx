import ActionItemCodeTaskModal from "./ActionItemCodeTaskModal";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import PostmortemActionItemsApi from "./PostmortemActionItemsApi";
import {
  MORE_UNTRACKED_ACTION_ITEMS,
  POSTMORTEM_ACTION_ITEMS_COPY,
  POSTMORTEM_ACTION_ITEMS_TEST_IDS,
  TRACK_ACTION_ITEMS_BUTTON,
  UNTRACKED_ACTION_ITEMS_SENTENCE,
} from "./PostmortemActionItemsCopy";
import {
  ACTION_ITEM_MONITOR_QUERY_PARAM,
  ActionItemDueState,
  ActionItemProgress,
  MAX_UNTRACKED_TITLES_SHOWN,
  POSTMORTEM_ACTION_ITEMS_LIMIT,
  POSTMORTEM_ACTION_ITEM_SELECT,
  POSTMORTEM_ACTION_ITEM_TITLE_LIMIT,
  getActionItemDueState,
  getActionItemProgress,
  getUntrackedNoteItems,
  readNewActionItemTitle,
} from "./PostmortemActionItemsModel";
import CodeApi, { CodeRepositoryListItem } from "../../Code/CodeApi";
import { GitPullRequestMark } from "../../Code/CodeMarks";
import CodeTaskStageBadge from "../../Code/CodeTaskStageBadge";
import useInsightFixTasks, {
  InsightFixTasks,
} from "../../AIInsights/UseInsightFixTasks";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import useAiOffered from "../../../Utils/UseAiOffered";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentPostmortemActionItem from "Common/Models/DatabaseModels/IncidentPostmortemActionItem";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { CodeTaskSummaryJSON } from "Common/Types/AI/CodeTask";
import CodeTaskStageUtil, {
  CodeTaskStage,
} from "Common/Types/AI/CodeTaskStage";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import PostmortemActionItemStatus from "Common/Types/Incident/PostmortemActionItemStatus";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ModelEventType from "Common/Types/Realtime/ModelEventType";
import { ActionItemCodeTaskKind } from "Common/Utils/Incident/PostmortemActionItemCodeTask";
import { PostmortemNoteActionItem } from "Common/Utils/Incident/PostmortemNoteActionItems";
import { getActionItemCodeTaskOffer } from "Common/Utils/Suggestions/ActionItemCodeTaskSuggestion";
import SuggestionOffer from "Common/Utils/Suggestions/SuggestionOffer";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import Card from "Common/UI/Components/Card/Card";
import NamedSentence from "Common/UI/Components/DeleteConfirmation/NamedSentence";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Link from "Common/UI/Components/Link/Link";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuDivider from "Common/UI/Components/MoreMenu/Divider";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import { CREATE_NOT_ALLOWED_NOTE } from "Common/UI/Components/ModelTable/ModelTableEmptyState";
import PeopleAvatar from "Common/UI/Components/PeoplePicker/PeopleAvatar";
import {
  PeoplePickerFieldConfig,
  PeoplePickerKind,
  toPeoplePickerIds,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import { getLoadErrorStateProps } from "Common/UI/Components/Table/TableEmptyStateBuilders";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateOptions,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { usePrivateRecordGate } from "Common/UI/Utils/PrivateRecordScope";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import User from "Common/UI/Utils/User";
import useTranslateValue from "Common/UI/Utils/Translation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  incidentId: ObjectID;
  // The postmortem's note, as the page shows it: what it lists can be tracked.
  postmortemNote?: string | null | undefined;
  // Bumped when the postmortem changes: the list is read again.
  refreshToken?: string | undefined;
}

// The dialog open over the list, and the item it is about.
type ActionItemDialog =
  | { kind: "assign"; item: IncidentPostmortemActionItem }
  | { kind: "edit"; item: IncidentPostmortemActionItem }
  | { kind: "delete"; item: IncidentPostmortemActionItem }
  | {
      kind: "codeTask";
      item: IncidentPostmortemActionItem;
      taskKind: ActionItemCodeTaskKind;
    }
  | null;

const OWNER_KEY: string = "ownerUserId";

// The owner picker: one project member, searched by name or email.
const OWNER_PICKER: PeoplePickerFieldConfig = {
  kinds: [{ kind: PeoplePickerKind.User, valueKey: OWNER_KEY }],
  isSinglePick: true,
  addButtonText: translationKey("Choose someone"),
  searchPlaceholder: translationKey("Search by name or email…"),
  emptyText: translationKey("No project members"),
};

/*
 * The line that adds an action item: the text box and Add Action Item under
 * it on a phone, side by side from md up, as a case's tasks add one.
 */
const ADD_FORM_CLASS_NAME: string =
  "mt-1 flex flex-col gap-2 border-t border-gray-100 pt-4 md:flex-row md:items-center";

function nameOf(user: { name?: unknown; email?: unknown } | undefined): string {
  return user?.name?.toString() || user?.email?.toString() || "";
}

/*
 * A POSTMORTEM'S ACTION ITEMS (#6801), on the incident's Postmortem page:
 * what the team will do so this does not happen again.
 *
 * Each item is a line - a box to tick it done, what it is, who owns it and
 * when it is due (in red once the day is over), and what it became: the
 * code task OneUptime AI works on for it, with its pull request, or the
 * monitor made for it. Its ⋯ assigns it, edits it, asks OneUptime AI to
 * open its pull request or write a test (with AI on), creates its monitor,
 * marks it won't do or reopens it, and deletes it. A new one is typed into
 * the line under the list.
 *
 * When the postmortem's note lists action items the incident does not
 * track yet - OneUptime AI's draft and every template end with a section of
 * them - the card names them and tracks them all in one click, the note's
 * ticked boxes as done.
 *
 * Read with the person's own permissions, a private incident's as its team
 * reads it: someone who may not change items sees them, the box and ⋯
 * locked with the reason on hover. A colleague's change shows at once (the
 * items' live events).
 */
const PostmortemActionItems: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { translateString } = useTranslateValue();
  const addInputId: string = useId();
  const incidentIdText: string = props.incidentId.toString();
  const isAiOffered: boolean = useAiOffered();

  const privateRecordGate: (
    model: BaseModel,
  ) => PermissionGateOptions | undefined = usePrivateRecordGate();
  const model: IncidentPostmortemActionItem =
    useMemo((): IncidentPostmortemActionItem => {
      return new IncidentPostmortemActionItem();
    }, []);

  const createGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Create,
    privateRecordGate(model),
  );
  const updateGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Update,
    privateRecordGate(model),
  );
  const deleteGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Delete,
    privateRecordGate(model),
  );

  const [items, setItems] =
    useState<Array<IncidentPostmortemActionItem> | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");
  const [workingItemId, setWorkingItemId] = useState<string>("");
  const [newTitle, setNewTitle] = useState<string>("");
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [dialog, setDialog] = useState<ActionItemDialog>(null);
  const [dialogError, setDialogError] = useState<string>("");
  const [isDialogWorking, setIsDialogWorking] = useState<boolean>(false);
  const [repositories, setRepositories] =
    useState<Array<CodeRepositoryListItem> | null>(null);

  // Only the newest read lands: a slow one never replaces a newer list.
  const latestReadRef: MutableRefObject<number> = useRef<number>(0);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    const readNumber: number = latestReadRef.current + 1;
    latestReadRef.current = readNumber;

    try {
      const result: ListResult<IncidentPostmortemActionItem> =
        await ModelAPI.getList<IncidentPostmortemActionItem>({
          modelType: IncidentPostmortemActionItem,
          query: {
            incidentId: props.incidentId,
          },
          select: POSTMORTEM_ACTION_ITEM_SELECT,
          sort: {
            createdAt: SortOrder.Ascending,
          },
          skip: 0,
          limit: POSTMORTEM_ACTION_ITEMS_LIMIT,
        });

      if (readNumber === latestReadRef.current) {
        setItems(result.data);
        setLoadError("");
      }
    } catch (err) {
      if (readNumber === latestReadRef.current) {
        setLoadError(API.getFriendlyMessage(err));
      }
    }
  }, [incidentIdText]);

  useEffect(() => {
    void load();
  }, [load, props.refreshToken]);

  // A colleague's change: any item of the project's, read again.
  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    const stops: Array<() => void> = [
      ModelEventType.Create,
      ModelEventType.Update,
      ModelEventType.Delete,
    ].map((eventType: ModelEventType): (() => void) => {
      return Realtime.listenToModelEvent<IncidentPostmortemActionItem>(
        {
          eventType,
          modelType: IncidentPostmortemActionItem,
          tenantId: projectId,
        },
        () => {
          void load();
        },
      );
    });

    return () => {
      for (const stop of stops) {
        stop();
      }
    };
  }, [load]);

  /*
   * The repositories OneUptime AI can work in, read once AI is offered and
   * there is an open item that could ask for one: whether to offer a pull
   * request, or the one step before it - connecting a repository.
   */
  const hasOpenItem: boolean = Boolean(
    items?.some((item: IncidentPostmortemActionItem): boolean => {
      return item.status === PostmortemActionItemStatus.Open;
    }),
  );

  useEffect(() => {
    if (!isAiOffered || !hasOpenItem || !updateGate.isAllowed) {
      return;
    }

    let isCurrent: boolean = true;

    CodeApi.getRepositories()
      .then((response: { repositories: Array<CodeRepositoryListItem> }) => {
        if (isCurrent) {
          setRepositories(response.repositories);
        }
      })
      .catch(() => {
        // Code cannot be read: the rows offer no pull request.
        if (isCurrent) {
          setRepositories([]);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [isAiOffered, hasOpenItem, updateGate.isAllowed]);

  const connectedRepositories: Array<CodeRepositoryListItem> = (
    repositories || []
  ).filter((repository: CodeRepositoryListItem): boolean => {
    return repository.isConnected;
  });

  // The code tasks the items became, read together, and again while any moves.
  const codeTasks: InsightFixTasks = useInsightFixTasks(
    (items || []).map(
      (item: IncidentPostmortemActionItem): string | undefined => {
        return item.codeTaskId?.toString();
      },
    ),
  );

  const untracked: Array<PostmortemNoteActionItem> = items
    ? getUntrackedNoteItems(props.postmortemNote, items)
    : [];

  // A change to one item, then the list read again.
  const change: (
    item: IncidentPostmortemActionItem,
    data: JSONObject,
  ) => Promise<void> = async (
    item: IncidentPostmortemActionItem,
    data: JSONObject,
  ): Promise<void> => {
    const id: string = item._id?.toString() || "";

    setWorkingItemId(id);
    setActionError("");

    try {
      await ModelAPI.updateById<IncidentPostmortemActionItem>({
        modelType: IncidentPostmortemActionItem,
        id: new ObjectID(id),
        data,
      });
      await load();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setWorkingItemId("");
  };

  const add: () => Promise<void> = async (): Promise<void> => {
    const title: string | null = readNewActionItemTitle(newTitle);
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!title || !projectId || isAdding) {
      return;
    }

    setIsAdding(true);
    setActionError("");

    try {
      const item: IncidentPostmortemActionItem =
        new IncidentPostmortemActionItem();
      item.projectId = projectId;
      item.incidentId = props.incidentId;
      item.title = title;

      await ModelAPI.create<IncidentPostmortemActionItem>({
        model: item,
        modelType: IncidentPostmortemActionItem,
      });

      setNewTitle("");
      await load();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setIsAdding(false);
  };

  const track: () => Promise<void> = async (): Promise<void> => {
    setIsTracking(true);
    setActionError("");

    try {
      await PostmortemActionItemsApi.trackFromPostmortem({
        incidentId: props.incidentId,
        // The reader's own zone, by its IANA name: a due day starts there.
        timezone: OneUptimeDate.getCurrentTimezone().toString(),
      });
      await load();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setIsTracking(false);
  };

  // A dialog's change, kept open with its error when it fails.
  const runDialog: (work: () => Promise<void>) => Promise<void> = async (
    work: () => Promise<void>,
  ): Promise<void> => {
    setIsDialogWorking(true);
    setDialogError("");

    try {
      await work();
      setDialog(null);
      await load();
    } catch (err) {
      setDialogError(API.getFriendlyMessage(err));
    }

    setIsDialogWorking(false);
  };

  const openDialog: (next: ActionItemDialog) => void = (
    next: ActionItemDialog,
  ): void => {
    setDialogError("");
    setDialog(next);
  };

  const progress: ActionItemProgress = getActionItemProgress(items || []);
  const myUserId: string = User.getUserId()?.toString() || "";
  const now: Date = OneUptimeDate.getCurrentDate();

  // Who owns an item: a small avatar and the name, or No owner.
  const getOwner: (item: IncidentPostmortemActionItem) => ReactElement = (
    item: IncidentPostmortemActionItem,
  ): ReactElement => {
    const name: string = nameOf(item.ownerUser);

    if (!item.ownerUser || !name) {
      return (
        <span className="text-xs text-gray-500">
          {translator.translateText(POSTMORTEM_ACTION_ITEMS_COPY.noOwner)}
        </span>
      );
    }

    return (
      <span className="flex min-w-0 items-center gap-1.5" title={name}>
        <PeopleAvatar
          size="mini"
          item={{
            kind: PeoplePickerKind.User,
            name,
            userId:
              item.ownerUserId?.toString() ||
              item.ownerUser._id?.toString() ||
              undefined,
            hasProfilePicture: Boolean(item.ownerUser.profilePictureId),
          }}
        />
        <IsolatedText
          text={name}
          className="min-w-0 truncate text-xs text-gray-600"
        />
      </span>
    );
  };

  // When it is due: the day, in red once it is over.
  const getDue: (item: IncidentPostmortemActionItem) => ReactElement = (
    item: IncidentPostmortemActionItem,
  ): ReactElement => {
    const state: ActionItemDueState = getActionItemDueState(item, now);

    if (state === ActionItemDueState.None || !item.dueDate) {
      return <></>;
    }

    const date: string =
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        item.dueDate,
        true,
      );
    const isOverdue: boolean = state === ActionItemDueState.Overdue;

    return (
      <span
        className={`inline-flex items-center gap-1 whitespace-nowrap text-xs ${
          isOverdue ? "font-medium text-red-700" : "text-gray-600"
        }`}
        data-testid={POSTMORTEM_ACTION_ITEMS_TEST_IDS.due}
        data-overdue={isOverdue ? "true" : "false"}
      >
        <Icon
          icon={isOverdue ? IconProp.Alert : IconProp.Calendar}
          className="h-3.5 w-3.5 flex-shrink-0"
        />
        {translator.translateTemplate(
          isOverdue
            ? POSTMORTEM_ACTION_ITEMS_COPY.overdue
            : POSTMORTEM_ACTION_ITEMS_COPY.due,
          { date },
        )}
      </span>
    );
  };

  // What it became: the code task OneUptime AI works on, and the monitor made for it.
  const getBecame: (item: IncidentPostmortemActionItem) => ReactElement = (
    item: IncidentPostmortemActionItem,
  ): ReactElement => {
    const taskId: string = item.codeTaskId?.toString() || "";
    const task: CodeTaskSummaryJSON | undefined = taskId
      ? codeTasks.tasks.get(taskId.toLowerCase())
      : undefined;
    const stage: CodeTaskStage | null = task
      ? CodeTaskStageUtil.fromSummary(task)
      : null;

    return (
      <>
        {taskId ? (
          <span
            className="inline-flex min-w-0 items-center gap-2"
            data-testid={POSTMORTEM_ACTION_ITEMS_TEST_IDS.codeTask}
          >
            <Link
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.CODE_TASK_VIEW] as Route,
                { modelId: new ObjectID(taskId) },
              )}
              className="inline-flex min-w-0"
            >
              <CodeTaskStageBadge
                stage={stage}
                dataTestId="postmortem-action-item-code-task-stage"
              />
            </Link>
            {task?.pullRequest?.url ? (
              <Link
                to={URL.fromString(task.pullRequest.url)}
                openInNewTab={true}
                className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-gray-700 hover:text-indigo-600 hover:underline"
              >
                <>
                  <GitPullRequestMark className="h-3.5 w-3.5 flex-shrink-0" />
                  {task.pullRequest.number
                    ? translator.translateTemplate(
                        POSTMORTEM_ACTION_ITEMS_COPY.pullRequest,
                        {
                          number: translator.formatNumber(
                            task.pullRequest.number,
                          ),
                        },
                      )
                    : translator.translateText("Pull request")}
                </>
              </Link>
            ) : (
              <></>
            )}
          </span>
        ) : (
          <></>
        )}
        {item.monitorId ? (
          <Link
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_VIEW] as Route,
              { modelId: new ObjectID(item.monitorId.toString()) },
            )}
            dataTestId={POSTMORTEM_ACTION_ITEMS_TEST_IDS.monitor}
            className="inline-flex min-w-0 items-center gap-1 text-xs font-medium text-gray-700 hover:text-indigo-600 hover:underline"
          >
            <>
              <Icon
                icon={IconProp.AltGlobe}
                className="h-3.5 w-3.5 flex-shrink-0"
              />
              <span className="sr-only">
                {translator.translateText(POSTMORTEM_ACTION_ITEMS_COPY.monitor)}
              </span>
              <IsolatedText
                text={item.monitor?.name?.toString() || ""}
                className="min-w-0 truncate"
              />
            </>
          </Link>
        ) : (
          <></>
        )}
      </>
    );
  };

  // Who closed it, and when: done by a person, by its pull request, or won't do.
  const getClosedLine: (item: IncidentPostmortemActionItem) => ReactElement = (
    item: IncidentPostmortemActionItem,
  ): ReactElement => {
    if (item.status === PostmortemActionItemStatus.Open || !item.closedAt) {
      return <></>;
    }

    const time: string = OneUptimeDate.fromNow(item.closedAt);
    const closedBy: string = nameOf(item.closedByUser);
    const isWontDo: boolean = item.status === PostmortemActionItemStatus.WontDo;

    let line: ReactElement;

    if (closedBy) {
      line = (
        <TranslatedSentence
          template={
            isWontDo
              ? POSTMORTEM_ACTION_ITEMS_COPY.wontDoBy
              : POSTMORTEM_ACTION_ITEMS_COPY.doneBy
          }
          slots={{ name: <IsolatedText text={closedBy} /> }}
          values={{ time }}
        />
      );
    } else if (isWontDo) {
      line = (
        <>{translator.translateText(POSTMORTEM_ACTION_ITEMS_COPY.wontDo)}</>
      );
    } else {
      line = (
        <>
          {translator.translateTemplate(
            item.codeTaskId
              ? POSTMORTEM_ACTION_ITEMS_COPY.doneByPullRequest
              : POSTMORTEM_ACTION_ITEMS_COPY.doneAt,
            { time },
          )}
        </>
      );
    }

    return (
      <p
        className="text-xs text-gray-500"
        data-testid={POSTMORTEM_ACTION_ITEMS_TEST_IDS.closedLine}
        title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          item.closedAt,
        )}
      >
        {line}
      </p>
    );
  };

  const getMenuItems: (
    item: IncidentPostmortemActionItem,
  ) => Array<ReactElement> = (
    item: IncidentPostmortemActionItem,
  ): Array<ReactElement> => {
    const id: string = item._id?.toString() || "";
    const isWorking: boolean = workingItemId === id;
    const isOpen: boolean = item.status === PostmortemActionItemStatus.Open;
    const isMine: boolean =
      Boolean(item.ownerUserId) && item.ownerUserId?.toString() === myUserId;
    const taskId: string = item.codeTaskId?.toString() || "";
    const task: CodeTaskSummaryJSON | undefined = taskId
      ? codeTasks.tasks.get(taskId.toLowerCase())
      : undefined;

    const codeTaskOffer: SuggestionOffer =
      updateGate.isAllowed && repositories !== null
        ? getActionItemCodeTaskOffer({
            isAiEnabled: isAiOffered,
            isOpen,
            taskStage: task ? CodeTaskStageUtil.fromSummary(task) : null,
            hasConnectedRepository: connectedRepositories.length > 0,
          })
        : SuggestionOffer.None;

    const menu: Array<ReactElement> = [];

    if (!isMine) {
      menu.push(
        <MoreMenuItem
          key="assign-to-me"
          icon={IconProp.User}
          text={POSTMORTEM_ACTION_ITEMS_COPY.assignToMe}
          isDisabled={!updateGate.isAllowed || isWorking}
          tooltip={updateGate.disabledReason}
          isTooltipTranslated={true}
          onClick={() => {
            void change(item, { ownerUserId: myUserId });
          }}
        />,
      );
    }

    menu.push(
      <MoreMenuItem
        key="assign-to-someone-else"
        icon={IconProp.UserPlus}
        text={POSTMORTEM_ACTION_ITEMS_COPY.assignToSomeoneElse}
        isDisabled={!updateGate.isAllowed || isWorking}
        tooltip={updateGate.disabledReason}
        isTooltipTranslated={true}
        onClick={() => {
          openDialog({ kind: "assign", item });
        }}
      />,
    );

    if (item.ownerUserId) {
      menu.push(
        <MoreMenuItem
          key="unassign"
          icon={IconProp.Close}
          text={POSTMORTEM_ACTION_ITEMS_COPY.unassign}
          isDisabled={!updateGate.isAllowed || isWorking}
          tooltip={updateGate.disabledReason}
          isTooltipTranslated={true}
          onClick={() => {
            void change(item, { ownerUserId: null });
          }}
        />,
      );
    }

    menu.push(
      <MoreMenuItem
        key="edit"
        icon={IconProp.Edit}
        text={POSTMORTEM_ACTION_ITEMS_COPY.editActionItem}
        isDisabled={!updateGate.isAllowed || isWorking}
        tooltip={updateGate.disabledReason}
        isTooltipTranslated={true}
        onClick={() => {
          openDialog({ kind: "edit", item });
        }}
      />,
    );

    /*
     * What it can become: a pull request or a test OneUptime AI writes (with
     * AI on, and a repository it reaches - or the one step before it), and a
     * monitor.
     */
    if (isOpen) {
      menu.push(<MoreMenuDivider key="became-divider" />);

      if (codeTaskOffer === SuggestionOffer.Act) {
        menu.push(
          <MoreMenuItem
            key="open-pull-request"
            icon={IconProp.Code}
            text={POSTMORTEM_ACTION_ITEMS_COPY.openPullRequest}
            isDisabled={isWorking}
            onClick={() => {
              openDialog({
                kind: "codeTask",
                item,
                taskKind: ActionItemCodeTaskKind.PullRequest,
              });
            }}
          />,
          <MoreMenuItem
            key="write-test"
            icon={IconProp.Beaker}
            text={POSTMORTEM_ACTION_ITEMS_COPY.writeTest}
            isDisabled={isWorking}
            onClick={() => {
              openDialog({
                kind: "codeTask",
                item,
                taskKind: ActionItemCodeTaskKind.Test,
              });
            }}
          />,
        );
      } else if (codeTaskOffer === SuggestionOffer.SetUp) {
        menu.push(
          <MoreMenuItem
            key="connect-repository"
            icon={IconProp.Code}
            text={POSTMORTEM_ACTION_ITEMS_COPY.connectRepository}
            onClick={() => {
              Navigation.navigate(RouteUtil.getPageRoute(PageMap.CODE));
            }}
          />,
        );
      }

      if (!item.monitorId) {
        menu.push(
          <MoreMenuItem
            key="create-monitor"
            icon={IconProp.AltGlobe}
            text={POSTMORTEM_ACTION_ITEMS_COPY.createMonitor}
            isDisabled={!updateGate.isAllowed || isWorking}
            tooltip={updateGate.disabledReason}
            isTooltipTranslated={true}
            onClick={() => {
              Navigation.navigate(
                RouteUtil.getPageRoute(PageMap.MONITOR_CREATE, {
                  query: { [ACTION_ITEM_MONITOR_QUERY_PARAM]: id },
                }),
              );
            }}
          />,
        );
      }
    }

    menu.push(<MoreMenuDivider key="status-divider" />);

    menu.push(
      item.status === PostmortemActionItemStatus.WontDo ? (
        <MoreMenuItem
          key="reopen"
          icon={IconProp.Refresh}
          text={POSTMORTEM_ACTION_ITEMS_COPY.reopen}
          isDisabled={!updateGate.isAllowed || isWorking}
          tooltip={updateGate.disabledReason}
          isTooltipTranslated={true}
          onClick={() => {
            void change(item, { status: PostmortemActionItemStatus.Open });
          }}
        />
      ) : (
        <MoreMenuItem
          key="wont-do"
          icon={IconProp.Hide}
          text={POSTMORTEM_ACTION_ITEMS_COPY.markWontDo}
          isDisabled={!updateGate.isAllowed || isWorking}
          tooltip={updateGate.disabledReason}
          isTooltipTranslated={true}
          onClick={() => {
            void change(item, { status: PostmortemActionItemStatus.WontDo });
          }}
        />
      ),
    );

    menu.push(
      <MoreMenuItem
        key="delete"
        icon={IconProp.Trash}
        text={POSTMORTEM_ACTION_ITEMS_COPY.deleteActionItem}
        isDestructive={true}
        isDisabled={!deleteGate.isAllowed || isWorking}
        tooltip={deleteGate.disabledReason}
        isTooltipTranslated={true}
        onClick={() => {
          openDialog({ kind: "delete", item });
        }}
      />,
    );

    return menu;
  };

  const getRow: (item: IncidentPostmortemActionItem) => ReactElement = (
    item: IncidentPostmortemActionItem,
  ): ReactElement => {
    const id: string = item._id?.toString() || "";
    const titleId: string = `postmortem-action-item-title-${id}`;
    const isDone: boolean = item.status === PostmortemActionItemStatus.Done;
    const isWontDo: boolean = item.status === PostmortemActionItemStatus.WontDo;
    const isClosed: boolean = isDone || isWontDo;
    const isWorking: boolean = workingItemId === id;

    return (
      <li
        key={id}
        className="flex items-start gap-3 py-3"
        data-testid={POSTMORTEM_ACTION_ITEMS_TEST_IDS.row}
        data-status={item.status || PostmortemActionItemStatus.Open}
      >
        <span className="flex h-6 shrink-0 items-center">
          <input
            type="checkbox"
            checked={isDone}
            disabled={!updateGate.isAllowed || isWorking}
            aria-labelledby={titleId}
            title={
              updateGate.isAllowed
                ? translator.translateTemplate(
                    isDone
                      ? POSTMORTEM_ACTION_ITEMS_COPY.markNotDone
                      : POSTMORTEM_ACTION_ITEMS_COPY.markDone,
                    { title: item.title || "" },
                  )
                : updateGate.disabledReason
            }
            data-testid={POSTMORTEM_ACTION_ITEMS_TEST_IDS.checkbox}
            onChange={() => {
              void change(item, {
                status: isDone
                  ? PostmortemActionItemStatus.Open
                  : PostmortemActionItemStatus.Done,
              });
            }}
            className="h-4 w-4 cursor-pointer rounded border-gray-300 text-indigo-600 accent-indigo-600 focus:ring-indigo-600 disabled:cursor-not-allowed"
          />
        </span>
        <div className="min-w-0 flex-1">
          <p
            id={titleId}
            className={`break-words text-sm leading-6 ${
              isClosed ? "text-gray-500 line-through" : "text-gray-900"
            }`}
            data-testid={POSTMORTEM_ACTION_ITEMS_TEST_IDS.title}
          >
            <IsolatedText text={item.title || ""} />
          </p>
          {item.description ? (
            <p className="line-clamp-2 break-words text-xs text-gray-500">
              <IsolatedText text={item.description} />
            </p>
          ) : (
            <></>
          )}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {isWontDo ? (
              <Pill
                text={POSTMORTEM_ACTION_ITEMS_COPY.wontDo}
                tone={PillTone.Paused}
              />
            ) : (
              <></>
            )}
            <span data-testid={POSTMORTEM_ACTION_ITEMS_TEST_IDS.owner}>
              {getOwner(item)}
            </span>
            {getDue(item)}
            {getBecame(item)}
          </div>
          {getClosedLine(item)}
        </div>
        {/* The row's ⋯, level with the item's first line. */}
        <div className="-mt-1 flex shrink-0 items-center md:-mt-0.5">
          <MoreMenu
            ariaLabel={POSTMORTEM_ACTION_ITEMS_COPY.moreActions}
            dataTestId={POSTMORTEM_ACTION_ITEMS_TEST_IDS.more}
            menuIcon={IconProp.EllipsisHorizontal}
            isMenuPortaled={true}
          >
            {getMenuItems(item)}
          </MoreMenu>
        </div>
      </li>
    );
  };

  /*
   * The note's untracked action items, named, with the one button that
   * tracks them all - only for someone who may add items.
   */
  const getTrackSuggestion: () => ReactElement = (): ReactElement => {
    if (untracked.length === 0 || !createGate.isAllowed) {
      return <></>;
    }

    const named: Array<PostmortemNoteActionItem> = untracked.slice(
      0,
      MAX_UNTRACKED_TITLES_SHOWN,
    );
    const more: number = untracked.length - named.length;

    return (
      <div
        className="mb-4 rounded-md border border-indigo-100 bg-indigo-50 px-4 py-3"
        data-testid={POSTMORTEM_ACTION_ITEMS_TEST_IDS.track}
      >
        <p className="text-sm font-medium text-indigo-900">
          {translator.translatePlural(
            UNTRACKED_ACTION_ITEMS_SENTENCE,
            untracked.length,
          )}
        </p>
        <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm text-indigo-900">
          {named.map((noteItem: PostmortemNoteActionItem, index: number) => {
            return (
              <li key={`${index}-${noteItem.title}`} className="break-words">
                <IsolatedText text={noteItem.title} />
              </li>
            );
          })}
          {more > 0 ? (
            <li className="list-none text-indigo-700">
              {translator.translatePlural(MORE_UNTRACKED_ACTION_ITEMS, more)}
            </li>
          ) : (
            <></>
          )}
        </ul>
        <p className="mt-1 text-xs text-indigo-800">
          {translator.translateText(POSTMORTEM_ACTION_ITEMS_COPY.trackHelp)}
        </p>
        <div className="mt-3">
          <Button
            title={translator.translatePlural(
              TRACK_ACTION_ITEMS_BUTTON,
              untracked.length,
            )}
            isTitleTranslated={true}
            icon={IconProp.CheckCircle}
            buttonStyle={ButtonStyleType.PRIMARY}
            buttonSize={ButtonSize.Small}
            isLoading={isTracking}
            disabled={isTracking}
            dataTestId={POSTMORTEM_ACTION_ITEMS_TEST_IDS.trackButton}
            onClick={() => {
              void track();
            }}
          />
        </div>
      </div>
    );
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (loadError && !items) {
      return (
        <TableEmptyState
          {...getLoadErrorStateProps({
            pluralLabel: POSTMORTEM_ACTION_ITEMS_COPY.title,
            error: loadError,
            onRetry: () => {
              void load();
            },
            translate: (value: string): string => {
              return translateString(value) ?? value;
            },
            translator,
          })}
          isCompact={true}
          dataTestId={POSTMORTEM_ACTION_ITEMS_TEST_IDS.error}
        />
      );
    }

    if (!items) {
      return <TableSkeleton rows={3} />;
    }

    return (
      <>
        {getTrackSuggestion()}

        {items.length === 0 ? (
          untracked.length > 0 && createGate.isAllowed ? (
            <></>
          ) : (
            <TableEmptyState
              kind={TableEmptyStateKind.Empty}
              icon={IconProp.ClipboardDocumentCheck}
              title={POSTMORTEM_ACTION_ITEMS_COPY.emptyTitle}
              description={POSTMORTEM_ACTION_ITEMS_COPY.emptyDescription}
              note={createGate.isAllowed ? undefined : CREATE_NOT_ALLOWED_NOTE}
              isCompact={true}
              dataTestId={POSTMORTEM_ACTION_ITEMS_TEST_IDS.empty}
            />
          )
        ) : (
          <ul
            className="divide-y divide-gray-100"
            data-testid={POSTMORTEM_ACTION_ITEMS_TEST_IDS.list}
          >
            {items.map(getRow)}
          </ul>
        )}

        {createGate.isAllowed ? (
          <form
            className={ADD_FORM_CLASS_NAME}
            onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              void add();
            }}
          >
            <label htmlFor={addInputId} className="sr-only">
              {translator.translateText(POSTMORTEM_ACTION_ITEMS_COPY.addLabel)}
            </label>
            <Input
              id={addInputId}
              value={newTitle}
              maxLength={POSTMORTEM_ACTION_ITEM_TITLE_LIMIT}
              placeholder={POSTMORTEM_ACTION_ITEMS_COPY.addPlaceholder}
              disabled={isAdding}
              dataTestId={POSTMORTEM_ACTION_ITEMS_TEST_IDS.addInput}
              outerDivClassName="relative w-full min-w-0 flex-1 rounded-md shadow-sm"
              onChange={(value: string) => {
                setNewTitle(value);
              }}
            />
            <Button
              title={POSTMORTEM_ACTION_ITEMS_COPY.addButton}
              icon={IconProp.Add}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Normal}
              type={ButtonType.Submit}
              isLoading={isAdding}
              disabled={!readNewActionItemTitle(newTitle) || isAdding}
              dataTestId={POSTMORTEM_ACTION_ITEMS_TEST_IDS.addButton}
            />
          </form>
        ) : (
          <></>
        )}
      </>
    );
  };

  const editSection: ReturnType<typeof getAdvancedFormSection> =
    getAdvancedFormSection<JSONObject>();

  return (
    <>
      <Card
        title={POSTMORTEM_ACTION_ITEMS_COPY.title}
        description={POSTMORTEM_ACTION_ITEMS_COPY.description}
        rightElement={
          items && progress.total > 0 ? (
            <span
              className="whitespace-nowrap rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
              data-testid={POSTMORTEM_ACTION_ITEMS_TEST_IDS.progress}
            >
              {translator.translateTemplate(
                POSTMORTEM_ACTION_ITEMS_COPY.progress,
                {
                  done: translator.formatNumber(progress.done),
                  total: translator.formatNumber(progress.total),
                },
              )}
            </span>
          ) : undefined
        }
      >
        <div data-testid={POSTMORTEM_ACTION_ITEMS_TEST_IDS.card}>
          {actionError ? (
            <div className="pb-3">
              <Alert type={AlertType.DANGER} title={actionError} />
            </div>
          ) : (
            <></>
          )}
          {getBody()}
        </div>
      </Card>

      {dialog?.kind === "assign" ? (
        <BasicFormModal<JSONObject>
          title={POSTMORTEM_ACTION_ITEMS_COPY.assignTitle}
          description={
            <NamedSentence
              template={POSTMORTEM_ACTION_ITEMS_COPY.assignDescription}
              slot="title"
              name={dialog.item.title || ""}
              dataTestId={POSTMORTEM_ACTION_ITEMS_TEST_IDS.dialogItem}
            />
          }
          submitButtonText={POSTMORTEM_ACTION_ITEMS_COPY.assignSubmit}
          isSubmitting={isDialogWorking}
          error={dialogError || undefined}
          onClose={() => {
            setDialog(null);
          }}
          formProps={{
            name: "postmortem-action-item-assign",
            initialValues: {},
            fields: [
              {
                field: { owner: true },
                title: POSTMORTEM_ACTION_ITEMS_COPY.ownerField,
                fieldType: FormFieldSchemaType.PeoplePicker,
                required: true,
                peoplePicker: OWNER_PICKER,
              },
            ],
          }}
          onSubmit={async (values: FormValues<JSONObject>) => {
            const userId: string | undefined = toPeoplePickerIds(
              (values as JSONObject)[OWNER_KEY],
            )[0];

            await runDialog(async (): Promise<void> => {
              await ModelAPI.updateById<IncidentPostmortemActionItem>({
                modelType: IncidentPostmortemActionItem,
                id: new ObjectID(dialog.item._id!.toString()),
                data: { ownerUserId: userId || null },
              });
            });
          }}
        />
      ) : (
        <></>
      )}

      {dialog?.kind === "edit" ? (
        <BasicFormModal<JSONObject>
          title={POSTMORTEM_ACTION_ITEMS_COPY.editTitle}
          submitButtonText={POSTMORTEM_ACTION_ITEMS_COPY.saveChanges}
          isSubmitting={isDialogWorking}
          error={dialogError || undefined}
          onClose={() => {
            setDialog(null);
          }}
          formProps={{
            name: "postmortem-action-item-edit",
            initialValues: {
              title: dialog.item.title || "",
              dueDate: dialog.item.dueDate || undefined,
              description: dialog.item.description || "",
            },
            fields: [
              {
                field: { title: true },
                title: POSTMORTEM_ACTION_ITEMS_COPY.titleField,
                fieldType: FormFieldSchemaType.Text,
                required: true,
                validation: {
                  maxLength: POSTMORTEM_ACTION_ITEM_TITLE_LIMIT,
                },
              },
              {
                field: { dueDate: true },
                title: POSTMORTEM_ACTION_ITEMS_COPY.dueDateField,
                fieldType: FormFieldSchemaType.Date,
                required: false,
              },
              {
                field: { description: true },
                title: POSTMORTEM_ACTION_ITEMS_COPY.descriptionField,
                description: POSTMORTEM_ACTION_ITEMS_COPY.descriptionHelp,
                fieldType: FormFieldSchemaType.Markdown,
                required: false,
                collapsibleSection: editSection,
              },
            ],
          }}
          onSubmit={async (values: FormValues<JSONObject>) => {
            const record: JSONObject = values as JSONObject;
            const title: string | null = readNewActionItemTitle(
              String(record["title"] || ""),
            );

            if (!title) {
              return;
            }

            const description: string =
              typeof record["description"] === "string"
                ? (record["description"] as string).trim()
                : "";

            await runDialog(async (): Promise<void> => {
              await ModelAPI.updateById<IncidentPostmortemActionItem>({
                modelType: IncidentPostmortemActionItem,
                id: new ObjectID(dialog.item._id!.toString()),
                data: {
                  title,
                  dueDate: record["dueDate"] || null,
                  description: description || null,
                },
              });
            });
          }}
        />
      ) : (
        <></>
      )}

      {dialog?.kind === "codeTask" ? (
        <ActionItemCodeTaskModal
          actionItemId={new ObjectID(dialog.item._id!.toString())}
          actionItemTitle={dialog.item.title || ""}
          kind={dialog.taskKind}
          repositories={connectedRepositories}
          onClose={() => {
            setDialog(null);
          }}
          onStarted={() => {
            setDialog(null);
            void load();
          }}
        />
      ) : (
        <></>
      )}

      {dialog?.kind === "delete" ? (
        <ConfirmModal
          title={POSTMORTEM_ACTION_ITEMS_COPY.deleteTitle}
          description={
            <NamedSentence
              template={POSTMORTEM_ACTION_ITEMS_COPY.deleteDescription}
              slot="title"
              name={dialog.item.title || ""}
              dataTestId={POSTMORTEM_ACTION_ITEMS_TEST_IDS.dialogItem}
            />
          }
          submitButtonText={POSTMORTEM_ACTION_ITEMS_COPY.deleteSubmit}
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isDialogWorking}
          error={dialogError || undefined}
          onClose={() => {
            setDialog(null);
          }}
          onSubmit={() => {
            void runDialog(async (): Promise<void> => {
              await ModelAPI.deleteItem<IncidentPostmortemActionItem>({
                modelType: IncidentPostmortemActionItem,
                id: new ObjectID(dialog.item._id!.toString()),
              });
            });
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default PostmortemActionItems;
