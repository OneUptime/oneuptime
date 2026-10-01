import PageComponentProps from "../../PageComponentProps";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import useRunWatch, {
  FetchLatestRunFunction,
  UseRunWatchResult,
  WatchedRunDetail,
} from "Common/UI/Components/Workflow/UseRunWatch";
import WorkflowLogModal from "Common/UI/Components/Workflow/WorkflowLogModal";
import { parseTrace } from "Common/Types/Workflow/StepTrace";
import ComponentMetadata, {
  ComponentCategory,
  ComponentType,
  NodeDataProp,
  NodeType,
} from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Dictionary from "Common/Types/Dictionary";
import { WorkflowLintResult } from "Common/UI/Components/Workflow/GraphLint";
import { buildStepTitlesByNodeId } from "Common/UI/Components/Workflow/GraphLintSummary";
import WorkflowIssuesModal from "Common/UI/Components/Workflow/WorkflowIssuesModal";
import useWorkflowEnabled, {
  UseWorkflowEnabledResult,
  WorkflowRunKind,
} from "Common/UI/Components/Workflow/UseWorkflowEnabled";
import WorkflowEnabledSwitch from "Common/UI/Components/Workflow/WorkflowEnabledSwitch";
import WorkflowTurnedOffNotice from "Common/UI/Components/Workflow/WorkflowTurnedOffNotice";
import WorkflowTurnOnModal from "Common/UI/Components/Workflow/WorkflowTurnOnModal";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import WorkflowStatusBar, {
  WorkflowSaveState,
} from "Common/UI/Components/Workflow/WorkflowStatusBar";
import { loadComponentsAndCategories } from "Common/UI/Components/Workflow/Utils";
import Workflow, {
  getEdgeDefaultProps,
  getPlaceholderTriggerNode,
} from "Common/UI/Components/Workflow/Workflow";
import {
  getWebhookSecretKeySelect,
  resetWebhookSecretKey,
} from "Common/UI/Components/Workflow/WorkflowWebhookSecretKey";
import Select from "Common/Types/BaseDatabase/Select";
import { WORKFLOW_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import WorkflowModel from "Common/Models/DatabaseModels/Workflow";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import { Edge, Node } from "reactflow";
import { useAsyncEffect } from "use-async-effect";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";

const Delete: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [saveState, setSaveState] = useState<WorkflowSaveState>(
    WorkflowSaveState.Idle,
  );
  const [saveTimeout, setSaveTimeout] = useState<ReturnType<
    typeof setTimeout
  > | null>(null);
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [nodes, setNodes] = useState<Array<Node>>([]);
  const [edges, setEdges] = useState<Array<Edge>>([]);
  const [error, setError] = useState<string>("");
  /*
   * The Webhook trigger's URL is built from this key, and its settings show,
   * copy and reset it. Only loaded when the user may read it: see
   * WorkflowWebhookSecretKey.
   */
  const [webhookSecretKey, setWebhookSecretKey] = useState<string>("");
  const [canSeeWebhookSecretKey, setCanSeeWebhookSecretKey] =
    useState<boolean>(false);
  // Names a run downloaded from the run modal, and heads its log.
  const [workflowName, setWorkflowName] = useState<string>("");

  const [showComponentPickerModal, setShowComponentPickerModal] =
    useState<boolean>(false);

  const [showRunModal, setShowRunModal] = useState<boolean>(false);

  const [lintResult, setLintResult] = useState<WorkflowLintResult | null>(null);
  const [showIssuesModal, setShowIssuesModal] = useState<boolean>(false);

  const [showRunLogModal, setShowRunLogModal] = useState<boolean>(false);

  /*
   * The step the builder picked out of the issues list. The canvas owns the
   * settings modal, so opening one from outside is a request it clears once it
   * has acted on it.
   */
  const [stepToOpenNodeId, setStepToOpenNodeId] = useState<string | null>(null);

  /*
   * The run the builder started, followed until it settles. See
   * RunStatusWatcher for why this is a poll rather than something the run
   * endpoint hands back, and UseRunWatch for the watch itself.
   *
   * Each poll asks the API for the run's log and steps as well as its status,
   * so the run log modal fills in while the run goes.
   */
  const fetchLatestRun: FetchLatestRunFunction =
    async (): Promise<WatchedRunDetail | null> => {
      const result: ListResult<WorkflowLog> =
        await ModelAPI.getList<WorkflowLog>({
          modelType: WorkflowLog,
          query: { workflowId: modelId },
          limit: 1,
          skip: 0,
          select: {
            _id: true,
            workflowStatus: true,
            logs: true,
            stepTrace: true,
            // A run downloaded from the modal is named and headed with these.
            createdAt: true,
            startedAt: true,
            completedAt: true,
          },
          sort: { createdAt: SortOrder.Descending },
        });

      const latest: WorkflowLog | undefined = result.data[0];

      if (!latest || !latest._id) {
        return null;
      }

      return {
        runId: latest._id.toString(),
        status: latest.workflowStatus as WorkflowStatus,
        logs: latest.logs || "",
        stepTrace: parseTrace((latest.stepTrace as JSONValue) || null),
        scheduledAt: latest.createdAt || null,
        startedAt: latest.startedAt || null,
        completedAt: latest.completedAt || null,
      };
    };

  const runWatch: UseRunWatchResult = useRunWatch({
    fetchLatestRun: fetchLatestRun,
  });

  /*
   * Whether the workflow is turned on, its Enabled switch at the top of the
   * page, and what a run started while it is off does: it is held, and a
   * dialog offers to turn the workflow on and then run it. That used to be
   * an Error dialog saying "This workflow is not enabled", with no way to
   * turn it on and no word of where the switch was. See UseWorkflowEnabled.
   */
  const workflowEnabled: UseWorkflowEnabledResult = useWorkflowEnabled({
    saveIsEnabled: async (isEnabled: boolean): Promise<void> => {
      await ModelAPI.updateById<WorkflowModel>({
        modelType: WorkflowModel,
        id: modelId,
        data: {
          isEnabled: isEnabled,
        },
      });
    },
    fetchIsEnabled: async (): Promise<boolean | null> => {
      const workflow: WorkflowModel | null = await ModelAPI.getItem({
        modelType: WorkflowModel,
        id: modelId,
        select: {
          isEnabled: true,
        },
        requestOptions: {},
      });

      return typeof workflow?.isEnabled === "boolean"
        ? workflow.isEnabled
        : null;
    },
    onError: (message: string): void => {
      setError(message);
    },
  });

  /*
   * Turning the workflow on or off is an edit of the workflow, gated like
   * one. Someone who may not still sees the switch, disabled, with the
   * permission they would need. Before the permission snapshot has landed
   * there is nothing honest to say, so the switch is offered and the server
   * decides.
   */
  const enabledSwitchGate: PermissionGateResult = useMemo(() => {
    return PermissionGate.check(new WorkflowModel(), ModelAction.Update, {
      verb: "edit",
    });
  }, []);

  const canTurnWorkflowOnOrOff: boolean =
    enabledSwitchGate.isAllowed || !enabledSwitchGate.disabledReason;

  type StartWatchingRunFunction = () => void;

  const startWatchingRun: StartWatchingRunFunction = (): void => {
    runWatch.startWatchingRun();

    /*
     * The run is the thing the user just asked for, so show it rather than
     * leaving them to go and find it. Closing the modal does not stop the
     * watch — the toolbar keeps reporting, and reopens this.
     */
    setShowRunLogModal(true);
  };

  const loadGraph: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);

      /*
       * Asking for a column the user cannot read fails the whole request, and
       * the key is readable only by people who can edit the workflow. Anyone
       * else still gets the builder; the Webhook trigger then says who can
       * see its URL.
       */
      const webhookSecretKeySelect: Select<WorkflowModel> =
        getWebhookSecretKeySelect();

      const workflow: WorkflowModel | null = await ModelAPI.getItem({
        modelType: WorkflowModel,
        id: modelId,
        select: {
          graph: true,
          name: true,
          // Read by the Enabled switch and the notice shown while it is off.
          isEnabled: true,
          ...webhookSecretKeySelect,
        },
        requestOptions: {},
      });

      if (workflow) {
        setCanSeeWebhookSecretKey(
          Boolean(webhookSecretKeySelect.webhookSecretKey),
        );
        setWebhookSecretKey(workflow.webhookSecretKey || "");
        setWorkflowName(workflow.name || "");
        workflowEnabled.setLoadedIsEnabled(
          typeof workflow.isEnabled === "boolean" ? workflow.isEnabled : null,
        );

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
    setSaveState(WorkflowSaveState.Saving);

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

          setSaveState(WorkflowSaveState.Saved);
        } catch (err) {
          setError(API.getFriendlyMessage(err));

          setSaveState(WorkflowSaveState.Error);
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

  /*
   * The canvas names its own nodes, and the issues panel should call a step
   * what the canvas calls it rather than only quoting the id it was given.
   */
  const stepTitlesByNodeId: Dictionary<string> = buildStepTitlesByNodeId(nodes);

  /*
   * The trigger, named by the dialog that turns the workflow on: from then on
   * it starts the workflow too. Not a Manual trigger, which nothing but Run
   * Workflow starts.
   */
  const triggerNode: Node | undefined = nodes.find((node: Node) => {
    return (
      node.data?.componentType === ComponentType.Trigger &&
      node.data?.nodeType === NodeType.Node
    );
  });

  const triggerTitleForTurnOn: string | undefined =
    triggerNode && triggerNode.data?.metadataId !== ComponentID.Manual
      ? triggerNode.data?.metadata?.title || undefined
      : undefined;

  type SendRunFunction = (component: NodeDataProp) => Promise<void>;

  // Run just this step. Rejects with the API's error when it is refused.
  const sendStepRun: SendRunFunction = async (
    component: NodeDataProp,
  ): Promise<void> => {
    await runWatch.captureRunBeforeTrigger();

    const result: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.post(
      {
        url: URL.fromString(WORKFLOW_URL.toString()).addRoute(
          "/run-step/" + modelId.toString(),
        ),
        data: {
          componentId: component.id,
        },
        headers: ModelAPI.getCommonHeaders(),
      },
    );

    if (result instanceof HTTPErrorResponse) {
      throw result;
    }

    startWatchingRun();
  };

  // Run Workflow, with the trigger's values from the run panel.
  const sendWorkflowRun: SendRunFunction = async (
    component: NodeDataProp,
  ): Promise<void> => {
    await runWatch.captureRunBeforeTrigger();

    const result: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.post(
      {
        url: URL.fromString(WORKFLOW_URL.toString()).addRoute(
          "/manual/run/" + modelId.toString(),
        ),
        data: {
          data: component.arguments,
        },
        /*
         * /workflow/manual/run is a custom route, so it gets no tenant header
         * unless the call site adds one. It needs the header to check the
         * caller is a member of the workflow's project before running it.
         */
        headers: ModelAPI.getCommonHeaders(),
      },
    );

    if (result instanceof HTTPErrorResponse) {
      throw result;
    }

    startWatchingRun();
  };

  return (
    <Fragment>
      <>
        {/* Toolbar */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
            padding: "0.75rem 1rem",
            backgroundColor: "var(--ou-surface-primary, #ffffff)",
            borderRadius: "10px",
            border: "1px solid var(--ou-border-default, #e2e8f0)",
            marginBottom: "0.75rem",
            boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.03)",
          }}
        >
          {/*
            Save state, the run this builder started, and what the static
            checks make of the graph. Both the run and the checks open
            something: the run its log, the checks the list where a step's
            problems can be fixed.
          */}
          <WorkflowStatusBar
            saveState={saveState}
            lintResult={lintResult}
            runStatusMessage={runWatch.message}
            runStatusFailed={runWatch.hasFailed}
            onShowRunLog={() => {
              setShowRunLogModal(true);
            }}
            onShowIssues={() => {
              setShowIssuesModal(true);
            }}
          />

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            {/*
             * Only once the workflow has said whether it is on: a switch
             * drawn before then would show "off" for a workflow that is on.
             */}
            {workflowEnabled.isEnabled !== null ? (
              <WorkflowEnabledSwitch
                isEnabled={workflowEnabled.isEnabled}
                isSaving={workflowEnabled.isSaving}
                disabledReason={
                  canTurnWorkflowOnOrOff
                    ? undefined
                    : enabledSwitchGate.disabledReason
                }
                onChange={(isEnabled: boolean) => {
                  void workflowEnabled.setIsEnabled(isEnabled);
                }}
              />
            ) : (
              <></>
            )}
            <div
              style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
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
        </div>

        {/*
         * Said up front, so nobody has to find out from a refused run that
         * the workflow is off, with the one thing to do about it.
         */}
        {workflowEnabled.isEnabled === false ? (
          <div style={{ marginBottom: "0.75rem" }}>
            <WorkflowTurnedOffNotice
              onTurnOn={
                canTurnWorkflowOnOrOff
                  ? () => {
                      void workflowEnabled.setIsEnabled(true);
                    }
                  : undefined
              }
              isTurningOn={workflowEnabled.isSaving}
            />
          </div>
        ) : (
          <></>
        )}

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
            canSeeWebhookSecretKey={canSeeWebhookSecretKey}
            onResetWebhookSecretKey={async (): Promise<void> => {
              /*
               * Saved straight away, not with the graph: the old URL stops
               * working the moment this resolves. A failure is shown by the
               * Webhook trigger's confirmation, which stays open for it.
               */
              const secretKey: string = await resetWebhookSecretKey(modelId);

              setWebhookSecretKey(secretKey);
            }}
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
            openStepForNodeId={stepToOpenNodeId}
            onStepOpened={() => {
              setStepToOpenNodeId(null);
            }}
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
              await workflowEnabled.run({
                kind: WorkflowRunKind.Step,
                stepTitle: component.metadata?.title || component.id,
                run: async (): Promise<void> => {
                  await sendStepRun(component);
                },
              });
            }}
            onRun={async (component: NodeDataProp) => {
              await workflowEnabled.run({
                kind: WorkflowRunKind.Workflow,
                run: async (): Promise<void> => {
                  await sendWorkflowRun(component);
                },
              });
            }}
          />
        )}

        {showRunLogModal && (
          <WorkflowLogModal
            title="Workflow Run"
            description="This is the run you just started."
            logs={runWatch.logs}
            stepTrace={runWatch.stepTrace}
            run={
              runWatch.run
                ? {
                    runId: runWatch.run.runId,
                    workflowId: modelId.toString(),
                    workflowName: workflowName,
                    status: runWatch.run.status,
                    scheduledAt: runWatch.run.scheduledAt,
                    startedAt: runWatch.run.startedAt,
                    completedAt: runWatch.run.completedAt,
                  }
                : undefined
            }
            statusMessage={runWatch.message}
            isStatusMessageError={runWatch.hasFailed}
            isRunning={runWatch.isWatching}
            onClose={() => {
              setShowRunLogModal(false);
            }}
          />
        )}

        {/*
         * After the canvas, so it opens over a step's settings: Run just this
         * step is pressed in there.
         */}
        {workflowEnabled.heldRun ? (
          <WorkflowTurnOnModal
            attempt={workflowEnabled.heldRun}
            triggerTitle={triggerTitleForTurnOn}
            canTurnOn={canTurnWorkflowOnOrOff}
            isTurningOn={workflowEnabled.isTurningOn}
            error={workflowEnabled.turnOnError}
            onTurnOn={() => {
              void workflowEnabled.turnOnAndRun();
            }}
            onClose={() => {
              workflowEnabled.dismissHeldRun();
            }}
          />
        ) : (
          <></>
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
          <WorkflowIssuesModal
            lintResult={lintResult}
            stepTitlesByNodeId={stepTitlesByNodeId}
            onClose={() => {
              setShowIssuesModal(false);
            }}
            onGoToStep={(nodeId: string) => {
              /*
               * The settings modal the canvas is about to open would otherwise
               * come up behind this one.
               */
              setShowIssuesModal(false);
              setStepToOpenNodeId(nodeId);
            }}
          />
        )}
      </>
    </Fragment>
  );
};

export default Delete;
