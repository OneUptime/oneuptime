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
 *   - which records this run made (the monitor, the policy, the test page)
 *     is kept in this browser, per setup, project and person
 *     (GuidedSetupRunStore) - a run is about what this person is doing;
 *   - whether each step is done is read from those records when the page
 *     opens, never from the browser alone: a monitor deleted since is a
 *     step to do again;
 *   - a browser that lost the run (a private window, another device,
 *     storage cleared) makes nothing twice: before a step makes a record,
 *     it looks for the one this person already has (#7059);
 *   - a run is kept until the person starts another: coming back after
 *     the last step shows its summary again.
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
 * values (ids, and true for a step that saves nothing of its own).
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

// Only strings and true are kept: anything else in storage is not a run's.
export const readGuidedSetupRun: (value: JSONValue | null) => GuidedSetupRun = (
  value: JSONValue | null,
): GuidedSetupRun => {
  const run: GuidedSetupRun = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return run;
  }

  for (const [name, entry] of Object.entries(value as JSONObject)) {
    if ((typeof entry === "string" && entry.length > 0) || entry === true) {
      run[name] = entry;
    }
  }

  return run;
};

/*
 * Kept in this browser's local storage, so a run survives a closed tab, and
 * in this page too: a browser that keeps nothing (a private window, storage
 * switched off, or one that reads back nothing it was given) still walks the
 * setup with every value a step saved, and only starts again when the page
 * opens again (#7059).
 *
 * A run the browser lost is never a reason to make a record twice: each
 * setup looks for what this person already made before it makes something
 * (the website-down setup's monitor for the same address #7059, the status
 * page setup's page with the same name #7252), and a step that makes the
 * project's first on-call policy reads the project's policies again just
 * before, so another tab or device that made one meanwhile is not doubled
 * (the website-down and on-call setups).
 */
export default class GuidedSetupRunStore {
  private readonly key: string;

  // The run as this page last saved or read it; null until it does either.
  private kept: GuidedSetupRun | null = null;

  public constructor(data: {
    setup: string;
    projectId: string;
    userId: string;
  }) {
    this.key = getGuidedSetupRunKey(data);
  }

  /*
   * The run in this browser's storage. When storage holds none, or cannot
   * be read, the run this page kept: what it saved while the browser kept
   * nothing.
   */
  public read(): GuidedSetupRun {
    let stored: GuidedSetupRun = {};

    try {
      stored = readGuidedSetupRun(LocalStorage.getItem(this.key));
    } catch {
      stored = {};
    }

    if (Object.keys(stored).length > 0) {
      this.kept = stored;
      return { ...stored };
    }

    return { ...(this.kept || {}) };
  }

  public write(run: GuidedSetupRun): void {
    const values: GuidedSetupRun = readGuidedSetupRun(run as JSONObject);
    this.kept = values;

    try {
      LocalStorage.setItem(this.key, values as JSONObject);
    } catch {
      // Not kept by the browser: this page keeps it until it closes.
    }
  }

  // The run, with these values added (and the ones given as null removed).
  public save(values: Record<string, string | boolean | null>): GuidedSetupRun {
    const run: GuidedSetupRun = this.read();

    for (const [name, value] of Object.entries(values)) {
      if (value === null || value === false || value === "") {
        delete run[name];
      } else {
        run[name] = value;
      }
    }

    this.write(run);

    return { ...run };
  }

  // A run started over, or whose records are gone: the next one starts afresh.
  public forget(): void {
    this.kept = null;

    try {
      LocalStorage.removeItem(this.key);
    } catch {
      // Nothing to forget.
    }
  }
}
