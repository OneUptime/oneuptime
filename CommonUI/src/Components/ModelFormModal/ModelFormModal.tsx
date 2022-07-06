import React, { FunctionComponent, ReactElement } from 'react';
import Button, { ButtonStyleType } from '../Button/Button';
import { IconProp } from '../Icon/Icon';

export interface ComponentProps {
    title: string;
    children: Array<ReactElement> | ReactElement;
    onClose?: () => void;
    submitButtonText?: string;
    onSubmit: () => void;
    submitButtonType?: ButtonStyleType;
}

const ModelFromModal: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div style={{ position: 'relative', zIndex: '1050', display: 'block' }}>
            <div className="">
                <div
                    className="modal fade show"
                    role="dialog"
                    style={{ display: 'block' }}
                >
                    <div className="modal-dialog" role="document">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h5
                                    className="modal-title mt-0"
                                    id="myModalLabel"
                                >
                                    {props.title}
                                </h5>
                                {props.onClose ? (
                                    <Button
                                        buttonStyle={ButtonStyleType.NORMAL}
                                        icon={IconProp.Close}
                                        onClick={() => {
                                            props.onClose && props.onClose();
                                        }}
                                    />
                                ) : (
                                    <></>
                                )}
                            </div>
                            <div className="modal-body">{props.children}</div>
                            <div className="modal-footer">
                                {props.onClose ? (
                                    <Button
                                        buttonStyle={ButtonStyleType.NORMAL}
                                        title={'Close'}
                                        data-dismiss="modal"
                                        onClick={() => {
                                            props.onClose && props.onClose();
                                        }}
                                    />
                                ) : (
                                    <></>
                                )}

                                {props.onSubmit ? (
                                    <Button
                                        buttonStyle={
                                            props.submitButtonType
                                                ? props.submitButtonType
                                                : ButtonStyleType.PRIMARY
                                        }
                                        title={
                                            props.submitButtonText
                                                ? props.submitButtonText
                                                : 'Save Changes'
                                        }
                                        onClick={() => {
                                            props.onSubmit();
                                        }}
                                    />
                                ) : (
                                    <></>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
                <div className="modal-backdrop fade show"></div>
            </div>
        </div>
    );
};

export default ModelFromModal;
