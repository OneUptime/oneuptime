import { describe, expect, test } from "@jest/globals";
import DnsResolutionCache, {
  ResolveHostnameFunction,
} from "../../../../Server/Utils/Monitor/DnsResolutionCache";

/*
 * DnsResolutionCache correlates datagram source IPs (SNMP traps, syslog) to
 * NetworkDevices registered by DNS name. It must not hammer the resolver on
 * every datagram, so these tests pin the caching contract: positive results
 * are cached for the TTL, failures are negative-cached as an empty list,
 * the oldest entry is evicted at maxEntries, and hostnames are keyed
 * case-insensitively. The resolver and clock are injected so no real DNS
 * lookup or wall-clock wait is involved.
 */

const TTL_IN_MS: number = 1000;

interface TestHarness {
  cache: DnsResolutionCache;
  callCount: () => number;
  calledWith: () => Array<string>;
  advanceClock: (byMs: number) => void;
}

function makeHarness(options: {
  addressesByHostname?: Record<string, Array<string>>;
  rejectAll?: boolean;
  maxEntries?: number;
}): TestHarness {
  let nowInMs: number = 0;
  const calls: Array<string> = [];

  const resolver: ResolveHostnameFunction = (
    hostname: string,
  ): Promise<Array<string>> => {
    calls.push(hostname);

    if (options.rejectAll) {
      return Promise.reject(new Error(`ENOTFOUND ${hostname}`));
    }

    return Promise.resolve(
      options.addressesByHostname?.[hostname.toLowerCase()] || [],
    );
  };

  const cache: DnsResolutionCache = new DnsResolutionCache({
    ttlInMs: TTL_IN_MS,
    resolver: resolver,
    now: () => {
      return nowInMs;
    },
    ...(options.maxEntries !== undefined
      ? { maxEntries: options.maxEntries }
      : {}),
  });

  return {
    cache: cache,
    callCount: () => {
      return calls.length;
    },
    calledWith: () => {
      return calls;
    },
    advanceClock: (byMs: number) => {
      nowInMs += byMs;
    },
  };
}

describe("DnsResolutionCache", () => {
  test("caches a positive result within the TTL — resolver called once", async () => {
    const harness: TestHarness = makeHarness({
      addressesByHostname: { "router.example.com": ["10.0.0.1", "10.0.0.2"] },
    });

    const first: Array<string> =
      await harness.cache.resolve("router.example.com");
    expect(first).toEqual(["10.0.0.1", "10.0.0.2"]);
    expect(harness.callCount()).toBe(1);

    // Just inside the TTL — the cached addresses come back, no new lookup.
    harness.advanceClock(TTL_IN_MS - 1);

    const second: Array<string> =
      await harness.cache.resolve("router.example.com");
    expect(second).toEqual(["10.0.0.1", "10.0.0.2"]);
    expect(harness.callCount()).toBe(1);
  });

  test("re-resolves once the TTL has elapsed", async () => {
    const harness: TestHarness = makeHarness({
      addressesByHostname: { "router.example.com": ["10.0.0.1"] },
    });

    await harness.cache.resolve("router.example.com");
    expect(harness.callCount()).toBe(1);

    // expiresAt is exclusive: at exactly now + ttl the entry is stale.
    harness.advanceClock(TTL_IN_MS);

    const result: Array<string> =
      await harness.cache.resolve("router.example.com");
    expect(result).toEqual(["10.0.0.1"]);
    expect(harness.callCount()).toBe(2);
  });

  test("negative-caches a resolution failure as an empty list within the TTL", async () => {
    const harness: TestHarness = makeHarness({ rejectAll: true });

    const first: Array<string> = await harness.cache.resolve(
      "does-not-exist.example.com",
    );
    expect(first).toEqual([]);
    expect(harness.callCount()).toBe(1);

    harness.advanceClock(TTL_IN_MS - 1);

    // Failure is cached — the resolver is not retried on every datagram.
    const second: Array<string> = await harness.cache.resolve(
      "does-not-exist.example.com",
    );
    expect(second).toEqual([]);
    expect(harness.callCount()).toBe(1);
  });

  test("retries a negative-cached hostname after the TTL", async () => {
    const harness: TestHarness = makeHarness({ rejectAll: true });

    await harness.cache.resolve("does-not-exist.example.com");
    harness.advanceClock(TTL_IN_MS);
    await harness.cache.resolve("does-not-exist.example.com");

    expect(harness.callCount()).toBe(2);
  });

  test("evicts the oldest entry at maxEntries", async () => {
    const harness: TestHarness = makeHarness({
      addressesByHostname: {
        "a.example.com": ["10.0.0.1"],
        "b.example.com": ["10.0.0.2"],
        "c.example.com": ["10.0.0.3"],
      },
      maxEntries: 2,
    });

    await harness.cache.resolve("a.example.com");
    await harness.cache.resolve("b.example.com");

    // Third entry exceeds maxEntries — the oldest ("a") is evicted.
    await harness.cache.resolve("c.example.com");
    expect(harness.callCount()).toBe(3);

    // "b" and "c" are still cached...
    await harness.cache.resolve("b.example.com");
    await harness.cache.resolve("c.example.com");
    expect(harness.callCount()).toBe(3);

    // ...but "a" was evicted, so it hits the resolver again.
    await harness.cache.resolve("a.example.com");
    expect(harness.callCount()).toBe(4);
  });

  test("keys hostnames case-insensitively", async () => {
    const harness: TestHarness = makeHarness({
      addressesByHostname: { "router.example.com": ["10.0.0.1"] },
    });

    const first: Array<string> =
      await harness.cache.resolve("Router.Example.COM");
    const second: Array<string> =
      await harness.cache.resolve("router.example.com");

    expect(first).toEqual(["10.0.0.1"]);
    expect(second).toEqual(["10.0.0.1"]);
    expect(harness.callCount()).toBe(1);

    // The resolver sees the hostname as given, not the lowercased cache key.
    expect(harness.calledWith()).toEqual(["Router.Example.COM"]);
  });

  test("clear() empties the cache so the next resolve hits the resolver", async () => {
    const harness: TestHarness = makeHarness({
      addressesByHostname: { "router.example.com": ["10.0.0.1"] },
    });

    await harness.cache.resolve("router.example.com");
    harness.cache.clear();
    await harness.cache.resolve("router.example.com");

    expect(harness.callCount()).toBe(2);
  });
});
