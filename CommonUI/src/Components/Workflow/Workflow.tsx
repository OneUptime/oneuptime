import React, { FunctionComponent, useCallback } from 'react';
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
    updateEdge
} from 'reactflow';
// 👇 you need to import the reactflow styles
import 'reactflow/dist/style.css';
import { IconProp } from '../Icon/Icon';
import Node from './Node';
import AddNewNode from './AddNewNode';

const nodeTypes = {
    node: Node,
    addNewNode: AddNewNode
};


const edgeStyle = {
    strokeWidth: "2px",
    stroke: "#94a3b8",
    color: "#94a3b8",
}

const newNodeEdge = {
    strokeWidth: "2px",
    stroke: "#e2e8f0",
    color: "#e2e8f0",
    backgroundColor: "#e2e8f0",
}


const initialNodes = [
    { id: '1', type: 'node', position: { x: 100, y: 100 }, data: { id: 'slack-1', title: "Slack", description: "Open a channel", icon: IconProp.Add } },
    { id: '2', type: 'addNewNode', position: { x: 100, y: 500 }, data: { id: 'slack-2', title: "Slack", description: "Open a channel", icon: IconProp.Add } },
];

const initialEdges = [{
    id: 'e1-2', source: '1', target: '2', type: 'smoothstep', markerEnd: {
        type: MarkerType.Arrow, color: newNodeEdge.color
    },
    style: newNodeEdge,
}];

export interface ComponentProps {
    name: string;
}


const Workflow: FunctionComponent<ComponentProps> = (_props: ComponentProps) => {
    const [nodes, _setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
    const proOptions = { hideAttribution: true };
    const onConnect = useCallback((params: any) => setEdges((eds) => addEdge(params, eds)), [setEdges]);
    const onEdgeUpdate = useCallback(
        (oldEdge: Edge, newConnection: Connection) => setEdges((els) => updateEdge(oldEdge, newConnection, els)),
        []
    );


    return (
        <div className='h-[48rem]'>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                proOptions={proOptions}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onEdgeUpdate={onEdgeUpdate}
                nodeTypes={nodeTypes}
            >
                <MiniMap />
                <Controls />
                <Background />
            </ReactFlow>
        </div>

    );
}

export default Workflow; 