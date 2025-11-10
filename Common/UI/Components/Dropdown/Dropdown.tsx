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
  FormatOptionLabelMeta,
  GroupBase,
  OptionProps,
} from "react-select";
import { Black } from "../../../Types/BrandColors";

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

  const getLabelColorAsString: (label: DropdownOptionLabel) => string = (
    label: DropdownOptionLabel,
  ): string => {
    const color: DropdownOptionLabel["color"] = label.color;

    if (!color) {
      return Black.toString();
    }

    if (typeof color === "string") {
      return color;
    }

    if (typeof (color as any)?.toString === "function") {
      try {
        return (color as any).toString();
      } catch (err) {
        return Black.toString();
      }
    }

    return Black.toString();
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

    const paddingClassName: string =
      size === "menu" ? "px-2 py-0.5" : "px-1.5 py-0.5";
    const textClassName: string =
      size === "menu"
        ? "text-xs font-medium text-gray-700"
        : "text-[11px] font-medium text-gray-600";
    const moreLabelClassName: string =
      size === "menu"
        ? "text-xs font-medium text-gray-500"
        : "text-[10px] font-medium text-gray-500";

    return (
      <div className="flex flex-wrap items-center gap-1">
        {visibleLabels.map((label: DropdownOptionLabel, index: number) => {
          const labelId: string =
            label.id?.toString() ||
            label.slug?.toString() ||
            label.name?.toString() ||
            `label-${index}`;

          return (
            <span
              key={labelId}
              className={`inline-flex max-w-[160px] items-center gap-1 rounded-full border border-gray-200 bg-white/70 ${paddingClassName} shadow-sm ${textClassName}`}
            >
              <span
                className="h-2 w-2 flex-shrink-0 rounded-full"
                style={{
                  backgroundColor: getLabelColorAsString(label),
                }}
              ></span>
              <span className="truncate">
                {label.name || label.slug || "Label"}
              </span>
            </span>
          );
        })}
        {hiddenCount > 0 && (
          <span className={moreLabelClassName}>+{hiddenCount}</span>
        )}
      </div>
    );
  };

  const formatOptionLabel = (
    option: DropdownOption,
    meta: FormatOptionLabelMeta<DropdownOption>,
  ): ReactNode => {
    if (meta.context === "value") {
      if (props.isMultiSelect) {
        return <span className="truncate">{option.label}</span>;
      }

      return (
        <div className="flex items-center gap-2 truncate">
          <span className="truncate font-medium text-gray-900">
            {option.label}
          </span>
          {renderLabelBadges(option.labels, {
            maxVisible: 2,
            size: "value",
          })}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-1 py-1">
        <span className="font-medium text-gray-900">{option.label}</span>
        {renderLabelBadges(option.labels, {
          maxVisible: 3,
          size: "menu",
        })}
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
            return state.isFocused
              ? "!border-indigo-500"
              : "border-Gray500-300";
          },
          option: (
            state: OptionProps<any, boolean, GroupBase<any>>,
          ): string => {
            if (state.isDisabled) {
              return "bg-gray-100";
            }
            if (state.isSelected) {
              return "!bg-indigo-500";
            }
            if (state.isFocused) {
              return "!bg-indigo-100";
            }
            return "";
          },
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
