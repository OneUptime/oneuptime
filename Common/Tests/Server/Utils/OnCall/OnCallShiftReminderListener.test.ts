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
 *      request (the api role for a dashboard edit).
 */

// Imported last so the registration side effect is what the tests observe.
import registerOnCallShiftReminderListener, {
  onCallShiftReminderListener,
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
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
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
