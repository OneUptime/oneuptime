import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import Workflow, {
    getEdgeDefaultProps,
    getPlaceholderTriggerNode,
} from 'CommonUI/src/Components/Workflow/Workflow';
import Card from 'CommonUI/src/Components/Card/Card';
import { Edge, Node } from 'reactflow';
import { JSONObject } from 'Common/Types/JSON';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import WorkflowModel from 'Model/Models/Workflow';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import Button, { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import ComponentLoader from 'CommonUI/src/Components/ComponentLoader/ComponentLoader';
import IconProp from 'Common/Types/Icon/IconProp';
import { loadComponentsAndCategories } from 'CommonUI/src/Components/Workflow/Utils';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ComponentMetadata, {
    NodeDataProp,
    NodeType,
    ComponentCategory,
} from 'Common/Types/Workflow/Component';

const Delete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [saveStatus, setSaveStatus] = useState<string>('');
    const [saveTimeout, setSaveTimeout] = useState<ReturnType<
        typeof setTimeout
    > | null>(null);
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
    const [nodes, setNodes] = useState<Array<Node>>([]);
    const [edges, setEdges] = useState<Array<Edge>>([]);
    const [error, setError] = useState<string>('');

    const [showComponentPickerModal, setShowComponentPickerModal] =
        useState<boolean>(false);

    const [showRunModal, setShowRunModal] = useState<boolean>(false);

    const loadGraph: Function = async (): Promise<void> => {
        try {
            setIsLoading(true);
            const workflow: WorkflowModel | null = await ModelAPI.getItem(
                WorkflowModel,
                modelId,
                {
                    graph: true,
                },
                {}
            );

            if (workflow) {
                const allComponents: {
                    components: Array<ComponentMetadata>;
                    categories: Array<ComponentCategory>;
                } = loadComponentsAndCategories();

                if (workflow.graph && (workflow.graph as JSONObject)['nodes']) {
                    if (
                        ((workflow.graph as JSONObject)['nodes'] as Array<Node>)
                            .length === 0
                    ) {
                        // add a placeholder trigger node.
                        setNodes([getPlaceholderTriggerNode()]);
                    } else {
                        const nodes: Array<Node> = (
                            workflow.graph as JSONObject
                        )['nodes'] as Array<Node>;

                        // Fill nodes.

                        for (let i: number = 0; i < nodes.length; i++) {
                            if (!nodes[i]) {
                                continue;
                            }

                            if (
                                nodes[i]?.data.nodeType ===
                                NodeType.PlaceholderNode
                            ) {
                                nodes[i] = {
                                    ...nodes[i],
                                    ...getPlaceholderTriggerNode(),
                                };
                                continue;
                            }

                            const componentMetdata:
                                | ComponentMetadata
                                | undefined = allComponents.components.find(
                                (component: ComponentMetadata) => {
                                    return (
                                        component.id ===
                                        nodes[i]?.data.metadataId
                                    );
                                }
                            );

                            if (!componentMetdata) {
                                throw new BadDataException(
                                    'Component Metadata not found for node ' +
                                        nodes[i]?.data.metadataId
                                );
                            }

                            nodes[i]!.data.metadata = {
                                ...componentMetdata,
                            };
                        }

                        setNodes(nodes);
                    }
                } else {
                    // add a placeholder trigger node.
                    setNodes([getPlaceholderTriggerNode()]);
                }

                if (workflow.graph && (workflow.graph as JSONObject)['edges']) {
                    const edges: Array<Edge> = (workflow.graph as JSONObject)[
                        'edges'
                    ] as Array<Edge>;

                    for (let i: number = 0; i < edges.length; i++) {
                        if (!edges[i]) {
                            continue;
                        }

                        edges[i] = {
                            ...edges[i],
                            ...getEdgeDefaultProps(),
                        };
                    }

                    setEdges(edges);
                } else {
                    setEdges([]);
                }
            } else {
                setError('Workflow not found');
            }
        } catch (err) {
            try {
                setError(
                    (err as HTTPErrorResponse).message ||
                        'Server Error. Please try again'
                );
            } catch (e) {
                setError('Server Error. Please try again');
            }
        }

        setIsLoading(false);
    };

    const saveGraph: Function = async (
        nodes: Array<Node>,
        edges: Array<Edge>
    ): Promise<void> => {
        setSaveStatus('Saving...');

        if (saveTimeout) {
            clearTimeout(saveTimeout);
            setSaveTimeout(null);
        }

        setSaveTimeout(
            setTimeout(async () => {
                try {
                    const graph: JSONObject = JSON.parse(
                        JSON.stringify({ nodes, edges })
                    ); // deep copy

                    // clean up.

                    if (graph['nodes']) {
                        for (
                            let i: number = 0;
                            i < (graph['nodes'] as Array<Node>).length;
                            i++
                        ) {
                            (graph['nodes'] as Array<Node>)[i] = {
                                ...((graph['nodes'] as Array<Node>)[i] as Node),
                            };

                            delete ((graph['nodes'] as Array<Node>)[i] as Node)
                                .data.metadata;
                        }
                    }

                    if (graph['edges']) {
                        for (
                            let i: number = 0;
                            i < (graph['edges'] as Array<Edge>).length;
                            i++
                        ) {
                            (graph['edges'] as Array<Edge>)[i] = {
                                ...((graph['edges'] as Array<Edge>)[i] as Edge),
                            };

                            delete ((graph['edges'] as Array<Edge>)[i] as Edge)
                                .type;
                            delete ((graph['edges'] as Array<Edge>)[i] as Edge)
                                .style;
                            delete ((graph['edges'] as Array<Edge>)[i] as Edge)
                                .markerEnd;
                        }
                    }

                    await ModelAPI.updateById(WorkflowModel, modelId, {
                        graph,
                    });

                    setSaveStatus('Changes Saved.');
                } catch (err) {
                    try {
                        setError(
                            (err as HTTPErrorResponse).message ||
                                'Server Error. Please try again'
                        );
                    } catch (e) {
                        setError('Server Error. Please try again');
                    }

                    setSaveStatus('Save Error.');
                }

                if (saveTimeout) {
                    clearTimeout(saveTimeout);
                    setSaveTimeout(null);
                }
            }, 1000)
        );
    };

    useEffect(() => {
        loadGraph().catch();
    }, []);

    return (
        <Page
            title={'Workflow'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Workflows',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOWS] as Route,
                        modelId
                    ),
                },
                {
                    title: 'View Workflow',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOW_VIEW] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Builder',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOW_BUILDER] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <>
                <Card
                    title={'Workflow Builder'}
                    description={'Workflow builder for OneUptime'}
                    rightElement={
                        <div className="flex">
                            <p className="text-sm text-gray-400 mr-3 mt-2">
                                {saveStatus}
                            </p>
                            <div>
                                <Button
                                    title="Add Component"
                                    icon={IconProp.Add}
                                    onClick={() => {
                                        setShowComponentPickerModal(true);
                                    }}
                                />
                            </div>
                            <div>
                                <Button
                                    title="Run Wrokflow"
                                    icon={IconProp.Play}
                                    onClick={() => {
                                        setShowRunModal(true);
                                    }}
                                />
                            </div>
                        </div>
                    }
                >
                    {isLoading ? <ComponentLoader /> : <></>}

                    {!isLoading ? (
                        <Workflow
                            workflowId={modelId}
                            showComponentsPickerModal={showComponentPickerModal}
                            onComponentPickerModalUpdate={(value: boolean) => {
                                setShowComponentPickerModal(value);
                            }}
                            initialNodes={nodes}
                            onRunModalUpdate={(value: boolean) => {
                                setShowRunModal(value);
                            }}
                            showRunModal={showRunModal}
                            initialEdges={edges}
                            onWorkflowUpdated={async (
                                nodes: Array<Node>,
                                edges: Array<Edge>
                            ) => {
                                setNodes(nodes);
                                setEdges(edges);
                                await saveGraph(nodes, edges);
                            }}
                            onRun={(_component: NodeDataProp) => {}}
                        />
                    ) : (
                        <></>
                    )}
                </Card>
                {error && (
                    <ConfirmModal
                        title={`Error`}
                        description={`${error}`}
                        submitButtonText={'Close'}
                        onSubmit={() => {
                            setError('');
                        }}
                        submitButtonType={ButtonStyleType.NORMAL}
                    />
                )}
            </>
        </Page>
    );
};

export default Delete;
