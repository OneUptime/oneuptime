import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeInternalNote from "../../../Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertInternalNote from "../../../Models/DatabaseModels/AlertInternalNote";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeInternalNote from "../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceInternalNote from "../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import URL from "../../../Types/API/URL";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceNoteReactionUtil, {
  WorkspaceNoteType,
} from "../../../Types/Workspace/WorkspaceNoteReaction";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import AlertEpisodeInternalNoteService from "../../Services/AlertEpisodeInternalNoteService";
import AlertEpisodeService from "../../Services/AlertEpisodeService";
import AlertInternalNoteService from "../../Services/AlertInternalNoteService";
import AlertService from "../../Services/AlertService";
import DatabaseService from "../../Services/DatabaseService";
import IncidentEpisodeInternalNoteService from "../../Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodeService from "../../Services/IncidentEpisodeService";
import IncidentInternalNoteService from "../../Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../Services/IncidentPublicNoteService";
import IncidentService from "../../Services/IncidentService";
import ScheduledMaintenanceInternalNoteService from "../../Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenancePublicNoteService from "../../Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import WorkspaceNotificationLogService from "../../Services/WorkspaceNotificationLogService";
import QueryHelper from "../../Types/Database/QueryHelper";
import Query from "../../Types/Database/Query";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { WorkspaceEventType } from "./WorkspaceMemberActions";
import { MarkdownText, mdText } from "../../../Utils/Markdown/FeedMarkdown";
import GlobalCache from "../../Infrastructure/GlobalCache";
import WorkspaceRecordThreads from "./WorkspaceRecordThreads";
import logger from "../Logger";
import OneUptimeDate from "../../../Types/Date";
import SavedChatMessage, {
  SavedChatMessageUtil,
} from "../../../Types/Workspace/SavedChatMessage";
import { PrivateRecordKind } from "../../../Types/StatusPage/PrivateRecordPublicNotes";
import PrivateRecordPublicNoteRule from "../Notes/PrivateRecordPublicNoteRule";

// A save of a message as a note, claimed while it runs (saveNote).
const SAVE_CLAIM_NAMESPACE: string = "workspace-reaction-note-save";
const SAVE_CLAIM_TTL_IN_SECONDS: number = 60;

export enum WorkspaceNoteResourceType {
  Incident = "Incident",
  Alert = "Alert",
  ScheduledMaintenance = "ScheduledMaintenance",
  IncidentEpisode = "IncidentEpisode",
  AlertEpisode = "AlertEpisode",
}

// The incident / alert / ... a chat channel posts updates for.
export interface WorkspaceNoteResource {
  resourceType: WorkspaceNoteResourceType;
  resourceId: ObjectID;
  projectId: ObjectID;
}

export enum WorkspaceNoteSaveResult {
  Saved = "Saved",
  // A note was already saved from this message.
  Duplicate = "Duplicate",
}

/*
 * What became of a message somebody asked to save as a note - by a pin, or
 * by a Connect button that finishes their pin: saved, saved before, or not
 * saved - refused, with why; nothing in it to save; gone from the chat; or
 * the chat could not be read.
 */
export enum WorkspaceMessageNoteOutcome {
  Saved = "Saved",
  AlreadySaved = "AlreadySaved",
  Refused = "Refused",
  NothingToSave = "NothingToSave",
  NotFound = "NotFound",
  Failed = "Failed",
}

export interface WorkspaceMessageNoteResult {
  outcome: WorkspaceMessageNoteOutcome;
  // Why it was refused, or why there is nothing to save: for the person.
  reason?: string | undefined;
  /*
   * The note it was saved as, when it was saved: a public note asked for on
   * a private incident is saved as a private one (getNoteTypeSavedAs).
   */
  noteType?: WorkspaceNoteType | undefined;
}

type ResourceService = DatabaseService<
  Incident | Alert | ScheduledMaintenance | IncidentEpisode | AlertEpisode
