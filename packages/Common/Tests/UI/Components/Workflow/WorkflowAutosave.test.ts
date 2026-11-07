import { beforeEach, describe, expect, test } from "@jest/globals";
import WorkflowAutosave, {
  WORKFLOW_AUTOSAVE_DELAY_IN_MS,
  WORKFLOW_AUTOSAVE_SILENT_RESENDS,
  WorkflowAutosaveStatus,
  WorkflowGraphRevision,
  WorkflowSavedGraphRead,
} from "../../../../UI/Components/Workflow/WorkflowAutosave";
import { WorkflowSaveState } from "../../../../UI/Components/Workflow/WorkflowStatusBar";
import {
  SavedWorkflowGraph,
  getWorkflowGraphKey,
  toSavedWorkflowGraph,
} from "../../../../Utils/Workflow/WorkflowGraphSnapshot";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../../Helpers/SeededRandom";
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
      conflict: null,
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
      conflict: null,
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
      conflict: null,
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

/*
 * A SAVE SAYS WHICH GRAPH IT WAS MADE TO (issue #6257): the revision of the
 * graph the server had when the builder last knew it. A server holding a
 * newer graph refuses it (409), and the builder reads what is there: its own
 * graph already (an answer lost), the graph its change was made to (only the
 * count moved: sent again, quietly), or someone else's change - Conflict,
 * until the person chooses. Driven against a server that refuses exactly
 * what WorkflowService refuses, with every save and read landing when the
 * test says.
 */

const CONFLICT_STATUS: number = 409;

class ConflictError extends Error {
  public statusCode: number = CONFLICT_STATUS;

  public constructor() {
    super("Someone else saved this workflow's graph after you read it.");
  }
}

const isConflictError: (error: unknown) => boolean = (
  error: unknown,
): boolean => {
  return error instanceof ConflictError;
};

// The workflow as the server keeps it: its graph, and how many times it was saved.
class TestServer {
  public revision: number;
  public graph: SavedWorkflowGraph;
  // The graph's key at every revision it has had.
  public history: Map<number, string> = new Map<number, string>();

  public constructor(graph: SavedWorkflowGraph, revision: number = 0) {
    this.graph = graph;
    this.revision = revision;
    this.history.set(revision, getWorkflowGraphKey(graph));
  }

  // A save that names no revision (the API, Ask AI): made over whatever is there.
  public saveOver(graph: SavedWorkflowGraph): number {
    this.revision++;
    this.graph = graph;
    this.history.set(this.revision, getWorkflowGraphKey(graph));
    return this.revision;
  }

  // A save made to the graph at `basedOn`: refused once the server moved past it.
  public saveMadeTo(
    graph: SavedWorkflowGraph,
    basedOn: WorkflowGraphRevision,
  ): number {
    if (basedOn !== null && basedOn !== this.revision) {
      throw new ConflictError();
    }

    return this.saveOver(graph);
  }

  public read(): WorkflowSavedGraphRead {
    return {
      graph: JSON.parse(JSON.stringify(this.graph)),
      revision: this.revision,
    };
  }
}

// A request on its way: it reaches the server when the test lands it.
interface InFlightRequest {
  kind: "save" | "read";
  graph?: SavedWorkflowGraph | undefined;
  basedOn?: WorkflowGraphRevision | undefined;
  land: () => void;
  fail: (error: unknown) => void;
}

interface TestBuilder {
  autosave: WorkflowAutosave;
  requests: Array<InFlightRequest>;
  // Every save sent: its graph's value and the revision it named.
  sent: Array<{ value: string; basedOn: WorkflowGraphRevision }>;
  statuses: Array<WorkflowAutosaveStatus>;
  // Lands the oldest request still on its way.
  landNext: () => Promise<void>;
  // Lands every request, and every one they lead to.
  landAll: () => Promise<void>;
}

const valueOf: (graph: SavedWorkflowGraph | undefined) => string = (
  graph: SavedWorkflowGraph | undefined,
): string => {
  return (
    (graph?.nodes[1]?.["data"] as { arguments?: { value?: string } })?.arguments
      ?.value || ""
  );
};

