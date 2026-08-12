import PageComponentProps from "../../PageComponentProps";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import ComponentMetadata, {
  ComponentCategory,
  ComponentType,
  NodeDataProp,
  NodeType,
} from "Common/Types/Workflow/Component";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import {
  WorkflowLintIssue,
  WorkflowLintResult,
  WorkflowLintSeverity,
} from "Common/UI/Components/Workflow/GraphLint";
import { loadComponentsAndCategories } from "Common/UI/Components/Workflow/Utils";
import Workflow, {
  getEdgeDefaultProps,
  getPlaceholderTriggerNode,
} from "Common/UI/Components/Workflow/Workflow";
import { WORKFLOW_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import WorkflowModel from "Common/Models/DatabaseModels/Workflow";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import { Edge, Node } from "reactflow";
import { useAsyncEffect } from "use-async-effect";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";

type GetIssueSummaryTextFunction = (result: WorkflowLintResult) => string;

const getIssueSummaryText: GetIssueSummaryTextFunction = (
  result: WorkflowLintResult,
): string => {
  const parts: Array<string> = [];

  if (result.errorCount > 0) {
    parts.push(
      `${result.errorCount} ${result.errorCount === 1 ? "problem" : "problems"}`,
    );
  }

  if (result.warningCount > 0) {
    parts.push(
      `${result.warningCount} ${
        result.warningCount === 1 ? "warning" : "warnings"
      }`,
    );
  }

  return parts.join(", ");
};

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
  const [webhookSecretKey, setWebhookSecretKey] = useState<string>("");

  const [showRunSuccessConfirmation, setShowRunSuccessConfirmation] =
    useState<boolean>(false);

  const [showComponentPickerModal, setShowComponentPickerModal] =
    useState<boolean>(false);

  const [showRunModal, setShowRunModal] = useState<boolean>(false);

  const [lintResult, setLintResult] = useState<WorkflowLintResult | null>(null);
  const [showIssuesModal, setShowIssuesModal] = useState<boolean>(false);

  const loadGraph: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);
      const workflow: WorkflowModel | null = await ModelAPI.getItem({
        modelType: WorkflowModel,
        id: modelId,
        select: {
          graph: true,
          webhookSecretKey: true,
        },
        requestOptions: {},
      });

      if (workflow) {
        if (workflow.webhookSecretKey) {
          setWebhookSecretKey(workflow.webhookSecretKey);
        }

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

              /*
               * Any error text in a stored graph is stale by definition — it
               * describes what the builder said about a draft at some past
               * moment, and the checks re-run on load anyway. Clearing it here
               * means a graph that was saved with an error in it (possible
               * before saveGraph started stripping the field) heals itself
               * rather than showing a badge for a problem that is long fixed.
               */
              nodes[i]!.data.error = "";
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

              /*
               * data.error holds whatever the builder's static checks are
               * saying about this node right now. That is a property of the
               * current draft, not of the workflow, and saving it means a
               * message survives the fix that resolved it and comes back on
               * the next load. Drop it on the way out.
               */
              delete ((graph["nodes"] as Array<Node>)[i] as Node).data.error;
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

          setSaveStatus("Saved");
        } catch (err) {
          setError(API.getFriendlyMessage(err));

          setSaveStatus("Error saving");
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

  type GetSaveStatusColorFunction = () => string;

  const getSaveStatusColor: GetSaveStatusColorFunction = (): string => {
    if (saveStatus === "Saved") {
      return "#10b981";
    }
    if (saveStatus === "Error saving") {
      return "#ef4444";
    }
    return "#94a3b8";
  };

  return (
    <Fragment>
      <>
        {/* Toolbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0.75rem 1rem",
            backgroundColor: "var(--ou-surface-primary, #ffffff)",
            borderRadius: "10px",
            border: "1px solid var(--ou-border-default, #e2e8f0)",
            marginBottom: "0.75rem",
            boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.03)",
          }}
        >
          <div
            style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
              }}
            >
              <div
                style={{
                  width: "7px",
                  height: "7px",
                  borderRadius: "50%",
                  backgroundColor: getSaveStatusColor(),
                  transition: "background-color 0.3s ease",
                }}
              />
              <span
                style={{
                  fontSize: "0.75rem",
                  color: getSaveStatusColor(),
                  fontWeight: 500,
                  transition: "color 0.3s ease",
                }}
              >
                {saveStatus || "Ready"}
              </span>
            </div>

            {/*
              Static checks over the graph. Clicking opens the full list —
              each node also carries its own badge on the canvas.
            */}
            {lintResult && lintResult.issues.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setShowIssuesModal(true);
                }}
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  cursor: "pointer",
                  textDecoration: "underline",
                  color: lintResult.errorCount > 0 ? "#ef4444" : "#f59e0b",
                }}
              >
                {getIssueSummaryText(lintResult)}
              </button>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Button
              title="Add Component"
              icon={IconProp.Add}
              buttonStyle={ButtonStyleType.OUTLINE}
              onClick={() => {
                setShowComponentPickerModal(true);
              }}
            />
            <Button
              title="Run Workflow"
              icon={IconProp.Play}
              buttonStyle={ButtonStyleType.SUCCESS_OUTLINE}
              onClick={() => {
                setShowRunModal(true);
              }}
            />
          </div>
        </div>

        {/* Canvas */}
        {isLoading ? (
          <div
            style={{
              height: "calc(100vh - 280px)",
              minHeight: "500px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "var(--ou-surface-primary, #ffffff)",
              borderRadius: "10px",
              border: "1px solid var(--ou-border-default, #e2e8f0)",
            }}
          >
            <ComponentLoader />
          </div>
        ) : (
          <Workflow
            workflowId={modelId}
            webhookSecretKey={webhookSecretKey}
            showComponentsPickerModal={showComponentPickerModal}
            onComponentPickerModalUpdate={(value: boolean) => {
              setShowComponentPickerModal(value);
            }}
            initialNodes={nodes}
            onLintResultChange={(result: WorkflowLintResult) => {
              setLintResult(result);
            }}
            onRunModalUpdate={(value: boolean) => {
              setShowRunModal(value);
            }}
            showRunModal={showRunModal}
            initialEdges={edges}
            onWorkflowUpdated={async (
              nodes: Array<Node>,
              edges: Array<Edge>,
            ) => {
              setNodes(nodes);
              setEdges(edges);
              await saveGraph(nodes, edges);
            }}
            onRunStep={async (component: NodeDataProp) => {
              try {
                const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
                  await API.post({
                    url: URL.fromString(WORKFLOW_URL.toString()).addRoute(
                      "/run-step/" + modelId.toString(),
                    ),
                    data: {
                      componentId: component.id,
                    },
                    headers: ModelAPI.getCommonHeaders(),
                  });

                if (result instanceof HTTPErrorResponse) {
                  throw result;
                }

                startWatchingRun();
              } catch (err) {
                setError(API.getFriendlyMessage(err));
              }
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
                    /*
                     * /workflow/manual/run is a custom route, so it gets no
                     * tenant header unless the call site adds one. It needs
                     * the header to check the caller is a member of the
                     * workflow's project before running it.
                     */
                    headers: ModelAPI.getCommonHeaders(),
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

        {showIssuesModal && lintResult && (
          <Modal
            title="Problems with this workflow"
            description="These are found by reading the workflow. Fixing them here saves a failed run later."
            modalWidth={ModalWidth.Large}
            submitButtonText="Close"
            submitButtonStyleType={ButtonStyleType.NORMAL}
            onSubmit={() => {
              setShowIssuesModal(false);
            }}
          >
            <div className="space-y-2">
              {lintResult.issues.map(
                (issue: WorkflowLintIssue, i: number): ReactElement => {
                  const isError: boolean =
                    issue.severity === WorkflowLintSeverity.Error;

                  return (
                    <div
                      key={i}
                      className={`rounded-md border p-3 ${
                        isError
                          ? "border-red-200 bg-red-50"
                          : "border-amber-200 bg-amber-50"
                      }`}
                    >
                      <p
                        className={`text-xs font-semibold uppercase tracking-wider ${
                          isError ? "text-red-700" : "text-amber-700"
                        }`}
                      >
                        {issue.componentId || "This workflow"}
                      </p>
                      <p className="text-sm text-gray-700 mt-1">
                        {issue.message}
                      </p>
                    </div>
                  );
                },
              )}
            </div>
          </Modal>
        )}

        {showRunSuccessConfirmation && (
          <ConfirmModal
            title={`Workflow Triggered`}
            description={`Your workflow has been scheduled to execute. Check the Logs tab to monitor the run.`}
            submitButtonText={"Got it"}
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
