import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import { ReactElement } from 'react';
import SelectEntityField from '../../Types/SelectEntityField';
import { IconProp } from '../Icon/Icon';
import FieldType from '../Types/FieldType';

export interface ActionButton {
    buttonText: string;
    icon: IconProp;
    onClick: (id: ObjectID) => void;
}

export default interface Columns<TEntity> {
    field?: SelectEntityField<TEntity>;
    title: string;
    disableSort?: boolean;
    type: FieldType;
    isFilterable: boolean;
    actionButtons?: Array<ActionButton>;
    moreFields?: SelectEntityField<TEntity>;
    getColumnElement?: ((item: JSONObject) => ReactElement) | undefined;
}
