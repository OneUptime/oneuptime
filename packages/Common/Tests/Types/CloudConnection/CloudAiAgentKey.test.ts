import {
  CLOUD_AI_AGENT_INGESTION_KEY_REFUSED_MESSAGE,
  CLOUD_AI_AGENT_KEY_MAX_LENGTH,
  CLOUD_AI_AGENT_KEY_PREFIX,
  CLOUD_AI_AGENT_KEY_REFUSED_MESSAGE,
  CLOUD_AI_AGENT_KEY_SECRET_LENGTH,
  CLOUD_AI_AGENT_MAX_PENDING_KEYS,
  CLOUD_AI_AGENT_PENDING_KEY_LIFETIME_MS,
  CloudAiAgentKeyRecord,
  CloudAiAgentKeys,
  addCloudAiAgentKey,
  buildCloudAiAgentKey,
  getLiveCloudAiAgentKeyHashes,
  isCloudAiAgentKey,
  isOwnCloudAiAgentKeyRequired,
  isPendingCloudAiAgentKeyUsable,
  parseCloudAiAgentKey,
  readCloudAiAgentKeys,
  revokeCloudAiAgentKeys,
  useCloudAiAgentKey,
} from "../../../Types/CloudConnection/CloudAiAgentKey";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * The key a Cloud AI agent connects with, and the keys an account keeps:
 * the key names its one account and holds nothing a shell or a template
 * reads; an account keeps only hashes, its agent's key and the ones made
 * for a setup command that has not connected yet, each of those working a
 * day at most; the first connection with a pending key makes it the
 * agent's key and stops the one it replaces, and from then on the project's
 * ingestion key no longer connects the account's agent; Reset agent revokes
 * every key and keeps that rule. What is stored is read back as it is, or
 * fails closed.
 */

const ACCOUNT: string = "33333333-3333-4333-8333-333333333333";
const OTHER_ACCOUNT: string = "44444444-4444-4444-8444-444444444444";
const SECRET: string = "0123456789abcdef".repeat(4);
const NOW: Date = new Date("2026-11-06T12:00:00.000Z");

function hours(count: number): number {
  return count * 60 * 60 * 1000;
}

function record(
  hash: string,
  madeAt: Date,
  extra: Partial<CloudAiAgentKeyRecord> = {},
): CloudAiAgentKeyRecord {
  return { hash: hash.repeat(64).slice(0, 64), madeAt: madeAt.toISOString(), ...extra };
}

