import { describe, expect, test } from "@jest/globals";
import {
  GUIDED_SETUP_RESOURCE_INTERRUPTED,
  GUIDED_SETUP_RESOURCE_INTERRUPTED_AFTER_MS,
  GUIDED_SETUP_RESOURCE_STATUS_TONES,
  GUIDED_SETUP_RESOURCE_STATUS_WORDS,
  GuidedSetupResourceRow,
  countReadyResources,
  getGuidedSetupResourceStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupResources";
import {
  GuidedSetupResourceProgress,
  GuidedSetupResourceStatus,
} from "../../../Types/GuidedSetup/GuidedSetupRun";
import { PillTone } from "../../../UI/Components/Pill/PillTone";

/*
 * What a guided setup's panel says of each record it makes (#10276), from
 * what the page knows now and what the run kept on the server (#7253): so
 * a reload, or another device, draws the same panel, and a record made then
 * deleted elsewhere is never said to be there.
 */

const NOW: Date = new Date("2026-11-20T10:00:00.000Z");

const progress: (
  status: GuidedSetupResourceStatus,
  extra?: Partial<GuidedSetupResourceProgress>,
) => GuidedSetupResourceProgress = (
  status: GuidedSetupResourceStatus,
  extra: Partial<GuidedSetupResourceProgress> = {},
): GuidedSetupResourceProgress => {
  return { status: status, at: NOW.toISOString(), ...extra };
};

describe("what the panel says of a record", () => {
  test("nothing known: waiting for its step", () => {
    expect(getGuidedSetupResourceStatus({ exists: false })).toEqual({
      status: GuidedSetupResourceStatus.Waiting,
    });
  });

  test("a request out on this page: being made, whatever the run kept", () => {
    expect(
      getGuidedSetupResourceStatus({
        isWorking: true,
        exists: false,
        progress: progress(GuidedSetupResourceStatus.Failed),
      }).status,
    ).toBe(GuidedSetupResourceStatus.Creating);
  });

  test("it exists: made by this run, or there already and in use", () => {
    expect(getGuidedSetupResourceStatus({ exists: true }).status).toBe(
      GuidedSetupResourceStatus.Created,
    );
    expect(
      getGuidedSetupResourceStatus({ exists: true, isExisting: true }).status,
    ).toBe(GuidedSetupResourceStatus.Existing);
  });

  test("what exists wins over an earlier failure the run kept: a try after it worked", () => {
    expect(
      getGuidedSetupResourceStatus({
        exists: true,
        progress: progress(GuidedSetupResourceStatus.Failed, {
          error: "OneUptime could not be reached.",
        }),
      }),
    ).toEqual({ status: GuidedSetupResourceStatus.Created });
  });

  test("the person skipped its step: skipped", () => {
    expect(
      getGuidedSetupResourceStatus({ exists: false, isSkipped: true }).status,
    ).toBe(GuidedSetupResourceStatus.Skipped);
  });

  test("the run kept a failure: failed, with why", () => {
    expect(
      getGuidedSetupResourceStatus({
        exists: false,
        progress: progress(GuidedSetupResourceStatus.Failed, {
          error: "OneUptime is busy and could not save this.",
        }),
      }),
    ).toEqual({
      status: GuidedSetupResourceStatus.Failed,
      error: "OneUptime is busy and could not save this.",
    });
  });

  test("a record the run kept as made that is gone now is waiting again: its step is to do again", () => {
    expect(
      getGuidedSetupResourceStatus({
        exists: false,
        progress: progress(GuidedSetupResourceStatus.Created, {
          recordId: "m-1",
        }),
      }).status,
    ).toBe(GuidedSetupResourceStatus.Waiting);
  });

  test("kept as being made, and new: being made on another device right now", () => {
    expect(
      getGuidedSetupResourceStatus({
        exists: false,
        progress: progress(GuidedSetupResourceStatus.Creating),
        now: new Date(NOW.getTime() + 30 * 1000),
      }).status,
    ).toBe(GuidedSetupResourceStatus.Creating);
  });

  test("kept as being made, and old: it stopped when its page closed - failed, with Try again's promise", () => {
    expect(GUIDED_SETUP_RESOURCE_INTERRUPTED_AFTER_MS).toBe(2 * 60 * 1000);

    expect(
      getGuidedSetupResourceStatus({
        exists: false,
        progress: progress(GuidedSetupResourceStatus.Creating),
        now: new Date(
          NOW.getTime() + GUIDED_SETUP_RESOURCE_INTERRUPTED_AFTER_MS,
        ),
      }),
    ).toEqual({
      status: GuidedSetupResourceStatus.Failed,
      error: GUIDED_SETUP_RESOURCE_INTERRUPTED,
      isInterrupted: true,
    });
    expect(GUIDED_SETUP_RESOURCE_INTERRUPTED).toBe(
      "This was being made when its page closed. Try again: nothing is made twice.",
    );
  });

  test("kept as being made at a time nobody can read: stopped", () => {
    expect(
      getGuidedSetupResourceStatus({
        exists: false,
        progress: progress(GuidedSetupResourceStatus.Creating, {
          at: "not a time",
        }),
      }).isInterrupted,
    ).toBe(true);
  });
});

describe("how each status is drawn", () => {
  test("in words a person reads, one for each status", () => {
    expect(GUIDED_SETUP_RESOURCE_STATUS_WORDS).toEqual({
      waiting: "Waiting",
      creating: "Creating…",
      created: "Created",
      existing: "In use",
      failed: "Failed",
      skipped: "Skipped",
    });
  });

  test("in the chip's tones: made or in use works, failed broke, and skipped is the person's choice - grey, never red", () => {
    expect(GUIDED_SETUP_RESOURCE_STATUS_TONES).toEqual({
      waiting: PillTone.Neutral,
      creating: PillTone.Info,
      created: PillTone.Success,
      existing: PillTone.Success,
      failed: PillTone.Danger,
      skipped: PillTone.Paused,
    });
  });
});

describe("how many are ready", () => {
  const row: (status: GuidedSetupResourceStatus) => GuidedSetupResourceRow = (
    status: GuidedSetupResourceStatus,
  ): GuidedSetupResourceRow => {
    return { key: status, stepKey: "step", kind: "Monitor", status: status };
  };

  test("made and in use are ready; waiting, being made and failed are not", () => {
    expect(
      countReadyResources([
        row(GuidedSetupResourceStatus.Created),
        row(GuidedSetupResourceStatus.Existing),
        row(GuidedSetupResourceStatus.Waiting),
        row(GuidedSetupResourceStatus.Creating),
        row(GuidedSetupResourceStatus.Failed),
      ]),
    ).toEqual({ ready: 2, total: 5 });
  });

  test("a skipped one is not to do, so it counts as neither", () => {
    expect(
      countReadyResources([
        row(GuidedSetupResourceStatus.Created),
        row(GuidedSetupResourceStatus.Skipped),
      ]),
    ).toEqual({ ready: 1, total: 1 });
  });

  test("none listed: none to count", () => {
    expect(countReadyResources([])).toEqual({ ready: 0, total: 0 });
  });
});
