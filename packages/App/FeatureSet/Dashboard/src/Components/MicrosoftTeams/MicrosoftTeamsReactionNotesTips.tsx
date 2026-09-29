import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
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
  const publicNoteTip: string = props.supportsPublicNotes
    ? `- 📣 **Megaphone or loudspeaker** (📣, 📢) - React with a megaphone to save the message as a **public note** (visible on the status page).\n`
    : "";

  return (
    <Card
      title="Tips: Using Emoji Reactions"
      description={`You can use emoji reactions in Microsoft Teams to save channel messages as notes to the ${props.resourceName}.`}
    >
      <MarkdownViewer
        text={`
- 📌 **Pin** (📌, 📍) - React with a pin to save the message as a **private note** (visible only to your team).
${publicNoteTip}
This works in the channel OneUptime created for the ${props.resourceName}, on messages and on replies. OneUptime picks the reaction up within a minute, saves the message and confirms with a reply in the thread.

You need to connect your Microsoft Teams account to OneUptime first (User Settings → Microsoft Teams), and the OneUptime app needs to be installed in the team.
        `}
      />
    </Card>
  );
};

export default MicrosoftTeamsReactionNotesTips;
