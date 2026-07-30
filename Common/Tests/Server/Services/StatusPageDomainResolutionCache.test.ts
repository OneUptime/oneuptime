/**
 * StatusPageService domain-to-id resolution cache tests.
 *
 * Every public status-page API call served on a custom domain (overview,
 * incidents, announcements, polling — several per page view) starts by
 * resolving Host header -> statusPageId, so resolveStatusPageIdOrNull now
 * consults a per-process 60s TTL cache before querying
 * StatusPageDomainService. The contract this pins is load-bearing in three
 * ways:
 * - only SUCCESSFUL resolutions are cached: a freshly verified domain works
 *   immediately, and attacker-controlled Host headers cannot fill the cache
 *   with negative entries
 * - the cache stores the id as a STRING and hands out a fresh ObjectID per
 *   hit, so a caller mutating the returned id cannot poison every subsequent
 *   request on that domain
 * - keys are exactly as case-sensitive as the underlying query, so the cache
 *   can never resolve a domain the database would not
 *
 * StatusPageDomainService.findOneBy is spied on, so no database is touched.
 */

import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  jest,
} from "@jest/globals";

const VALID_UUID: string = "550e8400-e29b-41d4-a716-446655440000";
const SECOND_UUID: string = "660e8400-e29b-41d4-a716-446655440111";
const DOMAIN: string = "status.company.com";
const OTHER_DOMAIN: string = "status.other.com";
const TTL_MS: number = 60 * 1000;

function statusPageDomainWith(statusPageId: ObjectID): StatusPageDomain {
  return {
    statusPageId: statusPageId,
  } as unknown as StatusPageDomain;
}

function spyOnDomainFindOneBy(): jest.SpyInstance {
  return jest.spyOn(
    StatusPageDomainService,
    "findOneBy",
  ) as unknown as jest.SpyInstance;
}

function queriedDomains(spy: jest.SpyInstance): Array<string> {
  return spy.mock.calls.map((call: Array<unknown>) => {
    const args: Record<string, any> = call[0] as Record<string, any>;
    return args["query"]["fullDomain"] as string;
  });
}

