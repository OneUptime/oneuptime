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
  /*
   * What the column's values mean, in an (i) beside the header (see the
   * Table Column of the same name). Spread through to the table as is.
   */
  headerTooltip?: string | undefined;
  type: FieldType;
  tooltipText?: ((item: TEntity) => string) | undefined;
  actionButtons?: Array<ActionButton>;
  alignItem?: AlignItem | undefined;
  noValueMessage?: string | undefined;
  hideOnMobile?: boolean | undefined; // Hide column on mobile devices
  /*
   * A phone's card draws this column's value without its title above it -
   * for the one column a card is about, whose value names itself (a role's
   * name on a key's Custom Roles card). Spread through to the table as is
   * (see the Table Column of the same name).
   */
  hideTitleOnMobile?: boolean | undefined;
  /*
   * Foldable: left out while the table's box is narrower than 48rem or its
   * rows do not fit it, and on a phone's cards, where another column's
   * cell shows its value instead (foldInto, or the page's own cells by
   * useAreTableColumnsFolded). Spread through to the table as is (see the
   * Table Column of the same name).
   */
  hideBelowLargeScreen?: boolean | undefined;
  /*
   * With hideBelowLargeScreen: the column (by id or field) under whose value
   * the table shows this one's while it is folded. Spread through to the
   * table as is (see the Table Column of the same name).
   */
  foldInto?: string | undefined;
  /*
   * Folded under another column's value, this one's says its column's name
   * before it - for a value that does not say what it is by itself, as a
   * time among times does not ("Last match 2 hours ago").
   */
  showTitleWhenFolded?: boolean | undefined;
  /*
   * Its header has no edge to drag (see the Table Column of the same name).
   * Spread through to the table as is.
   */
  disableResize?: boolean | undefined;
  /*
   * List view (ShowAs.List) only: draw this column's row on an item's card
   * only when this says so - an empty description, or a setting the item
   * does not use, is left off its card instead of a label over nothing. A
   * table keeps every column for every row, so it does not read this.
   */
  showInListIf?: ((item: TEntity) => boolean) | undefined;
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