>;

interface ResourceTypeDefinition {
  service: () => ResourceService;
  // The WorkspaceNotificationLog column that links a log row to the resource.
  logColumn: keyof WorkspaceNotificationLog;
  // Singular, lower case: "incident", "alert episode".
  noun: string;
  // Shown to people: "Incident", "Alert Episode".
  label: string;
  // The same kind of record, as a press names it.
  eventType: WorkspaceEventType;
}

const RESOURCE_TYPES: Record<
  WorkspaceNoteResourceType,
  ResourceTypeDefinition
> = {
  [WorkspaceNoteResourceType.Incident]: {
    service: (): ResourceService => {
      return IncidentService as unknown as ResourceService;
    },
    logColumn: "incidentId",
    noun: "incident",
    label: "Incident",
    eventType: WorkspaceEventType.Incident,
  },
  [WorkspaceNoteResourceType.Alert]: {
    service: (): ResourceService => {
      return AlertService as unknown as ResourceService;
    },
    logColumn: "alertId",
    noun: "alert",
    label: "Alert",
    eventType: WorkspaceEventType.Alert,
  },
  [WorkspaceNoteResourceType.ScheduledMaintenance]: {
    service: (): ResourceService => {
      return ScheduledMaintenanceService as unknown as ResourceService;
    },
    logColumn: "scheduledMaintenanceId",
    noun: "scheduled maintenance",
    label: "Scheduled Maintenance",
    eventType: WorkspaceEventType.ScheduledMaintenance,
  },
  [WorkspaceNoteResourceType.IncidentEpisode]: {
    service: (): ResourceService => {
      return IncidentEpisodeService as unknown as ResourceService;
    },
    logColumn: "incidentEpisodeId",
    noun: "incident episode",
    label: "Incident Episode",
    eventType: WorkspaceEventType.IncidentEpisode,
  },
  [WorkspaceNoteResourceType.AlertEpisode]: {
    service: (): ResourceService => {
      return AlertEpisodeService as unknown as ResourceService;
    },
    logColumn: "alertEpisodeId",
    noun: "alert episode",
    label: "Alert Episode",
    eventType: WorkspaceEventType.AlertEpisode,
  },
};

/*
 * Saves a chat message as a note when someone reacts to it with a note emoji
 * (see WorkspaceNoteReactionUtil). The Slack and Microsoft Teams integrations
 * both come through here; they differ only in how they learn about the
 * reaction and read the message.
 */
export default class WorkspaceReactionNote {
  public static getAllResourceTypes(): Array<WorkspaceNoteResourceType> {
    return Object.values(WorkspaceNoteResourceType);
  }

  // Public notes are posted to status pages, which only incidents and scheduled maintenance have.
  public static supportsNoteType(
    resourceType: WorkspaceNoteResourceType,
    noteType: WorkspaceNoteType,
  ): boolean {
    if (noteType === WorkspaceNoteType.Private) {
      return true;
    }

    return (
      resourceType === WorkspaceNoteResourceType.Incident ||
      resourceType === WorkspaceNoteResourceType.ScheduledMaintenance
    );
  }

  /*
   * The note a message is saved as on its record: the one asked for, but a
   * private one where a public one was asked for on a private incident or
   * episode. A private record takes no public notes
   * (Types/StatusPage/PrivateRecordPublicNotes): a public note on it would
   * reach no status page and no subscriber, and the server refuses one. The
   * message is still saved for the people who can see the record, and the
   * answer says how (getConfirmationMessage). Read as OneUptime, as the
   * channel's record is (resolveResourceForChannel).
   */
  @CaptureSpan()
  public static async getNoteTypeSavedAs(data: {
    resource: WorkspaceNoteResource;
    noteType: WorkspaceNoteType;
  }): Promise<WorkspaceNoteType> {
    if (data.noteType !== WorkspaceNoteType.Public) {
      return data.noteType;
    }

    const kind: PrivateRecordKind | null =
      WorkspaceReactionNote.getPrivateRecordKind(data.resource.resourceType);

    if (!kind) {
      return data.noteType;
    }

    const isPrivate: boolean = await PrivateRecordPublicNoteRule.isPrivate({
      kind: kind,
      recordId: data.resource.resourceId,
      projectId: data.resource.projectId,
    });

    return isPrivate ? WorkspaceNoteType.Private : data.noteType;
  }

