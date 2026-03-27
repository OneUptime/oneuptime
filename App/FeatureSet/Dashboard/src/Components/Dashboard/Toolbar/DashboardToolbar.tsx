import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonSize, ButtonStyleType } from "Common/UI/Components/Button/Button";
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
import Icon from "Common/UI/Components/Icon/Icon";

export interface ComponentProps {
  onEditClick: () => void;
  onSaveClick: () => void;
  onCancelEditClick: () => void;
  onFullScreenClick: () => void;
  dashboardMode: DashboardMode;
  onAddComponentClick: (type: DashboardComponentType) => void;
  isSaving: boolean;
  dashboardName: string;
  dashboardDescription?: string | undefined;
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
    <div className="mx-4 mt-4 mb-3">
      <div
        className="rounded-xl bg-white border border-gray-200/60"
        style={{
          boxShadow:
            "0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.03)",
        }}
      >
        {/* Main toolbar row */}
        <div className="flex items-center justify-between px-4 py-3">
          {/* Left: Icon + Title + Description */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
              <Icon
                icon={IconProp.Layout}
                className="w-4 h-4 text-indigo-500"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-semibold text-gray-800 truncate">
                  {props.dashboardName}
                </h1>
                {isEditMode && (
                  <span className="inline-flex items-center px-1.5 py-px rounded-full text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-100 animate-pulse">
                    <span className="w-1 h-1 bg-blue-500 rounded-full mr-1"></span>
                    Editing
                  </span>
                )}
                {props.isRefreshing &&
                  props.autoRefreshInterval !== AutoRefreshInterval.OFF && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-blue-500">
                      <span className="w-1 h-1 bg-blue-500 rounded-full animate-pulse"></span>
                      Refreshing
                    </span>
                  )}
              </div>
              {props.dashboardDescription && !isEditMode && (
                <p className="text-xs text-gray-400 truncate mt-0.5 max-w-md">
                  {props.dashboardDescription}
                </p>
              )}
            </div>
          </div>

          {/* Right: Time range + Variables + Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Time range + variables (view mode only) */}
            {hasComponents && !isEditMode && (
              <>
                {/* Template variables */}
                {props.variables &&
                  props.variables.length > 0 &&
                  props.onVariableValueChange && (
                    <>
                      <DashboardVariableSelector
                        variables={props.variables}
                        onVariableValueChange={props.onVariableValueChange}
                      />
                      <div className="w-px h-4 bg-gray-200"></div>
                    </>
                  )}

                <RangeStartAndEndDateView
                  dashboardStartAndEndDate={props.startAndEndDate}
                  onChange={(startAndEndDate: RangeStartAndEndDateTime) => {
                    props.onStartAndEndDateChange(startAndEndDate);
                  }}
                />
              </>
            )}

            {/* Action buttons */}
            {!isSaving && (
              <>
                {isEditMode ? (
                  <div className="flex items-center gap-1">
                    <MoreMenu menuIcon={IconProp.Add} text="Add Widget">
                      <MoreMenuItem
                        text={"Chart"}
                        icon={IconProp.ChartBar}
                        key={"add-chart"}
                        onClick={() => {
                          props.onAddComponentClick(
                            DashboardComponentType.Chart,
                          );
                        }}
                      />
                      <MoreMenuItem
                        text={"Value"}
                        icon={IconProp.Hashtag}
                        key={"add-value"}
                        onClick={() => {
                          props.onAddComponentClick(
                            DashboardComponentType.Value,
                          );
                        }}
                      />
                      <MoreMenuItem
                        text={"Text"}
                        icon={IconProp.Text}
                        key={"add-text"}
                        onClick={() => {
                          props.onAddComponentClick(
                            DashboardComponentType.Text,
                          );
                        }}
                      />
                      <MoreMenuItem
                        text={"Table"}
                        icon={IconProp.TableCells}
                        key={"add-table"}
                        onClick={() => {
                          props.onAddComponentClick(
                            DashboardComponentType.Table,
                          );
                        }}
                      />
                      <MoreMenuItem
                        text={"Gauge"}
                        icon={IconProp.Activity}
                        key={"add-gauge"}
                        onClick={() => {
                          props.onAddComponentClick(
                            DashboardComponentType.Gauge,
                          );
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
                      buttonSize={ButtonSize.Small}
                      onClick={props.onSaveClick}
                    />
                    <Button
                      icon={IconProp.Close}
                      title="Cancel"
                      buttonStyle={ButtonStyleType.HOVER_DANGER_OUTLINE}
                      buttonSize={ButtonSize.Small}
                      onClick={() => {
                        setShowCancelModal(true);
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-0.5">
                    {/* Reset Zoom button */}
                    {props.canResetZoom && props.onResetZoom && (
                      <Button
                        icon={IconProp.Refresh}
                        title="Reset Zoom"
                        buttonStyle={ButtonStyleType.HOVER_PRIMARY_OUTLINE}
                        buttonSize={ButtonSize.Small}
                        onClick={props.onResetZoom}
                        tooltip="Reset to original time range"
                      />
                    )}

                    <MoreMenu menuIcon={IconProp.More}>
                      <MoreMenuItem
                        text={"Edit Dashboard"}
                        icon={IconProp.Pencil}
                        key={"edit"}
                        onClick={props.onEditClick}
                      />
                      <MoreMenuItem
                        text={"Full Screen"}
                        icon={IconProp.Expand}
                        key={"fullscreen"}
                        onClick={props.onFullScreenClick}
                      />
                      {hasComponents &&
                        Object.values(AutoRefreshInterval).map(
                          (interval: AutoRefreshInterval) => {
                            return (
                              <MoreMenuItem
                                key={interval}
                                text={getAutoRefreshIntervalLabel(interval)}
                                icon={IconProp.Refresh}
                                onClick={() => {
                                  props.onAutoRefreshIntervalChange(interval);
                                }}
                              />
                            );
                          },
                        )}
                    </MoreMenu>
                  </div>
                )}
              </>
            )}

            {isSaving && (
              <div className="flex items-center gap-2">
                <Loader />
                <span className="text-xs text-gray-500">Saving...</span>
              </div>
            )}
          </div>
        </div>
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
