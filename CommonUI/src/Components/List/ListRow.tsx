import { JSONObject } from 'Common/Types/JSON';
import React, {
    FunctionComponent,
    ReactElement,
    useState,
} from 'react';
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
        <div className="padding-15 list-item">
            <Detail item={props.item} fields={props.fields} />

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
