import PageComponentProps from "../../PageComponentProps";
import ChartSkeleton from "Common/UI/Components/Skeleton/ChartSkeleton";
import EventName from "../../../Utils/EventName";
import URL from "Common/Types/API/URL";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import useRunWatch, {
  FetchLatestRunFunction,
  UseRunWatchResult,
  WatchedRunDetail,
} from "Common/UI/Components/Workflow/UseRunWatch";
import WorkflowLogModal from "Common/UI/Components/Workflow/WorkflowLogModal";
import RunAgainButton from "Common/UI/Components/Workflow/RunAgain/RunAgainButton";
import {
  fetchLatestWorkflowRun,
  sendRunAgain,
} from "Common/UI/Components/Workflow/RunAgain/RunAgainSource";
import { NodeDataProp } from "Common/Types/Workflow/Component";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CARD_FRAME_CLASS_NAME } from "Common/UI/Components/Card/Card";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Dictionary from "Common/Types/Dictionary";
import { WorkflowLintResult } from "Common/UI/Components/Workflow/GraphLint";
import { buildStepTitlesByNodeId } from "Common/UI/Components/Workflow/GraphLintSummary";
import WorkflowIssuesModal from "Common/UI/Components/Workflow/WorkflowIssuesModal";
import useWorkflowEnabled, {
  UseWorkflowEnabledResult,
} from "Common/UI/Components/Workflow/UseWorkflowEnabled";
import WorkflowEnabledSwitch from "Common/UI/Components/Workflow/WorkflowEnabledSwitch";
import WorkflowTurnedOffNotice from "Common/UI/Components/Workflow/WorkflowTurnedOffNotice";
import {
  getLockedReason,
  getWorkflowEditGate,
  getWorkflowRunGate,
  getWorkflowStepRunGate,
} from "Common/UI/Components/Workflow/WorkflowRunGate";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import WorkflowStatusBar, {
  WorkflowSaveState,
} from "Common/UI/Components/Workflow/WorkflowStatusBar";
import useWorkflowEditing, {
  UseWorkflowEditingResult,
} from "Common/UI/Components/Workflow/UseWorkflowEditing";
import {
  WorkflowGraphRevision,
  WorkflowSavedGraphRead,
} from "Common/UI/Components/Workflow/WorkflowAutosave";
import { isWorkflowSaveConflict } from "Common/UI/Components/Workflow/WorkflowSaveConflict";
import WorkflowSaveConflictModal from "Common/UI/Components/Workflow/WorkflowSaveConflictModal";
import {
  WORKFLOW_GRAPH_REVISION_KEY,
  readWorkflowGraphRevision,
} from "Common/Types/Workflow/WorkflowGraphRevision";
import WorkflowUndoRedoButtons from "Common/UI/Components/Workflow/WorkflowUndoRedoButtons";
import WorkflowVersionHistory from "Common/UI/Components/Workflow/WorkflowVersionHistory";
import { WorkflowVersionCopy } from "Common/UI/Components/Workflow/WorkflowVersionPresentation";
import {
  WorkflowCanvasGraph,
  toWorkflowCanvasGraph,
} from "Common/UI/Components/Workflow/WorkflowCanvasGraph";
import {
  SavedWorkflowGraph,
  toSavedWorkflowGraph,
} from "Common/Utils/Workflow/WorkflowGraphSnapshot";
import {
  WorkflowVersionOfSave,
  getStepsSavedElsewhere,
  getWorkflowVersionsToRead,
  isAskAiSaveAlone,
} from "Common/UI/Components/Workflow/WorkflowSavedElsewhere";
import WorkflowVersion from "Common/Models/DatabaseModels/WorkflowVersion";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  WorkflowAddButton,
  getWorkflowAddButton,
  workflowHasTrigger,
} from "Common/UI/Components/Workflow/WorkflowAddButton";
import Workflow from "Common/UI/Components/Workflow/Workflow";
import {
  getWebhookSecretKeySelect,
  resetWebhookSecretKey,
} from "Common/UI/Components/Workflow/WorkflowWebhookSecretKey";
import {
  getIncomingEmailSecretKeySelect,
  resetIncomingEmailSecretKey,
} from "Common/UI/Components/Workflow/WorkflowIncomingEmailSecretKey";
import Select from "Common/Types/BaseDatabase/Select";
import { WORKFLOW_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import WorkflowModel from "Common/Models/DatabaseModels/Workflow";
import { WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE } from "Common/Types/Workflow/WorkflowArchive";
import { subscribeToArchiveStateChanges } from "../../../Components/Archive/ArchiveStateEvents";
import {
  CustomRoleSummary,
  loadCustomRoleGrants,
  loadCustomRoles,
} from "../../../Components/CustomRole/CustomRoleOptions";
import {
  WorkflowRunAsLockedReasons,
  WorkflowRunAsState,
  canCurrentUserGiveWorkflowRunAs,
  getWorkflowRunAsLockedReasons,
} from "Common/UI/Components/Workflow/WorkflowRunAsGate";
import {
  WorkflowRunAs,
  readWorkflowRunAs,
} from "Common/Types/Workflow/WorkflowRunAs";
import { TeamPermissionGrant } from "Common/UI/Utils/GrantablePermission";
import ProjectUtil from "Common/UI/Utils/Project";
import WorkflowPlanNotice, {
  doesCurrentPlanRunWorkflows,
} from "../../../Components/Workflow/WorkflowPlanNotice";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Edge, Node } from "reactflow";
import { useAsyncEffect } from "use-async-effect";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";

