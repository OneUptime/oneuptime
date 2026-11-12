import { HeaderMenuButtonIdContext } from "../HeaderMenuContext";
import React, { FunctionComponent, ReactElement, useContext } from "react";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement>;
}

/*
 * As wide as its longest entry, at least 16rem (w-64) and never wider than
 * the screen less 1rem a side.
 *
 * At least w-64, not w-56: a two-word label with a trailing keycap
 * ("Keyboard shortcuts  ?") wrapped onto a second line at the old width,
 * which reads as two menu entries at a glance. And no longer w-64 alone: in
 * the Help menu, "How OneUptime works" is longer than that in French,
 * Portuguese, Spanish, Italian, German and Russian ("So funktioniert
 * OneUpt…"), and Japanese's keyboard shortcuts row with its keycap, so each
 * was cut short in the very menu someone opens to learn the product. An
 * entry is cut (truncate) only when the screen is too narrow for it.
 */
export const ICON_DROPDOWN_MENU_WIDTH_CLASS_NAME: string =
  "w-max min-w-[16rem] max-w-[calc(100vw-2rem)]";

const IconDropdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // Named by the button it hangs from (HeaderMenuContext).
  const buttonId: string | undefined = useContext(HeaderMenuButtonIdContext);

  return (
    <div
      className={`absolute right-0 z-10 mt-2 ${ICON_DROPDOWN_MENU_WIDTH_CLASS_NAME} origin-top-right rounded-xl bg-white py-2 shadow-lg ring-1 ring-gray-200 focus:outline-none transform opacity-100 scale-100 animate-in fade-in slide-in-from-top-1 duration-150`}
      role="menu"
      aria-orientation="vertical"
      aria-labelledby={buttonId}
    >
      {props.children}
    </div>
  );
};

export default IconDropdown;
