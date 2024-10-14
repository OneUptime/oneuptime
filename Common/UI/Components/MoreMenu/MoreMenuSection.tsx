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
      <div className="text-gray-400 text-xs font-medium pt-2 pl-3 pr-3 pb-2">
        {props.title.toUpperCase()}
      </div>
      {props.children}
      <MoreMenuDivider />
    </div>
  );
};

export default MoreMenuSection;
