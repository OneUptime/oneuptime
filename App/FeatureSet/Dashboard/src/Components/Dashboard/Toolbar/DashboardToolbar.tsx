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

  return (
    <div
      className={`mt-1.5 mb-1.5 ml-1 mr-1 p-1 h-20 pt-5 pb-5 pl-4 pr-4 rounded bg-white border-2 border-gray-100`}
    >
      <div className="w-full flex justify-between">
        <div className="text-md font-medium mt-2">
          {/* Name Component */}
          {props.dashboardName}
        </div>
        {!isSaving && (
          <div className="flex">
            {props.dashboardViewConfig &&
              props.dashboardViewConfig.components &&
              props.dashboardViewConfig.components.length > 0 && (
                <div className="mt-1.5">
                  <RangeStartAndEndDateView
                    dashboardStartAndEndDate={props.startAndEndDate}
                    onChange={(startAndEndDate: RangeStartAndEndDateTime) => {
                      props.onStartAndEndDateChange(startAndEndDate);
                    }}
                  />
                </div>
              )}

            {/* Template variables */}
            {props.variables &&
              props.variables.length > 0 &&
              props.onVariableValueChange && (
                <div className="mt-1.5 mr-2">
                  <DashboardVariableSelector
                    variables={props.variables}
                    onVariableValueChange={props.onVariableValueChange}
                  />
                </div>
              )}

            {/* Reset Zoom button */}
            {props.canResetZoom && props.onResetZoom && !isEditMode && (
              <Button
                icon={IconProp.Refresh}
                title="Reset Zoom"
                buttonStyle={ButtonStyleType.HOVER_PRIMARY_OUTLINE}
                onClick={props.onResetZoom}
                tooltip="Reset to original time range"
              />
            )}

            {/* Auto-refresh dropdown - only show in view mode */}
            {!isEditMode &&
              props.dashboardViewConfig &&
              props.dashboardViewConfig.components &&
              props.dashboardViewConfig.components.length > 0 && (
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

            {/* Refreshing indicator */}
            {props.isRefreshing &&
              props.autoRefreshInterval !== AutoRefreshInterval.OFF && (
                <div className="flex items-center ml-2">
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                </div>
              )}

            {isEditMode ? (
              <MoreMenu menuIcon={IconProp.Add} text="Add Component">
                <MoreMenuItem
                  text={"Add Chart"}
                  key={"add-chart"}
                  onClick={() => {
                    props.onAddComponentClick(DashboardComponentType.Chart);
                  }}
                />
                <MoreMenuItem
                  text={"Add Value"}
                  key={"add-value"}
                  onClick={() => {
                    props.onAddComponentClick(DashboardComponentType.Value);
                  }}
                />
                <MoreMenuItem
                  text={"Add Text"}
                  key={"add-text"}
                  onClick={() => {
                    props.onAddComponentClick(DashboardComponentType.Text);
                  }}
                />
                <MoreMenuItem
                  text={"Add Table"}
                  key={"add-table"}
                  onClick={() => {
                    props.onAddComponentClick(DashboardComponentType.Table);
                  }}
                />
                <MoreMenuItem
                  text={"Add Gauge"}
                  key={"add-gauge"}
                  onClick={() => {
                    props.onAddComponentClick(DashboardComponentType.Gauge);
                  }}
                />
              </MoreMenu>
            ) : (
              <></>
            )}

            {!isEditMode && (
              <Button
                icon={IconProp.Expand}
                buttonStyle={ButtonStyleType.ICON}
                onClick={props.onFullScreenClick}
                tooltip="Full Screen"
              />
            )}

            {!isEditMode && (
              <Button
                icon={IconProp.Pencil}
                title="Edit"
                buttonStyle={ButtonStyleType.ICON}
                onClick={props.onEditClick}
                tooltip="Edit"
              />
            )}

            {isEditMode && (
              <Button
                icon={IconProp.Check}
                title="Save"
                buttonStyle={ButtonStyleType.HOVER_PRIMARY_OUTLINE}
                onClick={props.onSaveClick}
              />
            )}
            {isEditMode && (
              <Button
                icon={IconProp.Close}
                title="Cancel"
                buttonStyle={ButtonStyleType.HOVER_DANGER_OUTLINE}
                onClick={() => {
                  setShowCancelModal(true);
                }}
              />
            )}
          </div>
        )}
        {isSaving && (
          <div className="flex items-center">
            <Loader />
            <div className="ml-2 text-sm text-gray-400">Saving...</div>
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
