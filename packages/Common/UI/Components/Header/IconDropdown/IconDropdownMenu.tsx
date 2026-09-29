import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement>;
}

const IconDropdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      /*
       * w-64, not w-56: a two-word label with a trailing keycap ("Keyboard
       * shortcuts  ?") wrapped onto a second line at the old width, which reads
       * as two menu entries at a glance.
       */
      className="absolute right-0 z-10 mt-2 w-64 origin-top-right rounded-xl bg-white py-2 shadow-lg ring-1 ring-gray-200 focus:outline-none transform opacity-100 scale-100 animate-in fade-in slide-in-from-top-1 duration-150"
      role="menu"
      aria-orientation="vertical"
      aria-labelledby="user-menu-button"
    >
      {props.children}
    </div>
  );
};

export default IconDropdown;
