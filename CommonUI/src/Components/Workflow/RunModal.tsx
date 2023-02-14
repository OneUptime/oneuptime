import Dictionary from 'Common/Types/Dictionary';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import { ButtonStyleType } from '../Button/Button';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import ConfirmModal from '../Modal/ConfirmModal';
import SideOver from '../SideOver/SideOver';
import { NodeDataProp, NodeType } from './Component';
import RunForm from './RunForm';

export interface ComponentProps {
    onClose: () => void;
    onRun: (trigger: NodeDataProp) => void;
    trigger: NodeDataProp;
}

const RunModal: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [component, setComponent] = useState<NodeDataProp>(props.trigger);
    const [hasFormValidationErrors, setHasFormValidatonErrors] = useState<
        Dictionary<boolean>
    >({});
    const [showRunConfirmation, setShowRunConfirmation] =
        useState<boolean>(false);

    const [showRunSuccessConfirmation, setShowRunSuccessConfirmation] =
        useState<boolean>(false);

    const [showFormValidationErrors, setShowFormValidationErrors] =
        useState<boolean>(false);




    return (
        <SideOver
            title={"Run Workflow"}
            description={"You can run this workflow manually. This can be helpful to test the workflow."}
            onClose={props.onClose}
            submitButtonDisabled={component.nodeType === NodeType.PlaceholderNode}
            submitButtonText={'Run Workflow'}
            onSubmit={() => {

                if (Object.keys(hasFormValidationErrors).length > 0) {
                    setShowFormValidationErrors(true)
                } else {
                    setShowRunConfirmation(true);
                }


            }}
        >
            <>
                {showRunConfirmation && (
                    <ConfirmModal
                        title={`Run Workflow`}
                        description={`Are you sure you want to run this Workflow?`}
                        onClose={() => {
                            setShowRunConfirmation(false);
                        }}
                        submitButtonText={'Run'}
                        onSubmit={() => {
                            props.onRun(component);
                            setShowRunConfirmation(false);
                            setShowRunSuccessConfirmation(true);
                        }}
                        submitButtonType={ButtonStyleType.SUCCESS}
                    />
                )}


                {showRunSuccessConfirmation && (
                    <ConfirmModal
                        title={`Workflow Started...`}
                        description={`This workflow is scheduled to execute soon. You can see the status of the run in the Runs and Logs section.`}

                        submitButtonText={'Close'}
                        onSubmit={() => {
                            setShowRunSuccessConfirmation(false);
                            props.onClose();
                        }}
                        submitButtonType={ButtonStyleType.NORMAL}
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




                {component.nodeType === NodeType.Node && <RunForm

                    component={component}
                    onFormChange={(component: NodeDataProp) => {
                        setComponent({ ...component });
                    }}
                    onHasFormValidatonErrors={(value: Dictionary<boolean>) => {
                        setHasFormValidatonErrors({
                            ...hasFormValidationErrors,
                            ...value,
                        });
                    }}
                />}

                {component.nodeType === NodeType.PlaceholderNode && <ErrorMessage error='No trigger added. Please add a trigger in order to run this workflow' />}



            </>
        </SideOver>
    );
};

export default RunModal;
