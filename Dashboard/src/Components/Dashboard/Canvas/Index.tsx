import React, { FunctionComponent, ReactElement } from "react";
import BlankCanvasElement from "./BlankCanvas";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import DefaultDashboardSize from "Common/Types/Dashboard/DashboardSize";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import BlankDashboardUnitElement from "./DashboardUnit";

export interface ComponentProps {
  dashboardViewConfig: DashboardViewConfig;
  onDashboardViewConfigChange: (newConfig: DashboardViewConfig) => void;
  isEditMode: boolean;
}

const DashboardCanvas: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {


  const renderComponents = (): ReactElement => {

    const canvasHeight: number =
      props.dashboardViewConfig.heightInDashboardUnits ||
      DefaultDashboardSize.heightInDashboardUnits;


    const canvasWidth: number = DefaultDashboardSize.widthInDashboardUnits;


    const allComponents: Array<DashboardBaseComponent> = props.dashboardViewConfig.components;

    // Create a 2D array to represent the grid
    const grid: Array<Array<DashboardBaseComponent | null>> = [];

    // Fill the grid with null initially
    for (let row = 0; row < canvasHeight; row++) {
      grid[row] = new Array(canvasWidth).fill(null);
    }


    // Place components in the grid
    allComponents.forEach((component: DashboardBaseComponent) => {

      const { topInDashboardUnits, leftInDashboardUnits, widthInDashboardUnits, heightInDashboardUnits } = component;

      for (let i = topInDashboardUnits; i < topInDashboardUnits + heightInDashboardUnits; i++) {

        if (!grid[i]) {
          grid[i] = new Array(canvasWidth).fill(null);
        }

        for (let j = leftInDashboardUnits; j < leftInDashboardUnits + widthInDashboardUnits; j++) {
          grid[i]![j] = component;
        }
      }
    });


    const renderedComponentsIds: Array<string> = [];

    const renderedComponents: Array<ReactElement | null> = [];

    for (let i = 0; i < canvasHeight; i++) {
      for (let j = 0; j < canvasWidth; j++) {
        const component: DashboardBaseComponent | null | undefined = grid[i]![j];
        if (component && !renderedComponentsIds.includes(component.componentId.toString())) {
          renderedComponents.push(renderComponent(component));
          renderedComponentsIds.push(component.id);
        }

        if (!component) {
          // render a blank unit
          renderedComponents.push(<BlankDashboardUnitElement
            onDrop={() => { }}
            isEditMode={props.isEditMode}
            key={`blank-${i}-${j}`} />)
            ;
        }
      }
    }

  }


  const renderComponent = (component: DashboardBaseComponent): ReactElement => {

    return <DashboardBasec

  };

  if (!props.dashboardViewConfig || props.dashboardViewConfig.components.length === 0) {
    return <BlankCanvasElement
      isEditMode={props.isEditMode}
      onDrop={() => { }}
      dashboardViewConfig={props.dashboardViewConfig}
    />;
  }

  return renderComponents();
};

export default DashboardCanvas;