  /*
   * The records with public notes that can be made private: incidents and
   * incident episodes. Null for every other kind - a scheduled maintenance
   * event has no Private switch, and alerts have no public notes.
   */
  public static getPrivateRecordKind(
    resourceType: WorkspaceNoteResourceType,
  ): PrivateRecordKind | null {
    switch (resourceType) {
      case WorkspaceNoteResourceType.Incident:
        return PrivateRecordKind.Incident;
      case WorkspaceNoteResourceType.IncidentEpisode:
        return PrivateRecordKind.IncidentEpisode;
      default:
        return null;
    }
  }

  // The row the note writes, which is what the user must be allowed to create.
  public static getNoteModelType(
    resourceType: WorkspaceNoteResourceType,
    noteType: WorkspaceNoteType,
  ): DatabaseBaseModelType {
    const isPublic: boolean = noteType === WorkspaceNoteType.Public;

    switch (resourceType) {
      case WorkspaceNoteResourceType.Incident:
        return isPublic ? IncidentPublicNote : IncidentInternalNote;
      case WorkspaceNoteResourceType.ScheduledMaintenance:
        return isPublic
          ? ScheduledMaintenancePublicNote
          : ScheduledMaintenanceInternalNote;
      case WorkspaceNoteResourceType.Alert:
        return AlertInternalNote;
      case WorkspaceNoteResourceType.IncidentEpisode:
        return IncidentEpisodeInternalNote;
      case WorkspaceNoteResourceType.AlertEpisode:
        return AlertEpisodeInternalNote;
    }
  }

  public static getResourceService(
    resourceType: WorkspaceNoteResourceType,
  ): ResourceService {
    return RESOURCE_TYPES[resourceType].service();
  }

  // The record kind as a press names it (WorkspaceMemberActions).
  public static getEventType(
    resourceType: WorkspaceNoteResourceType,
  ): WorkspaceEventType {
    return RESOURCE_TYPES[resourceType].eventType;
  }

  // The record kind a press names, as a note's resource.
  public static getResourceType(
    eventType: WorkspaceEventType,
  ): WorkspaceNoteResourceType {
    return (
      this.getAllResourceTypes().find(
        (resourceType: WorkspaceNoteResourceType): boolean => {
          return RESOURCE_TYPES[resourceType].eventType === eventType;
        },
      ) || WorkspaceNoteResourceType.Incident
    );
  }

  // Completes "You do not have permission to ...".
  public static getAuthorizationAction(
    resourceType: WorkspaceNoteResourceType,
    noteType: WorkspaceNoteType,
  ): string {
    return `add a ${noteType} note to this ${RESOURCE_TYPES[resourceType].noun}`;
  }

  /*
   * Identifies the chat message a note came from, so reacting twice (or two
   * people reacting) saves it once. Stored in the notes' postedFromSlackMessageId
   * column, which despite its name holds Teams messages as well.
   */
  public static getSourceMessageKey(data: {
    channelId: string;
    messageId: string;
  }): string {
    return `${data.channelId}:${data.messageId}`;
  }

