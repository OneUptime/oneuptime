import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useRef,
    useState,
} from 'react';
import { NodeDataProp, ReturnValue } from 'Common/Types/Workflow/Component';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import BasicForm from '../Forms/BasicForm';
import FormValues from '../Forms/Types/FormValues';
import { JSONObject } from 'Common/Types/JSON';
import Dictionary from 'Common/Types/Dictionary';
import { componentInputTypeToFormFieldType } from './Utils';
import { FormikProps, FormikValues } from 'formik';

export interface ComponentProps {
    component: NodeDataProp;
    onHasFormValidatonErrors: (values: Dictionary<boolean>) => void;
    onFormChange: (value: NodeDataProp) => void;
}

const RunForm: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const formRef: any = useRef<FormikProps<FormikValues>>(null);
    const [component, setComponent] = useState<NodeDataProp>(props.component);
    const [hasFormValidationErrors, setHasFormValidatonErrors] = useState<
        Dictionary<boolean>
    >({});

    useEffect(() => {
        props.onHasFormValidatonErrors(hasFormValidationErrors);
    }, [hasFormValidationErrors]);

    useEffect(() => {
        props.onFormChange(component);
    }, [component]);

    return (
        <div className="mb-3 mt-3">
            <div className="mt-5 mb-5">
                <h2 className="text-base font-medium text-gray-500">
                    Return Values from Trigger
                </h2>
                <p className="text-sm font-medium text-gray-400 mb-5">
                    This workflow has a trigger to get it to run. Since this
                    trigger returns some values to work. You can pass these
                    return values from trigger manually and test this workflow.
                </p>
                {component.metadata.returnValues &&
                    component.metadata.returnValues.length === 0 && (
                        <ErrorMessage
                            error={
                                'This workflow trigger does not take any return values. You can run it by clicking the "Run" button below.'
                            }
                        />
                    )}
                {component.metadata.returnValues &&
                    component.metadata.returnValues.length > 0 && (
                        <BasicForm
                            hideSubmitButton={true}
                            formRef={formRef}
                            initialValues={{
                                ...(component.returnValues || {}),
                            }}
                            onChange={(values: FormValues<JSONObject>) => {
                                setComponent({
                                    ...component,
                                    returnValues: {
                                        ...((component.returnValues as JSONObject) ||
                                            {}),
                                        ...((values as JSONObject) || {}),
                                    },
                                });
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
                                component.metadata.returnValues &&
                                component.metadata.returnValues.map(
                                    (returnValue: ReturnValue) => {
                                        return {
                                            title: `${returnValue.name}`,

                                            description: `${
                                                returnValue.required
                                                    ? 'Required'
                                                    : 'Optional'
                                            }. ${returnValue.description}`,
                                            field: {
                                                [returnValue.id]: true,
                                            },
                                            required: returnValue.required,
                                            placeholder:
                                                returnValue.placeholder,
                                            ...componentInputTypeToFormFieldType(
                                                returnValue.type,
                                                component.returnValues &&
                                                    component.returnValues[
                                                        returnValue.id
                                                    ]
                                                    ? component.returnValues[
                                                          returnValue.id
                                                      ]
                                                    : null
                                            ),
                                        };
                                    }
                                )
                            }
                        />
                    )}
            </div>
        </div>
    );
};

export default RunForm;
