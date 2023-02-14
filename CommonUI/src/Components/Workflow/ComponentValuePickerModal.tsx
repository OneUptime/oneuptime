import { Black } from 'Common/Types/BrandColors';
import { ReturnValue } from 'Common/Types/Workflow/Component';
import React, { useState } from 'react';
import { FunctionComponent, ReactElement } from 'react';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import Modal, { ModalWidth } from '../Modal/Modal';
import Pill from '../Pill/Pill';
import { NodeDataProp } from './Component';

export interface ComponentProps {
    onClose: () => void;
    onSave: (componentValueId: string) => void;
    components: Array<NodeDataProp>;
    currentComponent: NodeDataProp;
}

const ComponentValuePickerModal: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {


    const [selectedReturnValue, setSelectedReturnValue] = useState<ReturnValue | null>(null);
    const [selectedComponent, setSelectedComponent] = useState<NodeDataProp | null>(null);

    return (
        <Modal
            modalWidth={ModalWidth.Large}
            title={"Select return value from another component"}
            description={"Select a return value from the component this component is connected to."}
            onClose={props.onClose}
            disableSubmitButton={!selectedReturnValue}
            onSubmit={() => {

                if (!selectedReturnValue) {
                    return props.onClose();
                }

                if (!selectedComponent) {
                    return props.onClose();
                }

                props.onSave(`{{local.components.${selectedComponent.id}.returnValue.${selectedReturnValue.id}}}`);
            }}
        >
            <div className='max-h-96 mt-5 mb-5 overflow-y-scroll'>



                {props.components &&
                    props.components.length > 0 &&
                    props.components.map((component: NodeDataProp, i: number): ReactElement => {


                        return (<div className='p-3 pl-1'>
                            <h2 className="text-base font-medium text-gray-500">
                             {component.metadata.title} ({component.id})
                            </h2>
                            <p className="text-sm font-medium text-gray-400">
                                {component.metadata.description}
                            </p>


                            {component.metadata.returnValues && component.metadata.returnValues.length === 0 && <ErrorMessage error="This component does not have any return values." />}
                            {component.metadata.returnValues && component.metadata.returnValues.map((returnValue: ReturnValue) => {

                                const isSelected: boolean = !!(selectedComponent && component.id === selectedComponent.id && selectedReturnValue && selectedReturnValue.id === returnValue.id);


                                return (
                                    <div
                                        key={i}
                                        onClick={() => {
                                            setSelectedComponent(component);
                                            setSelectedReturnValue(returnValue);
                                        }}
                                        className={`cursor-pointer mt-2 mb-2 relative flex items-center space-x-3 rounded-lg border border-gray-300 bg-white px-6 py-5 shadow-sm focus-within:ring-2 focus-within:ring-pink-500 focus-within:ring-offset-2 hover:border-gray-400 ${isSelected ? 'ring ring-indigo-500' : ''
                                            }`}
                                    >
                                        <div className="min-w-0 flex-1 flex justify-between">
                                            <div className="focus:outline-none">
                                                <span
                                                    className="absolute inset-0"
                                                    aria-hidden="true"
                                                ></span>
                                                <p className="text-sm font-medium text-gray-900">
                                                    {returnValue.name}{' '}
                                                    <span className="text-gray-500 font-normal">
                                                        (ID: {returnValue.id})
                                                    </span>
                                                </p>
                                                <p className="truncate text-sm text-gray-500">
                                                    {returnValue.description}
                                                </p>
                                            </div>
                                            <div>
                                                <Pill
                                                    color={Black}
                                                    text={returnValue.type}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                );


                            })}

                        </div>)


                    })}
            </div>
        </Modal>
    );
};

export default ComponentValuePickerModal;
