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
import ObjectID from "../../../Types/ObjectID";
import { WorkspaceNoteType } from "../../../Types/Workspace/WorkspaceNoteReaction";
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
  },
  [WorkspaceNoteResourceType.Alert]: {
    service: (): ResourceService => {
      return AlertService as unknown as ResourceService;
    },
    logColumn: "alertId",
    noun: "alert",
    label: "Alert",
  },
  [WorkspaceNoteResourceType.ScheduledMaintenance]: {
    service: (): ResourceService => {
      return ScheduledMaintenanceService as unknown as ResourceService;
    },
    logColumn: "scheduledMaintenanceId",
    noun: "scheduled maintenance",
    label: "Scheduled Maintenance",
  },
  [WorkspaceNoteResourceType.IncidentEpisode]: {
    service: (): ResourceService => {
      return IncidentEpisodeService as unknown as ResourceService;
    },
    logColumn: "incidentEpisodeId",
    noun: "incident episode",
    label: "Incident Episode",
  },
  [WorkspaceNoteResourceType.AlertEpisode]: {
    service: (): ResourceService => {
      return AlertEpisodeService as unknown as ResourceService;
    },
    logColumn: "alertEpisodeId",
    noun: "alert episode",
    label: "Alert Episode",
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
   *   3. the resource OneUptime most recently posted about in the channel.
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
   * Saves the note unless one was already saved from the same message. The
   * caller must have authorized the user (see getNoteModelType) and checked
   * supportsNoteType.
   */
  @CaptureSpan()
  public static async saveNote(data: {
    resource: WorkspaceNoteResource;
    noteType: WorkspaceNoteType;
    userId: ObjectID;
    note: string;
    sourceMessageKey: string;
  }): Promise<WorkspaceNoteSaveResult> {
    if (!this.supportsNoteType(data.resource.resourceType, data.noteType)) {
      throw new Error(
        `${RESOURCE_TYPES[data.resource.resourceType].label} does not support ${data.noteType} notes.`,
      );
    }

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
    userId: ObjectID;
    note: string;
    sourceMessageKey: string;
  }): Promise<void> {
    const id: ObjectID = data.resource.resourceId;
    const isPublic: boolean = data.noteType === WorkspaceNoteType.Public;
    const common: {
      projectId: ObjectID;
      userId: ObjectID;
      note: string;
      postedFromSlackMessageId: string;
    } = {
      projectId: data.resource.projectId,
      userId: data.userId,
      note: data.note,
      postedFromSlackMessageId: data.sourceMessageKey,
    };

    switch (data.resource.resourceType) {
      case WorkspaceNoteResourceType.Incident:
        await (
          isPublic ? IncidentPublicNoteService : IncidentInternalNoteService
        ).addNote({ ...common, incidentId: id });
        return;
      case WorkspaceNoteResourceType.ScheduledMaintenance:
        await (
          isPublic
            ? ScheduledMaintenancePublicNoteService
            : ScheduledMaintenanceInternalNoteService
        ).addNote({ ...common, scheduledMaintenanceId: id });
        return;
      case WorkspaceNoteResourceType.Alert:
        await AlertInternalNoteService.addNote({ ...common, alertId: id });
        return;
      case WorkspaceNoteResourceType.IncidentEpisode:
        await IncidentEpisodeInternalNoteService.addNote({
          ...common,
          incidentEpisodeId: id,
        });
        return;
      case WorkspaceNoteResourceType.AlertEpisode:
        await AlertEpisodeInternalNoteService.addNote({
          ...common,
          alertEpisodeId: id,
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
   * The confirmation posted in the message's thread. `formatLink` renders a
   * link in the workspace's own syntax.
   */
  public static getConfirmationMessage(data: {
    noteType: WorkspaceNoteType;
    resourceLabel: string;
    resourceLink: string;
    formatLink: (url: string, text: string) => string;
    formatBold: (text: string) => string;
  }): string {
    const link: string = data.formatLink(data.resourceLink, data.resourceLabel);

    if (data.noteType === WorkspaceNoteType.Public) {
      return `✅ Message saved as ${data.formatBold("public note")} to ${link}. This note will be visible on the status page.`;
    }

    return `✅ Message saved as ${data.formatBold("private note")} to ${link}.`;
  }
}
