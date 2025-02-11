export interface WorkspacePayloadBlocks {
  _type: string;
}

export interface WorkspaceNotificationPayloadButton {
  title: string; // Button title.
}

export interface WorkspacePayloadHeader extends WorkspacePayloadBlocks {
  _type: "WorkspacePayloadHeader";
  text: string;
}

export interface WorkspacePayloadMarkdown extends WorkspacePayloadBlocks {
  _type: "WorkspacePayloadMarkdown";
  text: string;
}

export interface WorkspacePayloadButtons extends WorkspacePayloadBlocks {
  _type: "WorkspacePayloadButtons";
  buttons: Array<WorkspaceNotificationPayloadButton>;
}

export default interface WorkspaceNotificationPayload {
  _type: "WorkspaceNotificationPayload";
  channelNames: Array<string>; // which channels to post to.
  blocks: Array<WorkspacePayloadBlocks>; // Buttons to add to the message.
  createChannelsIfItDoesNotExist: boolean; // Should we create the channels if they don't exist.
}
