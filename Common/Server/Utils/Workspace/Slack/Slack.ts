import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import API from "../../../../Utils/API";
import WorkspaceMessagePayload, {
  WorkspaceCheckboxBlock,
  WorkspaceDateTimePickerBlock,
  WorkspaceDropdownBlock,
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspaceModalBlock,
  WorkspacePayloadButtons,
  WorkspacePayloadHeader,
  WorkspacePayloadImage,
  WorkspacePayloadMarkdown,
  WorkspaceTextAreaBlock,
  WorkspaceTextBoxBlock,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import logger from "../../Logger";
import Dictionary from "../../../../Types/Dictionary";
import BadRequestException from "../../../../Types/Exception/BadRequestException";
import WorkspaceBase, {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "../WorkspaceBase";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import SlackifyMarkdown from "slackify-markdown";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import OneUptimeDate from "../../../../Types/Date";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";

export default class SlackUtil extends WorkspaceBase {
  public static isValidSlackIncomingWebhookUrl(
    incomingWebhookUrl: URL,
  ): boolean {
    // check if the URL starts with https://hooks.slack.com/services/
    return incomingWebhookUrl
      .toString()
      .startsWith("https://hooks.slack.com/services/");
  }

  @CaptureSpan()
  public static override async getUsernameFromUserId(data: {
    authToken: string;
    userId: string;
    projectId: ObjectID;
  }): Promise<string | null> {
    logger.debug("Getting username from user ID with data:");
    logger.debug(data);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>({
        url: URL.fromString("https://slack.com/api/users.info"),
        data: {
          user: data.userId,
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    logger.debug("Response from Slack API for getting user info:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:");
      logger.error(response);
      throw response;
    }

    // check for ok response
    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:");
      logger.error(response.jsonData);
      return null;
    }

    if (
      !((response.jsonData as JSONObject)?.["user"] as JSONObject)?.["name"]
    ) {
      logger.error("Invalid response from Slack API:");
      logger.error(response.jsonData);
      return null;
    }

    const username: string = (
      (response.jsonData as JSONObject)["user"] as JSONObject
    )["name"] as string;

    logger.debug("Username obtained:");
    logger.debug(username);
    return username;
  }

  @CaptureSpan()
  public static override async showModalToUser(data: {
    authToken: string;
    triggerId: string;
    modalBlock: WorkspaceModalBlock;
  }): Promise<void> {
    logger.debug("Showing modal to user with data:");
    logger.debug(data);

    const modalJson: JSONObject = this.getModalBlock({
      payloadModalBlock: data.modalBlock,
    });

    logger.debug("Modal JSON generated:");
    logger.debug(JSON.stringify(modalJson, null, 2));

    // use view.open API to show modal
    const result: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.post(
      {
        url: URL.fromString("https://slack.com/api/views.open"),
        data: {
          trigger_id: data.triggerId,
          view: modalJson,
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/json",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      },
    );

    if (result instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:");
      logger.error(result);
      throw result;
    }

    if ((result.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:");
      logger.error(result.jsonData);
      const messageFromSlack: string = (result.jsonData as JSONObject)?.[
        "error"
      ] as string;
      throw new BadRequestException("Error from Slack " + messageFromSlack);
    }

    logger.debug("Modal shown to user successfully.");
  }

  @CaptureSpan()
  public static override async sendDirectMessageToUser(data: {
    authToken: string;
    workspaceUserId: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
  }): Promise<void> {
    // Send direct message to user

    const blocks: Array<JSONObject> = this.getBlocksFromWorkspaceMessagePayload(
      {
        messageBlocks: data.messageBlocks,
      },
    );

    await this.sendPayloadBlocksToChannel({
      authToken: data.authToken,
      workspaceChannel: {
        id: data.workspaceUserId,
        name: "",
        workspaceType: WorkspaceType.Slack,
      },
      blocks: blocks,
    });
  }

  @CaptureSpan()
  public static override async archiveChannels(data: {
    userId: string;
    channelIds: Array<string>;
    authToken: string;
    sendMessageBeforeArchiving: WorkspacePayloadMarkdown;
    projectId: ObjectID;
  }): Promise<void> {
    if (data.sendMessageBeforeArchiving) {
      await this.sendMessage({
        workspaceMessagePayload: {
          _type: "WorkspaceMessagePayload",
          channelNames: [],
          channelIds: data.channelIds,
          messageBlocks: [data.sendMessageBeforeArchiving],
          workspaceType: WorkspaceType.Slack,
        },
        authToken: data.authToken,
        userId: data.userId,
        projectId: data.projectId,
      });
    }

    logger.debug("Archiving channels with data:");
    logger.debug(data);

    for (const channelId of data.channelIds) {
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post({
          url: URL.fromString("https://slack.com/api/conversations.archive"),
          data: {
            channel: channelId,
          },
          headers: {
            Authorization: `Bearer ${data.authToken}`,
            ["Content-Type"]: "application/x-www-form-urlencoded",
          },
          options: {
            retries: 3,
            exponentialBackoff: true,
          },
        });

      logger.debug("Response from Slack API for archiving channel:");
      logger.debug(response);

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Slack API:");
        logger.error(response);
        throw response;
      }

      if ((response.jsonData as JSONObject)?.["ok"] !== true) {
        logger.error("Invalid response from Slack API:");
        logger.error(response.jsonData);
        const messageFromSlack: string = (response.jsonData as JSONObject)?.[
          "error"
        ] as string;
        throw new BadRequestException("Error from Slack " + messageFromSlack);
      }
    }

    logger.debug("Channels archived successfully.");
  }

  @CaptureSpan()
  public static override async joinChannel(data: {
    authToken: string;
    channelId: string;
  }): Promise<void> {
    logger.debug("Joining channel with data:");
    logger.debug(data);

    // Join channel
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString("https://slack.com/api/conversations.join"),
        data: {
          channel: data.channelId,
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    logger.debug("Response from Slack API for joining channel:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:");
      logger.error(response);
      throw response;
    }

    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:");
      logger.error(response.jsonData);
      const messageFromSlack: string = (response.jsonData as JSONObject)?.[
        "error"
      ] as string;
      throw new BadRequestException("Error from Slack " + messageFromSlack);
    }

    logger.debug("Channel joined successfully with data:");
    logger.debug(data);
  }

  @CaptureSpan()
  public static override async inviteUserToChannelByChannelId(data: {
    authToken: string;
    channelId: string;
    workspaceUserId: string;
  }): Promise<void> {
    // check if already in channel.
    const isUserInChannel: boolean = await this.isUserInChannel({
      authToken: data.authToken,
      channelId: data.channelId,
      userId: data.workspaceUserId,
    });

    if (isUserInChannel) {
      logger.debug("User already in channel.");
      return;
    }

    logger.debug("Inviting user to channel with data:");
    logger.debug(data);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString("https://slack.com/api/conversations.invite"),
        data: {
          channel: data.channelId,
          users: data.workspaceUserId,
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    logger.debug("Response from Slack API for inviting user:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:");
      logger.error(response);
      throw response;
    }

    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:");
      logger.error(response.jsonData);
      const messageFromSlack: string = (response.jsonData as JSONObject)?.[
        "error"
      ] as string;
      throw new BadRequestException("Error from Slack " + messageFromSlack);
    }

    logger.debug("User invited to channel successfully.");
  }

  @CaptureSpan()
  public static override async inviteUserToChannelByChannelName(data: {
    authToken: string;
    channelName: string;
    workspaceUserId: string;
    projectId: ObjectID;
  }): Promise<void> {
    if (data.channelName && data.channelName.startsWith("#")) {
      // trim # from channel name
      data.channelName = data.channelName.substring(1);
    }

    logger.debug("Inviting user to channel with data:");
    logger.debug(data);

    const channelId: string = (
      await this.getWorkspaceChannelFromChannelName({
        authToken: data.authToken,
        channelName: data.channelName,
        projectId: data.projectId,
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
    projectId: ObjectID;
  }): Promise<Array<WorkspaceChannel>> {
    logger.debug("Creating channels if they do not exist with data:");
    logger.debug(data);

    const workspaceChannels: Array<WorkspaceChannel> = [];

    for (let channelName of data.channelNames) {
      // Normalize channel name
      if (channelName && channelName.startsWith("#")) {
        channelName = channelName.substring(1);
      }
      channelName = channelName.toLowerCase();
      channelName = channelName.replace(/\s+/g, "-");

      // Check if channel exists using optimized method
      const existingChannel: WorkspaceChannel | null =
        await this.getWorkspaceChannelByName({
          authToken: data.authToken,
          channelName: channelName,
          projectId: data.projectId,
        });

      if (existingChannel) {
        logger.debug(`Channel ${channelName} already exists.`);
        workspaceChannels.push(existingChannel);
        continue;
      }

      logger.debug(`Channel ${channelName} does not exist. Creating channel.`);
      const channel: WorkspaceChannel = await this.createChannel({
        authToken: data.authToken,
        channelName: channelName,
        projectId: data.projectId,
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
    projectId: ObjectID;
  }): Promise<WorkspaceChannel> {
    logger.debug("Getting workspace channel ID from channel name with data:");
    logger.debug(data);

    const channel: WorkspaceChannel | null =
      await this.getWorkspaceChannelByName({
        authToken: data.authToken,
        channelName: data.channelName,
        projectId: data.projectId,
      });

    if (!channel) {
      logger.error("Channel not found.");
      throw new BadDataException("Channel not found.");
    }

    logger.debug("Workspace channel obtained:");
    logger.debug(channel);

    return channel;
  }

  @CaptureSpan()
  public static override async getWorkspaceChannelFromChannelId(data: {
    authToken: string;
    channelId: string;
  }): Promise<WorkspaceChannel> {
    logger.debug("Getting workspace channel from channel ID with data:");
    logger.debug(data);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>({
        url: URL.fromString("https://slack.com/api/conversations.info"),
        data: {
          channel: data.channelId,
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    logger.debug("Response from Slack API for getting channel info:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:");
      logger.error(response);
      throw response;
    }

    // check for ok response
    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:");
      logger.error(response.jsonData);
      const messageFromSlack: string = (response.jsonData as JSONObject)?.[
        "error"
      ] as string;
      throw new BadRequestException("Error from Slack " + messageFromSlack);
    }

    if (
      !((response.jsonData as JSONObject)?.["channel"] as JSONObject)?.["name"]
    ) {
      logger.error("Invalid response from Slack API:");
      logger.error(response.jsonData);
      throw new Error("Invalid response");
    }

    const channel: WorkspaceChannel = {
      name: ((response.jsonData as JSONObject)["channel"] as JSONObject)[
        "name"
      ] as string,
      id: data.channelId,
      workspaceType: WorkspaceType.Slack,
    };

    logger.debug("Workspace channel obtained:");
    logger.debug(channel);
    return channel;
  }

  @CaptureSpan()
  public static override async getAllWorkspaceChannels(data: {
    authToken: string;
    projectId: ObjectID;
  }): Promise<Dictionary<WorkspaceChannel>> {
    logger.debug("Getting all workspace channels with data:");
    logger.debug(data);

    const channels: Dictionary<WorkspaceChannel> = {};
    let cursor: string | undefined = undefined;
    const maxPages: number = 100;
    let pageCount: number = 0;
    const localChannelCache: Dictionary<any> = {};

    do {
      const requestBody: JSONObject = {
        limit: 999,
        types: "public_channel,private_channel",
        exclude_archived: true,
      };

      if (cursor) {
        requestBody["cursor"] = cursor;
      }

      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString("https://slack.com/api/conversations.list"),
          data: requestBody,
          headers: {
            Authorization: `Bearer ${data.authToken}`,
            ["Content-Type"]: "application/x-www-form-urlencoded",
          },
          options: {
            retries: 3,
            exponentialBackoff: true,
          },
        });

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Slack API:");
        logger.error(response);
        throw response;
      }

      // check for ok response
      if ((response.jsonData as JSONObject)?.["ok"] !== true) {
        logger.error("Invalid response from Slack API:");
        logger.error(response.jsonData);
        const messageFromSlack: string = (response.jsonData as JSONObject)?.[
          "error"
        ] as string;
        throw new BadRequestException("Error from Slack " + messageFromSlack);
      }

      for (const channel of (response.jsonData as JSONObject)[
        "channels"
      ] as Array<JSONObject>) {
        if (!channel["id"] || !channel["name"]) {
          continue;
        }

        const channelObj: WorkspaceChannel = {
          id: channel["id"] as string,
          name: channel["name"] as string,
          workspaceType: WorkspaceType.Slack,
        };

        channels[channel["name"].toString()] = channelObj;

        // Add to local cache
        const normalizedName: string = channel["name"].toString().toLowerCase();
        localChannelCache[normalizedName] = {
          id: channel["id"] as string,
          name: channel["name"] as string,
          workspaceType: WorkspaceType.Slack,
          lastUpdated: OneUptimeDate.toString(OneUptimeDate.getCurrentDate()),
        };
      }

      cursor = (
        (response.jsonData as JSONObject)["response_metadata"] as JSONObject
      )?.["next_cursor"] as string;
      pageCount++;
    } while (cursor && pageCount < maxPages);

    // Update cache in bulk
    try {
      await this.updateChannelsInCache({
        projectId: data.projectId,
        channelCache: localChannelCache,
      });
    } catch (error) {
      logger.error("Error bulk updating channel cache:");
      logger.error(error);
      // Don't fail the request if caching fails
    }

    logger.debug("All workspace channels obtained:");
    return channels;
  }

  private static async updateChannelsInCache(data: {
    projectId: ObjectID;
    channelCache: Dictionary<WorkspaceChannel>;
  }): Promise<void> {
    const projectAuth: any =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.Slack,
      });

    if (!projectAuth) {
      logger.debug("No project auth found, cannot update cache");
      return;
    }

    const miscData: any = projectAuth.miscData || {};
    const channelCache: any = miscData.channelCache || {};

    // Update the cache
    Object.assign(channelCache, data.channelCache);

    // Update miscData
    miscData.channelCache = channelCache;

    // Save back to database
    await WorkspaceProjectAuthTokenService.refreshAuthToken({
      projectId: data.projectId,
      workspaceType: WorkspaceType.Slack,
      authToken: projectAuth.authToken,
      workspaceProjectId: projectAuth.workspaceProjectId,
      miscData: miscData,
    });

    logger.debug("Channel cache updated successfully");
  }

  @CaptureSpan()
  public static async getChannelFromCache(data: {
    projectId: ObjectID;
    channelName: string;
  }): Promise<WorkspaceChannel | null> {
    logger.debug("Getting channel from cache with data:");
    logger.debug(data);

    const projectAuth: any =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.Slack,
      });

    if (!projectAuth || !projectAuth.miscData) {
      logger.debug("No project auth found or no misc data");
      return null;
    }

    const miscData: any = projectAuth.miscData;
    const channelCache: any = miscData.channelCache;

    if (!channelCache || !channelCache[data.channelName]) {
      logger.debug("Channel not found in cache");
      return null;
    }

    const cachedChannelData: WorkspaceChannel = channelCache[
      data.channelName
    ] as WorkspaceChannel;
    const channel: WorkspaceChannel = {
      id: cachedChannelData.id,
      name: cachedChannelData.name,
      workspaceType: WorkspaceType.Slack,
    };

    logger.debug("Channel found in cache:");
    logger.debug(channel);
    return channel;
  }
  @CaptureSpan()
  public static async updateChannelCache(data: {
    projectId: ObjectID;
    channelName: string;
    channel: WorkspaceChannel;
  }): Promise<void> {
    logger.debug("Updating channel cache with data:");
    logger.debug(data);

    const projectAuth: any =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.Slack,
      });

    if (!projectAuth) {
      logger.debug("No project auth found, cannot update cache");
      return;
    }

    const miscData: any = projectAuth.miscData || {};
    const channelCache: any = miscData.channelCache || {};

    // Update the cache
    channelCache[data.channelName] = {
      id: data.channel.id,
      name: data.channel.name,
      lastUpdated: OneUptimeDate.toString(OneUptimeDate.getCurrentDate()),
    };

    // Update miscData
    miscData.channelCache = channelCache;

    // Save back to database
    await WorkspaceProjectAuthTokenService.refreshAuthToken({
      projectId: data.projectId,
      workspaceType: WorkspaceType.Slack,
      authToken: projectAuth.authToken,
      workspaceProjectId: projectAuth.workspaceProjectId,
      miscData: miscData,
    });

    logger.debug("Channel cache updated successfully");
  }

  @CaptureSpan()
  public static async getWorkspaceChannelByName(data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
  }): Promise<WorkspaceChannel | null> {
    logger.debug("Getting workspace channel by name with data:");
    logger.debug(data);

    // Normalize channel name
    let normalizedChannelName: string = data.channelName;
    if (normalizedChannelName && normalizedChannelName.startsWith("#")) {
      normalizedChannelName = normalizedChannelName.substring(1);
    }
    normalizedChannelName = normalizedChannelName.toLowerCase();

    // Try to get from cache first
    try {
      const cachedChannel: WorkspaceChannel | null =
        await this.getChannelFromCache({
          projectId: data.projectId,
          channelName: normalizedChannelName,
        });
      if (cachedChannel) {
        logger.debug("Channel found in cache:");
        logger.debug(cachedChannel);
        return cachedChannel;
      }
    } catch (error) {
      logger.error("Error getting channel from cache, falling back to API:");
      logger.error(error);
    }

    let cursor: string | undefined = undefined;
    const maxPages: number = 500;
    let pageCount: number = 0;
    const localChannelCache: Dictionary<any> = {};

    do {
      const requestBody: JSONObject = {
        limit: 999, // Use smaller limit for faster searches
        types: "public_channel,private_channel",
        exclude_archived: true,
      };

      if (cursor) {
        requestBody["cursor"] = cursor;
      }

      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString("https://slack.com/api/conversations.list"),
          data: requestBody,
          headers: {
            Authorization: `Bearer ${data.authToken}`,
            ["Content-Type"]: "application/x-www-form-urlencoded",
          },
          options: {
            retries: 3,
            exponentialBackoff: true,
          },
        });

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Slack API:");
        logger.error(response);
        throw response;
      }

      // check for ok response
      if ((response.jsonData as JSONObject)?.["ok"] !== true) {
        logger.error("Invalid response from Slack API:");
        logger.error(response.jsonData);
        const messageFromSlack: string = (response.jsonData as JSONObject)?.[
          "error"
        ] as string;
        throw new BadRequestException("Error from Slack " + messageFromSlack);
      }

      logger.debug("Searching for " + normalizedChannelName);
      logger.debug("Searching channels in current page...");
      logger.debug(
        JSON.stringify((response.jsonData as JSONObject)["channels"], null, 2),
      );

      for (const channel of (response.jsonData as JSONObject)[
        "channels"
      ] as Array<JSONObject>) {
        if (!channel["id"] || !channel["name"]) {
          continue;
        }

        const channelObj: WorkspaceChannel = {
          id: channel["id"] as string,
          name: channel["name"] as string,
          workspaceType: WorkspaceType.Slack,
        };

        // Add to local cache
        const normalizedName: string = channel["name"].toString().toLowerCase();
        localChannelCache[normalizedName] = {
          id: channel["id"] as string,
          name: channel["name"] as string,
          workspaceType: WorkspaceType.Slack,
          lastUpdated: OneUptimeDate.toString(OneUptimeDate.getCurrentDate()),
        };

        const channelName: string = (channel["name"] as string).toLowerCase();
        if (channelName === normalizedChannelName) {
          logger.debug("Channel found:");
          logger.debug(channel);

          // Update cache before returning
          try {
            await this.updateChannelsInCache({
              projectId: data.projectId,
              channelCache: localChannelCache,
            });
          } catch (error) {
            logger.error("Error bulk updating channel cache:");
            logger.error(error);
            // Don't fail the request if caching fails
          }

          return channelObj;
        }
      }

      cursor = (
        (response.jsonData as JSONObject)["response_metadata"] as JSONObject
      )?.["next_cursor"] as string;
      pageCount++;
    } while (cursor && pageCount < maxPages);

    // Update cache even if channel not found
    try {
      await this.updateChannelsInCache({
        projectId: data.projectId,
        channelCache: localChannelCache,
      });
    } catch (error) {
      logger.error("Error bulk updating channel cache:");
      logger.error(error);
      // Don't fail the request if caching fails
    }

    logger.debug("Channel not found:");
    return null;
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

    const slackView: JSONObject = data.view;
    const values: Dictionary<string | number | Array<string | number> | Date> =
      {};

    if (!slackView["state"] || !(slackView["state"] as JSONObject)["values"]) {
      return {};
    }

    for (const valueId in (slackView["state"] as JSONObject)[
      "values"
    ] as JSONObject) {
      for (const blockId in (
        (slackView["state"] as JSONObject)["values"] as JSONObject
      )[valueId] as JSONObject) {
        const valueObject: JSONObject = (
          (slackView["state"] as JSONObject)["values"] as JSONObject
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
  public static override async doesChannelExist(data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
  }): Promise<boolean> {
    // if channel name starts with #, remove it
    if (data.channelName && data.channelName.startsWith("#")) {
      data.channelName = data.channelName.substring(1);
    }

    // convert channel name to lowercase
    data.channelName = data.channelName.toLowerCase();

    // Check if channel exists using optimized method
    const channel: WorkspaceChannel | null =
      await this.getWorkspaceChannelByName({
        authToken: data.authToken,
        channelName: data.channelName,
        projectId: data.projectId,
      });

    return channel !== null;
  }

  @CaptureSpan()
  public static override async sendMessage(data: {
    workspaceMessagePayload: WorkspaceMessagePayload;
    authToken: string; // which auth token should we use to send.
    userId: string;
    projectId: ObjectID;
  }): Promise<WorkspaceSendMessageResponse> {
    logger.debug("Sending message to Slack with data:");
    logger.debug(data);

    const blocks: Array<JSONObject> = this.getBlocksFromWorkspaceMessagePayload(
      data.workspaceMessagePayload,
    );

    logger.debug("Blocks generated from workspace message payload:");
    logger.debug(blocks);

    const workspaceChannelsToPostTo: Array<WorkspaceChannel> = [];

    // Resolve channel names efficiently
    for (let channelName of data.workspaceMessagePayload.channelNames) {
      if (channelName && channelName.startsWith("#")) {
        // trim # from channel name
        channelName = channelName.substring(1);
      }

      const channel: WorkspaceChannel | null =
        await this.getWorkspaceChannelByName({
          authToken: data.authToken,
          channelName: channelName,
          projectId: data.projectId,
        });

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
          workspaceType: WorkspaceType.Slack,
        };

        workspaceChannelsToPostTo.push(channel);
      }
    }

    logger.debug("Channel IDs to post to:");
    logger.debug(workspaceChannelsToPostTo);

    const workspaspaceMessageResponse: WorkspaceSendMessageResponse = {
      threads: [],
      workspaceType: WorkspaceType.Slack,
      errors: [],
    };

    for (const channel of workspaceChannelsToPostTo) {
      try {
        if (data.userId) {
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
        }

        const thread: WorkspaceThread = await this.sendPayloadBlocksToChannel({
          authToken: data.authToken,
          workspaceChannel: channel,
          blocks: blocks,
        });

        workspaspaceMessageResponse.threads.push(thread);

        logger.debug(`Message sent to channel ID ${channel.id} successfully.`);
      } catch (e) {
        logger.error(`Error sending message to channel ID ${channel.id}:`);
        logger.error(e);
        workspaspaceMessageResponse.errors!.push({
          channel: channel,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    logger.debug("Message sent successfully.");
    logger.debug(workspaspaceMessageResponse);

    return workspaspaceMessageResponse;
  }

  @CaptureSpan()
  public static override async sendPayloadBlocksToChannel(data: {
    authToken: string;
    workspaceChannel: WorkspaceChannel;
    blocks: Array<JSONObject>;
  }): Promise<WorkspaceThread> {
    logger.debug("Sending payload blocks to channel with data:");
    logger.debug(JSON.stringify(data, null, 2));

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString("https://slack.com/api/chat.postMessage"),
        data: {
          channel: data.workspaceChannel.id,
          blocks: data.blocks,
          unfurl_links: false,
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/json",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    logger.debug("Response from Slack API for sending message:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:");
      logger.error(response);
      throw response;
    }

    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:");
      logger.error(response.jsonData);
      const messageFromSlack: string = (response.jsonData as JSONObject)?.[
        "error"
      ] as string;
      throw new BadRequestException("Error from Slack " + messageFromSlack);
    }

    logger.debug("Payload blocks sent to channel successfully.");

    return {
      channel: data.workspaceChannel,
      threadId: (response.jsonData as JSONObject)["ts"] as string,
    };
  }

  @CaptureSpan()
  public static async sendMessageToThread(data: {
    authToken: string;
    channelId: string;
    threadTs: string;
    text: string;
  }): Promise<void> {
    logger.debug("Sending message to thread with data:");
    logger.debug(data);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString("https://slack.com/api/chat.postMessage"),
        data: {
          channel: data.channelId,
          thread_ts: data.threadTs,
          text: data.text,
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/json",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    logger.debug("Response from Slack API for sending thread message:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:");
      logger.error(response);
      throw response;
    }

    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:");
      logger.error(response.jsonData);
      const messageFromSlack: string = (response.jsonData as JSONObject)?.[
        "error"
      ] as string;
      throw new BadRequestException("Error from Slack " + messageFromSlack);
    }

    logger.debug("Thread message sent successfully.");
  }

  @CaptureSpan()
  public static async getMessageByTimestamp(data: {
    authToken: string;
    channelId: string;
    messageTs: string;
  }): Promise<string | null> {
    logger.debug("Getting message by timestamp with data:");
    logger.debug(data);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString("https://slack.com/api/conversations.history"),
        data: {
          channel: data.channelId,
          latest: data.messageTs,
          oldest: data.messageTs,
          inclusive: true,
          limit: 1,
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    logger.debug("Response from Slack API for getting message:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:");
      logger.error(response);
      throw response;
    }

    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:");
      logger.error(response.jsonData);
      const messageFromSlack: string = (response.jsonData as JSONObject)?.[
        "error"
      ] as string;
      throw new BadRequestException("Error from Slack " + messageFromSlack);
    }

    const messages: Array<JSONObject> = (response.jsonData as JSONObject)?.[
      "messages"
    ] as Array<JSONObject>;

    if (!messages || messages.length === 0) {
      logger.debug("No messages found for timestamp.");
      return null;
    }

    const messageText: string | undefined = messages[0]?.["text"] as string;

    logger.debug("Message text retrieved:");
    logger.debug(messageText);

    return messageText || null;
  }

  @CaptureSpan()
  public static override getButtonsBlock(data: {
    payloadButtonsBlock: WorkspacePayloadButtons;
  }): JSONObject {
    logger.debug("Getting buttons block with data:");
    logger.debug(data);

    const buttonsBlock: JSONObject = {
      type: "actions",
      elements: data.payloadButtonsBlock.buttons.map(
        (button: WorkspaceMessagePayloadButton) => {
          return this.getButtonBlock({ payloadButtonBlock: button });
        },
      ),
    };

    logger.debug("Buttons block generated:");
    logger.debug(buttonsBlock);
    return buttonsBlock;
  }

  @CaptureSpan()
  public static override async createChannel(data: {
    authToken: string;
    channelName: string;
    projectId: ObjectID;
  }): Promise<WorkspaceChannel> {
    if (data.channelName && data.channelName.startsWith("#")) {
      data.channelName = data.channelName.substring(1);
    }

    // lower case channel name
    data.channelName = data.channelName.toLowerCase();

    logger.debug("Creating channel with data:");
    logger.debug(data);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post({
        url: URL.fromString("https://slack.com/api/conversations.create"),
        data: {
          name: data.channelName,
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    logger.debug("Response from Slack API for creating channel:");
    logger.debug(response);

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:");
      logger.error(response);
      throw response;
    }

    // check for ok response
    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:");
      logger.error(response.jsonData);
      const messageFromSlack: string = (response.jsonData as JSONObject)?.[
        "error"
      ] as string;
      throw new BadRequestException("Error from Slack " + messageFromSlack);
    }

    if (
      !((response.jsonData as JSONObject)?.["channel"] as JSONObject)?.["id"] ||
      !((response.jsonData as JSONObject)?.["channel"] as JSONObject)?.["name"]
    ) {
      logger.error("Invalid response from Slack API:");
      logger.error(response.jsonData);
      throw new Error("Invalid response");
    }

    const channel: WorkspaceChannel = {
      id: ((response.jsonData as JSONObject)["channel"] as JSONObject)[
        "id"
      ] as string,
      name: ((response.jsonData as JSONObject)["channel"] as JSONObject)[
        "name"
      ] as string,
      workspaceType: WorkspaceType.Slack,
    };

    logger.debug("Channel created successfully:");
    logger.debug(channel);

    // Cache the created channel
    try {
      const localCache: Dictionary<any> = {};
      localCache[data.channelName] = {
        id: channel.id,
        name: channel.name,
        workspaceType: WorkspaceType.Slack,
        lastUpdated: OneUptimeDate.toString(OneUptimeDate.getCurrentDate()),
      };
      await this.updateChannelsInCache({
        projectId: data.projectId,
        channelCache: localCache,
      });
    } catch (error) {
      logger.error("Error caching created channel:");
      logger.error(error);
      // Don't fail the creation if caching fails
    }

    return channel;
  }

  @CaptureSpan()
  public static override getHeaderBlock(data: {
    payloadHeaderBlock: WorkspacePayloadHeader;
  }): JSONObject {
    logger.debug("Getting header block with data:");
    logger.debug(data);

    const headerBlock: JSONObject = {
      type: "header",
      text: {
        type: "plain_text",
        text: data.payloadHeaderBlock.text,
      },
    };

    logger.debug("Header block generated:");
    logger.debug(headerBlock);
    return headerBlock;
  }

  @CaptureSpan()
  public static override getCheckboxBlock(data: {
    payloadCheckboxBlock: WorkspaceCheckboxBlock;
  }): JSONObject {
    logger.debug("Getting checkbox block with data:");
    logger.debug(data);

    const checkboxBlock: JSONObject = {
      type: "input",
      element: {
        type: "checkboxes",
        action_id: data.payloadCheckboxBlock.blockId,
        options: [
          {
            text: {
              type: "plain_text",
              text: data.payloadCheckboxBlock.label,
            },
            value: "value",
          },
        ],
        initial_options: data.payloadCheckboxBlock.initialValue
          ? [
              {
                text: {
                  type: "plain_text",
                  text: data.payloadCheckboxBlock.label,
                },
                value: "value",
              },
            ]
          : undefined,
      },
      label: {
        type: "plain_text",
        text: data.payloadCheckboxBlock.label,
      },
    };

    // if description then add hint.

    if (data.payloadCheckboxBlock.description) {
      checkboxBlock["hint"] = {
        type: "plain_text",
        text: data.payloadCheckboxBlock.description,
      };
    }

    logger.debug("Checkbox block generated:");
    logger.debug(checkboxBlock);
    return checkboxBlock;
  }

  @CaptureSpan()
  public static override getDateTimePickerBlock(data: {
    payloadDateTimePickerBlock: WorkspaceDateTimePickerBlock;
  }): JSONObject {
    logger.debug("Getting date time picker block with data:");
    logger.debug(data);

    const dateTimePickerBlock: JSONObject = {
      type: "input",
      element: {
        type: "datetimepicker",
        action_id: data.payloadDateTimePickerBlock.blockId,
        initial_date: data.payloadDateTimePickerBlock.initialValue,
      },
      label: {
        type: "plain_text",
        text: data.payloadDateTimePickerBlock.label,
      },
    };

    logger.debug("Date time picker block generated:");
    logger.debug(dateTimePickerBlock);
    return dateTimePickerBlock;
  }

  @CaptureSpan()
  public static override getTextAreaBlock(data: {
    payloadTextAreaBlock: WorkspaceTextAreaBlock;
  }): JSONObject {
    logger.debug("Getting text area block with data:");
    logger.debug(data);

    const optional: boolean = data.payloadTextAreaBlock.optional || false;

    const textAreaBlock: JSONObject = {
      type: "input",
      optional: optional,
      element: {
        type: "plain_text_input",
        multiline: true,
        action_id: data.payloadTextAreaBlock.blockId,
        placeholder: {
          type: "plain_text",
          text: data.payloadTextAreaBlock.placeholder,
        },
        initial_value: data.payloadTextAreaBlock.initialValue,
      },
      label: {
        type: "plain_text",
        text: data.payloadTextAreaBlock.label,
      },
    };

    // if description then add hint.

    if (data.payloadTextAreaBlock.description) {
      textAreaBlock["hint"] = {
        type: "plain_text",
        text: data.payloadTextAreaBlock.description,
      };
    }

    logger.debug("Text area block generated:");
    logger.debug(textAreaBlock);
    return textAreaBlock;
  }

  @CaptureSpan()
  public static override getTextBoxBlock(data: {
    payloadTextBoxBlock: WorkspaceTextBoxBlock;
  }): JSONObject {
    logger.debug("Getting text box block with data:");
    logger.debug(data);

    const optional: boolean = data.payloadTextBoxBlock.optional || false;

    const textBoxBlock: JSONObject = {
      type: "input",
      optional: optional,
      element: {
        type: "plain_text_input",
        action_id: data.payloadTextBoxBlock.blockId,
        placeholder: {
          type: "plain_text",
          text: data.payloadTextBoxBlock.placeholder,
        },
        initial_value: data.payloadTextBoxBlock.initialValue,
      },
      label: {
        type: "plain_text",
        text: data.payloadTextBoxBlock.label,
      },
    };

    // if description then add hint.

    if (data.payloadTextBoxBlock.description) {
      textBoxBlock["hint"] = {
        type: "plain_text",
        text: data.payloadTextBoxBlock.description,
      };
    }

    logger.debug("Text box block generated:");
    logger.debug(textBoxBlock);
    return textBoxBlock;
  }

  @CaptureSpan()
  public static override getImageBlock(data: {
    payloadImageBlock: WorkspacePayloadImage;
  }): JSONObject {
    logger.debug("Getting image block with data:");
    logger.debug(data);

    const imageBlock: JSONObject = {
      type: "image",
      image_url: data.payloadImageBlock.imageUrl.toString(),
      alt_text: data.payloadImageBlock.altText,
    };

    logger.debug("Image block generated:");
    logger.debug(imageBlock);
    return imageBlock;
  }

  @CaptureSpan()
  public static override getDropdownBlock(data: {
    payloadDropdownBlock: WorkspaceDropdownBlock;
  }): JSONObject {
    logger.debug("Getting dropdown block with data:");
    logger.debug(data);

    const optional: boolean = data.payloadDropdownBlock.optional || false;

    const isMiltiSelect: boolean =
      data.payloadDropdownBlock.multiSelect || false;

    const dropdownBlock: JSONObject = {
      type: "input",
      optional: optional,
      element: {
        type: isMiltiSelect ? "multi_static_select" : "static_select",
        action_id: data.payloadDropdownBlock.blockId,
        placeholder: {
          type: "plain_text",
          text: data.payloadDropdownBlock.placeholder,
        },
        options: data.payloadDropdownBlock.options.map(
          (option: DropdownOption) => {
            return {
              text: {
                type: "plain_text",
                text: option.label,
              },
              value: option.value,
            };
          },
        ),
        initial_option: data.payloadDropdownBlock.initialValue
          ? {
              text: {
                type: "plain_text",
                text: data.payloadDropdownBlock.initialValue,
              },
              value: data.payloadDropdownBlock.initialValue,
            }
          : undefined,
      },

      label: {
        type: "plain_text",
        text: data.payloadDropdownBlock.label,
      },
    };

    // if description then add hint.

    if (data.payloadDropdownBlock.description) {
      dropdownBlock["hint"] = {
        type: "plain_text",
        text: data.payloadDropdownBlock.description,
      };
    }

    logger.debug("Dropdown block generated:");
    logger.debug(dropdownBlock);
    return dropdownBlock;
  }

  @CaptureSpan()
  public static override getModalBlock(data: {
    payloadModalBlock: WorkspaceModalBlock;
  }): JSONObject {
    logger.debug("Getting modal block with data:");
    logger.debug(data);

    const modalBlock: JSONObject = {
      type: "modal",
      title: {
        type: "plain_text",
        text: data.payloadModalBlock.title,
      },
      callback_id: data.payloadModalBlock.actionId,
      private_metadata: data.payloadModalBlock.actionValue,
      submit: {
        type: "plain_text",
        text: data.payloadModalBlock.submitButtonTitle,
      },
      close: {
        type: "plain_text",
        text: data.payloadModalBlock.cancelButtonTitle,
      },
      blocks: this.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: data.payloadModalBlock.blocks,
      }),
    };

    logger.debug("Modal block generated:");
    logger.debug(modalBlock);
    return modalBlock;
  }

  @CaptureSpan()
  public static override getMarkdownBlock(data: {
    payloadMarkdownBlock: WorkspacePayloadMarkdown;
  }): JSONObject {
    logger.debug("Getting markdown block with data:");
    logger.debug(data);

    const markdownBlock: JSONObject = {
      type: "section",
      text: {
        type: "mrkdwn",
        text: data.payloadMarkdownBlock.text
          ? SlackifyMarkdown(data.payloadMarkdownBlock.text)
          : "",
      },
    };

    logger.debug("Markdown block generated:");
    logger.debug(markdownBlock);
    return markdownBlock;
  }

  @CaptureSpan()
  public static override async isUserInDirectMessageChannel(data: {
    authToken: string;
    userId: string;
    directMessageChannelId: string;
  }): Promise<boolean> {
    // check of the user id is in the direct message channel id
    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post({
        url: URL.fromString("https://slack.com/api/conversations.info"),
        data: {
          channel: data.directMessageChannelId,
        },
        headers: {
          Authorization: `Bearer ${data.authToken}`,
          ["Content-Type"]: "application/x-www-form-urlencoded",
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    if (response instanceof HTTPErrorResponse) {
      logger.error("Error response from Slack API:");
      logger.error(response);
      throw response;
    }

    // check for ok response

    if ((response.jsonData as JSONObject)?.["ok"] !== true) {
      logger.error("Invalid response from Slack API:");
      logger.error(response.jsonData);
      const messageFromSlack: string = (response.jsonData as JSONObject)?.[
        "error"
      ] as string;
      throw new BadRequestException("Error from Slack " + messageFromSlack);
    }

    // check if the user is in the channel
    const user: JSONObject = (
      (response.jsonData as JSONObject)["channel"] as JSONObject
    )["user"] as JSONObject;

    if (user?.["user_id"]?.toString() === data.userId.toString()) {
      return true;
    }

    return false;
  }

  @CaptureSpan()
  public static override async isUserInChannel(data: {
    authToken: string;
    channelId: string;
    userId: string;
  }): Promise<boolean> {
    const members: Array<string> = [];

    logger.debug("Checking if user is in channel with data:");
    logger.debug(data);

    let cursor: string | undefined = undefined;

    do {
      // check if the user is in the channel, return true if they are, false if they are not

      const requestBody: JSONObject = {
        channel: data.channelId,
        limit: 999,
      };

      if (cursor) {
        requestBody["cursor"] = cursor;
      }

      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString("https://slack.com/api/conversations.members"),
          data: requestBody,
          headers: {
            Authorization: `Bearer ${data.authToken}`,
            ["Content-Type"]: "application/x-www-form-urlencoded",
          },
          options: {
            retries: 3,
            exponentialBackoff: true,
          },
        });

      logger.debug("Response from Slack API for getting channel members:");
      logger.debug(response);

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Slack API:");
        logger.error(response);
        throw response;
      }

      // check for ok response

      if ((response.jsonData as JSONObject)?.["ok"] !== true) {
        logger.error("Invalid response from Slack API:");
        logger.error(response.jsonData);
        const messageFromSlack: string = (response.jsonData as JSONObject)?.[
          "error"
        ] as string;
        throw new BadRequestException("Error from Slack " + messageFromSlack);
      }

      // check if the user is in the channel
      const membersOnThisPage: Array<string> = (
        response.jsonData as JSONObject
      )["members"] as Array<string>;

      members.push(...membersOnThisPage);

      cursor = (
        (response.jsonData as JSONObject)["response_metadata"] as JSONObject
      )?.["next_cursor"] as string;
    } while (cursor);

    if (members.includes(data.userId)) {
      return true;
    }

    return false;
  }

  @CaptureSpan()
  public static override getButtonBlock(data: {
    payloadButtonBlock: WorkspaceMessagePayloadButton;
  }): JSONObject {
    logger.debug("Getting button block with data:");
    logger.debug(data);

    const buttonBlock: JSONObject = {
      type: "button",
      text: {
        type: "plain_text",
        text: data.payloadButtonBlock.title,
        emoji: true,
      },
      value: data.payloadButtonBlock.value,
      action_id: data.payloadButtonBlock.actionId,
      url: data.payloadButtonBlock.url
        ? data.payloadButtonBlock.url.toString()
        : undefined,
    };

    logger.debug("Button block generated:");
    logger.debug(buttonBlock);
    return buttonBlock;
  }

  @CaptureSpan()
  public static override async sendMessageToChannelViaIncomingWebhook(data: {
    url: URL;
    text: string;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    logger.debug("Sending message to channel via incoming webhook with data:");
    logger.debug(data);

    const apiResult: HTTPResponse<JSONObject> | HTTPErrorResponse | null =
      await API.post({
        url: data.url,
        data: {
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `${data.text}`,
              },
            },
          ],
        },
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    logger.debug("Response from Slack API for sending message via webhook:");
    logger.debug(apiResult);
    return apiResult;
  }

  /**
   * Converts markdown tables to a Slack-friendly format.
   * Since Slack's mrkdwn doesn't support tables, we convert them to
   * a row-by-row format with bold headers.
   */
  private static convertMarkdownTablesToSlackFormat(markdown: string): string {
    // Regular expression to match markdown tables
    const tableRegex: RegExp =
      /(?:^|\n)((?:\|[^\n]+\|\n)+(?:\|[-:\s|]+\|\n)(?:\|[^\n]+\|\n?)+)/g;

    return markdown.replace(
      tableRegex,
      (_match: string, table: string): string => {
        const lines: Array<string> = table.trim().split("\n");

        if (lines.length < 2) {
          return table;
        }

        // Parse header row
        const headerLine: string = lines[0] || "";
        const headers: Array<string> = headerLine
          .split("|")
          .map((cell: string) => {
            return cell.trim();
          })
          .filter((cell: string) => {
            return cell.length > 0;
          });

        /*
         * Skip separator line (line with dashes)
         * Find data rows (skip header and separator)
         */
        const dataRows: Array<string> = lines.slice(2);
        const formattedRows: Array<string> = [];

        for (let rowIndex: number = 0; rowIndex < dataRows.length; rowIndex++) {
          const row: string = dataRows[rowIndex] || "";
          const cells: Array<string> = row
            .split("|")
            .map((cell: string) => {
              return cell.trim();
            })
            .filter((cell: string) => {
              return cell.length > 0;
            });

          if (cells.length === 0) {
            continue;
          }

          const rowParts: Array<string> = [];
          for (
            let cellIndex: number = 0;
            cellIndex < cells.length;
            cellIndex++
          ) {
            const header: string =
              headers[cellIndex] || `Column ${cellIndex + 1}`;
            const value: string = cells[cellIndex] || "";
            rowParts.push(`*${header}:* ${value}`);
          }

          if (dataRows.length > 1) {
            formattedRows.push(`_Row ${rowIndex + 1}_\n${rowParts.join("\n")}`);
          } else {
            formattedRows.push(rowParts.join("\n"));
          }
        }

        return "\n" + formattedRows.join("\n\n") + "\n";
      },
    );
  }

  @CaptureSpan()
  public static convertMarkdownToSlackRichText(markdown: string): string {
    // First convert tables to Slack-friendly format
    const markdownWithConvertedTables: string =
      this.convertMarkdownTablesToSlackFormat(markdown);
    return SlackifyMarkdown(markdownWithConvertedTables);
  }

  @CaptureSpan()
  public static async getChannelMessages(params: {
    channelId: string;
    authToken: string;
    limit?: number;
    oldestTimestamp?: Date;
  }): Promise<
    Array<{
      messageId: string;
      text: string;
      userId?: string;
      username?: string;
      timestamp: Date;
      isBot: boolean;
    }>
  > {
    const messages: Array<{
      messageId: string;
      text: string;
      userId?: string;
      username?: string;
      timestamp: Date;
      isBot: boolean;
    }> = [];
    let cursor: string | undefined = undefined;
    const maxMessages: number = params.limit || 1000;
    const maxPages: number = 10;
    let pageCount: number = 0;

    do {
      const requestData: JSONObject = {
        channel: params.channelId,
        limit: Math.min(200, maxMessages - messages.length),
      };

      if (cursor) {
        requestData["cursor"] = cursor;
      }

      if (params.oldestTimestamp) {
        requestData["oldest"] = (
          params.oldestTimestamp.getTime() / 1000
        ).toString();
      }

      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString("https://slack.com/api/conversations.history"),
          data: requestData,
          headers: {
            Authorization: `Bearer ${params.authToken}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          options: {
            retries: 3,
            exponentialBackoff: true,
          },
        });

      if (response instanceof HTTPErrorResponse) {
        logger.error("Error response from Slack API for channel history:");
        logger.error(response);
        break;
      }

      const jsonData: JSONObject = response.jsonData as JSONObject;

      if (jsonData["ok"] !== true) {
        logger.error("Invalid response from Slack API for channel history:");
        logger.error(jsonData);
        break;
      }

      const slackMessages: Array<JSONObject> =
        (jsonData["messages"] as Array<JSONObject>) || [];

      for (const msg of slackMessages) {
        // Skip bot messages if they're from the OneUptime bot (app messages)
        const isBot: boolean =
          Boolean(msg["bot_id"]) || msg["subtype"] === "bot_message";

        // Extract text, handling attachments and blocks
        let text: string = (msg["text"] as string) || "";

        // If there are attachments, append their text
        const attachments: Array<JSONObject> | undefined = msg[
          "attachments"
        ] as Array<JSONObject> | undefined;
        if (attachments && Array.isArray(attachments)) {
          for (const attachment of attachments) {
            if (attachment && attachment["text"]) {
              text += "\n" + (attachment["text"] as string);
            }
            if (attachment && attachment["fallback"]) {
              text += "\n" + (attachment["fallback"] as string);
            }
          }
        }

        // Skip empty messages
        if (!text.trim()) {
          continue;
        }

        const timestamp: Date = msg["ts"]
          ? new Date(parseFloat(msg["ts"] as string) * 1000)
          : new Date();

        messages.push({
          messageId: msg["ts"] as string,
          text: text,
          userId: msg["user"] as string,
          username: msg["username"] as string,
          timestamp: timestamp,
          isBot: isBot,
        });
      }

      cursor = (jsonData["response_metadata"] as JSONObject)?.[
        "next_cursor"
      ] as string;
      pageCount++;
    } while (cursor && messages.length < maxMessages && pageCount < maxPages);

    logger.debug(
      `Retrieved ${messages.length} messages from Slack channel ${params.channelId}`,
    );

    // Reverse to get chronological order (Slack returns newest first)
    messages.reverse();

    return messages;
  }
}
