import ObjectID from 'Common/Types/ObjectID';
import WorkflowVariable from 'Model/Models/WorkflowVariable';
import React from 'react';
import { FunctionComponent, ReactElement } from 'react';
import ModelListModal from '../ModelListModal/ModelListModal';

export interface ComponentProps {
    workflowId: ObjectID
    onClose: () => void;
    onSave: (variableId: string) => void;
}

const VariableModal: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {


    return (
        <ModelListModal
            modalTitle='Select a variable'
            query={{
                workflowId: props.workflowId
            }}
            modalDescription='This list contains both Global and Workflow variables.'
            modelType={WorkflowVariable} 
            select={{ _id: true, name: true, description: true, workflowId: true }}
            onClose={props.onClose}
            onSubmit={(variables: Array<WorkflowVariable>) => {
                if (variables[0]?.workflowId) {
                    props.onSave(`{{variable.local.${variables[0]?.name}}}`);
                } else {
                    props.onSave(`{{variable.global.${variables[0]?.name}}}`);
                }
            }} />
    );
};

export default VariableModal;
