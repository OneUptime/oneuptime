import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import Button, { ButtonSize } from '../Button/Button';
import Detail from '../Detail/Detail';
import Field from '../Detail/Field';
import ConfirmModal from '../Modal/ConfirmModal';
import ActionButtonSchema from '../ActionButton/ActionButtonSchema';
export interface ComponentProps {
    item: JSONObject;
    fields: Array<Field>;
    actionButtons?: Array<ActionButtonSchema> | undefined;
}

const ListRow: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [isButtonLoading, setIsButtonLoading] = useState<Array<boolean>>(
        props.actionButtons?.map(() => {
            return false;
        }) || []
    );

    const [error, setError] = useState<string>('');

    return (
        <div className="bg-white px-4 py-6 shadow sm:rounded-lg sm:px-6">
            <div>
                <Detail item={props.item} fields={props.fields} />
            </div>

            <div className='flex mt-5 -ml-3'>
                {props.actionButtons?.map(
                    (button: ActionButtonSchema, i: number) => {
                        if (button.isVisible && !button.isVisible(props.item)) {
                            return <></>;
                        }

                        return (
                            <div
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
                            </div>
                        );
                    }
                )}
            </div>
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
        </div>
    );
};

export default ListRow;