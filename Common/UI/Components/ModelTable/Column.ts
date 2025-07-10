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
  getElement?:
    | ((item: TEntity, onBeforeFetchData?: TEntity | undefined) => ReactElement)
    | undefined;
}
