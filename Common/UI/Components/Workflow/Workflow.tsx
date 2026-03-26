import WorkflowComponent from "./Component";
import ComponentSettingsModal from "./ComponentSettingsModal";
import ComponentsModal from "./ComponentsModal";
import RunModal from "./RunModal";
import { loadComponentsAndCategories } from "./Utils";
import { VoidFunction } from "../../../Types/FunctionTypes";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ComponentMetadata, {
  ComponentCategory,
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../../Types/Workflow/Component";
import React, {
  FunctionComponent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Connection,
  Controls,
  Edge,
  MarkerType,
  MiniMap,
  Node,
  NodeTypes,
  OnConnect,
  ProOptions,
  addEdge,
  getConnectedEdges,
  updateEdge,
  useEdgesState,
  useNodesState,
} from "reactflow";
// 👇 you need to import the reactflow styles
import "reactflow/dist/style.css";

type GetPlaceholderTriggerNodeFunction = () => Node;

export const getPlaceholderTriggerNode: GetPlaceholderTriggerNodeFunction =
  (): Node => {
    return {
      id: ObjectID.generate().toString(),
      type: "node",
      position: { x: 100, y: 100 },
      data: {
        metadata: {
          iconProp: IconProp.Bolt,
          componentType: ComponentType.Trigger,
          title: "Trigger",
          description: "Please click here to add trigger",
        },
        metadataId: "",
        internalId: "",
        nodeType: NodeType.PlaceholderNode,
        id: "",
        error: "",
      },
    };
  };

const nodeTypes: NodeTypes = {
  node: WorkflowComponent,
};

const edgeStyle: React.CSSProperties = {
  strokeWidth: "2px",
  stroke: "#94a3b8",
  color: "#94a3b8",
};

const selectedEdgeStyle: React.CSSProperties = {
  strokeWidth: "2.5px",
  stroke: "#6366f1",
  color: "#6366f1",
};

type GetEdgeDefaultPropsFunction = (selected: boolean) => JSONObject;

export const getEdgeDefaultProps: GetEdgeDefaultPropsFunction = (
  selected: boolean,
): JSONObject => {
  return {
    type: "smoothstep",
    animated: selected,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: selected
        ? selectedEdgeStyle.color?.toString() || ""
        : edgeStyle.color?.toString() || "",
      width: 20,
      height: 20,
    },
    style: selected ? { ...selectedEdgeStyle } : { ...edgeStyle },
  };
};

export interface ComponentProps {
  initialNodes: Array<Node>;
  initialEdges: Array<Edge>;
  onWorkflowUpdated: (nodes: Array<Node>, edges: Array<Edge>) => void;
  showComponentsPickerModal: boolean;
  showRunModal: boolean;
  onComponentPickerModalUpdate: (isModalShown: boolean) => void;
  workflowId: ObjectID;
  onRunModalUpdate: (isModalShown: boolean) => void;
  onRun: (trigger: NodeDataProp) => void;
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
  const [showComponentSettingsModal, setShowComponentSettingsModal] =
    useState<boolean>(false);
  const [selectedNodeData, setSelectedNodeData] = useState<NodeDataProp | null>(
    null,
  );

  type OnNodeClickFunction = (data: NodeDataProp) => void;

  const onNodeClick: OnNodeClickFunction = (data: NodeDataProp) => {
    // if placeholder node is clicked then show modal.

    if (data.nodeType === NodeType.PlaceholderNode) {
      if (data.componentType === ComponentType.Component) {
        setShowComponentsModal(true);
      } else {
        setShowTriggersModal(true);
      }
    } else {
      setShowComponentSettingsModal(true);
      setSelectedNodeData(data);
    }
  };

  useEffect(() => {
    if (props.showComponentsPickerModal) {
      setShowComponentsModal(true);
    } else {
      setShowComponentsModal(false);
    }
  }, [props.showComponentsPickerModal]);

  useEffect(() => {
    if (props.showRunModal) {
      setShowRunModal(true);
    } else {
      setShowComponentsModal(false);
    }
  }, [props.showRunModal]);

  type DeleteNodeFunction = (id: string) => void;

