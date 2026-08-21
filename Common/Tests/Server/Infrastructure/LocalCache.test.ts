import LocalCache from "../../../Server/Infrastructure/LocalCache";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

/*
 * LocalCache is a process-local, namespaced key/value store used for cheap
 * in-memory memoization (feature flags, small config lookups) where a
 * round-trip to Redis would be wasteful. It is a single shared static map,
 * so:
 *
 *   - the namespace has to actually isolate keys — two callers using the
 *     same key in different namespaces must not read each other's values;
 *   - `hasValue` is a Boolean() coercion, so a stored falsy value (0, "")
 *     reads as absent. That is a real edge every caller of getOrSet-style
 *     logic inherits, so it is pinned here rather than left implicit.
 *
 * Every test below uses a unique namespace so the shared map cannot leak
 * state between cases.
 */

describe("LocalCache string/number/JSON round-trips", () => {
  it("stores and returns a string", () => {
    LocalCache.setString("ns-str", "k", "hello");
    expect(LocalCache.getString("ns-str", "k")).toBe("hello");
  });

  it("stores and returns a number, including zero", () => {
    LocalCache.setNumber("ns-num", "k", 42);
    expect(LocalCache.getNumber("ns-num", "k")).toBe(42);

    LocalCache.setNumber("ns-num-zero", "k", 0);
    expect(LocalCache.getNumber("ns-num-zero", "k")).toBe(0);
  });

  it("stores and returns a JSON object", () => {
    const value: JSONObject = { a: 1, b: ["x", "y"] };
    LocalCache.setJSON("ns-json", "k", value);
    expect(LocalCache.getJSON("ns-json", "k")).toEqual(value);
  });

  it("overwrites an existing value on a repeated set", () => {
    LocalCache.setString("ns-overwrite", "k", "first");
    LocalCache.setString("ns-overwrite", "k", "second");
    expect(LocalCache.getString("ns-overwrite", "k")).toBe("second");
  });
});

describe("LocalCache namespacing", () => {
  it("isolates the same key across different namespaces", () => {
    LocalCache.setString("ns-a", "shared-key", "from-a");
    LocalCache.setString("ns-b", "shared-key", "from-b");

    expect(LocalCache.getString("ns-a", "shared-key")).toBe("from-a");
    expect(LocalCache.getString("ns-b", "shared-key")).toBe("from-b");
  });

  it("collides when namespace/key pairs concatenate to the same string", () => {
    /*
     * Known limitation, pinned deliberately: the map key is
     * `namespace + "." + key` with no escaping, so ("team", "member.count")
     * and ("team.member", "count") both resolve to "team.member.count" and
     * share one slot. Callers must not choose namespaces/keys whose dotted
     * concatenation can coincide. If this is ever hardened (e.g. an escaped
     * delimiter), this test is the tripwire that will flag the change.
     */
    LocalCache.setString("team", "member.count", "written-first");
    expect(LocalCache.getString("team.member", "count")).toBe("written-first");
  });
});

describe("LocalCache.hasValue", () => {
  it("is false for a key that was never set", () => {
    expect(LocalCache.hasValue("ns-missing", "nope")).toBe(false);
  });

  it("is true after a truthy value is set", () => {
    LocalCache.setString("ns-has", "k", "present");
    expect(LocalCache.hasValue("ns-has", "k")).toBe(true);
  });

  it("reads a stored falsy value as absent (Boolean coercion)", () => {
    // Documented edge: 0 and "" are stored but hasValue coerces to false.
    LocalCache.setNumber("ns-falsy", "zero", 0);
    LocalCache.setString("ns-falsy", "empty", "");
    expect(LocalCache.hasValue("ns-falsy", "zero")).toBe(false);
    expect(LocalCache.hasValue("ns-falsy", "empty")).toBe(false);
  });
});

describe("LocalCache.getOrSetString", () => {
  it("invokes the producer and caches its result when absent", async () => {
    let calls: number = 0;
    const produce: () => Promise<string> = async (): Promise<string> => {
      calls++;
      return "computed";
    };

    const first: string = await LocalCache.getOrSetString(
      "ns-getset",
      "k",
      produce,
    );
    expect(first).toBe("computed");
    expect(calls).toBe(1);
    // The value is now in the cache.
    expect(LocalCache.getString("ns-getset", "k")).toBe("computed");
  });

  it("does not invoke the producer again once a value is cached", async () => {
    let calls: number = 0;
    const produce: () => Promise<string> = async (): Promise<string> => {
      calls++;
      return `value-${calls}`;
    };

    const first: string = await LocalCache.getOrSetString(
      "ns-getset-2",
      "k",
      produce,
    );
    const second: string = await LocalCache.getOrSetString(
      "ns-getset-2",
      "k",
      produce,
    );

    expect(first).toBe("value-1");
    // Second call short-circuits on the cached value; producer not re-run.
    expect(second).toBe("value-1");
    expect(calls).toBe(1);
  });

  it("re-invokes the producer when the previously produced value was empty", async () => {
    /*
     * getOrSetString gates on getString() being falsy, so an empty-string
     * result is treated as "not cached" and the producer runs every time.
     * This mirrors the hasValue Boolean-coercion edge above.
     */
    let calls: number = 0;
    const produce: () => Promise<string> = async (): Promise<string> => {
      calls++;
      return "";
    };

    await LocalCache.getOrSetString("ns-getset-empty", "k", produce);
    await LocalCache.getOrSetString("ns-getset-empty", "k", produce);
    expect(calls).toBe(2);
  });
});