  /*
   * The resource a channel belongs to, most specific evidence first:
   *
   *   1. a resource that lists the channel in postUpdatesToWorkspaceChannels,
   *      i.e. the channel OneUptime created for that incident / alert / ...,
   *   2. the resource whose notification is the reacted-to message,
   *   3. the resource whose thread the message is in, in a channel a rule
   *      keeps each record's messages in one thread in (WorkspaceRecordThreads)
   *      - somebody's reply there names no record of its own,
   *   4. the resource OneUptime most recently posted about in the channel.
   *
   * This used to be (3) alone, which broke three ways: notification logs are
   * hard-deleted after a few days on OneUptime Cloud, so a reaction in a quiet
   * channel found nothing; episode messages are never logged with their
   * episode, so episode reactions never worked; and with no sort order the row
   * picked in a shared channel was arbitrary.
   */
  @CaptureSpan()
  public static async resolveResourceForChannel(data: {
    projectIds: Array<ObjectID>;
    workspaceType: WorkspaceType;
    channelId: string;
    messageId?: string | undefined;
    /*
     * The first message of the thread the reacted-to message is in, read
     * only for step 3. Null when it is in none.
     */
    getThreadId?: (() => Promise<string | null>) | undefined;
    resourceTypes?: Array<WorkspaceNoteResourceType> | undefined;
  }): Promise<WorkspaceNoteResource | null> {
    if (!data.channelId || data.projectIds.length === 0) {
      return null;
    }

    const resourceTypes: Array<WorkspaceNoteResourceType> =
      data.resourceTypes && data.resourceTypes.length > 0
        ? data.resourceTypes
        : this.getAllResourceTypes();

    const projectIdQuery: ObjectID | ReturnType<typeof QueryHelper.any> =
      data.projectIds.length === 1
        ? data.projectIds[0]!
        : QueryHelper.any(data.projectIds);

    const fromChannel: WorkspaceNoteResource | null =
      await this.findResourceOwningChannel({
        projectIdQuery: projectIdQuery,
        channelId: data.channelId,
        resourceTypes: resourceTypes,
      });

    if (fromChannel) {
      return fromChannel;
    }

    if (data.messageId) {
      const fromMessage: WorkspaceNoteResource | null =
        await this.findResourceFromLogs({
          projectIdQuery: projectIdQuery,
          workspaceType: data.workspaceType,
          channelId: data.channelId,
          threadId: data.messageId,
          resourceTypes: resourceTypes,
        });

      if (fromMessage) {
        return fromMessage;
      }
    }

    if (data.getThreadId) {
      const fromThread: {
        recordType: string;
        recordId: ObjectID;
        projectId: ObjectID;
      } | null = await WorkspaceRecordThreads.findRecordOfThread({
        projectIdQuery: projectIdQuery,
        channelId: data.channelId,
        getThreadTs: data.getThreadId,
      });

      if (
        fromThread &&
        resourceTypes.includes(
          fromThread.recordType as WorkspaceNoteResourceType,
        )
      ) {
        return {
          resourceType: fromThread.recordType as WorkspaceNoteResourceType,
          resourceId: fromThread.recordId,
          projectId: fromThread.projectId,
        };
      }
    }

    return await this.findResourceFromLogs({
      projectIdQuery: projectIdQuery,
      workspaceType: data.workspaceType,
      channelId: data.channelId,
      resourceTypes: resourceTypes,
    });
  }