const openBuilder: (data: {
  server: TestServer;
  builderClock?: TestClock | undefined;
  withReads?: boolean | undefined;
}) => TestBuilder = (data: {
  server: TestServer;
  builderClock?: TestClock | undefined;
  withReads?: boolean | undefined;
}): TestBuilder => {
  const builderClock: TestClock = data.builderClock || clock;
  const requests: Array<InFlightRequest> = [];
  const sent: Array<{ value: string; basedOn: WorkflowGraphRevision }> = [];
  const builderStatuses: Array<WorkflowAutosaveStatus> = [];

  const builder: WorkflowAutosave = new WorkflowAutosave({
    save: (
      graph: SavedWorkflowGraph,
      basedOn: WorkflowGraphRevision,
    ): Promise<WorkflowGraphRevision> => {
      sent.push({ value: valueOf(graph), basedOn });

      return new Promise<WorkflowGraphRevision>(
        (
          resolve: (revision: WorkflowGraphRevision) => void,
          reject: (error: unknown) => void,
        ) => {
          requests.push({
            kind: "save",
            graph,
            basedOn,
            land: () => {
              try {
                resolve(data.server.saveMadeTo(graph, basedOn));
              } catch (error) {
                reject(error);
              }
            },
            fail: reject,
          });
        },
      );
    },
    isConflict: isConflictError,
    readSaved:
      data.withReads === false
        ? undefined
        : (): Promise<WorkflowSavedGraphRead | null> => {
            return new Promise<WorkflowSavedGraphRead | null>(
              (
                resolve: (read: WorkflowSavedGraphRead | null) => void,
                reject: (error: unknown) => void,
              ) => {
                requests.push({
                  kind: "read",
                  land: () => {
                    resolve(data.server.read());
                  },
                  fail: reject,
                });
              },
            );
          },
    onStatusChange: (status: WorkflowAutosaveStatus): void => {
      builderStatuses.push(status);
    },
    setTimer: (callback: () => void, delayInMs: number): unknown => {
      return builderClock.set(callback, delayInMs);
    },
    clearTimer: (timer: unknown): void => {
      builderClock.clear(timer);
    },
  });

  builder.start(data.server.graph, data.server.revision);

  const landNext: () => Promise<void> = async (): Promise<void> => {
    const request: InFlightRequest | undefined = requests.shift();

    if (!request) {
      throw new Error("Nothing is on its way.");
    }

    request.land();
    await settle();
  };

  return {
    autosave: builder,
    requests,
    sent,
    statuses: builderStatuses,
    landNext,
    landAll: async (): Promise<void> => {
      for (let round: number = 0; round < 50 && requests.length > 0; round++) {
        await landNext();
      }
    },
  };
};

