import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import ListRow from './ListRow';
import ActionButtonSchema, { ActionType } from './Types/ActionButtonSchema';
import Columns from './Types/Columns';

export interface ComponentProps {
    data: Array<JSONObject>;
    id: string;
    columns: Columns;
    actionButtons?: undefined | Array<ActionButtonSchema> | undefined;
    onActionEvent?:
        | ((actionType: ActionType, item: JSONObject) => void)
        | undefined;
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
                            columns={props.columns}
                            actionButtons={props.actionButtons}
                            onActionEvent={props.onActionEvent}
                        />
                    );
                })}
        </div>
    );
};

export default ListBody;
