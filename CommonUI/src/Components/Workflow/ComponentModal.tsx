// Show a large modal full of components.

import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import { ComponentType } from 'Common/Types/Workflow/Component';
import Components from 'Common/Types/Workflow/Components';
import Modal, { ModalWidth } from '../Modal/Modal';
import { ButtonStyleType } from '../Button/Button';
import ComponentElement, { NodeType } from './Component';
import Component from 'Common/Types/Workflow/Component';
import Input from '../Input/Input';

export interface ComponentProps {
    componentsType: ComponentType;
    onCloseModal: () => void;
}

const ComponentsModal: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [search, setSearch] = useState<string>('');

    const [components, setComponents] = useState<Array<Component>>([]);

    useEffect(() => {
        setComponents(
            Components.filter((component) => {
                return component.componentType === props.componentsType;
            })
        );
    }, []);

    useEffect(() => {
        if (!search) {
            setComponents(
                Components.filter((component) => {
                    return component.componentType === props.componentsType;
                })
            );
        }

        setComponents(
            Components.filter((component) => {
                return (
                    component.componentType === props.componentsType &&
                    (component.title
                        .toLowerCase()
                        .includes(search.trim().toLowerCase()) ||
                        component.description
                            .toLowerCase()
                            .includes(search.trim().toLowerCase()) ||
                        component.category
                            .toLowerCase()
                            .includes(search.trim().toLowerCase()))
                );
            })
        );
    }, [search]);

    return (
        <Modal
            title={`Pick a ${props.componentsType}`}
            description={`Please select a component to add to your workflow.`}
            submitButtonText={'Close'}
            modalWidth={ModalWidth.Large}
            onSubmit={() => {
                props.onCloseModal();
            }}
            submitButtonStyleType={ButtonStyleType.NORMAL}
            rightElement={
                <div>
                    <Input
                        placeholder="Search..."
                        onChange={(text) => {
                            setSearch(text);
                        }}
                    />
                </div>
            }
        >
            <>
                <div>
                    {/** Search box here */}

                    <div className="flex flex-wrap h-[60rem] overflow-y-auto overflow-x-hidden pt-10 pb-10">
                        {!components ||
                            (components.length === 0 && (
                                <p className="text-sm text-gray-400">
                                    No components that match your search.
                                </p>
                            ))}
                        {components &&
                            components.length > 0 &&
                            components.map(
                                (component: Component, i: number) => {
                                    return (
                                        <div className="m-5">
                                            <ComponentElement
                                                key={i}
                                                data={{
                                                    title: component.title,
                                                    description:
                                                        component.description,
                                                    nodeType: NodeType.Node,
                                                    componentType:
                                                        component.componentType,
                                                    icon: component.iconProp,
                                                    nodeData: {},
                                                    id: component.id,
                                                    isPreview: true,
                                                }}
                                            />
                                        </div>
                                    );
                                }
                            )}
                    </div>
                </div>
            </>
        </Modal>
    );
};

export default ComponentsModal;
