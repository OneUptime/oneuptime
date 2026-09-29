import Dropdown, { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import Icon from "../Icon/Icon";
import VariableModal from "./VariableModal";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import CronTab from "../../../Utils/CronTab";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";

export interface ComponentProps {
  workflowId: ObjectID;
  initialValue?: string | null | undefined;
  onChange: (value: string) => void;
  error?: string | undefined;
  placeholder?: string | undefined;
  tabIndex?: number | undefined;
}

type ScheduleMode = "preset" | "custom" | "variable";

const PRESET_OPTIONS: Array<DropdownOption> = CronTab.PRESETS.map(
  (preset: { label: string; value: string }) => {
    return {
      label: preset.label,
      value: preset.value,
    };
  },
);

const PRESET_VALUES: Set<string> = new Set(
  CronTab.PRESETS.map((preset: { value: string }) => {
    return preset.value;
  }),
);

const normalizeInitialValue: (value: string | null | undefined) => string = (
  value: string | null | undefined,
): string => {
  if (value === null || value === undefined) {
    return "";
  }
  return `${value}`;
};

const inferInitialMode: (value: string) => ScheduleMode = (
  value: string,
): ScheduleMode => {
  const trimmed: string = value.trim();

  if (CronTab.isVariableExpression(trimmed)) {
    return "variable";
  }

  if (trimmed !== "" && !PRESET_VALUES.has(trimmed)) {
    return "custom";
  }

  return "preset";
};

const formatUtc: (date: Date) => string = (date: Date): string => {
  try {
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date) + " UTC"
    );
  } catch {
    return date.toUTCString();
  }
};

/**
 * A rich picker for the workflow "Schedule" trigger. It lets the user choose a
 * common schedule from a preset list, write any custom cron expression (with a
 * live human-readable description, next-run preview and validation), or point
 * the schedule at a workflow / global variable that resolves to a cron
 * expression when the workflow is saved.
 */
