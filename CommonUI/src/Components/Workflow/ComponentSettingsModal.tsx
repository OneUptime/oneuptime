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
            submitButtonDisabled={Object.keys(hasFormValidationErrors).filter((key: string)=> {
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
                    onFormValidationErrorChanged={(hasError: boolean)=>{
                        setHasFormValidatonErrors({...hasFormValidationErrors, "id": hasError});
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

                <Divider />
            </>
        </SideOver>
    );
};

export default ComponentSettingsModal;
