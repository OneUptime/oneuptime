import React, {
    FunctionComponent,
    useCallback,
    useRef,
    useEffect,
    useState,
} from 'react';
import ReactFlow, {
    MiniMap,
    Controls,
    Background,
    useNodesState,
    useEdgesState,
    addEdge,
    MarkerType,
    Edge,
    Connection,
    updateEdge,
    Node,
    ProOptions,
    NodeTypes,
    OnConnect,
    getConnectedEdges,
} from 'reactflow';
// 👇 you need to import the reactflow styles
import 'reactflow/dist/style.css';
import WorkflowComponent, { NodeDataProp, NodeType } from './Component';
import ObjectID from 'Common/Types/ObjectID';
import IconProp from 'Common/Types/Icon/IconProp';
import ComponentMetadata, {
    ComponentCategory,
    ComponentType,
} from 'Common/Types/Workflow/Component';
import ComponentsModal from './ComponentModal';
import { JSONObject } from 'Common/Types/JSON';
import ComponentSettingsModal from './ComponentSettingsModal';
import { loadComponentsAndCategories } from './Utils';

export const getPlaceholderTriggerNode: Function = (): Node => {
    return {
        id: ObjectID.generate().toString(),
        type: 'node',
        position: { x: 100, y: 100 },
        data: {
            metadata: {
                iconProp: IconProp.Bolt,
                componentType: ComponentType.Trigger,
                title: 'Trigger',
                description: 'Please click here to add trigger',
            },
            metadataId: '',
            internalId: '',
            nodeType: NodeType.PlaceholderNode,
            id: '',
            error: '',
        },
    };
};

const nodeTypes: NodeTypes = {
    node: WorkflowComponent,
};

const edgeStyle: React.CSSProperties = {
    strokeWidth: '2px',
    stroke: '#94a3b8',
    color: '#94a3b8',
};

export const getEdgeDefaultProps: Function = (): JSONObject => {
    return {
        type: 'smoothstep',
        markerEnd: {
            type: MarkerType.Arrow,
            color: edgeStyle.color?.toString() || '',
        },
        style: edgeStyle,
    };
};

export interface ComponentProps {
    initialNodes: Array<Node>;
    initialEdges: Array<Edge>;
    onWorkflowUpdated: (nodes: Array<Node>, edges: Array<Edge>) => void;
    showComponentsPickerModal: boolean;
    onComponentPickerModalUpdate: (isModalShown: boolean) => void;
    workflowId: ObjectID;
}

