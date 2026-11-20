import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import {
  ADDABLE_CONTROLLER_PRODUCT_TYPES,
  DEFAULT_CONTROLLER_PRODUCT_TYPES_TO_ADD,
  DEFAULT_NETWORK_CONTROLLER_DEVICE_ADD_REQUEST,
  DEVICE_ADD_REQUEST_GROUP_BY_SITE,
  DEVICE_ADD_REQUEST_NOT_AN_OBJECT,
  DEVICE_ADD_REQUEST_NO_KINDS,
  DEVICE_ADD_REQUEST_PROBE,
  DEVICE_ADD_REQUEST_UNKNOWN_KIND,
  MAX_DEVICE_ADD_FAILURE_NAMES_KEPT,
  MAX_DEVICE_ADD_FAILURE_REASONS_KEPT,
  MAX_DEVICE_ADD_FAILURE_TEXT_LENGTH,
  NETWORK_CONTROLLER_DEVICE_ADD_QUEUED_STALE_MS,
  NETWORK_CONTROLLER_DEVICE_ADD_STALE_MS,
  NetworkControllerDeviceAddFailureReason,
  NetworkControllerDeviceAddState,
  NetworkControllerDeviceAddStatus,
  NetworkControllerUnaddedDeviceCount,
  addNetworkControllerDeviceAddFailure,
  buildQueuedNetworkControllerDeviceAddState,
  getAddableControllerDeviceCount,
  getControllerProductTypesToOffer,
  getNetworkControllerDeviceAddFailureReasons,
  isAddableControllerProductType,
  isNetworkControllerDeviceAddUnderWay,
  readNetworkControllerDeviceAddRequest,
  readNetworkControllerDeviceAddState,
  readNetworkControllerUnaddedDeviceCounts,
  readStoredNetworkControllerDeviceAddRequest,
  toNetworkControllerDeviceAddStateJson,
} from "../../../Types/NetworkController/NetworkControllerDeviceAdd";
import { NETWORK_CONTROLLER_PRODUCT_TYPES } from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import { describe, expect, test } from "@jest/globals";

/*
 * The shapes Add devices is asked with, keeps on the connection and counts
 * on every read (Types/NetworkController/NetworkControllerDeviceAdd), read
 * without trusting them: the API refuses a request it cannot take with a
 * sentence, and a stored state or count that is not one reads as nothing.
 */

const USER_ID: string = "33333333-3333-4333-8333-333333333333";
const PROBE_ID: string = "44444444-4444-4444-8444-444444444444";
const NOW: Date = new Date("2026-11-03T10:00:00.000Z");

