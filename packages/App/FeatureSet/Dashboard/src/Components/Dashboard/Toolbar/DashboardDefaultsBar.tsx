import IconProp from "Common/Types/Icon/IconProp";
import TimeRange from "Common/Types/Time/TimeRange";
import { AutoRefreshInterval } from "Common/Types/Dashboard/DashboardViewConfig";
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
  useEffect,
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
  label: string;
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
  const containerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const buttonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);

  // Closes on a click anywhere else, and on Escape back to the button.
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

    const onKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (event.key === "Escape") {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
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
        aria-label={`${props.label}: ${selected?.label || props.value}`}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
          isOpen
            ? "border-indigo-200 bg-indigo-50 text-indigo-700"
            : "border-gray-200/60 bg-gray-50 text-gray-700 hover:bg-gray-100"
        }`}
        onClick={() => {
          setIsOpen(!isOpen);
        }}
      >
        <Icon icon={props.icon} className="h-3.5 w-3.5 text-gray-500" />
        <span>{selected?.label || props.value}</span>
        <Icon
          icon={IconProp.ChevronDown}
          className={`h-3 w-3 text-gray-400 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen ? (
        <div
          role="menu"
          aria-label={props.label}
          data-testid={getDefaultsPickerMenuTestId(props.testId)}
          className="absolute left-0 mt-2 max-h-80 w-52 overflow-y-auto rounded-lg bg-white py-1 shadow-xl ring-1 ring-gray-200 focus:outline-none"
          style={{ zIndex: DashboardStackingLayers.toolbarPopup }}
        >
          {props.choices.map((choice: Choice): ReactElement => {
            const isSelected: boolean = choice.value === props.value;

            return (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                key={choice.value}
                data-testid={getDefaultsPickerChoiceTestId(
                  props.testId,
                  choice.value,
                )}
                className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none ${
                  isSelected ? "font-medium text-indigo-600" : "text-gray-700"
                }`}
                onClick={() => {
                  props.onSelect(choice.value);
                  setIsOpen(false);
                  buttonRef.current?.focus();
                }}
              >
                <span className="w-4 text-center" aria-hidden="true">
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

  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-gray-100 px-4 py-2"
      data-testid={DASHBOARD_DEFAULTS_BAR_TEST_ID}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500">
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
        <span className="text-xs font-medium text-gray-500">
          {autoRefreshLabel}
        </span>
        <ChoicePicker
          testId={DEFAULT_AUTO_REFRESH_PICKER_TEST_ID}
          icon={IconProp.Refresh}
          label={autoRefreshLabel}
          value={props.refreshInterval}
          choices={DASHBOARD_AUTO_REFRESH_INTERVALS.map(
            (interval: AutoRefreshInterval): Choice => {
              return {
                value: interval,
                label: text(getAutoRefreshChoiceLabel(interval)),
              };
            },
          )}
          onSelect={(value: string) => {
            props.onRefreshIntervalChange(value as AutoRefreshInterval);
          }}
        />
      </div>

      <p className="min-w-0 text-xs text-gray-400">
        {text(DashboardDefaultsCopy.hint)}
      </p>
    </div>
  );
};

export default DashboardDefaultsBar;
