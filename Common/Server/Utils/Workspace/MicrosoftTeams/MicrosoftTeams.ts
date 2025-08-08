import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import API from "../../../../Utils/API";
import WorkspaceMessagePayload, {
  WorkspacePayloadButtons,
  WorkspacePayloadHeader,
  WorkspacePayloadMarkdown,
  WorkspaceMessagePayloadButton,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
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

      const key: string = (team["displayName"] as string).toLowerCase();

      channels[key] = {
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

  // ---------- Basic block builders (Teams uses simple HTML content) ----------

  @CaptureSpan()
  public static override getHeaderBlock(data: {
    payloadHeaderBlock: WorkspacePayloadHeader;
  }): JSONObject {
    return {
      type: "header",
      text: data.payloadHeaderBlock.text,
    } as JSONObject;
  }

  @CaptureSpan()
  public static override getMarkdownBlock(data: {
    payloadMarkdownBlock: WorkspacePayloadMarkdown;
  }): JSONObject {
    return {
      type: "markdown",
      text: data.payloadMarkdownBlock.text,
    } as JSONObject;
  }

  @CaptureSpan()
  public static override getButtonsBlock(data: {
    payloadButtonsBlock: WorkspacePayloadButtons;
  }): JSONObject {
    return {
      type: "buttons",
      buttons: data.payloadButtonsBlock.buttons?.map(
        (b: WorkspaceMessagePayloadButton) =>
          this.getButtonBlock({ payloadButtonBlock: b }),
      ),
    } as JSONObject;
  }

  @CaptureSpan()
  public static override getButtonBlock(data: {
    payloadButtonBlock: WorkspaceMessagePayloadButton;
  }): JSONObject {
    return {
      type: "button",
      title: data.payloadButtonBlock.title,
      url: data.payloadButtonBlock.url
        ? data.payloadButtonBlock.url.toString()
        : undefined,
      value: data.payloadButtonBlock.value,
    } as JSONObject;
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
  public static override async inviteUserToChannelByChannelId(_data: {
    authToken: string;
    channelId: string; // team id where we want to add member
    workspaceUserId: string; // AAD user id
  }): Promise<void> {
    // Teams membership management requires specific permissions and often admin consent.
    // We no-op here to avoid failures and rely on existing membership.
    logger.debug(
      "MicrosoftTeams.inviteUserToChannelByChannelId is not implemented. Skipping.",
    );
    return;
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

      // Creating new Microsoft Teams (teams) programmatically is not supported in this initial integration.
      // We will skip creation and simply log the absence.
      logger.debug(
        `Channel/Team ${channelName} does not exist in Microsoft Teams. Skipping creation.`,
      );
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

  if (!channels[data.channelName.toLowerCase()]) {
      logger.error("Channel not found.");
      throw new BadDataException("Channel not found.");
    }

    logger.debug("Workspace channel ID obtained:");
  logger.debug(channels[data.channelName.toLowerCase()]!.id);

  return channels[data.channelName.toLowerCase()]!;
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
      const channel: WorkspaceChannel = {
        id: channelId,
        name: "",
        workspaceType: WorkspaceType.MicrosoftTeams,
      };

      workspaceChannelsToPostTo.push(channel);
    }

    logger.debug("Channel IDs to post to:");
    logger.debug(workspaceChannelsToPostTo);

    const workspaceMessageResponse: WorkspaceSendMessageResponse = {
      threads: [],
      workspaceType: WorkspaceType.MicrosoftTeams,
    };

  for (const channel of workspaceChannelsToPostTo) {
      try {
    // For Teams, skip membership checks in initial integration.

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

  // ---------- Teams specific implementations ----------

  @CaptureSpan()
  public static override async getUsernameFromUserId(data: {
    authToken: string;
    userId: string;
  }): Promise<string | null> {
    try {
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get(
          URL.fromString(
            `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
              data.userId,
            )}`,
          ),
          {
            Authorization: `Bearer ${data.authToken}`,
          },
        );

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error fetching Teams user details:");
        logger.error(response);
        return null;
      }

      const displayName: string | undefined = (response.jsonData as JSONObject)[
        "displayName"
      ] as string | undefined;
      return displayName || null;
    } catch (err) {
      logger.error(err);
      return null;
    }
  }

  @CaptureSpan()
  public static override async isUserInChannel(_data: {
    authToken: string;
    channelId: string;
    userId: string;
  }): Promise<boolean> {
    // Skipping membership verification for initial integration.
    return true;
  }

  @CaptureSpan()
  public static override async joinChannel(_data: {
    authToken: string;
    channelId: string;
  }): Promise<void> {
    // No-op in initial integration.
    return;
  }

  @CaptureSpan()
  public static override async sendPayloadBlocksToChannel(data: {
    authToken: string;
    workspaceChannel: WorkspaceChannel; // here, id is Team ID
    blocks: Array<JSONObject>;
  }): Promise<WorkspaceThread> {
    logger.debug("Posting message to Microsoft Teams channel (General)...");

    // Build simple HTML content from blocks
    const toHtml = (bs: Array<JSONObject>): string => {
      const htmlParts: Array<string> = [];
      for (const b of bs) {
        const type: string = (b["type"] as string) || "";
        if (type === "header") {
          htmlParts.push(`<h3>${(b["text"] as string) || ""}</h3>`);
        } else if (type === "markdown") {
          const text: string = (b["text"] as string) || "";
          // very light markdown to HTML: **bold** -> <b>bold</b>
          const html: string = text
            .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
            .replace(/\*(.*?)\*/g, "<i>$1</i>")
            .replace(/\n/g, "<br/>");
          htmlParts.push(`<p>${html}</p>`);
        } else if (type === "divider") {
          htmlParts.push("<hr/>");
        } else if (type === "buttons") {
          const btns: Array<JSONObject> = (b["buttons"] as Array<JSONObject>) || [];
          if (btns.length > 0) {
            htmlParts.push(
              btns
                .map((btn: JSONObject) => {
                  const title: string = (btn["title"] as string) || "Button";
                  const url: string | undefined = btn["url"] as string | undefined;
                  return url
                    ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a>`
                    : `<span>${title}</span>`;
                })
                .join(" &nbsp; "),
            );
          }
        }
      }
      return htmlParts.join("\n");
    };

    const htmlContent: string = toHtml(data.blocks);

    // Resolve General channel for the given Team (workspaceChannel.id)
    const channelsResp: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get(
        URL.fromString(
          `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(
            data.workspaceChannel.id,
          )}/channels`,
        ),
        {
          Authorization: `Bearer ${data.authToken}`,
        },
      );

    if (channelsResp instanceof HTTPErrorResponse) {
      logger.error("Error fetching Teams channels:");
      logger.error(channelsResp);
      throw channelsResp;
    }

    const channels: Array<JSONObject> = ((channelsResp.jsonData as JSONObject)[
      "value"
    ] || []) as Array<JSONObject>;

    const generalChannel: JSONObject | undefined = channels.find(
      (c: JSONObject) =>
        (c["displayName"] as string)?.toLowerCase() === "general",
    );

    if (!generalChannel || !generalChannel["id"]) {
      throw new BadDataException(
        "Could not find General channel for the selected Microsoft Team.",
      );
    }

    const channelId: string = generalChannel["id"] as string;

    const postResp: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post(
        URL.fromString(
          `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(
            data.workspaceChannel.id,
          )}/channels/${encodeURIComponent(channelId)}/messages`,
        ),
        {
          body: {
            contentType: "html",
            content: htmlContent,
          },
        },
        {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/json",
        },
        {
          retries: 3,
          exponentialBackoff: true,
        },
      );

    if (postResp instanceof HTTPErrorResponse) {
      logger.error("Error posting Teams message:");
      logger.error(postResp);
      throw postResp;
    }

    const messageId: string = ((postResp.jsonData as JSONObject)["id"] ||
      "") as string;

    const thread: WorkspaceThread = {
      channel: data.workspaceChannel,
      threadId: messageId,
    };

    return thread;
  }
}
