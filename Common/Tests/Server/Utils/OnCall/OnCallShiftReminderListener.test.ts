import OnCallShiftChangeListeners, {
  OnCallShiftChangeEvent,
  OnCallShiftChangeReason,
} from "../../../../Server/Utils/OnCall/OnCallShiftChangeListeners";
import OnCallShiftReminderRunner, {
  SHIFT_REMINDER_LISTENER_NAME,
  ShiftReminderChangePassStats,
} from "../../../../Server/Utils/OnCall/OnCallShiftReminderRunner";
import logger from "../../../../Server/Utils/Logger";
import ObjectID from "../../../../Types/ObjectID";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * OnCallShiftReminderListener wires the change pass (catch-up + reassigned
 * notices) into the on-call configuration hooks through
 * OnCallShiftChangeListeners. Pinned here:
 *
 *   1. importing the module registers the listener under the runner's name
 *      (a side effect, like a RunCron job file) and doing so twice never
 *      stacks a second listener;
 *   2. the registered function hands the event to
 *      OnCallShiftReminderRunner.runChangePass;
 *   3. a change pass that throws is caught and logged — the hook that
 *      published the event can neither fail nor be delayed by it;
 *   4. BOTH App/Index.ts and App/FeatureSet/Workers/Index.ts import the
 *      module, because the hooks run in whichever process serves the CRUD
 *      request (the api role for a dashboard edit);
 *   5. bursts are coalesced: one pass per project at a time, everything that
 *      arrives while it runs merged into ONE follow-up, so bulk edits cannot
 *      pile N synchronous schedule expansions onto the api event loop.
 */

// Imported last so the registration side effect is what the tests observe.
import registerOnCallShiftReminderListener, {
  mergeOnCallShiftChangeEvents,
  onCallShiftReminderListener,
  resetOnCallShiftReminderCoalescing,
} from "../../../../Server/Utils/OnCall/OnCallShiftReminderListener";

const COMMON_DIR: string = path.resolve(__dirname, "../../../..");
const APP_DIR: string = path.resolve(COMMON_DIR, "../App");
const LISTENER_PATH: string = path.join(
  COMMON_DIR,
  "Server",
  "Utils",
  "OnCall",
  "OnCallShiftReminderListener.ts",
);

const LISTENER_SPECIFIER: string =
  "Common/Server/Utils/OnCall/OnCallShiftReminderListener";

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SIDE_EFFECT_IMPORT: RegExp = new RegExp(
  `^\\s*import\\s+["']${escapeForRegExp(LISTENER_SPECIFIER)}["']\\s*;?\\s*$`,
  "m",
);

function event(): OnCallShiftChangeEvent {
  return OnCallShiftChangeListeners.buildEvent({
    projectId: new ObjectID("project-1"),
    scheduleIds: [new ObjectID("schedule-1")],
    userIds: [new ObjectID("user-a")],
    reason: OnCallShiftChangeReason.OverrideChanged,
  });
}

function eventFor(data: {
  projectId: string | null;
  scheduleId: string;
  userId: string;
  reason?: OnCallShiftChangeReason | undefined;
  occurredAt?: Date | undefined;
}): OnCallShiftChangeEvent {
  return OnCallShiftChangeListeners.buildEvent({
    projectId: data.projectId ? new ObjectID(data.projectId) : null,
    scheduleIds: [new ObjectID(data.scheduleId)],
    userIds: [new ObjectID(data.userId)],
    reason: data.reason ?? OnCallShiftChangeReason.LayerUserChanged,
    occurredAt: data.occurredAt,
  });
}

function idsOf(ids: Array<ObjectID>): Array<string> {
  return ids
    .map((id: ObjectID) => {
      return id.toString();
    })
    .sort();
}

function emptyStats(): ShiftReminderChangePassStats {
  return {
    now: new Date(),
    projectId: "project-1",
    users: 0,
    catchUpsSent: 0,
    reassignedSent: 0,
    claimCollisions: 0,
    sendFailures: 0,
    missingSettings: 0,
    errors: 0,
    skippedReason: null,
  };
}

