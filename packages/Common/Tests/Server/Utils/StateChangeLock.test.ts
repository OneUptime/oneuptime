import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import logger, { LogAttributes } from "../../../Server/Utils/Logger";
import StateChangeLock from "../../../Server/Utils/StateChangeLock";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * StateChangeLock: the lock a state change holds on its event, taken in
 * onBeforeCreate and given back in onCreateSuccess or onCreateError, however
 * the change ends. The services' use of it is pinned in
 * CreateLockGivenBackGuard and StateTimelineLockAndFollowOn.
 */

const EVENT_ID: ObjectID = new ObjectID("6a000000-0000-4000-8000-000000000001");
const LOG: LogAttributes = { incidentId: EVENT_ID.toString() } as LogAttributes;

// A stand-in for a redis-semaphore mutex.
const MUTEX: SemaphoreMutex = { id: "held" } as unknown as SemaphoreMutex;

function changeCarrying(
  carryForward: unknown,
): OnCreate<IncidentStateTimeline> {
  return {
    createBy: { data: new IncidentStateTimeline(), props: { isRoot: true } },
    carryForward: carryForward,
  };
}

let lock: ReturnType<typeof getJestSpyOn>;
let release: ReturnType<typeof getJestSpyOn>;

beforeEach(() => {
  lock = getJestSpyOn(Semaphore, "lock").mockResolvedValue(MUTEX);
  release = getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StateChangeLock.take", () => {
  test("takes the event's lock in the timeline's namespace", async () => {
    await expect(
      StateChangeLock.take({
        namespace: "IncidentStateTimeline.create",
        eventId: EVENT_ID,
        logAttributes: LOG,
      }),
    ).resolves.toBe(MUTEX);

    expect(lock).toHaveBeenCalledWith({
      key: EVENT_ID.toString(),
      namespace: "IncidentStateTimeline.create",
    });
  });

  test("answers null when the lock cannot be had - Valkey down, or held for longer than a change waits - and logs why: the change goes ahead unlocked, as it always has", async () => {
    lock.mockRejectedValue(new Error("Acquire mutex timeout") as never);

    await expect(
      StateChangeLock.take({
        namespace: "IncidentStateTimeline.create",
        eventId: EVENT_ID,
        logAttributes: LOG,
      }),
    ).resolves.toBeNull();

    expect(logger.error).toHaveBeenCalled();
  });
});

describe("StateChangeLock.giveBack", () => {
  test("gives the lock back", async () => {
    await StateChangeLock.giveBack(MUTEX, LOG);

    expect(release).toHaveBeenCalledWith(MUTEX);
  });

  test("does nothing for a change that took none", async () => {
    await StateChangeLock.giveBack(null, LOG);
    await StateChangeLock.giveBack(undefined, LOG);

    expect(release).not.toHaveBeenCalled();
  });

  test("never throws: a release that fails neither hides the error a failed change unwinds nor fails a saved one", async () => {
    release.mockRejectedValue(new Error("Valkey went away") as never);

    await expect(StateChangeLock.giveBack(MUTEX, LOG)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("StateChangeLock.giveBackFor (onCreateError)", () => {
  test("gives back the lock the change carried forward from onBeforeCreate", async () => {
    await StateChangeLock.giveBackFor(
      changeCarrying({ mutex: MUTEX, publicNote: undefined }),
      LOG,
    );

    expect(release).toHaveBeenCalledWith(MUTEX);
  });

  test("gives it back once: a success hook that gave it back and then failed leaves onCreateError nothing to give back", async () => {
    const onCreate: OnCreate<IncidentStateTimeline> = changeCarrying({
      mutex: MUTEX,
    });

    // onCreateSuccess, before the note it posts after the save fails.
    await StateChangeLock.giveBackFor(onCreate, LOG);
    // onCreateError, handed the same create.
    await StateChangeLock.giveBackFor(onCreate, LOG);

    expect(release).toHaveBeenCalledTimes(1);
    expect(StateChangeLock.carriedForward(onCreate)).toBeNull();
  });

  test("gives back nothing for a change that failed before the hook ran, took no lock, or carries nothing", async () => {
    await StateChangeLock.giveBackFor(undefined, LOG);
    await StateChangeLock.giveBackFor(changeCarrying({ mutex: null }), LOG);
    await StateChangeLock.giveBackFor(changeCarrying([]), LOG);
    await StateChangeLock.giveBackFor(changeCarrying(undefined), LOG);

    expect(release).not.toHaveBeenCalled();
  });
});

describe("StateChangeLock.carriedForward", () => {
  test("reads the lock off a change's carryForward, and nothing off anything else", () => {
    expect(
      StateChangeLock.carriedForward(changeCarrying({ mutex: MUTEX })),
    ).toBe(MUTEX);
    expect(StateChangeLock.carriedForward(changeCarrying({}))).toBeNull();
    expect(StateChangeLock.carriedForward(changeCarrying("taken"))).toBeNull();
    expect(StateChangeLock.carriedForward(undefined)).toBeNull();
  });
});
