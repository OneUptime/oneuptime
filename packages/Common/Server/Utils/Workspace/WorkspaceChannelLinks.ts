import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsMiscData,
  SlackMiscData,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceChannelLinkUtil, {
  WorkspaceChannelLink,
  WorkspaceChannelRecordType,
} from "../../../Types/Workspace/WorkspaceChannelLink";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import AlertEpisodeService from "../../Services/AlertEpisodeService";
import AlertService from "../../Services/AlertService";
import IncidentEpisodeService from "../../Services/IncidentEpisodeService";
import IncidentService from "../../Services/IncidentService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import WorkspaceProjectAuthTokenService from "../../Services/WorkspaceProjectAuthTokenService";
import logger from "../Logger";
import MicrosoftTeamsHosts from "./MicrosoftTeams/MicrosoftTeamsHosts";

/*
 * THE LINKS TO A RECORD'S OWN SLACK AND MICROSOFT TEAMS CHANNELS.
 *
 * What the "Open in Slack" / "Open in Microsoft Teams" buttons of an
 * incident's, alert's, episode's or scheduled maintenance event's page open
 * (WorkspaceChannelLink). The channels are the ones a workspace notification
 * rule created for the record (postUpdatesToWorkspaceChannels), which no API
 * reads; the ids a link needs besides the channel's own - the Slack
 * workspace, the Microsoft Teams tenant - are the project's connection.
 *
 * WHO MAY ASK. Whoever can read the record: it is read here with the
 * caller's own props first, so the table permission and a private record's
 * privacy apply exactly as on its page, and a record the caller cannot see
 * is "not found". Only then are the channels read, as OneUptime.
 */
interface RecordReader {
  findWithCallerProps: (data: {
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
  }) => Promise<{ projectId?: ObjectID | undefined } | null>;
  findChannels: (
    id: ObjectID,
  ) => Promise<Array<NotificationRuleWorkspaceChannel>>;
}

const READERS: Record<WorkspaceChannelRecordType, RecordReader> = {
  [WorkspaceChannelRecordType.Incident]: {
    findWithCallerProps: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<Incident | null> => {
      return await IncidentService.findOneById({
        id: data.id,
        select: { _id: true, projectId: true },
        props: data.props,
      });
    },
    findChannels: async (
      id: ObjectID,
    ): Promise<Array<NotificationRuleWorkspaceChannel>> => {
      const incident: Incident | null = await IncidentService.findOneById({
        id: id,
        select: { postUpdatesToWorkspaceChannels: true },
        props: { isRoot: true },
      });

      return incident?.postUpdatesToWorkspaceChannels || [];
    },
  },
  [WorkspaceChannelRecordType.Alert]: {
    findWithCallerProps: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<Alert | null> => {
      return await AlertService.findOneById({
        id: data.id,
        select: { _id: true, projectId: true },
        props: data.props,
      });
    },
    findChannels: async (
      id: ObjectID,
    ): Promise<Array<NotificationRuleWorkspaceChannel>> => {
      const alert: Alert | null = await AlertService.findOneById({
        id: id,
        select: { postUpdatesToWorkspaceChannels: true },
        props: { isRoot: true },
      });

      return alert?.postUpdatesToWorkspaceChannels || [];
    },
  },
  [WorkspaceChannelRecordType.IncidentEpisode]: {
    findWithCallerProps: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<IncidentEpisode | null> => {
      return await IncidentEpisodeService.findOneById({
        id: data.id,
        select: { _id: true, projectId: true },
        props: data.props,
      });
    },
    findChannels: async (
      id: ObjectID,
    ): Promise<Array<NotificationRuleWorkspaceChannel>> => {
      const episode: IncidentEpisode | null =
        await IncidentEpisodeService.findOneById({
          id: id,
          select: { postUpdatesToWorkspaceChannels: true },
          props: { isRoot: true },
        });

      return episode?.postUpdatesToWorkspaceChannels || [];
    },
  },
  [WorkspaceChannelRecordType.AlertEpisode]: {
    findWithCallerProps: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<AlertEpisode | null> => {
      return await AlertEpisodeService.findOneById({
        id: data.id,
        select: { _id: true, projectId: true },
        props: data.props,
      });
    },
    findChannels: async (
      id: ObjectID,
    ): Promise<Array<NotificationRuleWorkspaceChannel>> => {
      const episode: AlertEpisode | null =
        await AlertEpisodeService.findOneById({
          id: id,
          select: { postUpdatesToWorkspaceChannels: true },
          props: { isRoot: true },
        });

      return episode?.postUpdatesToWorkspaceChannels || [];
    },
  },
  [WorkspaceChannelRecordType.ScheduledMaintenance]: {
    findWithCallerProps: async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }): Promise<ScheduledMaintenance | null> => {
      return await ScheduledMaintenanceService.findOneById({
        id: data.id,
        select: { _id: true, projectId: true },
        props: data.props,
      });
    },
    findChannels: async (
      id: ObjectID,
    ): Promise<Array<NotificationRuleWorkspaceChannel>> => {
      const event: ScheduledMaintenance | null =
        await ScheduledMaintenanceService.findOneById({
          id: id,
          select: { postUpdatesToWorkspaceChannels: true },
          props: { isRoot: true },
        });

      return event?.postUpdatesToWorkspaceChannels || [];
    },
  },
};

