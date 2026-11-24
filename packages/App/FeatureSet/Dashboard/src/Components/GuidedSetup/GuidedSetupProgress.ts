import GuidedSetupRunApi, { GuidedSetupRunRemote } from "./GuidedSetupRunApi";
import {
  GuidedSetupKey,
  GuidedSetupResourceProgress,
  GuidedSetupResourceProgressChange,
  GuidedSetupRunAnswer,
  GuidedSetupRunChange,
  GuidedSetupRunResources,
  GuidedSetupRunValues,
  readGuidedSetupRunResources,
  readGuidedSetupRunValues,
} from "Common/Types/GuidedSetup/GuidedSetupRun";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import LocalStorage from "Common/UI/Utils/LocalStorage";

/*
 * A GUIDED SETUP'S PROGRESS (issue #6804, reused by #6805 and #6806).
 *
 * A guided setup does one job on one page, in three to five steps, and each
 * step saves real records as it goes (GuidedSetupFrame draws it). So leaving
 * in the middle loses nothing, and coming back opens the first step that is
 * not done:
 *
 *   - which records this run made (the monitor, the policy, the test page),
 *     and how each record it makes is getting on, is kept on the server, per
 *     setup, project and person (GuidedSetupRunStore, #7253) - a run is about
 *     what this person is doing, so another device, a private window or a
 *     reload opens the setup where they left it;
 *   - whether each step is done is read from those records when the page
 *     opens, never from the run alone: a monitor deleted since is a step to
 *     do again;
 *   - a run the server could not give (OneUptime out of reach) makes nothing
 *     twice either: before a step makes a record, it looks for the one this
 *     person already has (#7059);
 *   - a run is kept until the person starts another, or until nobody has
 *     changed it for 30 days: coming back after the last step shows its
 *     summary again.
 *
 * React-free, so the tests read it without a page.
 */

// What a guided setup knows about each of its steps.
export interface GuidedSetupStepProgress {
  // A word the code chooses (snake_case), sent with the setup's events.
  key: string;
  isDone: boolean;
}

export enum GuidedSetupStepState {
  Done = "done",
  Open = "open",
  Upcoming = "upcoming",
}

// The step a returning person lands on: the first one not done, or none.
export const getFirstOpenStepKey: (
  steps: ReadonlyArray<GuidedSetupStepProgress>,
) => string | null = (
  steps: ReadonlyArray<GuidedSetupStepProgress>,
): string | null => {
  const open: GuidedSetupStepProgress | undefined = steps.find(
    (step: GuidedSetupStepProgress): boolean => {
      return !step.isDone;
    },
  );

  return open ? open.key : null;
};

/*
 * Whether a step can be opened: a done step (to look at it again), and the
 * first one not done. A later step waits for the ones before it, since each
 * builds on what the one before saved.
 */
export const canOpenStep: (
  steps: ReadonlyArray<GuidedSetupStepProgress>,
  key: string,
) => boolean = (
  steps: ReadonlyArray<GuidedSetupStepProgress>,
  key: string,
): boolean => {
  const step: GuidedSetupStepProgress | undefined = steps.find(
    (candidate: GuidedSetupStepProgress): boolean => {
      return candidate.key === key;
    },
  );

  if (!step) {
    return false;
  }

  return step.isDone || getFirstOpenStepKey(steps) === key;
};

// How each step is drawn while `openKey` is open (null: the summary is).
export const getStepState: (data: {
  step: GuidedSetupStepProgress;
  openKey: string | null;
}) => GuidedSetupStepState = (data: {
  step: GuidedSetupStepProgress;
  openKey: string | null;
}): GuidedSetupStepState => {
  if (data.step.key === data.openKey) {
    return GuidedSetupStepState.Open;
  }

  return data.step.isDone
    ? GuidedSetupStepState.Done
    : GuidedSetupStepState.Upcoming;
};

// "Step 2 of 4", for the step that is open.
export const getStepNumber: (
  steps: ReadonlyArray<GuidedSetupStepProgress>,
  key: string,
) => number = (
  steps: ReadonlyArray<GuidedSetupStepProgress>,
  key: string,
): number => {
  return (
    steps.findIndex((step: GuidedSetupStepProgress): boolean => {
      return step.key === key;
    }) + 1
  );
};

export const countDoneSteps: (
  steps: ReadonlyArray<GuidedSetupStepProgress>,
) => number = (steps: ReadonlyArray<GuidedSetupStepProgress>): number => {
  return steps.filter((step: GuidedSetupStepProgress): boolean => {
    return step.isDone;
  }).length;
};

