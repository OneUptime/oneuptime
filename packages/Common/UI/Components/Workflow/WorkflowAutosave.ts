import { WorkflowSaveState } from "./WorkflowStatusBar";
import {
  SavedWorkflowGraph,
  getWorkflowGraphKey,
} from "../../../Utils/Workflow/WorkflowGraphSnapshot";

/*
 * THE BUILDER'S AUTOSAVE: what is on the canvas, saved a moment after the
 * last change to it (issue #6188).
 *
 *   - What is saved is what the canvas shows. Each save sends the graph the
 *     canvas showed last, never one a timer kept from an earlier change, and
 *     one save is on its way at a time: a change made while a save is out is
 *     sent after it lands. Two saves out at once could land in either order
 *     and leave the server with the older graph - which the page used to
 *     risk whenever the canvas reported twice before it drew again.
 *   - A change that leaves the graph as the server has it - a card selected,
 *     a step moved and Undo pressed - sends nothing.
 *   - A burst of changes is one save, WORKFLOW_AUTOSAVE_DELAY_IN_MS after the
 *     last of them.
 *   - A save that fails keeps the graph on the canvas, says why (state
 *     Error, `error`), and is tried again with the next change or with
 *     retry(). Nothing is thrown away, and hasUnsavedChanges says there is
 *     something the server does not have, for the page to warn before it is
 *     closed.
 *
 * The page tells it what the server has when the workflow is opened
 * (start), and again when the graph was saved by someone else - Ask AI
 * (acceptSavedGraph). React-free, with its timer handed in, so a test drives
 * the clock.
 */

export const WORKFLOW_AUTOSAVE_DELAY_IN_MS: number = 1000;

export interface WorkflowAutosaveStatus {
  state: WorkflowSaveState;
  // Why the last save failed, or "".
  error: string;
  // Whether the canvas shows something the server does not have.
  hasUnsavedChanges: boolean;
  // How many saves have landed: grows by one with each.
  savedCount: number;
}

export type WorkflowAutosaveTimer = unknown;

export interface WorkflowAutosaveOptions {
  // Sends the graph; throws when it is refused.
  save: (graph: SavedWorkflowGraph) => Promise<void>;
  // Told every time the status changes.
  onStatusChange: (status: WorkflowAutosaveStatus) => void;
  // Why a save failed, in words; the error's own message unless given.
  describeError?: ((error: unknown) => string) | undefined;
  delayInMs?: number | undefined;
  setTimer?:
    | ((callback: () => void, delayInMs: number) => WorkflowAutosaveTimer)
    | undefined;
  clearTimer?: ((timer: WorkflowAutosaveTimer) => void) | undefined;
}

const describeErrorByDefault: (error: unknown) => string = (
  error: unknown,
): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return typeof error === "string" && error ? error : "Could not save.";
};

export default class WorkflowAutosave {
  private options: WorkflowAutosaveOptions;

  // The key of the graph the server has.
  private savedKey: string | null = null;

  // The graph the canvas shows, while the server does not have it.
  private latest: { graph: SavedWorkflowGraph; key: string } | null = null;

  private timer: WorkflowAutosaveTimer | null = null;
  private inFlight: Promise<void> | null = null;
  private isSaveAgainAsked: boolean = false;

  /*
   * Moves on whenever the server's graph is set from outside (start,
   * acceptSavedGraph): a save sent before then that lands after it says
   * nothing about what the server has now.
   */
  private generation: number = 0;

  private status: WorkflowAutosaveStatus = {
    state: WorkflowSaveState.Idle,
    error: "",
    hasUnsavedChanges: false,
    savedCount: 0,
  };

  public constructor(options: WorkflowAutosaveOptions) {
    this.options = options;
  }

  public getStatus(): WorkflowAutosaveStatus {
    return this.status;
  }

  // The workflow as opened: what the server has. Nothing is waiting to save.
  public start(graph: SavedWorkflowGraph): void {
    this.generation++;
    this.cancelTimer();
    this.savedKey = getWorkflowGraphKey(graph);
    this.latest = null;
    this.isSaveAgainAsked = false;
    this.setStatus({
      state: WorkflowSaveState.Idle,
      error: "",
      hasUnsavedChanges: false,
    });
  }

  /*
   * The server has `graph` now, saved by someone else (Ask AI): a change
   * still waiting for its moment is dropped - it was made to the graph
   * before - and nothing is left to save.
   */
  public acceptSavedGraph(graph: SavedWorkflowGraph): void {
    this.generation++;
    this.cancelTimer();
    this.savedKey = getWorkflowGraphKey(graph);
    this.latest = null;
    this.isSaveAgainAsked = false;
    this.setStatus({
      state: WorkflowSaveState.Saved,
      error: "",
      hasUnsavedChanges: false,
    });
  }

