import IconProp from 'Common/Types/Icon/IconProp';
import { JSONObject } from 'Common/Types/JSON';
import { Dictionary } from 'lodash';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import Button, { ButtonStyleType } from '../Button/Button';
import Divider from '../Divider/Divider';
import BasicForm from '../Forms/BasicForm';
import FormFieldSchemaType from '../Forms/Types/FormFieldSchemaType';
import FormValues from '../Forms/Types/FormValues';
import ConfirmModal from '../Modal/ConfirmModal';
import SideOver from '../SideOver/SideOver';
import { NodeDataProp } from './Component';
import ComponentPortViewer from './ComponentPortViewer';
import ComponentReturnValueViewer from './ComponentReturnValueViewer';
import { Argument } from 'Common/Types/Workflow/Component';
import ErrorMessage from '../ErrorMessage/ErrorMessage';


export interface ComponentProps {
    title: string;
    description: string;
    onClose: () => void;
    onSave: (component: NodeDataProp) => void;
    onDelete: (component: NodeDataProp) => void;
    component: NodeDataProp;
}

const ComponentSettingsModal: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [component, setComponent] = useState<NodeDataProp>(props.component);
    const [hasFormValidationErrors, setHasFormValidatonErrors] = useState<Dictionary<boolean>>({});
    const [showDeleteConfirmation, setShowDeleteConfirmation] =
        useState<boolean>(false);

    return (
        <SideOver
            title={props.title}
            description={props.description}
            onClose={props.onClose}
            onSubmit={() => {
                return component && props.onSave(component);
            }}
            submitButtonDisabled={Object.keys(hasFormValidationErrors).filter((key: string) => {
                return hasFormValidationErrors[key];
            }).length !== 0}
            leftFooterElement={
                <Button
                    title={`Delete ${component.metadata.componentType}`}
                    icon={IconProp.Trash}
                    buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                    onClick={() => {
                        setShowDeleteConfirmation(true);
                    }}
                />
            }
        >
            <>
                {showDeleteConfirmation && (
                    <ConfirmModal
                        title={`Delete ${component.metadata.componentType}`}
                        description={`Are you sure you want to delete this ${component.metadata.componentType.toLowerCase()}? This action is not recoverable.`}
                        onClose={() => {
                            setShowDeleteConfirmation(false);
                        }}
                        submitButtonText={'Delete'}
                        onSubmit={() => {
                            props.onDelete(component);
                            setShowDeleteConfirmation(false);
                            props.onClose();
                        }}
                        submitButtonType={ButtonStyleType.DANGER}
                    />
                )}
                <div className='mb-3 mt-3'>
                    <BasicForm
                        hideSubmitButton={true}
                        initialValues={{
                            id: component?.id,
                        }}
                        onChange={(values: FormValues<JSONObject>) => {
                            setComponent({ ...component, ...values });
                        }}
                        onFormValidationErrorChanged={(hasError: boolean) => {
                            setHasFormValidatonErrors({ ...hasFormValidationErrors, "id": hasError });
                        }}
                        fields={[
                            {
                                title: `${component.metadata.componentType} ID`,
                                description: `${component.metadata.componentType} ID will make it easier for you to connect to other components.`,
                                field: {
                                    id: true,
                                },

                                required: true,

                                fieldType: FormFieldSchemaType.Text,
                            },
                        ]}
                    />
                </div>

                {component.metadata.outPorts.length > 0 && <Divider />}

                <div className='mb-3 mt-3'>
                    <div className='mt-5 mb-5'>
                        <h2 className="text-base font-medium text-gray-500">Arguments</h2>
                        <p className="text-sm font-medium text-gray-400 mb-5">Arguments for this component</p>
                        {component.metadata.arguments && component.metadata.arguments.length === 0 && <ErrorMessage error={'This component does not take any arguments.'} />}
                        {component.metadata.arguments && component.metadata.arguments.length > 0 && <BasicForm
                            hideSubmitButton={true}
                            initialValues={{
                                ...component.arguments || {}
                            }}
                            onChange={(values: FormValues<JSONObject>) => {
                                setComponent({ ...component, ...values });
                            }}
                            onFormValidationErrorChanged={(hasError: boolean) => {
                                setHasFormValidatonErrors({ ...hasFormValidationErrors, "id": hasError });
                            }}
                            fields={component.metadata.arguments && component.metadata.arguments.map((arg: Argument) => {
                                return {
                                    title: `${arg.name}`,
                                    description: `${arg.required ? "Required" : "Optional"}. ${arg.description}`,
                                    field: {
                                        [arg.id]: true,
                                    },
                                    required: arg.required,
                                    fieldType: FormFieldSchemaType.Text,
                                }
                            })}
                        />}
                    </div>
                </div>

                <Divider />


                <div className='mb-3 mt-3'>
                    <ComponentPortViewer name="In Ports" description='Here  is a list of inports for this component' ports={component.metadata.inPorts} />
                </div>

                <Divider />

                <div className='mb-3 mt-3'>
                    <ComponentPortViewer name="Out Ports" description='Here  is a list of outports for this component' ports={component.metadata.outPorts} />
                </div>


                
                <Divider />
                <div className='mb-3 mt-3'>
                    <ComponentReturnValueViewer name="Return Values" description='Here  is a list of values that this component returns' returnValues={component.metadata.returnValues} />
                </div>



            </>
        </SideOver>
    );
};

export default ComponentSettingsModal;
