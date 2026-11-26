import IncidentFeedService from "./IncidentFeedService";
import IncidentService from "./IncidentService";
import MonitorService from "./MonitorService";
import ProjectReferencesService from "./ProjectReferencesService";
import FeedPersonName from "../Utils/Feed/FeedPersonName";
import Incident from "../../Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import Model from "../../Models/DatabaseModels/IncidentPostmortemActionItem";
import Monitor from "../../Models/DatabaseModels/Monitor";
import CountBy from "../Types/Database/CountBy";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import { applyIncidentRelatedRecordPrivacyFilter } from "../Utils/Incident/IncidentPrivacyFilter";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Gray500, Green500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import ColumnLength from "../../Types/Database/ColumnLength";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import PartialEntity from "../../Types/Database/PartialEntity";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import PostmortemActionItemStatus, {
  PostmortemActionItemStatusUtil,
} from "../../Types/Incident/PostmortemActionItemStatus";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import PostmortemNoteActionItems, {
  PostmortemNoteActionItem,
} from "../../Utils/Incident/PostmortemNoteActionItems";
import {
  actionItemAddedMarkdown,
  actionItemDeletedMarkdown,
  actionItemDoneMarkdown,
  actionItemMonitorMarkdown,
  actionItemOwnerMarkdown,
  actionItemReopenedMarkdown,
  actionItemsTrackedMarkdown,
  actionItemWontDoMarkdown,
} from "../../Utils/Incident/PostmortemActionItemMarkdown";
import { MarkdownText } from "../../Utils/Markdown/FeedMarkdown";

/*
 * AN INCIDENT'S POSTMORTEM ACTION ITEMS (IncidentPostmortemActionItem,
 * issue #6801): what the team will do so it does not happen again, who owns
 * each, when each is due, and whether each is done.
 *
 *   - Read like the incident: a private incident's action items are its
 *     own team's (applyIncidentRelatedRecordPrivacyFilter on every read,
 *     count, update and delete, as its notes are).
 *   - Who closed one and when are OneUptime's to write, after the change
 *     (the permission layer holds a person's write to the columns they may
 *     write, which these are not): Done or Won't Do records the person and
 *     the time, Open again clears both.
 *   - The incident's feed says what happened to each - added, given an
 *     owner, done, won't do, reopened, deleted, a monitor made for it.
 *     Tracking the items the postmortem's note lists (trackFromPostmortem
 *     Note) adds them all with one line.
 */

const OWNER_KEYS: Array<string> = ["ownerUserId", "ownerUser"];
const MONITOR_KEYS: Array<string> = ["monitorId", "monitor"];

/*
 * The flag trackFromPostmortemNote creates its items with: they are said in
 * one feed line, not one each.
 */
export const TRACKED_FROM_NOTE_FLAG: string = "isTrackedFromPostmortemNote";

// An action item's columns its hooks look at, as they were before a change.
interface ActionItemBeforeChange {
  projectId: ObjectID | undefined;
  incidentId: ObjectID | undefined;
  title: string;
  status: PostmortemActionItemStatus;
  ownerUserId: string | undefined;
  monitorId: string | undefined;
}

// What tracking the note's action items did.
export interface TrackedFromNote {
  // The items added, in the order the note lists them.
  trackedItems: Array<Model>;
  // How many the note lists, tracked before or now.
  listedCount: number;
}

// An action item's title as it is kept: trimmed, never empty, at most 500 characters.
export function normalizeActionItemTitle(value: unknown): string {
  const title: string =
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

  if (!title) {
    throw new BadDataException(
      "An action item needs a title: what the team will do. Write it in a line, and put the details in its description.",
    );
  }

  if (title.length > ColumnLength.LongText) {
    throw new BadDataException(
      `An action item's title can be at most ${ColumnLength.LongText.toString()} characters. Keep it to a line, and put the details in its description.`,
    );
  }

  return title;
}

// A status a write names, checked: anything else is refused, with the ones there are.
export function readActionItemStatus(
  value: unknown,
): PostmortemActionItemStatus {
  const status: PostmortemActionItemStatus =
    PostmortemActionItemStatusUtil.parse(value);

  if (status !== value) {
    throw new BadDataException(
      `An action item's status is Open, Done or WontDo, not "${String(value)}".`,
    );
  }

  return status;
}

