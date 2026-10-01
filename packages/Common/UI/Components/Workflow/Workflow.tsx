import WorkflowComponent from "./Component";
import ComponentSettingsModal from "./ComponentSettingsModal";
import ComponentsModal from "./ComponentsModal";
import RunModal from "./RunModal";
import {
  WorkflowCanvasRect,
  WorkflowCanvasViewport,
  getNewWorkflowNodePosition,
  getViewportToRevealNode,
} from "./NodePlacement";
import {
  LintGraphEdge,
  LintGraphNode,
  WorkflowLintResult,
  lintWorkflowGraph,
} from "./GraphLint";
import {
  WorkflowNodeIssueSummary,
  WorkflowNodeRenderData,
  buildNodeIssueSummaries,
  findStepNodeToOpen,
} from "./GraphLintSummary";
import {
  StepGraphEdge,
  StepGraphNode,
  StepValueSources,
  getStepValueSources,
} from "./ValuePicker/StepGraph";
import { loadComponentsAndCategories } from "./Utils";
import Dictionary from "../../../Types/Dictionary";
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
  useMemo,
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
  ReactFlowInstance,
  Viewport,
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
          description: "Choose what starts this workflow",
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
  stroke: "var(--ou-chart-tick, #94a3b8)",
  color: "var(--ou-chart-tick, #94a3b8)",
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

type PrefersReducedMotionFunction = () => boolean;

