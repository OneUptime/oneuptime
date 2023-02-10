import React, { FunctionComponent, ReactElement } from 'react';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import SideOver from '../SideOver/SideOver';
import { NodeDataProp } from './Component';

export interface ComponentProps {
    title: string;
    description: string;
    onClose: () => void; 
    onSave: ()=> void; 
    component: NodeDataProp | null;
}

const ComponentSettingsModal: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <SideOver title={props.title} description={props.description} onClose={props.onClose} onSubmit={props.onSave}>
            <>
            {!props.component && <ErrorMessage error='No component is selected' />}
            </>
        </SideOver>
    );
};

export default ComponentSettingsModal;
