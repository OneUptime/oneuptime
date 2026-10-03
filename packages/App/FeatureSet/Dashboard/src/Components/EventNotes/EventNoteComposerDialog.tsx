import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { ReactElement } from "react";
import EventNoteComposer from "./EventNoteComposer";
import { EventNoteKind } from "./EventNoteKind";
import { NoteVisibility } from "./EventNotesUtil";

/*
 * The dialog is named after the action that opens it, the feed's
 * "Add Public Note" / "Add Private Note".
 */
export const NOTE_COMPOSER_DIALOG_TITLES: Record<NoteVisibility, string> = {
  public: translationKey("Add Public Note"),
  private: translationKey("Add Private Note"),
};

export interface ComponentProps<TNote extends BaseModel> {
  // The note to write, from the event's NoteKinds module.
  kind: EventNoteKind<TNote>;
  // Cancel, the X, Escape or the backdrop - after a discarded draft is confirmed.
  onClose: () => void;
  // The note is saved. Close the dialog and refresh what shows the note.
  onPosted: () => void;
}

/*
 * The Notes page's composer in a dialog: "Add Public Note" and "Add Private
 * Note" in the overview feed's Actions. One step - write, and post - with the
 * note's templates, Draft with AI, attachments, its posting time behind
 * "Posted now", and for a public note "Notify status page subscribers" with
 * who it reaches and Preview notification.
 *
 * It replaced a hand-built two-step form per feed (write, Next, then a
 * Summary page repeating what was just typed) that asked for Posted At up
 * front and offered none of the above.
 */
function EventNoteComposerDialog<TNote extends BaseModel>(
  props: ComponentProps<TNote>,
): ReactElement {
  return (
    <EventNoteComposer<TNote>
      kind={props.kind}
      projectId={ProjectUtil.getCurrentProjectId()}
      presentation={{
        type: "dialog",
        title: NOTE_COMPOSER_DIALOG_TITLES[props.kind.visibility],
        onClose: props.onClose,
      }}
      onPosted={props.onPosted}
    />
  );
}

export default EventNoteComposerDialog;
