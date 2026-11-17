import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A CLUSTER'S OR A RESOURCE'S AI LOGS PAGE LEAVES OUT OF ITS COMMANDS
 * (#9155).
 *
 * The commands card lists the Runner jobs the reader may read, and a job
 * of an AI run is read only by those who may read that run: a chat's only
 * by the person who asked, and one about a private incident or alert only
 * by those who see that record (AIRunOutputReadFilter). The page's logs
 * route counts the ones the reader may not read (hiddenCommandCount), and
 * the card says how many it leaves out and why, in a quiet line over its
 * rows (CommandJobsHiddenNote) - only the number, never anything else of
 * them, and nothing at all when it leaves nothing out. An empty list then
 * says there are none the reader can see, not that AI never ran a command
 * here.
 *
 * Import-clean (the translation helpers only), as the pages' pure halves
 * that read it are (ResourceAiLogs).
 */

export const COMMAND_JOBS_HIDDEN_NOTE: PluralTemplate = {
  one: "{{count}} command that ran here isn't listed: it was run for an AI chat, incident or alert you can't open.",
  other:
    "{{count}} commands that ran here aren't listed: they were run for AI chats, incidents or alerts you can't open.",
};

export const COMMAND_JOBS_NONE_YOU_CAN_SEE: string = translationKey(
  "No commands you can see.",
);

/*
 * The commands card's empty line: the page's own while it leaves nothing
 * out, and that the reader can see none of them when it does.
 */
export function getCommandJobsEmptyMessage(data: {
  hiddenCount: number;
  emptyMessage: string;
}): string {
  return data.hiddenCount > 0
    ? COMMAND_JOBS_NONE_YOU_CAN_SEE
    : data.emptyMessage;
}

/*
 * The count the logs route sent, or 0 when it sent none: a server from
 * before #9155, or a reader who may not read Runner jobs at all, whom the
 * card tells so on its own (CommandJobsNoAccess).
 */
export function readHiddenCommandCount(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : 0;
}
