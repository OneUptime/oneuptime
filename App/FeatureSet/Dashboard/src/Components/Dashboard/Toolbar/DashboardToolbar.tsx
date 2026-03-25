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
  onVariableValueChange?: ((variableId: string, value: string) => void) | undefined;
  canResetZoom?: boolean | undefined;
  onResetZoom?: (() => void) | undefined;
}

const DashboardToolbar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isEditMode: boolean = props.dashboardMode === DashboardMode.Edit;

  const [showCancelModal, setShowCancelModal] = useState<boolean>(false);

  const isSaving: boolean = props.isSaving;

  const hasComponents: boolean = !!(
    props.dashboardViewConfig &&
    props.dashboardViewConfig.components &&
    props.dashboardViewConfig.components.length > 0
  );

  return (
    <div
      className="mx-3 mt-3 mb-2 rounded-lg bg-white border border-gray-200 overflow-hidden"
      style={{
        boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.04)",
      }}
    >
      {/* Accent top bar */}
      <div
        className="h-0.5"
        style={{
          background: isEditMode
            ? "linear-gradient(90deg, #3b82f6 0%, #6366f1 50%, #8b5cf6 100%)"
            : "linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)",
        }}
      ></div>
      {/* Top row: Dashboard name + action buttons */}
      <div className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-lg font-semibold text-gray-900 truncate">
            {props.dashboardName}
          </h1>
          {isEditMode && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600 border border-blue-100 animate-pulse">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full mr-1.5"></span>
              Editing
            </span>
          )}
          {hasComponents && !isEditMode && (
            <span className="text-xs text-gray-400 tabular-nums">
              {props.dashboardViewConfig.components.length} widget{props.dashboardViewConfig.components.length !== 1 ? "s" : ""}
            </span>
          )}
          {/* Refreshing indicator */}
          {props.isRefreshing &&
            props.autoRefreshInterval !== AutoRefreshInterval.OFF && (
              <span className="inline-flex items-center gap-1.5 text-xs text-blue-600">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></span>
                Refreshing
              </span>
            )}
        </div>

        {!isSaving && (
          <div className="flex items-center gap-1.5">
            {isEditMode ? (
              <>
                <MoreMenu menuIcon={IconProp.Add} text="Add Widget">
                  <MoreMenuItem
                    text={"Chart"}
                    key={"add-chart"}
                    onClick={() => {
                      props.onAddComponentClick(DashboardComponentType.Chart);
                    }}
                  />
                  <MoreMenuItem
                    text={"Value"}
                    key={"add-value"}
                    onClick={() => {
                      props.onAddComponentClick(DashboardComponentType.Value);
                    }}
                  />
                  <MoreMenuItem
                    text={"Text"}
                    key={"add-text"}
                    onClick={() => {
                      props.onAddComponentClick(DashboardComponentType.Text);
                    }}
                  />
                  <MoreMenuItem
                    text={"Table"}
                    key={"add-table"}
                    onClick={() => {
                      props.onAddComponentClick(DashboardComponentType.Table);
                    }}
                  />
                  <MoreMenuItem
                    text={"Gauge"}
                    key={"add-gauge"}
                    onClick={() => {
                      props.onAddComponentClick(DashboardComponentType.Gauge);
                    }}
                  />
                </MoreMenu>

                <div className="w-px h-6 bg-gray-200 mx-1"></div>

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

                <div className="w-px h-6 bg-gray-200 mx-0.5"></div>

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

      {/* Bottom row: Time range + variables (only when components exist and not in edit mode) */}
      {hasComponents && !isEditMode && (
        <div className="flex items-center gap-3 px-5 pb-3 pt-0 flex-wrap">
          <div>
            <RangeStartAndEndDateView
              dashboardStartAndEndDate={props.startAndEndDate}
              onChange={(startAndEndDate: RangeStartAndEndDateTime) => {
                props.onStartAndEndDateChange(startAndEndDate);
              }}
            />
          </div>

          {/* Template variables */}
          {props.variables &&
            props.variables.length > 0 &&
            props.onVariableValueChange && (
              <>
                <div className="w-px h-5 bg-gray-200"></div>
                <DashboardVariableSelector
                  variables={props.variables}
                  onVariableValueChange={props.onVariableValueChange}
                />
              </>
            )}
        </div>
      )}

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