function refusalOf(value: unknown): string {
  try {
    readNetworkControllerDeviceAddRequest(value);
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("The request was not refused.");
}

describe("the kinds Add devices offers", () => {
  test("every kind is one Meraki names, a box on the network; sensors, Systems Manager and Secure Connect are not", () => {
    for (const productType of ADDABLE_CONTROLLER_PRODUCT_TYPES) {
      expect(NETWORK_CONTROLLER_PRODUCT_TYPES).toContain(productType);
    }

    expect(ADDABLE_CONTROLLER_PRODUCT_TYPES).not.toContain("sensor");
    expect(ADDABLE_CONTROLLER_PRODUCT_TYPES).not.toContain("systemsManager");
    expect(ADDABLE_CONTROLLER_PRODUCT_TYPES).not.toContain("secureConnect");
    expect(isAddableControllerProductType("sensor")).toBe(false);
    expect(isAddableControllerProductType(3)).toBe(false);
  });

  test("the network gear is ticked by default; cameras are picked on purpose", () => {
    expect(DEFAULT_CONTROLLER_PRODUCT_TYPES_TO_ADD).toEqual([
      "switch",
      "wireless",
      "appliance",
      "cellularGateway",
      "wirelessController",
      "campusGateway",
    ]);
    expect(DEFAULT_NETWORK_CONTROLLER_DEVICE_ADD_REQUEST).toEqual({
      productTypes: [...DEFAULT_CONTROLLER_PRODUCT_TYPES_TO_ADD],
      groupBySite: true,
    });
  });
});

describe("readNetworkControllerDeviceAddRequest: what a person asked for, checked", () => {
  test("the kinds come back once each, in the order they are listed; sites default to on", () => {
    expect(
      readNetworkControllerDeviceAddRequest({
        productTypes: ["camera", "switch", "camera", "wireless"],
      }),
    ).toEqual({
      productTypes: ["switch", "wireless", "camera"],
      groupBySite: true,
    });
  });

  test("sites off, and a probe, are kept", () => {
    expect(
      readNetworkControllerDeviceAddRequest({
        productTypes: ["switch"],
        groupBySite: false,
        probeId: ` ${PROBE_ID} `,
      }),
    ).toEqual({
      productTypes: ["switch"],
      groupBySite: false,
      probeId: PROBE_ID,
    });
  });

  test("no probe, an empty one or null: none", () => {
    for (const probeId of [undefined, null, ""]) {
      expect(
        readNetworkControllerDeviceAddRequest({
          productTypes: ["switch"],
          probeId,
        }).probeId,
      ).toBeUndefined();
    }
  });

  test("anything it cannot take is refused with a sentence, never quietly dropped", () => {
    expect(refusalOf(null)).toBe(DEVICE_ADD_REQUEST_NOT_AN_OBJECT);
    expect(refusalOf(["switch"])).toBe(DEVICE_ADD_REQUEST_NOT_AN_OBJECT);
    expect(refusalOf({})).toBe(DEVICE_ADD_REQUEST_NO_KINDS);
    expect(refusalOf({ productTypes: [] })).toBe(DEVICE_ADD_REQUEST_NO_KINDS);
    expect(refusalOf({ productTypes: "switch" })).toBe(
      DEVICE_ADD_REQUEST_NO_KINDS,
    );
    expect(refusalOf({ productTypes: ["switch", "sensor"] })).toBe(
      DEVICE_ADD_REQUEST_UNKNOWN_KIND,
    );
    expect(refusalOf({ productTypes: ["switch"], groupBySite: "yes" })).toBe(
      DEVICE_ADD_REQUEST_GROUP_BY_SITE,
    );
    expect(refusalOf({ productTypes: ["switch"], probeId: "probe-1" })).toBe(
      DEVICE_ADD_REQUEST_PROBE,
    );
    expect(refusalOf({ productTypes: ["switch"], probeId: 7 })).toBe(
      DEVICE_ADD_REQUEST_PROBE,
    );
  });

  test("a stored request that is not one any more reads as none", () => {
    expect(readStoredNetworkControllerDeviceAddRequest({})).toBeUndefined();
    expect(
      readStoredNetworkControllerDeviceAddRequest({ productTypes: ["switch"] }),
    ).toEqual({ productTypes: ["switch"], groupBySite: true });
  });
});

describe("the state an ask keeps on the connection", () => {
  function queued(): NetworkControllerDeviceAddState {
    return buildQueuedNetworkControllerDeviceAddState({
      request: {
        productTypes: ["switch", "wireless"],
        groupBySite: true,
        probeId: PROBE_ID,
      },
      requestedByUserId: USER_ID,
      now: NOW,
    });
  }

  test("a new ask is queued, with nothing found or added yet", () => {
    expect(queued()).toEqual({
      status: NetworkControllerDeviceAddStatus.Queued,
      request: {
        productTypes: ["switch", "wireless"],
        groupBySite: true,
        probeId: PROBE_ID,
      },
      requestedAt: NOW.toISOString(),
      requestedByUserId: USER_ID,
      updatedAt: NOW.toISOString(),
      toAddCount: 0,
      addedCount: 0,
      failedCount: 0,
      createdSiteCount: 0,
      withoutAddressCount: 0,
      takenCount: 0,
      archivedCount: 0,
      remainingCount: 0,
      failureReasons: [],
    });
  });

  test("it is stored as JSON and read back the same, whole", () => {
    const state: NetworkControllerDeviceAddState = {
      ...queued(),
      status: NetworkControllerDeviceAddStatus.Done,
      startedAt: "2026-11-03T10:00:05.000Z",
      updatedAt: "2026-11-03T10:01:00.000Z",
      finishedAt: "2026-11-03T10:01:00.000Z",
      toAddCount: 12,
      addedCount: 11,
      failedCount: 1,
      createdSiteCount: 3,
      withoutAddressCount: 4,
      takenCount: 2,
      archivedCount: 1,
      remainingCount: 0,
      failureReasons: [
        {
          reason: "Another network device has this name.",
          count: 1,
          names: ["AP-1"],
        },
      ],
    };

    const json: JSONObject = JSON.parse(
      JSON.stringify(toNetworkControllerDeviceAddStateJson(state)),
    ) as JSONObject;

    expect(readNetworkControllerDeviceAddState(json)).toEqual(state);
  });

  test("a failed ask keeps why", () => {
    const state: NetworkControllerDeviceAddState = {
      ...queued(),
      status: NetworkControllerDeviceAddStatus.Failed,
      finishedAt: NOW.toISOString(),
      message: "Meraki did not accept the API key.",
    };

    expect(
      readNetworkControllerDeviceAddState(
        toNetworkControllerDeviceAddStateJson(state),
      )?.message,
    ).toBe("Meraki did not accept the API key.");
  });

  test("what is not a state reads as none: no status, a status it does not know, no request, no time, no person", () => {
    const json: JSONObject = toNetworkControllerDeviceAddStateJson(queued());

    expect(readNetworkControllerDeviceAddState(undefined)).toBeUndefined();
    expect(readNetworkControllerDeviceAddState("queued")).toBeUndefined();
    expect(
      readNetworkControllerDeviceAddState({ ...json, status: "paused" }),
    ).toBeUndefined();
    expect(
      readNetworkControllerDeviceAddState({ ...json, request: {} }),
    ).toBeUndefined();
    expect(
      readNetworkControllerDeviceAddState({ ...json, requestedAt: "soon" }),
    ).toBeUndefined();
    expect(
      readNetworkControllerDeviceAddState({
        ...json,
        requestedByUserId: "someone",
      }),
    ).toBeUndefined();
  });

  test("counts that are not counts read as none, and reasons are kept short and few", () => {
    const json: JSONObject = {
      ...toNetworkControllerDeviceAddStateJson(queued()),
      addedCount: -4,
      takenCount: "many",
      remainingCount: 2.9,
      failedCount: 30,
      failureReasons: [
        ...Array.from({ length: 30 }, (_: unknown, index: number) => {
          return {
            reason: `${index} ${"x".repeat(1000)}`,
            count: 1,
            names: Array.from({ length: 10 }, (__: unknown, n: number) => {
              return `Device ${index}.${n} ${"y".repeat(1000)}`;
            }),
          };
        }),
      ],
    };

    const state: NetworkControllerDeviceAddState | undefined =
      readNetworkControllerDeviceAddState(json);

    expect(state?.addedCount).toBe(0);
    expect(state?.takenCount).toBe(0);
    expect(state?.remainingCount).toBe(2);
    expect(state?.failureReasons).toHaveLength(
      MAX_DEVICE_ADD_FAILURE_REASONS_KEPT,
    );
    expect(state?.failureReasons[0]?.reason).toHaveLength(
      MAX_DEVICE_ADD_FAILURE_TEXT_LENGTH,
    );
    expect(state?.failureReasons[0]?.names).toHaveLength(
      MAX_DEVICE_ADD_FAILURE_NAMES_KEPT,
    );
    expect(state?.failureReasons[0]?.names[0]).toHaveLength(
      MAX_DEVICE_ADD_FAILURE_TEXT_LENGTH,
    );
  });

  test("a reason with no words, no count, or kept already is dropped; names that are not names too", () => {
    expect(
      readNetworkControllerDeviceAddState({
        ...toNetworkControllerDeviceAddStateJson(queued()),
        failureReasons: [
          {},
          { reason: "   ", count: 3 },
          { reason: "No count." },
          { reason: "Kept.", count: 2, names: ["AP-1", 7, "", null, "AP-2"] },
          { reason: "Kept.", count: 9 },
          "broken",
        ],
      })?.failureReasons,
    ).toEqual([{ reason: "Kept.", count: 2, names: ["AP-1", "AP-2"] }]);
  });

  test("an ask an earlier OneUptime recorded - one failure a device - is read as its reasons", () => {
    const reasons: Array<NetworkControllerDeviceAddFailureReason> | undefined =
      readNetworkControllerDeviceAddState({
        ...toNetworkControllerDeviceAddStateJson(queued()),
        failedCount: 5000,
        failureReasons: undefined,
        failures: [
          { name: "Core", reason: "Refused for its serial number." },
          { name: "Lobby", reason: "Refused for its serial number." },
          { name: "Till", reason: "Another network device has this name." },
          { name: "Back office", reason: "Refused for its serial number." },
          { name: "AP-9", reason: "Refused for its serial number." },
          {},
          { name: "No reason" },
          "broken",
        ],
      })?.failureReasons;

    expect(reasons).toEqual([
      {
        reason: "Refused for its serial number.",
        count: 4,
        names: ["Core", "Lobby", "Back office"],
      },
      {
        reason: "Another network device has this name.",
        count: 1,
        names: ["Till"],
      },
    ]);
  });
});

describe("the reasons devices could not be added: one entry a reason, with how many and which", () => {
  test("a device is counted under its reason, the first few by name", () => {
    const reasons: Array<NetworkControllerDeviceAddFailureReason> = [];

    for (let index: number = 1; index <= 5000; index++) {
      addNetworkControllerDeviceAddFailure(reasons, {
        name: `AP-${index}`,
        reason:
          "User is not allowed to create on serialNumber column of Network Device.",
      });
    }

    expect(reasons).toEqual([
      {
        reason:
          "User is not allowed to create on serialNumber column of Network Device.",
        count: 5000,
        names: ["AP-1", "AP-2", "AP-3"],
      },
    ]);
  });

  test("a reason past the few kept is counted in failedCount only, and said as other reasons", () => {
    const reasons: Array<NetworkControllerDeviceAddFailureReason> = [];

    for (
      let index: number = 0;
      index < MAX_DEVICE_ADD_FAILURE_REASONS_KEPT + 3;
      index++
    ) {
      addNetworkControllerDeviceAddFailure(reasons, {
        name: `Device ${index}`,
        reason: `Reason ${index}.`,
      });
    }

    expect(reasons).toHaveLength(MAX_DEVICE_ADD_FAILURE_REASONS_KEPT);
    expect(
      getNetworkControllerDeviceAddFailureReasons({
        failureReasons: reasons,
        failedCount: MAX_DEVICE_ADD_FAILURE_REASONS_KEPT + 3,
      }).otherCount,
    ).toBe(3);
  });

  test("a device with no name is counted, and named by nothing", () => {
    const reasons: Array<NetworkControllerDeviceAddFailureReason> = [];

    addNetworkControllerDeviceAddFailure(reasons, { name: "", reason: "Why." });
    addNetworkControllerDeviceAddFailure(reasons, { name: "", reason: "Why." });

    expect(reasons).toEqual([{ reason: "Why.", count: 2, names: [] }]);
  });

  test("the reason that kept out the most comes first; among equals, the one met first", () => {
    const reasons: Array<NetworkControllerDeviceAddFailureReason> = [
      { reason: "Rare.", count: 1, names: ["A"] },
      { reason: "Common.", count: 40, names: ["B"] },
      { reason: "Also rare.", count: 1, names: ["C"] },
    ];

    expect(
      getNetworkControllerDeviceAddFailureReasons({
        failureReasons: reasons,
        failedCount: 42,
      }),
    ).toEqual({
      reasons: [
        { reason: "Common.", count: 40, names: ["B"] },
        { reason: "Rare.", count: 1, names: ["A"] },
        { reason: "Also rare.", count: 1, names: ["C"] },
      ],
      otherCount: 0,
    });
    // The state's own list is left as it was.
    expect(reasons[0]!.reason).toBe("Rare.");
  });
});

describe("isNetworkControllerDeviceAddUnderWay: an ask still going, never a lost one", () => {
  const base: NetworkControllerDeviceAddState =
    buildQueuedNetworkControllerDeviceAddState({
      request: { productTypes: ["switch"], groupBySite: true },
      requestedByUserId: USER_ID,
      now: NOW,
    });

  test("queued, lately", () => {
    expect(isNetworkControllerDeviceAddUnderWay(base, NOW)).toBe(true);
    expect(
      isNetworkControllerDeviceAddUnderWay(
        base,
        new Date(NOW.getTime() + NETWORK_CONTROLLER_DEVICE_ADD_QUEUED_STALE_MS),
      ),
    ).toBe(false);
  });

  test("adding, while its worker writes", () => {
    const adding: NetworkControllerDeviceAddState = {
      ...base,
      status: NetworkControllerDeviceAddStatus.Adding,
      updatedAt: new Date(NOW.getTime() + 60 * 1000).toISOString(),
    };

    expect(
      isNetworkControllerDeviceAddUnderWay(
        adding,
        new Date(NOW.getTime() + 2 * 60 * 1000),
      ),
    ).toBe(true);
    expect(
      isNetworkControllerDeviceAddUnderWay(
        adding,
        new Date(
          NOW.getTime() + 60 * 1000 + NETWORK_CONTROLLER_DEVICE_ADD_STALE_MS,
        ),
      ),
    ).toBe(false);
  });

  test("done, failed or never asked: not under way", () => {
    expect(isNetworkControllerDeviceAddUnderWay(undefined, NOW)).toBe(false);
    expect(
      isNetworkControllerDeviceAddUnderWay(
        { ...base, status: NetworkControllerDeviceAddStatus.Done },
        NOW,
      ),
    ).toBe(false);
    expect(
      isNetworkControllerDeviceAddUnderWay(
        { ...base, status: NetworkControllerDeviceAddStatus.Failed },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("the counts every read keeps", () => {
  const counts: Array<NetworkControllerUnaddedDeviceCount> = [
    {
      productType: "switch",
      addable: 4,
      withoutAddress: 0,
      taken: 1,
      archived: 0,
    },
    {
      productType: "appliance",
      addable: 0,
      withoutAddress: 3,
      taken: 0,
      archived: 0,
    },
    {
      productType: "camera",
      addable: 7,
      withoutAddress: 0,
      taken: 0,
      archived: 2,
    },
  ];

  test("read back in the order the kinds are listed, known kinds only, once each, rows with nothing dropped", () => {
    expect(
      readNetworkControllerUnaddedDeviceCounts([
        counts[2],
        { productType: "sensor", addable: 9 },
        counts[0],
        { ...counts[0], addable: 99 },
        { productType: "wireless", addable: 0 },
        "switch",
        counts[1],
      ]),
    ).toEqual(counts);
  });

  test("what is not a list is none, and a count that is not one is 0", () => {
    expect(readNetworkControllerUnaddedDeviceCounts(undefined)).toEqual([]);
    expect(readNetworkControllerUnaddedDeviceCounts({})).toEqual([]);
    expect(
      readNetworkControllerUnaddedDeviceCounts([
        { productType: "switch", addable: "4", taken: -1, archived: 1.5 },
      ]),
    ).toEqual([
      {
        productType: "switch",
        addable: 4,
        withoutAddress: 0,
        taken: 0,
        archived: 1,
      },
    ]);
  });

  test("what Add devices would add of the kinds given", () => {
    expect(getAddableControllerDeviceCount(counts, ["switch"])).toBe(4);
    expect(getAddableControllerDeviceCount(counts, ["switch", "camera"])).toBe(
      11,
    );
    expect(getAddableControllerDeviceCount(counts, ["wireless"])).toBe(0);
  });

  test("the kinds a next ask starts with: the last ask's, else the defaults", () => {
    expect(getControllerProductTypesToOffer(undefined)).toEqual([
      ...DEFAULT_CONTROLLER_PRODUCT_TYPES_TO_ADD,
    ]);
    expect(
      getControllerProductTypesToOffer(
        buildQueuedNetworkControllerDeviceAddState({
          request: { productTypes: ["camera"], groupBySite: false },
          requestedByUserId: USER_ID,
          now: NOW,
        }),
      ),
    ).toEqual(["camera"]);
  });
});
