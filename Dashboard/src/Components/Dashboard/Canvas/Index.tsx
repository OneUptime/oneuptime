import React, { FunctionComponent, ReactElement } from "react";
import BlankCanvasElement from "./BlankCanvas";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import DefaultDashboardSize from "Common/Types/Dashboard/DashboardSize";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import BlankDashboardUnitElement from "./DashboardUnit";
import DashboardBaseComponentElement from "../Components/DashboardBaseComponent";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";

export interface ComponentProps {
  dashboardViewConfig: DashboardViewConfig;
  onDashboardViewConfigChange: (newConfig: DashboardViewConfig) => void;
  isEditMode: boolean;
  currentTotalDashboardWidthInPx: number;
}

const DashboardCanvas: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const dashboardCanvasRef: React.RefObject<HTMLDivElement> =
    React.useRef<HTMLDivElement>(null);

  const renderComponents: GetReactElementFunction = (): ReactElement => {
    const canvasHeight: number =
      props.dashboardViewConfig.heightInDashboardUnits ||
      DefaultDashboardSize.heightInDashboardUnits;

    const canvasWidth: number = DefaultDashboardSize.widthInDashboardUnits;

    const allComponents: Array<DashboardBaseComponent> =
      props.dashboardViewConfig.components;

    // Create a 2D array to represent the grid
    const grid: Array<Array<DashboardBaseComponent | null>> = [];

    // Fill the grid with null initially
    for (let row: number = 0; row < canvasHeight; row++) {
      grid[row] = new Array(canvasWidth).fill(null);
    }

    // Place components in the grid
    allComponents.forEach((component: DashboardBaseComponent) => {
      const {
        topInDashboardUnits,
        leftInDashboardUnits,
        widthInDashboardUnits,
        heightInDashboardUnits,
      } = component;

      for (
        let i: number = topInDashboardUnits;
        i < topInDashboardUnits + heightInDashboardUnits;
        i++
      ) {
        if (!grid[i]) {
          grid[i] = new Array(canvasWidth).fill(null);
        }

        for (
          let j: number = leftInDashboardUnits;
          j < leftInDashboardUnits + widthInDashboardUnits;
          j++
        ) {
          grid[i]![j] = component;
        }
      }
    });

    const renderedComponentsIds: Array<string> = [];

    const renderedComponents: Array<ReactElement | null> = [];

    for (let i: number = 0; i < canvasHeight; i++) {
      for (let j: number = 0; j < canvasWidth; j++) {
        const component: DashboardBaseComponent | null | undefined =
          grid[i]![j];

        if (
          component &&
          !renderedComponentsIds.includes(component.componentId.toString())
        ) {
          renderedComponents.push(renderComponent(component.componentId));
          renderedComponentsIds.push(component.componentId.toString());
        }

        if (!component) {
          // render a blank unit
          renderedComponents.push(
            <BlankDashboardUnitElement
              currentTotalDashboardWidthInPx={
                props.currentTotalDashboardWidthInPx
              }
              isEditMode={props.isEditMode}
              key={`blank-${i}-${j}`}
              onClick={() => {
                // unselect the component
                setSelectedComponentId(null);
              }}
            />,
          );
        }
      }
    }

    // remove nulls from the renderedComponents array

    const finalRenderedComponents: Array<ReactElement> =
      renderedComponents.filter(
        (component: ReactElement | null): component is ReactElement => {
          return component !== null;
        },
      );

    const width: number = DefaultDashboardSize.widthInDashboardUnits;

    return (
      <div ref={dashboardCanvasRef} className={`grid grid-cols-${width}`}>
        {finalRenderedComponents}
      </div>
    );
  };

  const [selectedComponentId, setSelectedComponentId] = React.useState<
    string | null
  >(null);

  type RenderComponentFunction = (componentId: ObjectID) => ReactElement;

  const renderComponent: RenderComponentFunction = (
    componentId: ObjectID,
  ): ReactElement => {
    return (
      <DashboardBaseComponentElement
        dashboardViewConfig={props.dashboardViewConfig}
        isEditMode={props.isEditMode}
        dashboardCanvasHeightInPx={
          dashboardCanvasRef.current?.clientHeight || 0
        }
        dashboardCanvasWidthInPx={dashboardCanvasRef.current?.clientWidth || 0}
        dashboardCanvasTopInPx={dashboardCanvasRef.current?.clientTop || 0}
        dashboardCanvasLeftInPx={dashboardCanvasRef.current?.clientLeft || 0}
        totalCurrentDashboardWidthInPx={props.currentTotalDashboardWidthInPx}
        componentId={componentId}
        key={componentId.toString()}
        isSelected={selectedComponentId === componentId.toString()}
        onClick={() => {
          // component is selected
          setSelectedComponentId(componentId.toString());
        }}
        onComponentUpdate={(updatedComponent: DashboardBaseComponent) => {
          const updatedComponents: Array<DashboardBaseComponent> =
            props.dashboardViewConfig.components.map(
              (component: DashboardBaseComponent) => {
                if (
                  component.componentId.toString() ===
                  updatedComponent.componentId.toString()
                ) {
                  return { ...updatedComponent };
                }

                return component;
              },
            );

          const updatedDashboardViewConfig: DashboardViewConfig = {
            ...props.dashboardViewConfig,
            components: [...updatedComponents],
          };

          props.onDashboardViewConfigChange(updatedDashboardViewConfig);
        }}
      />
    );
  };

  if (
    !props.dashboardViewConfig ||
    props.dashboardViewConfig.components.length === 0
  ) {
    return (
      <BlankCanvasElement
        totalCurrentDashboardWidthInPx={props.currentTotalDashboardWidthInPx}
        isEditMode={props.isEditMode}
        onClick={() => {}}
        dashboardViewConfig={props.dashboardViewConfig}
      />
    );
  }

  return renderComponents();
};

export default DashboardCanvas;