/*
 * A RUN: the records one pass through a setup made, by name, as plain
 * values (ids, true for a step that saves nothing of its own, and what the
 * person typed).
 */
export type GuidedSetupRun = Record<string, string | boolean>;

export const GUIDED_SETUP_RUN_KEY_PREFIX: string = "guided-setup-run";

export const getGuidedSetupRunKey: (data: {
  setup: string;
  projectId: string;
  userId: string;
}) => string = (data: {
  setup: string;
  projectId: string;
  userId: string;
}): string => {
  return `${GUIDED_SETUP_RUN_KEY_PREFIX}:${data.setup}:${data.projectId}:${data.userId}`;
};

// Only names with strings and true are kept: anything else is not a run's.
export const readGuidedSetupRun: (value: JSONValue | null) => GuidedSetupRun = (
  value: JSONValue | null,
): GuidedSetupRun => {
  return readGuidedSetupRunValues(value);
};

/*
 * Where the run stands with the server, as the setup's panel says it: kept
 * there (another device opens the setup here), on its way, or kept in this
 * browser only, until OneUptime can be reached again.
 */
export enum GuidedSetupRunSync {
  // The run holds nothing yet.
  Idle = "idle",
  Saving = "saving",
  Saved = "saved",
  NotSaved = "not_saved",
}

// A resource's progress as a step sets it; the store stamps it.
export type GuidedSetupResourceUpdate = GuidedSetupResourceProgressChange;

interface RunCopy {
  values: GuidedSetupRunValues;
  resources: GuidedSetupRunResources;
}

/*
 * The browser's copy (local storage), so a page opens on it when the server
 * cannot be reached. `isSynced`: the server has all of it. A copy an older
 * Dashboard kept is the run's values alone, with no format: the server has
 * never had it, and is sent it once (load).
 */
const KEPT_FORMAT: number = 2;

interface KeptRun extends RunCopy {
  isSynced: boolean;
  // Start over was pressed and the server has not heard it yet.
  isForgetPending: boolean;
}

const emptyCopy: () => RunCopy = (): RunCopy => {
  return { values: {}, resources: {} };
};

const hasAnything: (copy: RunCopy) => boolean = (copy: RunCopy): boolean => {
  return (
    Object.keys(copy.values).length > 0 ||
    Object.keys(copy.resources).length > 0
  );
};

const applyChange: (
  copy: RunCopy,
  change: GuidedSetupRunChange,
  at: string,
) => RunCopy = (
  copy: RunCopy,
  change: GuidedSetupRunChange,
  at: string,
): RunCopy => {
  const values: GuidedSetupRunValues = { ...copy.values };
  const resources: GuidedSetupRunResources = { ...copy.resources };

  for (const [name, value] of Object.entries(change.values)) {
    if (value === null) {
      delete values[name];
    } else {
      values[name] = value;
    }
  }

  for (const [name, progress] of Object.entries(change.resources)) {
    if (progress === null) {
      delete resources[name];
    } else {
      const kept: GuidedSetupResourceProgress = {
        status: progress.status,
        at: at,
      };

      if (progress.recordId) {
        kept.recordId = progress.recordId;
      }

      if (progress.name) {
        kept.name = progress.name;
      }

      if (progress.error) {
        kept.error = progress.error;
      }

      resources[name] = kept;
    }
  }

  return { values: values, resources: resources };
};

/*
 * The whole copy as one change, with the names the changes not yet sent
 * removed: what a server that missed some changes needs to catch up.
 */
const toWholeChange: (
  copy: RunCopy,
  unsent: ReadonlyArray<GuidedSetupRunChange>,
) => GuidedSetupRunChange = (
  copy: RunCopy,
  unsent: ReadonlyArray<GuidedSetupRunChange>,
): GuidedSetupRunChange => {
  const change: GuidedSetupRunChange = { values: {}, resources: {} };

  for (const pending of unsent) {
    for (const [name, value] of Object.entries(pending.values)) {
      if (value === null) {
        change.values[name] = null;
      }
    }

    for (const [name, progress] of Object.entries(pending.resources)) {
      if (progress === null) {
        change.resources[name] = null;
      }
    }
  }

  for (const [name, value] of Object.entries(copy.values)) {
    change.values[name] = value;
  }

  for (const [name, progress] of Object.entries(copy.resources)) {
    const sent: GuidedSetupResourceProgressChange = { status: progress.status };

    if (progress.recordId) {
      sent.recordId = progress.recordId;
    }

    if (progress.name) {
      sent.name = progress.name;
    }

    if (progress.error) {
      sent.error = progress.error;
    }

    change.resources[name] = sent;
  }

  return change;
};