  const deleteNode: DeleteNodeFunction = (id: string): void => {
    // remove the node.

    const nodesToDelete: Array<Node> = [...nodes].filter((node: Node) => {
      return node.data.id === id;
    });
    const edgeToDelete: Array<Edge> = getConnectedEdges(nodesToDelete, edges);

    setNodes((nds: Array<Node>) => {
      let nodeToUpdate: Array<Node> = nds.filter((node: Node) => {
        return node.data.id !== id;
      });

      if (
        nodeToUpdate.filter((n: Node) => {
          return (
            (n.data as NodeDataProp).componentType === ComponentType.Trigger &&
            (n.data as NodeDataProp).nodeType === NodeType.Node
          );
        }).length === 0
      ) {
        nodeToUpdate = nodeToUpdate.concat(getPlaceholderTriggerNode());
      }

      return nodeToUpdate;
    });

    setEdges((eds: Array<Edge>) => {
      return eds
        .filter((edge: Edge) => {
          const idsToDelete: Array<string> = edgeToDelete.map((e: Edge) => {
            return e.id;
          });
          return !idsToDelete.includes(edge.id);
        })
        .map((edge: Edge) => {
          return {
            ...edge,
            ...getEdgeDefaultProps(edge.selected || false),
          };
        });
    });
  };

  const [nodes, setNodes, onNodesChange] = useNodesState(
    props.initialNodes.map((node: Node) => {
      node.data.onClick = onNodeClick;
      return node;
    }),
  );

