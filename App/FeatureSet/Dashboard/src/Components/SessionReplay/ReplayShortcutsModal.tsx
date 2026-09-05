import React, { FunctionComponent, ReactElement } from "react";
import KeyboardShortcutsModal, {
  KeyboardShortcutGroup,
} from "Common/UI/Components/KeyboardShortcut/KeyboardShortcutsModal";
import {
  REPLAY_SHORTCUT_GROUPS,
  ReplayShortcutDescription,
  ReplayShortcutGroup,
} from "./ReplayKeyboardMap";

/*
 * The "?" sheet. A thin adapter: the vocabulary lives in
 * ReplayKeyboardMap.ts as data, and this file only reshapes it for
 * Common/UI's KeyboardShortcutsModal so the sheet can never drift from
 * what the keys actually do. Key names in the map use KeyboardKey's own
 * values ("Space", "Shift", "ArrowLeft"), which the modal renders in the
 * platform's notation.
 */

export interface ReplayShortcutsModalProps {
  onClose: () => void;
}

export function toKeyboardShortcutGroups(
  groups: Array<ReplayShortcutGroup>,
): Array<KeyboardShortcutGroup> {
  return groups.map((group: ReplayShortcutGroup): KeyboardShortcutGroup => {
    return {
      id: group.id,
      title: group.title,
      shortcuts: group.shortcuts.map((shortcut: ReplayShortcutDescription) => {
        return {
          id: shortcut.id,
          keySequence: shortcut.keys,
          description: shortcut.description,
        };
      }),
    };
  });
}

const ReplayShortcutsModal: FunctionComponent<ReplayShortcutsModalProps> = (
  props: ReplayShortcutsModalProps,
): ReactElement => {
  return (
    <KeyboardShortcutsModal
      title="Replay keyboard shortcuts"
      description="Shortcuts work whenever the player is on screen and no text field has focus."
      groups={toKeyboardShortcutGroups(REPLAY_SHORTCUT_GROUPS)}
      thenLabel="to"
      closeButtonText="Close"
      onClose={props.onClose}
    />
  );
};

export default ReplayShortcutsModal;
