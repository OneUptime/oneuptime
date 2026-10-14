import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import {
  translatableTerm,
  TranslatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  workspaceType: WorkspaceType;
  // Singular, lower case: "incident", "alert episode".
  resourceName: string;
  // Only incidents and scheduled maintenance events have public notes.
  supportsPublicNotes: boolean;
}

/*
 * HOW TO SAVE A CHAT MESSAGE AS A NOTE, ON A RECORD'S SLACK AND MICROSOFT
 * TEAMS PAGES - the same card for both chats, in the reader's language.
 *
 * A pin saves a message as a private note (in Slack, its own Pin to channel
 * too), a megaphone as a public note. The note is its author's words, with
 * their formatting and links, and a private note is filed when the message
 * was posted. Somebody whose account is not connected yet is asked to
 * connect it, and the message is saved once they have: they no longer have
 * to connect first. Microsoft Teams reads reactions once a minute, from the
 * channel OneUptime created, and only with the app in the team.
 *
 * Each list item and paragraph is one translated line of Markdown; only the
 * breaks between them are put together here.
 */
const WorkspaceReactionNotesTips: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isSlack: boolean = props.workspaceType === WorkspaceType.Slack;

  // A product name, the same in every language.
  const workspace: string = isSlack ? "Slack" : "Microsoft Teams";

  // The record's noun as it reads in the middle of a sentence.
  const resourceName: TranslatableTerm = translatableTerm(props.resourceName, {
    inSentence: true,
  });

  const items: Array<string> = [
    translator.translateTemplate(
      "- 📌 **Pin** (📌, 📍) - React with a pin to save the message as a **private note** (visible only to your team).",
    ),
  ];

  if (isSlack) {
    items.push(
      translator.translateTemplate(
        "- **Pin to channel** - Pinning the message with Slack's own *Pin to channel* does the same as a pin.",
      ),
    );
  }

  if (props.supportsPublicNotes) {
    items.push(
      translator.translateTemplate(
        "- 📣 **Megaphone or loudspeaker** (📣, 📢) - React with a megaphone to save the message as a **public note** (visible on the status page).",
      ),
    );
  }

  const paragraphs: Array<string> = [
    isSlack
      ? translator.translateTemplate(
          "This works in the channel of the {{resourceName}}, on messages and on replies. OneUptime saves the message and confirms with a reply in the thread.",
          { resourceName: resourceName },
        )
      : translator.translateTemplate(
          "This works in the channel OneUptime created for the {{resourceName}}, on messages and on replies. OneUptime picks the reaction up within a minute, saves the message and confirms with a reply in the thread.",
          { resourceName: resourceName },
        ),
    translator.translateTemplate(
      "The note keeps the message's formatting and links and shows who wrote it. A private note is filed at the time the message was posted.",
    ),
    translator.translateTemplate(
      "If your {{workspace}} account is not connected to OneUptime yet, OneUptime asks you to connect it, then saves the message.",
      { workspace: workspace },
    ),
  ];

  if (!isSlack) {
    paragraphs.push(
      translator.translateTemplate(
        "The OneUptime app needs to be installed in the team.",
      ),
    );
  }

  return (
    <Card
      title="Tips: Using Emoji Reactions"
      description={translator.translateTemplate(
        "You can use emoji reactions in {{workspace}} to save messages as notes on the {{resourceName}}.",
        { workspace: workspace, resourceName: resourceName },
      )}
    >
      <div data-testid={`reaction-notes-tips-${props.workspaceType}`}>
        <MarkdownViewer
          text={`${items.join("\n")}\n\n${paragraphs.join("\n\n")}`}
        />
      </div>
    </Card>
  );
};

export default WorkspaceReactionNotesTips;
