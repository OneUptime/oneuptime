import BaseModel from 'Common/Models/BaseModel';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import { ReactElement } from 'react';
import AlignItem from '../../Types/AlignItem';
import SelectEntityField from '../../Types/SelectEntityField';
import IconProp from 'Common/Types/Icon/IconProp';
import FieldType from '../Types/FieldType';
import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';

export interface ActionButton {
    buttonText: string;
    icon: IconProp;
    onClick: (id: ObjectID) => void;
}

export default interface Columns<
    TEntity extends BaseModel | AnalyticsBaseModel
> {
    field: SelectEntityField<TEntity>;
    selectedProperty?: string;
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
    getElement?:
        | ((
              item: JSONObject,
              onBeforeFetchData?: JSONObject | undefined
          ) => ReactElement)
        | undefined;
}
