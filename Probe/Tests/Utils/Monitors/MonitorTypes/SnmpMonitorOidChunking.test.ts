// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import { SnmpOidResponse } from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";

/*
 * Same seam as SnmpMonitorHelpers.test.ts: net-snmp keeps its real constants
 * and helpers so the parsing under test is the real thing, and only the
 * session factory is stubbed so no UDP socket is ever opened.
 */
type GetCall = {
  oids: Array<string>;
};

const getCalls: Array<GetCall> = [];

/*
 * Fails the Nth (0-indexed) call to session.get, once. Used to exercise the
 * in-place chunk retry without making every attempt fail.
 */
let failCallIndexOnce: number | null = null;
let closeCallCount: number = 0;

jest.mock("net-snmp", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "net-snmp",
  ) as Record<string, unknown>;

  return {
    ...actual,
    createSession: jest.fn(() => {
      return {
        close: jest.fn(() => {
          closeCallCount++;
        }),
        on: jest.fn(),
        get: jest.fn(
          (
            oids: Array<string>,
            callback: (
              error: Error | null,
              varbinds: Array<{ oid: string; type: number; value: unknown }>,
            ) => void,
          ) => {
            const callIndex: number = getCalls.length;
            getCalls.push({ oids: oids });

            if (failCallIndexOnce === callIndex) {
              failCallIndexOnce = null;
              setImmediate(() => {
                callback(new Error("simulated request timed out"), []);
              });
              return;
            }

            /*
             * Answer positionally, as a real agent does: one varbind per
             * requested OID, in request order, carrying a value derived from
             * the OID so a mispairing is visible.
             */
            setImmediate(() => {
              callback(
                null,
                oids.map((oid: string, indexInChunk: number) => {
                  return {
                    oid: oid,
                    // 2 === Integer in net-snmp's ObjectType.
                    type: 2,
                    value: indexInChunk,
                  };
                }),
              );
            });
          },
        ),
      };
    }),
    createV3Session: jest.fn(() => {
      return { close: jest.fn(), on: jest.fn() };
    }),
  };
});

import SnmpMonitor from "../../../../Utils/Monitors/MonitorTypes/SnmpMonitor";

type SnmpMonitorOidChunking = {
  executeSnmpQuery: (
    config: MonitorStepSnmpMonitor,
    options: { monitorId?: undefined },
  ) => Promise<Array<SnmpOidResponse>>;
};

const Internal: SnmpMonitorOidChunking =
  SnmpMonitor as any as SnmpMonitorOidChunking;

/*
 * The probe's default, and the number this file is written against. Named
 * here rather than imported because the production value is a private static
 * read from the environment at module load.
 */
const CHUNK_SIZE: number = 20;

function buildConfig(oidCount: number): MonitorStepSnmpMonitor {
  const oids: Array<SnmpOid> = Array.from(
    { length: oidCount },
    (_unused: unknown, index: number) => {
      return {
        oid: `1.3.6.1.4.1.9999.${index}`,
        name: `oid-name-${index}`,
        description: `oid-description-${index}`,
      };
    },
  );

  return {
    snmpVersion: SnmpVersion.V2c,
    hostname: "192.0.2.10",
    port: 161,
    communityString: "public",
    oids: oids,
    timeout: 5000,
    retries: 0,
    monitorInterfaces: false,
  } as MonitorStepSnmpMonitor;
}