const prefersReducedMotion: PrefersReducedMotionFunction = (): boolean => {
  try {
    return Boolean(
      typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  } catch {
    return false;
  }
};

/*
 * How many animation frames to keep trying to focus a step that was just
 * added. react-flow keeps a new step hidden until it has measured it, which
 * takes a frame or two, and a hidden element cannot take focus.
 */
const MAX_FOCUS_ATTEMPTS: number = 60;

type GetCanvasOverlaysFunction = (
  canvas: HTMLElement,
) => Array<WorkflowCanvasRect>;

/*
 * Where the minimap and the zoom buttons sit over the canvas, measured from
 * the inside of its border, which is where react-flow's own coordinates
 * start.
 */
const getCanvasOverlays: GetCanvasOverlaysFunction = (
  canvas: HTMLElement,
): Array<WorkflowCanvasRect> => {
  const canvasBox: DOMRect = canvas.getBoundingClientRect();

  return Array.from(
    canvas.querySelectorAll<HTMLElement>(
      ".react-flow__minimap, .react-flow__controls",
    ),
  ).map((overlay: HTMLElement): WorkflowCanvasRect => {
    const box: DOMRect = overlay.getBoundingClientRect();

    return {
      left: box.left - canvasBox.left - canvas.clientLeft,
      top: box.top - canvasBox.top - canvas.clientTop,
      width: box.width,
      height: box.height,
    };
  });
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
  /** Run one component on its own. */
  onRunStep?: ((component: NodeDataProp) => void) | undefined;
  webhookSecretKey?: string | undefined;
  /**
   * Whether the user may read the webhook secret key; the builder only loads
   * it when they may. Handed to the Webhook trigger's settings.
   */
  canSeeWebhookSecretKey?: boolean | undefined;
  /**
   * Gives the workflow a new webhook secret key: Reset URL in the Webhook
   * trigger's settings. Resolves once the new key is saved.
   */
  onResetWebhookSecretKey?: (() => Promise<void>) | undefined;
  /**
   * The key the Incoming Email trigger's address is built from, whether the
   * user may read it (the builder only loads it when they may), and what
   * gives the workflow a new one: Reset address, or the first address of a
   * workflow that has none. Handed to the Incoming Email trigger's settings.
   */
  incomingEmailSecretKey?: string | undefined;
  canSeeIncomingEmailSecretKey?: boolean | undefined;
  onResetIncomingEmailSecretKey?: (() => Promise<void>) | undefined;
  /**
   * Called whenever the static checks over the graph are recomputed, so the
   * page around the canvas can show a count and decide what to do about it.
   */
  onLintResultChange?: ((result: WorkflowLintResult) => void) | undefined;
  /**
   * A react-flow node id whose settings should be opened. The issues panel
   * lives outside the canvas but its whole point is fixing a step, and this is
   * how it gets the builder there.
   */
  openStepForNodeId?: string | null | undefined;
  /**
   * Called once the request above has been handled — whether or not the node
   * was still in the graph — so the page can clear it and ask again later.
   */
  onStepOpened?: (() => void) | undefined;
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

  /*
   * The same arrays every time a picker opens: it organises and indexes the
   * catalog once per array (ComponentPicker), so only the first opening
   * pays for that.
   */
  const actionComponents: Array<ComponentMetadata> = useMemo(() => {
    return allComponentMetadata.filter((comp: ComponentMetadata) => {
      return comp.componentType === ComponentType.Component;
    });
  }, [allComponentMetadata]);

  const triggerComponents: Array<ComponentMetadata> = useMemo(() => {
    return allComponentMetadata.filter((comp: ComponentMetadata) => {
      return comp.componentType === ComponentType.Trigger;
    });
  }, [allComponentMetadata]);

  const edgeUpdateSuccessful: any = useRef(true);
  const flowInstance: React.MutableRefObject<ReactFlowInstance | null> =
    useRef<ReactFlowInstance | null>(null);
  const canvasRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  /*
   * The react-flow id of a step that was just added and should take the
   * keyboard focus once the canvas has drawn it. See the effect further down.
   */
  const nodeIdToFocusRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);
  const [showComponentSettingsModal, setShowComponentSettingsModal] =
    useState<boolean>(false);
  const [selectedNodeData, setSelectedNodeData] = useState<NodeDataProp | null>(
    null,
  );

  type OnNodeClickFunction = (data: NodeDataProp) => void;

  /*
   * The one way into a step's settings from the canvas: a click on the step,
   * or Enter while it has the keyboard focus. Adding a step does not open
   * them; see addToGraph.
   */
  const onNodeClick: OnNodeClickFunction = useCallback((data: NodeDataProp) => {
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
  }, []);

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
      setShowRunModal(false);
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
        !nodeToUpdate.some((n: Node) => {
          return (
            (n.data as NodeDataProp).componentType === ComponentType.Trigger ||
            (n.data as NodeDataProp).nodeType === NodeType.PlaceholderNode
          );
        })
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

  const [nodes, setNodes, onNodesChange] = useNodesState(props.initialNodes);

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

  /*
   * Static checks over the graph, recomputed as it is edited.
   *
   * The results are deliberately NOT written back into node state. Node data is
   * what gets persisted (Builder.saveGraph sends node.data verbatim, minus
   * metadata), so storing lint output there would save today's warnings into
   * the workflow itself and show them again on reload even once they were
   * fixed. Deriving a separate array for rendering keeps the saved graph clean.
   */
  const lintResult: WorkflowLintResult = useMemo(() => {
    return lintWorkflowGraph({
      nodes: nodes as unknown as Array<LintGraphNode>,
      edges: edges as unknown as Array<LintGraphEdge>,
    });
  }, [nodes, edges]);

  useEffect(() => {
    props.onLintResultChange?.(lintResult);
  }, [lintResult]);

  /*
   * The same results sorted into what each step shows on the canvas: "Click to
   * set up" while its required settings are empty, and a badge for anything
   * else.
   */
  const issueSummariesByNodeId: Dictionary<WorkflowNodeIssueSummary> =
    useMemo(() => {
      return buildNodeIssueSummaries(lintResult.issues);
    }, [lintResult]);

  /*
   * Opening a step from outside the canvas — the issues panel naming the node
   * it is complaining about. A node that has since been deleted simply opens
   * nothing; the request is still acknowledged so the page does not sit
   * waiting for a step that no longer exists.
   */
  useEffect(() => {
    if (!props.openStepForNodeId) {
      return;
    }

    const nodeToOpen: Node | null = findStepNodeToOpen({
      nodes: nodes,
      nodeId: props.openStepForNodeId,
    });

    if (nodeToOpen) {
      setSelectedNodeData(nodeToOpen.data as NodeDataProp);
      setShowComponentSettingsModal(true);
    }

    props.onStepOpened?.();
  }, [props.openStepForNodeId]);

  /*
   * Every step, for the settings dialog. Placeholder nodes are left out: the
   * "click here to add trigger" node carries a partial metadata object - no
   * return values, no arguments, an empty id - and passing it on made every
   * consumer responsible for knowing that.
   */
  const graphComponents: Array<NodeDataProp> = useMemo(() => {
    return nodes
      .map((node: Node) => {
        return node.data as NodeDataProp;
      })
      .filter((data: NodeDataProp) => {
        return data.nodeType !== NodeType.PlaceholderNode;
      });
  }, [nodes]);

  /*
   * The steps the open step can read values from - the trigger and every
   * step before it - and the ones after it, whose values never exist yet when
   * it runs. Its value picker offers only the first.
   */
  const selectedStepValueSources: StepValueSources | undefined = useMemo(() => {
    if (!selectedNodeData) {
      return undefined;
    }

    const selectedNode: Node | undefined = nodes.find((node: Node) => {
      return (
        (node.data as NodeDataProp).internalId === selectedNodeData.internalId
      );
    });

    if (!selectedNode) {
      return undefined;
    }

    return getStepValueSources({
      nodes: nodes as unknown as Array<StepGraphNode>,
      edges: edges as unknown as Array<StepGraphEdge>,
      nodeId: selectedNode.id,
    });
  }, [nodes, edges, selectedNodeData]);

  const nodesToRender: Array<Node> = useMemo(() => {
    return nodes.map((node: Node) => {
      const error: string = lintResult.errorsByNodeId[node.id] || "";
      const issueSummary: WorkflowNodeIssueSummary | undefined =
        issueSummariesByNodeId[node.id];

      // Same object when there is nothing to say, so react-flow can bail early.
      if (!error && !issueSummary && !node.data.error) {
        return node;
      }

      const data: WorkflowNodeRenderData = {
        ...(node.data as NodeDataProp),
        error: error,
        issueSummary: issueSummary,
      };

      return {
        ...node,
        data: data,
      };
    });
  }, [nodes, lintResult, issueSummariesByNodeId]);

  /*
   * A step that was just added takes the keyboard focus once the canvas has
   * drawn it, so Enter opens its settings straight away. The panel it was
   * chosen from has closed by then and focus is on nothing in particular.
   * Focus that has gone somewhere else in the meantime is left where it is.
   */
  useEffect(() => {
    if (!nodeIdToFocusRef.current) {
      return undefined;
    }

    let frame: number | null = null;
    let attempts: number = 0;

    const focusNewNode: () => void = (): void => {
      frame = null;

      const nodeId: string | null = nodeIdToFocusRef.current;
      const canvas: HTMLDivElement | null = canvasRef.current;

      if (!nodeId || !canvas) {
        return;
      }

      const activeElement: Element | null = document.activeElement;

      if (
        activeElement &&
        activeElement !== document.body &&
        !canvas.contains(activeElement)
      ) {
        nodeIdToFocusRef.current = null;
        return;
      }

      const element: HTMLElement | undefined = Array.from(
        canvas.querySelectorAll<HTMLElement>(".react-flow__node"),
      ).find((candidate: HTMLElement) => {
        return candidate.getAttribute("data-id") === nodeId;
      });

      if (element) {
        /*
         * preventScroll: focus scrolls an overflow-hidden ancestor, and
         * react-flow's pane is one, which would shift the whole drawing
         * under its own pan. The canvas has already brought the step into
         * view by panning.
         */
        element.focus({ preventScroll: true });

        if (document.activeElement === element) {
          nodeIdToFocusRef.current = null;
          return;
        }
      }

      attempts++;

      if (attempts >= MAX_FOCUS_ATTEMPTS) {
        nodeIdToFocusRef.current = null;
        return;
      }

      frame = requestAnimationFrame(focusNewNode);
    };

    focusNewNode();

    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [nodes]);

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
  const isModalOpen: boolean =
    showComponentsModal ||
    showTriggersModal ||
    showComponentSettingsModal ||
    showRunModal;

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

  type RevealNodeFunction = (node: Node) => void;

  /*
   * Bring a step that was just added into view, at the zoom the builder chose
   * and only as far as it takes. See getViewportToRevealNode.
   */
  const revealNode: RevealNodeFunction = (node: Node): void => {
    const instance: ReactFlowInstance | null = flowInstance.current;

    if (!instance) {
      return;
    }

    const viewport: Viewport = instance.getViewport();
    const canvas: HTMLDivElement | null = canvasRef.current;

    const nextViewport: WorkflowCanvasViewport | null = getViewportToRevealNode(
      {
        position: node.position,
        viewport: viewport,
        canvasSize: {
          width: canvas?.clientWidth || 0,
          height: canvas?.clientHeight || 0,
        },
        overlays: canvas ? getCanvasOverlays(canvas) : [],
      },
    );

    if (!nextViewport) {
      return;
    }

    instance.setViewport(nextViewport, {
      duration: prefersReducedMotion() ? 0 : 200,
    });
  };

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
      position: getNewWorkflowNodePosition(
        nodes,
        componentMetadata.componentType,
      ),
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

    /*
     * The new step lands selected and in view, and its settings stay closed
     * until it is clicked. Opening them by themselves covered the canvas the
     * moment anything was added, before the builder had seen where the step
     * went or connected it, and turned adding a few steps in a row into
     * closing a dialog after each one. A step that still needs settings says
     * "Click to set up" on the canvas instead.
     */
    revealNode(compToAdd);
    nodeIdToFocusRef.current = compToAdd.id;
  };

  type OnCanvasKeyDownFunction = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => void;

  /*
   * Enter on a step opens its settings, the way a click does. react-flow makes
   * every step a focusable button but only selects it on Enter, and a step
   * that was just added is focused for exactly this.
   */
  const onCanvasKeyDown: OnCanvasKeyDownFunction = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (
      event.key !== "Enter" ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }

    const target: HTMLElement = event.target as HTMLElement;

    // The step itself, not something inside it or elsewhere on the canvas.
    if (!target.classList || !target.classList.contains("react-flow__node")) {
      return;
    }

    const nodeId: string | null = target.getAttribute("data-id");

    const node: Node | undefined = nodesToRender.find((candidate: Node) => {
      return candidate.id === nodeId;
    });

    if (!node) {
      return;
    }

    /*
     * Otherwise the Enter carries on into the settings once they have opened
     * and focused their first box, and starts a new line in it.
     */
    event.preventDefault();
    refreshEdges();
    onNodeClick(node.data as NodeDataProp);
  };

  return (
    <div
      ref={canvasRef}
      style={{
        height: "calc(100vh - 220px)",
        minHeight: "400px",
        borderRadius: "8px",
        overflow: "hidden",
        border: "1px solid var(--ou-border-default, #e2e8f0)",
      }}
    >
      <style>
        {`
          .react-flow__minimap {
            border-radius: 8px !important;
            border: 1px solid var(--ou-border-default, #e2e8f0) !important;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.07) !important;
            overflow: hidden !important;
            background: var(--ou-surface-primary, #ffffff) !important;
          }
          .react-flow__controls {
            border-radius: 8px !important;
            border: 1px solid var(--ou-border-default, #e2e8f0) !important;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.07) !important;
            overflow: hidden !important;
          }
          .react-flow__controls-button {
            border-bottom: 1px solid var(--ou-border-subtle, #f1f5f9) !important;
            background: var(--ou-surface-primary, #ffffff) !important;
            color: var(--ou-text-secondary, #475569) !important;
            width: 32px !important;
            height: 32px !important;
          }
          .react-flow__controls-button:hover {
            background: var(--ou-surface-secondary, #f8fafc) !important;
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
          /*
           * react-flow removes the focus outline from steps, which leaves a
           * keyboard user with no way to see which step Enter would open.
           * Pointer focus stays unmarked, so a click draws no ring.
           */
          .react-flow__node.selectable:focus-visible {
            outline: 2px solid var(--ou-chart-focus-ring, #4f46e5) !important;
            outline-offset: 3px !important;
            border-radius: 14px;
          }
        `}
      </style>
      <ReactFlow
        onInit={(instance: ReactFlowInstance) => {
          flowInstance.current = instance;
        }}
        nodes={nodesToRender}
        edges={edges}
        fitView={true}
        fitViewOptions={{ maxZoom: 1 }}
        onEdgeClick={() => {
          refreshEdges();
        }}
        onNodeClick={(_event: React.MouseEvent, node: Node) => {
          refreshEdges();
          /*
           * Handle every node through the canvas, including newly added steps
           * and replacement trigger placeholders, without persisting callbacks.
           */
          onNodeClick(node.data as NodeDataProp);
        }}
        onKeyDown={onCanvasKeyDown}
        proOptions={proOptions}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        multiSelectionKeyCode={null}
        // React Flow listens on document, even while a dialog has focus.
        panActivationKeyCode={isModalOpen ? null : "Space"}
        deleteKeyCode={isModalOpen ? null : "Backspace"}
        selectionKeyCode={isModalOpen ? null : "Shift"}
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
          maskColor="var(--ou-flow-mask, rgba(241, 245, 249, 0.7))"
          style={{
            backgroundColor: "var(--ou-surface-primary, #ffffff)",
          }}
        />
        <Controls />
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--ou-chart-grid, #cbd5e1)"
        />
      </ReactFlow>

      {showComponentsModal && (
        <ComponentsModal
          componentsType={ComponentType.Component}
          onCloseModal={() => {
            setShowComponentsModal(false);
          }}
          categories={allComponentCategories}
          components={actionComponents}
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
          components={triggerComponents}
          onComponentClick={(component: ComponentMetadata) => {
            setShowTriggersModal(false);

            addToGraph(component);
          }}
        />
      )}

      {showComponentSettingsModal && selectedNodeData && (
        <ComponentSettingsModal
          graphComponents={graphComponents}
          valueSources={selectedStepValueSources}
          workflowId={props.workflowId}
          webhookSecretKey={props.webhookSecretKey}
          canSeeWebhookSecretKey={props.canSeeWebhookSecretKey}
          onResetWebhookSecretKey={props.onResetWebhookSecretKey}
          incomingEmailSecretKey={props.incomingEmailSecretKey}
          canSeeIncomingEmailSecretKey={props.canSeeIncomingEmailSecretKey}
          onResetIncomingEmailSecretKey={props.onResetIncomingEmailSecretKey}
          component={selectedNodeData}
          title={
            selectedNodeData && selectedNodeData.metadata.title
              ? selectedNodeData.metadata.title
              : "Component Properties"
          }
          onDelete={(component: NodeDataProp) => {
            deleteNode(component.id);
          }}
          /*
           * Triggers have nothing to run on their own — they are the thing
           * that starts a run, so "run just this step" is meaningless for one.
           */
          onRunStep={
            props.onRunStep &&
            selectedNodeData.componentType !== ComponentType.Trigger
              ? props.onRunStep
              : undefined
          }
          description={
            selectedNodeData && selectedNodeData.metadata.description
              ? selectedNodeData.metadata.description
              : "Edit Component Properties and variables here."
          }
          onClose={() => {
            setShowComponentSettingsModal(false);
          }}
          onSave={(componentData: NodeDataProp) => {
            /*
             * The settings modal was opened from the rendered node, so what
             * comes back carries whatever lint message was on it. Clear that
             * before it reaches node state — state is what gets saved, and a
             * message about today's mistake has no business being written into
             * the workflow. The same goes for the sorted summary the canvas
             * draws its "Click to set up" and badges from.
             */
            const dataToStore: WorkflowNodeRenderData = {
              ...componentData,
              error: "",
            };
            delete dataToStore.onClick;
            delete dataToStore.issueSummary;

            setNodes((nds: Array<Node>) => {
              return nds.map((n: Node) => {
                if (n.data.internalId === dataToStore.internalId) {
                  return { ...n, data: dataToStore };
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
