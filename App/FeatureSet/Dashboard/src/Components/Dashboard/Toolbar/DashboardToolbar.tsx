import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import React, { FunctionComponent, ReactElement, useState } from "react";
import DashboardMode from "Common/Types/Dashboard/DashboardMode";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import DashboardViewConfig, {
  AutoRefreshInterval,
  getAutoRefreshIntervalLabel,
} from "Common/Types/Dashboard/DashboardViewConfig";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Loader from "Common/UI/Components/Loader/Loader";
import DashboardVariableSelector from "./DashboardVariableSelector";

export interface ComponentProps {
  onEditClick: () => void;
  onSaveClick: () => void;
  onCancelEditClick: () => void;
  onFullScreenClick: () => void;
  dashboardMode: DashboardMode;
  onAddComponentClick: (type: DashboardComponentType) => void;
  isSaving: boolean;
  dashboardName: string;
  startAndEndDate: RangeStartAndEndDateTime;
  onStartAndEndDateChange: (startAndEndDate: RangeStartAndEndDateTime) => void;
  dashboardViewConfig: DashboardViewConfig;
  autoRefreshInterval: AutoRefreshInterval;
  onAutoRefreshIntervalChange: (interval: AutoRefreshInterval) => void;
  isRefreshing?: boolean | undefined;
  variables?: Array<DashboardVariable> | undefined;
  onVariableValueChange?:
    | ((variableId: string, value: string) => void)
    | undefined;
  canResetZoom?: boolean | undefined;
  onResetZoom?: (() => void) | undefined;
}