const Workflow: FunctionComponent<ComponentProps> = (props: ComponentProps) => {
    const [allComponentMetadata, setAllComponentMetadata] = useState<
        Array<ComponentMetadata>
    >([]);
    const [allComponentCategories, setAllComponentCategories] = useState<
        Array<ComponentCategory>
    >([]);

    useEffect(() => {
        const value: {
            components: Array<ComponentMetadata>;
            categories: Array<ComponentCategory>;
        } = loadComponentsAndCategories();

        setAllComponentCategories(value.categories);
        setAllComponentMetadata(value.components);
    }, []);

    const edgeUpdateSuccessful: any = useRef(true);
    const [showComponentSettingsModal, setshowComponentSettingsModal] =
        useState<boolean>(false);
    const [selectedNodeData, setSeletedNodeData] =
        useState<NodeDataProp | null>(null);

    const onNodeClick: Function = (data: NodeDataProp) => {
        // if placeholder node is clicked then show modal.

        if (data.nodeType === NodeType.PlaceholderNode) {
            showComponentsPickerModal(data.metadata.componentType);
        } else {
            setshowComponentSettingsModal(true);
            setSeletedNodeData(data);
        }
    };

    const showComponentsPickerModal: Function = (
        componentType: ComponentType
    ) => {
        setShowComponentsType(componentType);
        setShowComponentsModal(true);
    };

    useEffect(() => {
        if (props.showComponentsPickerModal) {
            showComponentsPickerModal(ComponentType.Component);
        } else {
            setShowComponentsModal(false);
        }
    }, [props.showComponentsPickerModal]);

    const deleteNode: Function = (id: string): void => {
        // remove the node.

        const nodesToDelete: Array<Node> = [...nodes].filter((node: Node) => {
            return node.data.id === id;
        });
        const edgeToDelete: Array<Edge> = getConnectedEdges(
            nodesToDelete,
            edges
        );

        setNodes((nds: Array<Node>) => {
            let nodeToUpdate: Array<Node> = nds.filter((node: Node) => {
                return node.data.id !== id;
            });

            if (nodeToUpdate.length === 0) {
                nodeToUpdate = nodeToUpdate.concat(getPlaceholderTriggerNode());
            }

            return nodeToUpdate;
        });

        setEdges((eds: Array<Edge>) => {
            return eds.filter((edge: Edge) => {
                const idsToDelete: Array<string> = edgeToDelete.map(
                    (e: Edge) => {
                        return e.id;
                    }
                );
                return !idsToDelete.includes(edge.id);
            });
        });
    };

    const [nodes, setNodes, onNodesChange] = useNodesState(
        props.initialNodes.map((node: Node) => {
            node.data.onClick = onNodeClick;
            return node;
        })
    );

    const [edges, setEdges, onEdgesChange] = useEdgesState(
        props.initialEdges.map((edge: Edge) => {
            // add style.

            edge = {
                ...edge,
                ...getEdgeDefaultProps(),
            };
            return edge;
        })
    );

    useEffect(() => {
        if (props.onWorkflowUpdated) {
            props.onWorkflowUpdated(nodes, edges);
        }
    }, [nodes, edges]);

    const proOptions: ProOptions = { hideAttribution: true };

    const onConnect: OnConnect = useCallback(
        (params: any) => {
            return setEdges((eds: Array<Edge>) => {
                return addEdge(
                    {
                        ...params,
                        ...getEdgeDefaultProps(),
                    },
                    eds
                );
            });
        },
        [setEdges]
    );

    const onEdgeUpdateStart: any = useCallback(() => {
        edgeUpdateSuccessful.current = false;
    }, []);

    const onEdgeUpdate: any = useCallback(
        (oldEdge: Edge, newConnection: Connection) => {
            edgeUpdateSuccessful.current = true;
            setEdges((eds: Array<Edge>) => {
                return updateEdge(
                    {
                        ...oldEdge,
                        markerEnd: {
                            type: MarkerType.Arrow,
                            color: edgeStyle.color?.toString() || '',
                        },
                        style: edgeStyle,
                    },
                    newConnection,
                    eds
                );
            });
        },
        []
    );

    const onEdgeUpdateEnd: any = useCallback((_props: any, edge: Edge) => {
        if (!edgeUpdateSuccessful.current) {
            setEdges((eds: Array<Edge>) => {
                return eds.filter((e: Edge) => {
                    return e.id !== edge.id;
                });
            });
        }

        edgeUpdateSuccessful.current = true;
    }, []);

    const [showComponentsModal, setShowComponentsModal] =
        useState<boolean>(false);

    const [showComponentType, setShowComponentsType] = useState<ComponentType>(
        ComponentType.Component
    );

    useEffect(() => {
        props.onComponentPickerModalUpdate(showComponentsModal);
    }, [showComponentsModal]);

    const addToGraph: Function = (componentMetadata: ComponentMetadata) => {
        const metaDataId: string = componentMetadata.id;

        let hasFoundExistingId: boolean = true;
        let idCounter: number = 1;
        while (hasFoundExistingId) {
            const id: string = `${metaDataId}-${idCounter}`;

            const exitingNode: Node | undefined = nodes.find((i: Node) => {
                return i.data.id === id;
            });

            if (!exitingNode) {
                hasFoundExistingId = false;
                break;
            }

            idCounter++;
        }

        const compToAdd: Node = {
            id: ObjectID.generate().toString(), // react-flow id
            type: 'node',
            position: { x: 200, y: 200 },
            data: {
                id: `${metaDataId}-${idCounter}`,
                error: '',
                metadata: { ...componentMetadata },
                metadataId: componentMetadata.id,
                internalId: ObjectID.generate().toString(), // runner id
            },
        };

        if (componentMetadata.componentType === ComponentType.Trigger) {
            // remove the placeholder trigger element from graph.
            setNodes((nds: Array<Node>) => {
                return nds
                    .filter((node: Node) => {
                        return (
                            node.data.componentType === ComponentType.Component
                        );
                    })
                    .concat(compToAdd);
            });
        } else {
            setNodes((nds: Array<Node>) => {
                return nds.concat(compToAdd);
            });
        }
    };

    return (
        <div className="h-[48rem]">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                proOptions={proOptions}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onEdgeUpdate={onEdgeUpdate}
                nodeTypes={nodeTypes}
                onEdgeUpdateStart={onEdgeUpdateStart}
                onEdgeUpdateEnd={onEdgeUpdateEnd}
            >
                <MiniMap />
                <Controls />
                <Background color="#111827" />
            </ReactFlow>

            {showComponentsModal && (
                <ComponentsModal
                    componentsType={showComponentType}
                    onCloseModal={() => {
                        setShowComponentsModal(false);
                    }}
                    categories={allComponentCategories}
                    components={allComponentMetadata.filter(
                        (comp: ComponentMetadata) => {
                            return comp.componentType === showComponentType;
                        }
                    )}
                    onComponentClick={(component: ComponentMetadata) => {
                        setShowComponentsModal(false);

                        addToGraph(component);
                    }}
                />
            )}

            {showComponentSettingsModal && selectedNodeData && (
                <ComponentSettingsModal
                    graphComponents={nodes.map((node: Node) => {
                        return node.data as NodeDataProp;
                    })}
                    workflowId={props.workflowId}
                    component={selectedNodeData}
                    title={
                        selectedNodeData && selectedNodeData.metadata.title
                            ? selectedNodeData.metadata.title
                            : 'Component Properties'
                    }
                    onDelete={(component: NodeDataProp) => {
                        deleteNode(component.id);
                    }}
                    description={
                        selectedNodeData &&
                        selectedNodeData.metadata.description
                            ? selectedNodeData.metadata.description
                            : 'Edit Component Properties and variables here.'
                    }
                    onClose={() => {
                        setshowComponentSettingsModal(false);
                    }}
                    onSave={(componentData: NodeDataProp) => {
                        // Update the node.

                        setNodes((nds: Array<Node>) => {
                            return nds.map((n: Node) => {
                                if (
                                    n.data.internalId ===
                                    componentData.internalId
                                ) {
                                    n.data = componentData;
                                }

                                return n;
                            });
                        });

                        setshowComponentSettingsModal(false);
                    }}
                />
            )}
        </div>
    );
};

export default Workflow;
