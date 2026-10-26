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
  /*
   * The one button a message asks the reader to press: Slack draws it
   * filled ("primary"), Microsoft Teams as its positive action.
   */
  isPrimary?: boolean | undefined;
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
  /*
   * The moment the picker opens on - a custom field's value, say. Slack
   * takes it as the seconds since 1970.
   */
  initialDateTime?: Date | undefined;
  description?: string | undefined;
  optional?: boolean | undefined;
}

/*
 * A calendar day, with no time of day: a Date custom field. Its value is the
 * day as "2026-10-15", which is also how the picker gives it back.
 */
export interface WorkspaceDatePickerBlock extends WorkspaceMessageBlock {
  _type: "WorkspaceDatePickerBlock";
  label: string;
  blockId: string;
  // "2026-10-15".
  initialDate?: string | undefined;
  placeholder?: string | undefined;
  description?: string | undefined;
  optional?: boolean | undefined;
}

/*
 * A number - a Number custom field. Slack's input takes only a number, with
 * a decimal point allowed; what is typed comes back as text.
 */
export interface WorkspaceNumberInputBlock extends WorkspaceMessageBlock {
  _type: "WorkspaceNumberInputBlock";
  label: string;
  blockId: string;
  initialValue?: string | undefined;
  placeholder?: string | undefined;
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
  /*
   * The options in groups, each under its label - "On-call schedules",
   * "People" - in place of `options`: a Slack select draws each label over
   * its options.
   */
  optionGroups?: Array<WorkspaceDropdownOptionGroup> | undefined;
  // A multi-select's picks as the form opens: values of its options.
  initialValues?: Array<string> | undefined;
}

export interface WorkspaceDropdownOptionGroup {
  label: string;
  options: Array<DropdownOption>;
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
  /*
   * A menu beside the text, that acts as soon as an option is chosen
   * (WorkspacePayloadMenu): Slack draws it as the section's select. Only
   * Slack draws one.
   */
  menu?: WorkspacePayloadMenu | undefined;
}

/*
 * A menu beside a line of Markdown that acts the moment one of its options
 * is chosen, with no button to press after: the Switch project menu of the
 * Slack app's Home (SlackHome). Slack draws it as a static select beside
 * the line; Microsoft Teams draws none, and nothing passes one there.
 */
export interface WorkspacePayloadMenu {
  actionId: string;
  // What the menu says while nothing is chosen.
  placeholder: string;
  options: Array<WorkspacePayloadMenuOption>;
  /*
   * Names the menu, so a chat that keeps what was chosen in a menu across a
   * redraw of the view keeps it only where the same menu is drawn again.
   */
  blockId?: string | undefined;
}

export interface WorkspacePayloadMenuOption {
  // Plain text, as the menu shows it: never Markdown.
  label: string;
  value: string;
}

/*
 * Small, muted Markdown under what a message says - when it was drawn,
 * where to see more: Slack's context block, and a subtle small text block
 * in a Microsoft Teams card. Never what the message is about: a
 * notification of the message never reads it (WorkspaceNotificationText).
 */
export interface WorkspacePayloadContext extends WorkspaceMessageBlock {
  _type: "WorkspacePayloadContext";
  text: string;
}

export interface WorkspacePayloadDivider extends WorkspaceMessageBlock {
  _type: "WorkspacePayloadDivider";
}

export interface WorkspacePayloadButtons extends WorkspaceMessageBlock {
  _type: "WorkspacePayloadButtons";
  buttons: Array<WorkspaceMessagePayloadButton>;
  /*
   * The actions fewer people need, in a menu after the buttons: Slack's
   * overflow menu (⋯), which holds at most SLACK_OVERFLOW_MENU_MAX_ITEMS,
   * and Microsoft Teams' card overflow menu (its secondary actions). Each
   * is pressed as a button with the same action id and value would be.
   */
  menuButtons?: Array<WorkspaceMessagePayloadButton> | undefined;
}

// The most items Slack's overflow menu holds.
export const SLACK_OVERFLOW_MENU_MAX_ITEMS: number = 5;

export default interface WorkspaceMessagePayload {
  _type: "WorkspaceMessagePayload";
  channelNames: Array<string>; // Channel ids to send message to.
  channelIds: Array<string>; // Channel ids to send message to.
  messageBlocks: Array<WorkspaceMessageBlock>; // Message to add to blocks.
  workspaceType: WorkspaceType;
  teamId?: string | undefined; // Team ID for Microsoft Teams
  chatIds?: Array<string> | undefined; // Microsoft Teams chat ids (group / personal chats) to send message to.
  /*
   * What a notification, a message preview or a screen reader shows of the
   * message: one line of plain text - Slack's top-level `text`, a Microsoft
   * Teams card's `summary`. Without it Slack has nothing to show in a push
   * notification, and Teams says only that a card was sent.
   */
  text?: string | undefined;
  /*
   * Channels, by id, not to post in even when a name above resolves to one:
   * a note saved from a message is not posted back into the channel the
   * message is in, where it would only repeat it.
   */
  exceptChannelIds?: Array<string> | undefined;
}
