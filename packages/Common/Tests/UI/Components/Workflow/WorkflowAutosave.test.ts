import { beforeEach, describe, expect, test } from "@jest/globals";
import WorkflowAutosave, {
  WORKFLOW_AUTOSAVE_DELAY_IN_MS,
  WorkflowAutosaveStatus,
} from "../../../../UI/Components/Workflow/WorkflowAutosave";
import { WorkflowSaveState } from "../../../../UI/Components/Workflow/WorkflowStatusBar";
import {
  SavedWorkflowGraph,
  getWorkflowGraphKey,
  toSavedWorkflowGraph,
} from "../../../../Utils/Workflow/WorkflowGraphSnapshot";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import {
  EMAIL,
  LOG,
  MANUAL,
  graphOf,
} from "../../../Utils/Workflow/WorkflowGraphFixtures";

/*
 * The builder's autosave (issue #6188): what is saved is what the canvas
 * shows, one save at a time, a moment after the last change - and a failed
 * save keeps what was not saved and says so.
 */

// A clock the test moves: timers fire only when it says so.
class TestClock {
  private timers: Array<{ id: number; at: number; callback: () => void }> = [];
  private nextId: number = 1;
  public now: number = 0;

  public set(callback: () => void, delayInMs: number): number {
    const id: number = this.nextId++;
    this.timers.push({ id, at: this.now + delayInMs, callback });
    return id;
  }

  public clear(id: unknown): void {
    this.timers = this.timers.filter((timer: { id: number }): boolean => {
      return timer.id !== id;
    });
  }

  public pending(): number {
    return this.timers.length;
  }

  public async advance(milliseconds: number): Promise<void> {
    const until: number = this.now + milliseconds;

    for (;;) {
      const due: Array<{ id: number; at: number; callback: () => void }> =
        this.timers
          .filter((timer: { at: number }): boolean => {
            return timer.at <= until;
          })
          .sort((a: { at: number }, b: { at: number }): number => {
            return a.at - b.at;
          });

      const first:
        | { id: number; at: number; callback: () => void }
        | undefined = due[0];

      if (!first) {
        break;
      }

      this.now = first.at;
      this.clear(first.id);
      first.callback();
      await settle();
    }

    this.now = until;
    await settle();
  }
}

// Lets every promise that can resolve do so.
const settle: () => Promise<void> = async (): Promise<void> => {
  for (let tick: number = 0; tick < 20; tick++) {
    await Promise.resolve();
  }
};

interface PendingSave {
  graph: SavedWorkflowGraph;
  resolve: () => void;
  reject: (error: unknown) => void;
}

const graphWith: (value: string) => SavedWorkflowGraph = (
  value: string,
): SavedWorkflowGraph => {
  return toSavedWorkflowGraph(graphOf([MANUAL, { ...LOG, args: { value } }]));
};

const SERVER: SavedWorkflowGraph = graphWith("as opened");

let clock: TestClock;
let saves: Array<PendingSave>;
let statuses: Array<WorkflowAutosaveStatus>;
let autosave: WorkflowAutosave;

const lastStatus: () => WorkflowAutosaveStatus = (): WorkflowAutosaveStatus => {
  return autosave.getStatus();
};

const savedValues: () => Array<string> = (): Array<string> => {
  return saves.map((save: PendingSave): string => {
    return (save.graph.nodes[1]?.["data"] as { arguments: { value: string } })
      .arguments.value;
  });
};

beforeEach(() => {
  clock = new TestClock();
  saves = [];
  statuses = [];
  autosave = new WorkflowAutosave({
    save: (graph: SavedWorkflowGraph): Promise<void> => {
      return new Promise<void>(
        (resolve: () => void, reject: (error: unknown) => void) => {
          saves.push({ graph, resolve, reject });
        },
      );
    },
    onStatusChange: (status: WorkflowAutosaveStatus): void => {
      statuses.push(status);
    },
    setTimer: (callback: () => void, delayInMs: number): unknown => {
      return clock.set(callback, delayInMs);
    },
    clearTimer: (timer: unknown): void => {
      clock.clear(timer);
    },
  });
  autosave.start(SERVER);
});

