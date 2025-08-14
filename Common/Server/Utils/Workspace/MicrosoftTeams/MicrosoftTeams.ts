import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import API from "../../../../Utils/API";
import WorkspaceMessagePayload from "../../../../Types/Workspace/WorkspaceMessagePayload";
import logger from "../../Logger";
import Dictionary from "../../../../Types/Dictionary";
import WorkspaceBase, {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "../WorkspaceBase";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import OneUptimeDate from "../../../../Types/Date";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import BadDataException from "../../../../Types/Exception/BadDataException";

export default class MicrosoftTeams extends WorkspaceBase {
  @CaptureSpan()
  public static override async getAllWorkspaceChannels(data: {
    authToken: string;
  }): Promise<Dictionary<WorkspaceChannel>> {
    logger.debug("Getting all workspace channels with data:");
    logger.debug(data);

    const channels: Dictionary<WorkspaceChannel> = {};
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get<JSONObject>(
        URL.fromString("https://graph.microsoft.com/v1.0/me/joinedTeams"),
        {
          Authorization: `Bearer ${data.authToken}`,
        },
      );

    logger.debug("Response from Microsoft Graph API for getting all channels:");
    logger.debug(JSON.stringify(response, null, 2));

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Microsoft Graph API:");
      logger.error(response);
      throw response;
    }

    for (const team of (response.jsonData as JSONObject)?.[
      "value"
    ] as Array<JSONObject>) {
      if (!team["id"] || !team["displayName"]) {
        continue;
      }

      channels[team["displayName"].toString()] = {
        id: team["id"] as string,
        name: team["displayName"] as string,
        workspaceType: WorkspaceType.MicrosoftTeams,
      };
    }

    logger.debug("All workspace channels obtained:");
    logger.debug(channels);
    return channels;
  }

  @CaptureSpan()
  public static override getDividerBlock(): JSONObject {
    return {
      type: "divider",
    };
  }

  @CaptureSpan()
  public static getValuesFromView(data: {
    view: JSONObject;
  }): Dictionary<string | number | Array<string | number> | Date> {
    logger.debug("Getting values from view with data:");
    logger.debug(JSON.stringify(data, null, 2));

    const teamsView: JSONObject = data.view;
    const values: Dictionary<string | number | Array<string | number> | Date> =
      {};

    if (!teamsView["state"] || !(teamsView["state"] as JSONObject)["values"]) {
      return {};
    }

    for (const valueId in (teamsView["state"] as JSONObject)[
      "values"
    ] as JSONObject) {
      for (const blockId in (
        (teamsView["state"] as JSONObject)["values"] as JSONObject
      )[valueId] as JSONObject) {
        const valueObject: JSONObject = (
          (teamsView["state"] as JSONObject)["values"] as JSONObject
        )[valueId] as JSONObject;
        const value: JSONObject = valueObject[blockId] as JSONObject;
        values[blockId] = value["value"] as string | number;

        if ((value["selected_option"] as JSONObject)?.["value"]) {
          values[blockId] = (value["selected_option"] as JSONObject)?.[
            "value"
          ] as string;
        }

        if (Array.isArray(value["selected_options"])) {
          values[blockId] = (
            value["selected_options"] as Array<JSONObject>
          ).map((option: JSONObject) => {
            return option["value"] as string | number;
          });
        }

        // if date picker
        if (value["selected_date_time"]) {
          values[blockId] = OneUptimeDate.fromUnixTimestamp(
            value["selected_date_time"] as number,
          );
        }
      }
    }

    logger.debug("Values obtained from view:");
    logger.debug(values);

    return values;
  }

  @CaptureSpan()
  public static override async inviteUserToChannelByChannelName(data: {
    authToken: string;
    channelName: string;
    workspaceUserId: string;
  }): Promise<void> {
    logger.debug("Inviting user to channel with data:");
    logger.debug(data);

    const channelId: string = (
      await this.getWorkspaceChannelFromChannelName({
        authToken: data.authToken,
        channelName: data.channelName,
      })
    ).id;

    return this.inviteUserToChannelByChannelId({
      authToken: data.authToken,
      channelId: channelId,
      workspaceUserId: data.workspaceUserId,
    });
  }

  @CaptureSpan()
  public static override async createChannelsIfDoesNotExist(data: {
    authToken: string;
    channelNames: Array<string>;
  }): Promise<Array<WorkspaceChannel>> {
    logger.debug("Creating channels if they do not exist with data:");
    logger.debug(data);

    const workspaceChannels: Array<WorkspaceChannel> = [];
    const existingWorkspaceChannels: Dictionary<WorkspaceChannel> =
      await this.getAllWorkspaceChannels({
        authToken: data.authToken,
      });

    logger.debug("Existing workspace channels:");
    logger.debug(existingWorkspaceChannels);

    for (let channelName of data.channelNames) {
      // if channel name starts with #, remove it
      if (channelName && channelName.startsWith("#")) {
        channelName = channelName.substring(1);
      }

      // convert channel name to lowercase
      channelName = channelName.toLowerCase();

      // replace spaces with hyphens
      channelName = channelName.replace(/\s+/g, "-");

      if (existingWorkspaceChannels[channelName]) {
        logger.debug(`Channel ${channelName} already exists.`);
        workspaceChannels.push(existingWorkspaceChannels[channelName]!);
        continue;
      }

      logger.debug(`Channel ${channelName} does not exist. Creating channel.`);
      const channel: WorkspaceChannel = await this.createChannel({
        authToken: data.authToken,
        channelName: channelName,
      });

      if (channel) {
        logger.debug(`Channel ${channelName} created successfully.`);
        workspaceChannels.push(channel);
      }
    }

    logger.debug("Channels created or found:");
    logger.debug(workspaceChannels);
    return workspaceChannels;
  }

  @CaptureSpan()
  public static override async getWorkspaceChannelFromChannelName(data: {
    authToken: string;
    channelName: string;
  }): Promise<WorkspaceChannel> {
    logger.debug("Getting workspace channel ID from channel name with data:");
    logger.debug(data);

    const channels: Dictionary<WorkspaceChannel> =
      await this.getAllWorkspaceChannels({
        authToken: data.authToken,
      });

    logger.debug("All workspace channels:");
    logger.debug(channels);

    if (!channels[data.channelName]) {
      logger.error("Channel not found.");
      throw new BadDataException("Channel not found.");
    }

    logger.debug("Workspace channel ID obtained:");
    logger.debug(channels[data.channelName]!.id);

    return channels[data.channelName]!;
  }

  @CaptureSpan()
  public static override async getWorkspaceChannelFromChannelId(data: {
    authToken: string;
    channelId: string;
  }): Promise<WorkspaceChannel> {
    logger.debug("Getting workspace channel from channel ID with data:");
    logger.debug(data);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get<JSONObject>(
        URL.fromString(
          `https://graph.microsoft.com/v1.0/teams/${data.channelId}`,
        ),
        {
          Authorization: `Bearer ${data.authToken}`,
        },
      );

    logger.debug("Response from Microsoft Graph API for getting channel info:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Microsoft Graph API:");
      logger.error(response);
      throw response;
    }

    if (!(response.jsonData as JSONObject)?.["displayName"]) {
      logger.error("Invalid response from Microsoft Graph API:");
      logger.error(response.jsonData);
      throw new Error("Invalid response");
    }

    const channel: WorkspaceChannel = {
      name: (response.jsonData as JSONObject)["displayName"] as string,
      id: data.channelId,
      workspaceType: WorkspaceType.MicrosoftTeams,
    };

    logger.debug("Workspace channel obtained:");
    logger.debug(channel);
    return channel;
  }

  @CaptureSpan()
  public static override async doesChannelExist(data: {
    authToken: string;
    channelName: string;
  }): Promise<boolean> {
    // if channel name starts with #, remove it
    if (data.channelName && data.channelName.startsWith("#")) {
      data.channelName = data.channelName.substring(1);
    }

    // convert channel name to lowercase
    data.channelName = data.channelName.toLowerCase();

    // get channel id from channel name
    const channels: Dictionary<WorkspaceChannel> =
      await this.getAllWorkspaceChannels({
        authToken: data.authToken,
      });

    // if this channel exists
    if (channels[data.channelName]) {
      return true;
    }

    return false;
  }

  @CaptureSpan()
  public static override async sendMessage(data: {
    workspaceMessagePayload: WorkspaceMessagePayload;
    authToken: string; // which auth token should we use to send.
    userId: string;
  }): Promise<WorkspaceSendMessageResponse> {
    logger.debug("Sending message to Microsoft Teams with data:");
    logger.debug(data);

    const blocks: Array<JSONObject> = this.getBlocksFromWorkspaceMessagePayload(
      data.workspaceMessagePayload,
    );

    logger.debug("Blocks generated from workspace message payload:");
    logger.debug(blocks);

    const existingWorkspaceChannels: Dictionary<WorkspaceChannel> =
      await this.getAllWorkspaceChannels({
        authToken: data.authToken,
      });

    logger.debug("Existing workspace channels:");
    logger.debug(existingWorkspaceChannels);

    const workspaceChannelsToPostTo: Array<WorkspaceChannel> = [];

    for (let channelName of data.workspaceMessagePayload.channelNames) {
      if (channelName && channelName.startsWith("#")) {
        // trim # from channel name
        channelName = channelName.substring(1);
      }

      let channel: WorkspaceChannel | null = null;

      if (existingWorkspaceChannels[channelName]) {
        channel = existingWorkspaceChannels[channelName]!;
      }

      if (channel) {
        workspaceChannelsToPostTo.push(channel);
      } else {
        logger.debug(`Channel ${channelName} does not exist.`);
      }
    }

    // add channel ids.
    for (const channelId of data.workspaceMessagePayload.channelIds) {
      try {
        // Get the channel info including name from channel ID
        const channel: WorkspaceChannel =
          await this.getWorkspaceChannelFromChannelId({
            authToken: data.authToken,
            channelId: channelId,
          });

        workspaceChannelsToPostTo.push(channel);
      } catch (err) {
        logger.error(`Error getting channel info for channel ID ${channelId}:`);
        logger.error(err);

        // Fallback: create channel object with empty name if API call fails
        const channel: WorkspaceChannel = {
          id: channelId,
          name: channelId,
          workspaceType: WorkspaceType.MicrosoftTeams,
        };

        workspaceChannelsToPostTo.push(channel);
      }
    }

    logger.debug("Channel IDs to post to:");
    logger.debug(workspaceChannelsToPostTo);

    const workspaceMessageResponse: WorkspaceSendMessageResponse = {
      threads: [],
      workspaceType: WorkspaceType.MicrosoftTeams,
    };

    for (const channel of workspaceChannelsToPostTo) {
      try {
        // check if the user is in the channel.
        const isUserInChannel: boolean = await this.isUserInChannel({
          authToken: data.authToken,
          channelId: channel.id,
          userId: data.userId,
        });

        if (!isUserInChannel) {
          // add user to the channel
          await this.joinChannel({
            authToken: data.authToken,
            channelId: channel.id,
          });
        }

        const thread: WorkspaceThread = await this.sendPayloadBlocksToChannel({
          authToken: data.authToken,
          workspaceChannel: channel,
          blocks: blocks,
        });

        workspaceMessageResponse.threads.push(thread);

        logger.debug(`Message sent to channel ID ${channel.id} successfully.`);
      } catch (e) {
        logger.error(`Error sending message to channel ID ${channel.id}:`);
        logger.error(e);
      }
    }

    logger.debug("Message sent successfully.");
    logger.debug(workspaceMessageResponse);

    return workspaceMessageResponse;
  }
}
