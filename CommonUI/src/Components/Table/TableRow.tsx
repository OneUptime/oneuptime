import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import Button from '../Button/Button';
import ActionButtonSchema from './Types/ActionButtonSchema';
import Column from './Types/Column';
import Columns from './Types/Columns';
import TableColumnType from './Types/TableColumnType';

export interface ComponentProps {
    item: JSONObject;
    columns: Columns;
    onActionEvent?: ((key: string, item: JSONObject) => void) | undefined;
    actionButtons?: Array<ActionButtonSchema> | undefined;
}

const TableRow: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    return (
        <tr>
            {props.columns &&
                props.columns.map((column: Column, i: number) => {
                    return (
                        <td key={i}>
                            {column.key ? (
                                (props.item[column.key] as string)
                            ) : (
                                <></>
                            )}
                            {column.type === TableColumnType.Actions &&
                                <div>{props.actionButtons?.map((button, i) => {
                                    return <span style={i > 0 ? {
                                        marginLeft: "10px"
                                    } : {}} key={i}>{
                                            <Button title={button.title} icon={button.icon} buttonStyle={button.buttonStyleType} onClick={() => {
                                                if (props.onActionEvent) {
                                                    props.onActionEvent(button.actionKey, props.item);
                                                }
                                            }} />
                                        }</span>
                                })}</div>
                            }
                        </td>
                    );
                })}
        </tr>
    );
};

export default TableRow;
