import React, { FunctionComponent, ReactElement } from "react";
import MoreMenuDivider from "./Divider";
export interface ComponentProps {
  title: string;
  children: Array<ReactElement> | ReactElement;
}

const MoreMenuSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div>
      <div className="text-gray-400 text-sm font-medium">
        {props.title.toLocaleUpperCase()}
      </div>
      {props.children}
      <MoreMenuDivider />
    </div>
  );
};

export default MoreMenuSection;