  // The canvas shows `graph` now: saved a moment after the last change.
  public change(graph: SavedWorkflowGraph): void {
    const key: string = getWorkflowGraphKey(graph);

    if (key === this.savedKey && !this.inFlight) {
      // Back to what the server has: nothing to save, nothing failed.
      this.cancelTimer();
      this.latest = null;

      if (this.status.hasUnsavedChanges) {
        this.setStatus({
          state:
            this.status.savedCount > 0
              ? WorkflowSaveState.Saved
              : WorkflowSaveState.Idle,
          error: "",
          hasUnsavedChanges: false,
        });
      }

      return;
    }

    if (this.latest?.key === key && (this.timer !== null || this.inFlight)) {
      // The same graph again, already on its way.
      return;
    }

    this.latest = { graph, key };
    this.cancelTimer();
    this.timer = this.setTimer((): void => {
      this.timer = null;
      void this.saveNow();
    }, this.options.delayInMs ?? WORKFLOW_AUTOSAVE_DELAY_IN_MS);

    this.setStatus({
      state: WorkflowSaveState.Saving,
      error: "",
      hasUnsavedChanges: true,
    });
  }

  /*
   * Sends what is waiting now rather than in a moment: on leaving the page,
   * and after a restore. Resolves once the server has it, or the save failed.
   */
  public async flush(): Promise<void> {
    if (this.timer !== null) {
      this.cancelTimer();
    }

    await this.saveNow();
  }

  // Tries again what failed to save (the Try again of the status pill).
  public async retry(): Promise<void> {
    await this.flush();
  }

  // The page is gone: nothing more is scheduled.
  public dispose(): void {
    this.cancelTimer();
  }

  private async saveNow(): Promise<void> {
    if (this.inFlight) {
      this.isSaveAgainAsked = true;
      await this.inFlight;
      return;
    }

    const latest: { graph: SavedWorkflowGraph; key: string } | null =
      this.latest;

    if (!latest || latest.key === this.savedKey) {
      return;
    }

    const generation: number = this.generation;

    this.setStatus({
      state: WorkflowSaveState.Saving,
      error: "",
      hasUnsavedChanges: true,
    });

    let failure: string | null = null;

    this.inFlight = (async (): Promise<void> => {
      try {
        await this.options.save(latest.graph);

        if (generation === this.generation) {
          this.savedKey = latest.key;
        }
      } catch (error) {
        failure = (this.options.describeError || describeErrorByDefault)(
          error,
        );
      }
    })();

    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }

    if (generation !== this.generation) {
      return;
    }

    if (failure !== null) {
      this.isSaveAgainAsked = false;
      this.setStatus({
        state: WorkflowSaveState.Error,
        error: failure,
        hasUnsavedChanges: true,
      });
      return;
    }

    const savedCount: number = this.status.savedCount + 1;
    const isAnythingLeft: boolean = Boolean(
      this.latest && this.latest.key !== this.savedKey,
    );

    if (!isAnythingLeft) {
      this.latest = null;
    }

    this.setStatus({
      state:
        isAnythingLeft && (this.timer !== null || this.isSaveAgainAsked)
          ? WorkflowSaveState.Saving
          : WorkflowSaveState.Saved,
      error: "",
      hasUnsavedChanges: isAnythingLeft,
      savedCount,
    });

    // A change made while this save was out, whose moment has come already.
    if (isAnythingLeft && this.isSaveAgainAsked) {
      this.isSaveAgainAsked = false;
      await this.saveNow();
    }
  }

  private setTimer(
    callback: () => void,
    delayInMs: number,
  ): WorkflowAutosaveTimer {
    return this.options.setTimer
      ? this.options.setTimer(callback, delayInMs)
      : setTimeout(callback, delayInMs);
  }

  private cancelTimer(): void {
    if (this.timer === null) {
      return;
    }

    if (this.options.clearTimer) {
      this.options.clearTimer(this.timer);
    } else {
      clearTimeout(this.timer as ReturnType<typeof setTimeout>);
    }

    this.timer = null;
  }

  private setStatus(next: {
    state: WorkflowSaveState;
    error: string;
    hasUnsavedChanges: boolean;
    savedCount?: number | undefined;
  }): void {
    const status: WorkflowAutosaveStatus = {
      state: next.state,
      error: next.error,
      hasUnsavedChanges: next.hasUnsavedChanges,
      savedCount: next.savedCount ?? this.status.savedCount,
    };

    if (
      status.state === this.status.state &&
      status.error === this.status.error &&
      status.hasUnsavedChanges === this.status.hasUnsavedChanges &&
      status.savedCount === this.status.savedCount
    ) {
      return;
    }

    this.status = status;
    this.options.onStatusChange(status);
  }
}
