import { DropdownOption } from "../../UI/Components/Dropdown/Dropdown";
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

export interface WorkspaceTextAreaBlock extends WorkspaceMessageBlock {
  _type: "WorkspaceTextAreaBlock";
  label: string;
  blockId: string;
  placeholder: string;
  initialValue?: string | undefined;
}

export interface WorkspaceTextBoxBlock extends WorkspaceMessageBlock {
  _type: "WorkspaceTextBoxBlock";
  label: string;
  blockId: string;
  placeholder: string;
  initialValue?: string | undefined;
}

export interface WorkspacePayloadImage extends WorkspaceMessageBlock {
  _type: "WorkspacePayloadImage";
  imageUrl: URL;
  altText: string;
}

export interface WorkspaceDropdownBlock extends WorkspaceMessageBlock {
  _type: "WorkspaceDropdownBlock";
  label: string;
  blockId: string;
  options: Array<DropdownOption>;
  placeholder: string;
  initialValue?: string | undefined;
}

export interface WorkspaceModalBlock extends WorkspaceMessageBlock {
  _type: "WorkspaceModalBlock";
  title: string;
  submitButtonTitle: string;
  cancelButtonTitle: string;
  submitButtonActionId?: string | undefined;
  submitButtonValue?: string | undefined;
  blocks: Array<WorkspaceMessageBlock>;
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
  channelIds: Array<string>; // Channel ids to send message to.
  messageBlocks: Array<WorkspaceMessageBlock>; // Message to add to blocks.
}
