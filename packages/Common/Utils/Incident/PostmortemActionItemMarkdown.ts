import FeedMarkdown, { MarkdownText, mdText } from "../Markdown/FeedMarkdown";
import { ActionItemCodeTaskKind } from "./PostmortemActionItemCodeTask";

/*
 * What an incident's feed says about its postmortem's action items (issue
 * #6801): added, tracked from the note, given an owner, done, won't do,
 * reopened, deleted, and what OneUptime AI or a monitor did for one.
 *
 * Every sentence places what people typed - an action item's title, a
 * person's name, a monitor's name - with mdText (Common/Utils/Markdown/
 * FeedMarkdown), so none of it can turn into a link, an image, HTML or a
 * chat mention wherever the feed is shown. Each is written to follow the
 * name of whoever made the change, as the feed puts it in front: "Ana Silva
 * marked the action item Alert on pool usage done."
 *
 * Kept apart from the service so the sentences are tested on their own.
 */

// The most titles a tracking line names before it counts the rest.
export const MAX_TITLES_IN_TRACKED_LINE: number = 3;

function owned(ownerName: string | undefined): MarkdownText {
  return ownerName ? mdText`, owned by **${ownerName}**` : FeedMarkdown.empty();
}

export function actionItemAddedMarkdown(data: {
  title: string;
  ownerName?: string | undefined;
}): MarkdownText {
  return mdText`📝 Added the action item **${data.title}**${owned(data.ownerName)}.`;
}

export function actionItemsTrackedMarkdown(data: {
  titles: Array<string>;
}): MarkdownText {
  const named: Array<string> = data.titles.slice(0, MAX_TITLES_IN_TRACKED_LINE);
  const more: number = data.titles.length - named.length;

  const list: MarkdownText = FeedMarkdown.join(
    named.map((title: string): MarkdownText => {
      return mdText`**${title}**`;
    }),
    "; ",
  );

  if (data.titles.length === 1) {
    return mdText`📝 Tracked the action item ${list} from the postmortem.`;
  }

  if (more > 0) {
    return mdText`📝 Tracked ${data.titles.length.toString()} action items from the postmortem: ${list} and ${more.toString()} more.`;
  }

  return mdText`📝 Tracked ${data.titles.length.toString()} action items from the postmortem: ${list}.`;
}

export function actionItemDoneMarkdown(data: { title: string }): MarkdownText {
  return mdText`✅ Marked the action item **${data.title}** done.`;
}

export function actionItemWontDoMarkdown(data: {
  title: string;
}): MarkdownText {
  return mdText`🚫 Decided not to do the action item **${data.title}**.`;
}

export function actionItemReopenedMarkdown(data: {
  title: string;
}): MarkdownText {
  return mdText`↩️ Reopened the action item **${data.title}**.`;
}

export function actionItemOwnerMarkdown(data: {
  title: string;
  ownerName?: string | undefined;
}): MarkdownText {
  if (!data.ownerName) {
    return mdText`👤 Took the owner off the action item **${data.title}**.`;
  }

  return mdText`👤 Gave the action item **${data.title}** to **${data.ownerName}**.`;
}

export function actionItemDeletedMarkdown(data: {
  title: string;
}): MarkdownText {
  return mdText`🗑️ Deleted the action item **${data.title}**.`;
}

export function actionItemMonitorMarkdown(data: {
  title: string;
  monitorName: string;
}): MarkdownText {
  return mdText`📈 Created the monitor **${data.monitorName}** for the action item **${data.title}**.`;
}

export function actionItemCodeTaskMarkdown(data: {
  title: string;
  kind: ActionItemCodeTaskKind;
  repositoryName: string;
}): MarkdownText {
  if (data.kind === ActionItemCodeTaskKind.Test) {
    return mdText`🧪 Asked OneUptime AI to write a test for the action item **${data.title}**, in **${data.repositoryName}**.`;
  }

  return mdText`🤖 Asked OneUptime AI to open a pull request for the action item **${data.title}**, in **${data.repositoryName}**.`;
}

// Written by OneUptime, with no person in front: a pull request merged.
export function actionItemDoneByPullRequestMarkdown(data: {
  title: string;
  pullRequestNumber?: number | undefined;
}): MarkdownText {
  if (data.pullRequestNumber) {
    return mdText`✅ The action item **${data.title}** is done: its pull request #${data.pullRequestNumber.toString()} merged.`;
  }

  return mdText`✅ The action item **${data.title}** is done: its pull request merged.`;
}
