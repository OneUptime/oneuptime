import { DropdownOption } from "../../Dropdown/Dropdown";
import FieldType from "../../Types/FieldType";


export default interface Filter {
    title: string;
    filterDropdownOptions?: Array<DropdownOption> | undefined;
    key: string; // object key to filter
    type: FieldType;
}   