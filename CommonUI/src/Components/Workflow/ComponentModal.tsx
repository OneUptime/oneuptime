// Show a large modal full of components.

import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import Component, {
    ComponentType,
    ComponentCategory,
} from 'Common/Types/Workflow/Component';
import Components, { Categories } from 'Common/Types/Workflow/Components';
import Modal, { ModalWidth } from '../Modal/Modal';
import { ButtonStyleType } from '../Button/Button';
import ComponentElement, { NodeType } from './Component';
import Input from '../Input/Input';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import Icon from '../Icon/Icon';

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
            Components.filter((component: Component) => {
                return component.componentType !== props.componentsType;
            })
        );
    }, []);

    useEffect(() => {
        if (!search) {
            setComponents(
                Components.filter((component: Component) => {
                    return component.componentType !== props.componentsType;
                })
            );
        }

        setComponents(
            Components.filter((component: Component) => {
                return (
                    component.componentType !== props.componentsType &&
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
                        onChange={(text: string) => {
                            setSearch(text);
                        }}
                    />
                </div>
            }
        >
            <>
                <div>
                    {/** Search box here */}

                    <div className="max-h-[60rem] overflow-y-auto overflow-x-hidden pb-10">
                        {!components ||
                            (components.length === 0 && (
                                <div className="w-full flex justify-center mt-20">
                                    <ErrorMessage error="No components that match your search. If you are looking for an intergration that does not exist currently - you can use Custom Code or API component to build anything you like. If you are an enterprise customer, feel free to talk to us and we will build it for you." />
                                </div>
                            ))}

                        {Categories &&
                            Categories.length > 0 &&
                            Categories.map(
                                (category: ComponentCategory, i: number) => {
                                    if (
                                        components &&
                                        components.length > 0 &&
                                        components.filter(
                                            (component: Component) => {
                                                return (
                                                    component.category ===
                                                    category.name
                                                );
                                            }
                                        ).length > 0
                                    ) {
                                        return (
                                            <div key={i}>
                                                <h4 className="text-gray-500 text-base mt-5 flex">
                                                    {' '}
                                                    <Icon
                                                        icon={category.icon}
                                                        className="h-5 w-5 text-gray-500"
                                                    />{' '}
                                                    <span className="ml-2">
                                                        {category.name}
                                                    </span>
                                                </h4>
                                                <p className="text-gray-400 text-sm mb-5">
                                                    {category.description}
                                                </p>
                                                <div className="flex flex-wrap">
                                                    {components &&
                                                        components.length > 0 &&
                                                        components
                                                            .filter(
                                                                (
                                                                    component: Component
                                                                ) => {
                                                                    return (
                                                                        component.category ===
                                                                        category.name
                                                                    );
                                                                }
                                                            )
                                                            .map(
                                                                (
                                                                    component: Component,
                                                                    i: number
                                                                ) => {
                                                                    return (
                                                                        <div
                                                                            key={
                                                                                i
                                                                            }
                                                                            className="m-5 ml-0 mt-0"
                                                                        >
                                                                            <ComponentElement
                                                                                key={
                                                                                    i
                                                                                }
                                                                                data={{
                                                                                    title: component.title,
                                                                                    description:
                                                                                        component.description,
                                                                                    nodeType:
                                                                                        NodeType.Node,
                                                                                    componentType:
                                                                                        component.componentType,
                                                                                    nodeData:
                                                                                        {},
                                                                                    id: component.id,
                                                                                    isPreview:
                                                                                        true,
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    );
                                                                }
                                                            )}
                                                </div>
                                            </div>
                                        );
                                    }
                                    return <></>;
                                }
                            )}
                    </div>
                </div>
            </>
        </Modal>
    );
};

export default ComponentsModal;
