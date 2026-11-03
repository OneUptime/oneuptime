import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import SnmpDataType from "Common/Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import { NETWORK_DEVICE_DIAGNOSTIC_CLAIM_WINDOW_IN_MINUTES } from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticResult";
import { NetworkDeviceDiagnosticStatus } from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticStatus";
import {
  NetworkDeviceDiagnosticSnmpWalkResult,
  SNMP_WALK_ALREADY_RUNNING_MESSAGE,
  SNMP_WALK_MAX_OIDS,
  SNMP_WALK_MAX_OID_LENGTH,
  SNMP_WALK_NO_CREDENTIALS_MESSAGE,
  SNMP_WALK_PROBE_UPGRADE_MESSAGE,
  SNMP_WALK_RUNNING_WINDOW_IN_MINUTES,
  SnmpWalkAuthenticationReason,
  SnmpWalkFailureKind,
  SnmpWalkRow,
  SnmpWalkStopReason,
} from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
/*
 * Static import on purpose: the module is React-free and window-free, so it
 * loads in the App suite's plain Node environment, as SnmpWalkViewModel
 * does. MultiDeviceSnmpWalkWiring pins that it stays so.
 */
import {
  ComparisonCollectState,
  ComparisonValues,
  ComparisonValuesKind,
  DeviceAnswerForOid,
  DeviceAnswerKind,
  DeviceWalk,
  DeviceWalkCounts,
  DeviceWalkStatus,
  DeviceWalkTone,
  DeviceWalkView,
  MULTI_DEVICE_SNMP_WALK_DEVICES_PARAM,
  MULTI_DEVICE_SNMP_WALK_GONE_MESSAGE,
  MULTI_DEVICE_SNMP_WALK_MAX_CONSECUTIVE_POLL_FAILURES,
  MULTI_DEVICE_SNMP_WALK_MAX_DEVICES,
  MULTI_DEVICE_SNMP_WALK_MAX_LINKED_DEVICES,
  MULTI_DEVICE_SNMP_WALK_MAX_POLL_ATTEMPTS,
  MULTI_DEVICE_SNMP_WALK_MAX_SEARCHED_VALUES,
  MULTI_DEVICE_SNMP_WALK_NO_PROBE_MESSAGE,
  MULTI_DEVICE_SNMP_WALK_OID_PARAM,
  MULTI_DEVICE_SNMP_WALK_POLL_INTERVAL_IN_MS,
  MULTI_DEVICE_SNMP_WALK_REQUEST_CONCURRENCY,
  MULTI_DEVICE_SNMP_WALK_RESTORE_LIMIT,
  MULTI_DEVICE_SNMP_WALK_RUN_WINDOW_IN_MINUTES,
  MULTI_DEVICE_SNMP_WALK_SERVER_MESSAGES,
  MULTI_DEVICE_SNMP_WALK_WAIT_IN_MS,
  MultiDeviceSnmpWalkDevice,
  MultiDeviceSnmpWalkQuery,
  SnmpWalkComparisonRow,
  SnmpWalkComparisonRowView,
  StoredDeviceWalk,
  buildMultiDeviceSnmpWalkQuery,
  compareDeviceWalks,
  countDeviceWalks,
  countWalksWithMoreToRead,
  describeDeviceWalk,
  describeMultiDeviceSnmpWalkSummary,
  describeMultiDeviceSnmpWalkTimeout,
  doesWalkReachOid,
  filterComparisonRows,
  formatComparisonNumber,
  getCollectedOidsByDevice,
  getComparisonCollectState,
  getDeviceAnswerForOid,
  getWalkStopOid,
  getWalkedAt,
  isComparableWalk,
  isDeviceWalkSettled,
  isWalkStillAwaited,
  parseMultiDeviceSnmpWalkQuery,
  pickLatestDeviceWalks,
  runWithConcurrency,
  summarizeComparisonValues,
  toComparisonRowView,
  toDeviceWalk,
  translateMultiDeviceSnmpWalkMessage,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/MultiDeviceSnmpWalkViewModel";
import {
  SNMP_WALK_MAX_CONSECUTIVE_POLL_FAILURES,
  SNMP_WALK_POLL_INTERVAL_IN_MS,
  SNMP_WALK_SERVER_MESSAGES,
  SNMP_WALK_WAIT_IN_MS,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpWalkViewModel";
import {
  CSV_BYTE_ORDER_MARK,
  MULTI_DEVICE_SNMP_WALK_CSV_COLUMNS,
  SNMP_WALK_CSV_COLUMNS,
  SnmpWalkExportFile,
  buildMultiDeviceSnmpWalkCsv,
  buildMultiDeviceSnmpWalkExport,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpWalkExport";

/*
 * Issue #5548: walking many devices at once and reading what they answer
 * side by side. Everything the Network's SNMP Walk page decides without
 * React lives in its view model, and is pinned here: what its address may
 * name, where each device's walk stands, which OIDs the devices share and
 * which some lack - never counting a walk that stopped first as a device
 * without an OID - what a fleet's values come to in a few words, who
 * Collect writes to, how the last walk is found again after a reload, and
 * every sentence a device's line says.
 */

const translator: Translator = createTranslator(undefined, "en");

const DEVICE_A: string = "11111111-1111-4111-8111-111111111111";
const DEVICE_B: string = "22222222-2222-4222-8222-222222222222";
const DEVICE_C: string = "33333333-3333-4333-8333-333333333333";
const DEVICE_D: string = "44444444-4444-4444-8444-444444444444";

function row(
  oid: string,
  type: SnmpDataType,
  value: string | number | null,
  extra: Partial<SnmpWalkRow> = {},
): SnmpWalkRow {
  return { oid: oid, type: type, value: value, ...extra };
}

function result(
  overrides: Partial<NetworkDeviceDiagnosticSnmpWalkResult> = {},
): NetworkDeviceDiagnosticSnmpWalkResult {
  return {
    rootOid: "1.3.6.1.2.1.1",
    rows: [],
    stopReason: SnmpWalkStopReason.Complete,
    snmpVersion: "2c",
    requestCount: 1,
    durationInMs: 20,
    ...overrides,
  };
}

function walked(
  deviceId: string,
  overrides: Partial<NetworkDeviceDiagnosticSnmpWalkResult> = {},
): DeviceWalk {
  return {
    deviceId: deviceId,
    status: DeviceWalkStatus.Walked,
    diagnosticId: `walk-${deviceId}`,
    createdAt: new Date("2026-11-03T10:00:00.000Z"),
    result: result(overrides),
  };
}

function device(
  id: string,
  overrides: Partial<MultiDeviceSnmpWalkDevice> = {},
): MultiDeviceSnmpWalkDevice {
  return {
    id: id,
    name: `device-${id.slice(0, 1)}`,
    hasProbe: true,
    probeName: "Rack 3",
    isProbePolled: true,
    snmpOids: [],
    templateOids: [],
    ...overrides,
  };
}

const SYS_DESCR: string = "1.3.6.1.2.1.1.1.0";
const SYS_UPTIME: string = "1.3.6.1.2.1.1.3.0";
const SYS_NAME: string = "1.3.6.1.2.1.1.5.0";
const SYS_LOCATION: string = "1.3.6.1.2.1.1.6.0";

describe("the bounds of a walk of many devices", () => {
  test("fifty devices at a time, each read up to a walk's own thousand OIDs", () => {
    expect(MULTI_DEVICE_SNMP_WALK_MAX_DEVICES).toBe(50);
    expect(MULTI_DEVICE_SNMP_WALK_MAX_DEVICES * SNMP_WALK_MAX_OIDS).toBe(50000);
  });

  test("waits five minutes, longer than a device's own page, and never past a walk's claim window", () => {
    expect(MULTI_DEVICE_SNMP_WALK_WAIT_IN_MS).toBe(5 * 60 * 1000);
    expect(MULTI_DEVICE_SNMP_WALK_WAIT_IN_MS).toBeGreaterThan(
      SNMP_WALK_WAIT_IN_MS,
    );
    /*
     * A walk Pending longer than the claim window is never handed to a
     * probe: waiting past it would wait for nothing.
     */
    expect(MULTI_DEVICE_SNMP_WALK_WAIT_IN_MS).toBeLessThanOrEqual(
      NETWORK_DEVICE_DIAGNOSTIC_CLAIM_WINDOW_IN_MINUTES * 60 * 1000,
    );
  });

  test("reads every walk back as often as a device's page reads its one, and gives up as it does", () => {
    expect(MULTI_DEVICE_SNMP_WALK_POLL_INTERVAL_IN_MS).toBe(
      SNMP_WALK_POLL_INTERVAL_IN_MS,
    );
    expect(MULTI_DEVICE_SNMP_WALK_MAX_POLL_ATTEMPTS).toBe(
      Math.ceil(
        MULTI_DEVICE_SNMP_WALK_WAIT_IN_MS /
          MULTI_DEVICE_SNMP_WALK_POLL_INTERVAL_IN_MS,
      ),
    );
    expect(
      MULTI_DEVICE_SNMP_WALK_MAX_POLL_ATTEMPTS *
        MULTI_DEVICE_SNMP_WALK_POLL_INTERVAL_IN_MS,
    ).toBeGreaterThanOrEqual(MULTI_DEVICE_SNMP_WALK_WAIT_IN_MS);
    expect(MULTI_DEVICE_SNMP_WALK_MAX_CONSECUTIVE_POLL_FAILURES).toBe(
      SNMP_WALK_MAX_CONSECUTIVE_POLL_FAILURES,
    );
  });

  test("asks a few at a time, and finds a walk again among the walks of its window", () => {
    expect(MULTI_DEVICE_SNMP_WALK_REQUEST_CONCURRENCY).toBe(5);
    expect(MULTI_DEVICE_SNMP_WALK_RUN_WINDOW_IN_MINUTES).toBe(10);
    /*
     * Long enough for every row one press of Walk creates; longer than a
     * walk counts as running, so a run's last row is never left out.
     */
    expect(MULTI_DEVICE_SNMP_WALK_RUN_WINDOW_IN_MINUTES).toBeGreaterThan(
      SNMP_WALK_RUNNING_WINDOW_IN_MINUTES,
    );
    /*
     * The light rows read to find it cover several walks of every device
     * one walk can hold.
     */
    expect(MULTI_DEVICE_SNMP_WALK_RESTORE_LIMIT).toBeGreaterThanOrEqual(
      MULTI_DEVICE_SNMP_WALK_MAX_DEVICES * 5,
    );
  });

  test("a link may carry more devices than one walk takes, so the page can say so", () => {
    expect(MULTI_DEVICE_SNMP_WALK_MAX_LINKED_DEVICES).toBeGreaterThan(
      MULTI_DEVICE_SNMP_WALK_MAX_DEVICES,
    );
  });
});

describe("what the page's address names", () => {
  test("devices in the order picked, and the OID to start at", () => {
    const query: MultiDeviceSnmpWalkQuery = parseMultiDeviceSnmpWalkQuery({
      devices: `${DEVICE_B},${DEVICE_A}`,
      oid: "1.3.6.1.4.1.29671",
    });

    expect(query).toEqual({
      deviceIds: [DEVICE_B, DEVICE_A],
      startOid: "1.3.6.1.4.1.29671",
    });
  });

  test("drops what is not an id, a repeat in any case, and blanks between commas", () => {
    expect(
      parseMultiDeviceSnmpWalkQuery({
        devices: ` ${DEVICE_A} ,,not-an-id,${DEVICE_A.toUpperCase()},${DEVICE_C},<script>,`,
        oid: null,
      }).deviceIds,
    ).toEqual([DEVICE_A, DEVICE_C]);
  });

  test("an OID typed with a leading dot reads as the OID, and a MIB name or junk as no OID", () => {
    expect(
      parseMultiDeviceSnmpWalkQuery({ devices: null, oid: ".1.3.6.1.2.1.1" })
        .startOid,
    ).toBe("1.3.6.1.2.1.1");

    for (const refused of [
      "sysDescr",
      "IF-MIB::ifTable",
      "1.3.6.1.x",
      "1..3",
      "javascript:alert(1)",
      "1.3.6.1." + "1.".repeat(SNMP_WALK_MAX_OID_LENGTH),
    ]) {
      expect(
        parseMultiDeviceSnmpWalkQuery({ devices: null, oid: refused }).startOid,
      ).toBe("");
    }
  });

  test("nothing in the address is nothing picked and everything to walk", () => {
    expect(parseMultiDeviceSnmpWalkQuery({ devices: null, oid: null })).toEqual(
      { deviceIds: [], startOid: "" },
    );
    expect(
      parseMultiDeviceSnmpWalkQuery({ devices: undefined, oid: "" }),
    ).toEqual({ deviceIds: [], startOid: "" });
  });

  test("a link carries at most its limit of devices", () => {
    const random: SeededRandom = seededRandom(5548);
    const ids: Array<string> = [];

    for (let index: number = 0; index < 700; index++) {
      const hex: string = index.toString(16).padStart(12, "0");
      ids.push(`${random(10)}aaaaaaa-aaaa-4aaa-8aaa-${hex}`);
    }

    const parsed: MultiDeviceSnmpWalkQuery = parseMultiDeviceSnmpWalkQuery({
      devices: ids.join(","),
      oid: null,
    });

    expect(parsed.deviceIds).toHaveLength(
      MULTI_DEVICE_SNMP_WALK_MAX_LINKED_DEVICES,
    );
    expect(parsed.deviceIds).toEqual(
      ids.slice(0, MULTI_DEVICE_SNMP_WALK_MAX_LINKED_DEVICES),
    );
  });

  test("is written back as one list of devices and the OID, read back the same", () => {
    const query: MultiDeviceSnmpWalkQuery = {
      deviceIds: [DEVICE_C, DEVICE_A, DEVICE_B],
      startOid: ".1.3.6.1.2.1.2",
    };
    const written: string = buildMultiDeviceSnmpWalkQuery(query);
    const params: URLSearchParams = new URLSearchParams(written);

    expect(params.get(MULTI_DEVICE_SNMP_WALK_DEVICES_PARAM)).toBe(
      `${DEVICE_C},${DEVICE_A},${DEVICE_B}`,
    );
    expect(params.get(MULTI_DEVICE_SNMP_WALK_OID_PARAM)).toBe("1.3.6.1.2.1.2");
    expect(
      parseMultiDeviceSnmpWalkQuery({
        devices: params.get(MULTI_DEVICE_SNMP_WALK_DEVICES_PARAM),
        oid: params.get(MULTI_DEVICE_SNMP_WALK_OID_PARAM),
      }),
    ).toEqual({
      deviceIds: [DEVICE_C, DEVICE_A, DEVICE_B],
      startOid: "1.3.6.1.2.1.2",
    });
  });

  test("leaves out what there is none of", () => {
    expect(buildMultiDeviceSnmpWalkQuery({ deviceIds: [], startOid: "" })).toBe(
      "",
    );
    expect(
      buildMultiDeviceSnmpWalkQuery({ deviceIds: [DEVICE_A], startOid: " " }),
    ).toBe(`${MULTI_DEVICE_SNMP_WALK_DEVICES_PARAM}=${DEVICE_A}`);
    expect(
      buildMultiDeviceSnmpWalkQuery({ deviceIds: [], startOid: "1.3.6.1" }),
    ).toBe(`${MULTI_DEVICE_SNMP_WALK_OID_PARAM}=1.3.6.1`);
  });
});

describe("where a device's walk stands, from its row", () => {
  const base: StoredDeviceWalk = {
    diagnosticId: "d1",
    deviceId: DEVICE_A,
    createdAt: "2026-11-03T10:00:00.000Z",
    rootOid: "1.3.6.1.2.1.1",
  };

  test("a Completed walk with what it read is walked, with its result", () => {
    const walk: DeviceWalk = toDeviceWalk({
      ...base,
      status: NetworkDeviceDiagnosticStatus.Completed,
      result: result({ rows: [row(SYS_NAME, SnmpDataType.OctetString, "a")] }),
    });

    expect(walk.status).toBe(DeviceWalkStatus.Walked);
    expect(walk.result?.rows).toHaveLength(1);
    expect(walk.diagnosticId).toBe("d1");
    expect(walk.createdAt).toEqual(new Date("2026-11-03T10:00:00.000Z"));
    expect(isDeviceWalkSettled(walk)).toBe(true);
  });

  test("a Failed walk is one the probe could not run, with the probe's reason", () => {
    const walk: DeviceWalk = toDeviceWalk({
      ...base,
      status: NetworkDeviceDiagnosticStatus.Failed,
      statusMessage: SNMP_WALK_PROBE_UPGRADE_MESSAGE,
    });

    expect(walk.status).toBe(DeviceWalkStatus.ProbeFailed);
    expect(walk.message).toBe(SNMP_WALK_PROBE_UPGRADE_MESSAGE);
    expect(walk.result).toBeUndefined();
  });

  test("a Completed row without a result reads as not run, never as nothing found", () => {
    expect(
      toDeviceWalk({ ...base, status: NetworkDeviceDiagnosticStatus.Completed })
        .status,
    ).toBe(DeviceWalkStatus.ProbeFailed);
  });

  test("Pending and In Progress are still on their way", () => {
    for (const status of [
      NetworkDeviceDiagnosticStatus.Pending,
      NetworkDeviceDiagnosticStatus.InProgress,
      undefined,
    ]) {
      const walk: DeviceWalk = toDeviceWalk({ ...base, status: status });

      expect(walk.status).toBe(DeviceWalkStatus.Walking);
      expect(isDeviceWalkSettled(walk)).toBe(false);
    }
  });

  test("a date the API sent as text, as a Date, or not at all", () => {
    expect(
      toDeviceWalk({ ...base, createdAt: new Date(0) }).createdAt?.getTime(),
    ).toBe(0);
    expect(toDeviceWalk({ ...base, createdAt: undefined }).createdAt).toBe(
      undefined,
    );
    expect(toDeviceWalk({ ...base, createdAt: "not a date" }).createdAt).toBe(
      undefined,
    );
  });

  test("only asking and walking are unsettled", () => {
    const settled: Array<DeviceWalkStatus> = Object.values(
      DeviceWalkStatus,
    ).filter((status: DeviceWalkStatus): boolean => {
      return isDeviceWalkSettled({ deviceId: DEVICE_A, status: status });
    });

    expect(settled.sort()).toEqual(
      [
        DeviceWalkStatus.Walked,
        DeviceWalkStatus.ProbeFailed,
        DeviceWalkStatus.NotStarted,
        DeviceWalkStatus.TimedOut,
      ].sort(),
    );
  });
});

describe("finding the last walk again after a reload", () => {
  const ROOT: string = "1.3.6.1.4.1.29671";

  function entry(
    id: string,
    deviceId: string,
    createdAt: string,
    overrides: Partial<StoredDeviceWalk> = {},
  ): StoredDeviceWalk {
    return {
      diagnosticId: id,
      deviceId: deviceId,
      createdAt: createdAt,
      rootOid: ROOT,
      status: NetworkDeviceDiagnosticStatus.Completed,
      ...overrides,
    };
  }

  test("each device's newest walk of the OID, in the order the devices were picked", () => {
    const picked: Array<StoredDeviceWalk> = pickLatestDeviceWalks({
      entries: [
        entry("a-old", DEVICE_A, "2026-11-03T09:58:00.000Z"),
        entry("a-new", DEVICE_A, "2026-11-03T10:00:01.000Z"),
        entry("b-new", DEVICE_B, "2026-11-03T10:00:00.000Z"),
      ],
      deviceIds: [DEVICE_B, DEVICE_A],
      rootOid: ROOT,
    });

    expect(
      picked.map((walk: StoredDeviceWalk): string => {
        return walk.diagnosticId;
      }),
    ).toEqual(["b-new", "a-new"]);
  });

  test("leaves out walks of another OID, walks continued on a device's page, and devices not picked", () => {
    const picked: Array<StoredDeviceWalk> = pickLatestDeviceWalks({
      entries: [
        entry("other-root", DEVICE_A, "2026-11-03T10:00:05.000Z", {
          rootOid: "1.3.6.1",
        }),
        entry("continued", DEVICE_A, "2026-11-03T10:00:06.000Z", {
          afterOid: `${ROOT}.1.5`,
        }),
        entry("not-picked", DEVICE_D, "2026-11-03T10:00:07.000Z"),
        entry("no-date", DEVICE_B, "", { createdAt: undefined }),
        entry("fresh", DEVICE_A, "2026-11-03T10:00:00.000Z", {
          rootOid: `.${ROOT}`,
        }),
      ],
      deviceIds: [DEVICE_A, DEVICE_B],
      rootOid: ROOT,
    });

    expect(
      picked.map((walk: StoredDeviceWalk): string => {
        return walk.diagnosticId;
      }),
    ).toEqual(["fresh"]);
  });

  test("keeps only the walks one press of Walk created: those within the window of the newest", () => {
    const picked: Array<StoredDeviceWalk> = pickLatestDeviceWalks({
      entries: [
        entry("a", DEVICE_A, "2026-11-03T10:00:00.000Z"),
        entry("b", DEVICE_B, "2026-11-03T09:51:00.000Z"),
        // Walked on its own the day before: not part of this comparison.
        entry("c", DEVICE_C, "2026-11-02T10:00:00.000Z"),
      ],
      deviceIds: [DEVICE_A, DEVICE_B, DEVICE_C],
      rootOid: ROOT,
    });

    expect(
      picked.map((walk: StoredDeviceWalk): string => {
        return walk.diagnosticId;
      }),
    ).toEqual(["a", "b"]);
  });

  test("the window's edge is inside it", () => {
    const newest: number = Date.parse("2026-11-03T10:00:00.000Z");
    const edge: string = new Date(
      newest - MULTI_DEVICE_SNMP_WALK_RUN_WINDOW_IN_MINUTES * 60 * 1000,
    ).toISOString();
    const outside: string = new Date(
      newest - MULTI_DEVICE_SNMP_WALK_RUN_WINDOW_IN_MINUTES * 60 * 1000 - 1,
    ).toISOString();

    expect(
      pickLatestDeviceWalks({
        entries: [
          entry("a", DEVICE_A, new Date(newest).toISOString()),
          entry("b", DEVICE_B, edge),
          entry("c", DEVICE_C, outside),
        ],
        deviceIds: [DEVICE_A, DEVICE_B, DEVICE_C],
        rootOid: ROOT,
      }).map((walk: StoredDeviceWalk): string => {
        return walk.diagnosticId;
      }),
    ).toEqual(["a", "b"]);
  });

  test("no OID, or no walk of it, is nothing to put back", () => {
    expect(
      pickLatestDeviceWalks({
        entries: [entry("a", DEVICE_A, "2026-11-03T10:00:00.000Z")],
        deviceIds: [DEVICE_A],
        rootOid: "",
      }),
    ).toEqual([]);
    expect(
      pickLatestDeviceWalks({
        entries: [],
        deviceIds: [DEVICE_A],
        rootOid: ROOT,
      }),
    ).toEqual([]);
  });

  test("a walk still on its way is waited for within the page's wait, and not after", () => {
    const now: Date = new Date("2026-11-03T10:10:00.000Z");

    expect(
      isWalkStillAwaited({
        createdAt: new Date(
          now.getTime() - MULTI_DEVICE_SNMP_WALK_WAIT_IN_MS + 1,
        ),
        now: now,
      }),
    ).toBe(true);
    expect(
      isWalkStillAwaited({
        createdAt: new Date(now.getTime() - MULTI_DEVICE_SNMP_WALK_WAIT_IN_MS),
        now: now,
      }),
    ).toBe(false);
    expect(isWalkStillAwaited({ createdAt: undefined, now: now })).toBe(false);
  });
});

describe("how far a device's walk read", () => {
  test("a complete walk reached every OID under its root", () => {
    const complete: NetworkDeviceDiagnosticSnmpWalkResult = result({
      rows: [row(SYS_DESCR, SnmpDataType.OctetString, "x")],
    });

    expect(getWalkStopOid(complete)).toBeUndefined();
    expect(doesWalkReachOid(complete, "1.3.6.1.2.1.1.99.0")).toBe(true);
  });

  test("a walk stopped at its limit reached what it read, and nothing after", () => {
    const stopped: NetworkDeviceDiagnosticSnmpWalkResult = result({
      rootOid: "1.3.6.1.2.1.2",
      rows: [
        row("1.3.6.1.2.1.2.2.1.10.8", SnmpDataType.Counter32, 1),
        row("1.3.6.1.2.1.2.2.1.10.9", SnmpDataType.Counter32, 1),
      ],
      stopReason: SnmpWalkStopReason.OidLimit,
      nextOid: "1.3.6.1.2.1.2.2.1.10.9",
    });

    expect(getWalkStopOid(stopped)).toBe("1.3.6.1.2.1.2.2.1.10.9");
    expect(doesWalkReachOid(stopped, "1.3.6.1.2.1.2.2.1.10.9")).toBe(true);
    expect(doesWalkReachOid(stopped, "1.3.6.1.2.1.2.2.1.10.8")).toBe(true);
    // Arc by arc, as numbers: .10 comes after .9, which text gets wrong.
    expect(doesWalkReachOid(stopped, "1.3.6.1.2.1.2.2.1.10.10")).toBe(false);
    expect(doesWalkReachOid(stopped, "1.3.6.1.2.1.2.2.1.11.1")).toBe(false);
    // A prefix comes before everything under it.
    expect(doesWalkReachOid(stopped, "1.3.6.1.2.1.2.2.1.10")).toBe(true);
  });

  test("with no next OID, the last row read is where it stopped", () => {
    expect(
      getWalkStopOid(
        result({
          rows: [row(SYS_UPTIME, SnmpDataType.TimeTicks, 5)],
          stopReason: SnmpWalkStopReason.TimeLimit,
        }),
      ),
    ).toBe(SYS_UPTIME);
  });

  test("a walk that stopped before reading anything reached nothing", () => {
    const silent: NetworkDeviceDiagnosticSnmpWalkResult = result({
      stopReason: SnmpWalkStopReason.Failed,
      failure: { kind: SnmpWalkFailureKind.Timeout, message: "timeout" },
    });

    expect(getWalkStopOid(silent)).toBeUndefined();
    expect(doesWalkReachOid(silent, SYS_DESCR)).toBe(false);
  });
});

describe("which walks are compared", () => {
  test("a walk that read its subtree, whole or in part - or found it empty - says which OIDs the device has", () => {
    expect(isComparableWalk(walked(DEVICE_A))).toBe(true);
    expect(
      isComparableWalk(
        walked(DEVICE_A, {
          rows: [row(SYS_DESCR, SnmpDataType.OctetString, "x")],
          stopReason: SnmpWalkStopReason.Failed,
          failure: { kind: SnmpWalkFailureKind.Timeout, message: "t" },
          nextOid: SYS_DESCR,
        }),
      ),
    ).toBe(true);
  });

  test("a refused or silent walk, and one not walked, say nothing about it", () => {
    expect(
      isComparableWalk(
        walked(DEVICE_A, {
          stopReason: SnmpWalkStopReason.Failed,
          failure: {
            kind: SnmpWalkFailureKind.Authentication,
            message: "Wrong Digest",
          },
        }),
      ),
    ).toBe(false);

    for (const status of [
      DeviceWalkStatus.Asking,
      DeviceWalkStatus.Walking,
      DeviceWalkStatus.ProbeFailed,
      DeviceWalkStatus.NotStarted,
      DeviceWalkStatus.TimedOut,
    ]) {
      expect(isComparableWalk({ deviceId: DEVICE_A, status: status })).toBe(
        false,
      );
    }
  });
});

describe("the devices' walks, side by side", () => {
  test("every OID any device answered, once, in OID order, with who answered it in the order picked", () => {
    const rows: Array<SnmpWalkComparisonRow> = compareDeviceWalks([
      walked(DEVICE_B, {
        rows: [
          row(SYS_DESCR, SnmpDataType.OctetString, "Meraki MX"),
          row(SYS_NAME, SnmpDataType.OctetString, "mx-b"),
        ],
      }),
      walked(DEVICE_A, {
        rows: [
          row(SYS_DESCR, SnmpDataType.OctetString, "Meraki MX"),
          row(SYS_UPTIME, SnmpDataType.TimeTicks, 100),
          row(SYS_NAME, SnmpDataType.OctetString, "mx-a"),
        ],
      }),
    ]);

    expect(
      rows.map((entry: SnmpWalkComparisonRow): string => {
        return entry.oid;
      }),
    ).toEqual([SYS_DESCR, SYS_UPTIME, SYS_NAME]);
    expect(
      rows[0]!.answers.map((answer: { deviceId: string }): string => {
        return answer.deviceId;
      }),
    ).toEqual([DEVICE_B, DEVICE_A]);
    expect(rows[1]!.answers).toHaveLength(1);
    expect(rows[1]!.reachedCount).toBe(2);
  });

  test("orders OIDs arc by arc as numbers, not as text", () => {
    const rows: Array<SnmpWalkComparisonRow> = compareDeviceWalks([
      walked(DEVICE_A, {
        rootOid: "1.3.6.1.2.1.2.2.1",
        rows: [
          row("1.3.6.1.2.1.2.2.1.10.1", SnmpDataType.Counter32, 1),
          row("1.3.6.1.2.1.2.2.1.2.1", SnmpDataType.OctetString, "eth0"),
          row("1.3.6.1.2.1.2.2.1.9.1", SnmpDataType.TimeTicks, 1),
          row("1.3.6.1.2.1.2.2.1.10", SnmpDataType.Counter32, 1),
        ],
      }),
    ]);

    expect(
      rows.map((entry: SnmpWalkComparisonRow): string => {
        return entry.oid;
      }),
    ).toEqual([
      "1.3.6.1.2.1.2.2.1.2.1",
      "1.3.6.1.2.1.2.2.1.9.1",
      "1.3.6.1.2.1.2.2.1.10",
      "1.3.6.1.2.1.2.2.1.10.1",
    ]);
  });

  test("never counts a walk that stopped before an OID as a device without it", () => {
    const rows: Array<SnmpWalkComparisonRow> = compareDeviceWalks([
      walked(DEVICE_A, {
        rows: [
          row(SYS_DESCR, SnmpDataType.OctetString, "x"),
          row(SYS_NAME, SnmpDataType.OctetString, "a"),
          row(SYS_LOCATION, SnmpDataType.OctetString, "Rack 3"),
        ],
      }),
      walked(DEVICE_B, {
        rows: [row(SYS_DESCR, SnmpDataType.OctetString, "x")],
        stopReason: SnmpWalkStopReason.OidLimit,
        nextOid: SYS_DESCR,
      }),
      walked(DEVICE_C, {
        rows: [
          row(SYS_DESCR, SnmpDataType.OctetString, "x"),
          row(SYS_NAME, SnmpDataType.OctetString, "c"),
        ],
        stopReason: SnmpWalkStopReason.Failed,
        failure: { kind: SnmpWalkFailureKind.Timeout, message: "t" },
        nextOid: SYS_NAME,
      }),
    ]);

    const byOid: Map<string, SnmpWalkComparisonRow> = new Map(
      rows.map((entry: SnmpWalkComparisonRow) => {
        return [entry.oid, entry];
      }),
    );

    expect(byOid.get(SYS_DESCR)!.reachedCount).toBe(3);
    expect(byOid.get(SYS_DESCR)!.answers).toHaveLength(3);
    // B stopped at sysDescr: it was not asked about sysName.
    expect(byOid.get(SYS_NAME)!.reachedCount).toBe(2);
    expect(byOid.get(SYS_NAME)!.answers).toHaveLength(2);
    // Only A read as far as sysLocation.
    expect(byOid.get(SYS_LOCATION)!.reachedCount).toBe(1);
  });

  test("leaves out the walks that say nothing, and an OID a walk read twice counts once", () => {
    const rows: Array<SnmpWalkComparisonRow> = compareDeviceWalks([
      walked(DEVICE_A, {
        rows: [
          row(SYS_NAME, SnmpDataType.OctetString, "a"),
          row(`.${SYS_NAME}`, SnmpDataType.OctetString, "a"),
        ],
      }),
      walked(DEVICE_B, {
        stopReason: SnmpWalkStopReason.Failed,
        failure: { kind: SnmpWalkFailureKind.Timeout, message: "t" },
      }),
      { deviceId: DEVICE_C, status: DeviceWalkStatus.NotStarted },
      { deviceId: DEVICE_D, status: DeviceWalkStatus.Walking },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.oid).toBe(SYS_NAME);
    expect(rows[0]!.answers).toHaveLength(1);
    expect(rows[0]!.reachedCount).toBe(1);
  });

  test("no comparable walk is no row", () => {
    expect(compareDeviceWalks([])).toEqual([]);
    expect(
      compareDeviceWalks([
        { deviceId: DEVICE_A, status: DeviceWalkStatus.Asking },
      ]),
    ).toEqual([]);
  });

  test("holds for any fleet: sorted, every read OID answered once by its device, never more answers than reached walks", () => {
    const random: SeededRandom = seededRandom(5548);

    for (let fleet: number = 0; fleet < 40; fleet++) {
      const deviceCount: number = 1 + random(12);
      const walks: Array<DeviceWalk> = [];

      for (let index: number = 0; index < deviceCount; index++) {
        const oids: Set<string> = new Set();
        const count: number = random(40);

        for (let oidIndex: number = 0; oidIndex < count; oidIndex++) {
          oids.add(`1.3.6.1.4.1.9.${random(6)}.${random(30)}`);
        }

        const sorted: Array<string> = Array.from(oids).sort(
          (left: string, right: string): number => {
            const a: Array<number> = left.split(".").map(Number);
            const b: Array<number> = right.split(".").map(Number);

            for (
              let arc: number = 0;
              arc < Math.min(a.length, b.length);
              arc++
            ) {
              if (a[arc] !== b[arc]) {
                return a[arc]! - b[arc]!;
              }
            }

            return a.length - b.length;
          },
        );
        const stopsShort: boolean = sorted.length > 0 && random(3) === 0;

        walks.push(
          walked(`device-${fleet}-${index}`, {
            rootOid: "1.3.6.1.4.1.9",
            rows: sorted.map((oid: string): SnmpWalkRow => {
              return row(oid, SnmpDataType.Gauge32, random(100));
            }),
            stopReason: stopsShort
              ? SnmpWalkStopReason.OidLimit
              : SnmpWalkStopReason.Complete,
            nextOid: stopsShort ? sorted[sorted.length - 1] : undefined,
          }),
        );
      }

      const rows: Array<SnmpWalkComparisonRow> = compareDeviceWalks(walks);
      const answered: number = rows.reduce(
        (sum: number, entry: SnmpWalkComparisonRow): number => {
          return sum + entry.answers.length;
        },
        0,
      );
      const read: number = walks.reduce(
        (sum: number, walk: DeviceWalk): number => {
          return sum + walk.result!.rows.length;
        },
        0,
      );

      expect(answered).toBe(read);

      const outOfOrder: Array<string> = [];

      for (let index: number = 1; index < rows.length; index++) {
        const previous: Array<number> =
          rows[index - 1]!.oid.split(".").map(Number);
        const current: Array<number> = rows[index]!.oid.split(".").map(Number);
        let order: number = 0;

        for (
          let arc: number = 0;
          arc < Math.min(previous.length, current.length) && order === 0;
          arc++
        ) {
          order = previous[arc]! - current[arc]!;
        }

        if ((order === 0 ? previous.length - current.length : order) >= 0) {
          outOfOrder.push(rows[index]!.oid);
        }
      }

      expect(outOfOrder).toEqual([]);

      const readByDevice: Map<string, Set<string>> = new Map(
        walks.map((walk: DeviceWalk): [string, Set<string>] => {
          return [
            walk.deviceId,
            new Set(
              walk.result!.rows.map((candidate: SnmpWalkRow): string => {
                return candidate.oid;
              }),
            ),
          ];
        }),
      );
      // Checked as one fact per fleet: tens of thousands of expects are slow.
      const brokenRows: Array<string> = rows
        .filter((entry: SnmpWalkComparisonRow): boolean => {
          return (
            entry.answers.length === 0 ||
            entry.answers.length > entry.reachedCount ||
            entry.reachedCount > walks.length ||
            entry.answers.some((answer: { deviceId: string }): boolean => {
              return !readByDevice.get(answer.deviceId)?.has(entry.oid);
            })
          );
        })
        .map((entry: SnmpWalkComparisonRow): string => {
          return entry.oid;
        });

      expect(brokenRows).toEqual([]);

      // Against a count made the slow way: every OID against every walk.
      const wrongCounts: Array<string> = rows
        .filter((entry: SnmpWalkComparisonRow): boolean => {
          const reached: number = walks.filter((walk: DeviceWalk): boolean => {
            return doesWalkReachOid(walk.result!, entry.oid);
          }).length;

          return reached !== entry.reachedCount;
        })
        .map((entry: SnmpWalkComparisonRow): string => {
          return entry.oid;
        });

      expect(wrongCounts).toEqual([]);
    }
  });

  test("compares fifty walks of a thousand OIDs in a moment", () => {
    const walks: Array<DeviceWalk> = [];

    for (
      let index: number = 0;
      index < MULTI_DEVICE_SNMP_WALK_MAX_DEVICES;
      index++
    ) {
      const rows: Array<SnmpWalkRow> = [];

      for (let oid: number = 0; oid < SNMP_WALK_MAX_OIDS; oid++) {
        // Each device's ports at indexes of its own, as a fleet's are.
        rows.push(
          row(
            `1.3.6.1.2.1.2.2.1.10.${index * 10000 + oid}`,
            SnmpDataType.Counter32,
            oid,
          ),
        );
      }

      walks.push(
        walked(`device-${index}`, {
          rootOid: "1.3.6.1.2.1.2",
          rows: rows,
          stopReason:
            index % 2 === 0
              ? SnmpWalkStopReason.Complete
              : SnmpWalkStopReason.OidLimit,
          nextOid: index % 2 === 0 ? undefined : rows[rows.length - 1]!.oid,
        }),
      );
    }

    const startedAt: number = Date.now();
    const rows: Array<SnmpWalkComparisonRow> = compareDeviceWalks(walks);
    const tookInMs: number = Date.now() - startedAt;

    expect(rows).toHaveLength(
      MULTI_DEVICE_SNMP_WALK_MAX_DEVICES * SNMP_WALK_MAX_OIDS,
    );
    // Generous for a busy CI worker; a few hundred milliseconds on a laptop.
    expect(tookInMs).toBeLessThan(3000);
    // Every walk that stopped short reached all its own OIDs.
    expect(rows[rows.length - 1]!.reachedCount).toBe(
      MULTI_DEVICE_SNMP_WALK_MAX_DEVICES / 2 + 1,
    );
  });
});

describe("one device's answer under an OID's row", () => {
  const rows: Array<SnmpWalkComparisonRow> = compareDeviceWalks([
    walked(DEVICE_A, {
      rows: [
        row(SYS_DESCR, SnmpDataType.OctetString, "x"),
        row(SYS_NAME, SnmpDataType.OctetString, "a"),
      ],
    }),
  ]);
  const sysName: SnmpWalkComparisonRow = rows.find(
    (entry: SnmpWalkComparisonRow): boolean => {
      return entry.oid === SYS_NAME;
    },
  )!;

  test("is what it read when it answered", () => {
    const answer: DeviceAnswerForOid = getDeviceAnswerForOid({
      walk: walked(DEVICE_A),
      row: sysName,
    });

    expect(answer.kind).toBe(DeviceAnswerKind.Answered);
    expect(
      answer.kind === DeviceAnswerKind.Answered ? answer.row.value : undefined,
    ).toBe("a");
  });

  test("is missing when its walk went past the OID without it", () => {
    expect(
      getDeviceAnswerForOid({
        walk: walked(DEVICE_B, {
          rows: [row(SYS_DESCR, SnmpDataType.OctetString, "x")],
        }),
        row: sysName,
      }).kind,
    ).toBe(DeviceAnswerKind.Missing);
  });

  test("says the walk did not get that far when it stopped first", () => {
    expect(
      getDeviceAnswerForOid({
        walk: walked(DEVICE_B, {
          rows: [row(SYS_DESCR, SnmpDataType.OctetString, "x")],
          stopReason: SnmpWalkStopReason.OidLimit,
          nextOid: SYS_DESCR,
        }),
        row: sysName,
      }).kind,
    ).toBe(DeviceAnswerKind.NotReached);
  });
});

describe("what a fleet's values come to", () => {
  function answers(
    ...values: Array<SnmpWalkRow>
  ): Array<{ deviceId: string; row: SnmpWalkRow }> {
    return values.map((value: SnmpWalkRow, index: number) => {
      return { deviceId: `d${index}`, row: value };
    });
  }

  test("one value when every device read the same, nulls and empty text included", () => {
    const same: ComparisonValues | undefined = summarizeComparisonValues(
      answers(
        row(SYS_DESCR, SnmpDataType.OctetString, "Meraki MX67"),
        row(SYS_DESCR, SnmpDataType.OctetString, "Meraki MX67"),
      ),
    );

    expect(same?.kind).toBe(ComparisonValuesKind.Same);
    expect(
      summarizeComparisonValues(
        answers(
          row(SYS_DESCR, SnmpDataType.Null, null),
          row(SYS_DESCR, SnmpDataType.Null, null),
        ),
      )?.kind,
    ).toBe(ComparisonValuesKind.Same);
    expect(
      summarizeComparisonValues(
        answers(row(SYS_DESCR, SnmpDataType.OctetString, "")),
      )?.kind,
    ).toBe(ComparisonValuesKind.Same);
  });

  test("the lowest and the highest when numbers differ, a Counter64's text included", () => {
    const range: ComparisonValues | undefined = summarizeComparisonValues(
      answers(
        row("1.3.6.1.4.1.9.9.109.1.1.1.1.8.1", SnmpDataType.Gauge32, 7),
        row("1.3.6.1.4.1.9.9.109.1.1.1.1.8.1", SnmpDataType.Gauge32, 93),
        row("1.3.6.1.4.1.9.9.109.1.1.1.1.8.1", SnmpDataType.Gauge32, 41),
      ),
    );

    expect(range?.kind).toBe(ComparisonValuesKind.Range);

    if (range?.kind === ComparisonValuesKind.Range) {
      expect(range.low.value).toBe(7);
      expect(range.high.value).toBe(93);
    }

    const counters: ComparisonValues | undefined = summarizeComparisonValues(
      answers(
        row(
          "1.3.6.1.2.1.31.1.1.1.6.1",
          SnmpDataType.Counter64,
          "18446744073709551000",
        ),
        row("1.3.6.1.2.1.31.1.1.1.6.1", SnmpDataType.Counter64, "12"),
      ),
    );

    expect(counters?.kind).toBe(ComparisonValuesKind.Range);

    if (counters?.kind === ComparisonValuesKind.Range) {
      // The device's own digits, never a double's rounding of them.
      expect(counters.high.value).toBe("18446744073709551000");
    }
  });

  test("how many different values when text, a mix, or hex and text differ", () => {
    const different: ComparisonValues | undefined = summarizeComparisonValues(
      answers(
        row(SYS_NAME, SnmpDataType.OctetString, "mx-a"),
        row(SYS_NAME, SnmpDataType.OctetString, "mx-b"),
        row(SYS_NAME, SnmpDataType.OctetString, "mx-a"),
      ),
    );

    expect(different).toEqual({
      kind: ComparisonValuesKind.Different,
      count: 2,
    });
    expect(
      summarizeComparisonValues(
        answers(
          row(SYS_NAME, SnmpDataType.Integer, 1),
          row(SYS_NAME, SnmpDataType.OctetString, "one"),
        ),
      )?.kind,
    ).toBe(ComparisonValuesKind.Different);
    expect(
      summarizeComparisonValues(
        answers(
          row(SYS_NAME, SnmpDataType.OctetString, "00 1A", { isHex: true }),
          row(SYS_NAME, SnmpDataType.OctetString, "00 1A"),
        ),
      )?.kind,
    ).toBe(ComparisonValuesKind.Different);
  });

  test("no answers is no summary", () => {
    expect(summarizeComparisonValues([])).toBeUndefined();
  });

  test("an uptime's range reads as the times it adds up to", () => {
    expect(
      formatComparisonNumber(
        row(SYS_UPTIME, SnmpDataType.TimeTicks, 104524500),
        translator,
      ),
    ).toBe("12 days, 02:20:45");
    expect(
      formatComparisonNumber(
        row(SYS_UPTIME, SnmpDataType.Gauge32, 12),
        translator,
      ),
    ).toBe("12");
  });
});

describe("how an OID's row reads, and what its filter matches", () => {
  const rows: Array<SnmpWalkComparisonRow> = compareDeviceWalks([
    walked(DEVICE_A, {
      rows: [
        row(SYS_NAME, SnmpDataType.OctetString, "edge-mx-amsterdam"),
        row(SYS_LOCATION, SnmpDataType.OctetString, "Amsterdam"),
      ],
    }),
    walked(DEVICE_B, {
      rows: [
        row(SYS_NAME, SnmpDataType.OctetString, "edge-mx-berlin"),
        row(SYS_LOCATION, SnmpDataType.OctetString, "Berlin", { isHex: true }),
      ],
    }),
  ]);
  const views: Map<string, SnmpWalkComparisonRowView> = new Map(
    rows.map((entry: SnmpWalkComparisonRow) => {
      return [entry.oid, toComparisonRowView(entry, translator)];
    }),
  );

  test("names the OID from the MIBs, and lists every type the devices answered with", () => {
    const view: SnmpWalkComparisonRowView = views.get(SYS_LOCATION)!;

    expect(view.name).toBe("sysLocation.0");
    expect(view.typeLabels).toEqual(["STRING", "Hex-STRING"]);
    expect(views.get(SYS_NAME)!.typeLabels).toEqual(["STRING"]);
  });

  test("a value any device read finds the OID", () => {
    expect(
      filterComparisonRows({
        rows: rows,
        views: views,
        query: "berlin",
        onlyMissingOnSome: false,
      }).map((entry: SnmpWalkComparisonRow): string => {
        return entry.oid;
      }),
    ).toEqual([SYS_NAME, SYS_LOCATION]);
    expect(
      filterComparisonRows({
        rows: rows,
        views: views,
        query: "sysLocation BERLIN",
        onlyMissingOnSome: false,
      }).map((entry: SnmpWalkComparisonRow): string => {
        return entry.oid;
      }),
    ).toEqual([SYS_LOCATION]);
    expect(
      filterComparisonRows({
        rows: rows,
        views: views,
        query: "   ",
        onlyMissingOnSome: false,
      }),
    ).toHaveLength(2);
  });

  test("a filter's words are text, never a pattern", () => {
    expect(
      filterComparisonRows({
        rows: rows,
        views: views,
        query: ".*",
        onlyMissingOnSome: false,
      }),
    ).toEqual([]);
  });

  test("searches at most twenty of an OID's values", () => {
    const many: Array<DeviceWalk> = [];

    for (let index: number = 0; index < 30; index++) {
      many.push(
        walked(`device-${index}`, {
          rows: [row(SYS_NAME, SnmpDataType.OctetString, `name-${index}`)],
        }),
      );
    }

    const view: SnmpWalkComparisonRowView = toComparisonRowView(
      compareDeviceWalks(many)[0]!,
      translator,
    );

    expect(view.searchText).toContain(
      `name-${MULTI_DEVICE_SNMP_WALK_MAX_SEARCHED_VALUES - 1}`,
    );
    expect(view.searchText).not.toContain(
      `name-${MULTI_DEVICE_SNMP_WALK_MAX_SEARCHED_VALUES}\n`,
    );
    expect(
      view.searchText.endsWith(
        `name-${MULTI_DEVICE_SNMP_WALK_MAX_SEARCHED_VALUES}`,
      ),
    ).toBe(false);
  });

  test("can show only the OIDs some device walked past without answering", () => {
    const partial: Array<SnmpWalkComparisonRow> = compareDeviceWalks([
      walked(DEVICE_A, {
        rows: [
          row(SYS_DESCR, SnmpDataType.OctetString, "x"),
          row(SYS_NAME, SnmpDataType.OctetString, "a"),
          row(SYS_LOCATION, SnmpDataType.OctetString, "here"),
        ],
      }),
      walked(DEVICE_B, {
        rows: [row(SYS_DESCR, SnmpDataType.OctetString, "x")],
      }),
      walked(DEVICE_C, {
        rows: [
          row(SYS_DESCR, SnmpDataType.OctetString, "x"),
          row(SYS_NAME, SnmpDataType.OctetString, "c"),
        ],
        stopReason: SnmpWalkStopReason.OidLimit,
        nextOid: SYS_NAME,
      }),
    ]);
    const partialViews: Map<string, SnmpWalkComparisonRowView> = new Map(
      partial.map((entry: SnmpWalkComparisonRow) => {
        return [entry.oid, toComparisonRowView(entry, translator)];
      }),
    );

    expect(
      filterComparisonRows({
        rows: partial,
        views: partialViews,
        query: "",
        onlyMissingOnSome: true,
      }).map((entry: SnmpWalkComparisonRow): string => {
        return entry.oid;
      }),
    ).toEqual([SYS_NAME, SYS_LOCATION]);
    expect(
      filterComparisonRows({
        rows: partial,
        views: partialViews,
        query: "sysName",
        onlyMissingOnSome: true,
      }).map((entry: SnmpWalkComparisonRow): string => {
        return entry.oid;
      }),
    ).toEqual([SYS_NAME]);
  });
});

describe("who Collect writes to", () => {
  const CPU: string = "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1";
  const cpuRow: SnmpWalkComparisonRow = compareDeviceWalks([
    walked(DEVICE_A, { rows: [row(CPU, SnmpDataType.Gauge32, 7)] }),
    walked(DEVICE_B, { rows: [row(CPU, SnmpDataType.Gauge32, 9)] }),
    walked(DEVICE_C, { rows: [row(CPU, SnmpDataType.Gauge32, 11)] }),
    walked(DEVICE_D, { rows: [row(CPU, SnmpDataType.Gauge32, 13)] }),
  ])[0]!;

  const oid: SnmpOid = { oid: CPU, name: "CPU" };

  test("knows what each device collects: its template's, its own, and what this page just added", () => {
    const collected: Map<string, Set<string>> = getCollectedOidsByDevice({
      devices: [
        device(DEVICE_A, { snmpOids: [oid] }),
        device(DEVICE_B, {
          templateId: "t1",
          templateOids: [{ oid: `.${CPU}` }],
        }),
        device(DEVICE_C),
      ],
      justCollected: new Map([[DEVICE_C, new Set([CPU])]]),
    });

    expect(collected.get(DEVICE_A)?.has(CPU)).toBe(true);
    expect(collected.get(DEVICE_B)?.has(CPU)).toBe(true);
    expect(collected.get(DEVICE_C)?.has(CPU)).toBe(true);
  });

  test("adds to every probe-polled device that answers and does not collect it yet", () => {
    const devicesById: Map<string, MultiDeviceSnmpWalkDevice> = new Map([
      [DEVICE_A, device(DEVICE_A, { snmpOids: [oid] })],
      [DEVICE_B, device(DEVICE_B)],
      // A monitor-backed device is never polled: an OID on it collects nothing.
      [DEVICE_C, device(DEVICE_C, { isProbePolled: false })],
      [DEVICE_D, device(DEVICE_D)],
    ]);

    const state: ComparisonCollectState = getComparisonCollectState({
      row: cpuRow,
      devicesById: devicesById,
      collectedOidsByDevice: getCollectedOidsByDevice({
        devices: Array.from(devicesById.values()),
      }),
    });

    expect(state.collectedDeviceIds).toEqual([DEVICE_A]);
    expect(state.collectableDeviceIds).toEqual([DEVICE_B, DEVICE_D]);
    expect(state.templates).toEqual([]);
  });

  test("offers each template the devices that would collect it are linked to, once", () => {
    const devicesById: Map<string, MultiDeviceSnmpWalkDevice> = new Map([
      [
        DEVICE_A,
        device(DEVICE_A, {
          templateId: "t-core",
          templateName: "Core routers",
        }),
      ],
      [
        DEVICE_B,
        device(DEVICE_B, {
          templateId: "t-core",
          templateName: "Core routers",
        }),
      ],
      [
        DEVICE_C,
        device(DEVICE_C, { templateId: "t-edge", templateName: "Edge" }),
      ],
      [DEVICE_D, device(DEVICE_D)],
    ]);

    const state: ComparisonCollectState = getComparisonCollectState({
      row: cpuRow,
      devicesById: devicesById,
      collectedOidsByDevice: getCollectedOidsByDevice({
        devices: Array.from(devicesById.values()),
      }),
    });

    expect(state.collectableDeviceIds).toEqual([
      DEVICE_A,
      DEVICE_B,
      DEVICE_C,
      DEVICE_D,
    ]);
    expect(state.templates).toEqual([
      {
        templateId: "t-core",
        templateName: "Core routers",
        deviceIds: [DEVICE_A, DEVICE_B],
      },
      { templateId: "t-edge", templateName: "Edge", deviceIds: [DEVICE_C] },
    ]);
  });

  test("a template that already collects it is not offered, and a device the page cannot read is left alone", () => {
    const devicesById: Map<string, MultiDeviceSnmpWalkDevice> = new Map([
      [
        DEVICE_A,
        device(DEVICE_A, {
          templateId: "t-core",
          templateName: "Core routers",
          templateOids: [oid],
        }),
      ],
    ]);

    const state: ComparisonCollectState = getComparisonCollectState({
      row: cpuRow,
      devicesById: devicesById,
      collectedOidsByDevice: getCollectedOidsByDevice({
        devices: Array.from(devicesById.values()),
      }),
    });

    expect(state.collectedDeviceIds).toEqual([DEVICE_A]);
    expect(state.collectableDeviceIds).toEqual([]);
    expect(state.templates).toEqual([]);
  });
});

describe("the counts over the device list", () => {
  test("waiting, answered and failed add up to every device", () => {
    const counts: DeviceWalkCounts = countDeviceWalks([
      { deviceId: "1", status: DeviceWalkStatus.Asking },
      { deviceId: "2", status: DeviceWalkStatus.Walking },
      walked("3"),
      walked("4", {
        rows: [row(SYS_DESCR, SnmpDataType.OctetString, "x")],
        stopReason: SnmpWalkStopReason.Failed,
        failure: { kind: SnmpWalkFailureKind.Timeout, message: "t" },
      }),
      walked("5", {
        stopReason: SnmpWalkStopReason.Failed,
        failure: { kind: SnmpWalkFailureKind.Timeout, message: "t" },
      }),
      { deviceId: "6", status: DeviceWalkStatus.NotStarted },
      { deviceId: "7", status: DeviceWalkStatus.ProbeFailed },
      { deviceId: "8", status: DeviceWalkStatus.TimedOut },
    ]);

    expect(counts).toEqual({ total: 8, waiting: 2, answered: 2, failed: 4 });
  });

  test("walks that stopped at a limit are the ones with more to read", () => {
    expect(
      countWalksWithMoreToRead([
        walked("1", { stopReason: SnmpWalkStopReason.OidLimit }),
        walked("2", { stopReason: SnmpWalkStopReason.TimeLimit }),
        walked("3"),
        walked("4", {
          stopReason: SnmpWalkStopReason.Failed,
          rows: [row(SYS_DESCR, SnmpDataType.OctetString, "x")],
        }),
        { deviceId: "5", status: DeviceWalkStatus.Walking },
      ]),
    ).toBe(2);
  });

  test("the walk was read when its newest device walk was asked for", () => {
    expect(
      getWalkedAt([
        { ...walked("1"), createdAt: new Date("2026-11-03T10:00:00.000Z") },
        { ...walked("2"), createdAt: new Date("2026-11-03T10:00:04.000Z") },
        { deviceId: "3", status: DeviceWalkStatus.NotStarted },
      ]),
    ).toEqual(new Date("2026-11-03T10:00:04.000Z"));
    expect(getWalkedAt([])).toBeUndefined();
  });
});

describe("the sentences a device's line says", () => {
  test("while it walks", () => {
    for (const status of [DeviceWalkStatus.Asking, DeviceWalkStatus.Walking]) {
      const view: DeviceWalkView = describeDeviceWalk({
        walk: { deviceId: DEVICE_A, status: status },
        translator: translator,
      });

      expect(view.tone).toBe(DeviceWalkTone.Waiting);
      expect(view.title).toBe("Walking…");
    }
  });

  test("how many OIDs a complete walk read, in the plural the count takes", () => {
    expect(
      describeDeviceWalk({
        walk: walked(DEVICE_A, {
          rows: [row(SYS_DESCR, SnmpDataType.OctetString, "x")],
        }),
        translator: translator,
      }).title,
    ).toBe("1 OID");

    const view: DeviceWalkView = describeDeviceWalk({
      walk: walked(DEVICE_A, {
        rows: [
          row(SYS_DESCR, SnmpDataType.OctetString, "x"),
          row(SYS_NAME, SnmpDataType.OctetString, "y"),
        ],
      }),
      translator: translator,
    });

    expect(view).toEqual({
      tone: DeviceWalkTone.Success,
      title: "2 OIDs",
      isFixedInSettings: false,
      rowCount: 2,
    });
  });

  test("a walk that read to its limit has more to read", () => {
    expect(
      describeDeviceWalk({
        walk: walked(DEVICE_A, {
          rows: [row(SYS_DESCR, SnmpDataType.OctetString, "x")],
          stopReason: SnmpWalkStopReason.OidLimit,
          nextOid: SYS_DESCR,
        }),
        translator: translator,
      }).title,
    ).toBe("1 OID so far, more to read");
  });

  test("a device with nothing under the OID says so, and why that may be", () => {
    const view: DeviceWalkView = describeDeviceWalk({
      walk: walked(DEVICE_A),
      translator: translator,
    });

    expect(view.tone).toBe(DeviceWalkTone.Warning);
    expect(view.title).toBe("Nothing under this OID");
    expect(view.detail).toBe(
      "The device may not implement it, or the SNMP view of its credentials may not include it.",
    );
    expect(view.rowCount).toBe(0);
  });

  test("a refused walk names what to fix, and that it is fixed in the device's Settings", () => {
    const view: DeviceWalkView = describeDeviceWalk({
      walk: walked(DEVICE_A, {
        stopReason: SnmpWalkStopReason.Failed,
        snmpVersion: "3",
        failure: {
          kind: SnmpWalkFailureKind.Authentication,
          authenticationReason: SnmpWalkAuthenticationReason.WrongDigest,
          message: "Wrong Digest",
        },
      }),
      translator: translator,
    });

    expect(view.tone).toBe(DeviceWalkTone.Error);
    expect(view.title).toBe("The device refused the credentials");
    expect(view.detail).toBe(
      "The authentication password or protocol does not match the device's.",
    );
    expect(view.isFixedInSettings).toBe(true);
  });

  test("a silent v2c device points at the community string", () => {
    const view: DeviceWalkView = describeDeviceWalk({
      walk: walked(DEVICE_A, {
        stopReason: SnmpWalkStopReason.Failed,
        failure: { kind: SnmpWalkFailureKind.Timeout, message: "timeout" },
      }),
      translator: translator,
    });

    expect(view.title).toBe("The device did not answer");
    expect(view.detail).toContain("community string");
    expect(view.isFixedInSettings).toBe(true);
  });

  test("a walk that stopped part of the way keeps what it read, and says why it stopped", () => {
    const view: DeviceWalkView = describeDeviceWalk({
      walk: walked(DEVICE_A, {
        rows: [
          row(SYS_DESCR, SnmpDataType.OctetString, "x"),
          row(SYS_NAME, SnmpDataType.OctetString, "y"),
        ],
        stopReason: SnmpWalkStopReason.Failed,
        failure: { kind: SnmpWalkFailureKind.Timeout, message: "timeout" },
        nextOid: SYS_NAME,
      }),
      translator: translator,
    });

    expect(view.tone).toBe(DeviceWalkTone.Warning);
    expect(view.title).toBe("2 OIDs before the walk stopped");
    expect(view.detail).toBe("The device stopped answering");
    expect(view.rowCount).toBe(2);
  });

  test("a walk the server refused says the server's reason, and Settings when that is where it is fixed", () => {
    const noCredentials: DeviceWalkView = describeDeviceWalk({
      walk: {
        deviceId: DEVICE_A,
        status: DeviceWalkStatus.NotStarted,
        message: SNMP_WALK_NO_CREDENTIALS_MESSAGE,
      },
      translator: translator,
    });

    expect(noCredentials.title).toBe("Not walked");
    expect(noCredentials.detail).toBe(SNMP_WALK_NO_CREDENTIALS_MESSAGE);
    expect(noCredentials.isFixedInSettings).toBe(true);

    const noProbe: DeviceWalkView = describeDeviceWalk({
      walk: {
        deviceId: DEVICE_A,
        status: DeviceWalkStatus.NotStarted,
        message: MULTI_DEVICE_SNMP_WALK_NO_PROBE_MESSAGE,
      },
      translator: translator,
    });

    expect(noProbe.isFixedInSettings).toBe(true);

    const running: DeviceWalkView = describeDeviceWalk({
      walk: {
        deviceId: DEVICE_A,
        status: DeviceWalkStatus.NotStarted,
        message: SNMP_WALK_ALREADY_RUNNING_MESSAGE,
      },
      translator: translator,
    });

    expect(running.detail).toBe(SNMP_WALK_ALREADY_RUNNING_MESSAGE);
    expect(running.isFixedInSettings).toBe(false);
  });

  test("a walk the probe could not run, or never reported, names the probe", () => {
    expect(
      describeDeviceWalk({
        walk: {
          deviceId: DEVICE_A,
          status: DeviceWalkStatus.ProbeFailed,
          message: SNMP_WALK_PROBE_UPGRADE_MESSAGE,
        },
        translator: translator,
      }),
    ).toEqual({
      tone: DeviceWalkTone.Error,
      title: "The probe could not run this walk.",
      detail: SNMP_WALK_PROBE_UPGRADE_MESSAGE,
      isFixedInSettings: false,
      rowCount: 0,
    });

    const timedOut: DeviceWalkView = describeDeviceWalk({
      walk: { deviceId: DEVICE_A, status: DeviceWalkStatus.TimedOut },
      probeName: "Rack 3",
      translator: translator,
    });

    expect(timedOut.title).toBe("No answer from the probe");
    expect(timedOut.detail).toBe(
      'The probe "Rack 3" did not report the walk within five minutes. Check that the probe is online and runs a version that can walk SNMP.',
    );
  });

  test("the five minutes the timeout sentence says are the page's wait", () => {
    expect(MULTI_DEVICE_SNMP_WALK_WAIT_IN_MS).toBe(5 * 60 * 1000);
    expect(describeMultiDeviceSnmpWalkTimeout(undefined, translator)).toBe(
      "The device's probe did not report the walk within five minutes. Check that the probe is online and runs a version that can walk SNMP.",
    );
  });
});

describe("the server's and probe's words, in the reader's language", () => {
  test("this page's server sentences are the server's own, word for word", () => {
    const service: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Common",
        "Server",
        "Services",
        "NetworkDeviceDiagnosticService.ts",
      ),
      "utf8",
    );

    for (const message of MULTI_DEVICE_SNMP_WALK_SERVER_MESSAGES) {
      expect(service).toContain(`"${message}"`);
    }
  });

  test("never repeats a sentence a device's own page already translates", () => {
    for (const message of MULTI_DEVICE_SNMP_WALK_SERVER_MESSAGES) {
      expect(SNMP_WALK_SERVER_MESSAGES).not.toContain(message);
    }
  });

  test("reads the walk's, the page's and this page's sentences in the reader's language, anything else as written", () => {
    const german: Translator = createTranslator(
      (text: string | undefined): string | undefined => {
        const words: Record<string, string> = {
          [SNMP_WALK_ALREADY_RUNNING_MESSAGE]:
            "Für dieses Gerät läuft bereits ein Walk.",
          "This device is archived. Restore it to run diagnostics.":
            "Dieses Gerät ist archiviert.",
          [MULTI_DEVICE_SNMP_WALK_NO_PROBE_MESSAGE]: "Kein Probe zugewiesen.",
          [MULTI_DEVICE_SNMP_WALK_GONE_MESSAGE]:
            "Dieser Walk existiert nicht mehr.",
        };

        return (text && words[text]) || text;
      },
      "de",
    );

    expect(
      translateMultiDeviceSnmpWalkMessage(
        SNMP_WALK_ALREADY_RUNNING_MESSAGE,
        german,
      ),
    ).toBe("Für dieses Gerät läuft bereits ein Walk.");
    expect(
      translateMultiDeviceSnmpWalkMessage(
        "This device is archived. Restore it to run diagnostics.",
        german,
      ),
    ).toBe("Dieses Gerät ist archiviert.");
    expect(
      translateMultiDeviceSnmpWalkMessage(
        MULTI_DEVICE_SNMP_WALK_NO_PROBE_MESSAGE,
        german,
      ),
    ).toBe("Kein Probe zugewiesen.");
    expect(
      translateMultiDeviceSnmpWalkMessage(
        MULTI_DEVICE_SNMP_WALK_GONE_MESSAGE,
        german,
      ),
    ).toBe("Dieser Walk existiert nicht mehr.");
    expect(
      translateMultiDeviceSnmpWalkMessage(
        "Permission denied: NetworkDevice",
        german,
      ),
    ).toBe("Permission denied: NetworkDevice");
  });
});

describe("the line over the results", () => {
  test("how many OIDs, under what", () => {
    const walks: Array<DeviceWalk> = [
      walked(DEVICE_A, {
        rootOid: "1.3.6.1.4.1.29671",
        rows: [row("1.3.6.1.4.1.29671.1.1.0", SnmpDataType.Integer, 1)],
      }),
    ];

    expect(
      describeMultiDeviceSnmpWalkSummary({
        rootOid: "1.3.6.1.4.1.29671",
        walks: walks,
        rows: compareDeviceWalks(walks),
        translator: translator,
      }),
    ).toBe("1 OID under 1.3.6.1.4.1.29671.");
  });

  test("nothing under the OID on any device that answered, and why that may be", () => {
    const walks: Array<DeviceWalk> = [walked(DEVICE_A), walked(DEVICE_B)];

    expect(
      describeMultiDeviceSnmpWalkSummary({
        rootOid: "1.3.6.1.4.1.9",
        walks: walks,
        rows: compareDeviceWalks(walks),
        translator: translator,
      }),
    ).toBe(
      "Nothing under 1.3.6.1.4.1.9 on any device that answered. They may not implement it, or the SNMP views of their credentials may not include it.",
    );
  });

  test("says nothing when no device answered: each device's line says why", () => {
    expect(
      describeMultiDeviceSnmpWalkSummary({
        rootOid: "1.3.6.1",
        walks: [
          { deviceId: DEVICE_A, status: DeviceWalkStatus.NotStarted },
          { deviceId: DEVICE_B, status: DeviceWalkStatus.Walking },
        ],
        rows: [],
        translator: translator,
      }),
    ).toBeUndefined();
  });
});

describe("asking a few at a time", () => {
  test("runs every item, never more at once than allowed", async () => {
    let running: number = 0;
    let mostAtOnce: number = 0;
    const done: Array<number> = [];

    await runWithConcurrency<number>({
      items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      concurrency: 5,
      step: async (item: number): Promise<void> => {
        running++;
        mostAtOnce = Math.max(mostAtOnce, running);
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, item % 3);
        });
        done.push(item);
        running--;
      },
    });

    expect(
      done.sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(mostAtOnce).toBe(5);
  });

  test("a step that throws fails only itself", async () => {
    const done: Array<string> = [];

    await runWithConcurrency<string>({
      items: ["a", "b", "c"],
      concurrency: 2,
      step: async (item: string): Promise<void> => {
        if (item === "a") {
          throw new Error("refused");
        }

        done.push(item);
      },
    });

    expect(done.sort()).toEqual(["b", "c"]);
  });

  test("nothing to do is done at once, and a concurrency below one still runs", async () => {
    await expect(
      runWithConcurrency<number>({
        items: [],
        concurrency: 5,
        step: async (): Promise<void> => {
          throw new Error("never called");
        },
      }),
    ).resolves.toBeUndefined();

    const done: Array<number> = [];

    await runWithConcurrency<number>({
      items: [1, 2],
      concurrency: 0,
      step: async (item: number): Promise<void> => {
        done.push(item);
      },
    });

    expect(done).toEqual([1, 2]);
  });
});

