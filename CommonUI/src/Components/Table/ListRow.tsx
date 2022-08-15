import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement, useEffect, useState } from 'react';
import Button, { ButtonSize } from '../Button/Button';
import Detail from '../Detail/Detail';
import Field from '../Detail/Field';
import ConfirmModal from '../Modal/ConfirmModal';
import ActionButtonSchema from './Types/ActionButtonSchema';
import Columns from './Types/Columns';

export interface ComponentProps {
    item: JSONObject;
    columns: Columns;
    actionButtons?: Array<ActionButtonSchema> | undefined;
}

const ListRow: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const [isButtonLoading, setIsButtonLoading] = useState<Array<boolean>>(props.actionButtons?.map(() => false) || []);
    // convert column to field 
    const [fields, setFields] = useState<Array<Field>>([]);
    const [error, setError] = useState<string>('');

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
                                    isLoading={isButtonLoading[i]}
                                    onClick={() => {
                                        if (button.onClick) {
                                            isButtonLoading[i] = true;
                                            setIsButtonLoading(isButtonLoading);
                                            button.onClick(props.item, () => {
                                                // on aciton complete 
                                                isButtonLoading[i] = false;
                                                setIsButtonLoading(isButtonLoading);
                                            }, (err) => {
                                                isButtonLoading[i] = false;
                                                setIsButtonLoading(isButtonLoading);
                                                setError((err as Error).message);
                                            })
                                        }
                                    }}
                                />
                            </span>
                        );
                    }
                )}


            </div>
            {error && <ConfirmModal
                title={`Error`}
                description={error}
                submitButtonText={'Close'}
                onSubmit={() =>
                    setError('')
                }
            />}

        </div>
    );
};

export default ListRow;