describe("SnmpMonitor OID GET chunking", () => {
  beforeEach(() => {
    getCalls.length = 0;
    failCallIndexOnce = null;
    closeCallCount = 0;
  });

  /*
   * The defect behind issue #3507: every configured OID went into a single
   * UDP datagram, so a long list answered tooBig and the DEVICE was reported
   * offline rather than the OIDs simply being collected.
   */
  test("splits a long OID list across several GETs instead of one oversized PDU", async () => {
    const responses: Array<SnmpOidResponse> = await Internal.executeSnmpQuery(
      buildConfig(45),
      {},
    );

    expect(getCalls).toHaveLength(3);
    expect(getCalls[0]!.oids).toHaveLength(CHUNK_SIZE);
    expect(getCalls[1]!.oids).toHaveLength(CHUNK_SIZE);
    expect(getCalls[2]!.oids).toHaveLength(5);
    expect(responses).toHaveLength(45);
  });

  test("leaves a short list as exactly one GET, unchanged", async () => {
    await Internal.executeSnmpQuery(buildConfig(CHUNK_SIZE), {});

    expect(getCalls).toHaveLength(1);
    expect(getCalls[0]!.oids).toHaveLength(CHUNK_SIZE);
  });

  /*
   * THE assertion this file exists for.
   *
   * net-snmp answers positionally, so the varbind at index i of chunk k
   * describes config.oids[k * CHUNK_SIZE + i]. Pairing against
   * config.oids[i] - the shape the single-GET code had - attaches the wrong
   * name to every OID past the first chunk, and it fails SILENTLY: the
   * metrics look right and are labelled wrong.
   */
  test("pairs every varbind with its own config entry across chunk boundaries", async () => {
    const responses: Array<SnmpOidResponse> = await Internal.executeSnmpQuery(
      buildConfig(45),
      {},
    );

    for (let index: number = 0; index < 45; index++) {
      expect(responses[index]!.oid).toBe(`1.3.6.1.4.1.9999.${index}`);
      expect(responses[index]!.name).toBe(`oid-name-${index}`);
    }

    // The first entries of the second and third chunks, called out explicitly.
    expect(responses[20]!.name).toBe("oid-name-20");
    expect(responses[40]!.name).toBe("oid-name-40");
  });

  test("preserves the configured order across chunks", async () => {
    const responses: Array<SnmpOidResponse> = await Internal.executeSnmpQuery(
      buildConfig(45),
      {},
    );

    expect(
      responses.map((response: SnmpOidResponse) => {
        return response.oid;
      }),
    ).toEqual(
      Array.from({ length: 45 }, (_unused: unknown, index: number) => {
        return `1.3.6.1.4.1.9999.${index}`;
      }),
    );
  });

  /*
   * Chunking multiplies the exposure to a single dropped UDP datagram by the
   * number of chunks, and the session is created with retries: 0 because
   * retries used to live at the whole-query level. One in-place retry puts
   * the per-attempt failure surface back roughly where it was.
   */
  test("retries a failing chunk once, in place, and still returns the whole list", async () => {
    failCallIndexOnce = 1;

    const responses: Array<SnmpOidResponse> = await Internal.executeSnmpQuery(
      buildConfig(45),
      {},
    );

    // 3 chunks + 1 retry of the second.
    expect(getCalls).toHaveLength(4);
    expect(responses).toHaveLength(45);
    expect(responses[20]!.name).toBe("oid-name-20");
  });

  /*
   * A persistently failing chunk still rejects the whole query. That keeps
   * today's isOnline contract exactly: a device whose health OIDs cannot be
   * read is reported down, as it always was. Partial-success semantics would
   * be a new false-alert class for SnmpOidExists.
   */
  test("rejects the whole query when a chunk fails twice, and closes the session once", async () => {
    // Fail chunk 0 on both the attempt and the retry.
    let remainingFailures: number = 2;
    getCalls.length = 0;

    const snmp: {
      createSession: jest.Mock;
    } = jest.requireMock("net-snmp") as { createSession: jest.Mock };

    snmp.createSession.mockImplementationOnce(() => {
      return {
        close: jest.fn(() => {
          closeCallCount++;
        }),
        on: jest.fn(),
        get: jest.fn(
          (
            oids: Array<string>,
            callback: (error: Error | null, varbinds: Array<never>) => void,
          ) => {
            getCalls.push({ oids: oids });
            remainingFailures--;
            setImmediate(() => {
              callback(new Error("simulated request timed out"), []);
            });
          },
        ),
      };
    });

    await expect(
      Internal.executeSnmpQuery(buildConfig(45), {}),
    ).rejects.toThrow("simulated request timed out");

    // One attempt plus one retry of the first chunk, then give up.
    expect(getCalls).toHaveLength(2);
    expect(remainingFailures).toBe(0);
    // The socket is released exactly once, not leaked and not double-closed.
    expect(closeCallCount).toBe(1);
  });

  /*
   * The retry compensates for a split query multiplying the exposure to one
   * dropped datagram. A single-chunk query has no such multiplication and the
   * outer retry loop already covers it, so retrying here would only DOUBLE
   * how long an unreachable device takes to be reported down — for every SNMP
   * device in the product, including every one this feature never touches.
   */
  test("does NOT retry a single-chunk query, so time-to-detect-offline is unchanged", async () => {
    const snmp: { createSession: jest.Mock } = jest.requireMock("net-snmp") as {
      createSession: jest.Mock;
    };

    snmp.createSession.mockImplementationOnce(() => {
      return {
        close: jest.fn(() => {
          closeCallCount++;
        }),
        on: jest.fn(),
        get: jest.fn(
          (
            oids: Array<string>,
            callback: (error: Error | null, varbinds: Array<never>) => void,
          ) => {
            getCalls.push({ oids: oids });
            setImmediate(() => {
              callback(new Error("simulated request timed out"), []);
            });
          },
        ),
      };
    });

    await expect(Internal.executeSnmpQuery(buildConfig(5), {})).rejects.toThrow(
      "simulated request timed out",
    );

    // One attempt, not two.
    expect(getCalls).toHaveLength(1);
    expect(closeCallCount).toBe(1);
  });

  test("rejects an empty OID list without opening a session", async () => {
    await expect(Internal.executeSnmpQuery(buildConfig(0), {})).rejects.toThrow(
      "No OIDs configured",
    );

    expect(getCalls).toHaveLength(0);
    expect(closeCallCount).toBe(0);
  });
});
