import IconProp from "Common/Types/Icon/IconProp";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  AutoRefreshInterval,
  getAutoRefreshIntervalLabel,
} from "Common/Types/Dashboard/DashboardViewConfig";
import { DASHBOARD_TIME_RANGES } from "Common/Types/Dashboard/DashboardTimeRange";
import { DASHBOARD_AUTO_REFRESH_INTERVALS } from "Common/Types/Dashboard/DashboardAutoRefresh";
import Icon from "Common/UI/Components/Icon/Icon";
import { getTimeRangeLabel } from "Common/UI/Components/Date/TimeRangePickerDropdown";
import DashboardStackingLayers from "Common/UI/Utils/DashboardStackingLayers";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  DASHBOARD_DEFAULTS_BAR_TEST_ID,
  DEFAULT_AUTO_REFRESH_PICKER_TEST_ID,
  DEFAULT_TIME_RANGE_PICKER_TEST_ID,
  DashboardDefaultsCopy,
  getAutoRefreshChoiceLabel,
  getDefaultsPickerChoiceTestId,
  getDefaultsPickerMenuTestId,
} from "./DashboardDefaultsCopy";
import useToolbarChoiceMenuKeys from "./UseToolbarChoiceMenuKeys";

/*
 * A dashboard's defaults, set on purpose while it is edited (issue #5080):
 * the time range and the auto-refresh everyone who opens it starts on. A row
 * under the editing toolbar's buttons, in the place the viewer's own time
 * range and auto-refresh are while viewing, so it reads as "these, for
 * everyone". Saved with the rest of the dashboard by Save Changes, and
 * thrown away with it by Discard Changes.
 *
 * Only the presets can be a default: a custom start and end is a moment in
 * the past, and a dashboard that opened on it would never move again.
 */

interface Choice {
  value: string;
  // How the choice reads in the list.
  label: string;
  // How the picker's button names it, when shorter: "1m" for "Refresh every 1m".
  buttonLabel?: string | undefined;
}

interface ChoicePickerProps {
  testId: string;
  icon: IconProp;
  // What the picker sets, for the button's accessible name.
  label: string;
  value: string;
  choices: Array<Choice>;
  onSelect: (value: string) => void;
}

