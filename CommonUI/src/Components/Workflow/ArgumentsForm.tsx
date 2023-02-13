import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useRef,
    useState,
} from 'react';
import { Argument } from 'Common/Types/Workflow/Component';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import BasicForm from '../Forms/BasicForm';
import FormValues from '../Forms/Types/FormValues';
import { NodeDataProp } from './Component';
import { JSONObject } from 'Common/Types/JSON';
import Dictionary from 'Common/Types/Dictionary';
import { componentInputTypeToFormFieldType } from './Utils';
import VariableModal from './VariableModal';
import { FormikProps, FormikValues } from 'formik';
import ObjectID from 'Common/Types/ObjectID';

export interface ComponentProps {
    component: NodeDataProp;
    onHasFormValidatonErrors: (values: Dictionary<boolean>) => void;
    workflowId: ObjectID;
}

const ArgumentsForm: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const formRef: any = useRef<FormikProps<FormikValues>>(null);
    const [component, setComponent] = useState<NodeDataProp>(props.component);
    const [showVariableModal, setShowVariableModal] = useState<boolean>(false);
    const [_showComponentPickerModal, setShowComponentPickerModal] =
        useState<boolean>(false);
    const [hasFormValidationErrors, setHasFormValidatonErrors] = useState<
        Dictionary<boolean>
    >({});

    const [selectedArgId, setSelectedArgId] = useState<string>('');

    useEffect(() => {
        props.onHasFormValidatonErrors(hasFormValidationErrors);
    }, [hasFormValidationErrors]);

    return (
        <div className="mb-3 mt-3">
            <div className="mt-5 mb-5">
                <h2 className="text-base font-medium text-gray-500">
                    Arguments
                </h2>
                <p className="text-sm font-medium text-gray-400 mb-5">
                    Arguments for this component
                </p>
                {component.metadata.arguments &&
                    component.metadata.arguments.length === 0 && (
                        <ErrorMessage
                            error={
                                'This component does not take any arguments.'
                            }
                        />
                    )}
                {component.metadata.arguments &&
                    component.metadata.arguments.length > 0 && (
                        <BasicForm
                            hideSubmitButton={true}
                            formRef={formRef}
                            initialValues={{
                                ...(component.arguments || {}),
                            }}
                            onChange={(values: FormValues<JSONObject>) => {
                                setComponent({ ...component, ...values });
                            }}
                            onFormValidationErrorChanged={(
                                hasError: boolean
                            ) => {
                                setHasFormValidatonErrors({
                                    ...hasFormValidationErrors,
                                    id: hasError,
                                });
                            }}
                            fields={
                                component.metadata.arguments &&
                                component.metadata.arguments.map(
                                    (arg: Argument) => {
                                        return {
                                            title: `${arg.name}`,
                                            footerElement: (
                                                <div className="text-gray-500">
                                                    <p>
                                                        Pick this value from
                                                        other{' '}
                                                        <a
                                                            className="underline text-blue-500 hover:text-blue-600 cursor-pointer"
                                                            onClick={() => {
                                                                setSelectedArgId(
                                                                    arg.id
                                                                );
                                                                setShowComponentPickerModal(
                                                                    true
                                                                );
                                                            }}
                                                        >
                                                            component
                                                        </a>{' '}
                                                        or from{' '}
                                                        <a
                                                            className="underline text-blue-500 hover:text-blue-600 cursor-pointer"
                                                            onClick={() => {
                                                                setSelectedArgId(
                                                                    arg.id
                                                                );
                                                                setShowVariableModal(
                                                                    true
                                                                );
                                                            }}
                                                        >
                                                            variable.
                                                        </a>
                                                    </p>
                                                </div>
                                            ),
                                            description: `${
                                                arg.required
                                                    ? 'Required'
                                                    : 'Optional'
                                            }. ${arg.description}`,
                                            field: {
                                                [arg.id]: true,
                                            },
                                            required: arg.required,
                                            ...componentInputTypeToFormFieldType(
                                                arg.type
                                            ),
                                        };
                                    }
                                )
                            }
                        />
                    )}
            </div>
            {showVariableModal && (
                <VariableModal
                    workflowId={props.workflowId}
                    onClose={() => {
                        setShowVariableModal(false);
                    }}
                    onSave={(variableId: string) => {
                        formRef.current.setFieldValue(
                            selectedArgId,
                            variableId
                        );
                    }}
                />
            )}
        </div>
    );
};

export default ArgumentsForm;