describe("opening the workflow", () => {
  test("nothing is waiting and nothing was saved: Ready", () => {
    expect(lastStatus()).toEqual({
      state: WorkflowSaveState.Idle,
      error: "",
      hasUnsavedChanges: false,
      savedCount: 0,
    });
  });

  test("the canvas reporting the graph the server has saves nothing - selecting a card included", async () => {
    autosave.change(SERVER);
    autosave.change(
      toSavedWorkflowGraph(
        graphOf([
          { ...MANUAL, withCanvasState: true, selected: true },
          { ...LOG, args: { value: "as opened" }, withCanvasState: true },
        ]),
      ),
    );
    await clock.advance(10 * WORKFLOW_AUTOSAVE_DELAY_IN_MS);

    expect(saves).toHaveLength(0);
    expect(lastStatus().state).toBe(WorkflowSaveState.Idle);
  });
});

describe("a change", () => {
  test("is saved a moment after it is made, and says Saving until it is saved", async () => {
    autosave.change(graphWith("a"));

    expect(lastStatus()).toMatchObject({
      state: WorkflowSaveState.Saving,
      hasUnsavedChanges: true,
    });

    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS - 1);
    expect(saves).toHaveLength(0);

    await clock.advance(1);
    expect(savedValues()).toEqual(["a"]);
    expect(lastStatus().state).toBe(WorkflowSaveState.Saving);

    saves[0]?.resolve();
    await settle();

    expect(lastStatus()).toEqual({
      state: WorkflowSaveState.Saved,
      error: "",
      hasUnsavedChanges: false,
      savedCount: 1,
    });
  });

  test("a burst of changes is one save, of the last of them", async () => {
    for (const value of ["a", "ab", "abc", "abcd"]) {
      autosave.change(graphWith(value));
      await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS / 2);
    }

    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);

    expect(savedValues()).toEqual(["abcd"]);
  });

  test("a change back to what the server has cancels the save, and nothing is unsaved", async () => {
    autosave.change(graphWith("a"));
    autosave.change(SERVER);
    await clock.advance(10 * WORKFLOW_AUTOSAVE_DELAY_IN_MS);

    expect(saves).toHaveLength(0);
    expect(lastStatus()).toMatchObject({
      state: WorkflowSaveState.Idle,
      hasUnsavedChanges: false,
    });
  });

  test("the same graph reported again is not saved twice", async () => {
    autosave.change(graphWith("a"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    autosave.change(graphWith("a"));
    autosave.change(graphWith("a"));
    await clock.advance(10 * WORKFLOW_AUTOSAVE_DELAY_IN_MS);

    expect(saves).toHaveLength(1);
  });
});