// The changes not yet sent, as one: a later one wins name by name.
const mergeChanges: (
  changes: ReadonlyArray<GuidedSetupRunChange>,
) => GuidedSetupRunChange = (
  changes: ReadonlyArray<GuidedSetupRunChange>,
): GuidedSetupRunChange => {
  const merged: GuidedSetupRunChange = { values: {}, resources: {} };

  for (const change of changes) {
    Object.assign(merged.values, change.values);
    Object.assign(merged.resources, change.resources);
  }

  return merged;
};

const isGuidedSetupRunKey: (setup: string) => setup is GuidedSetupKey = (
  setup: string,
): setup is GuidedSetupKey => {
  return (Object.values(GuidedSetupKey) as Array<string>).includes(setup);
};

/*
 * THE RUN, KEPT ON THE SERVER AND CACHED HERE (#7253).
 *
 * The server keeps one run per setup, project and person
 * (Common/Types/GuidedSetup/GuidedSetupRun.ts). This store is the page's way
 * to it:
 *
 *   - load() reads the server's run when the page opens. A browser that kept
 *     changes the server never got - an older Dashboard's run, or a change
 *     made while OneUptime could not be reached - sends them first, so
 *     nothing it knew is lost. When the server cannot be reached, the page
 *     opens on what this browser kept, as it always did.
 *   - read() and save() are the page's copy, at once: a step saves and moves
 *     on without waiting. Each save is sent to the server behind it, in
 *     order; one the server did not take is sent again with the next, or
 *     with retry(), and until then the panel says the run is kept in this
 *     browser only (GuidedSetupRunSync).
 *   - track() keeps how each record a step makes is getting on (creating,
 *     made, failed and why), for the setup's panel - on the server too, so
 *     another device sees what happened.
 *   - forget() starts afresh, here and on the server.
 *
 * A setup the server keeps no run for (one only a test draws) is kept in
 * this browser alone.
 */
export default class GuidedSetupRunStore {
  private readonly key: string;
  private readonly setupKey: GuidedSetupKey | null;
  private readonly remote: GuidedSetupRunRemote;

  // The run as this page knows it; null until it reads or saves one.
  private page: RunCopy | null = null;
  // Changes kept here that the server has not taken yet, in order.
  private unsent: Array<GuidedSetupRunChange> = [];
  // A send failed: the next one carries the whole run.
  private isServerBehind: boolean = false;
  private isForgetPending: boolean = false;
  private sending: Promise<void> | null = null;
  private sync: GuidedSetupRunSync = GuidedSetupRunSync.Idle;
  private listeners: Array<(sync: GuidedSetupRunSync) => void> = [];

  public constructor(data: {
    setup: string;
    projectId: string;
    userId: string;
    // For tests: the server. The Dashboard's routes otherwise.
    remote?: GuidedSetupRunRemote | undefined;
  }) {
    this.key = getGuidedSetupRunKey(data);
    this.setupKey = isGuidedSetupRunKey(data.setup) ? data.setup : null;
    this.remote = data.remote || GuidedSetupRunApi;
  }

  public getSync(): GuidedSetupRunSync {
    return this.sync;
  }

  // Calls `listener` each time the run's place with the server changes.
  public subscribe(listener: (sync: GuidedSetupRunSync) => void): () => void {
    this.listeners.push(listener);

    return () => {
      this.listeners = this.listeners.filter(
        (candidate: (sync: GuidedSetupRunSync) => void): boolean => {
          return candidate !== listener;
        },
      );
    };
  }

  /*
   * The run this page knows: what it read or saved, or, before either, what
   * this browser kept.
   */
  public read(): GuidedSetupRun {
    return { ...this.getCopy().values };
  }

  // How each record the run makes is getting on, by name.
  public readResources(): GuidedSetupRunResources {
    return { ...this.getCopy().resources };
  }

