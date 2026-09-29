import OnCallShiftChangeListeners, {
  OnCallShiftChangeEvent,
  OnCallShiftChangeReason,
} from "../../../../Server/Utils/OnCall/OnCallShiftChangeListeners";
import logger from "../../../../Server/Utils/Logger";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const SCHEDULE_A: ObjectID = new ObjectID("schedule-a");
const SCHEDULE_B: ObjectID = new ObjectID("schedule-b");
const USER_1: ObjectID = new ObjectID("user-1");
const USER_2: ObjectID = new ObjectID("user-2");

function event(
  overrides?: Partial<OnCallShiftChangeEvent>,
): OnCallShiftChangeEvent {
  return {
    projectId: PROJECT_ID,
    scheduleIds: [SCHEDULE_A],
    userIds: [USER_1],
    reason: OnCallShiftChangeReason.LayerChanged,
    occurredAt: new Date("2026-08-31T10:00:00Z"),
    ...(overrides || {}),
  };
}

describe("OnCallShiftChangeListeners", () => {
  beforeEach(() => {
    OnCallShiftChangeListeners.clear();
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    OnCallShiftChangeListeners.clear();
    jest.restoreAllMocks();
  });

  describe("register", () => {
    test("registers a listener and delivers events to it", async () => {
      const received: Array<OnCallShiftChangeEvent> = [];

      OnCallShiftChangeListeners.register((e: OnCallShiftChangeEvent) => {
        received.push(e);
      });

      const sent: OnCallShiftChangeEvent = event();
      await OnCallShiftChangeListeners.notify(sent);

      expect(received).toHaveLength(1);
      expect(received[0]).toBe(sent);
      expect(OnCallShiftChangeListeners.getCount()).toBe(1);
    });

    test("registering the same function twice without a name is a no-op", async () => {
      let calls: number = 0;
      const listener: () => void = (): void => {
        calls++;
      };

      OnCallShiftChangeListeners.register(listener);
      OnCallShiftChangeListeners.register(listener);

      expect(OnCallShiftChangeListeners.getCount()).toBe(1);

      await OnCallShiftChangeListeners.notify(event());
      expect(calls).toBe(1);
    });

    test("re-registering under the same name replaces the earlier listener", async () => {
      const seen: Array<string> = [];

      OnCallShiftChangeListeners.register((): void => {
        seen.push("first");
      }, "reminders");
      OnCallShiftChangeListeners.register((): void => {
        seen.push("second");
      }, "reminders");

      expect(OnCallShiftChangeListeners.getCount()).toBe(1);
      expect(OnCallShiftChangeListeners.getRegisteredNames()).toEqual([
        "reminders",
      ]);

      await OnCallShiftChangeListeners.notify(event());
      expect(seen).toEqual(["second"]);
    });

    test("two different names are two listeners", async () => {
      const seen: Array<string> = [];

      OnCallShiftChangeListeners.register((): void => {
        seen.push("a");
      }, "a");
      OnCallShiftChangeListeners.register((): void => {
        seen.push("b");
      }, "b");

      await OnCallShiftChangeListeners.notify(event());
      expect(seen.sort()).toEqual(["a", "b"]);
    });

    test("rejects a non-function", () => {
      expect(() => {
        OnCallShiftChangeListeners.register(
          "nope" as unknown as () => void,
          "bad",
        );
      }).toThrow();
      expect(OnCallShiftChangeListeners.getCount()).toBe(0);
    });
  });

  describe("unregister / clear", () => {
    test("unregister by name", async () => {
      let calls: number = 0;
      OnCallShiftChangeListeners.register((): void => {
        calls++;
      }, "named");

      OnCallShiftChangeListeners.unregister("named");
      expect(OnCallShiftChangeListeners.getCount()).toBe(0);

      await OnCallShiftChangeListeners.notify(event());
      expect(calls).toBe(0);
    });

    test("unregister by function reference", async () => {
      let calls: number = 0;
      const listener: () => void = (): void => {
        calls++;
      };
      OnCallShiftChangeListeners.register(listener);

      OnCallShiftChangeListeners.unregister(listener);

      await OnCallShiftChangeListeners.notify(event());
      expect(calls).toBe(0);
    });

    test("unregistering an unknown name or function is harmless", () => {
      OnCallShiftChangeListeners.register((): void => {
        return undefined;
      }, "keep");

      OnCallShiftChangeListeners.unregister("unknown");
      OnCallShiftChangeListeners.unregister((): void => {
        return undefined;
      });

      expect(OnCallShiftChangeListeners.getCount()).toBe(1);
    });

    test("clear drops everything", () => {
      OnCallShiftChangeListeners.register((): void => {
        return undefined;
      }, "x");
      OnCallShiftChangeListeners.register((): void => {
        return undefined;
      });

      OnCallShiftChangeListeners.clear();
      expect(OnCallShiftChangeListeners.getCount()).toBe(0);
    });
  });

  describe("notify", () => {
    test("resolves with no listeners registered", async () => {
      await expect(
        OnCallShiftChangeListeners.notify(event()),
      ).resolves.toBeUndefined();
    });

    test("awaits async listeners", async () => {
      let finished: boolean = false;

      OnCallShiftChangeListeners.register(async (): Promise<void> => {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 5);
        });
        finished = true;
      });

      await OnCallShiftChangeListeners.notify(event());
      expect(finished).toBe(true);
    });

    test("a throwing listener is logged and the others still run", async () => {
      const seen: Array<string> = [];

      OnCallShiftChangeListeners.register((): void => {
        throw new Error("boom");
      }, "broken");
      OnCallShiftChangeListeners.register((): void => {
        seen.push("healthy");
      }, "healthy");

      await expect(
        OnCallShiftChangeListeners.notify(event()),
      ).resolves.toBeUndefined();

      expect(seen).toEqual(["healthy"]);
      expect(logger.error).toHaveBeenCalled();

      const messages: Array<string> = (
        logger.error as unknown as jest.Mock
      ).mock.calls.map((call: Array<unknown>) => {
        return String(call[0]);
      });
      expect(
        messages.some((message: string) => {
          return message.includes('"broken"');
        }),
      ).toBe(true);
    });

    test("a rejecting async listener is logged and swallowed", async () => {
      OnCallShiftChangeListeners.register(async (): Promise<void> => {
        throw new Error("async boom");
      });

      await expect(
        OnCallShiftChangeListeners.notify(event()),
      ).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });

    test("a listener that unregisters itself during delivery does not break delivery", async () => {
      const seen: Array<string> = [];

      OnCallShiftChangeListeners.register((): void => {
        OnCallShiftChangeListeners.unregister("self");
        seen.push("self");
      }, "self");
      OnCallShiftChangeListeners.register((): void => {
        seen.push("other");
      }, "other");

      await OnCallShiftChangeListeners.notify(event());

      expect(seen.sort()).toEqual(["other", "self"]);
      expect(OnCallShiftChangeListeners.getRegisteredNames()).toEqual([
        "other",
      ]);
    });
  });

  describe("buildEvent / dedupe", () => {
    test("dedupes schedule and user ids and defaults occurredAt to now", () => {
      const before: number = Date.now();

      const built: OnCallShiftChangeEvent =
        OnCallShiftChangeListeners.buildEvent({
          projectId: PROJECT_ID,
          scheduleIds: [SCHEDULE_A, SCHEDULE_B, new ObjectID("schedule-a")],
          userIds: [USER_1, USER_1, USER_2],
          reason: OnCallShiftChangeReason.OverrideChanged,
        });

      expect(
        built.scheduleIds.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual(["schedule-a", "schedule-b"]);
      expect(
        built.userIds.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual(["user-1", "user-2"]);
      expect(built.reason).toBe(OnCallShiftChangeReason.OverrideChanged);
      expect(built.projectId).toBe(PROJECT_ID);
      expect(built.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    test("a missing project becomes null and missing userIds become []", () => {
      const built: OnCallShiftChangeEvent =
        OnCallShiftChangeListeners.buildEvent({
          projectId: undefined,
          scheduleIds: [],
          reason: OnCallShiftChangeReason.ScheduleDeleted,
          occurredAt: new Date("2026-01-01T00:00:00Z"),
        });

      expect(built.projectId).toBeNull();
      expect(built.userIds).toEqual([]);
      expect(built.scheduleIds).toEqual([]);
      expect(built.occurredAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    });

    test("dedupe skips null-ish entries and keeps first occurrence order", () => {
      const result: Array<ObjectID> = OnCallShiftChangeListeners.dedupe([
        USER_2,
        null as unknown as ObjectID,
        USER_1,
        USER_2,
      ]);

      expect(
        result.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual(["user-2", "user-1"]);
    });
  });
});
