import URL from "../API/URL";

export interface WorkspaceMessageBlock {
  _type: string;
  onlyPostToTheseChannelNames?: Array<string>;
}

export interface WorkspaceMessagePayloadButton {
  _type: "WorkspaceMessagePayloadButton";
  title: string; // Button title.
  value: string; // Button value.
  actionId: string; // Button action id.
  url?: URL | undefined; // Button url.
}

export interface WorkspacePayloadHeader extends WorkspaceMessageBlock {
  _type: "WorkspacePayloadHeader";
  text: string;
}

export interface WorkspacePayloadMarkdown extends WorkspaceMessageBlock {
  _type: "WorkspacePayloadMarkdown";
  text: string;
}

export interface WorkspacePayloadDivider extends WorkspaceMessageBlock {
  _type: "WorkspacePayloadDivider";
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
