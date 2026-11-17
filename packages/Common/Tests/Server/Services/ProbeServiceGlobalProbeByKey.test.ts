import Probe from "../../../Models/DatabaseModels/Probe";
import ProbeService from "../../../Server/Services/ProbeService";
import PresentedKey from "../../../Server/Utils/PresentedKey/PresentedKey";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE GLOBAL PROBE A REGISTRATION FINDS BY ITS KEY (#9012).
 *
 * A global probe registers with the key it runs with
 * (Telemetry/API/ProbeIngest/Register): the global probe that holds that
 * key is the one it is. A probe's key is kept encrypted now, so no query
 * can find it by its value: the global probes - a handful on any
 * installation - are read with their keys, decrypted, and each is
 * compared with the key presented in constant time:
 *
 *   - the global probe that holds the key is found, its key left out of
 *     what is answered;
 *   - no global probe holds another key, nor one that differs in case;
 *   - only global probes are read, and the key is in no query;
 *   - every key is compared, however soon one matches.
 */

const KEY: string = "an-operator-chosen-probe-key";

function globalProbe(key: string): Probe {
  const probe: Probe = new Probe();
  probe.id = ObjectID.generate();
  probe.key = key;
  return probe;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProbeService.findGlobalProbeByKey", () => {
  test("finds the global probe that holds the key, and answers it without its key", async () => {
    const holder: Probe = globalProbe(KEY);

    jest
      .spyOn(ProbeService, "findBy")
      .mockResolvedValue([globalProbe("another-key"), holder] as never);

    const found: Probe | null = await ProbeService.findGlobalProbeByKey(KEY);

    expect(found?.id?.toString()).toBe(holder.id!.toString());
    expect(found?.key).toBeUndefined();
  });

  test("no global probe holds another key, nor one that differs only in case", async () => {
    jest
      .spyOn(ProbeService, "findBy")
      .mockResolvedValue([globalProbe(KEY)] as never);

    expect(await ProbeService.findGlobalProbeByKey("not-the-key")).toBeNull();
    expect(
      await ProbeService.findGlobalProbeByKey(KEY.toUpperCase()),
    ).toBeNull();
  });

  test("reads the global probes alone, with their keys - the key presented in no query", async () => {
    const findBy: SpyInstance<typeof ProbeService.findBy> = jest
      .spyOn(ProbeService, "findBy")
      .mockResolvedValue([] as never);

    await ProbeService.findGlobalProbeByKey(KEY);

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(findBy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        query: { isGlobalProbe: true },
        select: { _id: true, key: true },
        props: { isRoot: true },
      }),
    );
    expect(JSON.stringify(findBy.mock.calls)).not.toContain(KEY);
  });

  test("compares every global probe's key, however soon one matches", async () => {
    jest
      .spyOn(ProbeService, "findBy")
      .mockResolvedValue([
        globalProbe(KEY),
        globalProbe("second"),
        globalProbe("third"),
      ] as never);
    const matches: SpyInstance<typeof PresentedKey.matches> = jest.spyOn(
      PresentedKey,
      "matches",
    );

    await ProbeService.findGlobalProbeByKey(KEY);

    expect(matches).toHaveBeenCalledTimes(3);
  });
});
