import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useId,
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
import DashboardVariablesModal from "./DashboardVariablesModal";
import Icon from "Common/UI/Components/Icon/Icon";
import AddWidgetModal from "./AddWidgetModal";
import DashboardDefaultsBar from "./DashboardDefaultsBar";
import useToolbarChoiceMenuKeys from "./UseToolbarChoiceMenuKeys";
import {
  AUTO_REFRESH_DEFAULT_CHOICE_TEST_ID,
  getAutoRefreshChoiceLabel,
} from "./DashboardDefaultsCopy";
import DashboardStackingLayers from "Common/UI/Utils/DashboardStackingLayers";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TimeRange from "Common/Types/Time/TimeRange";
import { DASHBOARD_TIME_RANGE_FALLBACK } from "Common/Types/Dashboard/DashboardTimeRange";
import { DASHBOARD_AUTO_REFRESH_FALLBACK } from "Common/Types/Dashboard/DashboardAutoRefresh";
import { getDefaultChoiceLabel } from "Common/UI/Utils/DefaultChoiceLabel";

/*
 * The toolbar's main row; the box at its end that holds the controls and
 * the ⋯ menu; and the controls.
 */
export const DASHBOARD_TOOLBAR_ROW_TEST_ID: string = "dashboard-toolbar-row";
export const DASHBOARD_TOOLBAR_END_TEST_ID: string = "dashboard-toolbar-end";
export const DASHBOARD_TOOLBAR_CONTROLS_TEST_ID: string =
  "dashboard-toolbar-controls";

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
  /*
   * A drag-selection on a time-series widget has narrowed the whole board.
   * The picker then reads "Custom", which says nothing about there being a
   * way back — so the toolbar spells one out next to it, alongside the
   * double-click gesture on the panels themselves.
   */
  isTimeRangeZoomed?: boolean | undefined;
  onResetTimeRangeZoom?: (() => void) | undefined;
  dashboardViewConfig: DashboardViewConfig;
  autoRefreshInterval: AutoRefreshInterval;
  onAutoRefreshIntervalChange: (interval: AutoRefreshInterval) => void;
  isRefreshing?: boolean | undefined;
  variables?: Array<DashboardVariable> | undefined;
  onVariableValueChange?:
    | ((
        variableId: string,
        change: {
          selectedValue?: string | undefined;
          selectedValues?: Array<string> | undefined;
        },
      ) => void)
    | undefined;
  onVariablesDefinitionChange?:
    | ((variables: Array<DashboardVariable>) => void)
    | undefined;
  telemetryAttributeOptions?: Array<string> | undefined;
  /*
   * Whether the signed-in user may write to this dashboard. False hides or
   * locks every affordance that leads to a save - the toolbar is the only
   * way into edit mode, so this is where a reader is turned back.
   */
  canEditDashboard: boolean;
  /*
   * Why editing is locked, ready for the tooltip on the disabled menu item.
   * Undefined means there is nothing honest to say yet (the permission
   * snapshot has not landed), and the item is hidden instead of accusing the
   * user of missing a permission they may well hold - same contract as
   * PermissionGate.
   */
  editDashboardDisabledReason?: string | undefined;
  /*
   * Opens the dashboard's Sharing page, where who can view it is one choice
   * and the public link can be copied. Shown to everyone who can open the
   * dashboard: someone who may not change who can view it still sees who
   * can, and copies the link. Left out, the menu has no Share.
   */
  onShareClick?: (() => void) | undefined;
  /*
   * Whether the Add Widget dialog is open, when the page opens it too: an
   * empty board has an Add Widget of its own (Canvas/BlankCanvas), which
   * puts the board in edit mode with this dialog open. Left out, the
   * toolbar keeps the dialog to itself.
   */
  isAddWidgetModalOpen?: boolean | undefined;
  onAddWidgetModalOpenChange?: ((isOpen: boolean) => void) | undefined;
  /*
   * The dashboard's own defaults, which each viewer's time range picker and
   * auto-refresh menu offer first as "Default (...)", the way back from a
   * pick of their own (issue #5080). isOnDefault... says the viewer is on
   * the default, so that choice is the one ticked. Left out, neither picker
   * offers it.
   */
  defaultTimeRange?: TimeRange | undefined;
  isOnDefaultTimeRange?: boolean | undefined;
  onDefaultTimeRangeSelect?: (() => void) | undefined;
  defaultAutoRefreshInterval?: AutoRefreshInterval | undefined;
  isOnDefaultAutoRefresh?: boolean | undefined;
  onDefaultAutoRefreshSelect?: (() => void) | undefined;
  /*
   * While editing: the dashboard's defaults as the editor sets them, in a
   * row under the toolbar's buttons (DashboardDefaultsBar), read from and
   * written to the config being edited, so Save Changes saves them and
   * Discard Changes throws them away. Left out, there is no such row.
   */
  onDashboardDefaultsChange?:
    | ((defaults: {
        timeRange?: TimeRange | undefined;
        refreshInterval?: AutoRefreshInterval | undefined;
      }) => void)
    | undefined;
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
            stroke="var(--ou-chart-track, #e5e7eb)"
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
  // "Default (1m)", first: the dashboard's own, and the way back to it.
  defaultInterval?: AutoRefreshInterval | undefined;
  isOnDefault?: boolean | undefined;
  onDefaultSelect?: (() => void) | undefined;
}

