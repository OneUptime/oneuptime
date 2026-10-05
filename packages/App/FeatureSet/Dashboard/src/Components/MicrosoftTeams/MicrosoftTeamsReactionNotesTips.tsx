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
  // Singular, lower case: "incident", "alert episode".
  resourceName: string;
  // Only incidents and scheduled maintenance events have public notes.
  supportsPublicNotes: boolean;
}

const MicrosoftTeamsReactionNotesTips: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // The resource's noun as it reads in the middle of a sentence.
  const resourceName: TranslatableTerm = translatableTerm(props.resourceName, {
    inSentence: true,
  });

  /*
   * Each tip is one translated line of markdown; only the list and paragraph
   * breaks between them are put together here.
   */
  const pinTip: string = translator.translateTemplate(
    "- 📌 **Pin** (📌, 📍) - React with a pin to save the message as a **private note** (visible only to your team).",
  );

  const publicNoteTip: string = props.supportsPublicNotes
    ? `${translator.translateTemplate(
        "- 📣 **Megaphone or loudspeaker** (📣, 📢) - React with a megaphone to save the message as a **public note** (visible on the status page).",
      )}\n`
    : "";

  const channelTip: string = translator.translateTemplate(
    "This works in the channel OneUptime created for the {{resourceName}}, on messages and on replies. OneUptime picks the reaction up within a minute, saves the message and confirms with a reply in the thread.",
    { resourceName: resourceName },
  );

  const connectTip: string = translator.translateTemplate(
    "You need to connect your Microsoft Teams account to OneUptime first (User Settings → Microsoft Teams), and the OneUptime app needs to be installed in the team.",
  );

  return (
    <Card
      title="Tips: Using Emoji Reactions"
      description={translator.translateTemplate(
        "You can use emoji reactions in Microsoft Teams to save channel messages as notes to the {{resourceName}}.",
        { resourceName: resourceName },
      )}
    >
      <MarkdownViewer
        text={`
${pinTip}
${publicNoteTip}
${channelTip}

${connectTip}
        `}
      />
    </Card>
  );
};

export default MicrosoftTeamsReactionNotesTips;
