import ObjectID from "../../../Types/ObjectID";
import React, {
  FunctionComponent,
  ReactElement,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Color from "../../../Types/Color";
import Label from "../../../Models/DatabaseModels/Label";
import Select, {
  ControlProps,
  FormatOptionLabelMeta,
  GroupBase,
  OptionProps,
} from "react-select";

export type DropdownValue = string | number | boolean;

export type DropdownOptionLabel =
  | Label
  | {
      id?: string;
      name: string;
      color?: string;
    };

export interface DropdownOption {
  value: DropdownValue;
  label: string;
  description?: string;
  labels?: Array<DropdownOptionLabel>;
}

export interface ComponentProps {
  options: Array<DropdownOption>;
  initialValue?: undefined | DropdownOption | Array<DropdownOption>;
  onClick?: undefined | (() => void);
  placeholder?: undefined | string;
  className?: undefined | string;
  onChange?:
    | undefined
    | ((value: DropdownValue | Array<DropdownValue> | null) => void);
  value?: DropdownOption | Array<DropdownOption> | undefined;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  isMultiSelect?: boolean;
  tabIndex?: number | undefined;
  error?: string | undefined;
  id?: string | undefined;
  dataTestId?: string | undefined;
}

const Dropdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  type GetDropdownOptionFromValueFunctionProps =
    | undefined
    | DropdownValue
    | DropdownOption
    | Array<DropdownOption>
    | Array<DropdownValue>;

  type GetDropdownOptionFromValueFunction = (
    value: GetDropdownOptionFromValueFunctionProps,
  ) => DropdownOption | Array<DropdownOption> | undefined;

  const getDropdownOptionFromValue: GetDropdownOptionFromValueFunction = (
    value: GetDropdownOptionFromValueFunctionProps,
  ): DropdownOption | Array<DropdownOption> | undefined => {
    if (value === undefined) {
      return undefined;
    }

    if (value instanceof ObjectID) {
      value = value.toString();
    }

    if (
      Array.isArray(value) &&
      value.length > 0 &&
      Object.keys(value[0]!).includes("value")
    ) {
      return value as Array<DropdownOption>;
    }

    if (
      Array.isArray(value) &&
      value.length > 0 &&
      (typeof value[0] === "string" || typeof value[0] === "number")
    ) {
      const options: Array<DropdownOption> = [];

      for (const item of value as Array<DropdownValue>) {
        if (
          !Array.isArray(item) &&
          (typeof item === "string" || typeof item === "number")
        ) {
          const option: DropdownOption | undefined | Array<DropdownOption> =
            props.options.find((option: DropdownOption) => {
              return option.value === item;
            }) as DropdownOption | Array<DropdownOption>;

          if (option) {
            options.push(option as DropdownOption);
          }
        }
      }

      return options;
    }

    if (
      !Array.isArray(value) &&
      (typeof value === "string" || typeof value === "number")
    ) {
      return props.options.find((option: DropdownOption) => {
        return option.value === value;
      }) as DropdownOption | Array<DropdownOption>;
    }

    return value as DropdownOption | Array<DropdownOption>;
  };

  const [value, setValue] = useState<
    DropdownOption | Array<DropdownOption> | undefined
  >(getDropdownOptionFromValue(props.initialValue));

  const firstUpdate: React.MutableRefObject<boolean> = useRef(true);

  interface NormalizedDropdownLabel {
    id?: string;
    name: string;
    color?: string;
  }

  const normalizeLabelColor: (color?: Color | string | null) => string | undefined = (
    color?: Color | string | null,
  ): string | undefined => {
    if (!color) {
      return undefined;
    }

    if (color instanceof Color) {
      return color.toString();
    }

    if (typeof color === "string" && color.trim().length > 0) {
      return color;
    }

    return undefined;
  };

  const normalizeDropdownLabel: (
    label: DropdownOptionLabel,
  ) => NormalizedDropdownLabel | null = (
    label: DropdownOptionLabel,
  ): NormalizedDropdownLabel | null => {
    if (!label) {
      return null;
    }

    const getValueFromModel: (
      columnName: string,
    ) => string | Color | null | undefined = (
      columnName: string,
    ): string | Color | null | undefined => {
      if (
        typeof (label as Label).getColumnValue === "function" &&
        typeof (label as Label).getTableColumnMetadata === "function"
      ) {
        return (label as Label).getColumnValue(columnName) as
          | string
          | Color
          | null
          | undefined;
      }

      return (label as any)?.[columnName] as
        | string
        | Color
        | null
        | undefined;
    };

    const labelName: string | undefined = (() => {
      const valueFromGetter: string | null | undefined = getValueFromModel(
        "name",
      ) as string | undefined | null;

      if (valueFromGetter && valueFromGetter.trim().length > 0) {
        return valueFromGetter;
      }

      const fallbackName: string | undefined = (label as any)?.name;
      if (fallbackName && fallbackName.trim().length > 0) {
        return fallbackName;
      }

      return undefined;
    })();

    if (!labelName) {
      return null;
    }

    const rawColor: Color | string | null | undefined = getValueFromModel(
      "color",
    ) as Color | string | null | undefined;
    const color: string | undefined =
      normalizeLabelColor(rawColor) || normalizeLabelColor((label as any)?.color);

    const idValue: string | undefined = (() => {
      if (typeof (label as Label).id !== "undefined") {
        const idFromGetter: ObjectID | null | undefined = (label as Label).id;
        if (idFromGetter) {
          return idFromGetter.toString();
        }
      }

      const fallbackId: string | undefined =
        (label as any)?._id || (label as any)?.id;

      if (fallbackId) {
        return fallbackId;
      }

      return undefined;
    })();

    const normalized: NormalizedDropdownLabel = {
      name: labelName,
    };

    if (idValue) {
      normalized.id = idValue;
    }

    if (color) {
      normalized.color = color;
    }

    return normalized;
  };

  const normalizeLabelCollection: (
    labels?: Array<DropdownOptionLabel>,
  ) => Array<NormalizedDropdownLabel> = (
    labels?: Array<DropdownOptionLabel>,
  ): Array<NormalizedDropdownLabel> => {
    if (!labels || labels.length === 0) {
      return [];
    }

    return labels
      .map((label: DropdownOptionLabel) => {
        return normalizeDropdownLabel(label);
      })
      .filter((label): label is NormalizedDropdownLabel => {
        return label !== null;
      });
  };

  const getLabelStyle: (
    color?: string,
  ) => { backgroundColor: string; color: string } = (
    color?: string,
  ): { backgroundColor: string; color: string } => {
    if (!color) {
      return {
        backgroundColor: "#e5e7eb", // gray-200
        color: "#374151", // gray-700
      };
    }

    try {
      const parsedColor: Color = Color.fromString(color);
      return {
        backgroundColor: parsedColor.toString(),
        color: Color.shouldUseDarkText(parsedColor)
          ? "#111827" // gray-900
          : "#f9fafb", // gray-50
      };
    } catch (err) {
      return {
        backgroundColor: color,
        color: "#111827",
      };
    }
  };

  const formatDropdownOptionLabel: (
    option: DropdownOption,
    meta: FormatOptionLabelMeta<DropdownOption>,
  ) => ReactElement = (
    option: DropdownOption,
    meta: FormatOptionLabelMeta<DropdownOption>,
  ): ReactElement => {
    const normalizedLabels: Array<NormalizedDropdownLabel> =
      normalizeLabelCollection(option.labels);

    const maxVisibleLabels: number = meta.context === "menu" ? 4 : 2;
    const visibleLabels: Array<NormalizedDropdownLabel> = normalizedLabels.slice(
      0,
      maxVisibleLabels,
    );
    const hiddenLabelCount: number = Math.max(
      normalizedLabels.length - visibleLabels.length,
      0,
    );

    if (meta.context === "value") {
      return (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-sm font-medium text-gray-900">
            {option.label}
          </span>
          {visibleLabels.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              {visibleLabels.map(
                (label: NormalizedDropdownLabel, index: number) => {
                  const { backgroundColor, color } = getLabelStyle(
                    label.color,
                  );

                  return (
                    <span
                      key={`${label.id || label.name}-${index}`}
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium shadow-sm"
                      style={{ backgroundColor, color }}
                    >
                      {label.name}
                    </span>
                  );
                },
              )}
              {hiddenLabelCount > 0 ? (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  +{hiddenLabelCount}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-gray-900">
          {option.label}
        </span>
        {option.description ? (
          <span className="text-xs text-gray-500">{option.description}</span>
        ) : null}
        {visibleLabels.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {visibleLabels.map(
              (label: NormalizedDropdownLabel, index: number) => {
                const { backgroundColor, color } = getLabelStyle(label.color);

                return (
                  <span
                    key={`${label.id || label.name}-menu-${index}`}
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium shadow-sm"
                    style={{ backgroundColor, color }}
                  >
                    {label.name}
                  </span>
                );
              },
            )}
            {hiddenLabelCount > 0 ? (
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                +{hiddenLabelCount}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  useLayoutEffect(() => {
    if (firstUpdate.current && props.initialValue) {
      firstUpdate.current = false;
      return;
    }

    const value: DropdownOption | Array<DropdownOption> | undefined =
      getDropdownOptionFromValue(
        props.value === null ? undefined : props.value,
      );

    setValue(value);
  }, [props.value]);

  return (
    <div
      id={props.id}
      className={`${
        props.className ||
        "relative mt-2 mb-1 rounded-md w-full overflow-visible"
      }`}
      onClick={() => {
        props.onClick?.();
        props.onFocus?.();
      }}
    >
      <Select
        classNamePrefix="ou-select"
        unstyled={false}
        formatOptionLabel={formatDropdownOptionLabel}
        onBlur={() => {
          props.onBlur?.();
        }}
        data-testid={props.dataTestId}
        tabIndex={props.tabIndex}
        isMulti={props.isMultiSelect}
        value={value || null}
        onFocus={() => {
          props.onFocus?.();
        }}
        classNames={{
          control: (
            state: ControlProps<DropdownOption, boolean, GroupBase<any>>,
          ): string => {
            const classes: Array<string> = [
              "!min-h-[40px] !rounded-lg !border !bg-white !shadow-sm !transition-all !duration-150",
              state.isFocused
                ? "!border-indigo-400 !ring-2 !ring-indigo-100"
                : "!border-gray-300 hover:!border-indigo-300",
              state.isDisabled ? "!bg-gray-100 !text-gray-400" : "!cursor-pointer",
            ];

            if (props.error) {
              classes.push("!border-red-400 !ring-2 !ring-red-100");
            }

            return classes.join(" ");
          },
          valueContainer: () => "!gap-2 !px-2",
          placeholder: () => "text-sm text-gray-400",
          input: () => "text-sm text-gray-900",
          singleValue: () => "text-sm text-gray-900 font-medium",
          indicatorsContainer: () => "!gap-1 !px-1",
          dropdownIndicator: () =>
            "text-gray-500 transition-colors duration-150 hover:text-indigo-400",
          clearIndicator: () =>
            "text-gray-400 transition-colors duration-150 hover:text-red-500",
          menu: () =>
            "!mt-2 !rounded-xl !border !border-gray-100 !bg-white !shadow-xl",
          menuList: () => "!py-2",
          option: (
            state: OptionProps<DropdownOption, boolean, GroupBase<any>>,
          ): string => {
            if (state.isDisabled) {
              return "px-3 py-2 text-sm text-gray-300 cursor-not-allowed";
            }

            if (state.isSelected) {
              return "px-3 py-2 text-sm bg-indigo-200 text-indigo-900";
            }

            if (state.isFocused) {
              return "px-3 py-2 text-sm bg-indigo-100 text-indigo-700";
            }

            return "px-3 py-2 text-sm text-gray-700";
          },
          noOptionsMessage: () => "px-3 py-2 text-sm text-gray-500",
          multiValue: () =>
            "flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5",
          multiValueLabel: () => "text-xs font-medium text-indigo-700",
          multiValueRemove: () =>
            "text-indigo-400 hover:text-indigo-600 transition-colors duration-150",
        }}
        styles={{
          dropdownIndicator: (provided) => ({
            ...provided,
            padding: 8,
          }),
          clearIndicator: (provided) => ({
            ...provided,
            padding: 8,
          }),
          indicatorSeparator: () => ({
            display: "none",
          }),
          option: (provided, state) => {
            if (state.isSelected) {
              return {
                ...provided,
                backgroundColor: "#c7d2fe", // indigo-200
                color: "#1e1b4b", // indigo-900
              };
            }

            if (state.isFocused) {
              return {
                ...provided,
                backgroundColor: "#e0e7ff", // indigo-100
                color: "#312e81", // indigo-800
              };
            }

            return {
              ...provided,
              color: "#374151", // gray-700
            };
          },
          multiValue: (provided) => ({
            ...provided,
            backgroundColor: "#e0e7ff", // indigo-100
          }),
          multiValueLabel: (provided) => ({
            ...provided,
            color: "#4338ca", // indigo-600
          }),
          multiValueRemove: (provided) => ({
            ...provided,
            color: "#6366f1", // indigo-500
            ':hover': {
              color: "#4f46e5", // indigo-600
              backgroundColor: "transparent",
            },
          }),
          menuPortal: (base) => ({
            ...base,
            zIndex: 50,
          }),
        }}
        isClearable={true}
        isSearchable={true}
        placeholder={props.placeholder}
        options={props.options as any}
        onChange={(option: any | null) => {
          if (option) {
            if (props.isMultiSelect) {
              const value: Array<DropdownOption> =
                option as Array<DropdownOption>;
              setValue(value);

              props.onChange?.(
                value.map((i: DropdownOption) => {
                  return i.value;
                }),
              );
            } else {
              const value: DropdownOption = option as DropdownOption;
              setValue(value);
              props.onChange?.(value.value);
            }
          }

          if (option === null && props.isMultiSelect) {
            setValue([]);
            props.onChange?.([]);
          }

          if (option === null && !props.isMultiSelect) {
            setValue(undefined);
            props.onChange?.(null);
          }
        }}
      />
      {props.error && (
        <p data-testid="error-message" className="mt-1 text-sm text-red-400">
          {props.error}
        </p>
      )}
    </div>
  );
};

export default Dropdown;
