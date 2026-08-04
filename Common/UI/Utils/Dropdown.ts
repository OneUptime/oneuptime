import NumberUtil from "../../Utils/Number";
import { DropdownOption } from "../Components/Dropdown/Dropdown";
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

  public static getDropdownOptionsFromEntityArray<
    TBaseModel extends BaseModel,
  >(data: {
    array: Array<TBaseModel>;
    labelField: string;
    valueField: string;
  }): Array<DropdownOption> {
    return data.array.map((item: TBaseModel) => {
      const option: DropdownOption = {
        label: item.getColumnValue(data.labelField) as string,
        value: item.getColumnValue(data.valueField) as string,
      };

      const colorColumnName: string | null =
        typeof item.getFirstColorColumn === "function"
          ? item.getFirstColorColumn()
          : null;

      if (colorColumnName) {
        const color: Color | null = item.getColumnValue(
          colorColumnName,
        ) as Color | null;

        if (color) {
          option.color = color;
        }
      }

      return option;
    });
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
