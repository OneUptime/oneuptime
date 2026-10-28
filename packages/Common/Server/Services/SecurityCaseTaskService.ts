import ProjectReferencesService from "./ProjectReferencesService";
import SecurityCaseFeedService from "./SecurityCaseFeedService";
import UserService from "./UserService";
import Model from "../../Models/DatabaseModels/SecurityCaseTask";
import { SecurityCaseFeedEventType } from "../../Models/DatabaseModels/SecurityCaseFeed";
import User from "../../Models/DatabaseModels/User";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import logger from "../Utils/Logger";
import SecurityCaseNotifications from "../Utils/SecurityCase/SecurityCaseNotifications";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { Gray500, Green500 } from "../../Types/BrandColors";
import ColumnLength from "../../Types/Database/ColumnLength";
import PartialEntity from "../../Types/Database/PartialEntity";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  taskAddedMarkdown,
  taskAssignedMarkdown,
  taskDeletedMarkdown,
  taskDoneMarkdown,
  taskReopenedMarkdown,
} from "../../Utils/SecurityCase/SecurityCaseMarkdown";

/*
 * A security case's tasks (SecurityCaseTask): its checklist. A task names
 * what has to be done and who is doing it, and is ticked off when it is
 * done.
 *
 * Who ticked it off and when are OneUptime's to write, after the change
 * (the permission layer holds a person's write to the columns they may
 * write, which these are not): ticking a task off records the person and
 * the time, opening it again clears both. The case's timeline says what
 * happened to each task - added, done, opened again, handed to somebody,
 * deleted - and the person a task is handed to is told
 * (SecurityCaseNotifications), unless they handed it to themselves.
 */

const ASSIGNEE_KEYS: Array<string> = ["assignedToUserId", "assignedToUser"];

// A task's columns its hooks look at, as they were before a change.
interface TaskBeforeChange {
  id: string;
  projectId: ObjectID | undefined;
  securityCaseId: ObjectID | undefined;
  title: string;
  isDone: boolean;
  assignedToUserId: string | undefined;
}

// A task's title as it is kept: trimmed, never empty, at most 500 characters.
export function normalizeTaskTitle(value: unknown): string {
  const title: string = typeof value === "string" ? value.trim() : "";

  if (!title) {
    throw new BadDataException("A task needs a title: what has to be done.");
  }

  if (title.length > ColumnLength.LongText) {
    throw new BadDataException(
      `A task's title can be at most ${ColumnLength.LongText.toString()} characters. Keep it to a line, and put the details in a note.`,
    );
  }

  return title;
}

// A cleared assignee ({ assignedToUser: null }) is cleared in its ID column too.
function readAssignee(data: JSONObject): void {
  RelationIdUtil.readIntoIdColumn(data, ASSIGNEE_KEYS, "Assignee");

  if (
    data["assignedToUser"] === null &&
    data["assignedToUserId"] === undefined
  ) {
    data["assignedToUserId"] = null;
  }
}

