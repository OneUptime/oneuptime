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
import Node from './Node';


const nodeTypes = {
    node: Node,
};

const initialNodes = [
    { id: '1', type: 'node', position: { x: 0, y: 0 }, data: { label: '1' } },
    { id: '2', position: { x: 0, y: 500 }, data: { label: '2' } },
];

const initialEdges = [{
    id: 'e1-2', source: '1', target: '2', type: 'smoothstep', className: 'stroke-red-500', markerEnd: {
        type: MarkerType.ArrowClosed,
    },
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