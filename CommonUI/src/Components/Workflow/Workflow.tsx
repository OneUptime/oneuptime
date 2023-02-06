import React, { FunctionComponent, useCallback, useRef } from 'react';
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
} from 'reactflow';
// 👇 you need to import the reactflow styles
import 'reactflow/dist/style.css';
import WorkflowComponent from './Component';
import AddNewComponent from './AddNewComponent';

const nodeTypes: NodeTypes = {
    node: WorkflowComponent,
    addNewNode: AddNewComponent,
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
}

const Workflow: FunctionComponent<ComponentProps> = (props: ComponentProps) => {
    const edgeUpdateSuccessful: any = useRef(true);

    const [nodes, _setNodes, onNodesChange] = useNodesState(props.initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(
        props.initialEdges.map((edge: Edge) => {
            // add style.

            let isDarkEdge: boolean = true;

            const node: Node | undefined = props.initialNodes.find(
                (node: Node) => {
                    return node.id === edge.target;
                }
            );

            if (node && node.type === 'addNewNode') {
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
                <Background />
            </ReactFlow>
        </div>
    );
};

export default Workflow;
