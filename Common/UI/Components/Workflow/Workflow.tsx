import WorkflowComponent from "./Component";
import ComponentSettingsModal from "./ComponentSettingsModal";
import ComponentsModal from "./ComponentsModal";
import RunModal from "./RunModal";
import WorkflowEmptyState from "./WorkflowEmptyState";
import { loadComponentsAndCategories } from "./Utils";
import { VoidFunction } from "../../../Types/FunctionTypes";
import IconProp from "../../../Types/Icon/IconProp";
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
  ConnectionLineType,
  Controls,
  Edge,
  MarkerType,
  MiniMap,
  Node,
  NodeTypes,
  OnConnect,
  ProOptions,
  ReactFlowProvider,
  addEdge,
  getConnectedEdges,
  updateEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "reactflow";
// 👇 you need to import the reactflow styles
import "reactflow/dist/style.css";
import "./WorkflowCanvas.css";

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
  strokeWidth: "3px",
  stroke: "#6366f1",
  color: "#6366f1",
};

const animatedEdgeStyle: React.CSSProperties = {
  strokeWidth: "2px",
  stroke: "#10b981",
  color: "#10b981",
};

interface EdgeDefaultProps {
  type: string;
  markerEnd: {
    type: MarkerType;
    color: string;
    width: number;
    height: number;
  };
  style: React.CSSProperties;
  animated: boolean;
}

type GetEdgeDefaultPropsFunction = (
  selected: boolean,
  animated?: boolean,
) => EdgeDefaultProps;

export const getEdgeDefaultProps: GetEdgeDefaultPropsFunction = (
  selected: boolean,
  animated?: boolean,
): EdgeDefaultProps => {
  let style: React.CSSProperties = edgeStyle;
  let markerColor: string = edgeStyle.color?.toString() || "#94a3b8";

  if (selected) {
    style = selectedEdgeStyle;
    markerColor = selectedEdgeStyle.color?.toString() || "#6366f1";
  } else if (animated) {
    style = animatedEdgeStyle;
    markerColor = animatedEdgeStyle.color?.toString() || "#10b981";
  }

  return {
    type: "smoothstep",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: markerColor,
      width: 20,
      height: 20,
    },
    style,
    animated: animated || false,
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
  allComponentMetadata?: Array<ComponentMetadata>;
}

// Inner component that uses useReactFlow hook
interface WorkflowInnerProps extends ComponentProps {
  allComponentMetadataLoaded: Array<ComponentMetadata>;
  allComponentCategoriesLoaded: Array<ComponentCategory>;
}

