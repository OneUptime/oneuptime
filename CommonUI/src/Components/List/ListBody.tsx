import type { JSONObject } from 'Common/Types/JSON';
import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import ListRow from './ListRow';
import type ActionButtonSchema from '../ActionButton/ActionButtonSchema';
import type Field from '../Detail/Field';

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
        <div id={props.id} className="space-y-6">
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
