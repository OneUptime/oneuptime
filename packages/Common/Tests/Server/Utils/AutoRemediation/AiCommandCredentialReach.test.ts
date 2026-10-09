import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import AiCommandCredentialReach, {
  ABANDONED_WRITE_MARGIN_IN_MS,
  CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE,
  CredentialReachHold,
  LOCK_TIMEOUT_IN_MS,
  LOCK_WAIT_IN_MS,
  getLockTimeoutInMs,
} from "../../../../Server/Utils/AutoRemediation/AiCommandCredentialReach";
import { PostgresStatementTimeoutMs } from "../../../../Server/EnvironmentConfig";
import {
  COMMIT_STATEMENT,
  INSERT_STATEMENT,
  SELECT_STATEMENT,
  cancelledByDatabase,
  clientTimeout,
  connectionLost,
  databaseAnswer,
} from "../../TestingUtils/StatementFailures";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import logger from "../../../../Server/Utils/Logger";
import Runner from "../../../../Models/DatabaseModels/Runner";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import InMemoryLocks from "../../TestingUtils/InMemoryLocks";
import { getJestSpyOn } from "../../../Spy";

/*
 * THE LOCK EVERY WRITE THAT MAY PUT AN SSH CREDENTIAL WITHIN REACH OF
 * ONEUPTIME AI'S COMMANDS HOLDS (AiCommandCredentialReach).
 *
 *   - one lock per project, each project's once, in one order;
 *   - taken before the write's check reads, or the write is refused, to be
 *     saved again - a lock that cannot be had never lets a write through,
 *     and the locks taken already are given back;
 *   - never kept on a timer: it lasts LOCK_TIMEOUT_IN_MS from when it was
 *     taken or last kept, and is kept once more right before the write,
 *     which is refused when the lock is no longer the write's;
 *   - given back once the write is done or failed, never throwing.
 */

const PROJECT_A: ObjectID = new ObjectID(
  "c2000000-0000-4000-8000-00000000000a",
);
const PROJECT_B: ObjectID = new ObjectID(
  "c2000000-0000-4000-8000-00000000000b",
);
const NAMESPACE: string = "AiCommandCredentialReach";
const KEY_A: string = PROJECT_A.toString().toLowerCase();
const KEY_B: string = PROJECT_B.toString().toLowerCase();

