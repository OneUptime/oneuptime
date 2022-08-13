import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement, useEffect, useState } from 'react';
import Button, { ButtonSize } from '../Button/Button';
import Detail from '../Detail/Detail';
import Field from '../Detail/Field';
import ActionButtonSchema, { ActionType } from './Types/ActionButtonSchema';
import Columns from './Types/Columns';

export interface ComponentProps {
    item: JSONObject;
    columns: Columns;
    onActionEvent?:
    | ((actionType: ActionType, item: JSONObject) => void)
    | undefined;
    actionButtons?: Array<ActionButtonSchema> | undefined;
}

const ListRow: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {


    // convert column to field 
    const [fields, setFields] = useState<Array<Field>>([]);

    useEffect(() => {

        const detailFields: Array<Field> = [];
        for (const column of props.columns) {

            if (!column.key) {
                // if its an action column, ignore. 
                continue;
            }

            detailFields.push({
                title: column.title,
                description: column.description || '',
                key: column.key || '',
                fieldType: column.type,
            })

            setFields(detailFields);
        }
    }, [props.columns])

    return (
        <div className="padding-15 list-item">
            <Detail item={props.item} fields={fields} />

            <div>
                {props.actionButtons?.map(
                    (
                        button: ActionButtonSchema,
                        i: number
                    ) => {
                        return (
                            <span
                                style={
                                    i > 0
                                        ? {
                                            marginLeft:
                                                '10px',
                                        }
                                        : {}
                                }
                                key={i}
                            >
                                <Button
                                    buttonSize={
                                        ButtonSize.Small
                                    }
                                    title={button.title}
                                    icon={button.icon}
                                    buttonStyle={
                                        button.buttonStyleType
                                    }
                                    onClick={() => {
                                        if (
                                            props.onActionEvent
                                        ) {
                                            props.onActionEvent(
                                                button.actionType,
                                                props.item
                                            );
                                        }
                                    }}
                                />
                            </span>
                        );
                    }
                )}
            </div>
        </div>
    );
};

export default ListRow;
