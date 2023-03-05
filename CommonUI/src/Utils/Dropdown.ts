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
}
