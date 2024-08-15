import NumberUtil from "../../Utils/Number";
import { DropdownOption } from "../Components/Dropdown/Dropdown";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

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
          value: NumberUtil.canBeConvertedToNumber((obj as any)[key]) ? NumberUtil.convertToNumber((obj as any)[key]) : (obj as any)[key],
        };
      })
      .filter((option: DropdownOption | null) => {
        return option !== null;
      }) as Array<DropdownOption>;

    return dropdownOptions;
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
      return {
        label: item.getColumnValue(data.labelField) as string,
        value: item.getColumnValue(data.valueField) as string,
      };
    });
  }

  public static getDropdownOptionsFromArray(
    arr: Array<string>,
  ): Array<DropdownOption> {
    return arr.map((item: string) => {
      return {
        label: item,
        value: item,
      };
    });
  }
}
