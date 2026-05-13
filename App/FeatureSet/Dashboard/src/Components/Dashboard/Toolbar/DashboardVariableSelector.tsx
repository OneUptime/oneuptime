import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import DashboardVariable, {
  DashboardVariableType,
} from "Common/Types/Dashboard/DashboardVariable";
import MetricUtil from "../../Metrics/Utils/Metrics";

export interface VariableValueChange {
  selectedValue?: string | undefined;
  selectedValues?: Array<string> | undefined;
}

export interface ComponentProps {
  variables: Array<DashboardVariable>;
  onVariableValueChange: (
    variableId: string,
    change: VariableValueChange,
  ) => void;
}

interface SingleVariableSelectorProps {
  variable: DashboardVariable;
  onVariableValueChange: (
    variableId: string,
    change: VariableValueChange,
  ) => void;
}

const MultiSelectPopover: FunctionComponent<{
  options: Array<string>;
  selected: Array<string>;
  label: string;
  isLoading: boolean;
  onChange: (next: Array<string>) => void;
}> = ({
  options,
  selected,
  label,
  isLoading,
  onChange,
}: {
  options: Array<string>;
  selected: Array<string>;
  label: string;
  isLoading: boolean;
  onChange: (next: Array<string>) => void;
}): ReactElement => {
  const [open, setOpen] = useState<boolean>(false);
  const wrapRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onDocClick: (e: MouseEvent) => void = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [open]);

  const buttonText: string =
    selected.length === 0
      ? isLoading
        ? "Loading…"
        : "All"
      : selected.length === 1
        ? (selected[0] as string)
        : `${selected.length} selected`;

  const toggle: (value: string) => void = (value: string): void => {
    if (selected.includes(value)) {
      onChange(
        selected.filter((v: string) => {
          return v !== value;
        }),
      );
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        className="text-xs border border-gray-200 rounded-md px-2.5 py-1.5 bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-colors flex items-center gap-1"
        disabled={isLoading}
        onClick={() => {
          setOpen(!open);
        }}
        title={label}
      >
        <span className="truncate max-w-[10rem]">{buttonText}</span>
        <span className="text-gray-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 right-0 w-56 max-h-72 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg py-1">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 text-[11px] text-gray-500">
            <span>{selected.length} selected</span>
            <button
              type="button"
              className="text-blue-600 hover:underline disabled:text-gray-300"
              disabled={selected.length === 0}
              onClick={() => {
                onChange([]);
              }}
            >
              Clear
            </button>
          </div>
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">
              {isLoading ? "Loading options…" : "No options available"}
            </div>
          ) : (
            options.map((option: string) => {
              const checked: boolean = selected.includes(option);
              return (
                <label
                  key={option}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5"
                    checked={checked}
                    onChange={() => {
                      toggle(option);
                    }}
                  />
                  <span className="truncate">{option}</span>
                </label>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

const SingleVariableSelector: FunctionComponent<SingleVariableSelectorProps> = (
  props: SingleVariableSelectorProps,
): ReactElement => {
  const { variable } = props;

  const [dynamicOptions, setDynamicOptions] = useState<Array<string>>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState<boolean>(false);

  useEffect(() => {
    let cancelled: boolean = false;
    if (
      variable.type === DashboardVariableType.TelemetryAttribute &&
      variable.attributeKey
    ) {
      setIsLoadingOptions(true);
      MetricUtil.getTelemetryAttributeValues({
        attributeKey: variable.attributeKey,
      })
        .then((values: Array<string>) => {
          if (cancelled) {
            return;
          }
          setDynamicOptions(values);
        })
        .catch(() => {
          if (cancelled) {
            return;
          }
          setDynamicOptions([]);
        })
        .finally(() => {
          if (cancelled) {
            return;
          }
          setIsLoadingOptions(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [variable.type, variable.attributeKey]);

  const isTelemetryAttribute: boolean =
    variable.type === DashboardVariableType.TelemetryAttribute;
  const isCustomList: boolean =
    variable.type === DashboardVariableType.CustomList ||
    Boolean(variable.customListValues);

  const customListOptions: Array<string> = variable.customListValues
    ? variable.customListValues.split(",").map((v: string) => {
        return v.trim();
      })
    : [];

  const options: Array<string> = isTelemetryAttribute
    ? dynamicOptions
    : customListOptions;

  const useSelect: boolean = isTelemetryAttribute || isCustomList;
  const label: string = variable.label || variable.name;

  return (
    <div className="flex items-center gap-1.5">
      <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">
        {label}
      </label>
      {useSelect && variable.isMultiSelect ? (
        <MultiSelectPopover
          options={options}
          selected={variable.selectedValues || []}
          label={label}
          isLoading={isLoadingOptions}
          onChange={(next: Array<string>) => {
            props.onVariableValueChange(variable.id, { selectedValues: next });
          }}
        />
      ) : useSelect ? (
        <select
          className="text-xs border border-gray-200 rounded-md px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-colors"
          value={variable.selectedValue || variable.defaultValue || ""}
          disabled={isLoadingOptions}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            props.onVariableValueChange(variable.id, {
              selectedValue: e.target.value,
            });
          }}
        >
          <option value="">{isLoadingOptions ? "Loading…" : "All"}</option>
          {options.map((option: string) => {
            return (
              <option key={option} value={option}>
                {option}
              </option>
            );
          })}
        </select>
      ) : (
        <input
          type="text"
          className="text-xs border border-gray-200 rounded-md px-2.5 py-1.5 bg-white text-gray-700 w-28 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-colors"
          value={variable.selectedValue || variable.defaultValue || ""}
          placeholder={variable.name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            props.onVariableValueChange(variable.id, {
              selectedValue: e.target.value,
            });
          }}
        />
      )}
    </div>
  );
};

const DashboardVariableSelector: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.variables || props.variables.length === 0) {
    return <></>;
  }

  return (
    <div className="flex flex-wrap gap-3 items-center">
      {props.variables.map((variable: DashboardVariable) => {
        return (
          <SingleVariableSelector
            key={variable.id}
            variable={variable}
            onVariableValueChange={props.onVariableValueChange}
          />
        );
      })}
    </div>
  );
};

export default DashboardVariableSelector;