function idText(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  return value.toString();
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: JSONObject = createBy.data as unknown as JSONObject;

    createBy.data.title = normalizeTaskTitle(createBy.data.title);
    readAssignee(data);

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const actorUserId: ObjectID | undefined = onCreate.createBy.props.userId;

    if (!createdItem.id || !createdItem.projectId || !createdItem.securityCaseId) {
      return createdItem;
    }

    try {
      // Added already done: whoever added it did it, now.
      if (createdItem.isDone) {
        await this.updateColumnsByIdWithoutHooks({
          id: createdItem.id,
          data: {
            doneAt: OneUptimeDate.getCurrentDate(),
            doneByUserId: actorUserId || null,
          } as unknown as PartialEntity<Model>,
        });
      }

      await SecurityCaseFeedService.createSecurityCaseFeedItem({
        projectId: createdItem.projectId,
        securityCaseId: createdItem.securityCaseId,
        feedInfoInMarkdown: taskAddedMarkdown({
          title: createdItem.title || "",
          assigneeName: createdItem.assignedToUserId
            ? await this.getUserName(createdItem.assignedToUserId)
            : undefined,
        }).toString(),
        eventType: SecurityCaseFeedEventType.Task,
        displayColor: Gray500,
        userId: createdItem.createdByUserId || actorUserId,
      });

      if (createdItem.assignedToUserId) {
        await SecurityCaseNotifications.taskAssigned({
          projectId: createdItem.projectId,
          securityCaseId: createdItem.securityCaseId,
          taskId: createdItem.id,
          userId: createdItem.assignedToUserId,
          actorUserId,
        });
      }
    } catch (error) {
      // The task is added; what is said about it must not undo that.
      logger.error(
        `SecurityCaseTaskService: could not record the new task ${createdItem.id.toString()}:`,
      );
      logger.error(error);
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: JSONObject = updateBy.data as unknown as JSONObject;

    if (data["title"] !== undefined) {
      data["title"] = normalizeTaskTitle(data["title"]);
    }

    readAssignee(data);

    const watches: boolean =
      data["isDone"] !== undefined || data["assignedToUserId"] !== undefined;

    if (!watches) {
      return { updateBy, carryForward: null };
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
        securityCaseId: true,
        title: true,
        isDone: true,
        assignedToUserId: true,
      },
    );

    const before: Map<string, TaskBeforeChange> = new Map();

    for (const row of rows) {
      if (!row.id) {
        continue;
      }

      before.set(row.id.toString(), {
        id: row.id.toString(),
        projectId: row.projectId,
        securityCaseId: row.securityCaseId,
        title: row.title || "",
        isDone: row.isDone === true,
        assignedToUserId: idText(row.assignedToUserId),
      });
    }

    return { updateBy, carryForward: before };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const before: Map<string, TaskBeforeChange> | null =
      onUpdate.carryForward instanceof Map ? onUpdate.carryForward : null;

    if (!before) {
      return onUpdate;
    }

    const data: JSONObject = onUpdate.updateBy.data as unknown as JSONObject;
    const actorUserId: ObjectID | undefined = onUpdate.updateBy.props.userId;

    for (const updatedId of updatedItemIds) {
      const old: TaskBeforeChange | undefined = before.get(
        updatedId.toString(),
      );

      if (!old || !old.projectId || !old.securityCaseId) {
        continue;
      }

      try {
        await this.recordChanges({
          old,
          data,
          taskId: updatedId,
          projectId: old.projectId,
          securityCaseId: old.securityCaseId,
          actorUserId,
        });
      } catch (error) {
        logger.error(
          `SecurityCaseTaskService: could not record the changes to task ${updatedId.toString()}:`,
        );
        logger.error(error);
      }
    }

    return onUpdate;
  }

  // One task's change: who ticked it off, its timeline entries, who is told.
  private async recordChanges(input: {
    old: TaskBeforeChange;
    data: JSONObject;
    taskId: ObjectID;
    projectId: ObjectID;
    securityCaseId: ObjectID;
    actorUserId: ObjectID | undefined;
  }): Promise<void> {
    const { old, data, taskId, projectId, securityCaseId, actorUserId } =
      input;
    const title: string =
      typeof data["title"] === "string" ? (data["title"] as string) : old.title;

    if (data["isDone"] !== undefined) {
      const isDone: boolean = data["isDone"] === true;

      if (isDone !== old.isDone) {
        await this.updateColumnsByIdWithoutHooks({
          id: taskId,
          data: (isDone
            ? {
                doneAt: OneUptimeDate.getCurrentDate(),
                doneByUserId: actorUserId || null,
              }
            : {
                doneAt: null,
                doneByUserId: null,
              }) as unknown as PartialEntity<Model>,
        });

        await SecurityCaseFeedService.createSecurityCaseFeedItem({
          projectId,
          securityCaseId,
          feedInfoInMarkdown: (isDone
            ? taskDoneMarkdown({ title })
            : taskReopenedMarkdown({ title })
          ).toString(),
          eventType: SecurityCaseFeedEventType.Task,
          displayColor: isDone ? Green500 : Gray500,
          userId: actorUserId,
        });
      }
    }

    if (data["assignedToUserId"] !== undefined) {
      const assigneeId: string | undefined = idText(data["assignedToUserId"]);

      if (assigneeId !== old.assignedToUserId) {
        await SecurityCaseFeedService.createSecurityCaseFeedItem({
          projectId,
          securityCaseId,
          feedInfoInMarkdown: taskAssignedMarkdown({
            title,
            assigneeName: assigneeId
              ? await this.getUserName(new ObjectID(assigneeId))
              : undefined,
          }).toString(),
          eventType: SecurityCaseFeedEventType.Task,
          displayColor: Gray500,
          userId: actorUserId,
        });

        if (assigneeId) {
          await SecurityCaseNotifications.taskAssigned({
            projectId,
            securityCaseId,
            taskId,
            userId: new ObjectID(assigneeId),
            actorUserId,
          });
        }
      }
    }
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    /*
     * The rows are gone by the time onDeleteSuccess runs: what the timeline
     * says about each is read here, from the rows the delete removes.
     */
    const rows: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        projectId: true,
        securityCaseId: true,
        title: true,
      },
    );

    return { deleteBy, carryForward: { rows } };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const rows: Array<Model> = (onDelete.carryForward?.rows ||
      []) as Array<Model>;
    const actorUserId: ObjectID | undefined =
      onDelete.deleteBy.deletedByUser?.id || onDelete.deleteBy.props.userId;

    for (const row of rows) {
      if (!row.projectId || !row.securityCaseId) {
        continue;
      }

      await SecurityCaseFeedService.createSecurityCaseFeedItem({
        projectId: row.projectId,
        securityCaseId: row.securityCaseId,
        feedInfoInMarkdown: taskDeletedMarkdown({
          title: row.title || "",
        }).toString(),
        eventType: SecurityCaseFeedEventType.Task,
        displayColor: Gray500,
        userId: actorUserId,
      });
    }

    return onDelete;
  }

  private async getUserName(userId: ObjectID): Promise<string> {
    const user: User | null = await UserService.findOneById({
      id: userId,
      select: {
        name: true,
        email: true,
      },
      props: {
        isRoot: true,
      },
    });

    return user?.name?.toString() || user?.email?.toString() || "a user";
  }
}

export default new Service();
