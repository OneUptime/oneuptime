import crypto from "crypto";
import CloudStreamKeys from "../../../../Server/Utils/CloudConnection/CloudStreamKeys";
import {
  CLOUD_STREAM_KEY_SECRET_LENGTH,
  parseCloudStreamKey,
} from "../../../../Types/CloudConnection/CloudStream";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * A stream key is made once, shown once and kept as its SHA-256: a new key
 * every time, naming its connection, matched timing-safely, and nothing
 * that is not a key matches anything.
 */

const CONNECTION: ObjectID = new ObjectID(
  "6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f",
);

describe("making a stream key", () => {
  test("names the connection and carries 32 random bytes, and the hash is its SHA-256", () => {
    const made: { key: string; hash: string } =
      CloudStreamKeys.generate(CONNECTION);
    const parsed: { connectionId: string; secret: string } | null =
      parseCloudStreamKey(made.key);

    expect(parsed?.connectionId).toBe(CONNECTION.toString());
    expect(parsed?.secret).toHaveLength(CLOUD_STREAM_KEY_SECRET_LENGTH);
    expect(made.hash).toBe(
      crypto.createHash("sha256").update(made.key, "utf8").digest("hex"),
    );
    expect(made.hash).not.toContain(parsed!.secret);
  });

  test("is new each time", () => {
    const keys: Set<string> = new Set<string>();

    for (let index: number = 0; index < 50; index++) {
      keys.add(CloudStreamKeys.generate(CONNECTION).key);
    }

    expect(keys.size).toBe(50);
  });
});

describe("matching a key Firehose sent", () => {
  const made: { key: string; hash: string } =
    CloudStreamKeys.generate(CONNECTION);
  const other: { key: string; hash: string } =
    CloudStreamKeys.generate(CONNECTION);

  test("matches its own hash, among others", () => {
    expect(CloudStreamKeys.matchesAny(made.key, [made.hash])).toBe(true);
    expect(CloudStreamKeys.matchesAny(made.key, [other.hash, made.hash])).toBe(
      true,
    );
  });

  test("matches no other key's hash", () => {
    expect(CloudStreamKeys.matchesAny(made.key, [other.hash])).toBe(false);
    expect(CloudStreamKeys.matchesAny(made.key, [])).toBe(false);
  });

  test("is false, never a throw, for anything that is not a key or a hash", () => {
    for (const key of [undefined, null, "", 42, {}, made.key.toUpperCase()]) {
      expect(CloudStreamKeys.matchesAny(key, [made.hash])).toBe(false);
    }

    expect(
      CloudStreamKeys.matchesAny(made.key, [
        "",
        "not-hex",
        made.hash.slice(1),
        42 as unknown as string,
      ]),
    ).toBe(false);
  });

  test("a key with a space around it is not the key", () => {
    expect(CloudStreamKeys.matchesAny(` ${made.key}`, [made.hash])).toBe(false);
  });
});
