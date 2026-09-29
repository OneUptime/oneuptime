import RumApplicationService from "../../../Server/Services/RumApplicationService";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/*
 * The session replay ingest health markers
 * (markSessionReplayChunkReceived / markSessionReplayBudgetExceeded) carry
 * MUST-level invariants their call sites cannot pin, because the chunk
 * route's tests mock the whole service:
 *
 *  1. The write goes through updateColumnsByIdWithoutHooks. Both columns
 *     start with "sessionReplay", which onUpdateSuccess treats as a POLICY
 *     edit — a refactor to the normal update pipeline would clear the gate
 *     cache and write kill keys on every accepted chunk, a self-inflicted
 *     cache stampede on the hottest browser endpoint we have.
 *  2. skipUpdateDateColumn is set: configEpoch is derived from updatedAt,
 *     so refreshing it would broadcast "configuration changed" to every
 *     live recorder once a throttle window.
 *  3. The GlobalCache throttle turns 20k chunks/min into at most one
 *     Postgres write per application per window — and fails OPEN, because
 *     a stale health column is worse than an occasional extra UPDATE.
 *  4. A failed write is swallowed after a warn: bookkeeping must never
 *     fail an ingest request.
 */

const APPLICATION_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

describe("RumApplicationService session replay health markers", () => {
  let updateSpy: jest.SpyInstance;
  let cacheGetSpy: jest.SpyInstance;
  let cacheSetSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.restoreAllMocks();

    updateSpy = getJestSpyOn(
      RumApplicationService,
      "updateColumnsByIdWithoutHooks",
    ).mockResolvedValue(undefined);

    cacheGetSpy = getJestSpyOn(GlobalCache, "getString").mockResolvedValue(
      null,
    );
    cacheSetSpy = getJestSpyOn(GlobalCache, "setString").mockResolvedValue(
      undefined,
    );
  });

  it("writes the last-chunk column through the hook-free path, without touching updatedAt", async () => {
    await RumApplicationService.markSessionReplayChunkReceived(APPLICATION_ID);

    expect(updateSpy).toHaveBeenCalledTimes(1);

    const call: {
      id: ObjectID;
      data: Record<string, unknown>;
      skipUpdateDateColumn?: boolean;
    } = updateSpy.mock.calls[0]![0] as never;

    expect(call.id.toString()).toBe(APPLICATION_ID.toString());
    expect(Object.keys(call.data)).toEqual([
      "sessionReplayLastChunkReceivedAt",
    ]);
    expect(call.data["sessionReplayLastChunkReceivedAt"]).toBeInstanceOf(Date);
    expect(call.skipUpdateDateColumn).toBe(true);
  });

  it("writes the budget-exceeded column the same way", async () => {
    await RumApplicationService.markSessionReplayBudgetExceeded(APPLICATION_ID);

    const call: {
      data: Record<string, unknown>;
      skipUpdateDateColumn?: boolean;
    } = updateSpy.mock.calls[0]![0] as never;

    expect(Object.keys(call.data)).toEqual(["sessionReplayBudgetExceededAt"]);
    expect(call.skipUpdateDateColumn).toBe(true);
  });

  it("skips the write entirely inside the throttle window", async () => {
    cacheGetSpy.mockResolvedValue("1");

    await RumApplicationService.markSessionReplayChunkReceived(APPLICATION_ID);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(cacheSetSpy).not.toHaveBeenCalled();
  });

  it("fails OPEN when the throttle cache is unavailable", async () => {
    cacheGetSpy.mockRejectedValue(new Error("redis down"));
    cacheSetSpy.mockRejectedValue(new Error("redis down"));

    await RumApplicationService.markSessionReplayChunkReceived(APPLICATION_ID);

    /*
     * A cache error must never skip the DB write — the same stance
     * updateLastSeen takes. Otherwise a Redis outage silently freezes the
     * health column while chunks are still flowing.
     */
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it("swallows a failed write instead of throwing into the ingest path", async () => {
    updateSpy.mockRejectedValue(new Error("postgres down"));

    await expect(
      RumApplicationService.markSessionReplayChunkReceived(APPLICATION_ID),
    ).resolves.toBeUndefined();
  });
});
