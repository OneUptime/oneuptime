import AlignItem from "../../Types/AlignItem";
import { DropdownOption, DropdownOptionGroup } from "../Dropdown/Dropdown";
import FieldType from "../Types/FieldType";
import { Size } from "./FieldLabel";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import { ReactElement } from "react";

export interface DetailSideLink {
  text: string;
  url: Route | URL;
  openLinkInNewTab?: boolean;
}

export interface FieldBase<T> {
  title?: string;
  description?: string | ReactElement;
  fieldTitleSize?: Size | undefined;
  fieldType?: FieldType;
  dropdownOptions?: Array<DropdownOption | DropdownOptionGroup> | undefined;
  colSpan?: number | undefined;
  alignItem?: AlignItem | undefined;
  contentClassName?: string | undefined;
  showIf?: ((item: T) => boolean) | undefined;
  hideOnMobile?: boolean | undefined; // Hide field on mobile devices
  getElement?:
    | ((
        item: T,
        onBeforeFetchData?: JSONObject | undefined,
        fetchItems?: VoidFunction,
      ) => ReactElement)
    | undefined;
  sideLink?: DetailSideLink | undefined;
  placeholder?: string;
  opts?:
    | {
        isCopyable?: boolean | undefined;
      }
    | undefined;
  /*
   * The record's own ID - a FieldType.ObjectID field on `_id` - is not drawn
   * as a field: Detail puts it on one small "ID" line under the others, with
   * a copy button (see DetailRecordId.ts). Set this on the few cards that
   * exist to hand the ID over, where it stays a field like any other: the
   * project ID on Project Settings, or a probe's and a runner's ID beside the
   * key they are configured with. Every use is listed, with its reason, in
   * App/Tests/RecordIdLineGuard.test.ts.
   */
  showIdAsField?: boolean | undefined;
}

export default interface Field<T> extends FieldBase<T> {
  key: keyof T | null; // null because some fields are not directly from the model. It could be from getElements
}
