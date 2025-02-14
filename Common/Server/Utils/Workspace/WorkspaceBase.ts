import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Dictionary from "../../../Types/Dictionary";
import NotImplementedException from "../../../Types/Exception/NotImplementedException";
import { JSONObject } from "../../../Types/JSON";
import WorkspaceChannelInvitationPayload from "../../../Types/Workspace/WorkspaceChannelInvitationPayload";
import WorkspaceMessagePayload, {
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadHeader,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import logger from "../Logger";
import URL from "Common/Types/API/URL";

export interface WorkspaceChannel {
  id: string;
  name: string;
}

export default class WorkspaceBase {
  public static async sendPayloadBlocksToChannel(_data: {
    authToken: string;
    channelId: string;
    blocks: Array<JSONObject>;
  }): Promise<void> {
    throw new NotImplementedException();
  }

  public static async inviteUsersToChannels(data: {
      authToken: string;
      workspaceChannelInvitationPayload: WorkspaceChannelInvitationPayload;
    }): Promise<void> {
      for (const channelName of data.workspaceChannelInvitationPayload
        .workspaceChannelNames) {
        await this.inviteUsersToChannel({
          authToken: data.authToken,
          channelName: channelName,
          workspaceUserIds:
            data.workspaceChannelInvitationPayload.workspaceUserIds,
        });
      }
    }
  
    public static async inviteUsersToChannel(data: {
      authToken: string;
      channelName: string;
      workspaceUserIds: Array<string>;
    }): Promise<void> {
      for (const userId of data.workspaceUserIds) {
        await this.inviteUserToChannel({
          authToken: data.authToken,
          channelName: data.channelName,
          workspaceUserId: userId,
        });
      }
    }

  public static async inviteUserToChannel(_data: {
    authToken: string;
    channelName: string;
    workspaceUserId: string;
  }): Promise<void> {
    throw new NotImplementedException();
  }

  public static async createChannelsIfDoesNotExist(_data: {
    authToken: string;
    channelNames: Array<string>;
  }): Promise<Array<WorkspaceChannel>> {
    throw new NotImplementedException();
  }

  public static async getWorkspaceChannelFromChannelId(_data: {
    authToken: string;
    channelId: string;
  }): Promise<WorkspaceChannel> {
    throw new NotImplementedException();
  }

  public static async sendMessage(_data: {
    workspaceMessagePayload: WorkspaceMessagePayload;
    authToken: string; // which auth token should we use to send.
  }): Promise<void> {
    throw new NotImplementedException();
  }

  public static async getAllWorkspaceChannels(_data: {
    authToken: string;
  }): Promise<Dictionary<WorkspaceChannel>> {
    throw new NotImplementedException();
  }

  public static async createChannel(_data: {
    authToken: string;
    channelName: string;
  }): Promise<WorkspaceChannel> {
    throw new NotImplementedException();
  }

  public static getHeaderBlock(_data: {
    payloadHeaderBlock: WorkspacePayloadHeader;
  }): JSONObject {
    throw new NotImplementedException();
  }

  public static getMarkdownBlock(_data: {
    payloadMarkdownBlock: WorkspacePayloadMarkdown;
  }): JSONObject {
    throw new NotImplementedException();
  }

  public static getButtonBlock(_data: {
    payloadButtonBlock: WorkspaceMessagePayloadButton;
  }): JSONObject {
    throw new NotImplementedException();
  }

  public static getBlocksFromWorkspaceMessagePayload(
    data: WorkspaceMessagePayload,
  ): Array<JSONObject> {
    const blocks: Array<JSONObject> = [];
    const buttons: Array<JSONObject> = [];
    for (const block of data.messageBlocks) {
      switch (block._type) {
        case "WorkspacePayloadHeader":
          blocks.push(
            this.getHeaderBlock({
              payloadHeaderBlock: block as WorkspacePayloadHeader,
            }),
          );
          break;
        case "WorkspacePayloadMarkdown":
          blocks.push(
            this.getMarkdownBlock({
              payloadMarkdownBlock: block as WorkspacePayloadMarkdown,
            }),
          );
          break;
        case "WorkspacePayloadButtons":
          for (const button of (block as WorkspacePayloadButtons).buttons) {
            buttons.push(
              this.getButtonBlock({
                payloadButtonBlock: button,
              }),
            );
          }
          blocks.push({
            type: "actions",
            elements: buttons,
          });
          break;
        default:
          logger.error("Unknown block type: " + block._type);
          break;
      }
    }
    return blocks;
  }

  public static async sendMessageToChannelViaIncomingWebhook(_data: {
    url: URL;
    text: string;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    throw new NotImplementedException();
  }
}
