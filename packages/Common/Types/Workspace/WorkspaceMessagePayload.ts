import { DropdownOption } from "../../UI/Components/Dropdown/Dropdown";
import { InlineImageDataUri } from "../../Utils/Markdown/InlineImageDataUri";
import URL from "../API/URL";
import WorkspaceType from "./WorkspaceType";

export interface WorkspaceMessageBlock {
  _type: string;
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
  description?: string | undefined;
  optional?: boolean | undefined;
}

export interface WorkspaceTextBoxBlock extends WorkspaceMessageBlock {
  _type: "WorkspaceTextBoxBlock";
  label: string;
  blockId: string;
  placeholder: string;
  initialValue?: string | undefined;
  description?: string | undefined;
  optional?: boolean | undefined;
}

export interface WorkspaceDateTimePickerBlock extends WorkspaceMessageBlock {
  _type: "WorkspaceDateTimePickerBlock";
  label: string;
  blockId: string;
  initialValue?: string | undefined;
  description?: string | undefined;
  optional?: boolean | undefined;
}

export interface WorkspacePayloadImage extends WorkspaceMessageBlock {
  _type: "WorkspacePayloadImage";
  imageUrl: URL;
  altText: string;
}

/*
 * An image that carries itself - a synthetic monitor's screenshot in an
 * incident's or an alert's description - taken out of a markdown block, at
 * the place it reads, for a chat that can show it
 * (Server/Utils/Workspace/WorkspaceInlineImages).
 */
export interface WorkspacePayloadInlineImage extends WorkspaceMessageBlock {
  _type: "WorkspacePayloadInlineImage";
  // The image, as checked: what its bytes are, and its base64.
  image: InlineImageDataUri;
  // Its alt text as plain text; empty when it has none.
  altText: string;
  /*
   * Markdown to show in its place when it cannot be shown: its alt text, or
   * "[image]". Empty when its alt text already reads in the text before it.
   */
  fallbackMarkdown: string;
}

export interface WorkspaceCheckboxBlock extends WorkspaceMessageBlock {
  _type: "WorkspaceCheckboxBlock";
  label: string;
  blockId: string;
  initialValue?: boolean | undefined;
  description?: string | undefined;
  optional?: boolean | undefined;
}

export interface WorkspaceDropdownBlock extends WorkspaceMessageBlock {
  _type: "WorkspaceDropdownBlock";
  label: string;
  blockId: string;
  options: Array<DropdownOption>;
  placeholder: string;
  initialValue?: string | undefined;
  description?: string | undefined;
  multiSelect?: boolean | undefined;
  optional?: boolean | undefined;
}

export interface WorkspaceModalBlock extends WorkspaceMessageBlock {
  _type: "WorkspaceModalBlock";
  title: string;
  actionId: string;
  actionValue: string;
  submitButtonTitle: string;
  cancelButtonTitle: string;
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
  workspaceType: WorkspaceType;
  teamId?: string | undefined; // Team ID for Microsoft Teams
  chatIds?: Array<string> | undefined; // Microsoft Teams chat ids (group / personal chats) to send message to.
}
