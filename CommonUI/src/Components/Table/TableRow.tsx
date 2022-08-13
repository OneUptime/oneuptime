import OneUptimeDate from 'Common/Types/Date';
import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import Button, { ButtonSize } from '../Button/Button';
import Icon, { IconProp, ThickProp } from '../Icon/Icon';
import ActionButtonSchema, { ActionType } from './Types/ActionButtonSchema';
import Column from './Types/Column';
import Columns from './Types/Columns';
import FieldType from '../Types/FieldType';

export interface ComponentProps {
    item: JSONObject;
    columns: Columns;
    onActionEvent?:
        | ((actionType: ActionType, item: JSONObject) => void)
        | undefined;
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
                        <td
                            key={i}
                            style={{
                                textAlign:
                                    i === props.columns.length - 1
                                        ? 'right'
                                        : 'left',
                            }}
                        >
                            {column.key && !column.getColumnElement ? (
                                column.type === FieldType.Date ? (
                                    props.item[column.key] ? (
                                        OneUptimeDate.getDateAsLocalFormattedString(
                                            props.item[column.key] as string,
                                            column.options?.onlyShowDate ||
                                                false
                                        )
                                    ) : (
                                        ''
                                    )
                                ) : column.type === FieldType.Boolean ? (
                                    props.item[column.key] ? (
                                        <Icon
                                            icon={IconProp.True}
                                            thick={ThickProp.Thick}
                                        />
                                    ) : (
                                        <Icon
                                            icon={IconProp.False}
                                            thick={ThickProp.Thick}
                                        />
                                    )
                                ) : (
                                    (props.item[
                                        column.key
                                    ]?.toString() as string)
                                )
                            ) : (
                                <></>
                            )}

                            {column.key && column.getColumnElement ? (
                                column.getColumnElement(props.item)
                            ) : (
                                <></>
                            )}
                            {column.type === FieldType.Actions && (
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
                            )}
                        </td>
                    );
                })}
        </tr>
    );
};

export default TableRow;
