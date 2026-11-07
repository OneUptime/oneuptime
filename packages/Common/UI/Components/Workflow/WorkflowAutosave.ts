import { WorkflowSaveState } from "./WorkflowStatusBar";
import {
  SavedWorkflowGraph,
  getWorkflowGraphKey,
  toSavedWorkflowGraph,
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
 * A save says which graph it was made to (issue #6257): the revision of the
 * graph the server had when this builder last knew it (Workflow
 * .graphRevision). Someone else may have saved a newer graph since - a
 * teammate in another builder, Ask AI, the API - and then the server refuses
 * the save (isConflict) rather than let it replace their change unseen. What
 * the server has then is read (readSaved), and it is:
 *
 *   - the graph this save sends: the server has it already - an answer that
 *     never arrived - and it is taken as saved;
 *   - the graph the change was made to: only the count moved (the same
 *     graph saved again, a write between the check and the save), so the
 *     save is sent again on the new revision without a word, up to
 *     WORKFLOW_AUTOSAVE_SILENT_RESENDS times;
 *   - anything else: someone else changed the workflow. Nothing more is sent
 *     - the state is Conflict, with what they saved (`conflict`) - until the
 *     person chooses: their changes, drawn by the page and handed back with
 *     acceptSavedGraph, or their own over them (keepMine). Their change
 *     stays in the version history either way, and the person's in Undo.
 *
 * The page tells it what the server has when the workflow is opened
 * (start), and again when the graph was saved by someone else - Ask AI, or
 * their changes shown (acceptSavedGraph). React-free, with its timer handed
 * in, so a test drives the clock.
 */

export const WORKFLOW_AUTOSAVE_DELAY_IN_MS: number = 1000;

/*
 * How many times in a row a refused save is sent again by itself, when the
 * server's graph is still the one the change was made to.
 */
export const WORKFLOW_AUTOSAVE_SILENT_RESENDS: number = 3;

/*
 * The revision of a graph the server has (Workflow.graphRevision): how many
 * times its graph has been saved. Null when it is not known - a save then
 * says nothing of what it was made to, and is made over whatever is there.
 */
export type WorkflowGraphRevision = number | null;

/*
 * Someone else saved the workflow after this builder last knew what it held:
 * their graph, its revision, and the graph the change on the canvas was made
 * to - what they changed is what lies between the two.
 */
export interface WorkflowSaveConflict {
  theirs: SavedWorkflowGraph;
  revision: WorkflowGraphRevision;
  base: SavedWorkflowGraph;
}

export interface WorkflowAutosaveStatus {
  state: WorkflowSaveState;
  // Why the last save failed, or "".
  error: string;
  // Whether the canvas shows something the server does not have.
  hasUnsavedChanges: boolean;
  // How many saves have landed - this builder's, and the ones it took in: grows by one with each.
  savedCount: number;
  // While the state is Conflict: what someone else saved. Null otherwise.
  conflict: WorkflowSaveConflict | null;
}

// What the server has now, as readSaved reads it.
export interface WorkflowSavedGraphRead {
  graph: unknown;
  revision: WorkflowGraphRevision;
}

export type WorkflowAutosaveTimer = unknown;

export interface WorkflowAutosaveOptions {
  /*
   * Sends the graph, made to the graph the server had at `basedOn`, and
   * resolves with the revision the server is at once it has it (nothing:
   * not known). Throws when it is refused.
   */
  save: (
    graph: SavedWorkflowGraph,
    basedOn: WorkflowGraphRevision,
  ) => Promise<WorkflowGraphRevision | void>;
  // Told every time the status changes.
  onStatusChange: (status: WorkflowAutosaveStatus) => void;
  /*
   * Whether a refusal says the server has a newer graph than the one the
   * save was made to. None: every refusal is a failure.
   */
  isConflict?: ((error: unknown) => boolean) | undefined;
  // What the server has now; null when the workflow is gone.
  readSaved?: (() => Promise<WorkflowSavedGraphRead | null>) | undefined;
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

// A graph the server has, as far as this builder knows.
interface ServerGraph {
  graph: SavedWorkflowGraph;
  key: string;
  revision: WorkflowGraphRevision;
}

// The graph the canvas shows, while the server does not have it.
interface CanvasGraph {
  graph: SavedWorkflowGraph;
  key: string;
}

enum SendOutcomeKind {
  // The server has the graph sent, at `revision`.
  Saved = "Saved",
  // Refused for any other reason, said in `message`.
  Failed = "Failed",
  // Someone else saved `theirs` over the graph the change was made to.
  Conflict = "Conflict",
  // The workflow was opened again, or saved by someone else, meanwhile: this save says nothing now.
  Superseded = "Superseded",
}

type SendOutcome =
  | { kind: SendOutcomeKind.Saved; revision: WorkflowGraphRevision }
  | { kind: SendOutcomeKind.Failed; message: string }
  | {
      kind: SendOutcomeKind.Conflict;
      theirs: ServerGraph;
    }
  | { kind: SendOutcomeKind.Superseded };

const serverGraphOf: (
  graph: SavedWorkflowGraph,
  revision: WorkflowGraphRevision,
) => ServerGraph = (
  graph: SavedWorkflowGraph,
  revision: WorkflowGraphRevision,
): ServerGraph => {
  return { graph, key: getWorkflowGraphKey(graph), revision };
};

export default class WorkflowAutosave {
  private options: WorkflowAutosaveOptions;

  // The graph the server has, and its revision.
  private saved: ServerGraph | null = null;

  // The graph the canvas shows, while the server does not have it.
  private latest: CanvasGraph | null = null;

  /*
   * What someone else saved over the graph the canvas's change was made to,
   * until the person chooses: nothing is sent meanwhile.
   */
  private conflict: { theirs: ServerGraph; base: SavedWorkflowGraph } | null =
    null;

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
    conflict: null,
  };

  public constructor(options: WorkflowAutosaveOptions) {
    this.options = options;
  }

  public getStatus(): WorkflowAutosaveStatus {
    return this.status;
  }

  // The workflow as opened: what the server has. Nothing is waiting to save.
  public start(
    graph: SavedWorkflowGraph,
    revision: WorkflowGraphRevision = null,
  ): void {
    this.generation++;
    this.cancelTimer();
    this.saved = serverGraphOf(graph, revision);
    this.latest = null;
    this.conflict = null;
    this.isSaveAgainAsked = false;
    this.setStatus({
      state: WorkflowSaveState.Idle,
      error: "",
      hasUnsavedChanges: false,
    });
  }

  /*
   * The server has `graph` now, saved by someone else (Ask AI, or a teammate
   * whose changes the person chose to see): a change still waiting for its
   * moment is dropped - it was made to the graph before - and nothing is
   * left to save, or to choose.
   */
  public acceptSavedGraph(
    graph: SavedWorkflowGraph,
    revision: WorkflowGraphRevision = null,
  ): void {
    this.generation++;
    this.cancelTimer();
    this.saved = serverGraphOf(graph, revision);
    this.latest = null;
    this.conflict = null;
    this.isSaveAgainAsked = false;
    this.setStatus({
      state: WorkflowSaveState.Saved,
      error: "",
      hasUnsavedChanges: false,
      savedCount: this.status.savedCount + 1,
    });
  }

  // The canvas shows `graph` now: saved a moment after the last change.
  public change(graph: SavedWorkflowGraph): void {
    const key: string = getWorkflowGraphKey(graph);

    if (this.conflict) {
      // The canvas shows what they saved: the server has it, nothing to choose.
      if (key === this.conflict.theirs.key) {
        this.takeTheirs(this.conflict.theirs);
        return;
      }

      // Held: nothing goes over their change until the person chooses.
      this.latest = { graph, key };
      return;
    }

    if (key === this.saved?.key && !this.inFlight) {
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
   * The person keeps what the canvas shows, over what someone else saved:
   * it is saved at once, made to their graph, which stays in the version
   * history. Resolves once the server has it, the save failed, or someone
   * saved again meanwhile (Conflict once more).
   */
  public async keepMine(): Promise<void> {
    const conflict: { theirs: ServerGraph } | null = this.conflict;

    if (!conflict) {
      return;
    }

    this.conflict = null;
    this.saved = conflict.theirs;

    if (!this.latest || this.latest.key === this.saved.key) {
      this.latest = null;
      this.setStatus({
        state: WorkflowSaveState.Saved,
        error: "",
        hasUnsavedChanges: false,
      });
      return;
    }

    this.setStatus({
      state: WorkflowSaveState.Saving,
      error: "",
      hasUnsavedChanges: true,
    });

    await this.saveNow();
  }

  /*
   * Sends what is waiting now rather than in a moment: on leaving the page,
   * and after a restore. Resolves once the server has it, or the save failed.
   * Nothing is sent over someone else's change while the person chooses.
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

    if (this.conflict) {
      return;
    }

    const latest: CanvasGraph | null = this.latest;

    if (!latest || latest.key === this.saved?.key) {
      return;
    }

    const generation: number = this.generation;

    this.setStatus({
      state: WorkflowSaveState.Saving,
      error: "",
      hasUnsavedChanges: true,
    });

    let outcome: SendOutcome = { kind: SendOutcomeKind.Superseded };

    this.inFlight = (async (): Promise<void> => {
      outcome = await this.send(latest, generation);
    })();

    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }

    if (
      generation !== this.generation ||
      outcome.kind === SendOutcomeKind.Superseded
    ) {
      return;
    }

    if (outcome.kind === SendOutcomeKind.Failed) {
      this.isSaveAgainAsked = false;
      this.setStatus({
        state: WorkflowSaveState.Error,
        error: outcome.message,
        hasUnsavedChanges: true,
      });
      return;
    }

    if (outcome.kind === SendOutcomeKind.Conflict) {
      this.isSaveAgainAsked = false;
      this.cancelTimer();

      // The canvas went on to what they saved meanwhile: nothing to choose.
      if (this.latest?.key === outcome.theirs.key) {
        this.takeTheirs(outcome.theirs);
        return;
      }

      const base: SavedWorkflowGraph = (this.saved || outcome.theirs).graph;

      this.conflict = { theirs: outcome.theirs, base };
      this.setStatus({
        state: WorkflowSaveState.Conflict,
        error: "",
        hasUnsavedChanges: true,
        conflict: {
          theirs: outcome.theirs.graph,
          revision: outcome.theirs.revision,
          base,
        },
      });
      return;
    }

    this.saved = { graph: latest.graph, key: latest.key, revision: outcome.revision };

    const savedCount: number = this.status.savedCount + 1;
    const isAnythingLeft: boolean = Boolean(
      this.latest && this.latest.key !== this.saved.key,
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

  /*
   * One save of `latest`, made to the graph the server had when this
   * builder last knew it - and, when the server says it has a newer graph,
   * what that graph is (see the comment at the top).
   */
  private async send(
    latest: CanvasGraph,
    generation: number,
  ): Promise<SendOutcome> {
    let basedOn: WorkflowGraphRevision = this.saved?.revision ?? null;

    for (let resends: number = 0; ; resends++) {
      let refusal: unknown;

      try {
        const revision: WorkflowGraphRevision | void = await this.options.save(
          latest.graph,
          basedOn,
        );

        return {
          kind: SendOutcomeKind.Saved,
          revision: revision === undefined ? null : revision,
        };
      } catch (error) {
        refusal = error;
      }

      if (
        !this.options.readSaved ||
        !this.options.isConflict ||
        !this.options.isConflict(refusal)
      ) {
        return { kind: SendOutcomeKind.Failed, message: this.describe(refusal) };
      }

      if (generation !== this.generation) {
        return { kind: SendOutcomeKind.Superseded };
      }

      let read: WorkflowSavedGraphRead | null = null;

      try {
        read = await this.options.readSaved();
      } catch (error) {
        return { kind: SendOutcomeKind.Failed, message: this.describe(error) };
      }

      if (generation !== this.generation) {
        return { kind: SendOutcomeKind.Superseded };
      }

      if (!read) {
        return { kind: SendOutcomeKind.Failed, message: this.describe(refusal) };
      }

      const theirs: ServerGraph = serverGraphOf(
        toSavedWorkflowGraph(read.graph),
        read.revision,
      );

      // The server has what this save sends: an answer that never arrived.
      if (theirs.key === latest.key) {
        return { kind: SendOutcomeKind.Saved, revision: theirs.revision };
      }

      if (theirs.key !== this.saved?.key) {
        return { kind: SendOutcomeKind.Conflict, theirs };
      }

      // Only the count moved: the server still has the graph the change was made to.
      if (resends >= WORKFLOW_AUTOSAVE_SILENT_RESENDS) {
        return { kind: SendOutcomeKind.Failed, message: this.describe(refusal) };
      }

      this.saved = { ...(this.saved as ServerGraph), revision: theirs.revision };
      basedOn = theirs.revision;
    }
  }

  // The canvas shows what someone else saved: the server has it.
  private takeTheirs(theirs: ServerGraph): void {
    this.cancelTimer();
    this.saved = theirs;
    this.latest = null;
    this.conflict = null;
    this.isSaveAgainAsked = false;
    this.setStatus({
      state: WorkflowSaveState.Saved,
      error: "",
      hasUnsavedChanges: false,
      savedCount: this.status.savedCount + 1,
    });
  }

  private describe(error: unknown): string {
    return (this.options.describeError || describeErrorByDefault)(error);
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
    conflict?: WorkflowSaveConflict | null | undefined;
  }): void {
    const status: WorkflowAutosaveStatus = {
      state: next.state,
      error: next.error,
      hasUnsavedChanges: next.hasUnsavedChanges,
      savedCount: next.savedCount ?? this.status.savedCount,
      conflict: next.conflict ?? null,
    };

    if (
      status.state === this.status.state &&
      status.error === this.status.error &&
      status.hasUnsavedChanges === this.status.hasUnsavedChanges &&
      status.savedCount === this.status.savedCount &&
      status.conflict === this.status.conflict
    ) {
      return;
    }

    this.status = status;
    this.options.onStatusChange(status);
  }
}