const WorkflowInner: FunctionComponent<WorkflowInnerProps> = (
  props: WorkflowInnerProps,
) => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useReactFlow();
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
              type: MarkerType.Arrow,
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

  type AddToGraphFunction = (
    componentMetadata: ComponentMetadata,
    position?: { x: number; y: number },
  ) => void;

  const addToGraph: AddToGraphFunction = (
    componentMetadata: ComponentMetadata,
    position?: { x: number; y: number },
  ) => {
    const metaDataId: string = componentMetadata.id;
    const nodePosition: { x: number; y: number } = position || { x: 200, y: 200 };

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
      position: nodePosition,
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

  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  // Drag and drop handlers for sidebar components
  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragOver(false);

      const dataStr: string = event.dataTransfer.getData("application/reactflow");
      if (!dataStr) {
        return;
      }

      try {
        const data: { componentId: string; componentType: ComponentType } =
          JSON.parse(dataStr);

        // Find the component metadata
        const componentMetadata: ComponentMetadata | undefined = (
          props.allComponentMetadataLoaded || []
        ).find((c: ComponentMetadata) => {
          return c.id === data.componentId;
        });

        if (!componentMetadata) {
          return;
        }

        // Get the position relative to the canvas
        const bounds: DOMRect | undefined =
          reactFlowWrapper.current?.getBoundingClientRect();
        if (!bounds) {
          return;
        }

        const position: { x: number; y: number } =
          reactFlowInstance.screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          });

        addToGraph(componentMetadata, position);
      } catch (e) {
        // Invalid JSON data
      }
    },
    [props.allComponentMetadataLoaded, reactFlowInstance, addToGraph],
  );

  // Custom minimap node color
  const minimapNodeColor = (node: Node): string => {
    if (node.data?.nodeType === NodeType.PlaceholderNode) {
      return "#e2e8f0";
    }
    if (node.data?.componentType === ComponentType.Trigger) {
      return "#fbbf24";
    }
    return "#6366f1";
  };

  // Check if workflow is essentially empty (only has placeholder or single trigger)
  const isWorkflowEmpty: boolean =
    nodes.length === 0 ||
    (nodes.length === 1 &&
      nodes[0]?.data?.nodeType === NodeType.PlaceholderNode);

  const hasTrigger: boolean = nodes.some((node: Node) => {
    return (
      node.data?.componentType === ComponentType.Trigger &&
      node.data?.nodeType === NodeType.Node
    );
  });

  return (
    <div
      className={`h-full relative transition-all duration-200 ${isDragOver ? "ring-2 ring-inset ring-indigo-400" : ""}`}
      ref={reactFlowWrapper}
      onDragLeave={onDragLeave}
    >
      {/* Drop zone overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-indigo-50/30 z-10 pointer-events-none flex items-center justify-center">
          <div className="bg-white/90 px-6 py-3 rounded-lg shadow-lg border-2 border-dashed border-indigo-400">
            <p className="text-indigo-600 font-medium text-sm">
              Drop component here
            </p>
          </div>
        </div>
      )}

      {/* Empty state hint */}
      {isWorkflowEmpty && !isDragOver && (
        <WorkflowEmptyState hasTrigger={hasTrigger} />
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView={true}
        fitViewOptions={{
          padding: 0.2,
          minZoom: 0.5,
          maxZoom: 1.5,
        }}
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
        onDrop={onDrop}
        onDragOver={onDragOver}
        defaultEdgeOptions={{
          type: "smoothstep",
          style: edgeStyle,
        }}
        connectionLineStyle={{
          stroke: "#6366f1",
          strokeWidth: 2,
        }}
        connectionLineType={ConnectionLineType.SmoothStep}
        snapToGrid={true}
        snapGrid={[15, 15]}
        minZoom={0.2}
        maxZoom={2}
      >
        <MiniMap
          nodeColor={minimapNodeColor}
          maskColor="rgba(0, 0, 0, 0.1)"
          style={{
            backgroundColor: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
          }}
          zoomable
          pannable
        />
        <Controls
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
          showInteractive={false}
        />
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#d1d5db"
          style={{ backgroundColor: "#f9fafb" }}
        />
      </ReactFlow>

      {showComponentsModal && (
        <ComponentsModal
          componentsType={ComponentType.Component}
          onCloseModal={() => {
            setShowComponentsModal(false);
          }}
          categories={props.allComponentCategoriesLoaded}
          components={props.allComponentMetadataLoaded.filter(
            (comp: ComponentMetadata) => {
              return comp.componentType === ComponentType.Component;
            },
          )}
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
          categories={props.allComponentCategoriesLoaded}
          components={props.allComponentMetadataLoaded.filter(
            (comp: ComponentMetadata) => {
              return comp.componentType === ComponentType.Trigger;
            },
          )}
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

// Main Workflow component that wraps everything in ReactFlowProvider
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

  return (
    <ReactFlowProvider>
      <WorkflowInner
        {...props}
        allComponentMetadataLoaded={
          props.allComponentMetadata || allComponentMetadata
        }
        allComponentCategoriesLoaded={allComponentCategories}
      />
    </ReactFlowProvider>
  );
};

export default Workflow;

// Export for use in WorkflowBuilderLayout
export { loadComponentsAndCategories };
