export interface WorkspaceMessageBlock {
  _type: string;
  onlyPostToTheseChannelNames?: Array<string>; 
}

export interface WorkspaceMessagePayloadButton {
  title: string; // Button title.
  onlyPostToTheseChannelNames?: Array<string>; // Channel names to send message to.
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
  channelNames: Array<string>; // Channel ids to send message to.
  messageBlocks: Array<WorkspaceMessageBlock>; // Message to add to blocks. 
}
