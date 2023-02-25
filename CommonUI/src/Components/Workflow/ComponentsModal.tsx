// Show a large modal full of components.

import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import ComponentMetadata, {
    ComponentType,
    ComponentCategory,
    NodeType,
} from 'Common/Types/Workflow/Component';
import ComponentElement from './Component';
import Input from '../Input/Input';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import Icon from '../Icon/Icon';
import SideOver from '../SideOver/SideOver';

export interface ComponentProps {
    componentsType: ComponentType;
    onCloseModal: () => void;
    onComponentClick: (componentMetadata: ComponentMetadata) => void;
    components: Array<ComponentMetadata>;
    categories: Array<ComponentCategory>;
}

const ComponentsModal: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [search, setSearch] = useState<string>('');

    const [components, setComponents] = useState<Array<ComponentMetadata>>([]);
    const [categories, setCategories] = useState<Array<ComponentCategory>>([]);

    const [componentsToShow, setComponentsToShow] = useState<
        Array<ComponentMetadata>
    >([]);

    const [isSearching, setIsSearching] = useState<boolean>(false);

    useEffect(() => {
        setComponents(props.components);

        setComponentsToShow([...props.components]);

        setCategories(props.categories);
    }, []);

    useEffect(() => {
        if (!isSearching) {
            return;
        }
        if (!search) {
            setComponentsToShow([
                ...components.filter((componentMetadata: ComponentMetadata) => {
                    return (
                        componentMetadata.componentType === props.componentsType
                    );
                }),
            ]);
        }

        setComponentsToShow([
            ...components.filter((componentMetadata: ComponentMetadata) => {
                return (
                    componentMetadata.componentType === props.componentsType &&
                    (componentMetadata.title
                        .toLowerCase()
                        .includes(search.trim().toLowerCase()) ||
                        componentMetadata.description
                            .toLowerCase()
                            .includes(search.trim().toLowerCase()) ||
                        componentMetadata.category
                            .toLowerCase()
                            .includes(search.trim().toLowerCase()))
                );
            }),
        ]);
    }, [search]);

    const [selectedComponentMetadata, setSelectedComponentMetadata] =
        useState<ComponentMetadata | null>(null);

    return (
        <SideOver
            submitButtonText="Create"
            title={`Select a ${props.componentsType}`}
            description={`Please select a component to add to your workflow.`}
            onClose={props.onCloseModal}
            submitButtonDisabled={!selectedComponentMetadata}
            onSubmit={() => {
                return (
                    selectedComponentMetadata &&
                    props.onComponentClick(selectedComponentMetadata)
                );
            }}
        >
            <>
                <div>
                    {/** Search box here */}

                    <div className="mt-5">
                        <Input
                            placeholder="Search..."
                            onChange={(text: string) => {
                                setIsSearching(true);
                                setSearch(text);
                            }}
                        />
                    </div>

                    <div className="max-h-[60rem] overflow-y-auto overflow-x-hidden pb-10 mt-5">
                        {!componentsToShow ||
                            (componentsToShow.length === 0 && (
                                <div className="w-full flex justify-center mt-20">
                                    <ErrorMessage error="No components that match your search. If you are looking for an intergration that does not exist currently - you can use Custom Code or API component to build anything you like. If you are an enterprise customer, feel free to talk to us and we will build it for you." />
                                </div>
                            ))}

                        {categories &&
                            categories.length > 0 &&
                            categories.map(
                                (category: ComponentCategory, i: number) => {
                                    if (
                                        componentsToShow &&
                                        componentsToShow.length > 0 &&
                                        componentsToShow.filter(
                                            (
                                                componentMetadata: ComponentMetadata
                                            ) => {
                                                return (
                                                    componentMetadata.category ===
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
                                                <div className="flex flex-wrap ml-2">
                                                    {components &&
                                                        components.length > 0 &&
                                                        components
                                                            .filter(
                                                                (
                                                                    componentMetadata: ComponentMetadata
                                                                ) => {
                                                                    return (
                                                                        componentMetadata.category ===
                                                                        category.name
                                                                    );
                                                                }
                                                            )
                                                            .map(
                                                                (
                                                                    componentMetadata: ComponentMetadata,
                                                                    i: number
                                                                ) => {
                                                                    return (
                                                                        <div
                                                                            key={
                                                                                i
                                                                            }
                                                                            onClick={() => {
                                                                                setSelectedComponentMetadata(
                                                                                    componentMetadata
                                                                                );
                                                                            }}
                                                                            className={`m-5 ml-0 mt-0 ${
                                                                                selectedComponentMetadata &&
                                                                                selectedComponentMetadata.id ===
                                                                                    componentMetadata.id
                                                                                    ? 'rounded ring-offset-2 ring ring-indigo-500'
                                                                                    : ''
                                                                            }`}
                                                                        >
                                                                            <ComponentElement
                                                                                key={
                                                                                    i
                                                                                }
                                                                                selected={
                                                                                    false
                                                                                }
                                                                                data={{
                                                                                    metadata:
                                                                                        componentMetadata,
                                                                                    metadataId:
                                                                                        componentMetadata.id,
                                                                                    internalId:
                                                                                        '',
                                                                                    nodeType:
                                                                                        NodeType.Node,
                                                                                    componentType:
                                                                                        componentMetadata.componentType,
                                                                                    returnValues:
                                                                                        {},
                                                                                    isPreview:
                                                                                        true,
                                                                                    id: '',
                                                                                    error: '',
                                                                                    arguments:
                                                                                        {},
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
                                    return <div key={i}></div>;
                                }
                            )}
                    </div>
                </div>
            </>
        </SideOver>
    );
};

export default ComponentsModal;
