import React, { FunctionComponent, ReactElement } from "react";
import KeyboardShortcut, {
  KeyboardShortcutSize,
} from "../../KeyboardShortcut/KeyboardShortcut";
import KeyboardKey, {
  KeyboardShortcutKey,
} from "../../KeyboardShortcut/KeyboardKey";

export interface KeyboardShortcutsHelpProps {
  onClose: () => void;
}

interface ShortcutRow {
  keys: Array<KeyboardShortcutKey>;
  description: string;
}

const SHORTCUT_ROWS: Array<ShortcutRow> = [
  { keys: ["j"], description: "Move to next log row" },
  { keys: ["k"], description: "Move to previous log row" },
  { keys: [KeyboardKey.Enter], description: "Expand / collapse selected log" },
  { keys: [KeyboardKey.Escape], description: "Close detail panel" },
  { keys: ["/"], description: "Focus search bar" },
  {
    // The handler accepts meta or ctrl, so this follows the platform.
    keys: [KeyboardKey.Mod, KeyboardKey.Enter],
    description: "Apply search filters",
  },
  { keys: ["?"], description: "Toggle this help" },
];

export const KEYBOARD_SHORTCUTS_HELP_TEST_ID: string =
  "keyboard-shortcuts-help";

const KeyboardShortcutsHelp: FunctionComponent<KeyboardShortcutsHelpProps> = (
  props: KeyboardShortcutsHelpProps,
): ReactElement => {
  return (
    /*
     * From md up this hangs off the trigger's right edge. Below md it spans
     * the toolbar row the trigger sits in instead (the trigger's wrapper is
     * not positioned there) and drops below the trigger, since an 18rem panel
     * hung off a trigger mid-row could run off the side of a phone.
     */
    <div
      className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg md:left-auto md:top-full md:w-72"
      data-testid={KEYBOARD_SHORTCUTS_HELP_TEST_ID}
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Keyboard shortcuts
        </span>
        <button
          type="button"
          className="text-gray-400 transition-colors hover:text-gray-600"
          onClick={props.onClose}
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18 18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div className="py-1">
        {SHORTCUT_ROWS.map((row: ShortcutRow) => {
          return (
            <div
              key={row.description}
              className="flex items-center justify-between px-3 py-1.5"
            >
              <span className="text-xs text-gray-600">{row.description}</span>
              <KeyboardShortcut
                keys={row.keys}
                size={KeyboardShortcutSize.Small}
              />
            </div>
          );
        })}
      </div>

      <div className="border-t border-gray-100 px-3 py-1.5">
        <span className="text-[10px] text-gray-400">
          Press{" "}
          <kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-mono text-[10px]">
            ?
          </kbd>{" "}
          to toggle this panel
        </span>
      </div>
    </div>
  );
};

export default KeyboardShortcutsHelp;