describe("one save at a time, and the latest graph is the one the server ends with", () => {
  test("a change made while a save is out is sent after it lands, never beside it", async () => {
    autosave.change(graphWith("a"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    expect(savedValues()).toEqual(["a"]);

    autosave.change(graphWith("b"));
    await clock.advance(10 * WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    // "a" is still out: "b" waits for it.
    expect(savedValues()).toEqual(["a"]);
    expect(lastStatus().state).toBe(WorkflowSaveState.Saving);

    saves[0]?.resolve();
    await settle();

    expect(savedValues()).toEqual(["a", "b"]);

    saves[1]?.resolve();
    await settle();

    expect(lastStatus()).toMatchObject({
      state: WorkflowSaveState.Saved,
      hasUnsavedChanges: false,
      savedCount: 2,
    });
  });

  test("a change back to the graph being saved still waits for its own moment, then sends nothing new", async () => {
    autosave.change(graphWith("a"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    autosave.change(graphWith("b"));
    autosave.change(graphWith("a"));

    saves[0]?.resolve();
    await settle();
    await clock.advance(10 * WORKFLOW_AUTOSAVE_DELAY_IN_MS);

    expect(savedValues()).toEqual(["a"]);
    expect(lastStatus().hasUnsavedChanges).toBe(false);
  });

  test("a change back to what the server had before the save that is out is saved after it", async () => {
    autosave.change(graphWith("a"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    // Undo, while "a" is on its way: the server must end with the graph as opened.
    autosave.change(SERVER);

    saves[0]?.resolve();
    await settle();
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);

    expect(savedValues()).toEqual(["a", "as opened"]);
  });

  test("property: whatever the canvas does, the last save sent is what it shows, and no two are ever out at once", async () => {
    const random: SeededRandom = seededRandom(61880);

    for (let session: number = 0; session < 40; session++) {
      const result: {
        mostOutAtOnce: number;
        hasUnsavedChanges: boolean;
        serverHas: string;
        shown: string;
      } = await runSeededSession(random);

      expect(result.mostOutAtOnce).toBeLessThanOrEqual(1);
      expect(result.hasUnsavedChanges).toBe(false);
      expect(result.serverHas).toBe(result.shown);
    }
  });
});

/*
 * One session of seeded edits, timers and answers from the server, on an
 * autosave of its own: how many saves were ever out at once, whether anything
 * was left unsaved, and the graph the server ended with beside the one shown.
 */
const runSeededSession: (random: SeededRandom) => Promise<{
  mostOutAtOnce: number;
  hasUnsavedChanges: boolean;
  serverHas: string;
  shown: string;
}> = async (
  random: SeededRandom,
): Promise<{
  mostOutAtOnce: number;
  hasUnsavedChanges: boolean;
  serverHas: string;
  shown: string;
}> => {
  const sessionClock: TestClock = new TestClock();
  const sessionSaves: Array<PendingSave> = [];
  const landed: Array<string> = [];
  let outAtOnce: number = 0;
  let mostOutAtOnce: number = 0;

  const session: WorkflowAutosave = new WorkflowAutosave({
    save: (graph: SavedWorkflowGraph): Promise<void> => {
      outAtOnce++;
      mostOutAtOnce = Math.max(mostOutAtOnce, outAtOnce);

      return new Promise<void>((resolve: () => void) => {
        sessionSaves.push({
          graph,
          resolve: () => {
            outAtOnce--;
            landed.push(getWorkflowGraphKey(graph));
            resolve();
          },
          reject: () => {},
        });
      });
    },
    onStatusChange: (): void => {},
    setTimer: (callback: () => void, delayInMs: number): unknown => {
      return sessionClock.set(callback, delayInMs);
    },
    clearTimer: (timer: unknown): void => {
      sessionClock.clear(timer);
    },
  });
  session.start(SERVER);

  let shown: SavedWorkflowGraph = SERVER;
  let answered: number = 0;

  // The server answers the saves out, sometimes; at the end, all of them.
  const answer: (all: boolean) => Promise<void> = async (
    all: boolean,
  ): Promise<void> => {
    while (answered < sessionSaves.length && (all || random(2) === 0)) {
      sessionSaves[answered]?.resolve();
      answered++;
      await settle();
    }
  };

  for (let action: number = 0; action < 25; action++) {
    if (random(3) === 0) {
      shown = graphWith(`value ${random(4)}`);
      session.change(shown);
    }

    await sessionClock.advance(random(3 * WORKFLOW_AUTOSAVE_DELAY_IN_MS));
    await answer(false);
  }

  // Let everything land.
  for (let round: number = 0; round < 20; round++) {
    await sessionClock.advance(10 * WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    await answer(true);
  }

  return {
    mostOutAtOnce,
    hasUnsavedChanges: session.getStatus().hasUnsavedChanges,
    serverHas:
      landed.length > 0
        ? (landed[landed.length - 1] as string)
        : getWorkflowGraphKey(SERVER),
    shown: getWorkflowGraphKey(shown),
  };
};

describe("a save that fails", () => {
  test("keeps the change, says why, and is tried again with the next change", async () => {
    autosave.change(graphWith("a"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    saves[0]?.reject(new Error("The server is not reachable."));
    await settle();

    expect(lastStatus()).toEqual({
      state: WorkflowSaveState.Error,
      error: "The server is not reachable.",
      hasUnsavedChanges: true,
      savedCount: 0,
    });

    autosave.change(graphWith("ab"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);

    expect(savedValues()).toEqual(["a", "ab"]);

    saves[1]?.resolve();
    await settle();

    expect(lastStatus()).toMatchObject({
      state: WorkflowSaveState.Saved,
      error: "",
      hasUnsavedChanges: false,
    });
  });

  test("Try again saves what failed, at once", async () => {
    autosave.change(graphWith("a"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    saves[0]?.reject(new Error("Refused"));
    await settle();

    void autosave.retry();
    await settle();

    expect(savedValues()).toEqual(["a", "a"]);
  });

  test("is not tried again by itself, so a server that refuses is not asked again and again", async () => {
    autosave.change(graphWith("a"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    saves[0]?.reject(new Error("Refused"));
    await settle();
    await clock.advance(60 * WORKFLOW_AUTOSAVE_DELAY_IN_MS);

    expect(saves).toHaveLength(1);
    expect(clock.pending()).toBe(0);
  });

  test("undone back to what the server has, nothing is unsaved and nothing failed", async () => {
    autosave.change(graphWith("a"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    saves[0]?.reject(new Error("Refused"));
    await settle();

    autosave.change(SERVER);

    expect(lastStatus()).toMatchObject({
      state: WorkflowSaveState.Idle,
      error: "",
      hasUnsavedChanges: false,
    });
  });

  test("says why in the caller's words, or the error's own", async () => {
    const described: WorkflowAutosave = new WorkflowAutosave({
      save: async (): Promise<void> => {
        throw { status: 403 };
      },
      onStatusChange: (): void => {},
      describeError: (): string => {
        return "You do not have permission to edit this workflow.";
      },
      setTimer: (callback: () => void, delayInMs: number): unknown => {
        return clock.set(callback, delayInMs);
      },
      clearTimer: (timer: unknown): void => {
        clock.clear(timer);
      },
    });
    described.start(SERVER);
    described.change(graphWith("a"));
    await described.flush();

    expect(described.getStatus().error).toBe(
      "You do not have permission to edit this workflow.",
    );

    const plain: WorkflowAutosave = new WorkflowAutosave({
      save: async (): Promise<void> => {
        throw "offline";
      },
      onStatusChange: (): void => {},
    });
    plain.start(SERVER);
    plain.change(graphWith("a"));
    await plain.flush();

    expect(plain.getStatus().error).toBe("offline");

    const nothing: WorkflowAutosave = new WorkflowAutosave({
      save: async (): Promise<void> => {
        throw null;
      },
      onStatusChange: (): void => {},
    });
    nothing.start(SERVER);
    nothing.change(graphWith("a"));
    await nothing.flush();

    expect(nothing.getStatus().error).toBe("Could not save.");
    plain.dispose();
    nothing.dispose();
  });
});

describe("leaving, restoring, and what someone else saved", () => {
  test("flush sends what is waiting at once", async () => {
    autosave.change(graphWith("a"));
    void autosave.flush();
    await settle();

    expect(savedValues()).toEqual(["a"]);
    expect(clock.pending()).toBe(0);
  });

  test("flush with nothing waiting sends nothing", async () => {
    await autosave.flush();

    expect(saves).toHaveLength(0);
  });

  test("dispose leaves nothing scheduled", () => {
    autosave.change(graphWith("a"));
    autosave.dispose();

    expect(clock.pending()).toBe(0);
  });

  test("Ask AI's save drops a change still waiting: the server has the graph, nothing is unsaved", async () => {
    autosave.change(graphWith("typed a moment before"));
    autosave.acceptSavedGraph(graphWith("what Ask AI saved"));
    await clock.advance(10 * WORKFLOW_AUTOSAVE_DELAY_IN_MS);

    expect(saves).toHaveLength(0);
    expect(lastStatus()).toMatchObject({
      state: WorkflowSaveState.Saved,
      hasUnsavedChanges: false,
    });

    // The canvas reporting what Ask AI saved sends nothing.
    autosave.change(graphWith("what Ask AI saved"));
    await clock.advance(10 * WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    expect(saves).toHaveLength(0);
  });

  test("a save out when Ask AI saved says nothing about what the server has once it lands", async () => {
    autosave.change(graphWith("a"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    autosave.acceptSavedGraph(graphWith("what Ask AI saved"));
    const before: number = statuses.length;

    saves[0]?.resolve();
    await settle();

    expect(statuses.length).toBe(before);

    // What Ask AI saved is what the server has: the canvas showing it sends nothing.
    autosave.change(graphWith("what Ask AI saved"));
    await clock.advance(10 * WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    expect(saves).toHaveLength(1);
  });

  test("starting again forgets everything waiting", async () => {
    autosave.change(graphWith("a"));
    autosave.start(graphWith("reopened"));
    await clock.advance(10 * WORKFLOW_AUTOSAVE_DELAY_IN_MS);

    expect(saves).toHaveLength(0);
    expect(lastStatus().state).toBe(WorkflowSaveState.Idle);
  });

  test("the status is told only when it changes", async () => {
    const before: number = statuses.length;
    autosave.change(graphWith("a"));
    autosave.change(graphWith("b"));
    autosave.change(graphWith("c"));

    expect(statuses.length - before).toBe(1);
  });
});

describe("as the builder uses it, with real timers", () => {
  test("saves EMAIL added a moment later", async () => {
    const sent: Array<SavedWorkflowGraph> = [];
    const real: WorkflowAutosave = new WorkflowAutosave({
      save: async (graph: SavedWorkflowGraph): Promise<void> => {
        sent.push(graph);
      },
      onStatusChange: (): void => {},
      delayInMs: 5,
    });
    real.start(SERVER);
    real.change(toSavedWorkflowGraph(graphOf([MANUAL, LOG, EMAIL])));

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.nodes).toHaveLength(3);
    real.dispose();
  });
});
