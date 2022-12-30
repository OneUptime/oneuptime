import BaseModel from 'Common/Models/BaseModel';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import { ReactElement } from 'react';
import SelectEntityField from '../../Types/SelectEntityField';
import Query from '../../Utils/ModelAPI/Query';
import { IconProp } from '../Icon/Icon';
import FieldType from '../Types/FieldType';

export interface ActionButton {
    buttonText: string;
    icon: IconProp;
    onClick: (id: ObjectID) => void;
}

export default interface Columns<TEntity> {
    field?: SelectEntityField<TEntity>;
    selectedProperty?: string;
    title: string;
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
    getElement?:
        | ((
              item: JSONObject,
              onBeforeFetchData?: JSONObject | undefined
          ) => ReactElement)
        | undefined;
}
