import EqualToOrNull from 'Common/Types/Database/EqualToOrNull';
import ObjectID from 'Common/Types/ObjectID';
import WorkflowVariable from 'Model/Models/WorkflowVariable';
import React, { FunctionComponent, ReactElement } from 'react';
import ModelListModal from '../ModelListModal/ModelListModal';

export interface ComponentProps {
    workflowId: ObjectID;
    onClose: () => void;
    onSave: (variableId: string) => void;
}

const VariableModal: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <ModelListModal
            modalTitle="Select a variable"
            query={{
                workflowId: new EqualToOrNull(props.workflowId.toString()),
            }}
            noItemsMessage="You do have any variables. Please add global or workflow variables."
            modalDescription="This list contains both Global and Workflow variables."
            titleField="name"
            descriptionField="description"
            headerField={(item: WorkflowVariable) => {
                let variableType: string = 'GLOBAL VARIABLE';

                if (item.workflowId) {
                    variableType = 'LOCAL WORKFLOW VARIABLE';
                }

                return (
                    <p className="text-xs text-gray-400 mb-2">{variableType}</p>
                );
            }}
            modelType={WorkflowVariable}
            select={{
                _id: true,
                name: true,
                description: true,
                workflowId: true,
            }}
            onClose={props.onClose}
            onSave={(variables: Array<WorkflowVariable>) => {
                if (variables[0]?.workflowId) {
                    props.onSave(`{{local.variables.${variables[0]?.name}}}`);
                } else {
                    props.onSave(`{{global.variables.${variables[0]?.name}}}`);
                }
            }}
        />
    );
};

export default VariableModal;