describe("the walk of many devices, saved as a CSV", () => {
  test("one row an OID, the device's name first, devices in the order picked", () => {
    const csv: string = buildMultiDeviceSnmpWalkCsv([
      {
        deviceName: "mx-amsterdam",
        rows: [
          row(SYS_DESCR, SnmpDataType.OctetString, "Meraki MX67"),
          row(SYS_UPTIME, SnmpDataType.TimeTicks, 104524500),
        ],
      },
      {
        deviceName: "mx-berlin",
        rows: [row(SYS_DESCR, SnmpDataType.OctetString, "Meraki MX68")],
      },
    ]);

    expect(MULTI_DEVICE_SNMP_WALK_CSV_COLUMNS).toEqual([
      "Device",
      ...SNMP_WALK_CSV_COLUMNS,
    ]);
    expect(csv.split("\r\n")).toEqual([
      "Device,OID,Name,MIB,Type,Value",
      "mx-amsterdam,1.3.6.1.2.1.1.1.0,sysDescr.0,SNMPv2-MIB,STRING,Meraki MX67",
      "mx-amsterdam,1.3.6.1.2.1.1.3.0,sysUpTime.0,SNMPv2-MIB,Timeticks,104524500",
      "mx-berlin,1.3.6.1.2.1.1.1.0,sysDescr.0,SNMPv2-MIB,STRING,Meraki MX68",
      "",
    ]);
  });

  test("a device's name or value is never read as a spreadsheet formula, and a comma stays in its field", () => {
    const csv: string = buildMultiDeviceSnmpWalkCsv([
      {
        deviceName: '=HYPERLINK("http://evil")',
        rows: [row(SYS_LOCATION, SnmpDataType.OctetString, "Rack 3, Row 2")],
      },
    ]);
    const line: string = csv.split("\r\n")[1]!;

    expect(line.startsWith("\"'=HYPERLINK")).toBe(true);
    expect(line).toContain('"Rack 3, Row 2"');
  });

  test("is saved with a byte order mark, as a CSV, named after the devices, the subtree and the time", () => {
    const file: SnmpWalkExportFile = buildMultiDeviceSnmpWalkExport({
      devices: [
        { deviceName: "a", rows: [] },
        { deviceName: "b", rows: [] },
      ],
      rootOid: ".1.3.6.1.4.1.29671",
      exportedAt: new Date("2026-11-03T12:00:00.000Z"),
    });

    expect(file.content.startsWith(CSV_BYTE_ORDER_MARK)).toBe(true);
    expect(file.mimeType).toBe("text/csv;charset=utf-8;");
    expect(file.filename).toBe(
      "2-devices-snmp-walk-1.3.6.1.4.1.29671-2026-11-03-12-00-00.csv",
    );
    expect(
      buildMultiDeviceSnmpWalkExport({
        devices: [{ deviceName: "a", rows: [] }],
        rootOid: "1.3.6.1",
        exportedAt: new Date("2026-11-03T12:00:00.000Z"),
      }).filename,
    ).toBe("1-device-snmp-walk-1.3.6.1-2026-11-03-12-00-00.csv");
  });
});