describe("a key", () => {
  test("names its account and holds 64 hex digits: letters, digits and _ alone", () => {
    const key: string = buildCloudAiAgentKey({
      cloudAccountId: ACCOUNT,
      secret: SECRET,
    });

    expect(CLOUD_AI_AGENT_KEY_PREFIX).toBe("ouca");
    expect(CLOUD_AI_AGENT_KEY_SECRET_LENGTH).toBe(64);
    expect(key).toBe(`ouca_${ACCOUNT}_${SECRET}`);
    expect(key.length).toBe(106);
    expect(key.length).toBeLessThanOrEqual(CLOUD_AI_AGENT_KEY_MAX_LENGTH);
    expect(parseCloudAiAgentKey(key)).toEqual({
      cloudAccountId: ACCOUNT,
      secret: SECRET,
    });
    expect(isCloudAiAgentKey(key)).toBe(true);

    for (const character of key) {
      expect(
        (character >= "a" && character <= "z") ||
          (character >= "0" && character <= "9") ||
          character === "_" ||
          character === "-",
      ).toBe(true);
    }
  });

  test("is written lowercase whatever case its parts came in, and read back from that", () => {
    const key: string = buildCloudAiAgentKey({
      cloudAccountId: ACCOUNT.toUpperCase(),
      secret: SECRET.toUpperCase(),
    });

    expect(key).toBe(`ouca_${ACCOUNT}_${SECRET}`);
    expect(parseCloudAiAgentKey(` ${key}\n`)).toEqual({
      cloudAccountId: ACCOUNT,
      secret: SECRET,
    });
  });

  test.each([
    ["nothing", undefined],
    ["a number", 42],
    ["an empty string", ""],
    ["a telemetry ingestion key", "0b5f2c1e-1111-4111-8111-222233334444"],
    ["a stream key", `oucs_${ACCOUNT}_${SECRET}`],
    ["another prefix", `OUCA_${ACCOUNT}_${SECRET}`],
    ["an id that is not one", `ouca_account-1_${SECRET}`],
    [
      "an id in capitals",
      "ouca_ABCDEF12-3333-4333-8333-333333333333_" + SECRET,
    ],
    ["a short secret", `ouca_${ACCOUNT}_${SECRET.slice(1)}`],
    ["a long secret", `ouca_${ACCOUNT}_${SECRET}0`],
    ["a secret in capitals", `ouca_${ACCOUNT}_${SECRET.toUpperCase()}`],
    ["a secret that is not hex", `ouca_${ACCOUNT}_${"g".repeat(64)}`],
    ["one part too many", `ouca_${ACCOUNT}_${SECRET}_x`],
    ["one part too few", `ouca_${ACCOUNT}`],
    ["a space inside", `ouca_${ACCOUNT}_${SECRET.slice(0, 32)} ${SECRET.slice(33)}`],
  ])("%s is no key", (_what: string, value: unknown) => {
    expect(parseCloudAiAgentKey(value)).toBeNull();
    expect(isCloudAiAgentKey(value)).toBe(false);
  });

  test("reads nothing past its longest length, in time that does not grow with what it is given", () => {
    const long: string = `ouca_${ACCOUNT}_${SECRET}`.padEnd(400_000, "a");
    const separators: string = "_".repeat(400_000);
    const timed: FastestRun<Array<unknown>> = fastestRun({
      run: (): Array<unknown> => {
        return [parseCloudAiAgentKey(long), parseCloudAiAgentKey(separators)];
      },
      limitInMs: 2000,
    });

    expect(timed.result).toEqual([null, null]);
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("what an account keeps", () => {
  test("nothing at all: an agent set up before keys of their own, which the ingestion key still connects", () => {
    expect(readCloudAiAgentKeys(null)).toBeNull();
    expect(readCloudAiAgentKeys(undefined)).toBeNull();
    expect(isOwnCloudAiAgentKeyRequired(null)).toBe(false);
    expect(getLiveCloudAiAgentKeyHashes({ keys: null, now: NOW })).toEqual([]);
  });

  test("is read back as it was written", () => {
    const keys: CloudAiAgentKeys = {
      current: record("a", new Date(NOW.getTime() - hours(48)), {
        madeByUserId: "55555555-5555-4555-8555-555555555555",
        firstUsedAt: new Date(NOW.getTime() - hours(47)).toISOString(),
      }),
      pending: [record("b", new Date(NOW.getTime() - hours(1)))],
      isOwnKeyRequired: true,
    };

    expect(readCloudAiAgentKeys(JSON.parse(JSON.stringify(keys)))).toEqual(
      keys,
    );
  });

  test("what is not of its shape matches nothing, and keeps the ingestion key out", () => {
    for (const stored of ["keys", 7, true, ["a"]]) {
      const keys: CloudAiAgentKeys | null = readCloudAiAgentKeys(stored);

      expect(keys).toEqual({
        current: null,
        pending: [],
        isOwnKeyRequired: true,
      });
      expect(isOwnCloudAiAgentKeyRequired(keys)).toBe(true);
      expect(getLiveCloudAiAgentKeyHashes({ keys, now: NOW })).toEqual([]);
    }

    // An object that does not say the ingestion key may still connect: it may not.
    expect(readCloudAiAgentKeys({})?.isOwnKeyRequired).toBe(true);
    expect(readCloudAiAgentKeys({ isOwnKeyRequired: "no" })?.isOwnKeyRequired).toBe(
      true,
    );
  });

  test("a record that is not a key's hash and a time is left out, never half trusted", () => {
    const keys: CloudAiAgentKeys | null = readCloudAiAgentKeys({
      current: { hash: "A".repeat(64), madeAt: NOW.toISOString() },
      pending: [
        { hash: "b".repeat(63), madeAt: NOW.toISOString() },
        { hash: "c".repeat(64), madeAt: "yesterday" },
        { hash: "d".repeat(64) },
        "e",
        { hash: "f".repeat(64), madeAt: NOW.toISOString(), madeByUserId: "me" },
      ],
      isOwnKeyRequired: false,
    });

    expect(keys?.current).toBeNull();
    // The one sound record stays, without the id that is not one.
    expect(keys?.pending).toEqual([
      { hash: "f".repeat(64), madeAt: NOW.toISOString() },
    ]);
    expect(keys?.isOwnKeyRequired).toBe(false);
  });

  test("keeps at most the newest pending keys, however many were written", () => {
    const pending: Array<CloudAiAgentKeyRecord> = Array.from(
      { length: 12 },
      (_: unknown, index: number): CloudAiAgentKeyRecord => {
        return record(String(index % 10), NOW);
      },
    );

    expect(
      readCloudAiAgentKeys({ current: null, pending, isOwnKeyRequired: false })
        ?.pending,
    ).toHaveLength(CLOUD_AI_AGENT_MAX_PENDING_KEYS);
    expect(CLOUD_AI_AGENT_MAX_PENDING_KEYS).toBe(5);
  });

  test("a key that connected, or a revocation, requires the account's own key whatever the flag says", () => {
    expect(
      readCloudAiAgentKeys({
        current: record("a", NOW),
        pending: [],
        isOwnKeyRequired: false,
      })?.isOwnKeyRequired,
    ).toBe(true);
    expect(
      readCloudAiAgentKeys({
        current: null,
        pending: [],
        isOwnKeyRequired: false,
        revokedAt: NOW.toISOString(),
      })?.isOwnKeyRequired,
    ).toBe(true);
  });
});

describe("a pending key works for a day", () => {
  const made: CloudAiAgentKeyRecord = record("a", NOW);

  test("from when it was made", () => {
    expect(CLOUD_AI_AGENT_PENDING_KEY_LIFETIME_MS).toBe(hours(24));
    expect(isPendingCloudAiAgentKeyUsable({ record: made, now: NOW })).toBe(
      true,
    );
    expect(
      isPendingCloudAiAgentKeyUsable({
        record: made,
        now: new Date(NOW.getTime() + hours(24) - 1),
      }),
    ).toBe(true);
    expect(
      isPendingCloudAiAgentKeyUsable({
        record: made,
        now: new Date(NOW.getTime() + hours(24)),
      }),
    ).toBe(false);
  });

  test("another server's clock a minute ahead is no reason to refuse it; a key from the future is", () => {
    expect(
      isPendingCloudAiAgentKeyUsable({
        record: made,
        now: new Date(NOW.getTime() - 30 * 1000),
      }),
    ).toBe(true);
    expect(
      isPendingCloudAiAgentKeyUsable({
        record: made,
        now: new Date(NOW.getTime() - hours(1)),
      }),
    ).toBe(false);
  });

  test("the hashes a presented key may match: the agent's key always, the pending ones while they work", () => {
    const keys: CloudAiAgentKeys = {
      current: record("a", new Date(NOW.getTime() - hours(100))),
      pending: [
        record("b", new Date(NOW.getTime() - hours(1))),
        record("c", new Date(NOW.getTime() - hours(30))),
      ],
      isOwnKeyRequired: true,
    };

    expect(getLiveCloudAiAgentKeyHashes({ keys, now: NOW })).toEqual([
      { hash: "a".repeat(64), match: "current" },
      { hash: "b".repeat(64), match: "pending" },
    ]);
  });
});

describe("making, using and revoking keys", () => {
  test("a new key goes first among the pending ones; the agent's own key is untouched", () => {
    const current: CloudAiAgentKeyRecord = record(
      "a",
      new Date(NOW.getTime() - hours(100)),
    );
    const next: CloudAiAgentKeys = addCloudAiAgentKey({
      keys: {
        current,
        pending: [record("b", new Date(NOW.getTime() - hours(2)))],
        isOwnKeyRequired: true,
      },
      record: record("c", NOW),
      now: NOW,
    });

    expect(next.current).toEqual(current);
    expect(
      next.pending.map((key: CloudAiAgentKeyRecord): string => {
        return key.hash[0]!;
      }),
    ).toEqual(["c", "b"]);
    expect(next.isOwnKeyRequired).toBe(true);
  });

  test("an account's first key: pending, and the ingestion key still connects its agent until one connects", () => {
    const next: CloudAiAgentKeys = addCloudAiAgentKey({
      keys: null,
      record: record("c", NOW),
      now: NOW,
    });

    expect(next).toEqual({
      current: null,
      pending: [record("c", NOW)],
      isOwnKeyRequired: false,
    });
    expect(isOwnCloudAiAgentKeyRequired(next)).toBe(false);
  });

  test("pending keys that no longer work go, and at most five stay", () => {
    let keys: CloudAiAgentKeys | null = {
      current: null,
      pending: [record("z", new Date(NOW.getTime() - hours(25)))],
      isOwnKeyRequired: false,
    };

    for (const hash of ["a", "b", "c", "d", "e", "f"]) {
      keys = addCloudAiAgentKey({ keys, record: record(hash, NOW), now: NOW });
    }

    expect(
      keys.pending.map((key: CloudAiAgentKeyRecord): string => {
        return key.hash[0]!;
      }),
    ).toEqual(["f", "e", "d", "c", "b"]);
  });

  test("the first connection with a pending key makes it the agent's key, and the key it replaces stops working", () => {
    const keys: CloudAiAgentKeys = {
      current: record("a", new Date(NOW.getTime() - hours(100))),
      pending: [
        record("b", new Date(NOW.getTime() - hours(2)), {
          madeByUserId: "55555555-5555-4555-8555-555555555555",
        }),
        record("c", new Date(NOW.getTime() - hours(1))),
      ],
      isOwnKeyRequired: true,
    };
    const used: CloudAiAgentKeys | null = useCloudAiAgentKey({
      keys,
      hash: "b".repeat(64),
      now: NOW,
    });

    expect(used?.current).toEqual({
      ...record("b", new Date(NOW.getTime() - hours(2)), {
        madeByUserId: "55555555-5555-4555-8555-555555555555",
      }),
      firstUsedAt: NOW.toISOString(),
    });
    // Another admin's command may be on its way: their key keeps working.
    expect(used?.pending).toEqual([
      record("c", new Date(NOW.getTime() - hours(1))),
    ]);
    expect(
      getLiveCloudAiAgentKeyHashes({ keys: used, now: NOW }).map(
        (entry: { hash: string }): string => {
          return entry.hash[0]!;
        },
      ),
    ).toEqual(["b", "c"]);
  });

  test("from the first connection with a key of its own, the ingestion key no longer connects the account's agent", () => {
    const used: CloudAiAgentKeys | null = useCloudAiAgentKey({
      keys: addCloudAiAgentKey({
        keys: null,
        record: record("b", NOW),
        now: NOW,
      }),
      hash: "b".repeat(64),
      now: NOW,
    });

    expect(isOwnCloudAiAgentKeyRequired(used)).toBe(true);
  });

  test("a key that is not pending, or no longer works, is no key to use", () => {
    const keys: CloudAiAgentKeys = {
      current: record("a", NOW),
      pending: [record("b", new Date(NOW.getTime() - hours(25)))],
      isOwnKeyRequired: true,
    };

    expect(useCloudAiAgentKey({ keys, hash: "b".repeat(64), now: NOW })).toBeNull();
    expect(useCloudAiAgentKey({ keys, hash: "z".repeat(64), now: NOW })).toBeNull();
    // The agent's own key is no pending key: using it changes nothing.
    expect(useCloudAiAgentKey({ keys, hash: "a".repeat(64), now: NOW })).toBeNull();
    expect(useCloudAiAgentKey({ keys: null, hash: "a".repeat(64), now: NOW })).toBeNull();
  });

  test("Reset agent revokes every key and keeps the ingestion key out", () => {
    const revoked: CloudAiAgentKeys = revokeCloudAiAgentKeys({ now: NOW });

    expect(revoked).toEqual({
      current: null,
      pending: [],
      isOwnKeyRequired: true,
      revokedAt: NOW.toISOString(),
    });
    expect(getLiveCloudAiAgentKeyHashes({ keys: revoked, now: NOW })).toEqual(
      [],
    );
    expect(isOwnCloudAiAgentKeyRequired(revoked)).toBe(true);

    // A new key connects it again, and the revocation is behind it.
    const used: CloudAiAgentKeys | null = useCloudAiAgentKey({
      keys: addCloudAiAgentKey({
        keys: revoked,
        record: record("n", NOW),
        now: NOW,
      }),
      hash: "n".repeat(64),
      now: NOW,
    });

    expect(used?.current?.hash).toBe("n".repeat(64));
    expect(used?.revokedAt).toBeUndefined();
    expect(used?.isOwnKeyRequired).toBe(true);
  });
});

describe("what a refused agent is told", () => {
  test("a key that no longer connects it: the ways out, and never the key", () => {
    expect(CLOUD_AI_AGENT_KEY_REFUSED_MESSAGE).toBe(
      "This Cloud AI agent key is not the cloud account's: it was replaced by a newer one, revoked by Reset agent, never connected within a day of being made, or its account was removed. Run the agent's setup command again: Change on the account's AI agent page in OneUptime shows it.",
    );
  });

  test("the project's ingestion key, for an account whose agent has its own", () => {
    expect(CLOUD_AI_AGENT_INGESTION_KEY_REFUSED_MESSAGE).toBe(
      "This cloud account's Cloud AI agent connects with a key of its own, so the project's telemetry ingestion key no longer connects it. Run the agent's setup command again: Change on the account's AI agent page in OneUptime shows it, with its key.",
    );
  });

  test("neither names a key, a hash or anything a key could be told from", () => {
    for (const message of [
      CLOUD_AI_AGENT_KEY_REFUSED_MESSAGE,
      CLOUD_AI_AGENT_INGESTION_KEY_REFUSED_MESSAGE,
    ]) {
      expect(message).not.toContain(CLOUD_AI_AGENT_KEY_PREFIX);
      expect(message).not.toContain(OTHER_ACCOUNT);
      expect(message).not.toContain("hash");
    }
  });
});