describe("StatusPageService domain resolution cache", () => {
  beforeEach(() => {
    /*
     * The cache lives on the singleton service, so entries written by one
     * test would leak into the next (and into other suites sharing this
     * module registry) without an explicit clear.
     */
    StatusPageService.clearStatusPageDomainToIdCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("caches a successful resolution: second call within TTL issues no query", async () => {
    const domainSpy: jest.SpyInstance =
      spyOnDomainFindOneBy().mockResolvedValue(
        statusPageDomainWith(new ObjectID(VALID_UUID)) as never,
      );

    const first: ObjectID | null =
      await StatusPageService.resolveStatusPageIdOrNull(DOMAIN);
    const second: ObjectID | null =
      await StatusPageService.resolveStatusPageIdOrNull(DOMAIN);

    expect(first?.toString()).toBe(VALID_UUID);
    expect(second?.toString()).toBe(VALID_UUID);
    expect(domainSpy).toHaveBeenCalledTimes(1);
  });

  test("does not cache a miss: two calls for an unknown domain issue two queries", async () => {
    const domainSpy: jest.SpyInstance =
      spyOnDomainFindOneBy().mockResolvedValue(null as never);

    await expect(
      StatusPageService.resolveStatusPageIdOrNull(DOMAIN),
    ).resolves.toBeNull();
    await expect(
      StatusPageService.resolveStatusPageIdOrNull(DOMAIN),
    ).resolves.toBeNull();

    expect(domainSpy).toHaveBeenCalledTimes(2);
  });

  test("expires after the 60s TTL and re-queries", async () => {
    const base: number = Date.now();
    let nowMs: number = base;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return nowMs;
    });

    const domainSpy: jest.SpyInstance =
      spyOnDomainFindOneBy().mockResolvedValue(
        statusPageDomainWith(new ObjectID(VALID_UUID)) as never,
      );

    await StatusPageService.resolveStatusPageIdOrNull(DOMAIN);
    expect(domainSpy).toHaveBeenCalledTimes(1);

    // Just inside the TTL: still served from cache.
    nowMs = base + TTL_MS - 1;
    const withinTtl: ObjectID | null =
      await StatusPageService.resolveStatusPageIdOrNull(DOMAIN);
    expect(withinTtl?.toString()).toBe(VALID_UUID);
    expect(domainSpy).toHaveBeenCalledTimes(1);

    // Past the TTL: the entry has expired and the domain is re-queried.
    nowMs = base + TTL_MS + 1;
    const afterTtl: ObjectID | null =
      await StatusPageService.resolveStatusPageIdOrNull(DOMAIN);
    expect(afterTtl?.toString()).toBe(VALID_UUID);
    expect(domainSpy).toHaveBeenCalledTimes(2);
  });

  test("keys are exactly as case-sensitive as the query: differently-cased domains each query", async () => {
    const domainSpy: jest.SpyInstance =
      spyOnDomainFindOneBy().mockResolvedValue(
        statusPageDomainWith(new ObjectID(VALID_UUID)) as never,
      );

    await StatusPageService.resolveStatusPageIdOrNull("status.example.com");
    await StatusPageService.resolveStatusPageIdOrNull("Status.Example.com");

    /*
     * If the cache normalized case it would resolve hostnames the underlying
     * (case-sensitive) query would not, so a cached hit for one casing must
     * not serve the other.
     */
    expect(domainSpy).toHaveBeenCalledTimes(2);
    expect(queriedDomains(domainSpy)).toEqual([
      "status.example.com",
      "Status.Example.com",
    ]);
  });

  test("clearStatusPageDomainToIdCache(domain) evicts only that domain", async () => {
    const domainSpy: jest.SpyInstance =
      spyOnDomainFindOneBy().mockImplementation(((
        options: Record<string, any>,
      ): Promise<StatusPageDomain> => {
        const fullDomain: string = options["query"]["fullDomain"] as string;
        return Promise.resolve(
          statusPageDomainWith(
            new ObjectID(fullDomain === DOMAIN ? VALID_UUID : SECOND_UUID),
          ),
        );
      }) as never);

    await StatusPageService.resolveStatusPageIdOrNull(DOMAIN);
    await StatusPageService.resolveStatusPageIdOrNull(OTHER_DOMAIN);
    expect(domainSpy).toHaveBeenCalledTimes(2);

    StatusPageService.clearStatusPageDomainToIdCache(DOMAIN);

    const reresolved: ObjectID | null =
      await StatusPageService.resolveStatusPageIdOrNull(DOMAIN);
    const stillCached: ObjectID | null =
      await StatusPageService.resolveStatusPageIdOrNull(OTHER_DOMAIN);

    expect(reresolved?.toString()).toBe(VALID_UUID);
    expect(stillCached?.toString()).toBe(SECOND_UUID);
    // Only the evicted domain re-queried; the other stayed cached.
    expect(domainSpy).toHaveBeenCalledTimes(3);
    expect(queriedDomains(domainSpy)).toEqual([DOMAIN, OTHER_DOMAIN, DOMAIN]);
  });

  test("clearStatusPageDomainToIdCache() with no argument clears everything", async () => {
    const domainSpy: jest.SpyInstance =
      spyOnDomainFindOneBy().mockResolvedValue(
        statusPageDomainWith(new ObjectID(VALID_UUID)) as never,
      );

    await StatusPageService.resolveStatusPageIdOrNull(DOMAIN);
    await StatusPageService.resolveStatusPageIdOrNull(OTHER_DOMAIN);
    expect(domainSpy).toHaveBeenCalledTimes(2);

    StatusPageService.clearStatusPageDomainToIdCache();

    await StatusPageService.resolveStatusPageIdOrNull(DOMAIN);
    await StatusPageService.resolveStatusPageIdOrNull(OTHER_DOMAIN);
    expect(domainSpy).toHaveBeenCalledTimes(4);
  });

  test("UUID input never touches the domain cache or the domain service", async () => {
    const domainSpy: jest.SpyInstance = spyOnDomainFindOneBy();

    const result: ObjectID | null =
      await StatusPageService.resolveStatusPageIdOrNull(VALID_UUID);

    expect(result?.toString()).toBe(VALID_UUID);
    expect(domainSpy).not.toHaveBeenCalled();
  });

  test("invalid dotless input returns null without querying", async () => {
    const domainSpy: jest.SpyInstance = spyOnDomainFindOneBy();

    await expect(
      StatusPageService.resolveStatusPageIdOrNull("localhost"),
    ).resolves.toBeNull();
    expect(domainSpy).not.toHaveBeenCalled();
  });

  test("cached hits return a fresh ObjectID each call, so mutation cannot poison the cache", async () => {
    spyOnDomainFindOneBy().mockResolvedValue(
      statusPageDomainWith(new ObjectID(VALID_UUID)) as never,
    );

    // First call fills the cache; the next two are served from it.
    await StatusPageService.resolveStatusPageIdOrNull(DOMAIN);
    const firstHit: ObjectID | null =
      await StatusPageService.resolveStatusPageIdOrNull(DOMAIN);
    const secondHit: ObjectID | null =
      await StatusPageService.resolveStatusPageIdOrNull(DOMAIN);

    expect(firstHit?.toString()).toBe(VALID_UUID);
    expect(secondHit?.toString()).toBe(VALID_UUID);
    expect(firstHit).not.toBe(secondHit);

    // Mutating a returned instance must not leak into later hits.
    firstHit!.id = "poisoned";
    const thirdHit: ObjectID | null =
      await StatusPageService.resolveStatusPageIdOrNull(DOMAIN);
    expect(thirdHit?.toString()).toBe(VALID_UUID);
  });
});
