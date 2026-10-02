import NumberUtil from "../../Utils/Number";
import {
  DropdownOption,
  DropdownOptionGroup,
} from "../Components/Dropdown/Dropdown";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Color from "../../Types/Color";
import Text from "../../Types/Text";

type Enum<E> = Record<keyof E, number | string> & { [k: number]: string };

export default class DropdownUtil {
  public static getDropdownOptionsFromEnum<T>(
    obj: Enum<T>,
    useKeyAsLabel: boolean = false,
  ): Array<DropdownOption> {
    const dropdownOptions: Array<DropdownOption> = Object.keys(obj)
      .map((key: string | number) => {
        // for enums with numbers, Object.keys will return the numbers as strings which is not what we want
        if (NumberUtil.canBeConvertedToNumber(key)) {
          return null;
        }

        return {
          label: useKeyAsLabel ? key : (obj as any)[key].toString(),
          value: NumberUtil.canBeConvertedToNumber((obj as any)[key])
            ? NumberUtil.convertToNumber((obj as any)[key])
            : (obj as any)[key],
        };
      })
      .filter((option: DropdownOption | null) => {
        return option !== null;
      }) as Array<DropdownOption>;

    return dropdownOptions;
  }

  /*
   * Same as getDropdownOptionsFromEnum, but the LABEL is spaced out for
   * reading: a value of "OnErrorOrFrustration" renders as "On Error Or
   * Frustration". The stored value is untouched.
   *
   * Opt-in rather than the default behaviour of getDropdownOptionsFromEnum,
   * because plenty of enums in this codebase carry values that must be
   * shown verbatim - TechStack ("NodeJS"), CodeRepositoryType ("GitHub"),
   * and the SSO SignatureMethod / DigestMethod identifiers, which are not
   * prose at all. Reach for this when an enum's values are English words
   * jammed together.
   */
  public static getDropdownOptionsFromEnumWithReadableLabels<T>(
    obj: Enum<T>,
  ): Array<DropdownOption> {
    return DropdownUtil.getDropdownOptionsFromEnum(obj).map(
      (option: DropdownOption): DropdownOption => {
        return {
          ...option,
          label: Text.fromPascalCaseToReadable(option.label),
        };
      },
    );
  }

  public static getDropdownOptionFromEnumForValue<T>(
    enumObject: Enum<T>,
    value: string,
  ): DropdownOption | undefined {
    const options: Array<DropdownOption> =
      DropdownUtil.getDropdownOptionsFromEnum(enumObject);
    const option: DropdownOption | undefined = options.find(
      (option: DropdownOption) => {
        return option.value === value;
      },
    );
    return option;
  }

  /*
   * One option per row, wearing the row's colour when its model has one (a
   * state, a severity, a monitor status, a label): the dot every dropdown
   * draws before the name, so "Resolved" reads as green at a glance wherever
   * it is picked. Select the colour column along with the label and value -
   * a row fetched without it simply has no dot.
   */
  public static getDropdownOptionsFromEntityArray<
    TBaseModel extends BaseModel,
  >(data: {
    array: Array<TBaseModel>;
    labelField: string;
    valueField: string;
  }): Array<DropdownOption> {
    return data.array.map((item: TBaseModel) => {
      const option: DropdownOption = {
        label: (item.getColumnValue(data.labelField) as string | null) ?? "",
        value: item.getColumnValue(data.valueField) as string,
      };

      const colorColumnName: string | null =
        typeof item.getFirstColorColumn === "function"
          ? item.getFirstColorColumn()
          : null;

      if (colorColumnName) {
        const color: Color | undefined = DropdownUtil.toOptionColor(
          item.getColumnValue(colorColumnName),
        );

        if (color) {
          option.color = color;
        }
      }

      return option;
    });
  }

  /*
   * An option's colour from whatever holds it: a Color as it is, a colour
   * string ("#ef4444") as a Color. Nothing for an empty or unreadable value,
   * so an option without a colour simply has no dot.
   */
  public static toOptionColor(value: unknown): Color | undefined {
    if (value instanceof Color) {
      return value.toString().trim() ? value : undefined;
    }

    if (typeof value === "string" && value.trim()) {
      return new Color(value.trim());
    }

    return undefined;
  }

  /*
   * The same options, each wearing the colour the form already knew for its
   * value. A form field can list its options twice: the form fetches the
   * dropdown's model with its colour column, and the field's own
   * fetchDropdownOptions can fetch the list again - to sort it, or narrow it -
   * selecting only a name and an id. The second list used to replace the
   * first and take every colour with it: the Initial Incident State on an
   * incident template listed plain names under a severity with a red dot.
   *
   * Nothing else changes: an option that has a colour of its own keeps it,
   * order and membership are the second list's, and an option the form never
   * knew stays as it came.
   */
  public static keepKnownOptionColors(
    options: Array<DropdownOption | DropdownOptionGroup>,
    knownOptions: Array<DropdownOption | DropdownOptionGroup> | undefined,
  ): Array<DropdownOption | DropdownOptionGroup> {
    const colorByValue: Map<string, Color> = new Map();

    const isGroup: (
      item: DropdownOption | DropdownOptionGroup,
    ) => item is DropdownOptionGroup = (
      item: DropdownOption | DropdownOptionGroup,
    ): item is DropdownOptionGroup => {
      return Array.isArray((item as DropdownOptionGroup).options);
    };

    const remember: (option: DropdownOption) => void = (
      option: DropdownOption,
    ): void => {
      const color: Color | undefined = DropdownUtil.toOptionColor(
        option.color,
      );

      if (color) {
        colorByValue.set(String(option.value), color);
      }
    };

    for (const known of knownOptions || []) {
      if (isGroup(known)) {
        known.options.forEach(remember);
      } else {
        remember(known);
      }
    }

    if (colorByValue.size === 0) {
      return options;
    }

    const withColor: (option: DropdownOption) => DropdownOption = (
      option: DropdownOption,
    ): DropdownOption => {
      if (DropdownUtil.toOptionColor(option.color)) {
        return option;
      }

      const color: Color | undefined = colorByValue.get(String(option.value));

      return color ? { ...option, color: color } : option;
    };

    return options.map(
      (
        item: DropdownOption | DropdownOptionGroup,
      ): DropdownOption | DropdownOptionGroup => {
        if (isGroup(item)) {
          return { ...item, options: item.options.map(withColor) };
        }

        return withColor(item);
      },
    );
  }

  public static getDropdownOptionsFromArray(
    arr: Array<string>,
  ): Array<DropdownOption> {
    const uniqueArr: Array<string> = [...new Set(arr)];
    return uniqueArr.map((item: string) => {
      return {
        label: item,
        value: item,
      };
    });
  }
}
