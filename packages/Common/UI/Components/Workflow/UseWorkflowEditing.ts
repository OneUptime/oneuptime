import { WorkflowGraphToShow } from "./Workflow";
import WorkflowAutosave, { WorkflowAutosaveStatus } from "./WorkflowAutosave";
import {
  WorkflowCanvasGraph,
  isAnyCardBeingDragged,
  toWorkflowCanvasGraph,
} from "./WorkflowCanvasGraph";
import {
  WorkflowEditCause,
  WorkflowEditHistory,
  WorkflowHistoryDirection,
  WorkflowHistoryStep,
  canRedoWorkflowEdit,
  canUndoWorkflowEdit,
  getShownWorkflowEntry,
  getWorkflowHistoryStep,
  recordWorkflowEdit,
  redoWorkflowEdit,
  startWorkflowEditHistory,
  undoWorkflowEdit,
} from "./WorkflowEditHistory";
import {
  getWorkflowHistoryShortcut,
  shouldWorkflowHandleHistoryShortcut,
} from "./WorkflowHistoryShortcuts";
import { WorkflowSaveState } from "./WorkflowStatusBar";
import { loadComponentsAndCategories } from "./Utils";
import { useUnsavedChanges } from "../../Utils/NewVersion/UnsavedChanges";
import ComponentMetadata from "../../../Types/Workflow/Component";
import { WorkflowComponentLookup } from "../../../Utils/Workflow/WorkflowGraphChanges";
import {
  SavedWorkflowGraph,
  getEmptyWorkflowGraph,
  toSavedWorkflowGraph,
} from "../../../Utils/Workflow/WorkflowGraphSnapshot";
import { MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import { Edge, Node } from "reactflow";

/*
 * EDITING A WORKFLOW IN THE BUILDER, AROUND ITS CANVAS (issue #6188): what the
 * canvas reports is taken into the undo history (WorkflowEditHistory) and
 * saved (WorkflowAutosave); Undo, Redo, a restored version and what Ask AI
 * saved are handed back to the canvas to draw (graphToShow), where it is,
 * and saved the same way. ⌘Z / Ctrl+Z and the redo shortcuts work anywhere
 * on the page except where someone is typing (WorkflowHistoryShortcuts).
 *
 * While anything is not saved yet - a save on its way, or one that failed -
 * leaving the page asks first, and OneUptime does not reload the page for a
 * new version. Leaving the builder sends what is waiting at once.
 *
 * Nothing is taken in or saved while `isEnabled` is false: before the
 * workflow has opened, and for someone who may only look at it.
 */

export interface UseWorkflowEditingOptions {
  isEnabled: boolean;
  // Saves the graph to the workflow; throws when the server refuses it.
  save: (graph: SavedWorkflowGraph) => Promise<void>;
  // Why a save failed, in the reader's words.
  describeError: (error: unknown) => string;
  // A failed save, said once as it fails; the status pill keeps saying it.
  onSaveFailed?: ((message: string) => void) | undefined;
  // A graph that could not be drawn: a version with a step OneUptime no longer has.
  onError: (message: string) => void;
}

export interface UseWorkflowEditingResult {
  // The workflow as it opened, which the canvas starts from.
  start: (graph: WorkflowCanvasGraph) => void;
  // Everything the canvas reports, as it draws it.
  onCanvasUpdated: (nodes: Array<Node>, edges: Array<Edge>) => void;
  // The graph the canvas is handed to draw, or null.
  graphToShow: WorkflowGraphToShow | null;
  undo: () => void;
  redo: () => void;
  // What Undo and Redo would do, or null when there is nothing to.
  undoStep: WorkflowHistoryStep | null;
  redoStep: WorkflowHistoryStep | null;
  /*
   * Puts an earlier version on the canvas, as a step Undo takes back, and
   * saves it at once. False when the version cannot be drawn.
   */
  restoreVersion: (data: { versionNumber: number; graph: unknown }) => boolean;
  // What Ask AI saved, on the canvas: a step of its own, already saved.
  showSavedGraph: (graph: unknown) => boolean;
  saveStatus: WorkflowAutosaveStatus;
  retrySave: () => void;
  // The graph the canvas shows, as it is saved.
  shownGraph: SavedWorkflowGraph;
  components: Array<ComponentMetadata>;
}

const useWorkflowEditing: (
  options: UseWorkflowEditingOptions,
) => UseWorkflowEditingResult = (
  options: UseWorkflowEditingOptions,
): UseWorkflowEditingResult => {
  // The options of the latest render, for the handlers kept across renders.
  const optionsRef: MutableRefObject<UseWorkflowEditingOptions> =
    useRef<UseWorkflowEditingOptions>(options);
  optionsRef.current = options;

  const components: Array<ComponentMetadata> = useMemo(() => {
    return loadComponentsAndCategories().components;
  }, []);

  const lookup: WorkflowComponentLookup = useMemo(() => {
    const byId: Map<string, ComponentMetadata> = new Map<
      string,
      ComponentMetadata
    >(
      components.map(
        (component: ComponentMetadata): [string, ComponentMetadata] => {
          return [component.id, component];
        },
      ),
    );

    return (componentId: string): ComponentMetadata | undefined => {
      return byId.get(componentId);
    };
  }, [components]);

  /*
   * The history, in state for drawing and in a ref for the handlers that
   * read it between renders: two reports in one frame must each see the
   * other.
   */
  const [history, setHistoryState] = useState<WorkflowEditHistory | null>(null);
  const historyRef: MutableRefObject<WorkflowEditHistory | null> =
    useRef<WorkflowEditHistory | null>(null);

  const setHistory: (next: WorkflowEditHistory) => void = (
    next: WorkflowEditHistory,
  ): void => {
    historyRef.current = next;
    setHistoryState(next);
  };

  const [graphToShow, setGraphToShow] = useState<WorkflowGraphToShow | null>(
    null,
  );
  const revisionRef: MutableRefObject<number> = useRef<number>(0);

  const [saveStatus, setSaveStatus] = useState<WorkflowAutosaveStatus>({
    state: WorkflowSaveState.Idle,
    error: "",
    hasUnsavedChanges: false,
    savedCount: 0,
  });

  const autosaveRef: MutableRefObject<WorkflowAutosave | null> =
    useRef<WorkflowAutosave | null>(null);

  if (!autosaveRef.current) {
    autosaveRef.current = new WorkflowAutosave({
      save: (graph: SavedWorkflowGraph): Promise<void> => {
        return optionsRef.current.save(graph);
      },
      describeError: (error: unknown): string => {
        return optionsRef.current.describeError(error);
      },
      onStatusChange: (status: WorkflowAutosaveStatus): void => {
        setSaveStatus(status);
      },
    });
  }

  const autosave: WorkflowAutosave = autosaveRef.current;

  /*
   * A save that fails is said once, as it fails - not again with every edit
   * that fails the same way while the server is down. Once a save lands, or
   * nothing is left unsaved, the next failure is said again; so is one that
   * fails for another reason.
   */
  const toldFailureRef: MutableRefObject<string | null> = useRef<string | null>(
    null,
  );

  useEffect(() => {
    if (saveStatus.state !== WorkflowSaveState.Error) {
      if (!saveStatus.hasUnsavedChanges) {
        toldFailureRef.current = null;
      }

      return;
    }

    if (toldFailureRef.current === saveStatus.error) {
      return;
    }

    toldFailureRef.current = saveStatus.error;
    optionsRef.current.onSaveFailed?.(saveStatus.error);
  }, [saveStatus.state, saveStatus.error, saveStatus.hasUnsavedChanges]);

  // Leaving the builder sends what is waiting at once.
  useEffect(() => {
    return () => {
      void autosave.flush();
      autosave.dispose();
    };
  }, []);

  // Leaving the page while something is not saved asks first.
  useEffect(() => {
    if (!saveStatus.hasUnsavedChanges) {
      return undefined;
    }

    const warn: (event: BeforeUnloadEvent) => void = (
      event: BeforeUnloadEvent,
    ): void => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warn);

    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [saveStatus.hasUnsavedChanges]);

  useUnsavedChanges(saveStatus.hasUnsavedChanges);

  // Hands a graph to the canvas; false when it cannot be drawn.
  const draw: (graph: unknown) => WorkflowCanvasGraph | null = (
    graph: unknown,
  ): WorkflowCanvasGraph | null => {
    try {
      return toWorkflowCanvasGraph({ graph, components });
    } catch (error) {
      optionsRef.current.onError(
        error instanceof Error && error.message ? error.message : String(error),
      );
      return null;
    }
  };

  const handToCanvas: (canvasGraph: WorkflowCanvasGraph) => void = (
    canvasGraph: WorkflowCanvasGraph,
  ): void => {
    revisionRef.current++;
    setGraphToShow({
      revision: revisionRef.current,
      nodes: canvasGraph.nodes,
      edges: canvasGraph.edges,
    });
  };

  const start: (graph: WorkflowCanvasGraph) => void = (
    graph: WorkflowCanvasGraph,
  ): void => {
    const saved: SavedWorkflowGraph = toSavedWorkflowGraph(graph);

    setHistory(startWorkflowEditHistory({ graph: saved, now: Date.now() }));
    autosave.start(saved);
  };

  const onCanvasUpdated: (nodes: Array<Node>, edges: Array<Edge>) => void = (
    nodes: Array<Node>,
    edges: Array<Edge>,
  ): void => {
    const current: WorkflowEditHistory | null = historyRef.current;

    if (!optionsRef.current.isEnabled || !current) {
      return;
    }

    // A drag is one edit, taken in where the card is dropped.
    if (isAnyCardBeingDragged(nodes)) {
      return;
    }

    const saved: SavedWorkflowGraph = toSavedWorkflowGraph({ nodes, edges });
    const next: WorkflowEditHistory = recordWorkflowEdit(current, {
      graph: saved,
      now: Date.now(),
    });

    if (next !== current) {
      setHistory(next);
    }

    autosave.change(saved);
  };

  const move: (
    step: (history: WorkflowEditHistory) => WorkflowEditHistory,
  ) => void = (
    step: (history: WorkflowEditHistory) => WorkflowEditHistory,
  ): void => {
    const current: WorkflowEditHistory | null = historyRef.current;

    if (!optionsRef.current.isEnabled || !current) {
      return;
    }

    const next: WorkflowEditHistory = step(current);

    if (next === current) {
      return;
    }

    const graph: SavedWorkflowGraph = getShownWorkflowEntry(next).graph;
    const canvasGraph: WorkflowCanvasGraph | null = draw(graph);

    if (!canvasGraph) {
      return;
    }

    setHistory(next);
    handToCanvas(canvasGraph);
    autosave.change(graph);
  };

  const undo: () => void = (): void => {
    move(undoWorkflowEdit);
  };

  const redo: () => void = (): void => {
    move(redoWorkflowEdit);
  };

  const restoreVersion: (data: {
    versionNumber: number;
    graph: unknown;
  }) => boolean = (data: {
    versionNumber: number;
    graph: unknown;
  }): boolean => {
    const current: WorkflowEditHistory | null = historyRef.current;

    if (!optionsRef.current.isEnabled || !current) {
      return false;
    }

    const canvasGraph: WorkflowCanvasGraph | null = draw(data.graph);

    if (!canvasGraph) {
      return false;
    }

    const saved: SavedWorkflowGraph = toSavedWorkflowGraph(canvasGraph);
    const next: WorkflowEditHistory = recordWorkflowEdit(current, {
      graph: saved,
      now: Date.now(),
      cause: WorkflowEditCause.Restore,
      restoredVersionNumber: data.versionNumber,
    });

    // The canvas shows that version already: nothing to restore.
    if (next === current) {
      return true;
    }

    setHistory(next);
    handToCanvas(canvasGraph);
    autosave.change(saved);
    void autosave.flush();

    return true;
  };

  const showSavedGraph: (graph: unknown) => boolean = (
    graph: unknown,
  ): boolean => {
    const canvasGraph: WorkflowCanvasGraph | null = draw(graph);

    if (!canvasGraph) {
      return false;
    }

    const saved: SavedWorkflowGraph = toSavedWorkflowGraph(canvasGraph);
    const current: WorkflowEditHistory | null = historyRef.current;

    if (current) {
      const next: WorkflowEditHistory = recordWorkflowEdit(current, {
        graph: saved,
        now: Date.now(),
        cause: WorkflowEditCause.AskAi,
      });

      if (next !== current) {
        setHistory(next);
      }
    }

    autosave.acceptSavedGraph(saved);
    handToCanvas(canvasGraph);

    return true;
  };

  // The latest undo and redo, for the shortcut handler kept from the first render.
  const undoRef: MutableRefObject<() => void> = useRef<() => void>(undo);
  const redoRef: MutableRefObject<() => void> = useRef<() => void>(redo);
  undoRef.current = undo;
  redoRef.current = redo;

  useEffect(() => {
    const onKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (!optionsRef.current.isEnabled) {
        return;
      }

      const direction: WorkflowHistoryDirection | null =
        getWorkflowHistoryShortcut(event);

      if (!direction) {
        return;
      }

      if (
        !shouldWorkflowHandleHistoryShortcut({
          event,
          page: typeof document === "undefined" ? null : document,
        })
      ) {
        return;
      }

      event.preventDefault();

      if (direction === WorkflowHistoryDirection.Undo) {
        undoRef.current();
      } else {
        redoRef.current();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const undoStep: WorkflowHistoryStep | null = useMemo(() => {
    return history && canUndoWorkflowEdit(history)
      ? getWorkflowHistoryStep({
          history,
          direction: WorkflowHistoryDirection.Undo,
          lookup,
        })
      : null;
  }, [history, lookup]);

  const redoStep: WorkflowHistoryStep | null = useMemo(() => {
    return history && canRedoWorkflowEdit(history)
      ? getWorkflowHistoryStep({
          history,
          direction: WorkflowHistoryDirection.Redo,
          lookup,
        })
      : null;
  }, [history, lookup]);

  return {
    start,
    onCanvasUpdated,
    graphToShow,
    undo,
    redo,
    undoStep,
    redoStep,
    restoreVersion,
    showSavedGraph,
    saveStatus,
    retrySave: (): void => {
      void autosave.retry();
    },
    shownGraph: history
      ? getShownWorkflowEntry(history).graph
      : getEmptyWorkflowGraph(),
    components,
  };
};

export default useWorkflowEditing;
