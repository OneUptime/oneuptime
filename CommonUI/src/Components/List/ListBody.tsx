import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import ListRow from './ListRow';
import ActionButtonSchema from '../ActionButton/ActionButtonSchema';
import Field from '../Detail/Field';

export interface ComponentProps {
    data: Array<JSONObject>;
    id: string;
    fields: Array<Field>;
    actionButtons?: undefined | Array<ActionButtonSchema> | undefined;
}

const ListBody: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div id={props.id}>
            {props.data &&
                props.data.map((item: JSONObject, i: number) => {
                    return (
                        <ListRow
                            key={i}
                            item={item}
                            fields={props.fields}
                            actionButtons={props.actionButtons}
                        />
                    );
                })}
        </div>
    );
};

export default ListBody;
