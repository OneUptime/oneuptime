import { JSONObject } from 'Common/Types/JSON';
import { ReactElement } from 'react';
import FieldType from '../../Types/FieldType';

export default interface Column {
    title: string;
    description?: string | undefined;
    disableSort?: boolean;
    type: FieldType;
    isFilterable?: boolean;
    key?: string | null; //can be null because actions column does not have a key.
    getElement?: ((item: JSONObject) => ReactElement) | undefined;
    options?:
        | {
              onlyShowDate?: boolean | undefined;
          }
        | undefined;
}
