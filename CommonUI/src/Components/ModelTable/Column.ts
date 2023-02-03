import type BaseModel from 'Common/Models/BaseModel';
import type { JSONObject } from 'Common/Types/JSON';
import type ObjectID from 'Common/Types/ObjectID';
import type { ReactElement } from 'react';
import type AlignItem from '../../Types/AlignItem';
import type SelectEntityField from '../../Types/SelectEntityField';
import type Query from '../../Utils/ModelAPI/Query';
import type { IconProp } from '../Icon/Icon';
import type FieldType from '../Types/FieldType';

export interface ActionButton {
    buttonText: string;
    icon: IconProp;
    onClick: (id: ObjectID) => void;
}

export default interface Columns<TEntity> {
    field?: SelectEntityField<TEntity>;
    selectedProperty?: string;
    title: string;
    contentClassName?: string | undefined;
    colSpan?: number | undefined;
    disableSort?: boolean;
    type: FieldType;
    isFilterable: boolean;
    filterEntityType?: { new (): BaseModel } | undefined;
    filterQuery?: Query<BaseModel> | undefined;
    tooltipText?: ((item: TEntity) => string) | undefined;
    filterDropdownField?:
        | {
              label: string;
              value: string;
          }
        | undefined;
    actionButtons?: Array<ActionButton>;
    alignItem?: AlignItem | undefined;
    getElement?:
        | ((
              item: JSONObject,
              onBeforeFetchData?: JSONObject | undefined
          ) => ReactElement)
        | undefined;
}