/*
 * The toolbar over the canvas, drawn as a card is (CARD_FRAME_CLASS_NAME):
 * its border, corners, shadow and ground, so the dark theme draws it as it
 * draws every card. It used to be drawn with inline styles of its own - 10px
 * corners where a card has 12px, a shadow no card has - and was the one box
 * on the page whose look did not come from the shared classes (#9194).
 *
 * Its two halves - what was done to the workflow, and what can be run -
 * share a row while they fit and wrap whole on a phone. Every button in it
 * is the shared Button at its normal size, so Undo, Redo, Version history,
 * Add and Run Workflow are one height (38px, a card header's control).
 */
export const WORKFLOW_TOOLBAR_CLASS_NAME: string = `${CARD_FRAME_CLASS_NAME} mb-3 flex flex-wrap items-center justify-between gap-3 px-4 py-3`;

// A row of the toolbar's controls; a whole control wraps at a time.
export const WORKFLOW_TOOLBAR_GROUP_CLASS_NAME: string =
  "flex flex-wrap items-center gap-x-3 gap-y-2";

// The switch and the buttons: a little more room beside the switch.
export const WORKFLOW_TOOLBAR_RUN_GROUP_CLASS_NAME: string =
  "flex flex-wrap items-center gap-x-4 gap-y-3";

/*
 * Where the canvas will be while the graph loads: a card the canvas's own
 * height (Workflow's calc(100vh - 220px), at least 400px), so nothing moves
 * when the canvas takes its place.
 */
export const WORKFLOW_CANVAS_LOADING_CLASS_NAME: string = `${CARD_FRAME_CLASS_NAME} flex h-[calc(100vh-220px)] min-h-[400px] items-center justify-center`;

/*
 * The revision of the graph a workflow was read at (Workflow.graphRevision),
 * or null when it did not say: a save then says nothing of the graph it was
 * made to, and is made over whatever the workflow holds, as before.
 */
const getGraphRevision: (workflow: WorkflowModel) => WorkflowGraphRevision = (
  workflow: WorkflowModel,
): WorkflowGraphRevision => {
  return readWorkflowGraphRevision(workflow.graphRevision) ?? null;
};