export default class WorkspaceChannelLinks {
  /*
   * The links to the record's channels, Slack first, in the order the record
   * got them. A channel whose link cannot be built - the workspace was
   * disconnected since, an id of the wrong shape - is left out rather than
   * offered as a button that goes nowhere.
   */
  public static async getLinks(data: {
    recordType: WorkspaceChannelRecordType;
    recordId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<WorkspaceChannelLink>> {
    const reader: RecordReader = READERS[data.recordType];

    const record: { projectId?: ObjectID | undefined } | null =
      await reader.findWithCallerProps({
        id: data.recordId,
        props: data.props,
      });

    if (!record || !record.projectId) {
      throw new NotFoundException("This record was not found.");
    }

    const channels: Array<NotificationRuleWorkspaceChannel> =
      await reader.findChannels(data.recordId);

    if (channels.length === 0) {
      return [];
    }

    return await WorkspaceChannelLinks.buildLinks({
      projectId: record.projectId,
      channels: channels,
    });
  }

  public static async buildLinks(data: {
    projectId: ObjectID;
    channels: Array<NotificationRuleWorkspaceChannel>;
  }): Promise<Array<WorkspaceChannelLink>> {
    // A stored list is JSON: an entry that is not a channel is skipped.
    const channels: Array<NotificationRuleWorkspaceChannel> =
      data.channels.filter((channel: NotificationRuleWorkspaceChannel) => {
        return Boolean(channel) && typeof channel === "object";
      });

    const hasSlack: boolean = channels.some(
      (channel: NotificationRuleWorkspaceChannel) => {
        return channel.workspaceType === WorkspaceType.Slack;
      },
    );
    const hasTeams: boolean = channels.some(
      (channel: NotificationRuleWorkspaceChannel) => {
        return channel.workspaceType === WorkspaceType.MicrosoftTeams;
      },
    );

    const slackTeamId: string | null = hasSlack
      ? await WorkspaceChannelLinks.getSlackTeamId(data.projectId)
      : null;
    const teamsTenantId: string | null = hasTeams
      ? await WorkspaceChannelLinks.getMicrosoftTeamsTenantId(data.projectId)
      : null;

    const links: Array<WorkspaceChannelLink> = [];
    const seenUrls: Set<string> = new Set<string>();

    for (const workspaceType of [
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
    ]) {
      for (const channel of channels) {
        if (channel.workspaceType !== workspaceType) {
          continue;
        }

        const url: string | null =
          workspaceType === WorkspaceType.Slack
            ? slackTeamId
              ? WorkspaceChannelLinkUtil.getSlackChannelUrl({
                  teamId: slackTeamId,
                  channelId: channel.id,
                })
              : null
            : WorkspaceChannelLinkUtil.getMicrosoftTeamsChannelUrl({
                tenantId: teamsTenantId || undefined,
                teamId: channel.teamId,
                channelId: channel.id,
                channelName: channel.name,
                teamsWebOrigin: MicrosoftTeamsHosts.getTeamsWebOrigin(),
              });

        if (!url || seenUrls.has(url)) {
          continue;
        }

        seenUrls.add(url);
        links.push({
          workspaceType: workspaceType,
          channelName: (channel.name || "").trim(),
          url: url,
        });
      }
    }

    return links;
  }

  // The Slack workspace the project's bot was installed into, if any.
  public static async getSlackTeamId(
    projectId: ObjectID,
  ): Promise<string | null> {
    try {
      const projectAuth: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.getProjectAuth({
          projectId: projectId,
          workspaceType: WorkspaceType.Slack,
        });

      if (!projectAuth) {
        return null;
      }

      return (
        (projectAuth.miscData as SlackMiscData | undefined)?.teamId ||
        projectAuth.workspaceProjectId ||
        null
      );
    } catch (err) {
      logger.error(err);
      return null;
    }
  }

  // The Microsoft Entra tenant the project's Teams app was connected in.
  public static async getMicrosoftTeamsTenantId(
    projectId: ObjectID,
  ): Promise<string | null> {
    try {
      const projectAuth: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.getProjectAuth({
          projectId: projectId,
          workspaceType: WorkspaceType.MicrosoftTeams,
        });

      if (!projectAuth) {
        return null;
      }

      return (
        (projectAuth.miscData as MicrosoftTeamsMiscData | undefined)
          ?.tenantId ||
        projectAuth.workspaceProjectId ||
        null
      );
    } catch (err) {
      logger.error(err);
      return null;
    }
  }
}
