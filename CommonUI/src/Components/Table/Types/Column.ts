import { JSONObject } from 'Common/Types/JSON';
import { ReactElement } from 'react';
import TableColumnType from './TableColumnType';

export default interface Column {
    title: string;
    disableSort?: boolean;
    type: TableColumnType;
    isFilterable?: boolean;
    key?: string | null; //can be null because actions column does not have a key.
    getColumnElement?: ((item: JSONObject) => ReactElement) | undefined;
}
