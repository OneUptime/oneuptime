import React, { FunctionComponent, ReactElement } from "react";
import KeyboardShortcutsModal, {
  KeyboardShortcutGroup,
} from "Common/UI/Components/KeyboardShortcut/KeyboardShortcutsModal";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
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
 *
 * KeyboardShortcutsModal draws its groups' titles and descriptions and the
 * word between two keys as given ("the caller owns translation"), so they
 * are looked up here; the modal's own title, description and Close button
 * go through Modal, which looks them up itself.
 */

const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

export interface ReplayShortcutsModalProps {
  onClose: () => void;
}

export function toKeyboardShortcutGroups(
  groups: Array<ReplayShortcutGroup>,
  translator: Translator = ENGLISH,
): Array<KeyboardShortcutGroup> {
  return groups.map((group: ReplayShortcutGroup): KeyboardShortcutGroup => {
    return {
      id: group.id,
      title: translator.translateText(group.title) || group.title,
      shortcuts: group.shortcuts.map((shortcut: ReplayShortcutDescription) => {
        return {
          id: shortcut.id,
          keySequence: shortcut.keys,
          description:
            translator.translateText(shortcut.description) ||
            shortcut.description,
        };
      }),
    };
  });
}

const ReplayShortcutsModal: FunctionComponent<ReplayShortcutsModalProps> = (
  props: ReplayShortcutsModalProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <KeyboardShortcutsModal
      title="Replay keyboard shortcuts"
      description="Shortcuts work whenever the player is on screen and no text field has focus."
      groups={toKeyboardShortcutGroups(REPLAY_SHORTCUT_GROUPS, translator)}
      /* Between the two keys of a range: "0 to 9". */
      thenLabel={translator.translateText("to") || "to"}
      closeButtonText="Close"
      onClose={props.onClose}
    />
  );
};

export default ReplayShortcutsModal;
