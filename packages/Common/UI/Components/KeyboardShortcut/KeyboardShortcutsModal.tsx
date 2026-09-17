import Modal, { ModalWidth } from "../Modal/Modal";
import KeyboardShortcut, { KeyboardShortcutSize } from "./KeyboardShortcut";
import { KeyboardShortcutKey } from "./KeyboardKey";
import React, { FunctionComponent, ReactElement } from "react";

/**
 * One shortcut, as a list of chords pressed in order.
 *
 * A single chord is an ordinary shortcut — `[[Mod, "K"]]` renders "⌘ K". Two
 * chords are a sequence — `[["G"], ["I"]]` renders "G then I" — which is what
 * lets leader-key navigation and plain shortcuts sit in one table without the
 * reader having to work out which is which.
 */
export interface KeyboardShortcutDescription {
  id: string;
  keySequence: Array<Array<KeyboardShortcutKey>>;
  description: string;
}

export interface KeyboardShortcutGroup {
  id: string;
  title: string;
  shortcuts: Array<KeyboardShortcutDescription>;
}

export interface ComponentProps {
  groups: Array<KeyboardShortcutGroup>;
  title: string;
  description?: string | undefined;
  /**
   * The word between two chords of a sequence, e.g. "then". Passed in so the
   * caller owns translation; this component holds no strings of its own.
   */
  thenLabel: string;
  closeButtonText: string;
  onClose: () => void;
}

/**
 * The product's one place to look up what the keyboard can do.
 *
 * Shortcuts are only worth having if they can be found, and until now every
 * one the dashboard had — the command palette, Ask AI, "/" to search a table —
 * was learnable only by being told about it. This is the page that tells you.
 */
const KeyboardShortcutsModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * A group whose shortcuts are all gated off would otherwise render as a
   * heading with nothing under it.
   */
  const visibleGroups: Array<KeyboardShortcutGroup> = props.groups.filter(
    (group: KeyboardShortcutGroup) => {
      return group.shortcuts.length > 0;
    },
  );

  return (
    <Modal
      title={props.title}
      description={props.description}
      modalWidth={ModalWidth.Large}
      closeButtonText={props.closeButtonText}
      onClose={props.onClose}
    >
      <div
        data-testid="keyboard-shortcuts-modal"
        className="grid grid-cols-1 gap-x-10 gap-y-7 sm:grid-cols-2"
      >
        {visibleGroups.map((group: KeyboardShortcutGroup) => {
          return (
            <section key={group.id} data-testid={`shortcut-group-${group.id}`}>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {group.title}
              </h4>

              <dl className="mt-2 divide-y divide-gray-100">
                {group.shortcuts.map(
                  (shortcut: KeyboardShortcutDescription) => {
                    return (
                      <div
                        key={shortcut.id}
                        data-testid={`shortcut-${shortcut.id}`}
                        className="flex items-center justify-between gap-4 py-2"
                      >
                        <dt className="min-w-0 text-sm text-gray-600">
                          {shortcut.description}
                        </dt>
                        <dd className="flex shrink-0 items-center gap-1.5">
                          {shortcut.keySequence.map(
                            (
                              chord: Array<KeyboardShortcutKey>,
                              index: number,
                            ) => {
                              return (
                                <React.Fragment key={`chord-${index}`}>
                                  {index > 0 && (
                                    <span className="text-xs text-gray-400">
                                      {props.thenLabel}
                                    </span>
                                  )}
                                  <KeyboardShortcut
                                    keys={chord}
                                    size={KeyboardShortcutSize.Small}
                                  />
                                </React.Fragment>
                              );
                            },
                          )}
                        </dd>
                      </div>
                    );
                  },
                )}
              </dl>
            </section>
          );
        })}
      </div>
    </Modal>
  );
};

export default KeyboardShortcutsModal;
