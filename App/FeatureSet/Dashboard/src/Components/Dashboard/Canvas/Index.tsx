import React, { FunctionComponent, ReactElement } from "react";
import BlankCanvasElement from "./BlankCanvas";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import DefaultDashboardSize, {
  GetDashboardUnitWidthInPx,
  SpaceBetweenUnitsInPx,
  isMobileViewport,
} from "Common/Types/Dashboard/DashboardSize";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import BlankDashboardUnitElement from "./BlankDashboardUnit";
import DashboardBaseComponentElement from "../Components/DashboardBaseComponent";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import ComponentSettingsSideOver from "./ComponentSettingsSideOver";
import JSONFunctions from "Common/Types/JSONFunctions";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import DashboardAnnotation from "Common/Types/Dashboard/DashboardAnnotation";

export interface ComponentProps {
  dashboardViewConfig: DashboardViewConfig;
  onDashboardViewConfigChange: (newConfig: DashboardViewConfig) => void;
  isEditMode: boolean;
  currentTotalDashboardWidthInPx: number;
  onComponentSelected: (componentId: ObjectID) => void;
  onComponentUnselected: () => void;
  selectedComponentId: ObjectID | null;
  metrics: {
    metricTypes: Array<MetricType>;
    telemetryAttributes: string[];
  };
  dashboardStartAndEndDate: RangeStartAndEndDateTime;
  refreshTick?: number | undefined;
  dashboardVariables?: Array<DashboardVariable> | undefined;
  comparisonStartAndEndDate?: RangeStartAndEndDateTime | undefined;
  annotations?: Array<DashboardAnnotation> | undefined;
}

