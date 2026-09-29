import React, { FunctionComponent, ReactElement } from "react";
import PlatformUtil from "../../Utils/Platform";
import KeyboardKey, {
  KeyboardKeyUtil,
  KeyboardShortcutKey,
} from "./KeyboardKey";

export enum KeyboardShortcutSize {
  ExtraSmall = "ExtraSmall",
  Small = "Small",
  Medium = "Medium",
}

export enum KeyboardShortcutVariant {
  /** Raised white keycaps — reads well on gray or white surfaces. */
  Default = "Default",
  /** Borderless muted caps for dense, secondary hints. */
  Ghost = "Ghost",
}

export interface ComponentProps {
  keys: Array<KeyboardShortcutKey>;
  size?: KeyboardShortcutSize | undefined;
  variant?: KeyboardShortcutVariant | undefined;
  className?: string | undefined;
}

const SIZE_CLASS: Record<KeyboardShortcutSize, string> = {
  [KeyboardShortcutSize.ExtraSmall]:
    "h-[18px] min-w-[18px] px-1 text-[10px] rounded",
  [KeyboardShortcutSize.Small]:
    "h-5 min-w-[20px] px-1.5 text-[11px] rounded-[5px]",
  [KeyboardShortcutSize.Medium]: "h-6 min-w-[24px] px-1.5 text-xs rounded-md",
};

const VARIANT_CLASS: Record<KeyboardShortcutVariant, string> = {
  [KeyboardShortcutVariant.Default]:
    "border border-gray-200 bg-white text-gray-500 shadow-sm",
  [KeyboardShortcutVariant.Ghost]: "bg-gray-100 text-gray-600",
};

/**
 * Renders a keyboard shortcut as keycaps, in the notation of the machine the
 * user is actually on: ⌘ I on a Mac, Ctrl I on Windows and Linux.
 *
 * The caps themselves are hidden from assistive tech — glyphs like ⌘ are
 * announced inconsistently — and the shortcut is exposed once, in words, as
 * screen-reader-only text ("Command + I").
 */
const KeyboardShortcut: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isApplePlatform: boolean = PlatformUtil.isApplePlatform();

  const size: KeyboardShortcutSize = props.size || KeyboardShortcutSize.Small;
  const variant: KeyboardShortcutVariant =
    props.variant || KeyboardShortcutVariant.Default;

  const keycapClassName: string = `inline-flex flex-none select-none items-center justify-center font-sans font-medium leading-none ${SIZE_CLASS[size]} ${VARIANT_CLASS[variant]}`;

  return (
    <span
      className={`inline-flex flex-none items-center gap-1 ${
        props.className || ""
      }`}
    >
      <span className="sr-only">
        {KeyboardKeyUtil.getShortcutLabel(props.keys, isApplePlatform)}
      </span>
      {props.keys.map((key: KeyboardShortcutKey, index: number) => {
        return (
          <kbd
            aria-hidden="true"
            key={`${String(key)}-${index}`}
            className={keycapClassName}
          >
            {KeyboardKeyUtil.getDisplayKey(key, isApplePlatform)}
          </kbd>
        );
      })}
    </span>
  );
};

export { KeyboardKey, KeyboardKeyUtil };
export type { KeyboardShortcutKey };
export default KeyboardShortcut;
