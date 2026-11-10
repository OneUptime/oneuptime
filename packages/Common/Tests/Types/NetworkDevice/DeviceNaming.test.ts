import {
  DeviceNamingOutcome,
  DeviceNamingPlanItem,
  getInitialPlanSelection,
  getRenamesForPlanItems,
  isDeviceNamingOutcome,
  isNamingLookupKey,
  readDeviceNamingApplyResult,
  readDeviceNamingPlan,
  readDeviceNamingPreview,
  readDeviceNamingResult,
} from "../../../Types/NetworkDevice/DeviceNaming";
import { describe, expect, test } from "@jest/globals";

/*
 * The naming rules' shared shapes (OneUptime issue #6619): the Dashboard
 * reads every answer of the naming API through these readers, so an answer
 * from a newer server - an outcome this build does not know, a missing
 * field - is read as what it can be and never drawn as something it is not;
 * and the Apply dialog's selection rules - which devices start ticked, and
 * what a confirm sends - are the ones pinned here.
 */

function planItem(
  overrides: Partial<DeviceNamingPlanItem>,
): DeviceNamingPlanItem {
  return {
    deviceId: "device-1",
    currentName: "dmb-5",
    isNamedByPerson: false,
    outcome: DeviceNamingOutcome.Named,
    name: "UN1216DRTPLR02",
    ...overrides,
  };
}

describe("guards", () => {
  test("outcomes and lookup keys", () => {
    expect(isDeviceNamingOutcome("Named")).toBe(true);
    expect(isDeviceNamingOutcome("Renamed")).toBe(false);
    expect(isDeviceNamingOutcome(undefined)).toBe(false);
    expect(isNamingLookupKey("lastIpOctet")).toBe(true);
    expect(isNamingLookupKey("serialNumber")).toBe(false);
  });
});

describe("reading the server's answers", () => {
  test("a result keeps the fields it has, and drops an unknown outcome", () => {
    expect(
      readDeviceNamingResult({
        outcome: "NameTaken",
        name: "UN1216MNUPLR01",
        takenName: "un1216mnuplr01",
        ruleId: "rule-1",
        ruleName: "",
        extra: true,
      }),
    ).toEqual({
      outcome: DeviceNamingOutcome.NameTaken,
      name: "UN1216MNUPLR01",
      takenName: "un1216mnuplr01",
      ruleId: "rule-1",
    });
    expect(readDeviceNamingResult({ outcome: "SomethingNew" })).toBeNull();
    expect(readDeviceNamingResult("Named")).toBeNull();
  });

  test("a preview: items without a key or with an unknown outcome are dropped", () => {
    expect(
      readDeviceNamingPreview({
        hasRules: true,
        items: [
          {
            key: "10.48.145.51",
            discoveredName: "dmb-1",
            outcome: "Named",
            name: "UN1216MNUPLR01",
          },
          { key: "10.48.145.52", outcome: "Unknown" },
          { outcome: "Named", name: "X" },
          null,
        ],
      }),
    ).toEqual({
      hasRules: true,
      items: [
        {
          key: "10.48.145.51",
          discoveredName: "dmb-1",
          outcome: DeviceNamingOutcome.Named,
          name: "UN1216MNUPLR01",
        },
      ],
    });
    expect(readDeviceNamingPreview(undefined)).toEqual({
      hasRules: false,
      items: [],
    });
  });

  test("a plan: counts that are not counts read as zero", () => {
    expect(
      readDeviceNamingPlan({
        hasRules: true,
        devicesChecked: 12.7,
        followingCount: -3,
        isTruncated: "yes",
        items: [
          {
            deviceId: "device-1",
            currentName: "dmb-5",
            isNamedByPerson: true,
            outcome: "Named",
            name: "UN1216DRTPLR02",
          },
          { deviceId: "device-2", outcome: "Nope" },
        ],
      }),
    ).toEqual({
      hasRules: true,
      devicesChecked: 12,
      followingCount: 0,
      isTruncated: false,
      items: [
        {
          deviceId: "device-1",
          currentName: "dmb-5",
          isNamedByPerson: true,
          outcome: DeviceNamingOutcome.Named,
          name: "UN1216DRTPLR02",
        },
      ],
    });
  });

  test("an apply's result", () => {
    expect(
      readDeviceNamingApplyResult({
        renamed: 3,
        skipped: [
          { deviceId: "device-2", reason: "renamed meanwhile" },
          { reason: "no device" },
        ],
      }),
    ).toEqual({
      renamed: 3,
      skipped: [{ deviceId: "device-2", reason: "renamed meanwhile" }],
    });
    expect(readDeviceNamingApplyResult(null)).toEqual({
      renamed: 0,
      skipped: [],
    });
  });
});

describe("the Apply dialog's selection", () => {
  const items: Array<DeviceNamingPlanItem> = [
    planItem({ deviceId: "by-discovery" }),
    planItem({ deviceId: "by-person", isNamedByPerson: true }),
    planItem({
      deviceId: "no-site",
      outcome: DeviceNamingOutcome.MissingValue,
      name: undefined,
    }),
  ];

  test("ticked at first: what the rules rename, but not what a person named", () => {
    expect([...getInitialPlanSelection(items)]).toEqual(["by-discovery"]);
  });

  test("a confirm sends the ticked renames, each with the name seen and the name given", () => {
    expect(
      getRenamesForPlanItems(
        items,
        new Set<string>(["by-discovery", "by-person", "no-site"]),
      ),
    ).toEqual([
      {
        deviceId: "by-discovery",
        fromName: "dmb-5",
        toName: "UN1216DRTPLR02",
      },
      { deviceId: "by-person", fromName: "dmb-5", toName: "UN1216DRTPLR02" },
    ]);
    expect(getRenamesForPlanItems(items, new Set<string>())).toEqual([]);
  });
});