  private static async findResourceOwningChannel(data: {
    projectIdQuery: ObjectID | ReturnType<typeof QueryHelper.any>;
    channelId: string;
    resourceTypes: Array<WorkspaceNoteResourceType>;
  }): Promise<WorkspaceNoteResource | null> {
    let newest: { resource: WorkspaceNoteResource; createdAt: number } | null =
      null;

    for (const resourceType of data.resourceTypes) {
      const row:
        | Incident
        | Alert
        | ScheduledMaintenance
        | IncidentEpisode
        | AlertEpisode
        | null = await this.getResourceService(resourceType).findOneBy({
        query: {
          projectId: data.projectIdQuery,
          postUpdatesToWorkspaceChannels: QueryHelper.jsonContains([
            { id: data.channelId },
          ]),
        } as Query<Incident>,
        select: {
          _id: true,
          projectId: true,
          createdAt: true,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
      });

      if (!row || !row.id || !row.projectId) {
        continue;
      }

      const createdAt: number = row.createdAt
        ? new Date(row.createdAt).getTime()
        : 0;

      if (!newest || createdAt > newest.createdAt) {
        newest = {
          resource: {
            resourceType: resourceType,
            resourceId: row.id,
            projectId: row.projectId,
          },
          createdAt: createdAt,
        };
      }
    }

    return newest ? newest.resource : null;
  }

  private static async findResourceFromLogs(data: {
    projectIdQuery: ObjectID | ReturnType<typeof QueryHelper.any>;
    workspaceType: WorkspaceType;
    channelId: string;
    threadId?: string | undefined;
    resourceTypes: Array<WorkspaceNoteResourceType>;
  }): Promise<WorkspaceNoteResource | null> {
    let newest: { resource: WorkspaceNoteResource; createdAt: number } | null =
      null;

    for (const resourceType of data.resourceTypes) {
      const logColumn: keyof WorkspaceNotificationLog =
        RESOURCE_TYPES[resourceType].logColumn;

      const query: Query<WorkspaceNotificationLog> = {
        projectId: data.projectIdQuery,
        workspaceType: data.workspaceType,
        channelId: data.channelId,
        [logColumn]: QueryHelper.notNull(),
      } as Query<WorkspaceNotificationLog>;

      if (data.threadId) {
        query.threadId = data.threadId;
      }

      const log: WorkspaceNotificationLog | null =
        await WorkspaceNotificationLogService.findOneBy({
          query: query,
          select: {
            _id: true,
            projectId: true,
            createdAt: true,
            [logColumn]: true,
          },
          sort: {
            createdAt: SortOrder.Descending,
          },
          props: {
            isRoot: true,
          },
        });

      const resourceId: ObjectID | undefined = log?.[logColumn] as
        | ObjectID
        | undefined;

      if (!log || !resourceId || !log.projectId) {
        continue;
      }

      const createdAt: number = log.createdAt
        ? new Date(log.createdAt).getTime()
        : 0;

      if (!newest || createdAt > newest.createdAt) {
        newest = {
          resource: {
            resourceType: resourceType,
            resourceId: new ObjectID(resourceId.toString()),
            projectId: log.projectId,
          },
          createdAt: createdAt,
        };
      }
    }

    return newest ? newest.resource : null;
  }

  /*
   * Saves the note unless one was already saved from the same message, as
   * the member who reacted: `props` are theirs, as the authorization the
   * caller ran for the note's row (see getNoteModelType) returned them. The
   * note is created with those props, so it is held to what they may do -
   * and is theirs, as the one who saved it - as a note they post in the
   * dashboard is.
   *
   * `savedFromChatMessage` says whose words the note is, in which chat, and
   * when they were posted: a private note is filed at that time
   * (getNotePostedAt), a public one when it is published.
   *
   * Two pins of one message at once - Slack's pin and a 📌 reaction, two
   * people - save it once: the save is claimed for the message first
   * (SAVE_CLAIM_NAMESPACE), and a save already under way answers as a
   * duplicate. Without the cache, the check of saved notes still holds.
   */
  @CaptureSpan()
  public static async saveNote(data: {
    resource: WorkspaceNoteResource;
    noteType: WorkspaceNoteType;
    props: DatabaseCommonInteractionProps;
    note: string;
    sourceMessageKey: string;
    savedFromChatMessage?: SavedChatMessage | undefined;
  }): Promise<WorkspaceNoteSaveResult> {
    if (!this.supportsNoteType(data.resource.resourceType, data.noteType)) {
      throw new Error(
        `${RESOURCE_TYPES[data.resource.resourceType].label} does not support ${data.noteType} notes.`,
      );
    }

    const claimKey: string = [
      data.resource.resourceId.toString(),
      data.noteType,
      data.sourceMessageKey,
    ].join(":");

    let isClaimed: boolean = false;

    try {
      isClaimed = await GlobalCache.setStringIfNotExists(
        SAVE_CLAIM_NAMESPACE,
        claimKey,
        "1",
        { expiresInSeconds: SAVE_CLAIM_TTL_IN_SECONDS },
      );

      if (!isClaimed) {
        return WorkspaceNoteSaveResult.Duplicate;
      }
    } catch (err) {
      logger.debug(
        "Could not claim a note's save; checking saved notes alone.",
      );
      logger.debug(err);
    }

    try {
      if (
        await this.hasNote({
          resource: data.resource,
          noteType: data.noteType,
          sourceMessageKey: data.sourceMessageKey,
        })
      ) {
        return WorkspaceNoteSaveResult.Duplicate;
      }

      await this.addNote(data);

      return WorkspaceNoteSaveResult.Saved;
    } finally {
      if (isClaimed) {
        try {
          await GlobalCache.deleteKey(SAVE_CLAIM_NAMESPACE, claimKey);
        } catch (err) {
          logger.debug("Could not release a note's save claim.");
          logger.debug(err);
        }
      }
    }
  }

  /*
   * When a note saved from a message belongs in the timeline: when the
   * message was posted, for a private note - never later than now, should
   * the chat's clock be ahead. A public note is published now (undefined:
   * the note service's own time), as the status page's readers see it.
   */
  public static getNotePostedAt(data: {
    noteType: WorkspaceNoteType;
    savedFromChatMessage?: SavedChatMessage | undefined;
    now?: Date | undefined;
  }): Date | undefined {
    if (data.noteType !== WorkspaceNoteType.Private) {
      return undefined;
    }

    const postedAt: Date | null = SavedChatMessageUtil.getPostedAt(
      data.savedFromChatMessage || null,
    );

    if (!postedAt) {
      return undefined;
    }

    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    return postedAt.getTime() > now.getTime() ? now : postedAt;
  }

  // Whether a note of this type was already saved from the message.
  @CaptureSpan()
  public static async hasNote(data: {
    resource: WorkspaceNoteResource;
    noteType: WorkspaceNoteType;
    sourceMessageKey: string;
  }): Promise<boolean> {
    const id: ObjectID = data.resource.resourceId;
    const postedFromSlackMessageId: string = data.sourceMessageKey;
    const isPublic: boolean = data.noteType === WorkspaceNoteType.Public;

    switch (data.resource.resourceType) {
      case WorkspaceNoteResourceType.Incident:
        return await (
          isPublic ? IncidentPublicNoteService : IncidentInternalNoteService
        ).hasNoteFromSlackMessage({
          incidentId: id,
          postedFromSlackMessageId: postedFromSlackMessageId,
        });
      case WorkspaceNoteResourceType.ScheduledMaintenance:
        return await (
          isPublic
            ? ScheduledMaintenancePublicNoteService
            : ScheduledMaintenanceInternalNoteService
        ).hasNoteFromSlackMessage({
          scheduledMaintenanceId: id,
          postedFromSlackMessageId: postedFromSlackMessageId,
        });
      case WorkspaceNoteResourceType.Alert:
        return await AlertInternalNoteService.hasNoteFromSlackMessage({
          alertId: id,
          postedFromSlackMessageId: postedFromSlackMessageId,
        });
      case WorkspaceNoteResourceType.IncidentEpisode:
        return await IncidentEpisodeInternalNoteService.hasNoteFromSlackMessage(
          {
            incidentEpisodeId: id,
            postedFromSlackMessageId: postedFromSlackMessageId,
          },
        );
      case WorkspaceNoteResourceType.AlertEpisode:
        return await AlertEpisodeInternalNoteService.hasNoteFromSlackMessage({
          alertEpisodeId: id,
          postedFromSlackMessageId: postedFromSlackMessageId,
        });
    }
  }

  private static async addNote(data: {
    resource: WorkspaceNoteResource;
    noteType: WorkspaceNoteType;
    props: DatabaseCommonInteractionProps;
    note: string;
    sourceMessageKey: string;
    savedFromChatMessage?: SavedChatMessage | undefined;
  }): Promise<void> {
    const id: ObjectID = data.resource.resourceId;
    const isPublic: boolean = data.noteType === WorkspaceNoteType.Public;
    const common: {
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
      note: string;
      postedFromSlackMessageId: string;
      savedFromChatMessage?: SavedChatMessage | undefined;
    } = {
      projectId: data.resource.projectId,
      props: data.props,
      note: data.note,
      postedFromSlackMessageId: data.sourceMessageKey,
      savedFromChatMessage: data.savedFromChatMessage,
    };

    // A private note is filed when its message was posted.
    const postedAt: Date | undefined = this.getNotePostedAt({
      noteType: data.noteType,
      savedFromChatMessage: data.savedFromChatMessage,
    });

    switch (data.resource.resourceType) {
      case WorkspaceNoteResourceType.Incident:
        if (isPublic) {
          await IncidentPublicNoteService.addNote({
            ...common,
            incidentId: id,
          });
          return;
        }

        await IncidentInternalNoteService.addNote({
          ...common,
          incidentId: id,
          postedAt: postedAt,
        });
        return;
      case WorkspaceNoteResourceType.ScheduledMaintenance:
        if (isPublic) {
          await ScheduledMaintenancePublicNoteService.addNote({
            ...common,
            scheduledMaintenanceId: id,
          });
          return;
        }

        await ScheduledMaintenanceInternalNoteService.addNote({
          ...common,
          scheduledMaintenanceId: id,
          postedAt: postedAt,
        });
        return;
      case WorkspaceNoteResourceType.Alert:
        await AlertInternalNoteService.addNote({
          ...common,
          alertId: id,
          postedAt: postedAt,
        });
        return;
      case WorkspaceNoteResourceType.IncidentEpisode:
        await IncidentEpisodeInternalNoteService.addNote({
          ...common,
          incidentEpisodeId: id,
          postedAt: postedAt,
        });
        return;
      case WorkspaceNoteResourceType.AlertEpisode:
        await AlertEpisodeInternalNoteService.addNote({
          ...common,
          alertEpisodeId: id,
          postedAt: postedAt,
        });
        return;
    }
  }

  // "Incident #42" and its dashboard link, for the confirmation reply.
  @CaptureSpan()
  public static async getResourceDisplay(
    resource: WorkspaceNoteResource,
  ): Promise<{ label: string; link: URL }> {
    const { projectId, resourceId } = resource;
    const label: string = RESOURCE_TYPES[resource.resourceType].label;

    let numberResult: {
      number: number | null;
      numberWithPrefix: string | null;
    };
    let link: URL;

    switch (resource.resourceType) {
      case WorkspaceNoteResourceType.Incident:
        numberResult = await IncidentService.getIncidentNumber({
          incidentId: resourceId,
        });
        link = await IncidentService.getIncidentLinkInDashboard(
          projectId,
          resourceId,
        );
        break;
      case WorkspaceNoteResourceType.Alert:
        numberResult = await AlertService.getAlertNumber({
          alertId: resourceId,
        });
        link = await AlertService.getAlertLinkInDashboard(
          projectId,
          resourceId,
        );
        break;
      case WorkspaceNoteResourceType.ScheduledMaintenance:
        numberResult =
          await ScheduledMaintenanceService.getScheduledMaintenanceNumber({
            scheduledMaintenanceId: resourceId,
          });
        link =
          await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
            projectId,
            resourceId,
          );
        break;
      case WorkspaceNoteResourceType.IncidentEpisode:
        numberResult = await IncidentEpisodeService.getEpisodeNumber({
          episodeId: resourceId,
        });
        link = await IncidentEpisodeService.getEpisodeLinkInDashboard(
          projectId,
          resourceId,
        );
        break;
      case WorkspaceNoteResourceType.AlertEpisode:
        numberResult = await AlertEpisodeService.getEpisodeNumber({
          episodeId: resourceId,
        });
        link = await AlertEpisodeService.getEpisodeLinkInDashboard(
          projectId,
          resourceId,
        );
        break;
    }

    const numberDisplay: string =
      numberResult.numberWithPrefix ||
      (numberResult.number !== null && numberResult.number !== undefined
        ? `#${numberResult.number}`
        : "");

    return {
      label: numberDisplay ? `${label} ${numberDisplay}` : label,
      link: link,
    };
  }

