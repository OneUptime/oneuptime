import OneUptimeDate from 'Common/Types/Date';
import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import Button, { ButtonSize } from '../Button/Button';
import Icon, { IconProp, ThickProp } from '../Icon/Icon';
import ActionButtonSchema from '../ActionButton/ActionButtonSchema';
import Column from './Types/Column';
import Columns from './Types/Columns';
import FieldType from '../Types/FieldType';
import _ from 'lodash';
import ConfirmModal from '../Modal/ConfirmModal';
import { useDrag } from 'react-dnd'



export interface ComponentProps {
    item: JSONObject;
    columns: Columns;
    actionButtons?: Array<ActionButtonSchema> | undefined;
    enableDragAndDrop?: boolean | undefined;
    dragAndDropScope?: string | undefined;
}

const TableRow: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {


    const [collected, drag, dragPreview] = useDrag(() => ({
        type: props.dragAndDropScope || 'dnd',
        item: props.item
      }))

    const [isButtonLoading, setIsButtonLoading] = useState<Array<boolean>>(
        props.actionButtons?.map(() => {
            return false;
        }) || []
    );


    const [error, setError] = useState<string>('');
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
                            {column.key && !column.getElement ? (
                                column.type === FieldType.Date ? (
                                    props.item[column.key] ? (
                                        OneUptimeDate.getDateAsLocalFormattedString(
                                            props.item[column.key] as string,
                                            true
                                        )
                                    ) : (
                                        ''
                                    )
                                ) : column.type === FieldType.DateTime ? (
                                    props.item[column.key] ? (
                                        OneUptimeDate.getDateAsLocalFormattedString(
                                            props.item[column.key] as string,
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
                                    _.get(
                                        props.item,
                                        column.key,
                                        ''
                                    )?.toString() || ''
                                )
                            ) : (
                                <></>
                            )}

                            {column.key && column.getElement ? (
                                column.getElement(props.item)
                            ) : (
                                <></>
                            )}
                            {column.type === FieldType.Actions && (
                                <div>
                                    {error && (
                                        <div className="text-align-left">
                                            <ConfirmModal
                                                title={`Error`}
                                                description={error}
                                                submitButtonText={'Close'}
                                                onSubmit={() => {
                                                    return setError('');
                                                }}
                                            />
                                        </div>
                                    )}
                                    {props.actionButtons?.map(
                                        (
                                            button: ActionButtonSchema,
                                            i: number
                                        ) => {
                                            if (
                                                button.isVisible &&
                                                !button.isVisible(props.item)
                                            ) {
                                                return <></>;
                                            }

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
                                                        isLoading={
                                                            isButtonLoading[i]
                                                        }
                                                        onClick={() => {
                                                            if (
                                                                button.onClick
                                                            ) {
                                                                isButtonLoading[
                                                                    i
                                                                ] = true;
                                                                setIsButtonLoading(
                                                                    isButtonLoading
                                                                );

                                                                button.onClick(
                                                                    props.item,
                                                                    () => {
                                                                        // on aciton complete
                                                                        isButtonLoading[
                                                                            i
                                                                        ] = false;
                                                                        setIsButtonLoading(
                                                                            isButtonLoading
                                                                        );
                                                                    },
                                                                    (
                                                                        err: Error
                                                                    ) => {
                                                                        isButtonLoading[
                                                                            i
                                                                        ] = false;
                                                                        setIsButtonLoading(
                                                                            isButtonLoading
                                                                        );
                                                                        setError(
                                                                            (
                                                                                err as Error
                                                                            )
                                                                                .message
                                                                        );
                                                                    }
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
