import ObjectID from "../../../Types/ObjectID";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Select, {
  ControlProps,
  DropdownIndicatorProps,
  FormatOptionLabelMeta,
  GroupBase,
  OptionProps,
  components as selectComponents,
} from "react-select";
import Pill, { PillSize } from "../Pill/Pill";
import { Black } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";

export type DropdownValue = string | number | boolean;

export interface DropdownOptionLabel {
  id?: string | null;
  name?: string | null;
  color?: string | { toString: () => string } | null;
  slug?: string | null;
}

export interface DropdownOption {
  value: DropdownValue;
  label: string;
  labels?: Array<DropdownOptionLabel> | undefined;
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
  type LabelBadgeSize = "menu" | "value";

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

  const resolveLabelColor: (label: DropdownOptionLabel) => Color = (
    label: DropdownOptionLabel,
  ): Color => {
    const labelColor: DropdownOptionLabel["color"] = label.color;

    if (!labelColor) {
      return Black;
    }

    if (labelColor instanceof Color) {
      return labelColor;
    }

    if (typeof labelColor === "string") {
      try {
        return Color.fromString(labelColor);
      } catch (_) {
        return Black;
      }
    }

    if (typeof (labelColor as any)?.toString === "function") {
      try {
        return Color.fromString((labelColor as any).toString());
      } catch (_) {
        return Black;
      }
    }

    return Black;
  };

  const renderLabelBadges = (
    optionLabels?: Array<DropdownOptionLabel>,
    config?: { maxVisible?: number; size?: LabelBadgeSize },
  ): ReactElement | null => {
    if (!optionLabels || optionLabels.length === 0) {
      return null;
    }

    const sanitizedLabels: Array<DropdownOptionLabel> = optionLabels.filter(
      (label: DropdownOptionLabel | null | undefined) => {
        return Boolean(label && (label.name || label.slug));
      },
    ) as Array<DropdownOptionLabel>;

    if (sanitizedLabels.length === 0) {
      return null;
    }

    const maxVisible: number = config?.maxVisible || 3;
    const size: LabelBadgeSize = config?.size || "menu";

    const visibleLabels: Array<DropdownOptionLabel> = sanitizedLabels.slice(
      0,
      Math.max(0, maxVisible),
    );
    const hiddenCount: number = sanitizedLabels.length - visibleLabels.length;

    const containerClassName: string =
      size === "menu"
        ? "flex flex-wrap items-center gap-2"
        : "flex flex-wrap items-center gap-1.5";
    const moreLabelClassName: string =
      size === "menu"
        ? "inline-flex items-center rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-inset ring-slate-200"
        : "inline-flex items-center rounded-full bg-slate-50 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500 ring-1 ring-inset ring-slate-200";
    const pillSize: PillSize = size === "menu" ? PillSize.Normal : PillSize.Small;
    const pillStyle =
      size === "menu"
        ? {
            maxWidth: "220px",
            display: "inline-flex",
            alignItems: "center",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }
        : {
            maxWidth: "180px",
            display: "inline-flex",
            alignItems: "center",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          };

    return (
      <div className={containerClassName}>
        {visibleLabels.map((label: DropdownOptionLabel, index: number) => {
          const labelId: string =
            label.id?.toString() ||
            label.slug?.toString() ||
            label.name?.toString() ||
            `label-${index}`;

          return (
            <Pill
              key={labelId}
              color={resolveLabelColor(label)}
              text={label.name || label.slug || "Label"}
              size={pillSize}
              style={pillStyle}
              icon={IconProp.Label}
            />
          );
        })}
        {hiddenCount > 0 && (
          <span className={`${moreLabelClassName} transition-colors duration-150 ease-out hover:bg-slate-100`}>
            +{hiddenCount}
          </span>
        )}
      </div>
    );
  };

