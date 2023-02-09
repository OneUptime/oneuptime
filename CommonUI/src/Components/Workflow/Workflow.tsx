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
import Component, { ComponentType } from 'Common/Types/Workflow/Component';
import ComponentsModal from './ComponentModal';


export const getPlaceholderTriggerNode: Function = (): Node => {
    return {
        id: ObjectID.generate().toString(),
        type: 'node',
        position: { x: 100, y: 100 },
        data: {
            icon: IconProp.Bolt,
            componentType: ComponentType.Trigger,
            nodeType: NodeType.PlaceholderNode,
            title: 'Trigger',
            description: 'Please click here to add trigger',
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

const newNodeEdgeStyle: React.CSSProperties = {
    strokeWidth: '2px',
    stroke: '#e2e8f0',
    color: '#e2e8f0',
    backgroundColor: '#e2e8f0',
};

export interface ComponentProps {
    initialNodes: Array<Node>;
    initialEdges: Array<Edge>;
    onWorkflowUpdated: (nodes: Array<Node>, edges: Array<Edge>) => void;
    showComponentsPickerModal: boolean;
    onComponentPickerModalUpdate: (isModalShown: boolean) => void;
}

const Workflow: FunctionComponent<ComponentProps> = (props: ComponentProps) => {
    const edgeUpdateSuccessful: any = useRef(true);

    const onNodeClick: Function = (data: NodeDataProp) => {
        // if placeholder node is clicked then show modal.

        if (data.nodeType === NodeType.PlaceholderNode) {
            showComponentsPickerModal(data.componentType);
        }
    };


    const showComponentsPickerModal: Function = (componentType: ComponentType) => {
        setShowComponentsType(componentType);
        setShowComponentsModal(true);
    }

    

    useEffect(()=>{
        if(props.showComponentsPickerModal){
            showComponentsPickerModal(ComponentType.Component);
        }else{
            setShowComponentsModal(false);
        }
    }, [props.showComponentsPickerModal])


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
            return nds.filter((node: Node) => {
                return node.data.id !== id;
            });
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
            node.data.onDeleteClick = deleteNode;
            node.data.onClick = onNodeClick;
            return node;
        })
    );

    const [edges, setEdges, onEdgesChange] = useEdgesState(
        props.initialEdges.map((edge: Edge) => {
            // add style.

            let isDarkEdge: boolean = true;

            const node: Node | undefined = props.initialNodes.find(
                (node: Node) => {
                    return node.id === edge.target;
                }
            );

            if (node && node.type === NodeType.PlaceholderNode) {
                isDarkEdge = false;
            }

            edge = {
                ...edge,
                type: 'smoothstep',
                markerEnd: {
                    type: MarkerType.Arrow,
                    color: isDarkEdge
                        ? edgeStyle.color?.toString() || ''
                        : newNodeEdgeStyle.color?.toString() || '',
                },
                style: isDarkEdge ? edgeStyle : newNodeEdgeStyle,
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
                return addEdge(params, eds);
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
                return updateEdge(oldEdge, newConnection, eds);
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

    useEffect(()=>{
        props.onComponentPickerModalUpdate(showComponentsModal);
    }, [showComponentsModal])

    const addToGraph: Function = (_component: Component) => {

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
                    onComponentClick={(component: Component) => {
                        setShowComponentsModal(false);

                        addToGraph(component);
                    }}
                />
            )}
        </div>
    );
};

export default Workflow;