const CronScheduleField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const initialValue: string = useMemo(() => {
    return normalizeInitialValue(props.initialValue);
  }, []);

  const [value, setValue] = useState<string>(initialValue);
  const [mode, setMode] = useState<ScheduleMode>(
    inferInitialMode(initialValue),
  );
  const [showVariableModal, setShowVariableModal] = useState<boolean>(false);

  const emit: (next: string) => void = (next: string): void => {
    setValue(next);
    props.onChange(next);
  };

  const trimmedValue: string = value.trim();
  const isVariable: boolean = CronTab.isVariableExpression(trimmedValue);

  const validationError: string | null = useMemo(() => {
    if (trimmedValue === "" || isVariable) {
      return null;
    }
    return CronTab.getValidationError(trimmedValue);
  }, [trimmedValue, isVariable]);

  const description: string | null = useMemo(() => {
    if (trimmedValue === "" || isVariable || validationError) {
      return null;
    }
    return CronTab.getHumanReadableDescription(trimmedValue);
  }, [trimmedValue, isVariable, validationError]);

  const nextRuns: Array<Date> = useMemo(() => {
    if (trimmedValue === "" || isVariable || validationError) {
      return [];
    }
    try {
      return CronTab.getNextExecutionTimes(trimmedValue, 3, new Date());
    } catch {
      return [];
    }
  }, [trimmedValue, isVariable, validationError]);

  const selectedPresetOption: DropdownOption | undefined = PRESET_OPTIONS.find(
    (option: DropdownOption) => {
      return option.value === trimmedValue;
    },
  );

  const renderModeTab: (args: {
    tabMode: ScheduleMode;
    label: string;
    icon: IconProp;
  }) => ReactElement = (args: {
    tabMode: ScheduleMode;
    label: string;
    icon: IconProp;
  }): ReactElement => {
    const isActive: boolean = mode === args.tabMode;
    return (
      <button
        type="button"
        onClick={() => {
          setMode(args.tabMode);
        }}
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
          isActive
            ? "bg-white text-indigo-700 shadow-sm ring-1 ring-gray-200"
            : "text-gray-500 hover:text-gray-700"
        }`}
      >
        <Icon
          icon={args.icon}
          className={`h-3.5 w-3.5 ${
            isActive ? "text-indigo-600" : "text-gray-400"
          }`}
        />
        {args.label}
      </button>
    );
  };

  const renderPreview: () => ReactElement | null = (): ReactElement | null => {
    if (isVariable) {
      return null;
    }

    if (validationError) {
      return (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50/60 px-3 py-2 text-xs text-red-800">
          <Icon
            icon={IconProp.Error}
            className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0"
          />
          <div>
            <p className="font-semibold">Not a valid cron expression</p>
            <p className="text-red-700">{validationError}</p>
          </div>
        </div>
      );
    }

    if (!description) {
      return null;
    }

    return (
      <div className="rounded-md border border-gray-200 bg-gray-50/60 px-3 py-2.5">
        <div className="flex items-start gap-2">
          <Icon
            icon={IconProp.Clock}
            className="h-4 w-4 text-indigo-500 mt-0.5 flex-shrink-0"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-800">{description}</p>
            {nextRuns.length > 0 && (
              <div className="mt-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  Next runs
                </p>
                <ul className="mt-0.5 space-y-0.5">
                  {nextRuns.map((run: Date, index: number) => {
                    return (
                      <li
                        key={index}
                        className="text-xs text-gray-600 font-mono"
                      >
                        {formatUtc(run)}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Mode selector */}
      <div className="inline-flex items-center gap-1 rounded-lg bg-gray-100 p-1">
        {renderModeTab({
          tabMode: "preset",
          label: "Common schedules",
          icon: IconProp.Clock,
        })}
        {renderModeTab({
          tabMode: "custom",
          label: "Custom cron",
          icon: IconProp.Code,
        })}
        {renderModeTab({
          tabMode: "variable",
          label: "Variable",
          icon: IconProp.Variable,
        })}
      </div>

      {mode === "preset" && (
        <div className="space-y-3">
          <Dropdown
            options={PRESET_OPTIONS}
            value={selectedPresetOption}
            placeholder="Select a schedule"
            tabIndex={props.tabIndex}
            onChange={(
              newValue: DropdownValue | Array<DropdownValue> | null,
            ) => {
              if (typeof newValue === "string") {
                emit(newValue);
              }
            }}
          />
          {!selectedPresetOption && trimmedValue !== "" && !isVariable && (
            <p className="text-xs text-gray-500">
              Your current schedule{" "}
              <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-gray-700">
                {trimmedValue}
              </code>{" "}
              is not one of the presets. Switch to{" "}
              <button
                type="button"
                className="text-indigo-600 underline hover:text-indigo-700"
                onClick={() => {
                  setMode("custom");
                }}
              >
                Custom cron
              </button>{" "}
              to edit it.
            </p>
          )}
          {renderPreview()}
        </div>
      )}

      {mode === "custom" && (
        <div className="space-y-3">
          <input
            type="text"
            value={value}
            spellCheck={false}
            autoComplete="off"
            tabIndex={props.tabIndex}
            placeholder={props.placeholder || "e.g. 0 */18 * * *"}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              emit(event.target.value);
            }}
            className={`block w-full rounded-md border bg-white px-3 py-2 font-mono text-sm placeholder-gray-400 focus:outline-none focus:ring-1 ${
              validationError
                ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
            }`}
          />
          <p className="text-xs text-gray-400 font-mono">
            minute hour day-of-month month day-of-week
          </p>
          {renderPreview()}
        </div>
      )}

      {mode === "variable" && (
        <div className="space-y-3">
          {isVariable ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-indigo-200 bg-indigo-50/50 px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <Icon
                  icon={IconProp.Variable}
                  className="h-4 w-4 text-indigo-500 flex-shrink-0"
                />
                <code className="truncate font-mono text-sm text-indigo-800">
                  {trimmedValue}
                </code>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                  onClick={() => {
                    setShowVariableModal(true);
                  }}
                >
                  Change
                </button>
                <span className="text-gray-300">·</span>
                <button
                  type="button"
                  className="text-xs font-medium text-gray-500 hover:text-gray-700"
                  onClick={() => {
                    emit("");
                    setMode("preset");
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setShowVariableModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400"
            >
              <Icon
                icon={IconProp.Variable}
                className="h-4 w-4 text-gray-500"
              />
              Select a variable
            </button>
          )}

          <div className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50/60 px-3 py-2 text-xs text-gray-600">
            <Icon
              icon={IconProp.Info}
              className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0"
            />
            <p>
              The variable is resolved when the workflow is saved. It must
              contain a valid cron expression (for example{" "}
              <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-gray-700">
                0 */18 * * *
              </code>
              ). Component return values can&apos;t be used here because the
              schedule is set up before the workflow runs.
            </p>
          </div>
        </div>
      )}

      {props.error && (
        <p className="text-xs text-red-600" data-testid="error-message">
          {props.error}
        </p>
      )}

      {showVariableModal && (
        <VariableModal
          workflowId={props.workflowId}
          onClose={() => {
            setShowVariableModal(false);
          }}
          onSave={(variableId: string) => {
            setShowVariableModal(false);
            setMode("variable");
            emit(variableId);
          }}
        />
      )}
    </div>
  );
};

export default CronScheduleField;
