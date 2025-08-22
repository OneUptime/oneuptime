import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import API from "../../../../Utils/API";
import WorkspaceBase, {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "../WorkspaceBase";
import WorkspaceMessagePayload, {
  WorkspaceMessageBlock,
  WorkspaceModalBlock,
  WorkspacePayloadMarkdown,
  WorkspacePayloadHeader,
  WorkspacePayloadButtons,
  WorkspaceMessagePayloadButton,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import Dictionary from "../../../../Types/Dictionary";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import logger from "../../Logger";

export default class MicrosoftTeamsUtil extends WorkspaceBase {
  // Very small markdown subset -> HTML for Teams message body.
  // Teams message body (Graph API /messages) supports basic HTML tags like <b>, <i>, <code>, <br/>.
  // We intentionally keep this lightweight to avoid bringing full markdown parser server-side for Teams path.
  private static convertMarkdownToTeamsHTMLIfNeeded(text: string): string {
    if (!text) {
      return text;
    }
    let html: string = text;
    // Escape existing '<' to avoid injection, but allow basic tags we add later.
    html = html.replace(/</g, "&lt;");
    // Bold **text** or __text__ -> <b>text</b>
    html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    html = html.replace(/__(.+?)__/g, "<b>$1</b>");
    // Italic *text* or _text_ (avoid converting inside bold we already processed). Use negative lookahead/lookbehind basics.
    html = html.replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, "<i>$1</i>");
  html = html.replace(/(^|\s)_([^_]+)_/g, (_match: string, p1: string, p2: string) => `${p1}<i>${p2}</i>`);
    // Inline code `code`
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    // Replace line breaks with <br/>
    html = html.replace(/\r?\n/g, "<br/>");
    return html;
  }
  public static isValidMicrosoftTeamsIncomingWebhookUrl(
    incomingWebhookUrl: URL,
  ): boolean {
    const urlStr: string = incomingWebhookUrl.toString();
    // Teams webhooks use outlook.office.com for legacy and webhook.office.com for new connectors
    return (
      urlStr.includes("webhook.office.com/") ||
      urlStr.startsWith("https://outlook.office.com/webhook/")
    );
  }

  // ---------------- Block Builders (Adaptive Card JSON) ----------------
  // These override the abstract WorkspaceBase implementations. Without these
  // Teams notifications that include these block types throw NotImplementedException.

  @CaptureSpan()
  public static override getMarkdownBlock(data: {
    payloadMarkdownBlock: WorkspacePayloadMarkdown;
  }): JSONObject {
    return {
      type: "TextBlock",
      text: data.payloadMarkdownBlock.text || "",
      wrap: true,
    } as JSONObject;
  }

  @CaptureSpan()
  public static override getHeaderBlock(data: {
    payloadHeaderBlock: WorkspacePayloadHeader;
  }): JSONObject {
    return {
      type: "TextBlock",
      text: `**${data.payloadHeaderBlock.text || ""}**`,
      size: "Large",
      weight: "Bolder",
      wrap: true,
      spacing: "Medium",
    } as JSONObject;
  }

  @CaptureSpan()
  public static override getDividerBlock(): JSONObject {
    // Adaptive Cards do not have a dedicated divider element until v1.6 ("ActionSet" separator etc.).
    // Use an empty TextBlock with separator to visually separate sections.
    return {
      type: "TextBlock",
      text: "",
      separator: true,
      spacing: "Medium",
    } as JSONObject;
  }

  @CaptureSpan()
  public static override getButtonsBlock(data: {
    payloadButtonsBlock: WorkspacePayloadButtons;
  }): JSONObject {
    const actions: Array<JSONObject> = data.payloadButtonsBlock.buttons.map(
      (btn: WorkspaceMessagePayloadButton): JSONObject => {
        if (btn.url) {
          return {
            type: "Action.OpenUrl",
            title: btn.title,
            url: btn.url.toString(),
          } as JSONObject;
        }

        // Action.Submit can carry arbitrary data back in invoke payload
        return {
          type: "Action.Submit",
          title: btn.title,
          data: {
            actionId: btn.actionId,
            value: btn.value,
          },
        } as JSONObject;
      },
    );

    return {
      type: "ActionSet",
      actions: actions,
    } as JSONObject;
  }

  @CaptureSpan()
  public static override async sendMessageToChannelViaIncomingWebhook(data: {
    url: URL;
    text: string;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    logger.debug(
      "MicrosoftTeams: Sending message to channel via incoming webhook with data:",
    );
    logger.debug(data);

    // Reference payload shape based on Adaptive Cards via Teams Incoming Webhooks
    // https://learn.microsoft.com/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook
    const payload: JSONObject = {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          contentUrl: null,
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            msteams: { width: "Full" } as unknown as JSONObject,
            type: "AdaptiveCard",
            version: "1.2",
            body: [
              {
                type: "TextBlock",
                wrap: true as unknown as string,
                text: `${data.text}`,
              } as unknown as JSONObject,
            ],
          } as unknown as JSONObject,
        } as unknown as JSONObject,
      ],
    } as unknown as JSONObject;

    const apiResult: HTTPResponse<JSONObject> | HTTPErrorResponse | null =
      await API.post(data.url, payload, undefined, {
        retries: 3,
        exponentialBackoff: true,
      });

    logger.debug(
      "MicrosoftTeams: Response from API for sending message via webhook:",
    );
    logger.debug(apiResult);

    return apiResult;
  }

  // ------------- Graph API helpers -------------
  private static graphHeaders(token: string): { [key: string]: string } {
    return {
      Authorization: `Bearer ${token}`,
      ["Content-Type"]: "application/json",
    };
  }

  private static async getTeamIdFromAuthToken(token: string): Promise<string> {
    // We attempt to get the first joined team for this token. In a future update, we can persist a selected team.
    const resp: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.get(
      URL.fromString("https://graph.microsoft.com/v1.0/me/joinedTeams"),
      undefined,
      this.graphHeaders(token),
      {
        retries: 3,
        exponentialBackoff: true,
      },
    );

    if (resp instanceof HTTPErrorResponse) {
      throw resp;
    }

    const values: Array<JSONObject> = (resp.jsonData as JSONObject)[
      "value"
    ] as Array<JSONObject>;
    const firstTeam: JSONObject | undefined = values?.[0];
    if (!firstTeam || !firstTeam["id"]) {
      throw new Error("No Teams found for this account");
    }
    return firstTeam["id"] as string;
  }

  // ------------- WorkspaceBase overrides -------------

  @CaptureSpan()
  public static override async getUsernameFromUserId(data: {
    authToken: string;
    userId: string;
  }): Promise<string | null> {
    const resp: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.get(
      URL.fromString(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(data.userId)}`,
      ),
      undefined,
      this.graphHeaders(data.authToken),
      {
        retries: 3,
        exponentialBackoff: true,
      },
    );
    if (resp instanceof HTTPErrorResponse) {
      return null;
    }
    const displayName: string | undefined = (resp.jsonData as JSONObject)[
      "displayName"
    ] as string;
    return displayName || null;
  }

  @CaptureSpan()
  public static override async getAllWorkspaceChannels(data: {
    authToken: string;
  }): Promise<Dictionary<WorkspaceChannel>> {
    const channels: Dictionary<WorkspaceChannel> = {};
    const teamId: string = await this.getTeamIdFromAuthToken(data.authToken);

    const resp: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.get(
      URL.fromString(`https://graph.microsoft.com/v1.0/teams/${teamId}/channels`),
      undefined,
      this.graphHeaders(data.authToken),
      {
        retries: 3,
        exponentialBackoff: true,
      },
    );

    if (resp instanceof HTTPErrorResponse) {
      throw resp;
    }

    for (const ch of ((resp.jsonData as JSONObject)["value"] || []) as Array<
      JSONObject
    >) {
      if (!ch["id"] || !ch["displayName"]) {
        continue;
      }
      const name: string = (ch["displayName"] as string).toString();
      channels[name] = {
        id: ch["id"] as string,
        name: name,
        workspaceType: WorkspaceType.MicrosoftTeams,
      };
    }
    return channels;
  }

  @CaptureSpan()
  public static override async doesChannelExist(data: {
    authToken: string;
    channelName: string;
  }): Promise<boolean> {
    const channels: Dictionary<WorkspaceChannel> =
      await this.getAllWorkspaceChannels({ authToken: data.authToken });
    return Boolean(channels[data.channelName]);
  }

  @CaptureSpan()
  public static override async createChannel(data: {
    authToken: string;
    channelName: string;
  }): Promise<WorkspaceChannel> {
    const teamId: string = await this.getTeamIdFromAuthToken(data.authToken);
    const body: JSONObject = {
      displayName: data.channelName,
      description: data.channelName,
      membershipType: "standard",
    } as unknown as JSONObject;

    const resp: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.post(
      URL.fromString(`https://graph.microsoft.com/v1.0/teams/${teamId}/channels`),
      body,
      this.graphHeaders(data.authToken),
      {
        retries: 3,
        exponentialBackoff: true,
      },
    );
    if (resp instanceof HTTPErrorResponse) {
      throw resp;
    }
    const id: string | undefined = (resp.jsonData as JSONObject)["id"] as
      | string
      | undefined;
    if (!id) {
      throw new Error("Channel creation failed");
    }
    return {
      id: id,
      name: data.channelName,
      workspaceType: WorkspaceType.MicrosoftTeams,
    };
  }

  @CaptureSpan()
  public static override async getWorkspaceChannelFromChannelName(data: {
    authToken: string;
    channelName: string;
  }): Promise<WorkspaceChannel> {
    const channels: Dictionary<WorkspaceChannel> =
      await this.getAllWorkspaceChannels({ authToken: data.authToken });
    const ch: WorkspaceChannel | undefined = channels[data.channelName];
    if (!ch) {
      throw new Error("Channel not found");
    }
    return ch;
  }

  @CaptureSpan()
  public static override async getWorkspaceChannelFromChannelId(data: {
    authToken: string;
    channelId: string;
  }): Promise<WorkspaceChannel> {
    const teamId: string = await this.getTeamIdFromAuthToken(data.authToken);
    const resp: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.get(
      URL.fromString(
        `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${data.channelId}`,
      ),
      undefined,
      this.graphHeaders(data.authToken),
      {
        retries: 3,
        exponentialBackoff: true,
      },
    );
    if (resp instanceof HTTPErrorResponse) {
      throw resp;
    }
    const name: string | undefined = (resp.jsonData as JSONObject)[
      "displayName"
    ] as string;
    return {
      id: data.channelId,
      name: name || data.channelId,
      workspaceType: WorkspaceType.MicrosoftTeams,
    };
  }

  @CaptureSpan()
  public static override async inviteUserToChannelByChannelId(data: {
    authToken: string;
    channelId: string;
    workspaceUserId: string;
  }): Promise<void> {
    const teamId: string = await this.getTeamIdFromAuthToken(data.authToken);
    const body: JSONObject = {
      "@odata.type": "#microsoft.graph.aadUserConversationMember",
      roles: [],
      "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${data.workspaceUserId}')`,
    } as unknown as JSONObject;

    // API: POST /teams/{team-id}/channels/{channel-id}/members
    const resp: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.post(
      URL.fromString(
        `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${data.channelId}/members`,
      ),
      body,
      this.graphHeaders(data.authToken),
      {
        retries: 3,
        exponentialBackoff: true,
      },
    );
    if (resp instanceof HTTPErrorResponse) {
      // Ignore if user already a member (409 conflict) or insufficient permission
      if (resp.statusCode !== 409) {
        throw resp;
      }
    }
  }

  @CaptureSpan()
  public static override async inviteUserToChannelByChannelName(data: {
    authToken: string;
    channelName: string;
    workspaceUserId: string;
  }): Promise<void> {
    const channel: WorkspaceChannel = await this.getWorkspaceChannelFromChannelName({
      authToken: data.authToken,
      channelName: data.channelName,
    });

    return this.inviteUserToChannelByChannelId({
      authToken: data.authToken,
      channelId: channel.id,
      workspaceUserId: data.workspaceUserId,
    });
  }

  @CaptureSpan()
  public static override async createChannelsIfDoesNotExist(data: {
    authToken: string;
    channelNames: Array<string>;
  }): Promise<Array<WorkspaceChannel>> {
    const channels: Array<WorkspaceChannel> = [];

    for (const channelName of data.channelNames) {
      const channelExists: boolean = await this.doesChannelExist({
        authToken: data.authToken,
        channelName: channelName,
      });

      let channel: WorkspaceChannel;
      if (channelExists) {
        channel = await this.getWorkspaceChannelFromChannelName({
          authToken: data.authToken,
          channelName: channelName,
        });
      } else {
        channel = await this.createChannel({
          authToken: data.authToken,
          channelName: channelName,
        });
      }
      
      channels.push(channel);
    }

    return channels;
  }

  @CaptureSpan()
  public static override async joinChannel(data: {
    authToken: string;
    channelId: string;
  }): Promise<void> {
    // In Teams, there's no separate "join" action for channels.
    // Channels are either public (accessible) or private (require invitation).
    // This is a no-op for Teams integration.
    logger.debug(`Teams joinChannel called - no action needed for channel ${data.channelId}`);
  }

  @CaptureSpan()
  public static override async archiveChannels(data: {
    userId: string;
    channelIds: Array<string>;
    authToken: string;
    sendMessageBeforeArchiving: WorkspacePayloadMarkdown;
  }): Promise<void> {
    // Teams doesn't have the same archive functionality as Slack
    // Instead, we'll send a final message and then leave the channel
    for (const channelId of data.channelIds) {
      try {
        // Send farewell message
        const channel: WorkspaceChannel = await this.getWorkspaceChannelFromChannelId({
          authToken: data.authToken,
          channelId: channelId,
        });

        await this.sendPayloadBlocksToChannel({
          authToken: data.authToken,
          workspaceChannel: channel,
          blocks: [
            {
              text: {
                text: data.sendMessageBeforeArchiving.text || "This channel is being archived.",
                type: "markdown",
              },
            },
          ],
        });

        logger.debug(`Sent farewell message to Teams channel ${channelId}`);
      } catch (err) {
        logger.error(`Failed to archive Teams channel ${channelId}: ${(err as Error).message}`);
      }
    }
  }

  @CaptureSpan()
  public static override async sendDirectMessageToUser(data: {
    authToken: string;
    workspaceUserId: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
  }): Promise<void> {
    // Teams Graph API doesn't have direct messaging like Slack
    // Instead, we can create a chat conversation
    const chatBody: JSONObject = {
      chatType: "oneOnOne",
      members: [
        {
          "@odata.type": "#microsoft.graph.aadUserConversationMember",
          roles: ["owner"],
          "user@odata.bind": `https://graph.microsoft.com/v1.0/me`,
        },
        {
          "@odata.type": "#microsoft.graph.aadUserConversationMember",
          roles: ["owner"], 
          "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${data.workspaceUserId}')`,
        },
      ],
    };

    // Create chat
    const chatResp: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.post(
      URL.fromString("https://graph.microsoft.com/v1.0/chats"),
      chatBody,
      this.graphHeaders(data.authToken),
      {
        retries: 3,
        exponentialBackoff: true,
      },
    );

    if (chatResp instanceof HTTPErrorResponse) {
      throw chatResp;
    }

    const chatId: string | undefined = (chatResp.jsonData as JSONObject)["id"] as string;
    if (!chatId) {
      throw new Error("Failed to create chat");
    }

    // Send message to chat - extract text content from blocks
    const messageTexts: Array<string> = [];
    for (const block of data.messageBlocks) {
      if ((block as any).text) {
        messageTexts.push((block as any).text);
      }
    }
    const messageText: string = messageTexts.join("\n\n");

    const messageBody: JSONObject = {
      body: {
        contentType: "html",
        content: messageText.replace(/\n/g, "<br/>"),
      },
    };

    await API.post(
      URL.fromString(`https://graph.microsoft.com/v1.0/chats/${chatId}/messages`),
      messageBody,
      this.graphHeaders(data.authToken),
      {
        retries: 3,
        exponentialBackoff: true,
      },
    );
  }

  @CaptureSpan()
  public static override async showModalToUser(data: {
    authToken: string;
    triggerId: string;
    modalBlock: WorkspaceModalBlock;
  }): Promise<void> {
    // Teams doesn't have the same modal concept as Slack
    // This would need to be implemented using Adaptive Cards and Bot Framework
    logger.debug(`Teams showModalToUser implementation for trigger ${data.triggerId}`);
    // For now, we'll just log the modal request without throwing an error
  }

  @CaptureSpan()
  public static override async isUserInDirectMessageChannel(_data: {
    authToken: string;
    userId: string;
    directMessageChannelId: string;
  }): Promise<boolean> {
    // Teams doesn't have the same DM channel concept as Slack
    // All one-on-one conversations are chats, not channels
    return false;
  }

  @CaptureSpan()
  public static override async isUserInChannel(_data: {
    authToken: string;
    channelId: string;
    userId: string;
  }): Promise<boolean> {
    // Graph requires listing channel members and comparing. For now, return true to avoid blocking posts.
    return true;
  }

  @CaptureSpan()
  public static override async sendPayloadBlocksToChannel(data: {
    authToken: string;
    workspaceChannel: WorkspaceChannel;
    blocks: Array<JSONObject>;
  }): Promise<WorkspaceThread> {
    const teamId: string = await this.getTeamIdFromAuthToken(data.authToken);
    logger.debug("Teams sendPayloadBlocksToChannel: raw blocks:");
    logger.debug(JSON.stringify(data.blocks, null, 2));

    // Build HTML content from blocks. We expect block shapes produced by getMarkdownBlock/getHeaderBlock etc.
    const texts: Array<string> = [];
    for (const block of data.blocks) {
      try {
        const b: JSONObject = block as JSONObject;
        // Standard Adaptive Card-like TextBlock shape: { type: 'TextBlock', text: '...' }
        if (typeof b["text"] === "string") {
          const val: string = (b["text"] as string).trim();
            if (val) {
              texts.push(this.convertMarkdownToTeamsHTMLIfNeeded(val));
            }
          continue;
        }
        // Fallback nested case: { text: { text: '...' } }
        if (b["text"] && typeof b["text"] === "object") {
          const inner: unknown = (b["text"] as JSONObject)["text"];
          if (typeof inner === "string" && inner.trim()) {
            texts.push(this.convertMarkdownToTeamsHTMLIfNeeded(inner.trim()));
          }
        }
      } catch (err) {
        logger.error("Error parsing Teams block text: " + (err as Error).message);
      }
    }

    let content: string = texts.join("<br/><br/>");
    if (!content || content.trim().length === 0) {
      content = "(No content)"; // Avoid Graph 400 "Missing body content"
    }

    logger.debug("Teams sendPayloadBlocksToChannel: final HTML content:");
    logger.debug(content);
    const body: JSONObject = {
      body: {
        contentType: "html",
        content: content,
      },
    } as unknown as JSONObject;

    const resp: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.post(
      URL.fromString(
        `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${data.workspaceChannel.id}/messages`,
      ),
      body,
      this.graphHeaders(data.authToken),
      {
        retries: 3,
        exponentialBackoff: true,
      },
    );
    if (resp instanceof HTTPErrorResponse) {
      logger.error("Teams sendPayloadBlocksToChannel: error response from Graph API");
      logger.error(resp);
      throw resp;
    }
    const messageId: string | undefined = (resp.jsonData as JSONObject)["id"] as string | undefined;
    if (!messageId) {
      logger.error("Teams sendPayloadBlocksToChannel: message ID missing in Graph response");
    } else {
      logger.debug(`Teams sendPayloadBlocksToChannel: message posted. ID: ${messageId}`);
    }
    return { channel: data.workspaceChannel, threadId: messageId || "" };
  }

  @CaptureSpan()
  public static override async sendMessage(data: {
    workspaceMessagePayload: WorkspaceMessagePayload;
    authToken: string;
    userId: string;
  }): Promise<WorkspaceSendMessageResponse> {
    const blocks: Array<JSONObject> = this.getBlocksFromWorkspaceMessagePayload(
      data.workspaceMessagePayload,
    );

    const existingWorkspaceChannels: Dictionary<WorkspaceChannel> =
      await this.getAllWorkspaceChannels({ authToken: data.authToken });

    const workspaceChannelsToPostTo: Array<WorkspaceChannel> = [];

    // Helper to sanitize channel name similar to Slack normalization
    const sanitizeChannelName = (name: string): string => {
      return name
        .trim()
        .replace(/^#/, "") // remove leading '#'
        .replace(/\s+/g, "-") // spaces to dashes
        .toLowerCase();
    };

    const requestedChannelNames: Array<string> = data.workspaceMessagePayload.channelNames || [];
    logger.debug(
      `MicrosoftTeamsUtil.sendMessage requested channel names (raw): ${JSON.stringify(requestedChannelNames)}`,
    );

    for (let channelName of requestedChannelNames) {
      const sanitized: string = sanitizeChannelName(channelName);
      const directMatch: WorkspaceChannel | undefined = existingWorkspaceChannels[channelName];
      const sanitizedMatch: WorkspaceChannel | undefined = existingWorkspaceChannels[sanitized];

      if (directMatch) {
        workspaceChannelsToPostTo.push(directMatch);
        logger.debug(
          `Matched Teams channel by direct name '${channelName}' -> id: ${directMatch.id}`,
        );
      } else if (sanitizedMatch) {
        workspaceChannelsToPostTo.push(sanitizedMatch);
        logger.debug(
          `Matched Teams channel by sanitized name '${sanitized}' (original '${channelName}') -> id: ${sanitizedMatch.id}`,
        );
      } else {
        logger.error(
          `Teams channel not found for requested name '${channelName}' (sanitized '${sanitized}'). Available channels: ${Object.keys(existingWorkspaceChannels).join(",")}`,
        );
      }
    }

    for (const channelId of data.workspaceMessagePayload.channelIds) {
      try {
        const ch: WorkspaceChannel = await this.getWorkspaceChannelFromChannelId({
          authToken: data.authToken,
          channelId: channelId,
        });
        workspaceChannelsToPostTo.push(ch);
        logger.debug(
          `Matched Teams channel by ID '${channelId}' -> name: ${ch.name}`,
        );
      } catch (err) {
        logger.error(
          `Unable to resolve Teams channel id '${channelId}': ${(err as Error).message}`,
        );
      }
    }

    const response: WorkspaceSendMessageResponse = {
      threads: [],
      workspaceType: WorkspaceType.MicrosoftTeams,
    };

    for (const ch of workspaceChannelsToPostTo) {
      try {
        const thread: WorkspaceThread = await this.sendPayloadBlocksToChannel({
          authToken: data.authToken,
          workspaceChannel: ch,
          blocks: blocks,
        });
        response.threads.push(thread);
      } catch (err) {
        logger.error(err);
      }
    }

    return response;
  }
}


