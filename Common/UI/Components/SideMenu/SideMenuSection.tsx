import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title: string;
  children: ReactElement | Array<ReactElement>;
}

const SideMenuSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  return (
    <div className="mb-2">
      <h6 className="text-sm text-gray-500">{props.title}</h6>
      <div>{props.children}</div>
    </div>
  );
};

export default SideMenuSection;
