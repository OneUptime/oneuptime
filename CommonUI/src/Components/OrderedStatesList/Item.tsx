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
    getTitleElement?: ((item: JSONObject) => ReactElement) | undefined;
    getDescriptionElement?: ((item: JSONObject) => ReactElement) | undefined;
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
        <div className="text-center border border-gray-300 rounded p-10 space-y-4 w-fit">
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

            {!props.getTitleElement && (
                <div>
                    {props.item[props.titleField]
                        ? (props.item[props.titleField] as string)
                        : ''}
                </div>
            )}
            {props.getTitleElement && (
                <div className="justify-center flex">
                    {props.getTitleElement(props.item)}
                </div>
            )}
            <div className="text-gray-500">
                {props.getDescriptionElement && (
                    <div className="justify-center flex">
                        {props.getDescriptionElement(props.item)}
                    </div>
                )}
                {!props.getDescriptionElement && (
                    <div>
                        {props.descriptionField &&
                        props.item[props.descriptionField]
                            ? (props.item[props.descriptionField] as string)
                            : ''}
                    </div>
                )}
            </div>
            <div className="flex justify-center">
                {props.actionButtons?.map(
                    (button: ActionButtonSchema, i: number) => {
                        if (button.isVisible && !button.isVisible(props.item)) {
                            return <></>;
                        }

                        return (
                            <div
                                key={i}
                                className=""
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
                            </div>
                        );
                    }
                )}
            </div>
        </div>
    );
};

export default Item;
