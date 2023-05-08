import {
    ComponentInputType,
    NodeDataProp,
    NodeType,
} from 'Common/Types/Workflow/Component';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import { ButtonStyleType } from '../Button/Button';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import ConfirmModal from '../Modal/ConfirmModal';
import SideOver from '../SideOver/SideOver';
import RunForm from './RunForm';
import JSONFunctions from 'Common/Types/JSONFunctions';

export interface ComponentProps {
    onClose: () => void;
    onRun: (trigger: NodeDataProp) => void;
    trigger: NodeDataProp;
}

const RunModal: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [component, setComponent] = useState<NodeDataProp>(props.trigger);
    const [hasFormValidationErrors, setHasFormValidatonErrors] =
        useState<boolean>(false);
    const [showRunConfirmation, setShowRunConfirmation] =
        useState<boolean>(false);

    const [showFormValidationErrors, setShowFormValidationErrors] =
        useState<boolean>(false);

    return (
        <SideOver
            title={'Run Workflow'}
            description={
                'You can run this workflow manually. This can be helpful to test the workflow.'
            }
            onClose={props.onClose}
            submitButtonDisabled={
                component.nodeType === NodeType.PlaceholderNode
            }
            submitButtonText={'Run Workflow Manually'}
            onSubmit={() => {
                if (hasFormValidationErrors) {
                    setShowFormValidationErrors(true);
                } else {
                    setShowRunConfirmation(true);
                }
            }}
        >
            <>
                {showRunConfirmation && (
                    <ConfirmModal
                        title={`Run Workflow Manually`}
                        description={`Are you sure you want to run this workflow manually?`}
                        onClose={() => {
                            setShowRunConfirmation(false);
                        }}
                        submitButtonText={'Run'}
                        onSubmit={() => {
                            setShowRunConfirmation(false);

                            // parse things as JSON if args in JSON

                            for (const args of component.metadata
                                .returnValues) {
                                if (
                                    (args.type === ComponentInputType.JSON ||
                                        args.type ===
                                            ComponentInputType.JSONArray ||
                                        args.type ===
                                            ComponentInputType.BaseModel ||
                                        args.type ===
                                            ComponentInputType.BaseModelArray ||
                                        args.type ===
                                            ComponentInputType.Query ||
                                        args.type ===
                                            ComponentInputType.StringDictionary) &&
                                    component.returnValues[args.id] &&
                                    typeof component.returnValues[args.id] ===
                                        'string'
                                ) {
                                    component.returnValues[args.id] =
                                        JSONFunctions.parse(
                                            component.returnValues[
                                                args.id
                                            ] as string
                                        );
                                }
                            }

                            props.onRun(component);
                            props.onClose();
                        }}
                        submitButtonType={ButtonStyleType.SUCCESS}
                    />
                )}

                {showFormValidationErrors && (
                    <ConfirmModal
                        title={`Please fix errors`}
                        description={`There are some validation errors on the form. Please fix them before you run the workflow.`}
                        submitButtonText={'Close'}
                        onSubmit={() => {
                            setShowFormValidationErrors(false);
                        }}
                        submitButtonType={ButtonStyleType.NORMAL}
                    />
                )}

                {component.nodeType === NodeType.Node && (
                    <RunForm
                        component={component}
                        onFormChange={(component: NodeDataProp) => {
                            setComponent({ ...component });
                        }}
                        onHasFormValidatonErrors={(value: boolean) => {
                            setHasFormValidatonErrors(value);
                        }}
                    />
                )}

                {component.nodeType === NodeType.PlaceholderNode && (
                    <ErrorMessage error="No trigger added. Please add a trigger in order to run this workflow" />
                )}
            </>
        </SideOver>
    );
};

export default RunModal;
