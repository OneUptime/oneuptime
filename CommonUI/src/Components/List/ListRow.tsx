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


    // return <div className="bg-white px-4 py-6 shadow sm:rounded-lg sm:px-6">
    //     <div className="sm:flex sm:items-baseline sm:justify-between">
    //         <h3 className="text-base font-medium">
    //             <span className="text-gray-900">Monica White </span>
    //             <span className="text-gray-600">wrote</span>
    //         </h3>
    //         <p className="mt-1 whitespace-nowrap text-sm text-gray-600 sm:mt-0 sm:ml-3">
    //             <time>Wednesday at 4:35pm</time>
    //         </p>
    //     </div>
    //     <div className="mt-4 space-y-6 text-sm text-gray-800">
    //         <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Malesuada at ultricies tincidunt elit et, enim. Habitant nunc, adipiscing non fermentum, sed est a, aliquet. Lorem in vel libero vel augue aliquet dui commodo.</p>
    //         <p>Nec malesuada sed sit ut aliquet. Cras ac pharetra, sapien purus vitae vestibulum auctor faucibus ullamcorper. Leo quam tincidunt porttitor neque, velit sed. Tortor mauris ornare ut tellus sed aliquet amet venenatis condimentum. Convallis accumsan et nunc eleifend.</p>
    //         <p><strong style={{ "fontWeight": 600 }}>Monica White</strong><br/>Customer Service</p>
    //     </div>
    // </div>

    return (
        <div className="bg-white px-4 py-6 shadow sm:rounded-lg sm:px-6">
            <div>
                <Detail item={props.item} fields={props.fields} />
            </div>

            <div className='flex mt-3 -ml-3'>
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