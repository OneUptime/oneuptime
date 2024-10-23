import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onDrop: () => void
}

const DashboardUnitElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="m-2 h-20 w-20 border-2 border-gray-100 rounded hover:border-gray-300 hover:bg-gray-100" onClick={props.onDrop}>

    </div>
  );
};

export default DashboardUnitElement;
