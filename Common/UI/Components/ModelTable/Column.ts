import AlignItem from "../../Types/AlignItem";
import SelectEntityField from "../../Types/SelectEntityField";
import FieldType from "../Types/FieldType";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import { ReactElement } from "react";

export interface ActionButton {
  buttonText: string;
  icon: IconProp;
  onClick: (id: ObjectID) => void;
}

export default interface Columns<
  TEntity extends BaseModel | AnalyticsBaseModel,
> {
  field: SelectEntityField<TEntity>;
  selectedProperty?: string | undefined;
  title: string;
  /*
   * Stable identity for this column, used to persist the viewer's show/hide
   * and ordering choices. Leave it unset and one is derived from the declared
   * field (see ColumnPreference.getColumnIds) - set it only when the derived
   * id would be unstable, e.g. a cell rendered entirely through `getElement`
   * off a placeholder `field: { _id: true }` whose title is likely to change.
   */
  id?: string | undefined;
  /*
   * Keep this column out of the "Customize Columns" picker: it is always
   * shown and can never be moved. Use it for the column that identifies the
   * row (usually the name), so a table can never be customized into
   * anonymity.
   */
  isNotCustomizable?: boolean | undefined;
  // Start hidden. The viewer can still switch it on from the picker.
  isHiddenByDefault?: boolean | undefined;
  /*
   * This column exists only because the viewer added it, so the picker offers
   * to take it away again rather than only switching it off. Set it on columns
   * generated from viewer-chosen keys (see AttributeColumns) - a table that
   * ships a column should never be removable, because nothing would put it
   * back.
   */
  isRemovable?: boolean | undefined;
  contentClassName?: string | undefined;
  /*
   * Let this cell's content wrap onto more than one line, instead of forcing
   * it onto the single `whitespace-nowrap` line every body cell gets by
   * default. Set it on any column whose cell can hold server- or
   * operator-authored prose; leave it unset for dates, counts, badges and
   * ids. See Common/UI/Components/Table/Types/Column.ts for the full
   * reasoning, including why a `max-w-*` on the rendered element is not a
   * substitute and in fact makes the overlap worse (OneUptime issue #3585).
   */
  wrapContent?: boolean | undefined;
  /*
   * Width cap for a wrapping cell, e.g. "max-w-3xl". Read ONLY when
   * `wrapContent` is set; defaults to "max-w-md" (28rem).
   */
  wrapMaxWidthClassName?: string | undefined;
  colSpan?: number | undefined;
  disableSort?: boolean;
  description?: string | undefined;
  type: FieldType;
  tooltipText?: ((item: TEntity) => string) | undefined;
  actionButtons?: Array<ActionButton>;
  alignItem?: AlignItem | undefined;
  noValueMessage?: string | undefined;
  hideOnMobile?: boolean | undefined; // Hide column on mobile devices
  /*
   * Exact text for this column's CSV cell (the text twin of getElement, and
   * it receives the same item). Set it when the cell renders from something
   * the row does not carry under this column's own `field` - data fetched
   * alongside the table, or a phrase composed from several fields. Columns
   * that render entirely through getElement off a placeholder
   * `field: { _id: true }` are left out of the CSV unless they set this,
   * because their only exportable value is a raw UUID.
   */
  getExportValue?: ((item: TEntity) => string) | undefined;
  // Leave this column out of the CSV export entirely.
  disableCsvExport?: boolean | undefined;
  getElement?:
    | ((item: TEntity, onBeforeFetchData?: TEntity | undefined) => ReactElement)
    | undefined;
}