  const [edges, setEdges, onEdgesChange] = useEdgesState(
    props.initialEdges.map((edge: Edge) => {
      // add style.

      edge = {
        ...edge,
        ...getEdgeDefaultProps(edge.selected || false),
      };

      return edge;
    }),
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
            ...getEdgeDefaultProps(params.selected),
          },
          eds.map((edge: Edge) => {
            return {
              ...edge,
              ...getEdgeDefaultProps(edge.selected || false),
            };
          }),
        );
      });
    },
    [setEdges],
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
              type: MarkerType.ArrowClosed,
              color: edgeStyle.color?.toString() || "",
            },
            style: edgeStyle,
          },
          newConnection,
          eds.map((edge: Edge) => {
            return {
              ...edge,
              ...getEdgeDefaultProps(edge.selected || false),
            };
          }),
        );
      });
    },
    [],
  );

  const onEdgeUpdateEnd: any = useCallback((_props: any, edge: Edge) => {
    if (!edgeUpdateSuccessful.current) {
      setEdges((eds: Array<Edge>) => {
        return eds
          .filter((e: Edge) => {
            return e.id !== edge.id;
          })
          .map((edge: Edge) => {
            return {
              ...edge,
              ...getEdgeDefaultProps(edge.selected || false),
            };
          });
      });
    }

    edgeUpdateSuccessful.current = true;
  }, []);

  const [showComponentsModal, setShowComponentsModal] =
    useState<boolean>(false);

  const [showTriggersModal, setShowTriggersModal] = useState<boolean>(false);

  const [showRunModal, setShowRunModal] = useState<boolean>(false);

  useEffect(() => {
    props.onComponentPickerModalUpdate(showComponentsModal);
  }, [showComponentsModal]);

  const refreshEdges: VoidFunction = (): void => {
    setEdges((eds: Array<Edge>) => {
      return eds.map((edge: Edge) => {
        return {
          ...edge,
          ...getEdgeDefaultProps(edge.selected || false),
        };
      });
    });
  };

  useEffect(() => {
    props.onRunModalUpdate(showRunModal);
  }, [showRunModal]);

  type AddToGraphFunction = (componentMetadata: ComponentMetadata) => void;

  const addToGraph: AddToGraphFunction = (
    componentMetadata: ComponentMetadata,
  ) => {
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
      type: "node",
      position: { x: 200, y: 200 },
      selected: true,
      data: {
        nodeType: NodeType.Node,
        id: `${metaDataId}-${idCounter}`,
        error: "",
        metadata: { ...componentMetadata },
        metadataId: componentMetadata.id,
        internalId: ObjectID.generate().toString(), // runner id
        componentType: componentMetadata.componentType,
      } as NodeDataProp,
    };

    if (componentMetadata.componentType === ComponentType.Trigger) {
      // remove the placeholder trigger element from graph.
      setNodes((nds: Array<Node>) => {
        return nds
          .filter((node: Node) => {
            return node.data.componentType === ComponentType.Component;
          })
          .map((n: Node) => {
            return { ...n, selected: false };
          })
          .concat({ ...compToAdd } as any);
      });
    } else {
      setNodes((nds: Array<Node>) => {
        return nds
          .map((n: Node) => {
            return { ...n, selected: false };
          })
          .concat({ ...compToAdd } as any);
      });
    }
  };

  return (
    <div
      style={{
        height: "calc(100vh - 220px)",
        minHeight: "600px",
        borderRadius: "8px",
        overflow: "hidden",
        border: "1px solid #e2e8f0",
      }}
    >
      <style>
        {`
          .react-flow__minimap {
            border-radius: 8px !important;
            border: 1px solid #e2e8f0 !important;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.07) !important;
            overflow: hidden !important;
            background: #ffffff !important;
          }
          .react-flow__controls {
            border-radius: 8px !important;
            border: 1px solid #e2e8f0 !important;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.07) !important;
            overflow: hidden !important;
          }
          .react-flow__controls-button {
            border-bottom: 1px solid #f1f5f9 !important;
            width: 32px !important;
            height: 32px !important;
          }
          .react-flow__controls-button:hover {
            background: #f8fafc !important;
          }
          .react-flow__controls-button svg {
            max-width: 14px !important;
            max-height: 14px !important;
          }
          .react-flow__edge:hover .react-flow__edge-path {
            stroke: #6366f1 !important;
            stroke-width: 2.5px !important;
          }
          .react-flow__handle:hover {
            transform: scale(1.3) !important;
          }
          .react-flow__connection-line {
            stroke: #6366f1 !important;
            stroke-width: 2px !important;
            stroke-dasharray: 5 5 !important;
          }
          @keyframes flow-dash {
            to {
              stroke-dashoffset: -10;
            }
          }
          .react-flow__edge.animated .react-flow__edge-path {
            animation: flow-dash 0.5s linear infinite !important;
            stroke-dasharray: 5 5 !important;
          }
        `}
      </style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView={true}
        onEdgeClick={() => {
          refreshEdges();
        }}
        onNodeClick={() => {
          refreshEdges();
        }}
        proOptions={proOptions}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        multiSelectionKeyCode={null}
        onEdgeUpdate={onEdgeUpdate}
        nodeTypes={nodeTypes}
        onEdgeUpdateStart={onEdgeUpdateStart}
        onEdgeUpdateEnd={onEdgeUpdateEnd}
        snapToGrid={true}
        snapGrid={[16, 16]}
        connectionLineStyle={{
          stroke: "#6366f1",
          strokeWidth: 2,
          strokeDasharray: "5 5",
        }}
        defaultEdgeOptions={{
          type: "smoothstep",
          style: { ...edgeStyle },
        }}
      >
        <MiniMap
          nodeStrokeWidth={3}
          nodeColor={(node: Node) => {
            if (
              node.data &&
              node.data.metadata &&
              node.data.metadata.componentType === ComponentType.Trigger
            ) {
              return "#f59e0b";
            }
            return "#6366f1";
          }}
          maskColor="rgba(241, 245, 249, 0.7)"
          style={{
            backgroundColor: "#ffffff",
          }}
        />
        <Controls />
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#cbd5e1"
        />
      </ReactFlow>

      {showComponentsModal && (
        <ComponentsModal
          componentsType={ComponentType.Component}
          onCloseModal={() => {
            setShowComponentsModal(false);
          }}
          categories={allComponentCategories}
          components={allComponentMetadata.filter((comp: ComponentMetadata) => {
            return comp.componentType === ComponentType.Component;
          })}
          onComponentClick={(component: ComponentMetadata) => {
            setShowComponentsModal(false);

            addToGraph(component);
          }}
        />
      )}

      {showTriggersModal && (
        <ComponentsModal
          componentsType={ComponentType.Trigger}
          onCloseModal={() => {
            setShowTriggersModal(false);
          }}
          categories={allComponentCategories}
          components={allComponentMetadata.filter((comp: ComponentMetadata) => {
            return comp.componentType === ComponentType.Trigger;
          })}
          onComponentClick={(component: ComponentMetadata) => {
            setShowTriggersModal(false);

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
              : "Component Properties"
          }
          onDelete={(component: NodeDataProp) => {
            deleteNode(component.id);
          }}
          description={
            selectedNodeData && selectedNodeData.metadata.description
              ? selectedNodeData.metadata.description
              : "Edit Component Properties and variables here."
          }
          onClose={() => {
            setShowComponentSettingsModal(false);
          }}
          onSave={(componentData: NodeDataProp) => {
            // Update the node.

            setNodes((nds: Array<Node>) => {
              return nds.map((n: Node) => {
                if (n.data.internalId === componentData.internalId) {
                  n.data = componentData;
                }

                return n;
              });
            });

            setShowComponentSettingsModal(false);
          }}
        />
      )}

      {showRunModal && (
        <RunModal
          trigger={
            (
              nodes.find((i: Node) => {
                return i.data.metadata.componentType === ComponentType.Trigger;
              }) || getPlaceholderTriggerNode()
            ).data
          }
          onClose={() => {
            setShowRunModal(false);
          }}
          onRun={(trigger: NodeDataProp) => {
            props.onRun(trigger);
          }}
        />
      )}
    </div>
  );
};

export default Workflow;
