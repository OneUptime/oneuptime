import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  isEditMode: boolean;
  onClick: () => void;
}

const DashboardUnitElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let className: string = "m-2 h-20 w-20 min-w-20 min-h-20 ";

  if (props.isEditMode) {
    className +=
      "border-2 border-gray-100 rounded hover:border-gray-300 hover:bg-gray-100 cursor-pointer";
  }

  return (
    <div
      className={className}
      onClick={() => {
        props.onClick();
      }}
    ></div>
  );
};

export default DashboardUnitElement;
