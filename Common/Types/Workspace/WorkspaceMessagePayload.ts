export interface WorkspaceMessageBlock {
  _type: string;
}

export interface WorkspaceMessagePayloadButton {
  title: string; // Button title.
}

export interface WorkspacePayloadHeader extends WorkspaceMessageBlock {
  _type: "WorkspacePayloadHeader";
  text: string;
}

export interface WorkspacePayloadMarkdown extends WorkspaceMessageBlock {
  _type: "WorkspacePayloadMarkdown";
  text: string;
}

export interface WorkspacePayloadButtons extends WorkspaceMessageBlock {
  _type: "WorkspacePayloadButtons";
  buttons: Array<WorkspaceMessagePayloadButton>;
}

export default interface WorkspaceMessagePayload {
  _type: "WorkspaceMessagePayload";
  channelNames: Array<string>; // which channels to post to.
  channelIds: Array<string>; // If you know the channel IDs, you can provide them here.
  messageBlocks: Array<WorkspaceMessageBlock>; // Message to add to blocks. 
  createChannelsIfItDoesNotExist: boolean; // Should we create the channels if they don't exist.
}
