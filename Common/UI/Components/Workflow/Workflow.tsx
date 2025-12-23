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
  Connection,
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
  strokeWidth: "2px",
  stroke: "#818cf8",
  color: "#818cf8",
};

type GetEdgeDefaultPropsFunction = (selected: boolean) => JSONObject;

export const getEdgeDefaultProps: GetEdgeDefaultPropsFunction = (
  selected: boolean,
): JSONObject => {
  return {
    type: "smoothstep",
    markerEnd: {
      type: MarkerType.Arrow,
      color: edgeStyle.color?.toString() || "",
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

  // Drag and drop handlers for sidebar components
  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();

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

  return (
    <div className="h-full" ref={reactFlowWrapper}>
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
        onDrop={onDrop}
        onDragOver={onDragOver}
      >
        <MiniMap />
        <Controls />
        <Background color="#111827" />
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
