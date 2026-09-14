import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import DashboardVariable, {
  DashboardVariableType,
  DashboardVariableOption,
} from "../../../Types/Dashboard/DashboardVariable";

export interface VariableValueChange {
  selectedValue?: string | undefined;
  selectedValues?: Array<string> | undefined;
}

export interface ComponentProps {
  variable: DashboardVariable;
  dynamicOptions?: Array<string> | undefined;
  isLoadingOptions?: boolean | undefined;
  onVariableValueChange: (
    variableId: string,
    change: VariableValueChange,
  ) => void;
}

const MultiSelectPopover: FunctionComponent<{
  options: Array<DashboardVariableOption>;
  selected: Array<string>;
  label: string;
  isLoading: boolean;
  maxSelections?: number | undefined;
  unavailableLabel?: string | undefined;
  onChange: (next: Array<string>) => void;
}> = ({
  options,
  selected,
  label,
  isLoading,
  maxSelections,
  unavailableLabel,
  onChange,
}: {
  options: Array<DashboardVariableOption>;
  selected: Array<string>;
  label: string;
  isLoading: boolean;
  maxSelections?: number | undefined;
  unavailableLabel?: string | undefined;
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
        ? options.find((option: DashboardVariableOption) => {
            return option.value === selected[0];
          })?.label ||
          unavailableLabel ||
          (selected[0] as string)
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
        aria-label={`${label}: ${buttonText}`}
        aria-expanded={open}
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
          {maxSelections !== undefined && selected.length >= maxSelections && (
            <p className="px-3 py-1 text-xs text-gray-500">
              Choose up to {maxSelections} labels.
            </p>
          )}
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">
              {isLoading ? "Loading options…" : "No options available"}
            </div>
          ) : (
            options.map((option: DashboardVariableOption) => {
              const checked: boolean = selected.includes(option.value);
              return (
                <label
                  key={option.value}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5"
                    checked={checked}
                    disabled={
                      !checked &&
                      maxSelections !== undefined &&
                      selected.length >= maxSelections
                    }
                    onChange={() => {
                      toggle(option.value);
                    }}
                  />
                  <span className="truncate">{option.label}</span>
                </label>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

const DashboardVariableControl: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { variable } = props;
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

  const isProjectLabel: boolean =
    variable.type === DashboardVariableType.ProjectLabel;
  const options: Array<DashboardVariableOption> = isProjectLabel
    ? variable.labelOptions || []
    : (isTelemetryAttribute
        ? props.dynamicOptions || []
        : customListOptions
      ).map((value: string) => {
        return { label: value, value };
      });
  const selectedValue: string =
    variable.selectedValue ?? variable.defaultValue ?? "";
  const isUnavailableSelection: boolean = Boolean(
    isProjectLabel &&
      selectedValue &&
      !options.some((option: DashboardVariableOption) => {
        return option.value === selectedValue;
      }),
  );

  const useSelect: boolean =
    isTelemetryAttribute || isCustomList || isProjectLabel;
  const label: string = variable.label || variable.name;

  return (
    <div className="flex items-center gap-1.5">
      <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">
        {label}
      </label>
      {useSelect && variable.isMultiSelect ? (
        /*
         * `selectedValues` only — never defaultValue. The popover renders
         * "All" for an empty list, and DashboardVariableInterpolation
         * resolves an empty list to no predicate, so the two agree. Seeding
         * this from defaultValue would put a filter behind a control that
         * reads "All".
         */
        <MultiSelectPopover
          options={options}
          selected={variable.selectedValues || []}
          label={label}
          isLoading={Boolean(props.isLoadingOptions)}
          maxSelections={isProjectLabel ? 100 : undefined}
          unavailableLabel={isProjectLabel ? "Unavailable label" : undefined}
          onChange={(next: Array<string>) => {
            props.onVariableValueChange(variable.id, { selectedValues: next });
          }}
        />
      ) : useSelect ? (
        <select
          aria-label={label}
          className="text-xs border border-gray-200 rounded-md px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-colors"
          /*
           * `??`, not `||`: picking "All" stores selectedValue as "", which is
           * a real selection and must not collapse back to defaultValue. Only
           * an unset (undefined) selection falls through to the default — the
           * same rule the query side applies in
           * Common/Utils/Dashboard/VariableInterpolation.ts, so what the
           * toolbar shows and what the widgets are filtered by stay in step.
           */
          value={variable.selectedValue ?? variable.defaultValue ?? ""}
          disabled={props.isLoadingOptions}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            props.onVariableValueChange(variable.id, {
              selectedValue: e.target.value,
            });
          }}
        >
          <option value="">
            {props.isLoadingOptions ? "Loading…" : "All"}
          </option>
          {isUnavailableSelection && (
            <option value={selectedValue}>Unavailable label</option>
          )}
          {options.map((option: DashboardVariableOption) => {
            return (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            );
          })}
        </select>
      ) : (
        <input
          type="text"
          aria-label={label}
          className="text-xs border border-gray-200 rounded-md px-2.5 py-1.5 bg-white text-gray-700 w-28 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-colors"
          // `??` so clearing the box stays cleared. See the select above.
          value={variable.selectedValue ?? variable.defaultValue ?? ""}
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

export default DashboardVariableControl;
