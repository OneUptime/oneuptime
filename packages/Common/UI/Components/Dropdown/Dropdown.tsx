import ObjectID from "../../../Types/ObjectID";
import ArchivedTag from "../ArchivedTag/ArchivedTag";
import DROPDOWN_MENU_Z_INDEX from "./DropdownMenuZIndex";
import { getDropdownLabelDirection } from "./DropdownLabelDirection";
import joinAriaIds from "../../Utils/AriaIds";
import useTranslateValue from "../../Utils/Translation";
import { createTranslator } from "../../Utils/TranslateTemplate";
import React, {
  FunctionComponent,
  ReactElement,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Color from "../../../Types/Color";
import { sortByNaturalName } from "../../../Utils/NaturalOrder";
import Label from "../../../Models/DatabaseModels/Label";
import Select, {
  components as ReactSelectComponents,
  ControlProps,
  createFilter,
  CSSObjectWithLabel,
  FormatOptionLabelMeta,
  GroupBase,
  InputProps,
  MultiValueRemoveProps,
  OptionProps,
  OptionsOrGroups,
} from "react-select";
import CreatableSelect from "react-select/creatable";

export type DropdownValue = string | number | boolean;

export type DropdownOptionLabel =
  | Label
  | {
      id?: string;
      name: string;
      color?: Color;
    };

export interface DropdownOption {
  value: DropdownValue;
  label: string;
  description?: string;
  labels?: Array<DropdownOptionLabel>;
  color?: Color;
  /*
   * Other values that mean this option — the retired spellings of a
   * timezone, say ("Singapore" for Asia/Singapore). A value that is no
   * option's own is matched against these, so a record saved before a
   * spelling was retired still shows its option instead of the placeholder.
   * Choosing the option emits `value`, never an alias.
   */
  aliases?: Array<DropdownValue>;
  /*
   * The label is something a person named - a variable, a record - drawn as
   * it is, never looked up as a translation key: a variable named
   * "Password" stays "Password" in German, never "Passwort". Left out, the
   * label is English to look up.
   */
  isUserContent?: boolean | undefined;
  /*
   * The label is the product's own words, put together by the picker from
   * translated parts ("Global Runner · Connected"): it reads the page's
   * way, as a label the Dropdown translates itself does. Left out, a label
   * nobody translated - a name - reads the way most of its letters do
   * (DropdownLabelDirection), which would turn a Persian label made of
   * parts that starts with a Latin word ("Runner سراسری · متصل") left to
   * right, its words out of order.
   */
  isInPageDirection?: boolean | undefined;
  /*
   * An archived value a record still has (Common/Utils/ArchivableValues):
   * a picker never lists one, but shows the one already picked, marked
   * Archived, so it can be kept or changed.
   */
  isArchived?: boolean | undefined;
  /*
   * Shown in the menu but never picked: a choice that is not open here,
   * with its description saying why ("Runs JavaScript steps only."). The
   * menu draws it muted and passes over it, mouse and keyboard alike, and
   * a screen reader hears it as unavailable (react-select reads this
   * field).
   */
  isDisabled?: boolean | undefined;
}

export interface DropdownOptionGroup {
  label: string;
  options: Array<DropdownOption>;
}

export { DROPDOWN_MENU_Z_INDEX };

// What react-select hands a filter for each option it considers.
interface SearchableOption {
  readonly label: string;
  readonly value: string;
  readonly data: DropdownOption;
}

/*
 * react-select's own filter — case- and accent-insensitive, trimmed — over
 * the label and value as before, and over an option's aliases too, so typing
 * a retired spelling ("Calcutta", "US/Eastern") still finds the option it
 * now lives under. An option without aliases is searched exactly as it was.
 */
const filterOption: (option: SearchableOption, rawInput: string) => boolean =
  createFilter<DropdownOption>({
    stringify: (option: SearchableOption): string => {
      return [option.label, option.value, ...(option.data.aliases || [])].join(
        " ",
      );
    },
  });

export interface ComponentProps {
  options: Array<DropdownOption | DropdownOptionGroup>;
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
  ariaLabel?: string | undefined;
  ariaLabelledby?: string | undefined;
  // What describes the list besides its error, read first: its field's help.
  ariaDescribedby?: string | undefined;
  disabled?: boolean | undefined;
  /*
   * Show the clear (×) control. Defaults to true; turn it off for a choice
   * that must always have a value, where clearing would only be undone.
   */
  isClearable?: boolean | undefined;
  /*
   * A person may add a value no option has: what they type is offered at
   * the foot of the menu as a row of its own (formatCreateLabel words it,
   * in the reader's language), and picked, it is a value drawn as written.
   * Off unless set.
   */
  isCreatable?: boolean | undefined;
  // The row that adds what was typed, in the reader's language.
  formatCreateLabel?: ((inputValue: string) => string) | undefined;
  /*
   * The options are on their way: the control shows a spinner and the open
   * menu says loadingMessage (in the reader's language).
   */
  isLoading?: boolean | undefined;
  loadingMessage?: string | undefined;
  /*
   * What the open menu says when no option matches what was typed, in the
   * reader's language. Left out: react-select's own "No options".
   */
  noOptionsMessage?: ((inputValue: string) => string) | undefined;
  // The menu opened: a list that is read only once it is needed.
  onMenuOpen?: (() => void) | undefined;
  // The menu closed: what it covered under the control can show again.
  onMenuClose?: (() => void) | undefined;
  /*
   * A single pick shows its whole name, on a second line if it must, instead
   * of ending in an ellipsis: for a field whose value has to be read to be
   * checked - a monitor criteria's Filter Type in a phone's narrow form, where
   * "SNMP Walk Is Succeeding" was cut to "SNMP Walk...". Off unless set: a
   * picker in a toolbar or a header keeps its one line.
   */
  wrapsPickedValue?: boolean | undefined;
  /*
   * Close the menu once an option is picked. Defaults to true; a
   * multi-select whose people pick several in a row turns it off, so the
   * list stays open, at the same place, for the next one.
   */
  closeMenuOnSelect?: boolean | undefined;
}

// Whether text names an option of the list, as a typed value would.
const namesAnOption: (
  text: string,
  options: ReadonlyArray<DropdownOption | DropdownOptionGroup>,
) => boolean = (
  text: string,
  options: ReadonlyArray<DropdownOption | DropdownOptionGroup>,
): boolean => {
  const wanted: string = text.trim().toLowerCase();

  return options.some((item: DropdownOption | DropdownOptionGroup): boolean => {
    if ("options" in item && Array.isArray(item.options)) {
      return namesAnOption(text, item.options);
    }

    const option: DropdownOption = item as DropdownOption;

    return (
      String(option.value).trim().toLowerCase() === wanted ||
      String(option.label).trim().toLowerCase() === wanted
    );
  });
};

/*
 * A picked value's name. A single pick longer than the control - a
 * template's name on a phone - ends in an ellipsis (min-w-0 lets it shrink).
 * A multi-select's chip shows the whole name instead, wrapping inside the
 * chip, and the chip is never wider than the control.
 */
export const SINGLE_SELECT_VALUE_LABEL_CLASS_NAME: string =
  "truncate text-sm font-medium text-gray-900";

// A single pick that shows whole (wrapsPickedValue): it wraps instead.
export const SINGLE_SELECT_WRAPPED_VALUE_LABEL_CLASS_NAME: string =
  "min-w-0 whitespace-normal [overflow-wrap:anywhere] text-sm font-medium text-gray-900";

export const MULTI_SELECT_CHIP_LABEL_CLASS_NAME: string =
  "min-w-0 whitespace-normal [overflow-wrap:anywhere] text-sm font-medium text-gray-900";

/*
 * The colours of one option in the open menu. A picked option is indigo-200,
 * the one the keys or the mouse are on indigo-100 - except an option that
 * cannot be picked (isDisabled): react-select still moves focus onto it, and
 * on to the first option whenever the menu opens, so the one a dialog marks
 * Current was painted as the choice Enter would make. It keeps its muted
 * text and gets only a grey row while focus is on it: the keyboard can see
 * where it is, and nobody reads it as the next pick. Theme.css says the same
 * in dark mode (.ou-select__option--is-disabled).
 */
export const getDropdownOptionStyle: (
  provided: CSSObjectWithLabel,
  state: { isSelected: boolean; isFocused: boolean; isDisabled: boolean },
) => CSSObjectWithLabel = (
  provided: CSSObjectWithLabel,
  state: { isSelected: boolean; isFocused: boolean; isDisabled: boolean },
): CSSObjectWithLabel => {
  if (state.isDisabled) {
    return {
      ...provided,
      backgroundColor: state.isFocused ? "#f3f4f6" : "transparent", // gray-100
      color: "#6b7280", // gray-500
      cursor: "not-allowed",
    };
  }

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
};

const Dropdown: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const tx: (value: string | undefined) => string | undefined = (
    value: string | undefined,
  ): string | undefined => {
    return translateString(value);
  };
  const uniqueId: string = useId();
  const errorId: string = `dropdown-error-${uniqueId}`;

  // An option's label as drawn: as written when a person named it.
  const getOptionLabelText: (option: DropdownOption) => string = (
    option: DropdownOption,
  ): string => {
    if (option.isUserContent) {
      return option.label;
    }

    return tx(option.label) ?? option.label;
  };

  /*
   * Which way an option's label reads, picked or listed: the page's way
   * for the product's own words in the reader's language, the way most of
   * its letters do for a name (DropdownLabelDirection). Undefined: no
   * `dir` of its own.
   */
  const getOptionLabelDirection: (
    option: DropdownOption,
  ) => "ltr" | "rtl" | undefined = (
    option: DropdownOption,
  ): "ltr" | "rtl" | undefined => {
    return getDropdownLabelDirection({
      label: option.label,
      shownText: getOptionLabelText(option),
      isUserContent: option.isUserContent,
      isInPageDirection: option.isInPageDirection,
    });
  };

  const isDropdownOptionGroup: (
    item: DropdownOption | DropdownOptionGroup,
  ) => item is DropdownOptionGroup = (
    item: DropdownOption | DropdownOptionGroup,
  ): item is DropdownOptionGroup => {
    return (
      "options" in item && Array.isArray((item as DropdownOptionGroup).options)
    );
  };

  const flatOptions: Array<DropdownOption> = props.options.flatMap(
    (item: DropdownOption | DropdownOptionGroup) => {
      if (isDropdownOptionGroup(item)) {
        return item.options;
      }
      return [item];
    },
  );

  /*
   * An option's own value wins over another option's alias, so adding an
   * alias can never change what an existing value selects.
   */
  const findOptionByValue: (
    value: DropdownValue,
  ) => DropdownOption | undefined = (
    value: DropdownValue,
  ): DropdownOption | undefined => {
    return (
      flatOptions.find((option: DropdownOption) => {
        return option.value === value;
      }) ||
      flatOptions.find((option: DropdownOption) => {
        return Boolean(option.aliases?.includes(value));
      })
    );
  };

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
          const option: DropdownOption | undefined = findOptionByValue(item);

          /*
           * Once aliases resolve, two stored values can be the same option
           * ("Singapore" and "Asia/Singapore"): show it once.
           */
          if (option && !options.includes(option)) {
            options.push(option);
          }
        }
      }

      return options;
    }

    if (
      !Array.isArray(value) &&
      (typeof value === "string" || typeof value === "number")
    ) {
      return findOptionByValue(value);
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

  const normalizeLabelColor: (
    color?: Color | string | null,
  ) => string | undefined = (
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

      return (label as any)?.[columnName] as string | Color | null | undefined;
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
      normalizeLabelColor(rawColor) ||
      normalizeLabelColor((label as any)?.color);

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

    // In natural order, as labels are listed everywhere (Utils/LabelOrder).
    return sortByNaturalName<NormalizedDropdownLabel>(
      labels
        .map((label: DropdownOptionLabel) => {
          return normalizeDropdownLabel(label);
        })
        .filter(
          (
            label: NormalizedDropdownLabel | null,
          ): label is NormalizedDropdownLabel => {
            return label !== null;
          },
        ),
      (label: NormalizedDropdownLabel): string => {
        return label.name;
      },
    );
  };

  const renderOptionColorIndicator: (
    color?: Color | string,
  ) => ReactElement | null = (color?: Color | string): ReactElement | null => {
    const normalizedColor: string | undefined = color
      ? new Color(color).toString()
      : undefined;

    if (!normalizedColor) {
      return null;
    }

    return (
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 flex-none rounded-full border border-gray-200"
        style={{
          backgroundColor: normalizedColor,
        }}
        title={normalizedColor}
      ></span>
    );
  };

  const getLabelStyle: (color?: string) => {
    backgroundColor: string;
    color: string;
  } = (color?: string): { backgroundColor: string; color: string } => {
    if (!color) {
      return {
        backgroundColor: "var(--ou-surface-tertiary, #e5e7eb)",
        color: "var(--ou-text-secondary, #374151)",
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
    } catch {
      return {
        backgroundColor: color,
        color: "#111827",
      };
    }
  };

  const defaultSelectedLabelAccentColor: string = "#6366f1"; // indigo-500

  const resolveSelectedLabelColor: (color?: string) => string = (
    color?: string,
  ): string => {
    if (!color) {
      return defaultSelectedLabelAccentColor;
    }

    try {
      return Color.fromString(color).toString();
    } catch {
      return defaultSelectedLabelAccentColor;
    }
  };

  const renderAssociatedLabels: (
    labels: Array<NormalizedDropdownLabel>,
    context: FormatOptionLabelMeta<DropdownOption>["context"],
    hiddenLabelCount: number,
  ) => ReactElement | null = (
    labels: Array<NormalizedDropdownLabel>,
    context: FormatOptionLabelMeta<DropdownOption>["context"],
    hiddenLabelCount: number,
  ): ReactElement | null => {
    if (labels.length === 0 && hiddenLabelCount === 0) {
      return null;
    }

    if (context === "value") {
      return (
        <div className="flex flex-wrap items-center gap-1">
          {labels.map((label: NormalizedDropdownLabel, index: number) => {
            const accentColor: string = resolveSelectedLabelColor(label.color);

            return (
              <span
                key={`${label.id || label.name}-selected-${index}`}
                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-gray-600"
                style={{
                  borderColor: accentColor,
                }}
                title={label.name}
              >
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    backgroundColor: accentColor,
                  }}
                ></span>
                {label.name}
              </span>
            );
          })}
          {hiddenLabelCount > 0 ? (
            <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-gray-500">
              +{hiddenLabelCount}
            </span>
          ) : null}
        </div>
      );
    }

    return (
      <div className="flex flex-wrap gap-1">
        {labels.map((label: NormalizedDropdownLabel, index: number) => {
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
        })}
        {hiddenLabelCount > 0 ? (
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            +{hiddenLabelCount}
          </span>
        ) : null}
      </div>
    );
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
    const visibleLabels: Array<NormalizedDropdownLabel> =
      normalizedLabels.slice(0, maxVisibleLabels);
    const hiddenLabelCount: number = Math.max(
      normalizedLabels.length - visibleLabels.length,
      0,
    );

    if (meta.context === "value") {
      /*
       * A picked name longer than the control - a template's name on a
       * phone - ends in an ellipsis, not cut off mid-letter: react-select's
       * own ellipsis does not reach text inside these rows, so the rows may
       * shrink (min-w-0) and the name truncates itself. A name reads the
       * way most of its letters do, which keeps its start in view whichever
       * way the page reads: an English name on a Persian page is cut at its
       * end, not its beginning. A label of the product's own words reads the
       * page's way (getOptionLabelDirection).
       */
      /*
       * A multi-select's chip shows the whole name, on two lines if it must:
       * truncated, a phone's narrow control cut every long pick to a few
       * letters and an ellipsis (a probe's "Singapore (ap-southeast-1)"),
       * so the picks could not be told apart.
       */
      return (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex min-w-0 max-w-full items-center gap-2">
            {renderOptionColorIndicator(option.color)}
            <span
              className={
                props.isMultiSelect
                  ? MULTI_SELECT_CHIP_LABEL_CLASS_NAME
                  : props.wrapsPickedValue
                    ? SINGLE_SELECT_WRAPPED_VALUE_LABEL_CLASS_NAME
                    : SINGLE_SELECT_VALUE_LABEL_CLASS_NAME
              }
              dir={getOptionLabelDirection(option)}
              data-testid="dropdown-value-label"
            >
              {getOptionLabelText(option)}
            </span>
            {/*
             * An archived value the record still has: kept, never offered
             * again - the same tag the entity dropdowns draw.
             */}
            {option.isArchived ? (
              <ArchivedTag
                isCompact={Boolean(props.isMultiSelect)}
                dataTestId="dropdown-archived-tag"
              />
            ) : null}
          </div>
          {renderAssociatedLabels(
            visibleLabels,
            meta.context,
            hiddenLabelCount,
          )}
        </div>
      );
    }

    /*
     * An option that cannot be picked reads as such: its name a shade
     * quieter, not the menu's dark - still legible, since its description
     * says why it is not open.
     */
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          {renderOptionColorIndicator(option.color)}
          <span
            className={`text-sm font-medium ${
              option.isDisabled ? "text-gray-500" : "text-gray-900"
            }`}
            dir={getOptionLabelDirection(option)}
            data-testid="dropdown-option-label"
          >
            {getOptionLabelText(option)}
          </span>
          {option.isArchived ? (
            <ArchivedTag dataTestId="dropdown-archived-tag" />
          ) : null}
        </div>
        {option.description ? (
          <span className="text-xs text-gray-500">
            {tx(option.description) ?? option.description}
          </span>
        ) : null}
        {renderAssociatedLabels(visibleLabels, meta.context, hiddenLabelCount)}
      </div>
    );
  };

  /*
   * react-select names a chip's remove button after whatever formatOptionLabel
   * returned for it: `aria-label={"Remove " + children}` in its MultiValue.
   * Ours returns an element - the option's text sits next to a colour dot and
   * its labels - and concatenating that gives "Remove [object Object]", which
   * is what a screen reader read out for every chip in every multi-select.
   * Name the button after the option's own text instead, translated the same
   * way the chip is.
   *
   * The identity has to hold still across renders: react-select rebuilds its
   * component table whenever the components prop stops being shallow-equal, and
   * a rebuilt table is a new element type, so React would throw the remove
   * button away and mount a fresh one on every render - taking the focus with
   * it if someone were tabbing through the chips. useTranslateValue hands back a
   * new translateString each render, so keep the latest one in a ref and depend
   * on nothing.
   */
  const translateStringRef: React.MutableRefObject<
    (value: string | undefined) => string | undefined
  > = useRef(translateString);
  translateStringRef.current = translateString;

  const MultiValueRemoveWithOptionName: FunctionComponent<
    MultiValueRemoveProps<DropdownOption, boolean, GroupBase<DropdownOption>>
  > = useMemo(() => {
    const MultiValueRemove: FunctionComponent<
      MultiValueRemoveProps<DropdownOption, boolean, GroupBase<DropdownOption>>
    > = (
      removeProps: MultiValueRemoveProps<
        DropdownOption,
        boolean,
        GroupBase<DropdownOption>
      >,
    ): ReactElement => {
      const optionLabel: string = removeProps.data.isUserContent
        ? removeProps.data.label
        : translateStringRef.current(removeProps.data.label) ??
          removeProps.data.label;

      return (
        <ReactSelectComponents.MultiValueRemove
          {...removeProps}
          innerProps={{
            ...removeProps.innerProps,
            "aria-label": createTranslator(
              translateStringRef.current,
            ).translateTemplate("Remove {{option}}", { option: optionLabel }),
          }}
        />
      );
    };

    MultiValueRemove.displayName = "DropdownMultiValueRemove";

    return MultiValueRemove;
  }, []);

  /*
   * What describes the search box besides react-select's own words: the
   * field's help (ariaDescribedby), then its error. react-select writes the
   * input's aria-describedby itself - its placeholder, or its live region -
   * and takes no prop for it (one handed to Select is dropped), so its Input
   * is wrapped and ours go first. Read from a ref by a component that holds
   * still across renders, for the reason above: a new one would remount the
   * input and lose the focus.
   */
  const describedByRef: React.MutableRefObject<string | undefined> = useRef<
    string | undefined
  >(undefined);
  describedByRef.current = joinAriaIds(
    props.ariaDescribedby,
    props.error ? errorId : undefined,
  );

  const InputDescribedByField: FunctionComponent<
    InputProps<DropdownOption, boolean, GroupBase<DropdownOption>>
  > = useMemo(() => {
    const DescribedInput: FunctionComponent<
      InputProps<DropdownOption, boolean, GroupBase<DropdownOption>>
    > = (
      inputProps: InputProps<
        DropdownOption,
        boolean,
        GroupBase<DropdownOption>
      >,
    ): ReactElement => {
      const ownDescribedBy: string | undefined = (
        inputProps as unknown as Record<string, string | undefined>
      )["aria-describedby"];

      return (
        <ReactSelectComponents.Input
          {...inputProps}
          aria-describedby={joinAriaIds(describedByRef.current, ownDescribedBy)}
          /*
           * What is typed here only searches the options; the pick is the
           * change (a form notes it). A new version of OneUptime never
           * waits for a search (Utils/NewVersion/UnsavedChanges).
           */
          data-unsaved-changes-ignore
        />
      );
    };

    DescribedInput.displayName = "DropdownDescribedInput";

    return DescribedInput;
  }, []);

  useLayoutEffect(() => {
    if (firstUpdate.current && props.initialValue) {
      firstUpdate.current = false;
      return;
    }

    // Uncontrolled selections belong to this component, even if options refresh.
    if (!("value" in props)) {
      return;
    }

    const value: DropdownOption | Array<DropdownOption> | undefined =
      getDropdownOptionFromValue(
        props.value === null ? undefined : props.value,
      );

    setValue(value);
  }, [props.value, props.options]);

  const menuPortalTarget: HTMLElement | null =
    typeof document === "undefined" ? null : document.body;

  /*
   * The same select, with the "add what was typed" row when a person may
   * add values: the typed text, trimmed, is the value and its own label,
   * and it is offered only when it is not an option already, nor picked.
   */
  const SelectComponent: typeof Select = (
    props.isCreatable ? CreatableSelect : Select
  ) as typeof Select;

  const creatableProps: Record<string, unknown> = props.isCreatable
    ? {
        formatCreateLabel: (inputValue: string): string => {
          return props.formatCreateLabel
            ? props.formatCreateLabel(inputValue.trim())
            : inputValue.trim();
        },
        getNewOptionData: (
          inputValue: string,
          optionLabel: React.ReactNode,
        ): DropdownOption => {
          return {
            value: inputValue.trim(),
            label: String(optionLabel ?? inputValue).trim(),
            isUserContent: true,
          };
        },
        isValidNewOption: (
          inputValue: string,
          selectValue: ReadonlyArray<DropdownOption>,
          selectOptions: OptionsOrGroups<
            DropdownOption,
            GroupBase<DropdownOption>
          >,
        ): boolean => {
          return (
            inputValue.trim().length > 0 &&
            !namesAnOption(inputValue, selectValue) &&
            !namesAnOption(
              inputValue,
              selectOptions as ReadonlyArray<
                DropdownOption | DropdownOptionGroup
              >,
            )
          );
        },
        createOptionPosition: "last",
      }
    : {};

  // What the open menu says while loading, or when nothing matches.
  const menuMessageProps: Record<string, unknown> = {};

  if (props.loadingMessage) {
    const loadingMessage: string = props.loadingMessage;

    menuMessageProps["loadingMessage"] = (): string => {
      return loadingMessage;
    };
  }

  if (props.noOptionsMessage) {
    const noOptionsMessage: (inputValue: string) => string =
      props.noOptionsMessage;

    menuMessageProps["noOptionsMessage"] = (input: {
      inputValue: string;
    }): string => {
      return noOptionsMessage(input.inputValue);
    };
  }

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
      <SelectComponent
        {...creatableProps}
        classNamePrefix="ou-select"
        unstyled={false}
        formatOptionLabel={formatDropdownOptionLabel}
        components={{
          MultiValueRemove: MultiValueRemoveWithOptionName,
          Input: InputDescribedByField,
        }}
        onBlur={() => {
          props.onBlur?.();
        }}
        data-testid={props.dataTestId}
        tabIndex={props.tabIndex}
        isMulti={props.isMultiSelect}
        isDisabled={props.disabled}
        value={value || null}
        onFocus={() => {
          props.onFocus?.();
        }}
        aria-label={tx(props.ariaLabel)}
        aria-labelledby={props.ariaLabelledby}
        aria-invalid={props.error ? true : undefined}
        classNames={{
          control: (
            state: ControlProps<DropdownOption, boolean, GroupBase<any>>,
          ): string => {
            const classes: Array<string> = [
              "!min-h-[40px] !rounded-lg !border !bg-white !shadow-sm !transition-all !duration-150",
              state.isFocused
                ? "!border-indigo-400 !ring-2 !ring-indigo-100"
                : "!border-gray-300 hover:!border-indigo-300",
              state.isDisabled
                ? "!bg-gray-100 !text-gray-400"
                : "!cursor-pointer",
            ];

            if (props.error) {
              classes.push("!border-red-400 !ring-2 !ring-red-100");
            }

            return classes.join(" ");
          },
          valueContainer: () => {
            return "!gap-2 !px-2";
          },
          placeholder: () => {
            return "text-sm text-gray-400";
          },
          input: () => {
            return "text-sm text-gray-900";
          },
          singleValue: () => {
            return "text-sm text-gray-900 font-medium";
          },
          indicatorsContainer: () => {
            return "!gap-1 !px-1";
          },
          dropdownIndicator: () => {
            return "text-gray-500 transition-colors duration-150 hover:text-indigo-400";
          },
          clearIndicator: () => {
            return "text-gray-400 transition-colors duration-150 hover:text-red-500";
          },
          menu: () => {
            /*
             * ou-animate-pop-in (Theme.css) is a CSS animation, not a
             * transition: react-select mounts the portalled menu already open,
             * so there is no closed state to transition from.
             */
            return "!mt-2 !rounded-xl !border !border-gray-100 !bg-white !shadow-xl ou-animate-pop-in";
          },
          menuList: () => {
            return "!py-2";
          },
          option: (
            state: OptionProps<DropdownOption, boolean, GroupBase<any>>,
          ): string => {
            if (state.isDisabled) {
              return "px-3 py-2 text-sm text-gray-500 cursor-not-allowed";
            }

            if (state.isSelected) {
              return "px-3 py-2 text-sm bg-indigo-200 text-indigo-900";
            }

            if (state.isFocused) {
              return "px-3 py-2 text-sm bg-indigo-100 text-indigo-700";
            }

            return "px-3 py-2 text-sm text-gray-700";
          },
          group: () => {
            return "py-1";
          },
          groupHeading: () => {
            return "px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500";
          },
          noOptionsMessage: () => {
            return "px-3 py-2 text-sm text-gray-500";
          },
          // The same line while the options are on their way (isLoading).
          loadingMessage: () => {
            return "px-3 py-2 text-sm text-gray-500";
          },
          multiValue: () => {
            return "flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-2 py-1";
          },
          multiValueLabel: () => {
            return "flex flex-wrap items-center gap-2 text-sm font-medium text-indigo-900";
          },
          multiValueRemove: () => {
            return "text-indigo-400 hover:text-indigo-600 transition-colors duration-150";
          },
        }}
        styles={{
          dropdownIndicator: (
            provided: CSSObjectWithLabel,
          ): CSSObjectWithLabel => {
            return {
              ...provided,
              padding: 8,
            };
          },
          clearIndicator: (
            provided: CSSObjectWithLabel,
          ): CSSObjectWithLabel => {
            return {
              ...provided,
              padding: 8,
            };
          },
          indicatorSeparator: (): CSSObjectWithLabel => {
            return {
              display: "none",
            } as CSSObjectWithLabel;
          },
          option: (
            provided: CSSObjectWithLabel,
            state: OptionProps<
              DropdownOption,
              boolean,
              GroupBase<DropdownOption>
            >,
          ): CSSObjectWithLabel => {
            return getDropdownOptionStyle(provided, state);
          },
          /*
           * react-select cuts a single pick to one line with an ellipsis;
           * a field that shows its pick whole lets it wrap instead
           * (wrapsPickedValue).
           */
          singleValue: (provided: CSSObjectWithLabel): CSSObjectWithLabel => {
            return props.wrapsPickedValue
              ? { ...provided, whiteSpace: "normal", textOverflow: "clip" }
              : provided;
          },
          multiValue: (provided: CSSObjectWithLabel): CSSObjectWithLabel => {
            return {
              ...provided,
              backgroundColor: "#eef2ff", // indigo-50
              borderRadius: 8,
              border: "1px solid #c7d2fe", // indigo-200
              paddingLeft: 4,
              paddingRight: 4,
              // A chip is never wider than the control: its name wraps.
              maxWidth: "100%",
            };
          },
          multiValueLabel: (
            provided: CSSObjectWithLabel,
          ): CSSObjectWithLabel => {
            return {
              ...provided,
              color: "#312e81", // indigo-800
              fontSize: "0.875rem",
              fontWeight: 500,
              /*
               * react-select cuts a chip's name to one line with an
               * ellipsis; the whole name shows instead (see
               * MULTI_SELECT_CHIP_LABEL_CLASS_NAME).
               */
              whiteSpace: "normal",
              textOverflow: "clip",
              overflowWrap: "anywhere",
            };
          },
          multiValueRemove: (
            provided: CSSObjectWithLabel,
          ): CSSObjectWithLabel => {
            return {
              ...provided,
              color: "#6366f1", // indigo-500
              ":hover": {
                color: "#4f46e5", // indigo-600
                backgroundColor: "transparent",
              },
            };
          },
          menuPortal: (base: CSSObjectWithLabel): CSSObjectWithLabel => {
            return {
              ...base,
              zIndex: DROPDOWN_MENU_Z_INDEX,
            };
          },
          /*
           * A message of the caller's own is a sentence or two ("Could not
           * load the components of status.example.com. Type a component's
           * name..."): it starts where the options start, as text reads,
           * not centred line by line. react-select's own "No options"
           * stays centred.
           */
          noOptionsMessage: (
            provided: CSSObjectWithLabel,
          ): CSSObjectWithLabel => {
            return props.noOptionsMessage
              ? { ...provided, textAlign: "start" }
              : provided;
          },
          loadingMessage: (
            provided: CSSObjectWithLabel,
          ): CSSObjectWithLabel => {
            return props.loadingMessage
              ? { ...provided, textAlign: "start" }
              : provided;
          },
        }}
        menuPortalTarget={menuPortalTarget}
        menuPosition="fixed"
        isClearable={props.isClearable ?? true}
        isSearchable={true}
        isLoading={Boolean(props.isLoading)}
        closeMenuOnSelect={props.closeMenuOnSelect ?? true}
        {...menuMessageProps}
        onMenuOpen={() => {
          props.onMenuOpen?.();
        }}
        onMenuClose={() => {
          props.onMenuClose?.();
        }}
        filterOption={filterOption}
        placeholder={tx(props.placeholder) ?? props.placeholder}
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
        <p
          id={errorId}
          data-testid="error-message"
          className="mt-1 text-sm text-red-400"
          role="alert"
        >
          {tx(props.error) ?? props.error}
        </p>
      )}
    </div>
  );
};

export default Dropdown;
