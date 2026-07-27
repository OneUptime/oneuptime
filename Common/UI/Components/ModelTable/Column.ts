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
  contentClassName?: string | undefined;
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
