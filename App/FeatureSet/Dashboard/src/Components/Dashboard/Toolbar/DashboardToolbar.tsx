import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import DashboardMode from "Common/Types/Dashboard/DashboardMode";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import DashboardViewConfig, {
  AutoRefreshInterval,
  getAutoRefreshIntervalInMs,
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

interface CountdownCircleProps {
  durationMs: number;
  size: number;
  strokeWidth: number;
  label: string;
  isRefreshing: boolean;
}

const CountdownCircle: FunctionComponent<CountdownCircleProps> = (
  props: CountdownCircleProps,
): ReactElement => {
  const [progress, setProgress] = useState<number>(0);
  const startTimeRef: React.MutableRefObject<number> = useRef<number>(
    Date.now(),
  );
  const animationFrameRef: React.MutableRefObject<number | null> = useRef<
    number | null
  >(null);

  const animate: () => void = useCallback(() => {
    const elapsed: number = Date.now() - startTimeRef.current;
    const newProgress: number = Math.min(elapsed / props.durationMs, 1);
    setProgress(newProgress);

    if (newProgress < 1) {
      animationFrameRef.current = requestAnimationFrame(animate);
    } else {
      // Reset when complete
      startTimeRef.current = Date.now();
      animationFrameRef.current = requestAnimationFrame(animate);
    }
  }, [props.durationMs]);

  useEffect(() => {
    startTimeRef.current = Date.now();
    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [props.durationMs, animate]);

  // Reset on refresh
  useEffect(() => {
    if (props.isRefreshing) {
      startTimeRef.current = Date.now();
    }
  }, [props.isRefreshing]);

  const radius: number = (props.size - props.strokeWidth) / 2;
  const circumference: number = 2 * Math.PI * radius;
  const strokeDashoffset: number = circumference * (1 - progress);
  const center: number = props.size / 2;

  // Calculate remaining seconds
  const remainingMs: number = props.durationMs * (1 - progress);
  const remainingSec: number = Math.ceil(remainingMs / 1000);

  return (
    <div className="flex items-center gap-1.5">
      <div
        className="relative"
        style={{ width: props.size, height: props.size }}
      >
        <svg
          width={props.size}
          height={props.size}
          className="transform -rotate-90"
        >
          {/* Background circle */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={props.strokeWidth}
          />
          {/* Progress circle */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="#6366f1"
            strokeWidth={props.strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-none"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-[8px] font-semibold text-indigo-600">
          {remainingSec}
        </div>
      </div>
      <span className="text-[11px] text-gray-500 font-medium">
        {props.label}
      </span>
    </div>
  );
};

interface AutoRefreshDropdownProps {
  autoRefreshInterval: AutoRefreshInterval;
  autoRefreshMs: number | null;
  isAutoRefreshActive: boolean;
  isRefreshing: boolean;
  onAutoRefreshIntervalChange: (interval: AutoRefreshInterval) => void;
}

const AutoRefreshDropdown: FunctionComponent<AutoRefreshDropdownProps> = (
  props: AutoRefreshDropdownProps,
): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const dropdownRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside: (event: MouseEvent) => void = (
      event: MouseEvent,
    ): void => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      {/* Trigger: countdown circle when active, refresh icon when not */}
      <button
        type="button"
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors cursor-pointer border ${
          props.isAutoRefreshActive
            ? "bg-indigo-50/50 border-indigo-100 hover:bg-indigo-50"
            : "bg-gray-50 border-gray-200/60 hover:bg-gray-100"
        }`}
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        title="Auto-refresh settings"
      >
        {props.isAutoRefreshActive && props.autoRefreshMs ? (
          <CountdownCircle
            durationMs={props.autoRefreshMs}
            size={20}
            strokeWidth={2}
            label={getAutoRefreshIntervalLabel(props.autoRefreshInterval)}
            isRefreshing={props.isRefreshing}
          />
        ) : (
          <>
            <Icon
              icon={IconProp.Refresh}
              className="w-3.5 h-3.5 text-gray-500"
            />
            <span className="text-xs text-gray-500">Auto-refresh: Off</span>
          </>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 z-10 mt-2 w-56 origin-top-right rounded-lg bg-white shadow-xl ring-1 ring-gray-200 focus:outline-none py-1">
          {Object.values(AutoRefreshInterval).map(
            (interval: AutoRefreshInterval) => {
              const isSelected: boolean =
                interval === props.autoRefreshInterval;
              return (
                <button
                  type="button"
                  key={interval}
                  className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 ${
                    isSelected ? "text-indigo-600 font-medium" : "text-gray-700"
                  }`}
                  onClick={() => {
                    props.onAutoRefreshIntervalChange(interval);
                    setIsOpen(false);
                  }}
                >
                  <span className="w-4 text-center">
                    {isSelected ? "\u2713" : ""}
                  </span>
                  {interval === AutoRefreshInterval.OFF
                    ? "Auto-refresh Off"
                    : `Refresh every ${getAutoRefreshIntervalLabel(interval)}`}
                </button>
              );
            },
          )}
        </div>
      )}
    </div>
  );
};

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

  const isAutoRefreshActive: boolean =
    props.autoRefreshInterval !== AutoRefreshInterval.OFF;
  const autoRefreshMs: number | null = getAutoRefreshIntervalInMs(
    props.autoRefreshInterval,
  );

  return (
    <div className="mx-3 mt-3 mb-3">
      <div
        className="rounded-2xl bg-white border border-gray-200/60"
        style={{
          boxShadow:
            "0 2px 8px -2px rgba(0, 0, 0, 0.08), 0 1px 4px -1px rgba(0, 0, 0, 0.04)",
        }}
      >
        {/* Main toolbar row */}
        <div className="flex items-center justify-between px-4 py-2.5">
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
              </div>
              {props.dashboardDescription && !isEditMode && (
                <p className="text-xs text-gray-400 truncate mt-0.5 max-w-md">
                  {props.dashboardDescription}
                </p>
              )}
            </div>
          </div>

          {/* Right: Time range + Auto-refresh + Variables + Actions */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
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
                      <div className="w-px h-5 bg-gray-200 mx-0.5"></div>
                    </>
                  )}

                <RangeStartAndEndDateView
                  dashboardStartAndEndDate={props.startAndEndDate}
                  onChange={(startAndEndDate: RangeStartAndEndDateTime) => {
                    props.onStartAndEndDateChange(startAndEndDate);
                  }}
                />

                {/* Auto-refresh section */}
                <AutoRefreshDropdown
                  autoRefreshInterval={props.autoRefreshInterval}
                  autoRefreshMs={autoRefreshMs}
                  isAutoRefreshActive={isAutoRefreshActive}
                  isRefreshing={props.isRefreshing || false}
                  onAutoRefreshIntervalChange={
                    props.onAutoRefreshIntervalChange
                  }
                />

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

                {/* More menu: Edit + Full Screen */}
                <MoreMenu
                  menuIcon={IconProp.EllipsisHorizontal}
                  elementToBeShownInsteadOfButton={
                    <button
                      type="button"
                      className="flex items-center justify-center rounded-lg w-8 h-8 bg-gray-50 border border-gray-200/60 hover:bg-gray-100 transition-colors cursor-pointer"
                      title="More options"
                    >
                      <Icon
                        icon={IconProp.EllipsisHorizontal}
                        className="w-4 h-4 text-gray-500"
                      />
                    </button>
                  }
                >
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
                </MoreMenu>
              </>
            )}

            {/* Edit mode actions */}
            {!isSaving && isEditMode && (
              <div className="flex items-center gap-1">
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
                    icon={IconProp.Gauge}
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
                    icon={IconProp.Waterfall}
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
