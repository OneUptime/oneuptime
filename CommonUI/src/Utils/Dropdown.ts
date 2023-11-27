import BaseModel from 'Common/Models/BaseModel';
import { DropdownOption } from '../Components/Dropdown/Dropdown';

export default class DropdownUtil {
    public static getDropdownOptionsFromEnum(
        obj: Object
    ): Array<DropdownOption> {
        return Object.keys(obj).map((key: string) => {
            return {
                label: (obj as any)[key].toString(),
                value: (obj as any)[key].toString(),
            };
        });
    }

    public static getDropdownOptionFromEnumForValue(
        obj: Object,
        value: string
    ): DropdownOption | undefined {
        const options: Array<DropdownOption> = DropdownUtil.getDropdownOptionsFromEnum(obj);
        const option = options.find((option: DropdownOption) => {
            return option.value === value;
        });
        return option;
    }

    public static getDropdownOptionsFromEntityArray<
        TBaseModel extends BaseModel
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
        arr: Array<string>
    ): Array<DropdownOption> {
        return arr.map((item: string) => {
            return {
                label: item,
                value: item,
            };
        });
    }
}
