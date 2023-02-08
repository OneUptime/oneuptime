// Show a large modal full of components.

import React, { FunctionComponent, ReactElement } from 'react';
import { ComponentType } from 'Common/Types/Workflow/Component';
import Components from 'Common/Types/Workflow/Components';
import Modal, { ModalWidth } from '../Modal/Modal';
import { ButtonStyleType } from '../Button/Button';
import ComponentElement, { NodeType } from './Component';
import Component from 'Common/Types/Workflow/Component';


export interface ComponentProps {
    componentsType: ComponentType;
    onCloseModal: () => void;
}

const ComponentsModal: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    // fetch all components. 
    return <Modal
        title={`Pick a ${props.componentsType}`}
        description={`Please select a component to add to your workflow.`}
        submitButtonText={'Close'}
        modalWidth={ModalWidth.Large}
        onSubmit={() => {
            props.onCloseModal();
        }}
        submitButtonStyleType={ButtonStyleType.NORMAL}>

        <>
            {!Components || Components.length === 0 && <p>No components to select from.</p>}

            <div className='flex h-96 overflow-scroll overflow-x-hidden p-5'>
                {Components && Components.length > 0 && Components.map((component: Component, i: number) => {
                    return (<ComponentElement key={i} data={{
                        title: component.title,
                        description: component.description,
                        nodeType: NodeType.Node,
                        componentType: component.componentType,
                        icon: component.iconProp,
                        nodeData: {},
                        id: component.id,

                    }} />)
                })}
            </div>
        </>

    </Modal>
};

export default ComponentsModal;