  /*
   * The one confirmation of a saved message: a short reply in its thread,
   * as Markdown. The message's words are not repeated - they are right
   * above it - and the record's own channels are not told again either
   * (the note's feed entry skips the channel it came from). The label -
   * "Incident INC-42", with the prefix the project chose - is text in the
   * link, so it is never a link, a mention or styling of its own. Microsoft
   * Teams posts it as it is; Slack posts it as mrkdwn (SlackUtil.slackify),
   * with no preview of the link.
   *
   * A public note asked for on a private record (`askedNoteType` public,
   * `noteType` private) says why it is a private note: "✅ Saved as a
   * private note on Incident INC-42. The incident is private, so public
   * notes cannot be added to it."
   */
  public static getConfirmationMessage(data: {
    noteType: WorkspaceNoteType;
    resourceLabel: string;
    resourceLink: string;
    askedNoteType?: WorkspaceNoteType | undefined;
    resourceType?: WorkspaceNoteResourceType | undefined;
  }): MarkdownText {
    if (data.noteType === WorkspaceNoteType.Public) {
      return mdText`✅ Saved as a **public note** on [${data.resourceLabel}](${data.resourceLink}). It is shown on the status page.`;
    }

    if (data.askedNoteType === WorkspaceNoteType.Public) {
      const noun: string =
        RESOURCE_TYPES[data.resourceType || WorkspaceNoteResourceType.Incident]
          .noun;

      return mdText`✅ Saved as a **private note** on [${data.resourceLabel}](${data.resourceLink}). The ${noun} is private, so public notes cannot be added to it.`;
    }

    return mdText`✅ Saved as a **private note** on [${data.resourceLabel}](${data.resourceLink}).`;
  }

