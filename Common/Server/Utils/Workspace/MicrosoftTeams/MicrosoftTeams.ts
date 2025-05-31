import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import API from "../../../../Utils/API";
import WorkspaceMessagePayload, { WorkspaceMessagePayloadButton } from "../../../../Types/Workspace/WorkspaceMessagePayload"; // Added WorkspaceMessagePayloadButton
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
  public static override getButtonBlock(data: { payloadButtonBlock: WorkspaceMessagePayloadButton }): JSONObject {
    const { payloadButtonBlock } = data;

    // Prioritize Action.OpenUrl if a URL is present
    if (payloadButtonBlock.url) {
      return {
        type: "Action.OpenUrl",
        title: payloadButtonBlock.title,
        url: payloadButtonBlock.url.toString(),
      };
    }

    // Otherwise, create an Action.Execute button
    let actionData: JSONObject = {};
    if (payloadButtonBlock.value && typeof payloadButtonBlock.value === 'string') {
      try {
        actionData = JSON.parse(payloadButtonBlock.value) as JSONObject;
      } catch (e) {
        logger.warn(
          `MicrosoftTeams: Could not parse JSON from payloadButtonBlock.value for actionId: ${payloadButtonBlock.actionId}. Value: ${payloadButtonBlock.value}. Error: ${e}`
        );
        // actionData remains {}
      }
    } else if (payloadButtonBlock.value) {
        logger.warn(
            `MicrosoftTeams: payloadButtonBlock.value is not a string for actionId: ${payloadButtonBlock.actionId}. Value: ${payloadButtonBlock.value}. It will not be parsed into action data.`
        );
    }


    const actionExecuteButton: JSONObject = {
      type: "Action.Execute",
      title: payloadButtonBlock.title,
      id: payloadButtonBlock.actionId, // This should be the string id like "acknowledgeAlert" or "resolveAlert"
    };

    // Only add the data property if it's not empty, or if the schema requires it.
    // Adaptive Cards are generally tolerant of an empty data object.
    if (Object.keys(actionData).length > 0) {
        actionExecuteButton['data'] = actionData;
    } else {
        // If actionData is empty, we can still pass an empty object if required by downstream handlers,
        // or omit it. For Action.Execute, an empty data object is often fine.
        actionExecuteButton['data'] = {}; 
    }
    

    return actionExecuteButton;
  }


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
      type: "divider", // This is for Slack. Teams uses { "type": "Separator" } in Adaptive Cards.
                       // This method might need to be context-aware or the caller should handle the difference.
                       // For now, assuming this is a generic representation. If this class is purely for Teams, it should be:
                       // return { type: "Separator" };
    };
  }

  @CaptureSpan()
  public static getValuesFromView(data: {
    view: JSONObject;
  }): Dictionary<string | number | Array<string | number> | Date> {
    logger.debug("Getting values from view with data:");
    logger.debug(JSON.stringify(data, null, 2));

    const teamsView: JSONObject = data.view; // This likely refers to Teams Task Module submit data
    const values: Dictionary<string | number | Array<string | number> | Date> =
      {};

    // For Teams, the submitted data from a Task Module (Adaptive Card) is directly in teamsView.data or teamsView itself if it's just the data object
    // The structure `teamsView["state"]["values"]` is specific to Slack Modals.
    // Assuming teamsView is the data object from the card submission (e.g., req.body.data in a task/submit invoke)
    
    if (teamsView && typeof teamsView === 'object') {
        for(const key in teamsView){
            if(Object.prototype.hasOwnProperty.call(teamsView, key)){
                 // Basic assignment. Dates or specific types might need parsing based on conventions.
                values[key] = teamsView[key] as string | number | Array<string | number> | Date;
            }
        }
    } else {
        logger.warn("MicrosoftTeams.getValuesFromView: Input 'view' is not in the expected format or is empty.");
        return {};
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
    authToken:string;
    channelId: string;
  }): Promise<WorkspaceChannel> {
    logger.debug("Getting workspace channel from channel ID with data:");
    logger.debug(data);

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.get<JSONObject>(
        URL.fromString(
          `https://graph.microsoft.com/v1.0/teams/${data.channelId}`, // This gets a Team, not a channel within a team
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
    
    // Assuming the ID provided is for a Team, and we want the 'General' channel by default or a specific one.
    // To get a specific channel, the endpoint is /teams/{team-id}/channels/{channel-id}
    // Or to list channels: /teams/{team-id}/channels
    // For simplicity, if data.channelId is a teamId, we might default to its primary channel if the API implies that.
    // However, the current structure implies data.channelId IS the channel. This needs clarification.
    // Let's assume data.channelId is a Team ID for now as per the endpoint.

    if (!(response.jsonData as JSONObject)?.["displayName"]) {
      logger.error("Invalid response from Microsoft Graph API (expected team display name):");
      logger.error(response.jsonData);
      throw new Error("Invalid response when fetching team details.");
    }

    // This currently returns a Team as a Channel. This might need refinement
    // if specific channels within a Team are to be targeted.
    const channel: WorkspaceChannel = {
      name: (response.jsonData as JSONObject)["displayName"] as string, // This is the Team name
      id: data.channelId, // This is the Team ID
      workspaceType: WorkspaceType.MicrosoftTeams,
    };

    logger.debug("Workspace channel (Team) obtained:");
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
    userId: string; // OneUptime User ID, may not be directly used for bot messages but useful for context/logging
  }): Promise<WorkspaceSendMessageResponse> {
    logger.debug("Sending message to Microsoft Teams with data:");
    logger.debug(data);

    // This method needs to be implemented to convert WorkspaceMessagePayload 
    // into an Adaptive Card JSON structure if it's not already.
    // For now, assuming getBlocksFromWorkspaceMessagePayload does this or prepares it.
    const adaptiveCardJson: JSONObject | null = this.getAdaptiveCardJsonFromWorkspaceMessagePayload(
      data.workspaceMessagePayload,
    );

    if(!adaptiveCardJson){
        logger.error("Could not generate Adaptive Card JSON from workspace message payload.");
        throw new BadDataException("Could not generate Adaptive Card JSON.");
    }

    logger.debug("Adaptive Card JSON generated:");
    logger.debug(JSON.stringify(adaptiveCardJson, null, 2));


    const existingWorkspaceChannels: Dictionary<WorkspaceChannel> =
      await this.getAllWorkspaceChannels({ // These are Teams, not channels within teams.
        authToken: data.authToken,
      });

    logger.debug("Existing workspace Teams (used as channels):");
    logger.debug(existingWorkspaceChannels);

    const workspaceChannelsToPostTo: Array<WorkspaceChannel> = []; // These will be actual Team IDs

    for (let teamName of data.workspaceMessagePayload.channelNames) { // Assuming channelNames are Team names
      if (teamName && teamName.startsWith("#")) {
        teamName = teamName.substring(1);
      }

      let teamAsChannel: WorkspaceChannel | null = null;

      if (existingWorkspaceChannels[teamName]) {
        teamAsChannel = existingWorkspaceChannels[teamName]!;
      }

      if (teamAsChannel) {
        workspaceChannelsToPostTo.push(teamAsChannel);
      } else {
        logger.debug(`Team (channel) ${teamName} does not exist or bot is not a member.`);
      }
    }

    // add channel ids (assuming these are Team IDs)
    for (const teamId of data.workspaceMessagePayload.channelIds) {
      const teamAsChannel: WorkspaceChannel = { // We might need to fetch actual team name if not already known
        id: teamId,
        name: teamId, // Placeholder, ideally fetch team name
        workspaceType: WorkspaceType.MicrosoftTeams,
      };
      workspaceChannelsToPostTo.push(teamAsChannel);
    }
    
    logger.debug("Team IDs to post to:");
    logger.debug(workspaceChannelsToPostTo.map(c => c.id));

    const workspaceMessageResponse: WorkspaceSendMessageResponse = {
      threads: [],
      workspaceType: WorkspaceType.MicrosoftTeams,
    };

    for (const team of workspaceChannelsToPostTo) { // Iterating through Teams
      try {
        // To send a message to a team, you typically send it to a specific channel within that team.
        // The Bot Framework usually handles this by having a conversationId that represents the channel.
        // If using Graph API directly to post to a channel: POST /teams/{team-id}/channels/{channel-id}/messages
        // This part of the code needs the actual channel ID within the team.
        // For now, this method will assume it needs to find/use the 'General' channel or rely on a pre-existing conversation.

        // This is a placeholder. Actual message sending to a team's channel requires a channelId.
        // The Bot Framework SDK abstracts this using serviceUrl and conversation.id.
        // If this is a direct Graph API call, we need a /teams/{team-id}/channels/{channel-id}/messages endpoint.
        // For now, let's assume sendPayloadToTeamChannel handles finding the right channel or uses a bot conversation.
        
        logger.warn(`MicrosoftTeams.sendMessage: Actual implementation for sending to Team ${team.id} general channel or specific channel is needed.`);
        // const thread: WorkspaceThread = await this.sendPayloadToTeamChannel({
        //   authToken: data.authToken, // This might be a bot token, not a user token
        //   teamId: team.id,
        //   adaptiveCardJson: adaptiveCardJson,
        // });
        // workspaceMessageResponse.threads.push(thread);
        // logger.debug(`Message sent to Team ID ${team.id} successfully.`);

      } catch (e) {
        logger.error(`Error sending message to Team ID ${team.id}:`);
        logger.error(e);
      }
    }

    logger.debug("Message sending process completed (actual sending might be pending implementation).");
    logger.debug(workspaceMessageResponse);

    return workspaceMessageResponse;
  }

  // Helper to structure the payload for Adaptive Cards
  // This method would ideally use the getButtonBlock for buttons
  @CaptureSpan()
  public static getAdaptiveCardJsonFromWorkspaceMessagePayload(
      payload: WorkspaceMessagePayload
  ): JSONObject | null {
      
      const adaptiveCard: JSONObject = {
          "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
          "type": "AdaptiveCard",
          "version": "1.5", // Use a recent version
          "body": [],
          "actions": []
      };

      // Convert WorkspaceMessageBlock to Adaptive Card elements
      for (const block of payload.blocks) {
          if (block._type === "WorkspacePayloadSection") {
              (adaptiveCard["body"] as Array<JSONObject>).push({
                  "type": "TextBlock",
                  "text": block.text,
                  "wrap": true // Ensure text wraps
              });
          } else if (block._type === "WorkspacePayloadDivider") {
               (adaptiveCard["body"] as Array<JSONObject>).push({
                  "type": "Separator" // Correct separator for Adaptive Cards
              });
          } else if (block._type === "WorkspacePayloadButtons") {
              for (const button of block.buttons) {
                  (adaptiveCard["actions"] as Array<JSONObject>).push(
                      this.getButtonBlock({ payloadButtonBlock: button })
                  );
              }
          } else if (block._type === "WorkspacePayloadFields") {
            // Fields could be represented as FactSet or ColumnSet
            const factSet: JSONObject = {
                "type": "FactSet",
                "facts": []
            };
            for(const field of block.fields){
                (factSet["facts"] as Array<JSONObject>).push({
                    "title": field.title,
                    "value": field.value
                });
            }
            (adaptiveCard["body"] as Array<JSONObject>).push(factSet);

          } else {
            logger.warn(`MicrosoftTeams: Unsupported WorkspaceMessageBlock type: ${block._type}`);
          }
      }
      
      // If there's a title, add it as a TextBlock at the beginning of the body
      if (payload.title) {
        (adaptiveCard["body"] as Array<JSONObject>).unshift({
            "type": "TextBlock",
            "text": payload.title,
            "weight": "Bolder", // Make title bold
            "size": "Medium", // Make title a bit larger
            "wrap": true
        });
      }


      // If there are no body elements and no actions, it's not a valid card.
      if ((adaptiveCard["body"] as Array<JSONObject>).length === 0 && (adaptiveCard["actions"] as Array<JSONObject>).length === 0) {
          logger.warn("MicrosoftTeams: Attempted to create an empty Adaptive Card.");
          return null; 
      }

      return adaptiveCard;
  }
}