describe("AiCommandCredentialReach", () => {
  let locks: InMemoryLocks;

  beforeEach(() => {
    locks = new InMemoryLocks();
    locks.install();
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the keys", () => {
    it("are each project's once, lower-cased, in one order", () => {
      expect(
        AiCommandCredentialReach.getLockKeys([
          PROJECT_B,
          PROJECT_A.toString().toUpperCase(),
          PROJECT_B.toString(),
          null,
          undefined,
          "",
        ]),
      ).toEqual([KEY_A, KEY_B]);
    });
  });

  describe("taking the locks", () => {
    it("takes one lock per project, in one order, under its own namespace", async () => {
      const hold: CredentialReachHold = await AiCommandCredentialReach.take([
        PROJECT_B,
        PROJECT_A,
        PROJECT_B,
      ]);

      expect(hold.locks).toHaveLength(2);
      expect(locks.eventsOf("lock")).toEqual([
        `lock:${NAMESPACE}/${KEY_A}`,
        `lock:${NAMESPACE}/${KEY_B}`,
      ]);
    });

    it("asks for a lock that lasts LOCK_TIMEOUT_IN_MS, is waited for LOCK_WAIT_IN_MS and is never kept on a timer", async () => {
      const lock: jest.SpyInstance = getJestSpyOn(Semaphore, "lock");

      await AiCommandCredentialReach.take([PROJECT_A]);

      expect(lock).toHaveBeenCalledWith(
        expect.objectContaining({
          key: KEY_A,
          namespace: NAMESPACE,
          lockTimeout: LOCK_TIMEOUT_IN_MS,
          acquireTimeout: LOCK_WAIT_IN_MS,
          refreshInterval: 0,
        }),
      );
    });

    it("refuses, to be saved again, when a lock is held by another write for longer than a write waits", async () => {
      locks.busy.add(KEY_A);

      await expect(AiCommandCredentialReach.take([PROJECT_A])).rejects.toThrow(
        CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE,
      );
    });

    it("refuses, to be saved again, when Valkey cannot be reached", async () => {
      locks.unreachable = true;

      await expect(AiCommandCredentialReach.take([PROJECT_A])).rejects.toThrow(
        BadDataException,
      );
    });

    it("gives back the locks it took when a later one cannot be had", async () => {
      locks.busy.add(KEY_B);

      await expect(
        AiCommandCredentialReach.take([PROJECT_A, PROJECT_B]),
      ).rejects.toThrow(CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE);

      expect(locks.isHeld(KEY_A, NAMESPACE)).toBe(false);
      expect(locks.eventsOf("release")).toEqual([
        `release:${NAMESPACE}/${KEY_A}`,
      ]);
    });

    it("refuses a write that names no project: there is nothing to check it under", async () => {
      await expect(
        AiCommandCredentialReach.take([undefined, null]),
      ).rejects.toThrow(BadDataException);

      expect(locks.eventsOf("lock")).toEqual([]);
    });

    it("makes a second write for the same project wait for the first to be given back", async () => {
      const first: CredentialReachHold = await AiCommandCredentialReach.take([
        PROJECT_A,
      ]);

      let secondHasIt: boolean = false;
      const second: Promise<CredentialReachHold> =
        AiCommandCredentialReach.take([PROJECT_A]).then(
          (hold: CredentialReachHold): CredentialReachHold => {
            secondHasIt = true;
            return hold;
          },
        );

      await Promise.resolve();
      expect(secondHasIt).toBe(false);
      expect(locks.waitingFor(KEY_A, NAMESPACE)).toBe(1);

      await AiCommandCredentialReach.giveBack(first);
      const hold: CredentialReachHold = await second;

      expect(secondHasIt).toBe(true);
      await AiCommandCredentialReach.giveBack(hold);
    });

    it("lets writes for different projects hold their locks at once", async () => {
      const a: CredentialReachHold = await AiCommandCredentialReach.take([
        PROJECT_A,
      ]);
      const b: CredentialReachHold = await AiCommandCredentialReach.take([
        PROJECT_B,
      ]);

      expect(locks.isHeld(KEY_A, NAMESPACE)).toBe(true);
      expect(locks.isHeld(KEY_B, NAMESPACE)).toBe(true);

      await AiCommandCredentialReach.giveBack(a);
      await AiCommandCredentialReach.giveBack(b);
    });
  });

  describe("keeping the locks right before the write", () => {
    it("keeps every lock the write holds", async () => {
      const hold: CredentialReachHold = await AiCommandCredentialReach.take([
        PROJECT_A,
        PROJECT_B,
      ]);

      await expect(
        AiCommandCredentialReach.keepForWrite(hold),
      ).resolves.toBeUndefined();

      expect(locks.eventsOf("keep")).toEqual([
        `keep:${NAMESPACE}/${KEY_A}`,
        `keep:${NAMESPACE}/${KEY_B}`,
      ]);
    });

    it("refuses the write when a lock is no longer its own", async () => {
      const hold: CredentialReachHold = await AiCommandCredentialReach.take([
        PROJECT_A,
        PROJECT_B,
      ]);

      locks.lose(KEY_B, NAMESPACE);

      await expect(AiCommandCredentialReach.keepForWrite(hold)).rejects.toThrow(
        CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE,
      );
    });

    it("refuses the write when Valkey cannot be reached to keep it", async () => {
      const hold: CredentialReachHold = await AiCommandCredentialReach.take([
        PROJECT_A,
      ]);

      locks.unreachable = true;

      await expect(AiCommandCredentialReach.keepForWrite(hold)).rejects.toThrow(
        CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE,
      );
    });

    it("has nothing to keep for a write that holds no lock", async () => {
      await expect(
        AiCommandCredentialReach.keepForWrite(null),
      ).resolves.toBeUndefined();
      await expect(
        AiCommandCredentialReach.keepForWrite(undefined),
      ).resolves.toBeUndefined();

      expect(locks.eventsOf("keep")).toEqual([]);
    });
  });

  describe("giving the locks back", () => {
    it("gives back every lock, once: a second give-back does nothing", async () => {
      const hold: CredentialReachHold = await AiCommandCredentialReach.take([
        PROJECT_A,
        PROJECT_B,
      ]);

      await AiCommandCredentialReach.giveBack(hold);
      await AiCommandCredentialReach.giveBack(hold);

      expect(locks.eventsOf("release")).toHaveLength(2);
      expect(hold.locks).toEqual([]);
      expect(locks.isHeld(KEY_A, NAMESPACE)).toBe(false);
      expect(locks.isHeld(KEY_B, NAMESPACE)).toBe(false);
    });

    it("never throws, so it neither hides the error a failed write unwinds nor fails a saved one", async () => {
      const hold: CredentialReachHold = await AiCommandCredentialReach.take([
        PROJECT_A,
      ]);

      getJestSpyOn(Semaphore, "release").mockRejectedValue(
        new Error("Valkey went away") as never,
      );

      await expect(
        AiCommandCredentialReach.giveBack(hold),
      ).resolves.toBeUndefined();
    });

    it("has nothing to give back for a write that holds none", async () => {
      await expect(
        AiCommandCredentialReach.giveBack(null),
      ).resolves.toBeUndefined();
      expect(locks.eventsOf("release")).toEqual([]);
    });
  });

  describe("carrying the hold between a write's hooks", () => {
    it("finds the hold a before hook carried forward, and nothing else", async () => {
      const hold: CredentialReachHold = { locks: [] };

      expect(
        AiCommandCredentialReach.carriedForward({ credentialReachHold: hold }),
      ).toBe(hold);
      expect(AiCommandCredentialReach.carriedForward(null)).toBeNull();
      expect(AiCommandCredentialReach.carriedForward([])).toBeNull();
      expect(AiCommandCredentialReach.carriedForward(undefined)).toBeNull();
      expect(AiCommandCredentialReach.carriedForward("hold")).toBeNull();
    });

    it("finds the hold of the update the permitted hook is handed", () => {
      const update: UpdateBy<Runner> = {
        query: {},
        data: {},
        props: {},
      } as unknown as UpdateBy<Runner>;
      const hold: CredentialReachHold = {
        locks: [] as Array<SemaphoreMutex>,
      };

      expect(AiCommandCredentialReach.heldFor(update)).toBeNull();

      AiCommandCredentialReach.holdFor(update, hold);

      expect(AiCommandCredentialReach.heldFor(update)).toBe(hold);
      // Another update, even one that looks the same, holds nothing.
      expect(
        AiCommandCredentialReach.heldFor({
          ...update,
        } as UpdateBy<Runner>),
      ).toBeNull();
    });
  });

  describe("how long a lock lasts", () => {
    it("is as long as the client waits for a statement, with time to spare, and a minute at the least", () => {
      expect(getLockTimeoutInMs(35_000)).toBe(60_000);
      expect(getLockTimeoutInMs(120_000)).toBe(145_000);
      expect(getLockTimeoutInMs(Number.NaN)).toBe(60_000);
      expect(LOCK_TIMEOUT_IN_MS).toBeGreaterThanOrEqual(60_000);
    });

    it("outlasts a statement the database may still be running, by its statement timeout and a margin", () => {
      // The defaults: a 30s statement timeout, a 35s client wait.
      expect(getLockTimeoutInMs(35_000, 30_000)).toBe(60_000);
      // A statement timeout longer than the client waits.
      expect(getLockTimeoutInMs(35_000, 120_000)).toBe(
        120_000 + ABANDONED_WRITE_MARGIN_IN_MS,
      );
      // One that is not set bounds nothing, and adds nothing.
      expect(getLockTimeoutInMs(35_000, 0)).toBe(60_000);
      expect(getLockTimeoutInMs(35_000, Number.NaN)).toBe(60_000);

      expect(LOCK_TIMEOUT_IN_MS).toBeGreaterThanOrEqual(
        PostgresStatementTimeoutMs + ABANDONED_WRITE_MARGIN_IN_MS,
      );
    });

    it("waits for another write for less than a lock lasts", () => {
      expect(LOCK_WAIT_IN_MS).toBeLessThan(LOCK_TIMEOUT_IN_MS);
    });
  });

  describe("giving the locks back once the write failed", () => {
    it.each([
      ["the client stopped waiting for the UPDATE", clientTimeout()],
      ["the connection ended while the UPDATE ran", connectionLost()],
    ])(
      "leaves them to run out when %s: the write may still land",
      async (_label: string, error: Error) => {
        const hold: CredentialReachHold = await AiCommandCredentialReach.take([
          PROJECT_A,
        ]);

        await AiCommandCredentialReach.giveBackAfterFailedWrite(hold, error);

        expect(locks.isHeld(KEY_A, NAMESPACE)).toBe(true);
        expect(locks.eventsOf("release")).toEqual([]);

        // No longer the write's to give back: a give-back later does nothing.
        expect(hold.locks).toEqual([]);
        await AiCommandCredentialReach.giveBack(hold);
        expect(locks.isHeld(KEY_A, NAMESPACE)).toBe(true);
      },
    );

    it.each([
      [
        "the database answered the UPDATE",
        databaseAnswer({ code: "23505", message: "duplicate key value" }),
      ],
      ["the database cancelled the UPDATE itself", cancelledByDatabase()],
      ["only a read went unanswered", clientTimeout(SELECT_STATEMENT)],
      ["the write failed before a statement was sent", new Error("No pool")],
    ])(
      "gives them back at once when %s",
      async (_label: string, error: Error) => {
        const hold: CredentialReachHold = await AiCommandCredentialReach.take([
          PROJECT_A,
        ]);

        await AiCommandCredentialReach.giveBackAfterFailedWrite(hold, error);

        expect(locks.isHeld(KEY_A, NAMESPACE)).toBe(false);
      },
    );

    it("for a create, written in a transaction of its own, keeps them only while its COMMIT may land", async () => {
      const insert: CredentialReachHold = await AiCommandCredentialReach.take([
        PROJECT_A,
      ]);
      await AiCommandCredentialReach.giveBackAfterFailedCreate(
        clientTimeout(INSERT_STATEMENT),
        {
          createBy: {} as never,
          carryForward: { credentialReachHold: insert },
        },
      );
      expect(locks.isHeld(KEY_A, NAMESPACE)).toBe(false);

      const commit: CredentialReachHold = await AiCommandCredentialReach.take([
        PROJECT_A,
      ]);
      await AiCommandCredentialReach.giveBackAfterFailedCreate(
        clientTimeout(COMMIT_STATEMENT),
        {
          createBy: {} as never,
          carryForward: { credentialReachHold: commit },
        },
      );
      expect(locks.isHeld(KEY_A, NAMESPACE)).toBe(true);
    });

    it("has nothing to give back for a write that holds none", async () => {
      await expect(
        AiCommandCredentialReach.giveBackAfterFailedWrite(
          null,
          clientTimeout(),
        ),
      ).resolves.toBeUndefined();
      expect(locks.eventsOf("release")).toEqual([]);
    });
  });

  describe("an update's hold, wherever its hook finds it", () => {
    it("is the one it carried forward, or else the one remembered for its update", async () => {
      const update: UpdateBy<Runner> = {
        query: {},
        data: {},
        props: {},
      } as unknown as UpdateBy<Runner>;

      const remembered: CredentialReachHold =
        await AiCommandCredentialReach.take([PROJECT_A]);
      AiCommandCredentialReach.holdFor(update, remembered);

      // Handed only the update: the one remembered for it.
      expect(
        AiCommandCredentialReach.holdOfUpdate({
          updateBy: update,
          carryForward: null,
        }),
      ).toBe(remembered);

      // Handed what its before hook carried forward too: that.
      expect(
        AiCommandCredentialReach.holdOfUpdate({
          updateBy: update,
          carryForward: AiCommandCredentialReach.carryForwardOf(remembered),
        }),
      ).toBe(remembered);

      expect(AiCommandCredentialReach.holdOfUpdate(undefined)).toBeNull();

      // Given back through either, once.
      await AiCommandCredentialReach.giveBackAfterUpdate({
        updateBy: update,
        carryForward: null,
      });
      await AiCommandCredentialReach.giveBackAfterUpdate({
        updateBy: update,
        carryForward: AiCommandCredentialReach.carryForwardOf(remembered),
      });

      expect(locks.eventsOf("release")).toHaveLength(1);
      expect(locks.isHeld(KEY_A, NAMESPACE)).toBe(false);
    });

    it("is kept right before the update's write", async () => {
      const update: UpdateBy<Runner> = {
        query: {},
        data: {},
        props: {},
      } as unknown as UpdateBy<Runner>;

      AiCommandCredentialReach.holdFor(
        update,
        await AiCommandCredentialReach.take([PROJECT_A]),
      );

      await AiCommandCredentialReach.keepForUpdate(update);

      expect(locks.eventsOf("keep")).toEqual([`keep:${NAMESPACE}/${KEY_A}`]);
    });
  });
});