const AutoRefreshDropdown: FunctionComponent<AutoRefreshDropdownProps> = (
  props: AutoRefreshDropdownProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const menuId: string = useId();
  const dropdownRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const buttonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const menuRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

  const hasDefaultChoice: boolean = Boolean(
    props.defaultInterval && props.onDefaultSelect,
  );

  const close: () => void = useCallback((): void => {
    setIsOpen(false);
  }, []);

  // Arrows, Home, End, Escape and Tab, as the product's other menus take them.
  useToolbarChoiceMenuKeys({ isOpen, menuRef, buttonRef, close });

  // A choice made: the menu closes, and the focus goes back to its button.
  const choose: (pick: () => void) => void = (pick: () => void): void => {
    pick();
    setIsOpen(false);
    buttonRef.current?.focus();
  };

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
        ref={buttonRef}
        type="button"
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors cursor-pointer border focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
          props.isAutoRefreshActive
            ? "bg-indigo-50/50 border-indigo-100 hover:bg-indigo-50"
            : "bg-gray-50 border-gray-200/60 hover:bg-gray-100"
        }`}
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        title={translator.translateText("Auto-refresh settings")}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
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
            <span className="text-xs text-gray-500">
              {translator.translateText("Auto-refresh: Off")}
            </span>
          </>
        )}
      </button>

      {/*
       * Dropdown: as wide as its longest choice, so none wraps in a long
       * language, and hung from the button's end - its right, its left in
       * a right-to-left language - so it opens over the board, not past
       * the toolbar's edge.
       */}
      {isOpen && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={translator.translateText("Auto-refresh settings")}
          className="absolute end-0 mt-2 w-max min-w-[14rem] rounded-lg bg-white shadow-xl ring-1 ring-gray-200 focus:outline-none py-1"
          /*
           * Issue #3660: this used to be `z-10`, which lost to a clicked
           * widget's raise and left the picker opening behind the board. The
           * canvas can no longer compete for the page's layers at all, and
           * this puts the menu on the same layer as every other toolbar menu.
           */
          style={{ zIndex: DashboardStackingLayers.toolbarPopup }}
        >
          {hasDefaultChoice && props.defaultInterval ? (
            <div className="mb-1 border-b border-gray-100 pb-1" role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={Boolean(props.isOnDefault)}
                tabIndex={-1}
                data-testid={AUTO_REFRESH_DEFAULT_CHOICE_TEST_ID}
                className={`w-full text-start whitespace-nowrap px-4 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-100 ${
                  props.isOnDefault
                    ? "text-indigo-600 font-medium"
                    : "text-gray-700"
                }`}
                onClick={() => {
                  choose(() => {
                    props.onDefaultSelect?.();
                  });
                }}
              >
                <span className="w-4 shrink-0 text-center" aria-hidden="true">
                  {props.isOnDefault ? "\u2713" : ""}
                </span>
                {getDefaultChoiceLabel({
                  translator,
                  value: getAutoRefreshChoiceLabel(props.defaultInterval),
                })}
              </button>
            </div>
          ) : (
            <></>
          )}
          {Object.values(AutoRefreshInterval).map(
            (interval: AutoRefreshInterval) => {
              /*
               * While the viewer is on the default, its own choice above is
               * the one ticked, not the interval it names.
               */
              const isSelected: boolean =
                interval === props.autoRefreshInterval &&
                !(hasDefaultChoice && props.isOnDefault);
              return (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={isSelected}
                  tabIndex={-1}
                  key={interval}
                  className={`w-full text-start whitespace-nowrap px-4 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-100 ${
                    isSelected ? "text-indigo-600 font-medium" : "text-gray-700"
                  }`}
                  onClick={() => {
                    choose(() => {
                      props.onAutoRefreshIntervalChange(interval);
                    });
                  }}
                >
                  <span className="w-4 shrink-0 text-center" aria-hidden="true">
                    {isSelected ? "\u2713" : ""}
                  </span>
                  {interval === AutoRefreshInterval.OFF
                    ? translator.translateText("Auto-refresh Off")
                    : translator.translateTemplate(
                        "Refresh every {{interval}}",
                        {
                          interval: getAutoRefreshIntervalLabel(interval),
                        },
                      )}
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
  const translator: Translator = useTranslator();
  const isEditMode: boolean = props.dashboardMode === DashboardMode.Edit;

  const [showCancelModal, setShowCancelModal] = useState<boolean>(false);
  const [ownShowAddWidgetModal, setOwnShowAddWidgetModal] =
    useState<boolean>(false);
  const [showVariablesModal, setShowVariablesModal] = useState<boolean>(false);

  // The page's say when it has one (isAddWidgetModalOpen), else the toolbar's.
  const showAddWidgetModal: boolean =
    props.isAddWidgetModalOpen !== undefined
      ? props.isAddWidgetModalOpen
      : ownShowAddWidgetModal;

  const setShowAddWidgetModal: (isOpen: boolean) => void = (
    isOpen: boolean,
  ): void => {
    setOwnShowAddWidgetModal(isOpen);
    props.onAddWidgetModalOpenChange?.(isOpen);
  };

  const isSaving: boolean = props.isSaving;

  const hasComponents: boolean = Boolean(
    props.dashboardViewConfig &&
      props.dashboardViewConfig.components &&
      props.dashboardViewConfig.components.length > 0,
  );

  const isAutoRefreshActive: boolean =
    props.autoRefreshInterval !== AutoRefreshInterval.OFF;

  // The defaults in the config being edited, as the editing row shows them.
  const editedDefaultTimeRange: TimeRange =
    props.dashboardViewConfig.timeRange || DASHBOARD_TIME_RANGE_FALLBACK;
  const editedDefaultAutoRefreshInterval: AutoRefreshInterval =
    props.dashboardViewConfig.refreshInterval ||
    DASHBOARD_AUTO_REFRESH_FALLBACK;
  const autoRefreshMs: number | null = getAutoRefreshIntervalInMs(
    props.autoRefreshInterval,
  );

  /*
   * What the controls hold: the time range, the auto-refresh and the
   * variables while viewing a dashboard with widgets, the editing actions
   * while editing, or the saving notice. An empty dashboard being viewed
   * has none of them, only the ⋯ menu.
   */
  const hasControls: boolean =
    (hasComponents && !isEditMode) ||
    (!isSaving && isEditMode && props.canEditDashboard) ||
    isSaving;

  /*
   * Inset from the board's sides beside the side menu; below md, where the
   * page's own menu is a card above the dashboard, the toolbar and the
   * board line up with it.
   */
  return (
    <div className="md:mx-3 mt-3 mb-3">
      <div
        className="rounded-2xl bg-white border border-gray-200/60"
        style={{
          boxShadow:
            "var(--ou-card-shadow, 0 2px 8px -2px rgba(0, 0, 0, 0.08), 0 1px 4px -1px rgba(0, 0, 0, 0.04))",
        }}
      >
        {/*
         * Main toolbar row: the dashboard's name, then its controls and its
         * ⋯ menu together. They sit beside the name while the name keeps
         * room to be read (15rem), and move under it, at the end of the
         * row, where they do not fit - the ⋯ menu always last. On a phone
         * the name and the ⋯ menu share the first line and the controls
         * have a line of their own, from its start: there the controls and
         * the ⋯ menu's box is display: contents, so each is a part of the
         * row. The row used to be one line that never wrapped, on a page at
         * least 1000px wide, so on a phone the controls sat past the right
         * edge of the screen.
         */}
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5"
          data-testid={DASHBOARD_TOOLBAR_ROW_TEST_ID}
        >
          {/* Left: Icon + Title + Description */}
          <div className="flex min-w-0 flex-1 basis-0 items-center gap-3 sm:basis-60">
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
                    {translator.translateText("Editing")}
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

          {/* Right: the controls, then the ⋯ menu */}
          <div
            className="max-sm:contents sm:ms-auto sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:gap-1.5"
            data-testid={DASHBOARD_TOOLBAR_END_TEST_ID}
          >
            {/* Time range + Auto-refresh + Variables + Actions */}
            {hasControls ? (
              <div
                className="flex flex-wrap items-center gap-1.5 max-sm:order-last max-sm:w-full sm:justify-end"
                data-testid={DASHBOARD_TOOLBAR_CONTROLS_TEST_ID}
              >
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
                          {/*
                           * Between the variables and the time range on one
                           * line; on a phone they wrap, and a rule would hang
                           * at the end of a line.
                           */}
                          <div className="w-px h-5 bg-gray-200 mx-0.5 max-sm:hidden"></div>
                        </>
                      )}

                    <RangeStartAndEndDateView
                      dashboardStartAndEndDate={props.startAndEndDate}
                      onChange={(startAndEndDate: RangeStartAndEndDateTime) => {
                        props.onStartAndEndDateChange(startAndEndDate);
                      }}
                      defaultRange={props.defaultTimeRange}
                      isOnDefaultRange={props.isOnDefaultTimeRange}
                      onDefaultRangeSelect={props.onDefaultTimeRangeSelect}
                    />

                    {props.isTimeRangeZoomed && props.onResetTimeRangeZoom && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                        title={translator.translateText(
                          "Reset the dashboard to the time range it had before the zoom",
                        )}
                        aria-label={translator.translateText("Reset zoom")}
                        onClick={() => {
                          props.onResetTimeRangeZoom?.();
                        }}
                      >
                        <Icon
                          icon={IconProp.MagnifyingGlassMinus}
                          className="h-3.5 w-3.5"
                        />
                        {translator.translateText("Reset zoom")}
                      </button>
                    )}

                    {/* Auto-refresh section */}
                    <AutoRefreshDropdown
                      autoRefreshInterval={props.autoRefreshInterval}
                      autoRefreshMs={autoRefreshMs}
                      isAutoRefreshActive={isAutoRefreshActive}
                      isRefreshing={props.isRefreshing || false}
                      onAutoRefreshIntervalChange={
                        props.onAutoRefreshIntervalChange
                      }
                      defaultInterval={props.defaultAutoRefreshInterval}
                      isOnDefault={props.isOnDefaultAutoRefresh}
                      onDefaultSelect={props.onDefaultAutoRefreshSelect}
                    />
                  </>
                )}

                {/* Edit mode actions */}
                {!isSaving && isEditMode && props.canEditDashboard && (
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {/* Construction tools — segmented pill */}
                    <div className="flex items-center gap-0.5 rounded-lg bg-gray-50 border border-gray-200/60 p-0.5">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium text-gray-700 hover:bg-white hover:text-gray-900 hover:shadow-sm transition-all cursor-pointer"
                        onClick={() => {
                          setShowAddWidgetModal(true);
                        }}
                        title={translator.translateText("Add Widget")}
                      >
                        <Icon icon={IconProp.Add} className="w-3.5 h-3.5" />
                        <span>{translator.translateText("Add Widget")}</span>
                      </button>

                      {props.onVariablesDefinitionChange && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium text-gray-700 hover:bg-white hover:text-gray-900 hover:shadow-sm transition-all cursor-pointer"
                          onClick={() => {
                            setShowVariablesModal(true);
                          }}
                          title={translator.translateText("Variables")}
                        >
                          <Icon
                            icon={IconProp.Variable}
                            className="w-3.5 h-3.5"
                          />
                          <span>{translator.translateText("Variables")}</span>
                          {props.variables && props.variables.length > 0 && (
                            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-semibold">
                              {props.variables.length}
                            </span>
                          )}
                        </button>
                      )}
                    </div>

                    {/* Commit actions */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="inline-flex items-center h-8 px-3 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors cursor-pointer"
                        onClick={() => {
                          setShowCancelModal(true);
                        }}
                        title={translator.translateText("Cancel")}
                      >
                        {translator.translateText("Cancel")}
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-colors cursor-pointer"
                        onClick={props.onSaveClick}
                        title={translator.translateText("Save Changes")}
                      >
                        <Icon icon={IconProp.Check} className="w-3.5 h-3.5" />
                        <span>{translator.translateText("Save Changes")}</span>
                      </button>
                    </div>
                  </div>
                )}

                {isSaving && (
                  <div className="flex items-center gap-2">
                    <Loader />
                    <span className="text-xs text-gray-500">
                      {translator.translateText("Saving...")}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <></>
            )}

            {/*
             * More menu: Edit, Share and Full Screen (always visible in view
             * mode). Last of the row; on a phone, beside the name.
             */}
            {!isEditMode && (
              <div className="shrink-0">
                <MoreMenu
                  menuIcon={IconProp.EllipsisHorizontal}
                  elementToBeShownInsteadOfButton={
                    <button
                      type="button"
                      className="flex items-center justify-center rounded-lg w-8 h-8 bg-gray-50 border border-gray-200/60 hover:bg-gray-100 transition-colors cursor-pointer"
                      title={translator.translateText("More dashboard options")}
                      aria-label={translator.translateText(
                        "More dashboard options",
                      )}
                    >
                      <Icon
                        icon={IconProp.EllipsisHorizontal}
                        className="w-4 h-4 text-gray-500"
                      />
                    </button>
                  }
                >
                  {props.canEditDashboard ||
                  props.editDashboardDisabledReason ? (
                    <MoreMenuItem
                      text={"Edit Dashboard"}
                      icon={IconProp.Pencil}
                      key={"edit"}
                      isDisabled={!props.canEditDashboard}
                      tooltip={
                        props.canEditDashboard
                          ? undefined
                          : props.editDashboardDisabledReason
                      }
                      onClick={props.onEditClick}
                    />
                  ) : (
                    <></>
                  )}
                  {props.onShareClick ? (
                    <MoreMenuItem
                      text={"Share"}
                      icon={IconProp.Share}
                      key={"share"}
                      onClick={props.onShareClick}
                    />
                  ) : (
                    <></>
                  )}
                  <MoreMenuItem
                    text={"Full Screen"}
                    icon={IconProp.Expand}
                    key={"fullscreen"}
                    onClick={props.onFullScreenClick}
                  />
                </MoreMenu>
              </div>
            )}
          </div>
        </div>

        {/*
         * While editing: what everyone who opens the dashboard starts on,
         * set on purpose and saved with the rest of it. Once it has a
         * widget, as the viewer's own time range and auto-refresh: an
         * empty dashboard has nothing to open on a range, and its editor
         * has only one thing to do - add a widget.
         */}
        {isEditMode &&
        hasComponents &&
        props.canEditDashboard &&
        props.onDashboardDefaultsChange ? (
          <DashboardDefaultsBar
            timeRange={editedDefaultTimeRange}
            refreshInterval={editedDefaultAutoRefreshInterval}
            onTimeRangeChange={(timeRange: TimeRange) => {
              props.onDashboardDefaultsChange?.({ timeRange });
            }}
            onRefreshIntervalChange={(refreshInterval: AutoRefreshInterval) => {
              props.onDashboardDefaultsChange?.({ refreshInterval });
            }}
          />
        ) : (
          <></>
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

      {showAddWidgetModal ? (
        <AddWidgetModal
          onAddComponentClick={(type: DashboardComponentType) => {
            props.onAddComponentClick(type);
          }}
          onClose={() => {
            setShowAddWidgetModal(false);
          }}
        />
      ) : (
        <></>
      )}

      {showVariablesModal && props.onVariablesDefinitionChange ? (
        <DashboardVariablesModal
          variables={props.variables || []}
          telemetryAttributeOptions={props.telemetryAttributeOptions || []}
          onClose={() => {
            setShowVariablesModal(false);
          }}
          onSave={(updated: Array<DashboardVariable>) => {
            props.onVariablesDefinitionChange?.(updated);
            setShowVariablesModal(false);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default DashboardToolbar;
