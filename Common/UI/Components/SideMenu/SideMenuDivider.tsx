import React, { FunctionComponent } from "react";

export interface ComponentProps {
  className?: string;
}

const SideMenuDivider: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  return (
    <div className={`my-3 px-3 ${props.className || ""}`}>
      <div className="h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent" />
    </div>
  );
};

export default SideMenuDivider;