  /*
   * The run as the server keeps it, read when the page opens: what decides
   * which step opens. Never throws: when the server cannot be reached, the
   * run this browser kept.
   */
  public async load(): Promise<GuidedSetupRun> {
    await this.waitForSends();

    const kept: KeptRun | null = this.readKept();

    if (kept) {
      this.page = { values: kept.values, resources: kept.resources };
      this.isForgetPending = kept.isForgetPending;
      this.isServerBehind =
        !kept.isSynced && !kept.isForgetPending && hasAnything(kept);
    } else if (!this.page) {
      this.page = emptyCopy();
    }

    if (!this.setupKey) {
      return this.read();
    }

    try {
      if (this.isForgetPending) {
        await this.remote.forget(this.setupKey);
        this.isForgetPending = false;

        // What was saved after the start afresh is the new run's: sent too.
        if (hasAnything(this.page || emptyCopy())) {
          this.takeAnswer(
            await this.remote.save(
              this.setupKey,
              toWholeChange(this.page || emptyCopy(), []),
            ),
          );
        } else {
          this.takeAnswer(null);
        }
      } else if (this.isServerBehind) {
        // What this browser has that the server may not: sent first.
        const answer: GuidedSetupRunAnswer = await this.remote.save(
          this.setupKey,
          toWholeChange(this.getCopy(), []),
        );
        this.isServerBehind = false;
        this.takeAnswer(answer);
      } else {
        this.takeAnswer(await this.remote.fetch(this.setupKey));
      }

      this.setSync(
        hasAnything(this.getCopy())
          ? GuidedSetupRunSync.Saved
          : GuidedSetupRunSync.Idle,
      );
    } catch {
      // Out of reach: the page goes on with what this browser kept.
      this.setSync(
        hasAnything(this.getCopy()) || this.isForgetPending
          ? GuidedSetupRunSync.NotSaved
          : GuidedSetupRunSync.Idle,
      );
    }

    // Saved while the read was out: sent now.
    if (this.unsent.length > 0) {
      this.send();
    }

    return this.read();
  }

  /*
   * The run, with these values set (and the ones given as null, false or ""
   * removed), and these resources' progress: kept here at once, and sent to
   * the server behind it.
   */
  public save(
    values: Record<string, string | boolean | null>,
    resources?: Record<string, GuidedSetupResourceUpdate | null> | undefined,
  ): GuidedSetupRun {
    const change: GuidedSetupRunChange = { values: {}, resources: {} };

    for (const [name, value] of Object.entries(values)) {
      change.values[name] =
        value === null || value === false || value === "" ? null : value;
    }

    for (const [name, progress] of Object.entries(resources || {})) {
      change.resources[name] = progress;
    }

    this.change(change);

    return this.read();
  }

  /*
   * Notes how records are getting on: `{ monitor: { status: Creating } }`
   * before the request, `{ status: Created, recordId }` once it is made,
   * `{ status: Failed, error }` when it is not. Null forgets one.
   */
  public track(
    resources: Record<string, GuidedSetupResourceUpdate | null>,
  ): GuidedSetupRunResources {
    this.change({ values: {}, resources: { ...resources } });

    return this.readResources();
  }

  // The run as a whole: the values given, and nothing else.
  public write(run: GuidedSetupRun): void {
    const values: Record<string, string | boolean | null> = {};

    for (const name of Object.keys(this.getCopy().values)) {
      values[name] = null;
    }

    for (const [name, value] of Object.entries(readGuidedSetupRun(run))) {
      values[name] = value;
    }

    this.save(values);
  }

  // A run started over, or whose records are gone: the next one starts afresh.
  public forget(): void {
    this.page = emptyCopy();
    this.unsent = [];
    this.isServerBehind = false;
    this.isForgetPending = Boolean(this.setupKey);
    this.writeKept();
    this.send();
  }

  // Sends again what the server did not take (the panel's Try again).
  public retry(): void {
    this.send();
  }

  // Resolves once every change made so far was sent, or failed to be.
  public async flush(): Promise<void> {
    await this.waitForSends();
  }

  private change(change: GuidedSetupRunChange): void {
    this.page = applyChange(this.getCopy(), change, new Date().toISOString());

    if (this.setupKey) {
      this.unsent.push(change);
    }

    this.writeKept();
    this.send();
  }

  /*
   * The run as this page knows it. What this browser kept wins over the
   * page's copy, as another tab of the same person may have moved the run
   * on; a browser that keeps nothing (a private window, storage switched
   * off) leaves the page's copy, so no step's save is lost (#7059).
   */
  private getCopy(): RunCopy {
    const kept: KeptRun | null = this.readKept();

    /*
     * A start afresh the server has not heard yet is kept with what was
     * saved after it (nothing, at first): that is the run.
     */
    if (kept && (kept.isForgetPending || hasAnything(kept))) {
      this.page = { values: kept.values, resources: kept.resources };
    } else if (!this.page) {
      this.page = emptyCopy();
    }

    return this.page;
  }