  /*
   * What somebody is told when the message they pinned has nothing a note
   * can hold: no text at all, or - for a public note - only files and
   * images, which a status page does not show (a link into the company's
   * chat opens for nobody there). The answer is not next to the message,
   * so it names it as they chose it (getSavedMessageWords): "The message
   * you pinned has no text to save as a note."
   */
  public static getNothingToSaveMessage(data: {
    noteType: WorkspaceNoteType;
    hasAttachments: boolean;
    workspaceType?: WorkspaceType | undefined;
  }): string {
    const words: string = WorkspaceNoteReactionUtil.getSavedMessageWords({
      noteType: data.noteType,
      workspaceType: data.workspaceType,
    });
    const message: string = words.charAt(0).toUpperCase() + words.slice(1);

    if (data.noteType === WorkspaceNoteType.Public && data.hasAttachments) {
      return `${message} has only files or images, which the status page does not show, so it was not saved as a public note.`;
    }

    return `${message} has no text to save as a note.`;
  }

  // The confirmation as plain text, for what a notification shows.
  public static getConfirmationText(data: {
    noteType: WorkspaceNoteType;
    resourceLabel: string;
  }): string {
    return data.noteType === WorkspaceNoteType.Public
      ? `Saved as a public note on ${data.resourceLabel}`
      : `Saved as a private note on ${data.resourceLabel}`;
  }
}
