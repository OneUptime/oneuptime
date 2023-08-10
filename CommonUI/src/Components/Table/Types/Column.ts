import { JSONObject } from 'Common/Types/JSON';
import { ReactElement } from 'react';
import AlignItem from '../../../Types/AlignItem';
import { DropdownOption } from '../../Dropdown/Dropdown';
import FieldType from '../../Types/FieldType';

export default interface Column {
    title: string;
    description?: string | undefined;
    disableSort?: boolean | undefined;
    tooltipText?: ((item: JSONObject) => string) | undefined;
    type: FieldType;
    colSpan?: number | undefined;
    noValueMessage?: string | undefined;
    isFilterable?: boolean | undefined;
    contentClassName?: string | undefined;
    alignItem?: AlignItem | undefined;
    filterDropdownOptions?: Array<DropdownOption> | undefined;
    key?: string | null; //can be null because actions column does not have a key.
    getElement?:
        | ((
              item: JSONObject,
              onBeforeFetchData?: JSONObject | undefined
          ) => ReactElement)
        | undefined;
}
