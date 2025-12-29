import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement>;
}

const IconDropdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      className="absolute right-0 z-10 mt-2 w-56 origin-top-right rounded-xl bg-white py-2 shadow-lg ring-1 ring-gray-200 focus:outline-none transform opacity-100 scale-100 animate-in fade-in slide-in-from-top-1 duration-150"
      role="menu"
      aria-orientation="vertical"
      aria-labelledby="user-menu-button"
    >
      {props.children}
    </div>
  );
};

export default IconDropdown;
