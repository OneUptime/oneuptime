import AlignItem from '../../Types/AlignItem';
import { DropdownOption } from '../Dropdown/Dropdown';
import FieldType from '../Types/FieldType';
import { Size } from './FieldLabel';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { JSONObject } from 'Common/Types/JSON';
import { ReactElement } from 'react';

export interface DetailSideLink {
    text: string;
    url: Route | URL;
    openLinkInNewTab?: boolean;
}

export interface FieldBase<T> {
    title?: string;
    description?: string;
    fieldTitleSize?: Size | undefined;

    fieldType?: FieldType;
    dropdownOptions?: Array<DropdownOption> | undefined;
    colSpan?: number | undefined;
    alignItem?: AlignItem | undefined;
    contentClassName?: string | undefined;
    getElement?:
        | ((
              item: T,
              onBeforeFetchData?: JSONObject | undefined,
              fetchItems?: VoidFunction
          ) => ReactElement)
        | undefined;
    sideLink?: DetailSideLink | undefined;
    placeholder?: string;
    opts?:
        | {
              isCopyable?: boolean | undefined;
          }
        | undefined;
}

export default interface Field<T> extends FieldBase<T> {
    key: keyof T | null; // null because some fields are not directly from the model. It could be from getElements
}
