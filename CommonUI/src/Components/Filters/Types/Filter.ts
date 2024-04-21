import GenericObject from 'Common/Types/GenericObject';
import { DropdownOption } from '../../Dropdown/Dropdown';
import FieldType from '../../Types/FieldType';

export default interface Filter<T extends GenericObject> {
    title: string;
    filterDropdownOptions?: Array<DropdownOption> | undefined;
    key: keyof T;
    type: FieldType;
}