  const formatOptionLabel = (
    option: DropdownOption,
    meta: FormatOptionLabelMeta<DropdownOption>,
  ): ReactNode => {
    const labelBadges: ReactElement | null = renderLabelBadges(option.labels, {
      maxVisible: meta.context === "value" ? 2 : 3,
      size: meta.context === "value" ? "value" : "menu",
    });

    if (meta.context === "value") {
      if (props.isMultiSelect) {
        return (
          <span className="truncate text-sm font-semibold text-slate-700">
            {option.label}
          </span>
        );
      }

      return (
        <div className="flex flex-col gap-1 truncate">
          <span className="truncate text-sm font-semibold text-slate-900">
            {option.label}
          </span>
          {labelBadges}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-1 py-1">
        <span className="text-sm font-semibold text-slate-900">
          {option.label}
        </span>
        {labelBadges}
      </div>
    );
  };

  useLayoutEffect(() => {
    if (firstUpdate.current && props.initialValue) {
      firstUpdate.current = false;
      return;
    }

    const newValue: DropdownOption | Array<DropdownOption> | undefined =
      getDropdownOptionFromValue(
        props.value === null ? undefined : props.value,
      );

    setValue(newValue);
  }, [props.value]);

  const containerClassName: string =
    props.className || "group relative mb-1 mt-2 w-full overflow-visible";

  return (
    <div
      id={props.id}
      className={containerClassName}
      onClick={() => {
        props.onClick?.();
        props.onFocus?.();
      }}
    >
      <Select
        formatOptionLabel={formatOptionLabel}
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
            state: ControlProps<any, boolean, GroupBase<any>>,
          ): string => {
            const baseClasses: string =
              "!min-h-[44px] !rounded-xl !border transition-all duration-150 ease-out !shadow-sm bg-white";
            const errorClasses: string = props.error
              ? "!border-red-400 !ring-2 !ring-red-100"
              : "";
            const focusClasses: string = state.isFocused
              ? "!border-indigo-400 !ring-2 !ring-indigo-200/60"
              : "hover:!border-slate-300 !border-slate-200";

            return `${baseClasses} ${errorClasses} ${focusClasses}`.trim();
          },
          option: (
            state: OptionProps<any, boolean, GroupBase<any>>,
          ): string => {
            const baseClasses: string =
              "rounded-lg px-3 py-2 text-sm transition-all duration-150 ease-out flex flex-col gap-1";
            if (state.isDisabled) {
              return `${baseClasses} cursor-not-allowed bg-slate-50 text-slate-400`;
            }
            if (state.isSelected) {
              return `${baseClasses} !bg-indigo-100 !text-indigo-700 shadow-sm ring-1 ring-indigo-200/70`;
            }
            if (state.isFocused) {
              return `${baseClasses} !bg-indigo-50/80 !text-indigo-700 shadow-sm ring-1 ring-indigo-100`;
            }
            return `${baseClasses} text-slate-700 hover:bg-slate-50 hover:text-slate-900`;
          },
          menu: (): string => {
            return "!mt-2 !rounded-2xl !border !border-slate-100 !bg-white !shadow-2xl overflow-hidden";
          },
          menuList: (): string => {
            return "!p-2 flex flex-col gap-1";
          },
          valueContainer: (): string => {
            return "!px-3 !py-2 gap-2";
          },
          placeholder: (): string => {
            return "!text-sm !text-slate-400";
          },
          singleValue: (): string => {
            return "!text-sm !font-semibold !text-slate-900 flex flex-col";
          },
          multiValue: (): string => {
            return "!rounded-full !border !border-transparent !bg-slate-100/80 !px-1.5 !py-0.5 items-center gap-1 transition-colors duration-150 hover:!bg-slate-100 hover:!border-slate-200/70";
          },
          multiValueLabel: (): string => {
            return "!text-[11px] !font-medium !text-slate-600 flex items-center gap-1";
          },
          multiValueRemove: (): string => {
            return "!text-slate-400 hover:!bg-red-50 hover:!text-red-500/80 rounded-full transition-colors";
          },
          dropdownIndicator: (): string => {
            return "!px-3 text-slate-400 transition-all duration-150";
          },
          input: (): string => {
            return "!text-sm !text-slate-900";
          },
          noOptionsMessage: (): string => {
            return "!py-2 !text-sm !text-slate-500";
          },
        }}
        components={{
          IndicatorSeparator: () => null,
          DropdownIndicator: (
            indicatorProps: DropdownIndicatorProps<DropdownOption, boolean>,
          ): ReactElement => {
            return (
              <selectComponents.DropdownIndicator {...indicatorProps}>
                <svg
                  aria-hidden="true"
                  className={`h-4 w-4 transition-transform duration-200 ease-out ${
                    indicatorProps.selectProps.menuIsOpen ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M6 9l6 6 6-6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </selectComponents.DropdownIndicator>
            );
          },
        }}
        isClearable={true}
        isSearchable={true}
        placeholder={props.placeholder}
        options={props.options as any}
        onChange={(option: any | null) => {
          if (option) {
            if (props.isMultiSelect) {
              const selectedOptions: Array<DropdownOption> =
                option as Array<DropdownOption>;
              setValue(selectedOptions);

              props.onChange?.(
                selectedOptions.map((item: DropdownOption) => {
                  return item.value;
                }),
              );
            } else {
              const selectedOption: DropdownOption = option as DropdownOption;
              setValue(selectedOption);
              props.onChange?.(selectedOption.value);
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
