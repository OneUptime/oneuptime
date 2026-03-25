import React, { FunctionComponent, ReactElement } from "react";
import DefaultDashboardSize from "Common/Types/Dashboard/DashboardSize";
import BlankRowElement from "./BlankRow";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";

export interface ComponentProps {
  dashboardViewConfig: DashboardViewConfig;
  onClick: (top: number, left: number) => void;
  isEditMode: boolean;
  totalCurrentDashboardWidthInPx: number;
}

const BlankCanvasElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const height: number =
    props.dashboardViewConfig.heightInDashboardUnits ||
    DefaultDashboardSize.heightInDashboardUnits;

  const width: number = DefaultDashboardSize.widthInDashboardUnits;

  if (!props.isEditMode && props.dashboardViewConfig.components.length === 0) {
    return (
      <div className="mx-3 mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50/50 text-center py-20 px-10">
        <div className="mx-auto w-14 h-14 rounded-full bg-white border border-gray-200 flex items-center justify-center mb-4"
          style={{ boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.04)" }}
        >
          <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-gray-700 mb-1">No widgets yet</h3>
        <p className="text-sm text-gray-400 max-w-sm mx-auto">
          Click <strong className="text-gray-500">Edit</strong> to start adding charts, values, gauges, and more to this dashboard.
        </p>
      </div>
    );
  }

  // have a grid with width cols and height rows
  return (
    <div className={`grid grid-cols-${width}`}>
      {Array.from(Array(height).keys()).map((_: number, index: number) => {
        return (
          <BlankRowElement
            key={index}
            totalCurrentDashboardWidthInPx={
              props.totalCurrentDashboardWidthInPx
            }
            isEditMode={props.isEditMode}
            rowNumber={index}
            onClick={(top: number, left: number) => {
              props.onClick(top, left);
            }}
          />
        );
      })}
    </div>
  );
};

export default BlankCanvasElement;
