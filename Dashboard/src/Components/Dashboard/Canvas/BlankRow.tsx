import React, { FunctionComponent, ReactElement } from "react";
import DefaultDashboardSize from "Common/Types/Dashboard/DashboardSize";
import BlankDashboardUnitElement from "./DashboardUnit";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";

export interface ComponentProps {
  rowNumber: number;
  onDrop: (top: number, left: number) => void;
  dashboardViewConfig: DashboardViewConfig;
  isEditMode: boolean;
}

const BlankRowElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const defaultRowLength: number =
    DefaultDashboardSize.widthInDashboardUnits;

  return (
    <>
      {Array.from(Array(defaultRowLength).keys()).map(
        (_: number, index: number) => {
          return (
            <BlankDashboardUnitElement
              key={index}
              isEditMode={props.isEditMode}
              onDrop={() => {
                props.onDrop(props.rowNumber, index);
              }}
            />
          );
        },
      )}
    </>
  );
};

export default BlankRowElement;
