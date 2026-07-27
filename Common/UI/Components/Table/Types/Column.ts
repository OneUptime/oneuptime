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
  /*
   * Every field that backs this cell, in declaration order. A ModelTable
   * column may declare more than one - e.g. the alert "Affected Resources"
   * cell spans hosts / kubernetesClusters / dockerHosts / podmanHosts /
   * services - while `key` only ever holds the first one, because that is the
   * one used for sorting and for the default renderer. CSV export reads all
   * of them so it does not silently drop the rest. Defaults to [key].
   */
  exportKeys?: Array<string> | undefined;
  /*
   * Exact text for this column's CSV cell, overriding the value read off the
   * row. Use it when the rendered cell is built from something the row does
   * not carry under the column's own field (data fetched alongside the table,
   * a computed summary, several fields combined into one phrase).
   */
  getExportValue?: ((item: T) => string) | undefined;
  // Leave this column out of the CSV export entirely.
  disableCsvExport?: boolean | undefined;
  getElement?:
    | ((item: T, onBeforeFetchData?: T | undefined) => ReactElement)
    | undefined;
}