const DashboardCanvas: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const dashboardCanvasRef: React.RefObject<HTMLDivElement> =
    React.useRef<HTMLDivElement>(null);

  const gap: number = SpaceBetweenUnitsInPx;
  const unitSize: number = GetDashboardUnitWidthInPx(
    props.currentTotalDashboardWidthInPx,
  );

  const isMobile: boolean = isMobileViewport(
    props.currentTotalDashboardWidthInPx,
  );

  const renderMobileStack: GetReactElementFunction = (): ReactElement => {
    /*
     * Sort components top-to-bottom, left-to-right based on their saved
     * grid coordinates so the stacked order on mobile mirrors the desktop
     * reading order.
     */
    const sorted: Array<DashboardBaseComponent> = [
      ...props.dashboardViewConfig.components,
    ].sort((a: DashboardBaseComponent, b: DashboardBaseComponent) => {
      if (a.topInDashboardUnits !== b.topInDashboardUnits) {
        return a.topInDashboardUnits - b.topInDashboardUnits;
      }
      return a.leftInDashboardUnits - b.leftInDashboardUnits;
    });

    const mobileItemHeightPx: number = 240;
    const mobileItemWidthPx: number = props.currentTotalDashboardWidthInPx - 16;

    return (
      <div className="flex flex-col gap-3 px-1 py-1">
        {sorted.map((component: DashboardBaseComponent) => {
          return (
            <div
              key={component.componentId.toString()}
              style={{ width: "100%", height: `${mobileItemHeightPx}px` }}
            >
              <DashboardBaseComponentElement
                dashboardViewConfig={props.dashboardViewConfig}
                isEditMode={false}
                dashboardCanvasHeightInPx={
                  dashboardCanvasRef.current?.clientHeight || 0
                }
                dashboardComponentWidthInPx={mobileItemWidthPx}
                dashboardComponentHeightInPx={mobileItemHeightPx}
                metricTypes={props.metrics.metricTypes}
                dashboardStartAndEndDate={props.dashboardStartAndEndDate}
                dashboardCanvasWidthInPx={
                  dashboardCanvasRef.current?.clientWidth || 0
                }
                dashboardCanvasTopInPx={
                  dashboardCanvasRef.current?.clientTop || 0
                }
                dashboardCanvasLeftInPx={
                  dashboardCanvasRef.current?.clientLeft || 0
                }
                totalCurrentDashboardWidthInPx={
                  props.currentTotalDashboardWidthInPx
                }
                componentId={component.componentId}
                key={component.componentId.toString()}
                onComponentUpdate={(
                  updatedComponent: DashboardBaseComponent,
                ) => {
                  updateComponent(updatedComponent);
                }}
                isSelected={false}
                refreshTick={props.refreshTick}
                dashboardVariables={props.dashboardVariables}
                comparisonStartAndEndDate={props.comparisonStartAndEndDate}
                annotations={props.annotations}
                onClick={() => {}}
              />
            </div>
          );
        })}
      </div>
    );
  };

  const renderComponents: GetReactElementFunction = (): ReactElement => {
    if (isMobile) {
      return renderMobileStack();
    }

    const canvasWidth: number = DefaultDashboardSize.widthInDashboardUnits;

    const allComponents: Array<DashboardBaseComponent> =
      props.dashboardViewConfig.components;

    /*
     * Compute occupancy as a sparse Map<row, Set<col>> instead of a dense
     * canvasHeight × canvasWidth 2D array. The dense version allocated
     * 720 cells for a default 60-row dashboard regardless of how many
     * components were on it — and rendered a BlankDashboardUnit for every
     * empty cell in edit mode, which dominated render time on dashboards
     * with only a handful of panels.
     */
    const occupiedByRow: Map<number, Set<number>> = new Map<
      number,
      Set<number>
    >();
    let maxHeightInDashboardUnits: number = 0;

    for (const component of allComponents) {
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
        let rowSet: Set<number> | undefined = occupiedByRow.get(i);
        if (!rowSet) {
          rowSet = new Set<number>();
          occupiedByRow.set(i, rowSet);
        }
        for (
          let j: number = leftInDashboardUnits;
          j < leftInDashboardUnits + widthInDashboardUnits;
          j++
        ) {
          rowSet.add(j);
        }
      }
      maxHeightInDashboardUnits = Math.max(
        maxHeightInDashboardUnits,
        topInDashboardUnits + heightInDashboardUnits,
      );
    }

    /*
     * In edit mode we still want a drop target of a few empty rows below
     * the lowest component so users can extend the dashboard. Cap that at
     * 5 rows instead of always rendering up to the canvas height.
     */
    const editModeExtraRows: number = 5;
    const renderHeight: number = props.isEditMode
      ? maxHeightInDashboardUnits + editModeExtraRows
      : maxHeightInDashboardUnits;

    const renderedComponents: Array<ReactElement> = [];

    /*
     * Render each component once. Sort by (top, left) so React can match
     * keys to layout order and avoid unnecessary node moves.
     */
    const sortedComponents: Array<DashboardBaseComponent> = [
      ...allComponents,
    ].sort((a: DashboardBaseComponent, b: DashboardBaseComponent) => {
      if (a.topInDashboardUnits !== b.topInDashboardUnits) {
        return a.topInDashboardUnits - b.topInDashboardUnits;
      }
      return a.leftInDashboardUnits - b.leftInDashboardUnits;
    });
    for (const component of sortedComponents) {
      renderedComponents.push(renderComponent(component.componentId));
    }

    /*
     * Edit-mode-only: render blank drop targets only for cells that are
     * actually empty AND inside the editable range. Each cell needs an
     * explicit grid-position style now that we no longer rely on
     * implicit ordering from the dense iteration.
     */
    if (props.isEditMode) {
      for (let i: number = 0; i < renderHeight; i++) {
        const occupiedCols: Set<number> | undefined = occupiedByRow.get(i);
        for (let j: number = 0; j < canvasWidth; j++) {
          if (occupiedCols && occupiedCols.has(j)) {
            continue;
          }
          renderedComponents.push(
            <div
              key={`blank-unit-${i}-${j}`}
              style={{
                gridRowStart: i + 1,
                gridColumnStart: j + 1,
              }}
            >
              <BlankDashboardUnitElement
                isEditMode={true}
                onClick={() => {
                  props.onComponentUnselected();
                }}
                id={`blank-unit-${i}-${j}`}
              />
            </div>,
          );
        }
      }
    }

    return (
      <div
        ref={dashboardCanvasRef}
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${canvasWidth}, 1fr)`,
          gridTemplateRows: `repeat(${Math.max(renderHeight, 1)}, ${unitSize}px)`,
          gap: `${gap}px`,
          gridAutoRows: `${unitSize}px`,
          borderRadius: "16px",
          padding: "8px",
        }}
      >
        {renderedComponents}
      </div>
    );
  };

  type RenderComponentFunction = (componentId: ObjectID) => ReactElement;

  type UpdateComponentFunction = (
    updatedComponent: DashboardBaseComponent,
  ) => void;

  const updateComponent: UpdateComponentFunction = (
    updatedComponent: DashboardBaseComponent,
  ): void => {
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

    props.onDashboardViewConfigChange(
      JSONFunctions.deserializeValue(
        updatedDashboardViewConfig,
      ) as DashboardViewConfig,
    );
  };

  const renderComponent: RenderComponentFunction = (
    componentId: ObjectID,
  ): ReactElement => {
    const isSelected: boolean =
      props.selectedComponentId?.toString() === componentId.toString();

    const component: DashboardBaseComponent | undefined =
      props.dashboardViewConfig.components.find((c: DashboardBaseComponent) => {
        return c.componentId.toString() === componentId.toString();
      });

    const w: number = component?.widthInDashboardUnits || 0;
    const h: number = component?.heightInDashboardUnits || 0;

    // Compute pixel dimensions for child component rendering (charts, etc.)
    const widthOfComponentInPx: number = unitSize * w + gap * (w - 1);

    const heightOfComponentInPx: number = unitSize * h + gap * (h - 1);

    return (
      <DashboardBaseComponentElement
        dashboardViewConfig={props.dashboardViewConfig}
        isEditMode={props.isEditMode}
        dashboardCanvasHeightInPx={
          dashboardCanvasRef.current?.clientHeight || 0
        }
        dashboardComponentWidthInPx={widthOfComponentInPx}
        dashboardComponentHeightInPx={heightOfComponentInPx}
        metricTypes={props.metrics.metricTypes}
        dashboardStartAndEndDate={props.dashboardStartAndEndDate}
        dashboardCanvasWidthInPx={dashboardCanvasRef.current?.clientWidth || 0}
        dashboardCanvasTopInPx={dashboardCanvasRef.current?.clientTop || 0}
        dashboardCanvasLeftInPx={dashboardCanvasRef.current?.clientLeft || 0}
        totalCurrentDashboardWidthInPx={props.currentTotalDashboardWidthInPx}
        componentId={componentId}
        key={componentId.toString()}
        onComponentUpdate={(updatedComponent: DashboardBaseComponent) => {
          updateComponent(updatedComponent);
        }}
        isSelected={isSelected}
        refreshTick={props.refreshTick}
        dashboardVariables={props.dashboardVariables}
        comparisonStartAndEndDate={props.comparisonStartAndEndDate}
        annotations={props.annotations}
        onClick={() => {
          props.onComponentSelected(componentId);
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

  return (
    <div>
      {renderComponents()}
      {props.selectedComponentId && props.isEditMode && (
        <ComponentSettingsSideOver
          title="Component Settings"
          description="Edit the settings of this component"
          dashboardViewConfig={props.dashboardViewConfig}
          onClose={() => {
            props.onComponentUnselected();
          }}
          onComponentDelete={() => {
            const updatedComponents: Array<DashboardBaseComponent> =
              props.dashboardViewConfig.components.filter(
                (c: DashboardBaseComponent) => {
                  return (
                    c.componentId.toString() !==
                    props.selectedComponentId?.toString()
                  );
                },
              );

            const updatedDashboardViewConfig: DashboardViewConfig = {
              ...props.dashboardViewConfig,
              components: [...updatedComponents],
            };

            props.onDashboardViewConfigChange(updatedDashboardViewConfig);
          }}
          componentId={props.selectedComponentId}
          onComponentUpdate={(updatedComponent: DashboardBaseComponent) => {
            updateComponent(updatedComponent);
          }}
          metrics={props.metrics}
        />
      )}
    </div>
  );
};

export default DashboardCanvas;