describe("OnCallShiftReminderListener", () => {
  beforeEach(() => {
    resetOnCallShiftReminderCoalescing();
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    resetOnCallShiftReminderCoalescing();
    jest.restoreAllMocks();
  });

  test("importing the module registers the change pass under the runner's listener name", () => {
    expect(SHIFT_REMINDER_LISTENER_NAME).toBe("shift-reminders");
    expect(OnCallShiftChangeListeners.getRegisteredNames()).toContain(
      SHIFT_REMINDER_LISTENER_NAME,
    );
  });

  test("registering again (a second import, another role) never stacks a second listener", () => {
    const before: number = OnCallShiftChangeListeners.getCount();

    registerOnCallShiftReminderListener();
    registerOnCallShiftReminderListener();

    expect(OnCallShiftChangeListeners.getCount()).toBe(before);
    expect(
      OnCallShiftChangeListeners.getRegisteredNames().filter(
        (name: string | undefined) => {
          return name === SHIFT_REMINDER_LISTENER_NAME;
        },
      ),
    ).toHaveLength(1);
  });

  test("the listener hands the event to OnCallShiftReminderRunner.runChangePass", async () => {
    const runChangePass: any = jest
      .spyOn(OnCallShiftReminderRunner, "runChangePass")
      .mockResolvedValue(emptyStats());

    const published: OnCallShiftChangeEvent = event();

    await onCallShiftReminderListener(published);

    expect(runChangePass).toHaveBeenCalledTimes(1);
    expect(runChangePass.mock.calls[0]![0]).toBe(published);
  });

  test("a change pass reached through notify() runs for a published event", async () => {
    const runChangePass: any = jest
      .spyOn(OnCallShiftReminderRunner, "runChangePass")
      .mockResolvedValue(emptyStats());

    await OnCallShiftChangeListeners.notify(event());

    expect(runChangePass).toHaveBeenCalledTimes(1);
  });

  test("a throwing change pass is caught and logged; the listener itself resolves", async () => {
    jest
      .spyOn(OnCallShiftReminderRunner, "runChangePass")
      .mockRejectedValue(new Error("boom"));

    await expect(onCallShiftReminderListener(event())).resolves.toBeUndefined();

    const errorLog: any = logger.error as any;

    expect(errorLog).toHaveBeenCalled();
    expect(
      errorLog.mock.calls.some((call: Array<unknown>) => {
        return String(call[0]).includes(SHIFT_REMINDER_LISTENER_NAME);
      }),
    ).toBe(true);
  });

  test("a synchronous throw inside runChangePass is caught too", async () => {
    jest
      .spyOn(OnCallShiftReminderRunner, "runChangePass")
      .mockImplementation((): Promise<ShiftReminderChangePassStats> => {
        throw new TypeError("sync boom");
      });

    await expect(onCallShiftReminderListener(event())).resolves.toBeUndefined();
  });

  /*
   * Coalescing. The hooks run on the api tier, and every pass re-materializes
   * the affected schedules synchronously, so a burst of edits (ten users
   * added to a layer is ten create hooks) must not become ten passes.
   */
  describe("coalescing bursts", () => {
    interface GatedRun {
      events: Array<OnCallShiftChangeEvent>;
      release: () => void;
    }

    /** runChangePass that blocks on the FIRST call until released. */
    function gateFirstPass(): GatedRun {
      const events: Array<OnCallShiftChangeEvent> = [];
      let release: () => void = (): void => {
        return undefined;
      };

      const gate: Promise<void> = new Promise<void>((resolve: () => void) => {
        release = resolve;
      });

      jest
        .spyOn(OnCallShiftReminderRunner, "runChangePass")
        .mockImplementation((async (
          published: OnCallShiftChangeEvent,
        ): Promise<ShiftReminderChangePassStats> => {
          events.push(published);

          if (events.length === 1) {
            await gate;
          }

          return emptyStats();
        }) as never);

      return { events, release };
    }

    test("a burst for one project costs two passes, and the follow-up carries the union of what queued", async () => {
      const run: GatedRun = gateFirstPass();

      const first: Promise<void> = onCallShiftReminderListener(
        eventFor({
          projectId: "project-1",
          scheduleId: "schedule-1",
          userId: "user-a",
        }),
      );
      const second: Promise<void> = onCallShiftReminderListener(
        eventFor({
          projectId: "project-1",
          scheduleId: "schedule-1",
          userId: "user-b",
        }),
      );
      const third: Promise<void> = onCallShiftReminderListener(
        eventFor({
          projectId: "project-1",
          scheduleId: "schedule-2",
          userId: "user-c",
          reason: OnCallShiftChangeReason.LayerChanged,
        }),
      );

      run.release();

      await Promise.all([first, second, third]);

      expect(run.events).toHaveLength(2);
      expect(idsOf(run.events[0]!.userIds)).toEqual(["user-a"]);

      // The merged follow-up: both queued events, nothing lost.
      expect(idsOf(run.events[1]!.userIds)).toEqual(["user-b", "user-c"]);
      expect(idsOf(run.events[1]!.scheduleIds)).toEqual([
        "schedule-1",
        "schedule-2",
      ]);
      expect(run.events[1]!.reason).toBe(OnCallShiftChangeReason.LayerChanged);
    });

    test("every caller's promise settles only after the pass covering its event has run", async () => {
      const run: GatedRun = gateFirstPass();

      let secondSettled: boolean = false;

      const first: Promise<void> = onCallShiftReminderListener(
        eventFor({
          projectId: "project-1",
          scheduleId: "schedule-1",
          userId: "user-a",
        }),
      );
      const second: Promise<void> = onCallShiftReminderListener(
        eventFor({
          projectId: "project-1",
          scheduleId: "schedule-1",
          userId: "user-b",
        }),
      ).then((): void => {
        secondSettled = true;
      });

      expect(secondSettled).toBe(false);
      expect(run.events).toHaveLength(1);

      run.release();
      await Promise.all([first, second]);

      expect(secondSettled).toBe(true);
      expect(run.events).toHaveLength(2);
    });

    test("different projects are never queued behind each other", async () => {
      const run: GatedRun = gateFirstPass();

      const first: Promise<void> = onCallShiftReminderListener(
        eventFor({
          projectId: "project-1",
          scheduleId: "schedule-1",
          userId: "user-a",
        }),
      );
      const other: Promise<void> = onCallShiftReminderListener(
        eventFor({
          projectId: "project-2",
          scheduleId: "schedule-9",
          userId: "user-z",
        }),
      );

      // The second project ran while the first was still blocked.
      await other;
      expect(run.events).toHaveLength(2);
      expect(run.events[1]!.projectId?.toString()).toBe("project-2");

      run.release();
      await first;
    });

    test("an event that names no project is never coalesced (the pass resolves it from the schedules)", async () => {
      const run: GatedRun = gateFirstPass();

      const first: Promise<void> = onCallShiftReminderListener(
        eventFor({
          projectId: null,
          scheduleId: "schedule-1",
          userId: "user-a",
        }),
      );
      const second: Promise<void> = onCallShiftReminderListener(
        eventFor({
          projectId: null,
          scheduleId: "schedule-2",
          userId: "user-b",
        }),
      );

      await second;
      expect(run.events).toHaveLength(2);

      run.release();
      await first;
    });

    test("a queued follow-up still runs when the pass before it throws", async () => {
      const events: Array<OnCallShiftChangeEvent> = [];
      let release: () => void = (): void => {
        return undefined;
      };
      const gate: Promise<void> = new Promise<void>((resolve: () => void) => {
        release = resolve;
      });

      jest
        .spyOn(OnCallShiftReminderRunner, "runChangePass")
        .mockImplementation((async (
          published: OnCallShiftChangeEvent,
        ): Promise<ShiftReminderChangePassStats> => {
          events.push(published);

          if (events.length === 1) {
            await gate;
            throw new Error("boom");
          }

          return emptyStats();
        }) as never);

      const first: Promise<void> = onCallShiftReminderListener(
        eventFor({
          projectId: "project-1",
          scheduleId: "schedule-1",
          userId: "user-a",
        }),
      );
      const second: Promise<void> = onCallShiftReminderListener(
        eventFor({
          projectId: "project-1",
          scheduleId: "schedule-1",
          userId: "user-b",
        }),
      );

      release();

      await expect(first).resolves.toBeUndefined();
      await expect(second).resolves.toBeUndefined();
      expect(events).toHaveLength(2);
      expect(idsOf(events[1]!.userIds)).toEqual(["user-b"]);
    });

    test("a later burst after the queue drained starts a fresh pass", async () => {
      jest
        .spyOn(OnCallShiftReminderRunner, "runChangePass")
        .mockResolvedValue(emptyStats());

      await onCallShiftReminderListener(event());
      await onCallShiftReminderListener(event());

      expect(
        (OnCallShiftReminderRunner.runChangePass as any).mock.calls,
      ).toHaveLength(2);
    });

    test("mergeOnCallShiftChangeEvents unions the ids and keeps the newest occurredAt", () => {
      const older: OnCallShiftChangeEvent = eventFor({
        projectId: "project-1",
        scheduleId: "schedule-1",
        userId: "user-a",
        reason: OnCallShiftChangeReason.LayerUserChanged,
        occurredAt: new Date("2026-09-03T15:00:00Z"),
      });
      const newer: OnCallShiftChangeEvent = eventFor({
        projectId: "project-1",
        scheduleId: "schedule-2",
        userId: "user-a",
        reason: OnCallShiftChangeReason.OverrideChanged,
        occurredAt: new Date("2026-09-03T15:00:05Z"),
      });

      const merged: OnCallShiftChangeEvent = mergeOnCallShiftChangeEvents(
        older,
        newer,
      );

      expect(merged.projectId?.toString()).toBe("project-1");
      expect(idsOf(merged.scheduleIds)).toEqual(["schedule-1", "schedule-2"]);
      // Deduplicated, not repeated.
      expect(idsOf(merged.userIds)).toEqual(["user-a"]);
      expect(merged.reason).toBe(OnCallShiftChangeReason.OverrideChanged);
      expect(merged.occurredAt.toISOString()).toBe("2026-09-03T15:00:05.000Z");
    });
  });

  describe("wiring", () => {
    test("the module exists where the two entrypoints import it from", () => {
      expect(fs.existsSync(LISTENER_PATH)).toBe(true);
    });

    test("App/FeatureSet/Workers/Index.ts imports the listener module as a side effect", () => {
      const source: string = fs.readFileSync(
        path.join(APP_DIR, "FeatureSet", "Workers", "Index.ts"),
        "utf8",
      );

      expect(source).toMatch(SIDE_EFFECT_IMPORT);
    });

    test("App/Index.ts imports the listener module too, so the api role runs the change pass", () => {
      const source: string = fs.readFileSync(
        path.join(APP_DIR, "Index.ts"),
        "utf8",
      );

      expect(source).toMatch(SIDE_EFFECT_IMPORT);
    });

    test("the listener module registers at import time (a plain function nobody calls would be dead code)", () => {
      const source: string = fs.readFileSync(LISTENER_PATH, "utf8");

      expect(source).toMatch(/^registerOnCallShiftReminderListener\(\);\s*$/m);
      expect(source).toContain("OnCallShiftChangeListeners.register(");
      expect(source).toContain("SHIFT_REMINDER_LISTENER_NAME");
    });
  });
});
