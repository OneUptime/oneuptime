import GenericObject from 'Common/Types/GenericObject';
import { DropdownValue } from '../../Dropdown/Dropdown';
import Search from 'Common/Types/BaseDatabase/Search';
import BaseModel from 'Common/Models/BaseModel';
import ObjectID from 'Common/Types/ObjectID';
import InBetween from 'Common/Types/BaseDatabase/InBetween';

type FilterData<T extends GenericObject> = {
    [P in keyof T]?:
        | string
        | DropdownValue
        | Array<DropdownValue>
        | Search
        | Date
        | BaseModel
        | ObjectID
        | number
        | InBetween;
};

export default FilterData;