  private takeAnswer(answer: GuidedSetupRunAnswer | null): void {
    const copy: RunCopy = answer?.run
      ? { values: answer.run.values, resources: answer.run.resources }
      : emptyCopy();
    const at: string = new Date().toISOString();

    // What this page saved while the answer was out is still its own.
    this.page = this.unsent.reduce(
      (current: RunCopy, change: GuidedSetupRunChange): RunCopy => {
        return applyChange(current, change, at);
      },
      copy,
    );
    this.writeKept();
  }

  private waitForSends: () => Promise<void> = async (): Promise<void> => {
    while (this.sending) {
      await this.sending;
    }
  };

  // Sends what is not sent yet, one request at a time, in order.
  private send(): void {
    if (!this.setupKey || this.sending) {
      return;
    }

    if (this.unsent.length === 0 && !this.isForgetPending) {
      return;
    }

    const setupKey: GuidedSetupKey = this.setupKey;
    let didFail: boolean = false;

    const sending: Promise<void> = (async (): Promise<void> => {
      this.setSync(GuidedSetupRunSync.Saving);

      try {
        while (this.isForgetPending || this.unsent.length > 0) {
          if (this.isForgetPending) {
            await this.remote.forget(setupKey);
            this.isForgetPending = false;
            continue;
          }

          const batch: Array<GuidedSetupRunChange> = this.unsent.slice();
          const change: GuidedSetupRunChange = this.isServerBehind
            ? toWholeChange(this.getCopy(), batch)
            : mergeChanges(batch);

          await this.remote.save(setupKey, change);
          /*
           * The changes sent, and only those: a start afresh while they were
           * out replaced the list, and what was saved after it is still to
           * send.
           */
          this.unsent = this.unsent.filter(
            (pending: GuidedSetupRunChange): boolean => {
              return !batch.includes(pending);
            },
          );
          this.isServerBehind = false;
        }

        this.writeKept();
        this.setSync(
          hasAnything(this.getCopy())
            ? GuidedSetupRunSync.Saved
            : GuidedSetupRunSync.Idle,
        );
      } catch {
        // Kept here: sent again with the next change, or retry().
        didFail = true;
        this.isServerBehind = !this.isForgetPending;
        this.writeKept();
        this.setSync(GuidedSetupRunSync.NotSaved);
      }
    })();

    this.sending = sending;

    void sending.finally(() => {
      if (this.sending === sending) {
        this.sending = null;
      }

      /*
       * A save made as this request finished found it still out and left
       * its change to it: sent now. After a failure, the next change or
       * retry() sends again.
       */
      if (!didFail) {
        this.send();
      }
    });
  }

  private setSync(sync: GuidedSetupRunSync): void {
    if (this.sync === sync) {
      return;
    }

    this.sync = sync;

    for (const listener of this.listeners) {
      listener(sync);
    }
  }

  private readKept(): KeptRun | null {
    let stored: JSONValue | null = null;

    try {
      stored = LocalStorage.getItem(this.key);
    } catch {
      return null;
    }

    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return null;
    }

    const value: JSONObject = stored as JSONObject;

    if (value["format"] === KEPT_FORMAT) {
      return {
        values: readGuidedSetupRunValues(value["values"]),
        resources: readGuidedSetupRunResources(value["resources"]),
        isSynced: value["isSynced"] === true,
        isForgetPending: value["isForgetPending"] === true,
      };
    }

    // An older Dashboard's run: its values, never sent to the server.
    const values: GuidedSetupRunValues = readGuidedSetupRunValues(value);

    if (Object.keys(values).length === 0) {
      return null;
    }

    return {
      values: values,
      resources: {},
      isSynced: false,
      isForgetPending: false,
    };
  }

  // Keeps the page's copy in this browser, as it stands.
  private writeKept(): void {
    const copy: RunCopy = this.page || emptyCopy();

    try {
      if (!hasAnything(copy) && !this.isForgetPending) {
        LocalStorage.removeItem(this.key);
        return;
      }

      LocalStorage.setItem(this.key, {
        format: KEPT_FORMAT,
        values: { ...copy.values },
        resources: JSON.parse(JSON.stringify(copy.resources)) as JSONObject,
        isSynced:
          !this.isServerBehind &&
          !this.isForgetPending &&
          this.unsent.length === 0,
        isForgetPending: this.isForgetPending,
      });
    } catch {
      // Not kept by the browser: this page keeps it until it closes.
    }
  }
}