const ChoicePicker: FunctionComponent<ChoicePickerProps> = (
  props: ChoicePickerProps,
): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const menuId: string = useId();
  const containerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const buttonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const menuRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

  const close: () => void = useCallback((): void => {
    setIsOpen(false);
  }, []);

  // Arrows, Home, End, Escape and Tab, as the product's other menus take them.
  useToolbarChoiceMenuKeys({ isOpen, menuRef, buttonRef, close });

  // Closes on a click anywhere else.
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const onMouseDown: (event: MouseEvent) => void = (
      event: MouseEvent,
    ): void => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", onMouseDown);

    return () => {
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [isOpen]);

  const selected: Choice | undefined = props.choices.find(
    (choice: Choice): boolean => {
      return choice.value === props.value;
    },
  );

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        data-testid={props.testId}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label={`${props.label}: ${
          selected?.buttonLabel || selected?.label || props.value
        }`}
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
          isOpen
            ? "border-indigo-200 bg-indigo-50 text-indigo-700"
            : "border-gray-200/60 bg-gray-50 text-gray-700 hover:bg-gray-100"
        }`}
        onClick={() => {
          setIsOpen(!isOpen);
        }}
      >
        <Icon icon={props.icon} className="h-3.5 w-3.5 text-gray-500" />
        <span>{selected?.buttonLabel || selected?.label || props.value}</span>
        <Icon
          icon={IconProp.ChevronDown}
          className={`h-3 w-3 text-gray-400 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen ? (
        /*
         * As wide as its longest choice, so no choice wraps in a long
         * language, and tall enough for every preset at once; it scrolls
         * only on a screen too short for them. It hangs from the button's
         * start, its left - its right in a right-to-left language.
         */
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={props.label}
          data-testid={getDefaultsPickerMenuTestId(props.testId)}
          className="absolute start-0 mt-2 max-h-[70vh] w-max min-w-[12rem] overflow-y-auto rounded-lg bg-white py-1 shadow-xl ring-1 ring-gray-200 focus:outline-none"
          style={{ zIndex: DashboardStackingLayers.toolbarPopup }}
        >
          {props.choices.map((choice: Choice): ReactElement => {
            const isSelected: boolean = choice.value === props.value;

            return (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                tabIndex={-1}
                key={choice.value}
                data-testid={getDefaultsPickerChoiceTestId(
                  props.testId,
                  choice.value,
                )}
                className={`flex w-full items-center gap-2 whitespace-nowrap px-4 py-2 text-start text-sm hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-100 ${
                  isSelected ? "font-medium text-indigo-600" : "text-gray-700"
                }`}
                onClick={() => {
                  props.onSelect(choice.value);
                  setIsOpen(false);
                  buttonRef.current?.focus();
                }}
              >
                <span className="w-4 shrink-0 text-center" aria-hidden="true">
                  {isSelected ? "✓" : ""}
                </span>
                {choice.label}
              </button>
            );
          })}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export interface ComponentProps {
  // The defaults as the editor has them: saved, or changed since.
  timeRange: TimeRange;
  refreshInterval: AutoRefreshInterval;
  onTimeRangeChange: (timeRange: TimeRange) => void;
  onRefreshIntervalChange: (refreshInterval: AutoRefreshInterval) => void;
}

const DashboardDefaultsBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // A fixed string in the reader's language, else as written.
  const text: (value: string) => string = (value: string): string => {
    return translator.translateText(value) || value;
  };

  const timeRangeLabel: string = text(DashboardDefaultsCopy.timeRangeLabel);
  const autoRefreshLabel: string = text(DashboardDefaultsCopy.autoRefreshLabel);

  /*
   * The two pickers on one line, and the line on what they do always on its
   * own under them: beside them it fitted for some values and not others,
   * so picking a longer range moved the whole board down a line.
   */
  return (
    <div
      className="border-t border-gray-100 px-4 py-2.5"
      data-testid={DASHBOARD_DEFAULTS_BAR_TEST_ID}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-600">
            {timeRangeLabel}
          </span>
          <ChoicePicker
            testId={DEFAULT_TIME_RANGE_PICKER_TEST_ID}
            icon={IconProp.Clock}
            label={timeRangeLabel}
            value={props.timeRange}
            choices={DASHBOARD_TIME_RANGES.map((range: TimeRange): Choice => {
              return {
                value: range,
                label: text(getTimeRangeLabel(range)),
              };
            })}
            onSelect={(value: string) => {
              props.onTimeRangeChange(value as TimeRange);
            }}
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-600">
            {autoRefreshLabel}
          </span>
          <ChoicePicker
            testId={DEFAULT_AUTO_REFRESH_PICKER_TEST_ID}
            icon={IconProp.Refresh}
            label={autoRefreshLabel}
            value={props.refreshInterval}
            choices={DASHBOARD_AUTO_REFRESH_INTERVALS.map(
              (interval: AutoRefreshInterval): Choice => {
                /*
                 * Worded as the viewer's auto-refresh menu words them, and
                 * named on the button as its countdown names them: Off, 1m.
                 */
                return {
                  value: interval,
                  label:
                    interval === AutoRefreshInterval.OFF
                      ? text("Auto-refresh Off")
                      : translator.translateTemplate(
                          "Refresh every {{interval}}",
                          {
                            interval: getAutoRefreshIntervalLabel(interval),
                          },
                        ),
                  buttonLabel: text(getAutoRefreshChoiceLabel(interval)),
                };
              },
            )}
            onSelect={(value: string) => {
              props.onRefreshIntervalChange(value as AutoRefreshInterval);
            }}
          />
        </div>
      </div>

      <p className="mt-2 text-xs text-gray-500">
        {text(DashboardDefaultsCopy.hint)}
      </p>
    </div>
  );
};

export default DashboardDefaultsBar;
