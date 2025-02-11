export interface WorkspacePayloadBlock {
  _type: string;
}

export interface WorkspaceNotificationPayloadButton {
  title: string; // Button title.
}

export interface WorkspacePayloadHeader extends WorkspacePayloadBlock {
  _type: "WorkspacePayloadHeader";
  text: string;
}

export interface WorkspacePayloadMarkdown extends WorkspacePayloadBlock {
  _type: "WorkspacePayloadMarkdown";
  text: string;
}

export interface WorkspacePayloadButtons extends WorkspacePayloadBlock {
  _type: "WorkspacePayloadButtons";
  buttons: Array<WorkspaceNotificationPayloadButton>;
}

export default interface WorkspaceNotificationPayload {
  _type: "WorkspaceNotificationPayload";
  channelNames: Array<string>; // which channels to post to.
  channelIds: Array<string>; // If you know the channel IDs, you can provide them here.
  messageBlocks: Array<WorkspacePayloadBlock>; // Message to add to blocks. 
  createChannelsIfItDoesNotExist: boolean; // Should we create the channels if they don't exist.
}