const DashboardToolbar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isEditMode: boolean = props.dashboardMode === DashboardMode.Edit;

  const [showCancelModal, setShowCancelModal] = useState<boolean>(false);

  const isSaving: boolean = props.isSaving;

  const hasComponents: boolean = Boolean(
    props.dashboardViewConfig &&
      props.dashboardViewConfig.components &&
      props.dashboardViewConfig.components.length > 0,
  );

  return (
    <div
      className="mx-4 mt-3 mb-2 rounded-lg bg-white border border-gray-100"
      style={{
        boxShadow:
          "0 1px 2px 0 rgba(0, 0, 0, 0.03)",
      }}
    >
      {/* Single row: Dashboard name + time range + variables + action buttons */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
          <h1 className="text-sm font-semibold text-gray-800 truncate">
            {props.dashboardName}
          </h1>
          {isEditMode && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600 border border-blue-100 animate-pulse">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full mr-1"></span>
              Editing
            </span>
          )}
          {hasComponents && !isEditMode && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs text-gray-400">
              {props.dashboardViewConfig.components.length} widget
              {props.dashboardViewConfig.components.length !== 1 ? "s" : ""}
            </span>
          )}

          {/* Time range + variables inline (only when components exist and not in edit mode) */}
          {hasComponents && !isEditMode && (
            <>
              <div className="w-px h-4 bg-gray-200"></div>
              <RangeStartAndEndDateView
                dashboardStartAndEndDate={props.startAndEndDate}
                onChange={(startAndEndDate: RangeStartAndEndDateTime) => {
                  props.onStartAndEndDateChange(startAndEndDate);
                }}
              />

              {/* Template variables */}
              {props.variables &&
                props.variables.length > 0 &&
                props.onVariableValueChange && (
                  <>
                    <div className="w-px h-4 bg-gray-200"></div>
                    <DashboardVariableSelector
                      variables={props.variables}
                      onVariableValueChange={props.onVariableValueChange}
                    />
                  </>
                )}
            </>
          )}

          {/* Refreshing indicator */}
          {props.isRefreshing &&
            props.autoRefreshInterval !== AutoRefreshInterval.OFF && (
              <span className="inline-flex items-center gap-1 text-xs text-blue-600">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></span>
                Refreshing
              </span>
            )}
        </div>

        {!isSaving && (
          <div className="flex items-center gap-1 ml-2 flex-shrink-0">
            {isEditMode ? (
              <>
                <MoreMenu menuIcon={IconProp.Add} text="Add Widget">
                  <MoreMenuItem
                    text={"Chart"}
                    icon={IconProp.ChartBar}
                    key={"add-chart"}
                    onClick={() => {
                      props.onAddComponentClick(DashboardComponentType.Chart);
                    }}
                  />
                  <MoreMenuItem
                    text={"Value"}
                    icon={IconProp.Hashtag}
                    key={"add-value"}
                    onClick={() => {
                      props.onAddComponentClick(DashboardComponentType.Value);
                    }}
                  />
                  <MoreMenuItem
                    text={"Text"}
                    icon={IconProp.Text}
                    key={"add-text"}
                    onClick={() => {
                      props.onAddComponentClick(DashboardComponentType.Text);
                    }}
                  />
                  <MoreMenuItem
                    text={"Table"}
                    icon={IconProp.TableCells}
                    key={"add-table"}
                    onClick={() => {
                      props.onAddComponentClick(DashboardComponentType.Table);
                    }}
                  />
                  <MoreMenuItem
                    text={"Gauge"}
                    icon={IconProp.Activity}
                    key={"add-gauge"}
                    onClick={() => {
                      props.onAddComponentClick(DashboardComponentType.Gauge);
                    }}
                  />
                  <MoreMenuItem
                    text={"Log Stream"}
                    icon={IconProp.Logs}
                    key={"add-log-stream"}
                    onClick={() => {
                      props.onAddComponentClick(
                        DashboardComponentType.LogStream,
                      );
                    }}
                  />
                  <MoreMenuItem
                    text={"Trace List"}
                    icon={IconProp.QueueList}
                    key={"add-trace-list"}
                    onClick={() => {
                      props.onAddComponentClick(
                        DashboardComponentType.TraceList,
                      );
                    }}
                  />
                </MoreMenu>

                <div className="w-px h-5 bg-gray-200 mx-0.5"></div>

                <Button
                  icon={IconProp.Check}
                  title="Save"
                  buttonStyle={ButtonStyleType.HOVER_PRIMARY_OUTLINE}
                  onClick={props.onSaveClick}
                />
                <Button
                  icon={IconProp.Close}
                  title="Cancel"
                  buttonStyle={ButtonStyleType.HOVER_DANGER_OUTLINE}
                  onClick={() => {
                    setShowCancelModal(true);
                  }}
                />
              </>
            ) : (
              <>
                {/* Reset Zoom button */}
                {props.canResetZoom && props.onResetZoom && (
                  <Button
                    icon={IconProp.Refresh}
                    title="Reset Zoom"
                    buttonStyle={ButtonStyleType.HOVER_PRIMARY_OUTLINE}
                    onClick={props.onResetZoom}
                    tooltip="Reset to original time range"
                  />
                )}

                {/* Auto-refresh dropdown */}
                {hasComponents && (
                  <MoreMenu
                    menuIcon={IconProp.Refresh}
                    text={
                      props.autoRefreshInterval !== AutoRefreshInterval.OFF
                        ? getAutoRefreshIntervalLabel(props.autoRefreshInterval)
                        : ""
                    }
                  >
                    {Object.values(AutoRefreshInterval).map(
                      (interval: AutoRefreshInterval) => {
                        return (
                          <MoreMenuItem
                            key={interval}
                            text={getAutoRefreshIntervalLabel(interval)}
                            onClick={() => {
                              props.onAutoRefreshIntervalChange(interval);
                            }}
                          />
                        );
                      },
                    )}
                  </MoreMenu>
                )}

                <Button
                  icon={IconProp.Expand}
                  buttonStyle={ButtonStyleType.ICON}
                  onClick={props.onFullScreenClick}
                  tooltip="Full Screen"
                />

                <div className="w-px h-4 bg-gray-200 mx-0.5"></div>

                <Button
                  icon={IconProp.Pencil}
                  title="Edit"
                  buttonStyle={ButtonStyleType.ICON}
                  onClick={props.onEditClick}
                  tooltip="Edit Dashboard"
                />
              </>
            )}
          </div>
        )}

        {isSaving && (
          <div className="flex items-center gap-2">
            <Loader />
            <span className="text-sm text-gray-500">Saving...</span>
          </div>
        )}
      </div>

      {showCancelModal ? (
        <ConfirmModal
          title={`Are you sure?`}
          description={
            "You have unsaved changes. Are you sure you want to cancel?"
          }
          submitButtonType={ButtonStyleType.DANGER}
          submitButtonText={"Discard Changes"}
          closeButtonText={"Keep Editing"}
          onSubmit={() => {
            props.onCancelEditClick();
            setShowCancelModal(false);
          }}
          onClose={() => {
            setShowCancelModal(false);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default DashboardToolbar;
