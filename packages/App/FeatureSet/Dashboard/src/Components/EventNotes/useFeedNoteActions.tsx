import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { PermissionGateOptions } from "Common/UI/Utils/PermissionGate";
import { usePrivateRecordGate } from "Common/UI/Utils/PrivateRecordScope";
import React, { ReactElement, useEffect, useState } from "react";
import {
  getNoteKindCreateGate,
  isNoteCreateRefused,
  NoteCreateGate,
} from "./EventNoteComposer";
import EventNoteComposerDialog, {
  NOTE_COMPOSER_DIALOG_TITLES,
} from "./EventNoteComposerDialog";
import { EventNoteKind } from "./EventNoteKind";
import { NoteVisibility } from "./EventNotesUtil";
import { AUDIENCE_STYLES } from "./NoteComposer";

export interface FeedNoteActionsOptions {
  // The menu items' keys: "incident" gives "incident-action-public-note".
  keyPrefix: string;
  // The event's public notes, for events that have them (alerts do not).
  publicNoteKind?: EventNoteKind<BaseModel> | undefined;
  privateNoteKind: EventNoteKind<BaseModel>;
  // A note was posted from the dialog: read the feed again.
  onPosted: () => void;
}

export interface FeedNoteActions {
  // "Add Public Note" and "Add Private Note", last in the feed's Actions.
  menuItems: Array<ReactElement>;
  // The open "Add ... Note" dialog, or nothing.
  dialog: ReactElement | null;
}

interface OpenDialog {
  visibility: NoteVisibility;
  // The event it was opened on.
  parentId: string;
}

/*
 * "Add Public Note" and "Add Private Note" for an incident, alert, scheduled
 * maintenance or episode feed: the menu items for its Actions menu and the
 * dialog they open, which is the event's Notes page composer
 * (EventNoteComposerDialog) for the same kind of note.
 *
 * Each item is gated like the Notes page's composer: locked with the
 * missing permission as its tooltip, or not offered while the permissions
 * have not arrived. A private incident's or episode's "Add Public Note" is
 * locked with why it takes no public notes (getNoteKindCreateGate). And like
 * the Notes page, a draft never follows the reader to another event: the
 * dialog belongs to the event it was opened on.
 */
export default function useFeedNoteActions(
  options: FeedNoteActionsOptions,
): FeedNoteActions {
  const translator: Translator = useTranslator();
  /*
   * On a private record's page, its notes are written only by a team of the
   * reader's that owns it (PrivateRecordScope).
   */
  const privateRecordGate: (
    model: BaseModel,
  ) => PermissionGateOptions | undefined = usePrivateRecordGate();
  const [openDialog, setOpenDialog] = useState<OpenDialog | null>(null);

  // Every kind of note on a feed is on the same event.
  const eventId: string = options.privateNoteKind.parentId.toString();

  /*
   * Moving to another event - the overview stays mounted from one incident
   * to the next - closes a dialog opened on the last one. It is already
   * hidden by then (it only shows on the event it was opened on); this
   * forgets it, so coming back does not open it again.
   */
  useEffect(() => {
    setOpenDialog(null);
  }, [eventId]);

  const kinds: Array<{
    visibility: NoteVisibility;
    kind: EventNoteKind<BaseModel>;
  }> = [];

  if (options.publicNoteKind) {
    kinds.push({ visibility: "public", kind: options.publicNoteKind });
  }

  kinds.push({ visibility: "private", kind: options.privateNoteKind });

  /*
   * Whether the reader may add a private note: a private event's locked
   * "Add Public Note" points them to one unless a private note is refused
   * them too. Not known yet - while the permissions load - it points to one,
   * as it always did.
   */
  const isPrivateNoteOffered: boolean = !isNoteCreateRefused(
    getNoteKindCreateGate(
      options.privateNoteKind,
      translator,
      privateRecordGate(new options.privateNoteKind.modelType()),
    ),
  );

  const menuItems: Array<ReactElement> = [];

  for (const entry of kinds) {
    const gate: NoteCreateGate = getNoteKindCreateGate(
      entry.kind,
      translator,
      privateRecordGate(new entry.kind.modelType()),
      isPrivateNoteOffered,
    );

    if (!gate.isShown) {
      continue;
    }

    menuItems.push(
      <MoreMenuItem
        key={`${options.keyPrefix}-action-${entry.visibility}-note`}
        text={NOTE_COMPOSER_DIALOG_TITLES[entry.visibility]}
        icon={AUDIENCE_STYLES[entry.visibility].icon}
        isDisabled={gate.isDisabled}
        tooltip={gate.tooltip}
        onClick={() => {
          setOpenDialog({
            visibility: entry.visibility,
            parentId: entry.kind.parentId.toString(),
          });
        }}
      />,
    );
  }

  const openKind: EventNoteKind<BaseModel> | undefined = kinds.find(
    (entry: {
      visibility: NoteVisibility;
      kind: EventNoteKind<BaseModel>;
    }): boolean => {
      return (
        entry.visibility === openDialog?.visibility &&
        entry.kind.parentId.toString() === openDialog.parentId
      );
    },
  )?.kind;

  const dialog: ReactElement | null = openKind ? (
    <EventNoteComposerDialog<BaseModel>
      key={`${openKind.visibility}-${openKind.parentId.toString()}`}
      kind={openKind}
      onClose={() => {
        setOpenDialog(null);
      }}
      onPosted={() => {
        setOpenDialog(null);
        options.onPosted();
      }}
    />
  ) : null;

  return { menuItems, dialog };
}
