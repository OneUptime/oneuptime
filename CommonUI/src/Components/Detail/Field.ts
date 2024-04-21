import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { ReactElement } from 'react';
import AlignItem from '../../Types/AlignItem';
import FieldType from '../Types/FieldType';
import { DropdownOption } from '../Dropdown/Dropdown';
import { Size } from './FieldLabel';

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
              onBeforeFetchData?: T,
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
    key: keyof T | null; // null because actions column does not have a key.
}
