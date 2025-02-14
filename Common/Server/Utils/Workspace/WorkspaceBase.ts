import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Dictionary from "../../../Types/Dictionary";
import NotImplementedException from "../../../Types/Exception/NotImplementedException";
import { JSONObject } from "../../../Types/JSON";
import WorkspaceChannelInvitationPayload from "../../../Types/Workspace/WorkspaceChannelInvitationPayload";
import WorkspaceMessagePayload, { WorkspaceMessagePayloadButton, WorkspacePayloadButtons, WorkspacePayloadHeader, WorkspacePayloadMarkdown } from "../../../Types/Workspace/WorkspaceMessagePayload";
import logger from "../Logger";

export interface WorkspaceChannel {
    id: string;
    name: string;
}

export default class WorkspaceBase {
    public static async inviteUsersToChannels(_data: {
        authToken: string;
        workspaceChannelInvitationPayload: WorkspaceChannelInvitationPayload;
    }): Promise<void> {
        throw new NotImplementedException();
    }

    public static async inviteUsersToChannel(_data: {
        authToken: string;
        channelName: string;
        userIds: Array<string>;
    }): Promise<void> {
        throw new NotImplementedException();
    }


    public static async inviteUserToChannel(_data: {
        public: string;
        channelName: string;
        userId: string;
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