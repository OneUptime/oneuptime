import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  isEditMode: boolean;
  onClick: () => void;
  id: string;
}

const BlankDashboardUnitElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      id={props.id}
      className={
        props.isEditMode
          ? "rounded-md cursor-pointer transition-all duration-150"
          : "transition-all duration-150"
      }
      onClick={() => {
        props.onClick();
      }}
      style={{
        border: props.isEditMode
          ? "1px solid rgba(203, 213, 225, 0.4)"
          : "none",
        borderRadius: "6px",
      }}
    />
  );
};

export default BlankDashboardUnitElement;
