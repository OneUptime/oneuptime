import AlignItem from "../../../Types/AlignItem";
import FieldType from "../../Types/FieldType";
import GenericObject from "../../../../Types/GenericObject";
import { ReactElement } from "react";

export default interface Column<T extends GenericObject> {
  title: string;
  description?: string | undefined;
  disableSort?: boolean | undefined;
  tooltipText?: ((item: T) => string) | undefined;
  type: FieldType;
  colSpan?: number | undefined;
  noValueMessage?: string | undefined;
  contentClassName?: string | undefined;
  alignItem?: AlignItem | undefined;
  key?: keyof T | null; //can be null because actions column does not have a key.
  hideOnMobile?: boolean | undefined; // Hide column on mobile devices
  getElement?:
    | ((item: T, onBeforeFetchData?: T | undefined) => ReactElement)
    | undefined;
}