const Delete: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [nodes, setNodes] = useState<Array<Node>>([]);
  const [edges, setEdges] = useState<Array<Edge>>([]);
  const [error, setError] = useState<string>("");
  /*
   * An archived workflow does not run, from any trigger, whatever its
   * Enabled switch says. The banner above every one of its pages says so and
   * offers Unarchive; the Builder only has to stop offering to turn it on.
   */
  const [isArchived, setIsArchived] = useState<boolean>(false);
  /*
   * The Webhook trigger's URL is built from this key, and its settings show,
   * copy and reset it. Only loaded when the user may read it: see
   * WorkflowWebhookSecretKey.
   */
  const [webhookSecretKey, setWebhookSecretKey] = useState<string>("");
  const [canSeeWebhookSecretKey, setCanSeeWebhookSecretKey] =
    useState<boolean>(false);
  /*
   * The same for the Incoming Email trigger's address, which is built from
   * this key: see WorkflowIncomingEmailSecretKey.
   */
  const [incomingEmailSecretKey, setIncomingEmailSecretKey] =
    useState<string>("");
  const [canSeeIncomingEmailSecretKey, setCanSeeIncomingEmailSecretKey] =
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
      return await fetchLatestWorkflowRun(modelId);
    };

  const runWatch: UseRunWatchResult = useRunWatch({
    fetchLatestRun: fetchLatestRun,
  });

  /*
   * Whether the workflow is turned on, and its Enabled switch at the top of
   * the page. Off pauses the workflow's trigger, not a person testing it:
   * Run Workflow and Run just this step go ahead either way, and a run
   * started while it is off is a test run, which the run panel, the run and
   * the run lists say ("Why do I have to enable a workflow in order to test
   * run it?" - it used to be held behind a dialog that asked to turn the
   * workflow on first). See UseWorkflowEnabled.
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
    onError: (message: string): void => {
      setError(message);
    },
  });

  // Unarchived from the banner on this page: the Builder follows at once.
  useEffect(() => {
    return subscribeToArchiveStateChanges({
      modelType: WorkflowModel,
      modelId: modelId,
      onChange: (newValue: boolean) => {
        setIsArchived(newValue);
      },
    });
  }, [modelId.toString()]);

  /*
   * A run of an archived workflow is refused by the server whether or not
   * the workflow is on, test runs included, so it is not sent: say why
   * instead, in the server's own words.
   */
  const refuseRunWhileArchived: () => boolean = (): boolean => {
    if (!isArchived) {
      return false;
    }

    setError(WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE);
    return true;
  };

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

  /*
   * A workflow that runs as more than Default (#9695) is changed, and run
   * by hand, only by who holds what it runs as: anyone else gets the
   * Builder as a view, its run buttons locked, each saying why in the
   * server's words. Turning it off is still theirs; turning it on is not.
   * Worked out once the workflow says what it runs as; until then nothing
   * is locked for it, and the server decides.
   */
  const [runAsLock, setRunAsLock] = useState<WorkflowRunAsLockedReasons>({});

  const canTurnWorkflowOnOrOff: boolean =
    (enabledSwitchGate.isAllowed || !enabledSwitchGate.disabledReason) &&
    !(runAsLock.change && workflowEnabled.isEnabled === false);
  const enabledSwitchDisabledReason: string | undefined =
    enabledSwitchGate.disabledReason || runAsLock.change;

  /*
   * Run Workflow is for the workflow's editors and for Workflow Members, who
   * run workflows without changing them; "Run just this step" is for its
   * editors alone. Someone who may not sees the button locked, saying why.
   * Read on every render: the permission snapshot arrives on a response
   * header and may land after the first paint, and until it has the buttons
   * work and the server decides (WorkflowRunGate).
   */
  const runLockedReason: string | undefined =
    getLockedReason(getWorkflowRunGate()) || runAsLock.run;
  const stepRunLockedReason: string | undefined =
    getLockedReason(getWorkflowStepRunGate()) || runAsLock.run;

  /*
   * Someone who may open the workflow but not change it - a Workflow Member,
   * who runs workflows, or a viewer - gets the Builder as a view
   * (Common/UI/Components/Workflow/WorkflowViewOnly): the add button locked,
   * saying why, the save pill saying "View only", a canvas where nothing
   * moves, and steps that open to be read. Nothing is saved: every save of
   * the graph would be refused, and each refusal used to come back as an
   * error dialog. Read on every render, like the run gates.
   */
  const editLockedReason: string | undefined =
    getLockedReason(getWorkflowEditGate()) || runAsLock.change;
  const isViewOnly: boolean = Boolean(editLockedReason);

  /*
   * Undo, Redo and the autosave (issue #6188): what the canvas reports is
   * taken into the undo history and saved a moment later, one save at a
   * time, so what is saved is always what the canvas shows; Undo and Redo
   * hand the canvas the graph to show, which is saved the same way. A save
   * that fails is said once, here, and the save pill keeps saying it with a
   * Try again; the canvas keeps what was not saved. Nothing is saved for a
   * view, or before the workflow has opened. See UseWorkflowEditing.
   *
   * Each save names the revision of the graph it was made to (issue #6257),
   * so one made to an older graph than the workflow holds - a teammate
   * saved since, or the API - is refused instead of replacing their change.
   * The workflow is read then, and the dialog below says what they changed
   * and lets the person choose. Alone on a workflow, a save is one request,
   * as it always was: the revision it lands at is one more than it named.
   */
  const editing: UseWorkflowEditingResult = useWorkflowEditing({
    isEnabled: !isViewOnly && !isLoading,
    save: async (
      graph: SavedWorkflowGraph,
      basedOn: WorkflowGraphRevision,
    ): Promise<WorkflowGraphRevision> => {
      await ModelAPI.updateById({
        modelType: WorkflowModel,
        id: modelId,
        data: {
          graph: graph as unknown as JSONObject,
        },
        miscDataProps:
          basedOn === null
            ? undefined
            : { [WORKFLOW_GRAPH_REVISION_KEY]: basedOn },
      });

      return basedOn === null ? null : basedOn + 1;
    },
    isConflict: isWorkflowSaveConflict,
    readSaved: async (): Promise<WorkflowSavedGraphRead | null> => {
      const workflow: WorkflowModel | null = await ModelAPI.getItem({
        modelType: WorkflowModel,
        id: modelId,
        select: {
          graph: true,
          graphRevision: true,
        },
        requestOptions: {},
      });

      return workflow
        ? {
            graph: workflow.graph || null,
            revision: getGraphRevision(workflow),
          }
        : null;
    },
    describeError: (error: unknown): string => {
      return API.getFriendlyMessage(error);
    },
    onSaveFailed: (message: string): void => {
      setError(message);
    },
    onError: (message: string): void => {
      setError(message);
    },
  });

  // The Version history panel, beside the canvas.
  const [showVersionHistory, setShowVersionHistory] = useState<boolean>(false);

  /*
   * Ask AI changed this workflow, from the panel beside this page: what is on
   * the canvas is out of date, and a save made to it would be refused as made
   * to an older graph. A save still waiting for its moment is dropped: what
   * Ask AI read to change it did not have it, but what was typed a moment
   * before is not worth losing what was just approved. Ask AI's change is
   * drawn where the canvas is, as a step of its own, so Undo takes it back -
   * and what was dropped with it. It is never asked about as someone else's
   * change: a save refused for it meanwhile is answered by this, and its
   * dialog closes. Read through a ref, as the page's functions are rebuilt
   * on every render.
   */
  const reloadGraph: React.MutableRefObject<() => void> = useRef<() => void>(
    () => {},
  );

  useEffect(() => {
    type ChangedEvent = (event: CustomEvent) => void;

    const onChanged: ChangedEvent = (event: CustomEvent): void => {
      if (event.detail?.["workflowId"] === modelId.toString()) {
        reloadGraph.current();
      }
    };

    GlobalEvents.addEventListener(EventName.WORKFLOW_CHANGED_BY_AI, onChanged);

    return () => {
      GlobalEvents.removeEventListener(
        EventName.WORKFLOW_CHANGED_BY_AI,
        onChanged,
      );
    };
  }, [modelId.toString()]);

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

  /*
   * Why the workflow is locked for the signed-in person, by what it runs as
   * (WorkflowRunAsGate): nothing for Default. For a custom role, its
   * permissions and name are read; when they cannot be, nothing is locked
   * here and the server decides.
   */
  const readRunAsLock: (
    workflow: WorkflowModel,
  ) => Promise<WorkflowRunAsLockedReasons> = async (
    workflow: WorkflowModel,
  ): Promise<WorkflowRunAsLockedReasons> => {
    const runAs: WorkflowRunAs | null = readWorkflowRunAs(workflow.runAs);

    if (runAs === WorkflowRunAs.Default) {
      return {};
    }

    let roleName: string | undefined = undefined;
    let roleGrants: Array<TeamPermissionGrant> = [];
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (runAs === WorkflowRunAs.CustomRole) {
      if (!workflow.runAsCustomRoleId || !projectId) {
        return {};
      }

      try {
        const roleId: string = workflow.runAsCustomRoleId
          .toString()
          .toLowerCase();

        roleName = (await loadCustomRoles({ projectId: projectId })).find(
          (role: CustomRoleSummary): boolean => {
            return role.id.toLowerCase() === roleId;
          },
        )?.name;

        for (const [id, grants] of await loadCustomRoleGrants({
          projectId: projectId,
          customRoleId: workflow.runAsCustomRoleId,
        })) {
          if (id.toLowerCase() === roleId) {
            roleGrants = grants;
          }
        }
      } catch {
        return {};
      }

      if (!roleName) {
        return {};
      }
    }

    const state: WorkflowRunAsState = {
      runAs: workflow.runAs,
      roleName: roleName,
      roleGrants: roleGrants,
    };

    return getWorkflowRunAsLockedReasons({
      state: state,
      mayAct: canCurrentUserGiveWorkflowRunAs(state),
    });
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
      const incomingEmailSecretKeySelect: Select<WorkflowModel> =
        getIncomingEmailSecretKeySelect();

      const workflow: WorkflowModel | null = await ModelAPI.getItem({
        modelType: WorkflowModel,
        id: modelId,
        select: {
          graph: true,
          // Which graph the first save is made to.
          graphRevision: true,
          name: true,
          // Read by the Enabled switch and the notice shown while it is off.
          isEnabled: true,
          isArchived: true,
          // Who may change it and run it by hand (#9695).
          runAs: true,
          runAsCustomRoleId: true,
          ...webhookSecretKeySelect,
          ...incomingEmailSecretKeySelect,
        },
        requestOptions: {},
      });

      if (workflow) {
        const lock: WorkflowRunAsLockedReasons = await readRunAsLock(workflow);

        setRunAsLock(lock);

        /*
         * The keys of a workflow that runs as more than Default come back
         * only to who may change it: anyone else is told the address is
         * hidden, as anyone who may not read the column is.
         */
        setCanSeeWebhookSecretKey(
          Boolean(webhookSecretKeySelect.webhookSecretKey) && !lock.change,
        );
        setWebhookSecretKey(workflow.webhookSecretKey || "");
        setCanSeeIncomingEmailSecretKey(
          Boolean(incomingEmailSecretKeySelect.incomingEmailSecretKey) &&
            !lock.change,
        );
        setIncomingEmailSecretKey(
          workflow.incomingEmailSecretKey?.toString() || "",
        );
        setWorkflowName(workflow.name || "");
        setIsArchived(Boolean(workflow.isArchived));
        workflowEnabled.setLoadedIsEnabled(
          typeof workflow.isEnabled === "boolean" ? workflow.isEnabled : null,
        );

        /*
         * The graph as the canvas draws it: each step with its component's
         * catalog entry, what its checks said when it was saved cleared (it
         * is stale by definition, and the checks run again as it is drawn),
         * and the dashed card where there is no trigger yet
         * (WorkflowCanvasGraph). It is where Undo starts, and what the
         * server has.
         */
        const canvasGraph: WorkflowCanvasGraph = toWorkflowCanvasGraph({
          graph: workflow.graph,
          components: editing.components,
        });

        editing.start(canvasGraph, getGraphRevision(workflow));
        setNodes(canvasGraph.nodes);
        setEdges(canvasGraph.edges);
      } else {
        setError("Workflow not found");
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  /*
   * The newest versions of the workflow, for whose each save was; none when
   * they cannot be read, and what was saved is then drawn as one step.
   */
  const readNewestVersions: (
    limit: number,
  ) => Promise<Array<WorkflowVersionOfSave>> = async (
    limit: number,
  ): Promise<Array<WorkflowVersionOfSave>> => {
    try {
      const result: ListResult<WorkflowVersion> =
        await ModelAPI.getList<WorkflowVersion>({
          modelType: WorkflowVersion,
          query: {
            workflowId: modelId,
          },
          skip: 0,
          limit: limit,
          select: {
            versionNumber: true,
            graph: true,
            savedThrough: true,
          },
          sort: {
            versionNumber: SortOrder.Descending,
          },
        });

      return result.data.map(
        (version: WorkflowVersion): WorkflowVersionOfSave => {
          return {
            versionNumber: version.versionNumber || 0,
            graph: version.graph,
            savedThrough: version.savedThrough || null,
          };
        },
      );
    } catch {
      return [];
    }
  };

  /*
   * What Ask AI saved, drawn where the canvas is: a step of its own, which
   * Undo takes back. The workflow is read again for its graph and its name,
   * all Ask AI changes; before the canvas has opened it is simply opened.
   *
   * Saved more than once since this Builder knew it - someone saved before
   * Ask AI's change was approved, and it was made on top of their save
   * (issue #6274) - the newest versions say whose each save was, and each
   * is a step of its own: Undo takes back Ask AI's change alone, and their
   * work only when the person undoes that too (WorkflowSavedElsewhere).
   */
  const showWhatAskAiSaved: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const workflow: WorkflowModel | null = await ModelAPI.getItem({
        modelType: WorkflowModel,
        id: modelId,
        select: {
          graph: true,
          graphRevision: true,
          name: true,
        },
        requestOptions: {},
      });

      if (!workflow) {
        setError("Workflow not found");
        return;
      }

      setWorkflowName(workflow.name || "");

      const revision: WorkflowGraphRevision = getGraphRevision(workflow);
      const known: WorkflowSavedGraphRead | null = editing.getKnownSaved();
      const knownRevision: WorkflowGraphRevision = known
        ? known.revision
        : null;

      if (isAskAiSaveAlone({ known: knownRevision, server: revision })) {
        editing.showSavedGraph(workflow.graph || null, revision);
        return;
      }

      const versions: Array<WorkflowVersionOfSave> = await readNewestVersions(
        getWorkflowVersionsToRead({ known: knownRevision, server: revision }),
      );

      editing.showSavedGraphs(
        getStepsSavedElsewhere({
          known: known ? toSavedWorkflowGraph(known.graph) : null,
          server: workflow.graph || null,
          versions: versions,
        }),
        revision,
      );
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
  };

  reloadGraph.current = (): void => {
    if (isLoading) {
      void loadGraph();
      return;
    }

    void showWhatAskAiSaved();
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
   * The toolbar's add button says what the workflow needs next: Add Trigger
   * while it has no trigger, since nothing can start it yet, then Add
   * Component. It opens the panel it names (WorkflowAddButton). `nodes` is
   * the graph as the canvas last reported it, so the label changes as soon
   * as the first trigger is added or the last one is deleted.
   */
  const addButton: WorkflowAddButton = getWorkflowAddButton(nodes);

  /*
   * A workflow without a trigger has one thing to do first: choose what
   * starts it. So until it has one, Add Trigger is the page's primary button,
   * and the off notice waits. The notice says the trigger is paused and that
   * Run Workflow tests it - neither is true of a workflow with nothing to
   * start it - and its Turn on workflow would be a second primary button
   * beside Add Trigger. With the first trigger the notice appears, and Add
   * Component is a plain button beside Run Workflow.
   */
  const hasTrigger: boolean = workflowHasTrigger(nodes);

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

  type SendRunAgainFromBuilderFunction = (runId: string) => Promise<void>;

  /*
   * Run again, with what an earlier run started with, followed as any run from
   * here is. Rejects with the reason it did not start, for the dialog that
   * asked to say: it is not sent while archived, as a run is not.
   */
  const sendRunAgainFromBuilder: SendRunAgainFromBuilderFunction = async (
    runId: string,
  ): Promise<void> => {
    if (isArchived) {
      throw new Error(WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE);
    }

    await runWatch.captureRunBeforeTrigger();
    await sendRunAgain(runId);
    startWatchingRun();
  };

  type StartRunFunction = (send: () => Promise<void>) => Promise<void>;

  /*
   * Sends a run as it was asked for, whether the workflow is on or off, and
   * shows a refusal as the server words it. An archived workflow is not sent
   * at all: the server refuses it whatever the switch says.
   */
  const startRun: StartRunFunction = async (
    send: () => Promise<void>,
  ): Promise<void> => {
    if (refuseRunWhileArchived()) {
      return;
    }

    try {
      await send();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
  };

  return (
    <Fragment>
      <>
        {/* Toolbar */}
        <div
          className={WORKFLOW_TOOLBAR_CLASS_NAME}
          data-testid="workflow-toolbar"
        >
          {/*
           * Undo and Redo, the Version history, and then the save state, the
           * run this builder started, and what the static checks make of the
           * graph: what has been done to the workflow, on the toolbar's
           * start, and what can be run, on its end. Undo and Redo are for
           * whoever may change the workflow; anyone who may open it may read
           * its history. They wait for the workflow to open, like the add
           * button.
           */}
          <div
            className={WORKFLOW_TOOLBAR_GROUP_CLASS_NAME}
            data-testid="workflow-toolbar-history"
          >
            {!isLoading && !isViewOnly ? (
              <WorkflowUndoRedoButtons
                undoStep={editing.undoStep}
                redoStep={editing.redoStep}
                onUndo={editing.undo}
                onRedo={editing.redo}
              />
            ) : (
              <></>
            )}
            {!isLoading ? (
              <Button
                title={WorkflowVersionCopy.openButton}
                icon={IconProp.Clock}
                buttonStyle={ButtonStyleType.OUTLINE}
                className="whitespace-nowrap"
                dataTestId="workflow-version-history-button"
                ariaHaspopup="dialog"
                ariaExpanded={showVersionHistory}
                onClick={() => {
                  setShowVersionHistory(true);
                }}
              />
            ) : (
              <></>
            )}
            {/*
              Save state, the run this builder started, and what the static
              checks make of the graph. Both the run and the checks open
              something: the run its log, the checks the list where a step's
              problems can be fixed.
            */}
            <WorkflowStatusBar
              saveState={editing.saveStatus.state}
              saveError={editing.saveStatus.error}
              onRetrySave={editing.retrySave}
              readOnlyReason={editLockedReason}
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
          </div>

          <div
            className={WORKFLOW_TOOLBAR_RUN_GROUP_CLASS_NAME}
            data-testid="workflow-toolbar-run"
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
                    : enabledSwitchDisabledReason
                }
                onChange={(isEnabled: boolean) => {
                  void workflowEnabled.setIsEnabled(isEnabled);
                }}
              />
            ) : (
              <></>
            )}
            {/*
             * The buttons share a row while they fit, on a phone too, and
             * wrap a whole button at a time: a label never breaks inside its
             * button (whitespace-nowrap). The row's gap spaces them, and a
             * button that starts a row lines up with the switch above it.
             */}
            <div
              data-testid="workflow-toolbar-buttons"
              className={WORKFLOW_TOOLBAR_GROUP_CLASS_NAME}
            >
              {/*
               * Only once the graph has loaded, like the Enabled switch:
               * drawn before then, it would say Add Trigger for a workflow
               * that has a trigger.
               */}
              {!isLoading ? (
                <Button
                  title={addButton.title}
                  icon={IconProp.Add}
                  /*
                   * Primary while the workflow needs its trigger - unless
                   * the reader may not add one: then it is locked, saying
                   * why, and it is not the page's next step.
                   */
                  buttonStyle={
                    hasTrigger || isViewOnly
                      ? ButtonStyleType.NORMAL
                      : ButtonStyleType.PRIMARY
                  }
                  className="whitespace-nowrap"
                  disabled={isViewOnly}
                  tooltip={editLockedReason}
                  dataTestId="workflow-add-button"
                  onClick={() => {
                    if (isViewOnly) {
                      return;
                    }

                    setShowComponentPickerModal(true);
                  }}
                />
              ) : (
                <></>
              )}
              <Button
                title="Run Workflow"
                icon={IconProp.Play}
                buttonStyle={ButtonStyleType.SUCCESS_OUTLINE}
                className="whitespace-nowrap"
                disabled={Boolean(runLockedReason)}
                tooltip={runLockedReason}
                dataTestId="run-workflow-button"
                onClick={() => {
                  if (runLockedReason) {
                    return;
                  }

                  setShowRunModal(true);
                }}
              />
            </div>
          </div>
        </div>

        {/*
         * Said up front: off pauses the trigger, the workflow can still be
         * tested with Run Workflow, and the one thing to do about it. Only
         * once there is a trigger to pause: until then the workflow's first
         * step is Add Trigger (hasTrigger).
         */}
        {/*
         * A project whose plan runs no workflows (the Free plan on OneUptime
         * Cloud) is told so first: nothing starts this workflow, on or off,
         * so the off notice and its Turn on workflow would promise what
         * never happens. One notice at a time.
         */}
        {!doesCurrentPlanRunWorkflows() ? (
          <WorkflowPlanNotice className="mb-3" />
        ) : workflowEnabled.isEnabled === false && !isArchived && hasTrigger ? (
          <div className="mb-3">
            <WorkflowTurnedOffNotice
              onTurnOn={
                canTurnWorkflowOnOrOff
                  ? () => {
                      void workflowEnabled.setIsEnabled(true);
                    }
                  : undefined
              }
              isTurningOn={workflowEnabled.isSaving}
              // Run Workflow still tests it - for whoever may run it.
              canTest={!runLockedReason}
            />
          </div>
        ) : (
          <></>
        )}

        {/* Canvas */}
        {isLoading ? (
          <div
            className={WORKFLOW_CANVAS_LOADING_CLASS_NAME}
            data-testid="workflow-canvas-loading"
          >
            <ChartSkeleton hasLegend={false} fillsHeight={true} />
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
            incomingEmailSecretKey={incomingEmailSecretKey}
            canSeeIncomingEmailSecretKey={canSeeIncomingEmailSecretKey}
            onResetIncomingEmailSecretKey={async (): Promise<void> => {
              /*
               * Saved straight away, like the webhook URL's reset: the old
               * address stops working the moment this resolves. Also gives a
               * workflow its first address, when the Incoming Email trigger
               * is opened before the graph that added it was saved.
               */
              const secretKey: string =
                await resetIncomingEmailSecretKey(modelId);

              setIncomingEmailSecretKey(secretKey);
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
            // Off: the Run Workflow panel says the run will be a test run.
            runsAreTestRuns={workflowEnabled.isEnabled === false && !isArchived}
            openStepForNodeId={stepToOpenNodeId}
            onStepOpened={() => {
              setStepToOpenNodeId(null);
            }}
            initialEdges={edges}
            // Undo, Redo, a restored version, what Ask AI saved.
            graphToShow={editing.graphToShow}
            // A view: nothing on the canvas changes, and nothing is saved.
            editDisabledReason={editLockedReason}
            onWorkflowUpdated={(nodes: Array<Node>, edges: Array<Edge>) => {
              setNodes(nodes);
              setEdges(edges);

              /*
               * The canvas reports its graph as it draws it, a step's
               * selection included, even where nothing can change: taken in
               * only where it can (editing.isEnabled), and only what changed
               * the workflow is saved.
               */
              editing.onCanvasUpdated(nodes, edges);
            }}
            runStepDisabledReason={stepRunLockedReason}
            runDisabledReason={runLockedReason}
            onRunStep={async (component: NodeDataProp) => {
              await startRun(async (): Promise<void> => {
                await sendStepRun(component);
              });
            }}
            onRun={async (component: NodeDataProp) => {
              await startRun(async (): Promise<void> => {
                await sendWorkflowRun(component);
              });
            }}
            onRunAgain={sendRunAgainFromBuilder}
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
                    isTestRun: runWatch.run.isTestRun,
                    startedBy: runWatch.run.startedBy,
                    ranAs: runWatch.run.ranAs,
                  }
                : undefined
            }
            statusMessage={runWatch.message}
            isStatusMessageError={runWatch.hasFailed}
            isRunning={runWatch.isWatching}
            toolbar={
              runWatch.run?.canRunAgain && !runWatch.isWatching ? (
                <RunAgainButton
                  send={async (): Promise<void> => {
                    await sendRunAgainFromBuilder(
                      runWatch.run?.runId as string,
                    );
                  }}
                />
              ) : undefined
            }
            onClose={() => {
              setShowRunLogModal(false);
            }}
          />
        )}

        {/*
         * Someone else saved the workflow first: nothing is saved until the
         * person chooses. Behind an error, which is read first - one about
         * their version, say, that cannot be drawn.
         */}
        {editing.saveStatus.state === WorkflowSaveState.Conflict &&
        editing.saveStatus.conflict &&
        !error ? (
          <WorkflowSaveConflictModal
            conflict={editing.saveStatus.conflict}
            components={editing.components}
            onShowTheirChanges={() => {
              editing.showTheirChanges();
            }}
            onKeepMine={() => {
              editing.keepMine();
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

        {showVersionHistory ? (
          <WorkflowVersionHistory
            workflowId={modelId}
            refreshToken={editing.saveStatus.savedCount}
            currentGraph={editing.shownGraph}
            components={editing.components}
            restoreDisabledReason={editLockedReason}
            onRestore={(data: { versionNumber: number; graph: JSONObject }) => {
              editing.restoreVersion(data);
            }}
            onClose={() => {
              setShowVersionHistory(false);
            }}
          />
        ) : (
          <></>
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