/*
 * The person or monitor a write names, in its ID column. A cleared one
 * ({ ownerUser: null }) is cleared in its ID column too, written with stamp
 * so no other name of it is left beside the null.
 */
function readRelationId(
  data: JSONObject,
  keys: Array<string>,
  name: string,
): void {
  const id: ObjectID | null = RelationIdUtil.readIntoIdColumn(data, keys, name);

  if (!id && RelationIdUtil.isPresent(data, keys)) {
    RelationIdUtil.stamp(data, keys, null);
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
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = applyIncidentRelatedRecordPrivacyFilter(
      findBy.query,
      findBy.props,
    );
    return { findBy, carryForward: null };
  }

  /*
   * The read hook keeps an action item of a private incident to that
   * incident's owners, by the incident it names. See DatabaseService.
   */
  public override getColumnsReadHooksNarrowBy(): Array<string> {
    return ["incidentId"];
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = applyIncidentRelatedRecordPrivacyFilter(
      countBy.query,
      countBy.props,
    );
    return super.countBy(countBy);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: JSONObject = createBy.data as unknown as JSONObject;

    createBy.data.title = normalizeActionItemTitle(createBy.data.title);

    if (data["status"] !== undefined && data["status"] !== null) {
      createBy.data.status = readActionItemStatus(data["status"]);
    } else {
      createBy.data.status = PostmortemActionItemStatus.Open;
    }

    readRelationId(data, OWNER_KEYS, "Owner");
    readRelationId(data, MONITOR_KEYS, "Monitor");

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const actorUserId: ObjectID | undefined = onCreate.createBy.props.userId;

    if (!createdItem.id || !createdItem.projectId || !createdItem.incidentId) {
      return createdItem;
    }

    try {
      // Added already closed: whoever added it closed it, now.
      if (PostmortemActionItemStatusUtil.isClosed(createdItem.status)) {
        await this.updateColumnsByIdWithoutHooks({
          id: createdItem.id,
          data: {
            closedAt: OneUptimeDate.getCurrentDate(),
            closedByUserId: actorUserId || null,
          } as unknown as PartialEntity<Model>,
        });
      }

      if (onCreate.createBy.miscDataProps?.[TRACKED_FROM_NOTE_FLAG] === true) {
        // Said once for all of them, by trackFromPostmortemNote.
        return createdItem;
      }

      await this.postFeedItem({
        projectId: createdItem.projectId,
        incidentId: createdItem.incidentId,
        markdown: actionItemAddedMarkdown({
          title: createdItem.title || "",
          ownerName: createdItem.ownerUserId
            ? await this.getUserName(
                createdItem.ownerUserId,
                createdItem.projectId,
              )
            : undefined,
        }),
        userId: createdItem.createdByUserId || actorUserId,
      });
    } catch (error) {
      // The action item is added; what is said about it must not undo that.
      logger.error(
        `IncidentPostmortemActionItemService: could not record the new action item ${createdItem.id.toString()}:`,
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

    updateBy.query = applyIncidentRelatedRecordPrivacyFilter(
      updateBy.query,
      updateBy.props,
    );

    const data: JSONObject = updateBy.data as unknown as JSONObject;

    if (data["title"] !== undefined) {
      data["title"] = normalizeActionItemTitle(data["title"]);
    }

    if (data["status"] !== undefined) {
      data["status"] = readActionItemStatus(data["status"]);
    }

    readRelationId(data, OWNER_KEYS, "Owner");
    readRelationId(data, MONITOR_KEYS, "Monitor");

    const watches: boolean =
      data["status"] !== undefined ||
      RelationIdUtil.isPresent(data, OWNER_KEYS) ||
      RelationIdUtil.isPresent(data, MONITOR_KEYS);

    if (!watches) {
      return { updateBy, carryForward: null };
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
        incidentId: true,
        title: true,
        status: true,
        ownerUserId: true,
        monitorId: true,
      },
    );

    const before: Map<string, ActionItemBeforeChange> = new Map();

    for (const row of rows) {
      if (!row.id) {
        continue;
      }

      before.set(row.id.toString(), {
        projectId: row.projectId,
        incidentId: row.incidentId,
        title: row.title || "",
        status: PostmortemActionItemStatusUtil.parse(row.status),
        ownerUserId: idText(row.ownerUserId),
        monitorId: idText(row.monitorId),
      });
    }

    return { updateBy, carryForward: before };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const before: Map<string, ActionItemBeforeChange> | null =
      onUpdate.carryForward instanceof Map ? onUpdate.carryForward : null;

    if (!before) {
      return onUpdate;
    }

    const data: JSONObject = onUpdate.updateBy.data as unknown as JSONObject;
    const actorUserId: ObjectID | undefined = onUpdate.updateBy.props.userId;

    for (const updatedId of updatedItemIds) {
      const old: ActionItemBeforeChange | undefined = before.get(
        updatedId.toString(),
      );

      if (!old || !old.projectId || !old.incidentId) {
        continue;
      }

      try {
        await this.recordChanges({
          old,
          data,
          actionItemId: updatedId,
          projectId: old.projectId,
          incidentId: old.incidentId,
          actorUserId,
        });
      } catch (error) {
        logger.error(
          `IncidentPostmortemActionItemService: could not record the changes to action item ${updatedId.toString()}:`,
        );
        logger.error(error);
      }
    }

    return onUpdate;
  }

  // One action item's change: who closed it, and the feed's lines.
  private async recordChanges(input: {
    old: ActionItemBeforeChange;
    data: JSONObject;
    actionItemId: ObjectID;
    projectId: ObjectID;
    incidentId: ObjectID;
    actorUserId: ObjectID | undefined;
  }): Promise<void> {
    const { old, data, actionItemId, projectId, incidentId, actorUserId } =
      input;
    const title: string =
      typeof data["title"] === "string" ? (data["title"] as string) : old.title;

    if (data["monitorId"] !== undefined) {
      const monitorId: string | undefined = idText(data["monitorId"]);

      if (monitorId && monitorId !== old.monitorId) {
        await this.postFeedItem({
          projectId,
          incidentId,
          markdown: actionItemMonitorMarkdown({
            title,
            monitorName: await this.getMonitorName(new ObjectID(monitorId)),
          }),
          userId: actorUserId,
        });
      }
    }

    if (data["status"] !== undefined) {
      const status: PostmortemActionItemStatus =
        PostmortemActionItemStatusUtil.parse(data["status"]);

      if (status !== old.status) {
        /*
         * Closed (Done, or Won't Do - from Open, or from the other one): by
         * this person, now. Open again: by nobody.
         */
        const isClosed: boolean =
          PostmortemActionItemStatusUtil.isClosed(status);

        await this.updateColumnsByIdWithoutHooks({
          id: actionItemId,
          data: (isClosed
            ? {
                closedAt: OneUptimeDate.getCurrentDate(),
                closedByUserId: actorUserId || null,
              }
            : {
                closedAt: null,
                closedByUserId: null,
              }) as unknown as PartialEntity<Model>,
        });

        await this.postFeedItem({
          projectId,
          incidentId,
          markdown:
            status === PostmortemActionItemStatus.Done
              ? actionItemDoneMarkdown({ title })
              : status === PostmortemActionItemStatus.WontDo
                ? actionItemWontDoMarkdown({ title })
                : actionItemReopenedMarkdown({ title }),
          userId: actorUserId,
          displayColor:
            status === PostmortemActionItemStatus.Done ? Green500 : Gray500,
        });
      }
    }

    if (data["ownerUserId"] !== undefined) {
      const ownerUserId: string | undefined = idText(data["ownerUserId"]);

      if (ownerUserId !== old.ownerUserId) {
        await this.postFeedItem({
          projectId,
          incidentId,
          markdown: actionItemOwnerMarkdown({
            title,
            ownerName: ownerUserId
              ? await this.getUserName(new ObjectID(ownerUserId), projectId)
              : undefined,
          }),
          userId: actorUserId,
        });
      }
    }
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    deleteBy.query = applyIncidentRelatedRecordPrivacyFilter(
      deleteBy.query,
      deleteBy.props,
    );

    /*
     * The rows are gone by the time onDeleteSuccess runs: what the feed says
     * about each is read here, from the rows the delete removes.
     */
    const rows: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        projectId: true,
        incidentId: true,
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
      if (!row.projectId || !row.incidentId) {
        continue;
      }

      try {
        await this.postFeedItem({
          projectId: row.projectId,
          incidentId: row.incidentId,
          markdown: actionItemDeletedMarkdown({ title: row.title || "" }),
          userId: actorUserId,
        });
      } catch (error) {
        // The action item is gone; what the feed says about it must not fail that.
        logger.error(
          `IncidentPostmortemActionItemService: could not record the deleted action item ${row.id?.toString() || ""}:`,
        );
        logger.error(error);
      }
    }

    return onDelete;
  }

  /*
   * TRACK THE ACTION ITEMS THE POSTMORTEM'S NOTE LISTS: each item of its
   * Action Items section (PostmortemNoteActionItems) the incident does not
   * track yet becomes an action item - done when the note ticked it off,
   * due on the day the note gives, in the reader's time zone. Said in one
   * feed line.
   *
   * As the person asking: they must read the incident (a private one, as
   * its team), and every item is created with their permissions, so it is
   * theirs, and refused as one they typed would be. An item the incident
   * already tracks, by its title, is left out, so tracking twice adds
   * nothing.
   */
  @CaptureSpan()
  public async trackFromPostmortemNote(data: {
    incidentId: ObjectID;
    props: DatabaseCommonInteractionProps;
    timezone?: string | undefined;
  }): Promise<TrackedFromNote> {
    const incident: Incident | null = await IncidentService.findOneById({
      id: data.incidentId,
      select: {
        _id: true,
        projectId: true,
        postmortemNote: true,
      },
      props: data.props,
    });

    if (!incident || !incident.projectId) {
      throw new BadDataException(
        "The incident was not found, or you cannot read it. Open the incident again, then track its action items.",
      );
    }

    const listed: Array<PostmortemNoteActionItem> =
      PostmortemNoteActionItems.read(incident.postmortemNote);

    const tracked: Array<Model> = await this.findBy({
      query: { incidentId: data.incidentId },
      select: { title: true },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });

    const untracked: Array<PostmortemNoteActionItem> =
      PostmortemNoteActionItems.getUntracked({
        items: listed,
        trackedTitles: tracked.map((item: Model): string => {
          return item.title || "";
        }),
      });

    const trackedItems: Array<Model> = [];

    for (const noteItem of untracked) {
      const item: Model = new Model();
      item.projectId = incident.projectId;
      item.incidentId = data.incidentId;
      item.title = noteItem.title;
      item.status = noteItem.isDone
        ? PostmortemActionItemStatus.Done
        : PostmortemActionItemStatus.Open;

      if (noteItem.dueDay) {
        const dueDate: Date | null = PostmortemNoteActionItems.toDueDate(
          noteItem.dueDay,
          data.timezone || "UTC",
        );

        if (dueDate) {
          item.dueDate = dueDate;
        }
      }

      trackedItems.push(
        await this.create({
          data: item,
          props: data.props,
          miscDataProps: { [TRACKED_FROM_NOTE_FLAG]: true },
        }),
      );
    }

    if (trackedItems.length > 0) {
      try {
        await this.postFeedItem({
          projectId: incident.projectId,
          incidentId: data.incidentId,
          markdown: actionItemsTrackedMarkdown({
            titles: trackedItems.map((item: Model): string => {
              return item.title || "";
            }),
          }),
          userId: data.props.userId,
        });
      } catch (error) {
        logger.error(
          `IncidentPostmortemActionItemService: could not record the action items tracked on incident ${data.incidentId.toString()}:`,
        );
        logger.error(error);
      }
    }

    return {
      trackedItems,
      listedCount: listed.length,
    };
  }

  private async postFeedItem(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    markdown: MarkdownText;
    userId?: ObjectID | undefined;
    displayColor?: Color | undefined;
  }): Promise<void> {
    await IncidentFeedService.createIncidentFeedItem({
      projectId: data.projectId,
      incidentId: data.incidentId,
      incidentFeedEventType: IncidentFeedEventType.PostmortemNote,
      feedInfoInMarkdown: data.markdown.toString(),
      displayColor: data.displayColor || Gray500,
      userId: data.userId,
    });
  }

  /*
   * An action item's owner, as every feed entry names a person
   * (FeedPersonName): someone only invited to the project by the name typed
   * for them, else "someone who hasn't joined the project yet" - never their
   * account's own name (#9823) or any address (#10668, #10669).
   */
  private async getUserName(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<string> {
    return (
      (await FeedPersonName.getText({
        userId: userId,
        projectId: projectId,
      })) || "a user"
    );
  }

  private async getMonitorName(monitorId: ObjectID): Promise<string> {
    const monitor: Monitor | null = await MonitorService.findOneById({
      id: monitorId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return monitor?.name?.toString() || "a monitor";
  }
}

export default new Service();
