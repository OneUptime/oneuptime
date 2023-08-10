import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { JSONObject } from 'Common/Types/JSON';
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

export interface FieldBase {
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
              item: JSONObject,
              miscProps?: JSONObject,
              callback?: Function
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

export default interface Field extends FieldBase {
    key: string;
}
