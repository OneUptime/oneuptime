import UserElement from "../../User/User";
import {
  SECURITY_CASE_TASKS_COPY,
  SECURITY_CASE_TASKS_TEST_IDS,
} from "./SecurityCaseTasksCopy";
import {
  SECURITY_CASE_TASKS_LIMIT,
  SECURITY_CASE_TASK_SELECT,
  SECURITY_CASE_TASK_TITLE_LIMIT,
  SecurityCaseTaskProgress,
  getSecurityCaseTaskProgress,
  readNewTaskTitle,
} from "./SecurityCaseTasksModel";
import SecurityCaseTask from "Common/Models/DatabaseModels/SecurityCaseTask";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ModelEventType from "Common/Types/Realtime/ModelEventType";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuDivider from "Common/UI/Components/MoreMenu/Divider";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import {
  PeoplePickerKind,
  toPeoplePickerIds,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import API from "Common/UI/Utils/API/API";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import User from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  MutableRefObject,
} from "react";

export interface ComponentProps {
  caseId: ObjectID;
  // Bumped when the case changes: the list is read again.
  refreshToken?: string | undefined;
}

// The dialog open over the list, and the task it is about.
type TaskDialog =
  | { kind: "assign"; task: SecurityCaseTask }
  | { kind: "edit"; task: SecurityCaseTask }
  | { kind: "delete"; task: SecurityCaseTask }
  | null;

const ASSIGN_USER_KEY: string = "assignedToUserId";

/*
 * A case's checklist: what has to be done on it, and who is doing it.
 *
 * Each task is a line - a box to tick it off, what it is, who has it and,
 * once done, who did it and when - with Assign to Me, Assign to Someone
 * Else, Unassign, Edit Task and Delete Task in its ⋯. A new task is typed
 * into the line under the list, Enter to add it, and handed to somebody
 * from its ⋯: the person it is handed to is told (SecurityCaseTaskService).
 * How many are done sits beside the title; how many are open, beside Tasks
 * in the case's side menu.
 *
 * Read with the person's own permissions: a Security Viewer sees the list,
 * its boxes and actions locked with the reason on hover. A colleague's
 * change shows at once (the task model's live events).
 */
