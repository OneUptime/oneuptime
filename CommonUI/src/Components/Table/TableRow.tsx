import OneUptimeDate from 'Common/Types/Date';
import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import Button, { ButtonSize, ButtonStyleType } from '../Button/Button';
import Icon, { ThickProp } from '../Icon/Icon';
import IconProp from 'Common/Types/Icon/IconProp';
import ActionButtonSchema from '../ActionButton/ActionButtonSchema';
import Column from './Types/Column';
import Columns from './Types/Columns';
import FieldType from '../Types/FieldType';
import _ from 'lodash';
import ConfirmModal from '../Modal/ConfirmModal';
import { Draggable, DraggableProvided } from 'react-beautiful-dnd';

export interface ComponentProps {
    item: JSONObject;
    columns: Columns;
    actionButtons?: Array<ActionButtonSchema> | undefined;
    enableDragAndDrop?: boolean | undefined;
    dragAndDropScope?: string | undefined;
    dragDropIdField?: string | undefined;
    dragDropIndexField?: string | undefined;
}

const TableRow: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [isButtonLoading, setIsButtonLoading] = useState<Array<boolean>>(
        props.actionButtons?.map(() => {
            return false;
        }) || []
    );

    const [tooltipModalText, setTooltipModalText] = useState<string>('');

    const [error, setError] = useState<string>('');

    const getRow: Function = (provided?: DraggableProvided): ReactElement => {
        return (
            <>
                <tr {...provided?.draggableProps} ref={provided?.innerRef}>
                    {props.enableDragAndDrop && (
                        <td
                            className="ml-3 w-10"
                            {...provided?.dragHandleProps}
                        >
                            <Icon
                                icon={IconProp.Drag}
                                thick={ThickProp.Thick}
                                className=" h-6 w-6 text-gray-500 hover:text-gray-700 m-auto cursor-ns-resize"
                            />
                        </td>
                    )}
                    {props.columns &&
                        props.columns.map((column: Column, i: number) => {
                            let className: string =
                                'whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-500 sm:pl-6';
                            if (i === props.columns.length - 1) {
                                className =
                                    'whitespace-nowrap py-4 pl-4 pr-6 text-sm font-medium text-gray-500 sm:pl-6';
                            }
                            return (
                                <td
                                    key={i}
                                    className={className}
                                    style={{
                                        textAlign:
                                            column.type === FieldType.Actions
                                                ? 'right'
                                                : 'left',
                                    }}
                                    onClick={() => {
                                        if (column.tooltipText) {
                                            setTooltipModalText(
                                                column.tooltipText(props.item)
                                            );
                                        }
                                    }}
                                >
                                    {column.key && !column.getElement ? (
                                        column.type === FieldType.Date ? (
                                            props.item[column.key] ? (
                                                OneUptimeDate.getDateAsLocalFormattedString(
                                                    props.item[
                                                    column.key
                                                    ] as string,
                                                    true
                                                )
                                            ) : (
                                                ''
                                            )
                                        ) : column.type ===
                                            FieldType.DateTime ? (
                                            props.item[column.key] ? (
                                                OneUptimeDate.getDateAsLocalFormattedString(
                                                    props.item[
                                                    column.key
                                                    ] as string,
                                                    false
                                                )
                                            ) : (
                                                ''
                                            )
                                        ) : column.type ===
                                            FieldType.Boolean ? (
                                            props.item[column.key] ? (
                                                <Icon
                                                    icon={IconProp.Check}
                                                    className={
                                                        'h-5 w-5 text-gray-500'
                                                    }
                                                    thick={ThickProp.Thick}
                                                />
                                            ) : (
                                                <Icon
                                                    icon={IconProp.False}
                                                    className={
                                                        'h-5 w-5 text-gray-500'
                                                    }
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
                                        <div className="flex justify-end">
                                            {error && (
                                                <div className="text-align-left">
                                                    <ConfirmModal
                                                        title={`Error`}
                                                        description={error}
                                                        submitButtonText={
                                                            'Close'
                                                        }
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
                                                        !button.isVisible(
                                                            props.item
                                                        )
                                                    ) {
                                                        return <></>;
                                                    }

                                                    return (
                                                        <div key={i}>
                                                            <Button
                                                                buttonSize={
                                                                    ButtonSize.Small
                                                                }
                                                                title={
                                                                    button.title
                                                                }
                                                                icon={
                                                                    button.icon
                                                                }
                                                                buttonStyle={
                                                                    button.buttonStyleType
                                                                }
                                                                isLoading={
                                                                    isButtonLoading[
                                                                    i
                                                                    ]
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
                                                                                ] =
                                                                                    false;
                                                                                setIsButtonLoading(
                                                                                    isButtonLoading
                                                                                );
                                                                            },
                                                                            (
                                                                                err: Error
                                                                            ) => {
                                                                                isButtonLoading[
                                                                                    i
                                                                                ] =
                                                                                    false;
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
                                                        </div>
                                                    );
                                                }
                                            )}
                                        </div>
                                    )}
                                </td>
                            );
                        })}
                </tr>
                {tooltipModalText && (
                    <ConfirmModal
                        title={`Help`}
                        description={`${tooltipModalText}`}
                        submitButtonText={'Close'}
                        onSubmit={() => {
                            setTooltipModalText('');
                        }}
                        submitButtonType={ButtonStyleType.NORMAL}
                    />
                )}
            </>
        );
    };

    if (props.enableDragAndDrop) {
        return (
            <Draggable
                draggableId={
                    (props.item[props.dragDropIdField || ''] as string) || ''
                }
                index={
                    (props.item[props.dragDropIndexField || 0] as number) || 0
                }
            >
                {(provided: DraggableProvided) => {
                    return getRow(provided);
                }}
            </Draggable>
        );
    }

    return getRow();
};

export default TableRow;
