import BaseModel, { BaseModelType } from 'Common/Models/BaseModel';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import { ReactElement } from 'react';
import AlignItem from '../../Types/AlignItem';
import SelectEntityField from '../../Types/SelectEntityField';
import Query from '../../Utils/BaseDatabase/Query';

import IconProp from 'Common/Types/Icon/IconProp';
import FieldType from '../Types/FieldType';
import { DropdownOption } from '../Dropdown/Dropdown';
import AnalyticsBaseModel, {
    AnalyticsBaseModelType,
} from 'Common/AnalyticsModels/BaseModel';

export interface ActionButton {
    buttonText: string;
    icon: IconProp;
    onClick: (id: ObjectID) => void;
}

export default interface Columns<
    TEntity extends BaseModel | AnalyticsBaseModel
> {
    field?: SelectEntityField<TEntity>;
    selectedProperty?: string;
    title: string;
    contentClassName?: string | undefined;
    colSpan?: number | undefined;
    disableSort?: boolean;
    description?: string | undefined;
    type: FieldType;
    isFilterable?: boolean | undefined;
    filterEntityType?: BaseModelType | AnalyticsBaseModelType | undefined;
    filterQuery?: Query<TEntity> | undefined;
    tooltipText?: ((item: TEntity) => string) | undefined;
    filterDropdownField?:
        | {
              label: string;
              value: string;
          }
        | undefined;
    filterDropdownOptions?: Array<DropdownOption> | undefined;
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
