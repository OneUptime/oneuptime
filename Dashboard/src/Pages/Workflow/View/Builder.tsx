import PageComponentProps from "../../PageComponentProps";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import ComponentMetadata, {
  ComponentCategory,
  ComponentType,
  NodeDataProp,
  NodeType,
} from "Common/Types/Workflow/Component";
import Banner from "Common/UI/Components/Banner/Banner";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { loadComponentsAndCategories } from "Common/UI/Components/Workflow/Utils";
import Workflow, {
  getEdgeDefaultProps,
  getPlaceholderTriggerNode,
} from "Common/UI/Components/Workflow/Workflow";
import WorkflowBuilderLayout from "Common/UI/Components/Workflow/WorkflowBuilderLayout";
import { applyAutoLayout } from "Common/UI/Components/Workflow/workflowLayoutUtils";
import { WORKFLOW_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import WorkflowModel from "Common/Models/DatabaseModels/Workflow";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { Edge, Node } from "reactflow";
import { useAsyncEffect } from "use-async-effect";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";

const Delete: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<string>("");
  const [saveTimeout, setSaveTimeout] = useState<ReturnType<
    typeof setTimeout
  > | null>(null);
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [nodes, setNodes] = useState<Array<Node>>([]);
  const [edges, setEdges] = useState<Array<Edge>>([]);
  const [error, setError] = useState<string>("");

  const [showRunSuccessConfirmation, setShowRunSuccessConfirmation] =
    useState<boolean>(false);

  const [showComponentPickerModal, setShowComponentPickerModal] =
    useState<boolean>(false);

  const [showRunModal, setShowRunModal] = useState<boolean>(false);

  const [isAutoLayouting, setIsAutoLayouting] = useState<boolean>(false);

  // Load component metadata for sidebar
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

  const handleAutoLayout = async (): Promise<void> => {
    if (nodes.length < 2) {
      return;
    }

    setIsAutoLayouting(true);
    try {
      const result: { nodes: Array<Node>; edges: Array<Edge> } =
        await applyAutoLayout(nodes, edges);
      setNodes(result.nodes);
      setEdges(result.edges);
      await saveGraph(result.nodes, result.edges);
    } catch (err) {
      setError("Failed to apply auto layout");
    }
    setIsAutoLayouting(false);
  };

  const loadGraph: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);
      const workflow: WorkflowModel | null = await ModelAPI.getItem({
        modelType: WorkflowModel,
        id: modelId,
        select: {
          graph: true,
        },
        requestOptions: {},
      });

      if (workflow) {
        const allComponents: {
          components: Array<ComponentMetadata>;
          categories: Array<ComponentCategory>;
        } = loadComponentsAndCategories();

        if (workflow.graph && (workflow.graph as JSONObject)["nodes"]) {
          if (((workflow.graph as any)["nodes"] as Array<Node>).length === 0) {
            // add a placeholder trigger node.
            setNodes([getPlaceholderTriggerNode()]);
          } else {
            let nodes: Array<Node> = (workflow.graph as any)[
              "nodes"
            ] as Array<Node>;

            // Fill nodes.

            for (let i: number = 0; i < nodes.length; i++) {
              if (!nodes[i]) {
                continue;
              }

              if (nodes[i]?.data.nodeType === NodeType.PlaceholderNode) {
                nodes[i] = {
                  ...nodes[i],
                  ...getPlaceholderTriggerNode(),
                };
                continue;
              }

              let componentMetdata: ComponentMetadata | undefined = undefined;

              for (const component of allComponents.components) {
                if (component.id === nodes[i]?.data.metadataId) {
                  componentMetdata = component;
                }
              }

              if (!componentMetdata) {
                throw new BadDataException(
                  "Component Metadata not found for node " +
                    nodes[i]?.data.metadataId,
                );
              }

              nodes[i]!.data.metadata = {
                ...componentMetdata,
              };
            }

            // see if it has the trigger node.

            if (
              !nodes.find((node: Node) => {
                return (
                  node.data.nodeType === NodeType.PlaceholderNode ||
                  node.data.componentType === ComponentType.Trigger
                );
              })
            ) {
              nodes = [...nodes, getPlaceholderTriggerNode()];
            }

            setNodes(nodes);
          }
        } else {
          // add a placeholder trigger node.
          setNodes([getPlaceholderTriggerNode()]);
        }

        if (workflow.graph && (workflow.graph as JSONObject)["edges"]) {
          const edges: Array<Edge> = (workflow.graph as any)[
            "edges"
          ] as Array<Edge>;

          for (let i: number = 0; i < edges.length; i++) {
            if (!edges[i]) {
              continue;
            }

            edges[i] = {
              ...edges[i],
              ...getEdgeDefaultProps(false),
            } as Edge;
          }

          setEdges(edges);
        } else {
          setEdges([]);
        }
      } else {
        setError("Workflow not found");
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  type SaveGraphFunction = (
    nodes: Array<Node>,
    edges: Array<Edge>,
  ) => Promise<void>;

  const saveGraph: SaveGraphFunction = async (
    nodes: Array<Node>,
    edges: Array<Edge>,
  ): Promise<void> => {
    setSaveStatus("Saving...");

    if (saveTimeout) {
      clearTimeout(saveTimeout);
      setSaveTimeout(null);
    }

    setSaveTimeout(
      setTimeout(async () => {
        try {
          const graph: any = JSONFunctions.parse(
            JSON.stringify({ nodes, edges }),
          ); // deep copy

          // clean up.

          if (graph["nodes"]) {
            for (
              let i: number = 0;
              i < (graph["nodes"] as Array<Node>).length;
              i++
            ) {
              (graph["nodes"] as Array<Node>)[i] = {
                ...((graph["nodes"] as Array<Node>)[i] as Node),
              };

              delete ((graph["nodes"] as Array<Node>)[i] as Node).data.metadata;
            }
          }

          if (graph["edges"]) {
            for (
              let i: number = 0;
              i < (graph["edges"] as Array<Edge>).length;
              i++
            ) {
              (graph["edges"] as Array<Edge>)[i] = {
                ...((graph["edges"] as Array<Edge>)[i] as Edge),
              };

              delete ((graph["edges"] as Array<Edge>)[i] as Edge).type;
              delete ((graph["edges"] as Array<Edge>)[i] as Edge).style;
              delete ((graph["edges"] as Array<Edge>)[i] as Edge).markerEnd;
            }
          }

          await ModelAPI.updateById({
            modelType: WorkflowModel,
            id: modelId,
            data: {
              graph,
            },
          });

          setSaveStatus("Changes Saved.");
        } catch (err) {
          setError(API.getFriendlyMessage(err));

          setSaveStatus("Save Error.");
        }

        if (saveTimeout) {
          clearTimeout(saveTimeout);
          setSaveTimeout(null);
        }
      }, 1000),
    );
  };

  useAsyncEffect(async () => {
    await loadGraph();
  }, []);

  return (
    <Fragment>
      <>
        <Banner
          openInNewTab={true}
          title="Need help with building workflows?"
          description="Watch this 10 minute video which will help you connect Slack with OneUptime using workflows"
          link={URL.fromString("https://youtu.be/k1-reCQTZnM")}
          hideOnMobile={true}
        />

        {isLoading ? (
          <div className="p-8">
            <ComponentLoader />
          </div>
        ) : (
          <WorkflowBuilderLayout
            components={allComponentMetadata}
            categories={allComponentCategories}
            nodes={nodes}
            saveStatus={saveStatus}
            onRunWorkflow={() => {
              setShowRunModal(true);
            }}
            onAutoLayout={handleAutoLayout}
            isAutoLayouting={isAutoLayouting}
          >
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
              allComponentMetadata={allComponentMetadata}
              onWorkflowUpdated={async (
                nodes: Array<Node>,
                edges: Array<Edge>,
              ) => {
                setNodes(nodes);
                setEdges(edges);
                await saveGraph(nodes, edges);
              }}
              onRun={async (component: NodeDataProp) => {
                try {
                  const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
                    await API.post({
                      url: URL.fromString(WORKFLOW_URL.toString()).addRoute(
                        "/manual/run/" + modelId.toString(),
                      ),
                      data: {
                        data: component.arguments,
                      },
                    });

                  if (result instanceof HTTPErrorResponse) {
                    throw result;
                  }

                  setShowRunSuccessConfirmation(true);
                } catch (err) {
                  setError(API.getFriendlyMessage(err));
                }
              }}
            />
          </WorkflowBuilderLayout>
        )}
        {error && (
          <ConfirmModal
            title={`Error`}
            description={`${error}`}
            submitButtonText={"Close"}
            onSubmit={() => {
              setError("");
            }}
            submitButtonType={ButtonStyleType.NORMAL}
          />
        )}

        {showRunSuccessConfirmation && (
          <ConfirmModal
            title={`Workflow scheduled to execute`}
            description={`This workflow is scheduled to execute soon. You can see the status of the run in the Runs and Logs section.`}
            submitButtonText={"Close"}
            onSubmit={() => {
              setShowRunSuccessConfirmation(false);
            }}
            submitButtonType={ButtonStyleType.NORMAL}
          />
        )}
      </>
    </Fragment>
  );
};

export default Delete;