const SecurityCaseTasks: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const addInputId: string = useId();
  const caseIdText: string = props.caseId.toString();

  const createGate: PermissionGateResult = PermissionGate.check(
    new SecurityCaseTask(),
    ModelAction.Create,
  );
  const updateGate: PermissionGateResult = PermissionGate.check(
    new SecurityCaseTask(),
    ModelAction.Update,
  );
  const deleteGate: PermissionGateResult = PermissionGate.check(
    new SecurityCaseTask(),
    ModelAction.Delete,
  );

  const [tasks, setTasks] = useState<Array<SecurityCaseTask> | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");
  const [workingTaskId, setWorkingTaskId] = useState<string>("");
  const [newTitle, setNewTitle] = useState<string>("");
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [dialog, setDialog] = useState<TaskDialog>(null);
  const [dialogError, setDialogError] = useState<string>("");
  const [isDialogWorking, setIsDialogWorking] = useState<boolean>(false);

  // Only the newest read lands: a slow one never replaces a newer list.
  const latestReadRef: MutableRefObject<number> = useRef<number>(0);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    const readNumber: number = latestReadRef.current + 1;
    latestReadRef.current = readNumber;

    try {
      const result: ListResult<SecurityCaseTask> =
        await ModelAPI.getList<SecurityCaseTask>({
          modelType: SecurityCaseTask,
          query: {
            securityCaseId: props.caseId,
          },
          select: SECURITY_CASE_TASK_SELECT,
          sort: {
            createdAt: SortOrder.Ascending,
          },
          skip: 0,
          limit: SECURITY_CASE_TASKS_LIMIT,
        });

      if (readNumber === latestReadRef.current) {
        setTasks(result.data);
        setLoadError("");
      }
    } catch (err) {
      if (readNumber === latestReadRef.current) {
        setLoadError(API.getFriendlyMessage(err));
      }
    }
  }, [caseIdText]);

  useEffect(() => {
    void load();
  }, [load, props.refreshToken]);

  // A colleague's change: any task of the project's, read again.
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
      return Realtime.listenToModelEvent<SecurityCaseTask>(
        {
          eventType,
          modelType: SecurityCaseTask,
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

  // A change to one task, then the list and the side menu's count read again.
  const change: (task: SecurityCaseTask, data: JSONObject) => Promise<void> =
    async (task: SecurityCaseTask, data: JSONObject): Promise<void> => {
      const id: string = task._id?.toString() || "";

      setWorkingTaskId(id);
      setActionError("");

      try {
        await ModelAPI.updateById<SecurityCaseTask>({
          modelType: SecurityCaseTask,
          id: new ObjectID(id),
          data,
        });
        GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
        await load();
      } catch (err) {
        setActionError(API.getFriendlyMessage(err));
      }

      setWorkingTaskId("");
    };

  const add: () => Promise<void> = async (): Promise<void> => {
    const title: string | null = readNewTaskTitle(newTitle);
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!title || !projectId || isAdding) {
      return;
    }

    setIsAdding(true);
    setActionError("");

    try {
      const task: SecurityCaseTask = new SecurityCaseTask();
      task.projectId = projectId;
      task.securityCaseId = props.caseId;
      task.title = title;

      await ModelAPI.create<SecurityCaseTask>({
        model: task,
        modelType: SecurityCaseTask,
      });

      setNewTitle("");
      GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
      await load();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setIsAdding(false);
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
      GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
      await load();
    } catch (err) {
      setDialogError(API.getFriendlyMessage(err));
    }

    setIsDialogWorking(false);
  };

  const openDialog: (next: TaskDialog) => void = (next: TaskDialog): void => {
    setDialogError("");
    setDialog(next);
  };

  const progress: SecurityCaseTaskProgress = getSecurityCaseTaskProgress(
    tasks || [],
  );
  const myUserId: string = User.getUserId()?.toString() || "";

  const getRow: (task: SecurityCaseTask) => ReactElement = (
    task: SecurityCaseTask,
  ): ReactElement => {
    const id: string = task._id?.toString() || "";
    const titleId: string = `security-case-task-title-${id}`;
    const isDone: boolean = task.isDone === true;
    const isWorking: boolean = workingTaskId === id;
    const isMine: boolean =
      Boolean(task.assignedToUserId) &&
      task.assignedToUserId?.toString() === myUserId;
    const doneByName: string =
      task.doneByUser?.name?.toString() ||
      task.doneByUser?.email?.toString() ||
      "";
    const doneTime: string = task.doneAt
      ? OneUptimeDate.fromNow(task.doneAt)
      : "";

    return (
      <li
        key={id}
        className="flex items-start gap-3 py-3"
        data-testid={SECURITY_CASE_TASKS_TEST_IDS.row}
        data-done={isDone ? "true" : "false"}
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
                      ? SECURITY_CASE_TASKS_COPY.markNotDone
                      : SECURITY_CASE_TASKS_COPY.markDone,
                    { title: task.title || "" },
                  )
                : updateGate.disabledReason
            }
            data-testid={SECURITY_CASE_TASKS_TEST_IDS.checkbox}
            onChange={() => {
              void change(task, { isDone: !isDone });
            }}
            className="h-4 w-4 cursor-pointer rounded border-gray-300 text-indigo-600 accent-indigo-600 focus:ring-indigo-600 disabled:cursor-not-allowed"
          />
        </span>
        <div className="min-w-0 flex-1">
          <p
            id={titleId}
            className={`break-words text-sm leading-6 ${
              isDone ? "text-gray-500 line-through" : "text-gray-900"
            }`}
            data-testid={SECURITY_CASE_TASKS_TEST_IDS.title}
          >
            <IsolatedText text={task.title || ""} />
          </p>
          {isDone && doneTime ? (
            <p
              className="text-xs text-gray-500"
              data-testid={SECURITY_CASE_TASKS_TEST_IDS.doneLine}
              title={
                task.doneAt
                  ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                      task.doneAt,
                    )
                  : undefined
              }
            >
              {doneByName
                ? translator.translateTemplate(SECURITY_CASE_TASKS_COPY.doneBy, {
                    name: doneByName,
                    time: doneTime,
                  })
                : translator.translateTemplate(SECURITY_CASE_TASKS_COPY.doneAt, {
                    time: doneTime,
                  })}
            </p>
          ) : (
            <></>
          )}
        </div>
        <div
          className="flex shrink-0 items-center gap-2"
          data-testid={SECURITY_CASE_TASKS_TEST_IDS.assignee}
        >
          <span className="hidden max-w-[12rem] min-w-0 sm:block">
            {task.assignedToUser ? (
              <UserElement user={task.assignedToUser} hideEmail={true} />
            ) : (
              <span className="text-sm text-gray-400">
                {translator.translateText(SECURITY_CASE_TASKS_COPY.unassigned)}
              </span>
            )}
          </span>
          <MoreMenu
            ariaLabel={translator.translateText(
              SECURITY_CASE_TASKS_COPY.moreActions,
            )}
            dataTestId={SECURITY_CASE_TASKS_TEST_IDS.more}
            elementToBeShownInsteadOfButton={
              <Icon icon={IconProp.EllipsisHorizontal} className="h-4 w-4" />
            }
            isMenuPortaled={true}
          >
            {[
              ...(!isMine
                ? [
                    <MoreMenuItem
                      key="assign-to-me"
                      icon={IconProp.User}
                      text={SECURITY_CASE_TASKS_COPY.assignToMe}
                      isDisabled={!updateGate.isAllowed || isWorking}
                      tooltip={updateGate.disabledReason}
                      onClick={() => {
                        void change(task, {
                          assignedToUserId: myUserId,
                        });
                      }}
                    />,
                  ]
                : []),
              <MoreMenuItem
                key="assign-to-someone-else"
                icon={IconProp.UserPlus}
                text={SECURITY_CASE_TASKS_COPY.assignToSomeoneElse}
                isDisabled={!updateGate.isAllowed || isWorking}
                tooltip={updateGate.disabledReason}
                onClick={() => {
                  openDialog({ kind: "assign", task });
                }}
              />,
              ...(task.assignedToUserId
                ? [
                    <MoreMenuItem
                      key="unassign"
                      icon={IconProp.Close}
                      text={SECURITY_CASE_TASKS_COPY.unassign}
                      isDisabled={!updateGate.isAllowed || isWorking}
                      tooltip={updateGate.disabledReason}
                      onClick={() => {
                        void change(task, { assignedToUserId: null });
                      }}
                    />,
                  ]
                : []),
              <MoreMenuItem
                key="edit"
                icon={IconProp.Edit}
                text={SECURITY_CASE_TASKS_COPY.editTask}
                isDisabled={!updateGate.isAllowed || isWorking}
                tooltip={updateGate.disabledReason}
                onClick={() => {
                  openDialog({ kind: "edit", task });
                }}
              />,
              <MoreMenuDivider key="delete-divider" />,
              <MoreMenuItem
                key="delete"
                icon={IconProp.Trash}
                text={SECURITY_CASE_TASKS_COPY.deleteTask}
                isDestructive={true}
                isDisabled={!deleteGate.isAllowed || isWorking}
                tooltip={deleteGate.disabledReason}
                onClick={() => {
                  openDialog({ kind: "delete", task });
                }}
              />,
            ]}
          </MoreMenu>
        </div>
      </li>
    );
  };

  const getBody: () => ReactElement = (): ReactElement => {
    if (loadError && !tasks) {
      return (
        <div data-testid={SECURITY_CASE_TASKS_TEST_IDS.error}>
          <ErrorMessage
            message={loadError}
            onRefreshClick={() => {
              void load();
            }}
          />
        </div>
      );
    }

    if (!tasks) {
      return <ComponentLoader />;
    }

    return (
      <>
        {tasks.length === 0 ? (
          <div
            className="flex flex-col items-center py-6 text-center"
            data-testid={SECURITY_CASE_TASKS_TEST_IDS.empty}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500">
              <Icon icon={IconProp.ClipboardDocumentCheck} className="h-5 w-5" />
            </span>
            <p className="mt-3 text-sm font-medium text-gray-900">
              {translator.translateText(SECURITY_CASE_TASKS_COPY.emptyTitle)}
            </p>
            <p className="mt-1 max-w-md text-sm text-gray-500">
              {translator.translateText(
                SECURITY_CASE_TASKS_COPY.emptyDescription,
              )}
            </p>
          </div>
        ) : (
          <ul
            className="divide-y divide-gray-100"
            data-testid={SECURITY_CASE_TASKS_TEST_IDS.list}
          >
            {tasks.map(getRow)}
          </ul>
        )}

        {createGate.isAllowed ? (
          <form
            className="mt-1 flex flex-col gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:items-center"
            onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              void add();
            }}
          >
            <label htmlFor={addInputId} className="sr-only">
              {translator.translateText(SECURITY_CASE_TASKS_COPY.addLabel)}
            </label>
            <input
              id={addInputId}
              type="text"
              value={newTitle}
              maxLength={SECURITY_CASE_TASK_TITLE_LIMIT}
              placeholder={translator.translateText(
                SECURITY_CASE_TASKS_COPY.addPlaceholder,
              )}
              disabled={isAdding}
              data-testid={SECURITY_CASE_TASKS_TEST_IDS.addInput}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setNewTitle(event.target.value);
              }}
              className="block w-full min-w-0 flex-1 rounded-md border-0 px-3 py-1.5 text-sm text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600"
            />
            <Button
              title={SECURITY_CASE_TASKS_COPY.addButton}
              icon={IconProp.Add}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              type={ButtonType.Submit}
              isLoading={isAdding}
              disabled={!readNewTaskTitle(newTitle) || isAdding}
              dataTestId={SECURITY_CASE_TASKS_TEST_IDS.addButton}
            />
          </form>
        ) : (
          <></>
        )}
      </>
    );
  };

  return (
    <>
      <Card
        title={SECURITY_CASE_TASKS_COPY.title}
        description={SECURITY_CASE_TASKS_COPY.description}
        rightElement={
          tasks && tasks.length > 0 ? (
            <span
              className="whitespace-nowrap rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
              data-testid={SECURITY_CASE_TASKS_TEST_IDS.progress}
            >
              {translator.translateTemplate(SECURITY_CASE_TASKS_COPY.progress, {
                done: translator.formatNumber(progress.done),
                total: translator.formatNumber(progress.total),
              })}
            </span>
          ) : undefined
        }
      >
        <div data-testid={SECURITY_CASE_TASKS_TEST_IDS.card}>
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
          title={SECURITY_CASE_TASKS_COPY.assignTitle}
          description={translator.translateTemplate(
            SECURITY_CASE_TASKS_COPY.assignDescription,
            { title: dialog.task.title || "" },
          )}
          submitButtonText={SECURITY_CASE_TASKS_COPY.assignSubmit}
          isLoading={isDialogWorking}
          error={dialogError || undefined}
          onClose={() => {
            setDialog(null);
          }}
          formProps={{
            name: "security-case-task-assign",
            initialValues: {},
            fields: [
              {
                field: { assignTo: true },
                title: SECURITY_CASE_TASKS_COPY.assignField,
                fieldType: FormFieldSchemaType.PeoplePicker,
                required: true,
                peoplePicker: {
                  kinds: [
                    { kind: PeoplePickerKind.User, valueKey: ASSIGN_USER_KEY },
                  ],
                  isSinglePick: true,
                },
              },
            ],
          }}
          onSubmit={async (values: FormValues<JSONObject>) => {
            const userId: string | undefined = toPeoplePickerIds(
              (values as JSONObject)[ASSIGN_USER_KEY],
            )[0];

            await runDialog(async (): Promise<void> => {
              await ModelAPI.updateById<SecurityCaseTask>({
                modelType: SecurityCaseTask,
                id: new ObjectID(dialog.task._id!.toString()),
                data: { assignedToUserId: userId || null },
              });
            });
          }}
        />
      ) : (
        <></>
      )}

      {dialog?.kind === "edit" ? (
        <BasicFormModal<JSONObject>
          title={SECURITY_CASE_TASKS_COPY.editTitle}
          submitButtonText={SECURITY_CASE_TASKS_COPY.saveChanges}
          isLoading={isDialogWorking}
          error={dialogError || undefined}
          onClose={() => {
            setDialog(null);
          }}
          formProps={{
            name: "security-case-task-edit",
            initialValues: { title: dialog.task.title || "" },
            fields: [
              {
                field: { title: true },
                title: SECURITY_CASE_TASKS_COPY.titleField,
                fieldType: FormFieldSchemaType.Text,
                required: true,
                validation: {
                  maxLength: SECURITY_CASE_TASK_TITLE_LIMIT,
                },
              },
            ],
          }}
          onSubmit={async (values: FormValues<JSONObject>) => {
            const title: string | null = readNewTaskTitle(
              String((values as JSONObject)["title"] || ""),
            );

            if (!title) {
              return;
            }

            await runDialog(async (): Promise<void> => {
              await ModelAPI.updateById<SecurityCaseTask>({
                modelType: SecurityCaseTask,
                id: new ObjectID(dialog.task._id!.toString()),
                data: { title },
              });
            });
          }}
        />
      ) : (
        <></>
      )}

      {dialog?.kind === "delete" ? (
        <ConfirmModal
          title={SECURITY_CASE_TASKS_COPY.deleteTitle}
          description={translator.translateTemplate(
            SECURITY_CASE_TASKS_COPY.deleteDescription,
            { title: dialog.task.title || "" },
          )}
          submitButtonText={SECURITY_CASE_TASKS_COPY.deleteSubmit}
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isDialogWorking}
          error={dialogError || undefined}
          onClose={() => {
            setDialog(null);
          }}
          onSubmit={() => {
            void runDialog(async (): Promise<void> => {
              await ModelAPI.deleteItem<SecurityCaseTask>({
                modelType: SecurityCaseTask,
                id: new ObjectID(dialog.task._id!.toString()),
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

export default SecurityCaseTasks;
