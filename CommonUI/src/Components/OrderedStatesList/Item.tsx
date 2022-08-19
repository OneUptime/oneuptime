import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import ActionButtonSchema from '../ActionButton/ActionButtonSchema';
import Button, { ButtonSize } from '../Button/Button';
import ConfirmModal from '../Modal/ConfirmModal';

export interface ComponentProps {
    item: JSONObject;
    actionButtons?: undefined | Array<ActionButtonSchema>;
    titleField: string; 
    descriptionField?: string | undefined; 
}

const Item: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const [isButtonLoading, setIsButtonLoading] = useState<Array<boolean>>(
        props.actionButtons?.map(() => {
            return false;
        }) || []
    );

    const [error, setError] = useState<string>('');

    return (
        <div>
             {error && (
                <ConfirmModal
                    title={`Error`}
                    description={error}
                    submitButtonText={'Close'}
                    onSubmit={() => {
                        return setError('');
                    }}
                />
            )}
            <div>{props.item[props.titleField] ? props.item[props.titleField]  as string : '' }</div>
            <div>{props.descriptionField && props.item[props.descriptionField] ? props.item[props.descriptionField] as string :  ''}</div>
            <div>
                {props.actionButtons?.map(
                    (button: ActionButtonSchema, i: number) => {
                        return (
                            <span
                                style={
                                    i > 0
                                        ? {
                                              marginLeft: '10px',
                                          }
                                        : {}
                                }
                                key={i}
                            >
                                <Button
                                    buttonSize={ButtonSize.Small}
                                    title={button.title}
                                    icon={button.icon}
                                    buttonStyle={button.buttonStyleType}
                                    isLoading={isButtonLoading[i]}
                                    onClick={() => {
                                        if (button.onClick) {
                                            isButtonLoading[i] = true;
                                            setIsButtonLoading(isButtonLoading);
                                            button.onClick(
                                                props.item,
                                                () => {
                                                    // on aciton complete
                                                    isButtonLoading[i] = false;
                                                    setIsButtonLoading(
                                                        isButtonLoading
                                                    );
                                                },
                                                (err: Error) => {
                                                    isButtonLoading[i] = false;
                                                    setIsButtonLoading(
                                                        isButtonLoading
                                                    );
                                                    setError(
                                                        (err as Error).message
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
        </div>
    );
};

export default Item;