describe("a save made to an older graph (issue #6257)", () => {
  test("each save names the revision the server was at when the builder last knew it", async () => {
    const server: TestServer = new TestServer(SERVER, 7);
    const builder: TestBuilder = openBuilder({ server });

    builder.autosave.change(graphWith("a"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    await builder.landAll();

    builder.autosave.change(graphWith("b"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    await builder.landAll();

    // One request per save, and no read: alone on a workflow, nothing more is asked.
    expect(builder.sent).toEqual([
      { value: "a", basedOn: 7 },
      { value: "b", basedOn: 8 },
    ]);
    expect(server.revision).toBe(9);
    expect(builder.autosave.getStatus()).toMatchObject({
      state: WorkflowSaveState.Saved,
      hasUnsavedChanges: false,
      conflict: null,
    });
  });

  test("opened without a revision, a save names none and is made over whatever is there", async () => {
    const sentRevisions: Array<WorkflowGraphRevision> = [];
    const plain: WorkflowAutosave = new WorkflowAutosave({
      save: async (
        _graph: SavedWorkflowGraph,
        basedOn: WorkflowGraphRevision,
      ): Promise<void> => {
        sentRevisions.push(basedOn);
      },
      onStatusChange: (): void => {},
    });

    plain.start(SERVER);
    plain.change(graphWith("a"));
    await plain.flush();
    plain.change(graphWith("b"));
    await plain.flush();

    expect(sentRevisions).toEqual([null, null]);
  });

  test("someone else's change: Conflict, with their graph and the one the change was made to - and nothing more is sent", async () => {
    const server: TestServer = new TestServer(SERVER, 3);
    const builder: TestBuilder = openBuilder({ server });

    // A teammate saves first.
    server.saveOver(graphWith("theirs"));

    builder.autosave.change(graphWith("mine"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    await builder.landNext();

    // Refused: what the server has now is read.
    expect(
      builder.requests.map((request: InFlightRequest) => {
        return request.kind;
      }),
    ).toEqual(["read"]);
    expect(builder.autosave.getStatus().state).toBe(WorkflowSaveState.Saving);

    await builder.landNext();

    const status: WorkflowAutosaveStatus = builder.autosave.getStatus();

    expect(status.state).toBe(WorkflowSaveState.Conflict);
    expect(status.hasUnsavedChanges).toBe(true);
    expect(status.error).toBe("");
    expect(valueOf(status.conflict?.theirs)).toBe("theirs");
    expect(status.conflict?.revision).toBe(4);
    expect(getWorkflowGraphKey(status.conflict?.base)).toBe(
      getWorkflowGraphKey(SERVER),
    );

    // Nothing goes over their change: not later, not with another edit, not with Try again.
    await clock.advance(60 * WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    builder.autosave.change(graphWith("mine, and more"));
    await clock.advance(60 * WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    await builder.autosave.retry();
    await builder.autosave.flush();

    expect(builder.sent).toHaveLength(1);
    expect(builder.requests).toHaveLength(0);
    expect(clock.pending()).toBe(0);
    expect(valueOf(server.graph)).toBe("theirs");
    expect(builder.autosave.getStatus().state).toBe(WorkflowSaveState.Conflict);
  });

  test("Keep mine saves the canvas's graph at once, made to their revision, and the server ends with it", async () => {
    const server: TestServer = new TestServer(SERVER, 3);
    const builder: TestBuilder = openBuilder({ server });

    server.saveOver(graphWith("theirs"));
    builder.autosave.change(graphWith("mine"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    await builder.landAll();

    // An edit while the person reads the dialog is held, and is what Keep mine sends.
    builder.autosave.change(graphWith("mine, and more"));

    const keeping: Promise<void> = builder.autosave.keepMine();
    await settle();

    expect(builder.autosave.getStatus()).toMatchObject({
      state: WorkflowSaveState.Saving,
      hasUnsavedChanges: true,
      conflict: null,
    });
    expect(builder.sent[builder.sent.length - 1]).toEqual({
      value: "mine, and more",
      basedOn: 4,
    });

    await builder.landAll();
    await keeping;

    expect(valueOf(server.graph)).toBe("mine, and more");
    expect(builder.autosave.getStatus()).toMatchObject({
      state: WorkflowSaveState.Saved,
      hasUnsavedChanges: false,
      conflict: null,
    });

    // And the next save is made to the revision Keep mine landed at.
    builder.autosave.change(graphWith("next"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);

    expect(builder.sent[builder.sent.length - 1]).toEqual({
      value: "next",
      basedOn: 5,
    });
  });

  test("Keep mine when they saved again meanwhile: Conflict once more, with their newer graph", async () => {
    const server: TestServer = new TestServer(SERVER, 0);
    const builder: TestBuilder = openBuilder({ server });

    server.saveOver(graphWith("theirs"));
    builder.autosave.change(graphWith("mine"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    await builder.landAll();

    server.saveOver(graphWith("theirs, again"));
    void builder.autosave.keepMine();
    await settle();
    await builder.landAll();

    expect(builder.autosave.getStatus().state).toBe(WorkflowSaveState.Conflict);
    expect(valueOf(builder.autosave.getStatus().conflict?.theirs)).toBe(
      "theirs, again",
    );
    expect(builder.autosave.getStatus().conflict?.revision).toBe(2);
    // What their newer change was made over is their first one.
    expect(valueOf(builder.autosave.getStatus().conflict?.base)).toBe("theirs");
    expect(valueOf(server.graph)).toBe("theirs, again");
  });

  test("their changes shown (acceptSavedGraph): nothing to save, and the next change is made to their revision", async () => {
    const server: TestServer = new TestServer(SERVER, 3);
    const builder: TestBuilder = openBuilder({ server });

    server.saveOver(graphWith("theirs"));
    builder.autosave.change(graphWith("mine"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    await builder.landAll();

    const conflict: WorkflowAutosaveStatus["conflict"] =
      builder.autosave.getStatus().conflict;

    builder.autosave.acceptSavedGraph(conflict!.theirs, conflict!.revision);

    expect(builder.autosave.getStatus()).toMatchObject({
      state: WorkflowSaveState.Saved,
      hasUnsavedChanges: false,
      conflict: null,
    });

    // The canvas drawing their graph sends nothing.
    builder.autosave.change(graphWith("theirs"));
    await clock.advance(10 * WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    expect(builder.sent).toHaveLength(1);

    // Undo back to the person's own: saved over theirs, made to their revision.
    builder.autosave.change(graphWith("mine"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    await builder.landAll();

    expect(builder.sent[builder.sent.length - 1]).toEqual({
      value: "mine",
      basedOn: 4,
    });
    expect(valueOf(server.graph)).toBe("mine");
  });

  test("the canvas reaching their graph by itself leaves nothing to choose", async () => {
    const server: TestServer = new TestServer(SERVER, 0);
    const builder: TestBuilder = openBuilder({ server });

    server.saveOver(graphWith("theirs"));
    builder.autosave.change(graphWith("mine"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    await builder.landAll();

    builder.autosave.change(graphWith("theirs"));

    expect(builder.autosave.getStatus()).toMatchObject({
      state: WorkflowSaveState.Saved,
      hasUnsavedChanges: false,
      conflict: null,
    });

    builder.autosave.change(graphWith("after"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    expect(builder.sent[builder.sent.length - 1]).toEqual({
      value: "after",
      basedOn: 1,
    });
  });

  test("the server has the graph the save sends already - an answer that never arrived: saved, no question", async () => {
    const server: TestServer = new TestServer(SERVER, 2);
    const builder: TestBuilder = openBuilder({ server });

    builder.autosave.change(graphWith("mine"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);

    // The save lands, but its answer is lost on the way back.
    const lost: InFlightRequest = builder.requests.shift()!;
    server.saveMadeTo(lost.graph!, lost.basedOn!);
    lost.fail(new Error("The connection was reset."));
    await settle();

    expect(builder.autosave.getStatus().state).toBe(WorkflowSaveState.Error);

    // Try again: refused as made to an older graph - which is its own.
    void builder.autosave.retry();
    await settle();
    await builder.landAll();

    expect(builder.autosave.getStatus()).toMatchObject({
      state: WorkflowSaveState.Saved,
      hasUnsavedChanges: false,
      conflict: null,
    });
    expect(
      builder.statuses.some((status: WorkflowAutosaveStatus): boolean => {
        return status.state === WorkflowSaveState.Conflict;
      }),
    ).toBe(false);
    expect(server.revision).toBe(3);

    builder.autosave.change(graphWith("next"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    expect(builder.sent[builder.sent.length - 1]).toEqual({
      value: "next",
      basedOn: 3,
    });
  });

  test("only the count moved - the same graph saved again elsewhere: sent again on the new revision, without a word", async () => {
    const server: TestServer = new TestServer(SERVER, 5);
    const builder: TestBuilder = openBuilder({ server });

    // Someone saves the graph exactly as it is.
    server.saveOver(graphWith("as opened"));

    builder.autosave.change(graphWith("mine"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    await builder.landAll();

    expect(builder.sent).toEqual([
      { value: "mine", basedOn: 5 },
      { value: "mine", basedOn: 6 },
    ]);
    expect(valueOf(server.graph)).toBe("mine");
    expect(
      builder.statuses.map((status: WorkflowAutosaveStatus): string => {
        return status.state;
      }),
    ).not.toContain(WorkflowSaveState.Conflict);
    expect(builder.autosave.getStatus().state).toBe(WorkflowSaveState.Saved);
  });

  test(`a server that keeps refusing while it has the graph the change was made to is asked ${WORKFLOW_AUTOSAVE_SILENT_RESENDS} more times, then the save fails`, async () => {
    const server: TestServer = new TestServer(SERVER, 0);
    let refusals: number = 0;
    const stubborn: WorkflowAutosave = new WorkflowAutosave({
      save: async (): Promise<WorkflowGraphRevision> => {
        refusals++;
        throw new ConflictError();
      },
      isConflict: isConflictError,
      readSaved: async (): Promise<WorkflowSavedGraphRead> => {
        // The count moves, the graph does not.
        server.saveOver(server.graph);
        return server.read();
      },
      onStatusChange: (): void => {},
    });

    stubborn.start(SERVER, 0);
    stubborn.change(graphWith("mine"));
    await stubborn.flush();

    expect(refusals).toBe(WORKFLOW_AUTOSAVE_SILENT_RESENDS + 1);
    expect(stubborn.getStatus()).toMatchObject({
      state: WorkflowSaveState.Error,
      error: "Someone else saved this workflow's graph after you read it.",
      hasUnsavedChanges: true,
      conflict: null,
    });
  });

  test("what the server has cannot be read: the save fails, saying why, and Try again starts over", async () => {
    const server: TestServer = new TestServer(SERVER, 0);
    const builder: TestBuilder = openBuilder({ server });

    server.saveOver(graphWith("theirs"));
    builder.autosave.change(graphWith("mine"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    await builder.landNext();

    builder.requests.shift()!.fail(new Error("The server is not reachable."));
    await settle();

    expect(builder.autosave.getStatus()).toMatchObject({
      state: WorkflowSaveState.Error,
      error: "The server is not reachable.",
      hasUnsavedChanges: true,
    });

    void builder.autosave.retry();
    await settle();
    await builder.landAll();

    expect(builder.autosave.getStatus().state).toBe(WorkflowSaveState.Conflict);
  });

  test("the workflow is gone: the save fails with the server's refusal", async () => {
    const gone: WorkflowAutosave = new WorkflowAutosave({
      save: async (): Promise<WorkflowGraphRevision> => {
        throw new ConflictError();
      },
      isConflict: isConflictError,
      readSaved: async (): Promise<null> => {
        return null;
      },
      onStatusChange: (): void => {},
    });

    gone.start(SERVER, 0);
    gone.change(graphWith("mine"));
    await gone.flush();

    expect(gone.getStatus()).toMatchObject({
      state: WorkflowSaveState.Error,
      error: "Someone else saved this workflow's graph after you read it.",
    });
  });

  test("a refusal for any other reason fails as before: nothing is read", async () => {
    let reads: number = 0;
    const refused: WorkflowAutosave = new WorkflowAutosave({
      save: async (): Promise<WorkflowGraphRevision> => {
        throw new Error("You do not have permission to update this workflow.");
      },
      isConflict: isConflictError,
      readSaved: async (): Promise<WorkflowSavedGraphRead> => {
        reads++;
        return { graph: SERVER, revision: 0 };
      },
      onStatusChange: (): void => {},
    });

    refused.start(SERVER, 0);
    refused.change(graphWith("mine"));
    await refused.flush();

    expect(reads).toBe(0);
    expect(refused.getStatus()).toMatchObject({
      state: WorkflowSaveState.Error,
      error: "You do not have permission to update this workflow.",
    });
  });

  test("a builder that cannot read the workflow again takes a conflict as a failure", async () => {
    const server: TestServer = new TestServer(SERVER, 0);
    const builder: TestBuilder = openBuilder({ server, withReads: false });

    server.saveOver(graphWith("theirs"));
    builder.autosave.change(graphWith("mine"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    await builder.landAll();

    expect(builder.autosave.getStatus().state).toBe(WorkflowSaveState.Error);
    expect(valueOf(server.graph)).toBe("theirs");
  });

  test("Ask AI's change arriving while the refused save's read is out: the read says nothing, and nothing is asked", async () => {
    const server: TestServer = new TestServer(SERVER, 0);
    const builder: TestBuilder = openBuilder({ server });

    server.saveOver(graphWith("Ask AI's"));
    builder.autosave.change(graphWith("mine"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    await builder.landNext();

    // The page hears of Ask AI's change before the read lands.
    builder.autosave.acceptSavedGraph(graphWith("Ask AI's"), 1);
    await builder.landAll();

    expect(builder.autosave.getStatus()).toMatchObject({
      state: WorkflowSaveState.Saved,
      hasUnsavedChanges: false,
      conflict: null,
    });
    expect(
      builder.statuses.some((status: WorkflowAutosaveStatus): boolean => {
        return status.state === WorkflowSaveState.Conflict;
      }),
    ).toBe(false);
  });

  test("Ask AI's change arriving while the person is asked closes the question", async () => {
    const server: TestServer = new TestServer(SERVER, 0);
    const builder: TestBuilder = openBuilder({ server });

    server.saveOver(graphWith("Ask AI's"));
    builder.autosave.change(graphWith("mine"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    await builder.landAll();
    expect(builder.autosave.getStatus().state).toBe(WorkflowSaveState.Conflict);

    builder.autosave.acceptSavedGraph(graphWith("Ask AI's"), 1);

    expect(builder.autosave.getStatus()).toMatchObject({
      state: WorkflowSaveState.Saved,
      conflict: null,
    });

    // Keep mine has nothing to keep any more.
    await builder.autosave.keepMine();
    expect(builder.sent).toHaveLength(1);
  });

  test("opening the workflow again forgets the question", async () => {
    const server: TestServer = new TestServer(SERVER, 0);
    const builder: TestBuilder = openBuilder({ server });

    server.saveOver(graphWith("theirs"));
    builder.autosave.change(graphWith("mine"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    await builder.landAll();

    builder.autosave.start(server.graph, server.revision);

    expect(builder.autosave.getStatus()).toMatchObject({
      state: WorkflowSaveState.Idle,
      hasUnsavedChanges: false,
      conflict: null,
    });
  });

  test("the canvas going on to their graph while the refused save was out: nothing to choose", async () => {
    const server: TestServer = new TestServer(SERVER, 0);
    const builder: TestBuilder = openBuilder({ server });

    server.saveOver(graphWith("theirs"));
    builder.autosave.change(graphWith("mine"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    await builder.landNext();

    // Before the read lands, the canvas shows exactly what they saved.
    builder.autosave.change(graphWith("theirs"));
    await builder.landAll();

    expect(builder.autosave.getStatus()).toMatchObject({
      state: WorkflowSaveState.Saved,
      hasUnsavedChanges: false,
      conflict: null,
    });
    expect(clock.pending()).toBe(0);
  });

  test("Keep mine with nothing on the canvas but their graph sends nothing", async () => {
    const server: TestServer = new TestServer(SERVER, 0);
    const builder: TestBuilder = openBuilder({ server });

    await builder.autosave.keepMine();
    expect(builder.sent).toHaveLength(0);
    expect(builder.autosave.getStatus().state).toBe(WorkflowSaveState.Idle);
  });

  test("the question is told once, and every save that landed counts - those taken in from elsewhere too", async () => {
    const server: TestServer = new TestServer(SERVER, 0);
    const builder: TestBuilder = openBuilder({ server });

    server.saveOver(graphWith("theirs"));
    builder.autosave.change(graphWith("mine"));
    await clock.advance(WORKFLOW_AUTOSAVE_DELAY_IN_MS);
    await builder.landAll();

    const conflicts: number = builder.statuses.filter(
      (status: WorkflowAutosaveStatus): boolean => {
        return status.state === WorkflowSaveState.Conflict;
      },
    ).length;

    builder.autosave.change(graphWith("mine, and more"));
    builder.autosave.change(graphWith("mine, and more still"));

    expect(
      builder.statuses.filter((status: WorkflowAutosaveStatus): boolean => {
        return status.state === WorkflowSaveState.Conflict;
      }),
    ).toHaveLength(conflicts);
    expect(conflicts).toBe(1);

    const before: number = builder.autosave.getStatus().savedCount;
    builder.autosave.acceptSavedGraph(server.graph, server.revision);
    expect(builder.autosave.getStatus().savedCount).toBe(before + 1);
  });
});

/*
 * THE RACE, SEEDED: several builders open on one workflow, editing, saving
 * and answering the dialog at random, with Ask AI and the API saving over
 * them now and then, and every request landing in an order of its own.
 * Whatever happens:
 *   - no builder ever has two saves out at once;
 *   - every save the server takes was made to the graph it held then, and
 *     the builder that sent it had seen that very graph at that revision -
 *     so nobody's change is ever replaced by someone who had not seen it;
 *   - a builder is asked only about a change it has not seen: their graph
 *     is never the one its change was made to, nor the one it is saving;
 *   - once everyone stops and has answered, nothing is left unsaved, and
 *     the server ends with the graph shown by whoever saved last.
 */
describe("property: the race between builders on one workflow", () => {
  // What the races did, so the checks above are known not to be vacuous.
  const tally: Record<string, number> = {
    refused: 0,
    askedAbout: 0,
    keptMine: 0,
    showedTheirs: 0,
    sentAgainQuietly: 0,
    triedAgain: 0,
  };

  interface RacingBuilder {
    name: string;
    clock: TestClock;
    builder: TestBuilder;
    shown: SavedWorkflowGraph;
    // The graph's key at each revision this builder saw: opened, saved, read, or taken in.
    seen: Map<number, string>;
  }

  const runRace: (random: SeededRandom) => Promise<void> = async (
    random: SeededRandom,
  ): Promise<void> => {
    const server: TestServer = new TestServer(SERVER, random(5));
    const builders: Array<RacingBuilder> = [];
    let lastWriter: string = "the server";

    for (let index: number = 0; index < 2 + random(2); index++) {
      const racerClock: TestClock = new TestClock();
      const racer: RacingBuilder = {
        name: `builder ${index}`,
        clock: racerClock,
        builder: openBuilder({ server, builderClock: racerClock }),
        shown: server.graph,
        seen: new Map<number, string>([
          [server.revision, getWorkflowGraphKey(server.graph)],
        ]),
      };

      builders.push(racer);
    }

    // What each request does to the server, checked as it lands.
    const land: (racer: RacingBuilder) => Promise<void> = async (
      racer: RacingBuilder,
    ): Promise<void> => {
      const request: InFlightRequest | undefined = racer.builder.requests[0];

      if (!request) {
        return;
      }

      if (request.kind === "save") {
        const isTaken: boolean =
          request.basedOn === null || request.basedOn === server.revision;

        if (
          isTaken &&
          request.basedOn !== null &&
          request.basedOn !== undefined
        ) {
          // The builder saw the graph its save replaces, at that very revision.
          expect({
            racer: racer.name,
            seenThatGraph: racer.seen.get(request.basedOn),
          }).toEqual({
            racer: racer.name,
            seenThatGraph: server.history.get(request.basedOn),
          });
        }

        if (!isTaken) {
          tally["refused"]!++;
        }

        if (
          isTaken &&
          racer.builder.sent.length > 1 &&
          racer.builder.sent[racer.builder.sent.length - 2]?.value ===
            valueOf(request.graph) &&
          racer.builder.sent[racer.builder.sent.length - 2]?.basedOn !==
            request.basedOn
        ) {
          tally["sentAgainQuietly"]!++;
        }

        if (isTaken) {
          lastWriter = racer.name;
          racer.seen.set(
            server.revision + 1,
            getWorkflowGraphKey(request.graph),
          );
        }
      } else {
        racer.seen.set(server.revision, getWorkflowGraphKey(server.graph));
      }

      await racer.builder.landNext();
    };

    const answer: (racer: RacingBuilder) => Promise<void> = async (
      racer: RacingBuilder,
    ): Promise<void> => {
      const status: WorkflowAutosaveStatus = racer.builder.autosave.getStatus();

      // A save that failed - sent again quietly too many times - is tried again, as Try again does.
      if (status.state === WorkflowSaveState.Error) {
        tally["triedAgain"]!++;
        void racer.builder.autosave.retry();
        await settle();
        return;
      }

      if (status.state !== WorkflowSaveState.Conflict || !status.conflict) {
        return;
      }

      tally["askedAbout"]!++;

      // Asked only about a change it had not seen.
      expect(getWorkflowGraphKey(status.conflict.theirs)).not.toBe(
        getWorkflowGraphKey(status.conflict.base),
      );
      expect(getWorkflowGraphKey(status.conflict.theirs)).not.toBe(
        getWorkflowGraphKey(racer.shown),
      );

      if (random(2) === 0) {
        // Show their changes.
        if (status.conflict.revision !== null) {
          racer.seen.set(
            status.conflict.revision,
            getWorkflowGraphKey(status.conflict.theirs),
          );
        }

        tally["showedTheirs"]!++;
        racer.shown = status.conflict.theirs;
        racer.builder.autosave.acceptSavedGraph(
          status.conflict.theirs,
          status.conflict.revision,
        );
      } else {
        tally["keptMine"]!++;
        void racer.builder.autosave.keepMine();
        await settle();
      }
    };

    for (let step: number = 0; step < 60; step++) {
      const racer: RacingBuilder = builders[
        random(builders.length)
      ] as RacingBuilder;
      const roll: number = random(10);

      if (roll < 3) {
        racer.shown = graphWith(`${racer.name} edit ${random(4)}`);
        racer.builder.autosave.change(racer.shown);
      } else if (roll < 5) {
        await racer.clock.advance(random(2 * WORKFLOW_AUTOSAVE_DELAY_IN_MS));
      } else if (roll < 8) {
        await land(racer);
      } else if (roll < 9) {
        await answer(racer);
      } else {
        // Ask AI or the API saves over everyone.
        server.saveOver(graphWith(`elsewhere ${random(3)}`));
        lastWriter = "elsewhere";
      }

      for (const each of builders) {
        expect(
          each.builder.requests.filter((request: InFlightRequest) => {
            return request.kind === "save";
          }).length,
        ).toBeLessThanOrEqual(1);
      }
    }

    // Everyone stops editing, lets their timers fire and their requests land, and answers.
    for (let round: number = 0; round < 40; round++) {
      for (const racer of shuffled(builders, random)) {
        await racer.clock.advance(10 * WORKFLOW_AUTOSAVE_DELAY_IN_MS);

        while (racer.builder.requests.length > 0) {
          await land(racer);
        }

        await answer(racer);
      }
    }

    for (const racer of builders) {
      expect({
        racer: racer.name,
        status: racer.builder.autosave.getStatus().state,
        hasUnsavedChanges: racer.builder.autosave.getStatus().hasUnsavedChanges,
      }).toEqual({
        racer: racer.name,
        status: expect.not.stringMatching(/Saving|Conflict|Error/),
        hasUnsavedChanges: false,
      });
    }

    const writer: RacingBuilder | undefined = builders.find(
      (racer: RacingBuilder): boolean => {
        return racer.name === lastWriter;
      },
    );

    if (writer) {
      expect(getWorkflowGraphKey(server.graph)).toBe(
        getWorkflowGraphKey(writer.shown),
      );
    }
  };

  test("over 150 seeded races", async () => {
    const random: SeededRandom = seededRandom(62570);

    for (let race: number = 0; race < 150; race++) {
      await runRace(random);
    }

    // Every way through was taken, many times over.
    expect(tally["refused"]).toBeGreaterThan(50);
    expect(tally["askedAbout"]).toBeGreaterThan(50);
    expect(tally["keptMine"]).toBeGreaterThan(20);
    expect(tally["showedTheirs"]).toBeGreaterThan(20);
    expect(tally["sentAgainQuietly"]).toBeGreaterThan(0);
  });
});
