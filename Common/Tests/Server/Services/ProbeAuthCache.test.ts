import ProbeService from "../../../Server/Services/ProbeService";
import Probe from "../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ProbeService.getProbeIdByKey backs the probe-auth middleware, which guards
 * every probe ingest route. /probe/response/ingest does no other Postgres work
 * (it enqueues to Redis), so this lookup was the only synchronous Postgres
 * coupling on the highest-volume endpoint in the product.
 *
 * Caching a credential check is only safe if revocation actually invalidates,
 * so the invalidation hooks are the point of these tests, not the hit rate.
 * _findBy passes withDeleted: false, meaning a soft-deleted probe stops
 * authenticating immediately — a cache without onBeforeDelete would keep
 * honouring it for the remaining TTL.
 */

type FindOneByMock = () => Promise<Probe | null>;

type ProbeServiceInternals = {
  onBeforeDelete: (deleteBy: unknown) => Promise<unknown>;
  onBeforeUpdate: (updateBy: unknown) => Promise<unknown>;
};

function mockProbeLookup(result: Probe | null): FindOneByMock {
  const findOneBy: FindOneByMock = jest.fn(async (): Promise<Probe | null> => {
    return result;
  });

  jest.spyOn(ProbeService, "findOneBy").mockImplementation(findOneBy as never);

  return findOneBy;
}

function buildProbe(id: ObjectID): Probe {
  const probe: Probe = new Probe();
  probe.id = id;
  return probe;
}

describe("ProbeService.getProbeIdByKey", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("resolves a valid pair and serves the repeat from cache", async () => {
    const probeId: ObjectID = ObjectID.generate();
    const findOneBy: FindOneByMock = mockProbeLookup(buildProbe(probeId));

    const first: ObjectID | null = await ProbeService.getProbeIdByKey(
      probeId,
      "the-key",
    );
    const second: ObjectID | null = await ProbeService.getProbeIdByKey(
      probeId,
      "the-key",
    );

    expect(first?.toString()).toBe(probeId.toString());
    expect(second?.toString()).toBe(probeId.toString());
    expect(findOneBy).toHaveBeenCalledTimes(1);
  });

  test("returns null for a bad key and caches the miss", async () => {
    const probeId: ObjectID = ObjectID.generate();
    const findOneBy: FindOneByMock = mockProbeLookup(null);

    expect(await ProbeService.getProbeIdByKey(probeId, "wrong")).toBeNull();
    expect(await ProbeService.getProbeIdByKey(probeId, "wrong")).toBeNull();

    expect(findOneBy).toHaveBeenCalledTimes(1);
  });

  test("does not let one probe's cached entry authenticate a different key", async () => {
    const probeId: ObjectID = ObjectID.generate();
    const findOneBy: FindOneByMock = mockProbeLookup(buildProbe(probeId));

    await ProbeService.getProbeIdByKey(probeId, "key-one");

    /*
     * A different key is a different cache entry, so it must go back to
     * Postgres rather than reuse the entry keyed on the first pair.
     */
    await ProbeService.getProbeIdByKey(probeId, "key-two");

    expect(findOneBy).toHaveBeenCalledTimes(2);
  });

  test("deleting a probe invalidates the cache so a revoked probe stops authenticating", async () => {
    const probeId: ObjectID = ObjectID.generate();
    const findOneBy: FindOneByMock = mockProbeLookup(buildProbe(probeId));

    await ProbeService.getProbeIdByKey(probeId, "the-key");
    expect(findOneBy).toHaveBeenCalledTimes(1);

    await (ProbeService as unknown as ProbeServiceInternals).onBeforeDelete({
      query: {},
      props: { isRoot: true },
    });

    // The probe is now gone, so the next lookup must re-read and get null.
    const findOneByAfterDelete: FindOneByMock = mockProbeLookup(null);

    expect(await ProbeService.getProbeIdByKey(probeId, "the-key")).toBeNull();
    expect(findOneByAfterDelete).toHaveBeenCalledTimes(1);
  });

  test("updating a probe invalidates the cache so a rotated key stops authenticating", async () => {
    const probeId: ObjectID = ObjectID.generate();
    const findOneBy: FindOneByMock = mockProbeLookup(buildProbe(probeId));

    await ProbeService.getProbeIdByKey(probeId, "old-key");
    expect(findOneBy).toHaveBeenCalledTimes(1);

    await (ProbeService as unknown as ProbeServiceInternals).onBeforeUpdate({
      query: {},
      data: {},
      props: { isRoot: true },
    });

    const findOneByAfterUpdate: FindOneByMock = mockProbeLookup(null);

    expect(await ProbeService.getProbeIdByKey(probeId, "old-key")).toBeNull();
    expect(findOneByAfterUpdate).toHaveBeenCalledTimes(1);
  });
});
