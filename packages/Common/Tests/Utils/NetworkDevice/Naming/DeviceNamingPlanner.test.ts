import {
  DeviceNamingOutcome,
  DeviceNamingResult,
  NamingLookupEntry,
  NamingLookupKey,
  isDeviceNamedByPerson,
  isDeviceStillNamedByRule,
} from "../../../../Types/NetworkDevice/DeviceNaming";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../../Types/Rules/RuleCriteria";
import { MAX_DEVICE_NAME_LENGTH } from "../../../../Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import {
  DeviceNameRegistry,
  DeviceNamingSession,
  DeviceNamingSubject,
  NamingRuleCandidate,
  PreparedNamingRule,
  compareNamingRules,
  planDeviceNames,
  prepareNamingRules,
} from "../../../../Utils/NetworkDevice/Naming/DeviceNamingPlanner";
import { DeviceNamingFacts } from "../../../../Utils/NetworkDevice/Naming/NamingRuleMatcher";
import { seededRandom, SeededRandom } from "../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * What the naming rules call each device (OneUptime issue #6619): the one
 * planner behind the import's preview, the import itself and the rules
 * applied to existing devices. It renames real devices in bulk, so each
 * rule here guards a way of naming something nobody asked for: the wrong
 * rule winning, two devices sharing a name, a site's switches renumbered,
 * a name made up from half a pattern.
 */

const UNIT_1216: string = "8d0a8b5e-0d2a-4d4e-9f2b-1a2b3c4d1216";
const UNIT_1188: string = "8d0a8b5e-0d2a-4d4e-9f2b-1a2b3c4d1188";

// The reporter's DMB table (their screenshot), keyed by the last part of the address.
const DMB_TABLE: Array<NamingLookupEntry> = [
  { key: "51", value: "MNUPLR01" },
  { key: "151", value: "MNUSCR01" },
  { key: "152", value: "MNUSCR02" },
  { key: "153", value: "MNUSCR03" },
  { key: "150", value: "POPSCR01" },
  { key: "154", value: "DRTSCR01" },
  { key: "155", value: "DRTSCR02" },
  { key: "156", value: "DRTSCR03" },
  { key: "157", value: "DRTSCR04" },
  { key: "158", value: "DRTSCR05" },
  { key: "159", value: "DRTSCR06" },
  { key: "54", value: "DRTPLR01" },
  { key: "55", value: "DRTPLR02" },
  { key: "56", value: "DRTPLR03" },
  { key: "57", value: "DRTPLR04" },
  { key: "58", value: "DRTPLR05" },
  { key: "59", value: "DRTPLR06" },
];

function rule(overrides: Partial<NamingRuleCandidate>): NamingRuleCandidate {
  return {
    _id: overrides._id || `rule-${String(overrides.name || "x")}`,
    name: "Rule",
    priority: 0,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    isEnabled: true,
    namePattern: "{discoveredName}",
    ...overrides,
  };
}

function unitDevice(data: {
  unit: string;
  site: string;
  lastOctet: number;
  discoveredName?: string;
  vendor?: string;
}): DeviceNamingFacts {
  const subnet: string = data.unit === "1216" ? "10.48.145" : "10.64.137";

  return {
    ipAddress: `${subnet}.${data.lastOctet}`,
    discoveredName: data.discoveredName || `${subnet}.${data.lastOctet}`,
    vendor: data.vendor,
    siteId: data.site,
    siteIds: [data.site],
    siteName: `Unit ${data.unit}`,
    siteCode: data.unit,
  };
}

function plan(data: {
  rules: Array<NamingRuleCandidate>;
  subjects: Array<DeviceNamingSubject>;
  names?: Array<{ name: string; deviceId?: string }>;
}): Map<string, DeviceNamingResult> {
  return planDeviceNames({
    rules: prepareNamingRules(data.rules),
    subjects: data.subjects,
    registry: new DeviceNameRegistry(data.names || []),
  });
}

function nameOf(results: Map<string, DeviceNamingResult>, key: string): string {
  return results.get(key)?.name || "";
}

const DMB_RULE: NamingRuleCandidate = rule({
  _id: "rule-dmb",
  name: "WB menu boards",
  namePattern: "UN{site.code}{lookup}",
  lookupKey: NamingLookupKey.LastIpOctet,
  lookupEntries: DMB_TABLE,
});

describe("the reporter's DMB convention, end to end", () => {
  test("names all seventeen menu-board devices of every unit from one rule", () => {
    const subjects: Array<DeviceNamingSubject> = [];

    for (const unit of [
      { code: "1216", site: UNIT_1216 },
      { code: "1188", site: UNIT_1188 },
    ]) {
      for (const entry of DMB_TABLE) {
        subjects.push({
          key: `${unit.code}-${entry.key}`,
          facts: unitDevice({
            unit: unit.code,
            site: unit.site,
            lastOctet: parseInt(entry.key, 10),
          }),
        });
      }
    }

    const results: Map<string, DeviceNamingResult> = plan({
      rules: [DMB_RULE],
      subjects: subjects,
    });

    for (const unit of ["1216", "1188"]) {
      for (const entry of DMB_TABLE) {
        expect(results.get(`${unit}-${entry.key}`)).toEqual({
          outcome: DeviceNamingOutcome.Named,
          name: `UN${unit}${entry.value}`,
          ruleId: "rule-dmb",
          ruleName: "WB menu boards",
        });
      }
    }
  });

  test("a device at an address the table does not list falls to the next rule, or keeps its name", () => {
    const switchRule: NamingRuleCandidate = rule({
      _id: "rule-switch",
      name: "Switches",
      priority: -1,
      namePattern: "UN{site.code}LANSWI{nn}",
      criteria: {
        schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
        filterCondition: FilterCondition.All,
        filters: [
          {
            field: "vendorPattern",
            operator: RuleCriteriaOperator.Contains,
            value: "cisco",
          },
        ],
      },
    });

    const results: Map<string, DeviceNamingResult> = plan({
      rules: [DMB_RULE, switchRule],
      subjects: [
        {
          key: "switch",
          facts: unitDevice({
            unit: "1216",
            site: UNIT_1216,
            lastOctet: 2,
            vendor: "Cisco Systems",
          }),
        },
        {
          key: "printer",
          facts: unitDevice({
            unit: "1216",
            site: UNIT_1216,
            lastOctet: 40,
            vendor: "HP",
          }),
        },
      ],
    });

    expect(results.get("switch")).toEqual({
      outcome: DeviceNamingOutcome.Named,
      name: "UN1216LANSWI01",
      ruleId: "rule-switch",
      ruleName: "Switches",
    });
    // The DMB rule matched but had no row for .40: said, with the rule.
    expect(results.get("printer")).toEqual({
      outcome: DeviceNamingOutcome.MissingValue,
      ruleId: "rule-dmb",
      ruleName: "WB menu boards",
      missing: "lookup",
    });
  });

  test("a device in no site, or a site without a code, is not named half-way", () => {
    const results: Map<string, DeviceNamingResult> = plan({
      rules: [DMB_RULE],
      subjects: [
        {
          key: "no-site",
          facts: { ipAddress: "10.48.145.51", discoveredName: "dmb-1" },
        },
        {
          key: "no-code",
          facts: {
            ...unitDevice({ unit: "1216", site: UNIT_1216, lastOctet: 51 }),
            siteCode: undefined,
          },
        },
      ],
    });

    for (const key of ["no-site", "no-code"]) {
      expect(results.get(key)).toEqual({
        outcome: DeviceNamingOutcome.MissingValue,
        ruleId: "rule-dmb",
        ruleName: "WB menu boards",
        missing: "site.code",
      });
    }
  });
});

describe("which rule names a device", () => {
  const facts: DeviceNamingFacts = unitDevice({
    unit: "1216",
    site: UNIT_1216,
    lastOctet: 51,
    discoveredName: "dmb-1",
  });

  test("the highest priority wins, then the oldest, then the id", () => {
    const results: Map<string, DeviceNamingResult> = plan({
      rules: [
        rule({ _id: "low", priority: 1, namePattern: "LOW-{ip.4}" }),
        rule({ _id: "high", priority: 5, namePattern: "HIGH-{ip.4}" }),
      ],
      subjects: [{ key: "d", facts: facts }],
    });

    expect(nameOf(results, "d")).toBe("HIGH-51");

    const tied: Map<string, DeviceNamingResult> = plan({
      rules: [
        rule({
          _id: "newer",
          createdAt: new Date("2026-11-02T00:00:00.000Z"),
          namePattern: "NEWER",
        }),
        rule({
          _id: "older",
          createdAt: new Date("2026-11-01T00:00:00.000Z"),
          namePattern: "OLDER",
        }),
      ],
      subjects: [{ key: "d", facts: facts }],
    });

    expect(nameOf(tied, "d")).toBe("OLDER");

    expect(
      compareNamingRules(
        rule({ _id: "b", createdAt: null }),
        rule({ _id: "a", createdAt: null }),
      ),
    ).toBeGreaterThan(0);
  });

  test("a disabled rule names nothing", () => {
    const results: Map<string, DeviceNamingResult> = plan({
      rules: [rule({ isEnabled: false, namePattern: "OFF" })],
      subjects: [{ key: "d", facts: facts }],
    });

    expect(results.get("d")).toEqual({
      outcome: DeviceNamingOutcome.NoMatchingRule,
    });
  });

  test("a rule whose stored pattern cannot be read names nothing, and the next rule does", () => {
    const prepared: Array<PreparedNamingRule> = prepareNamingRules([
      rule({ _id: "broken", priority: 9, namePattern: "UN{site.code" }),
      rule({ _id: "good", priority: 1, namePattern: "GOOD-{ip.4}" }),
    ]);

    expect(
      prepared.map((item: PreparedNamingRule) => {
        return item.id;
      }),
    ).toEqual(["good"]);
  });

  test("conditions decide: a rule for another site does not name the device", () => {
    const results: Map<string, DeviceNamingResult> = plan({
      rules: [
        rule({
          _id: "other-site",
          priority: 9,
          namePattern: "OTHER",
          sites: [{ _id: UNIT_1188 }],
        }),
        rule({ _id: "any", namePattern: "ANY-{ip.4}" }),
      ],
      subjects: [{ key: "d", facts: facts }],
    });

    expect(results.get("d")?.ruleId).toBe("any");
  });

  test("no rules at all: every device keeps its name", () => {
    expect(
      plan({ rules: [], subjects: [{ key: "d", facts: facts }] }).get("d"),
    ).toEqual({ outcome: DeviceNamingOutcome.NoMatchingRule });
  });
});

describe("names are unique in the project", () => {
  test("a name another device has is reported, with that device's spelling", () => {
    const results: Map<string, DeviceNamingResult> = plan({
      rules: [DMB_RULE],
      subjects: [
        {
          key: "d",
          facts: unitDevice({ unit: "1216", site: UNIT_1216, lastOctet: 51 }),
        },
      ],
      names: [{ name: "un1216mnuplr01", deviceId: "other" }],
    });

    expect(results.get("d")).toEqual({
      outcome: DeviceNamingOutcome.NameTaken,
      name: "UN1216MNUPLR01",
      takenName: "un1216mnuplr01",
      ruleId: "rule-dmb",
      ruleName: "WB menu boards",
    });
  });

  test("a taken name does not fall through to a broader rule", () => {
    const results: Map<string, DeviceNamingResult> = plan({
      rules: [DMB_RULE, rule({ _id: "broad", priority: -5, namePattern: "X-{ip}" })],
      subjects: [
        {
          key: "d",
          facts: unitDevice({ unit: "1216", site: UNIT_1216, lastOctet: 51 }),
        },
      ],
      names: [{ name: "UN1216MNUPLR01", deviceId: "other" }],
    });

    expect(results.get("d")?.outcome).toBe(DeviceNamingOutcome.NameTaken);
  });

  test("two devices planned together never get the same name", () => {
    const results: Map<string, DeviceNamingResult> = plan({
      rules: [rule({ namePattern: "UN{site.code}MNUPLR01" })],
      subjects: [
        {
          key: "first",
          facts: unitDevice({ unit: "1216", site: UNIT_1216, lastOctet: 51 }),
        },
        {
          key: "second",
          facts: unitDevice({ unit: "1216", site: UNIT_1216, lastOctet: 52 }),
        },
      ],
    });

    expect(results.get("first")?.outcome).toBe(DeviceNamingOutcome.Named);
    expect(results.get("second")).toMatchObject({
      outcome: DeviceNamingOutcome.NameTaken,
      takenName: "UN1216MNUPLR01",
    });
  });

  test("a device's own name is not taken for itself", () => {
    const results: Map<string, DeviceNamingResult> = plan({
      rules: [rule({ namePattern: "UN{site.code}MNUPLR01" })],
      subjects: [
        {
          key: "device-1",
          deviceId: "device-1",
          currentName: "un1216mnuplr01",
          facts: unitDevice({ unit: "1216", site: UNIT_1216, lastOctet: 51 }),
        },
      ],
      names: [{ name: "un1216mnuplr01", deviceId: "device-1" }],
    });

    // Only the case differs: renamed to the pattern's own spelling.
    expect(results.get("device-1")).toMatchObject({
      outcome: DeviceNamingOutcome.Named,
      name: "UN1216MNUPLR01",
    });
  });
});

describe("counters", () => {
  const switchRule: NamingRuleCandidate = rule({
    _id: "rule-switch",
    name: "Switches",
    namePattern: "UN{site.code}LANSWI{nn}",
  });

  function switchAt(unit: string, site: string, lastOctet: number): DeviceNamingFacts {
    return unitDevice({ unit: unit, site: site, lastOctet: lastOctet });
  }

  test("each device takes the lowest free number, per site", () => {
    const results: Map<string, DeviceNamingResult> = plan({
      rules: [switchRule],
      subjects: [
        { key: "a", facts: switchAt("1216", UNIT_1216, 2) },
        { key: "b", facts: switchAt("1216", UNIT_1216, 3) },
        { key: "c", facts: switchAt("1188", UNIT_1188, 2) },
        { key: "d", facts: switchAt("1216", UNIT_1216, 4) },
      ],
    });

    expect(nameOf(results, "a")).toBe("UN1216LANSWI01");
    expect(nameOf(results, "b")).toBe("UN1216LANSWI02");
    expect(nameOf(results, "c")).toBe("UN1188LANSWI01");
    expect(nameOf(results, "d")).toBe("UN1216LANSWI03");
  });

  test("numbers other devices already have are skipped, and gaps are filled", () => {
    const results: Map<string, DeviceNamingResult> = plan({
      rules: [switchRule],
      subjects: [
        { key: "a", facts: switchAt("1216", UNIT_1216, 2) },
        { key: "b", facts: switchAt("1216", UNIT_1216, 3) },
      ],
      names: [
        { name: "UN1216LANSWI01", deviceId: "x" },
        { name: "un1216lanswi03", deviceId: "y" },
      ],
    });

    expect(nameOf(results, "a")).toBe("UN1216LANSWI02");
    expect(nameOf(results, "b")).toBe("UN1216LANSWI04");
  });

  test("a device that already carries a number of the pattern keeps it", () => {
    const results: Map<string, DeviceNamingResult> = plan({
      rules: [switchRule],
      subjects: [
        {
          key: "existing",
          deviceId: "existing",
          currentName: "UN1216LANSWI03",
          facts: switchAt("1216", UNIT_1216, 2),
        },
        { key: "new", facts: switchAt("1216", UNIT_1216, 9) },
      ],
      names: [{ name: "UN1216LANSWI03", deviceId: "existing" }],
    });

    expect(results.get("existing")).toEqual({
      outcome: DeviceNamingOutcome.FollowsRules,
      name: "UN1216LANSWI03",
      ruleId: "rule-switch",
      ruleName: "Switches",
    });
    expect(nameOf(results, "new")).toBe("UN1216LANSWI01");
  });

  test("a device whose number is in another case is given the pattern's case, same number", () => {
    const results: Map<string, DeviceNamingResult> = plan({
      rules: [switchRule],
      subjects: [
        {
          key: "existing",
          deviceId: "existing",
          currentName: "un1216lanswi07",
          facts: switchAt("1216", UNIT_1216, 2),
        },
      ],
      names: [{ name: "un1216lanswi07", deviceId: "existing" }],
    });

    expect(results.get("existing")).toMatchObject({
      outcome: DeviceNamingOutcome.Named,
      name: "UN1216LANSWI07",
    });
  });

  test("a device in another site's numbers is renamed into its own site's", () => {
    const results: Map<string, DeviceNamingResult> = plan({
      rules: [switchRule],
      subjects: [
        {
          key: "moved",
          deviceId: "moved",
          currentName: "UN1188LANSWI01",
          facts: switchAt("1216", UNIT_1216, 2),
        },
      ],
      names: [{ name: "UN1188LANSWI01", deviceId: "moved" }],
    });

    expect(nameOf(results, "moved")).toBe("UN1216LANSWI01");
  });

  test("{n} counts past 9 without padding, {nnn} pads to three", () => {
    const names: Array<{ name: string; deviceId: string }> = [];

    for (let index: number = 1; index <= 9; index++) {
      names.push({ name: `AP${index}`, deviceId: `ap-${index}` });
    }

    expect(
      nameOf(
        plan({
          rules: [rule({ namePattern: "AP{n}" })],
          subjects: [{ key: "d", facts: { ipAddress: "10.0.0.1" } }],
          names: names,
        }),
        "d",
      ),
    ).toBe("AP10");

    expect(
      nameOf(
        plan({
          rules: [rule({ namePattern: "CAM-{nnn}" })],
          subjects: [{ key: "d", facts: { ipAddress: "10.0.0.1" } }],
        }),
        "d",
      ),
    ).toBe("CAM-001");
  });

  test("a counter in the middle of the name", () => {
    expect(
      nameOf(
        plan({
          rules: [rule({ namePattern: "{site.code}-{nn}-SCR" })],
          subjects: [
            { key: "d", facts: switchAt("1216", UNIT_1216, 2) },
          ],
          names: [{ name: "1216-01-SCR", deviceId: "x" }],
        }),
        "d",
      ),
    ).toBe("1216-02-SCR");
  });

  test("many devices of one pattern number up without a gap or a repeat", () => {
    const subjects: Array<DeviceNamingSubject> = [];

    for (let index: number = 0; index < 1500; index++) {
      subjects.push({ key: `d${index}`, facts: { ipAddress: `10.0.${index >> 8}.${index & 255}` } });
    }

    const results: Map<string, DeviceNamingResult> = plan({
      rules: [rule({ namePattern: "POS-{nnn}" })],
      subjects: subjects,
      names: [{ name: "POS-010", deviceId: "existing" }],
    });
    const given: Array<string> = subjects.map((subject: DeviceNamingSubject) => {
      return nameOf(results, subject.key);
    });

    expect(new Set<string>(given).size).toBe(1500);
    expect(given[0]).toBe("POS-001");
    expect(given[9]).toBe("POS-011");
    expect(given.includes("POS-010")).toBe(false);
    expect(given[1499]).toBe("POS-1501");
  });
});

describe("devices already in the project", () => {
  test("a device that already has the rules' name follows them", () => {
    const results: Map<string, DeviceNamingResult> = plan({
      rules: [DMB_RULE],
      subjects: [
        {
          key: "d",
          deviceId: "d",
          currentName: "UN1216MNUPLR01",
          facts: unitDevice({ unit: "1216", site: UNIT_1216, lastOctet: 51 }),
        },
      ],
      names: [{ name: "UN1216MNUPLR01", deviceId: "d" }],
    });

    expect(results.get("d")?.outcome).toBe(DeviceNamingOutcome.FollowsRules);
  });

  test("a device that does not follow them is given the name, its own old name still held", () => {
    const results: Map<string, DeviceNamingResult> = plan({
      rules: [DMB_RULE, rule({ _id: "fallback", priority: -1, namePattern: "dmb-5" })],
      subjects: [
        {
          key: "renamed",
          deviceId: "renamed",
          currentName: "dmb-5",
          facts: unitDevice({ unit: "1216", site: UNIT_1216, lastOctet: 55 }),
        },
        {
          key: "other",
          facts: unitDevice({ unit: "1216", site: UNIT_1216, lastOctet: 60 }),
        },
      ],
      names: [{ name: "dmb-5", deviceId: "renamed" }],
    });

    expect(nameOf(results, "renamed")).toBe("UN1216DRTPLR02");
    // "dmb-5" is still the first device's until the rename is applied.
    expect(results.get("other")?.outcome).toBe(DeviceNamingOutcome.NameTaken);
  });
});

describe("names too long", () => {
  test("a name longer than a device name may be is reported, never cut", () => {
    const results: Map<string, DeviceNamingResult> = plan({
      rules: [rule({ namePattern: `${"X".repeat(MAX_DEVICE_NAME_LENGTH)}-{ip.4}` })],
      subjects: [{ key: "d", facts: { ipAddress: "10.0.0.51" } }],
    });

    expect(results.get("d")).toMatchObject({
      outcome: DeviceNamingOutcome.NameTooLong,
    });
  });

  test("a counter that grows past the length is reported", () => {
    const prefix: string = "Y".repeat(MAX_DEVICE_NAME_LENGTH - 1);
    const results: Map<string, DeviceNamingResult> = plan({
      rules: [rule({ namePattern: `${prefix}{n}` })],
      subjects: [{ key: "d", facts: { ipAddress: "10.0.0.51" } }],
      names: Array.from({ length: 9 }, (_value: unknown, index: number) => {
        return { name: `${prefix}${index + 1}`, deviceId: `x${index}` };
      }),
    });

    expect(results.get("d")?.outcome).toBe(DeviceNamingOutcome.NameTooLong);
  });
});

describe("DeviceNamingSession", () => {
  test("names one device at a time, holding every name between calls", () => {
    const session: DeviceNamingSession = new DeviceNamingSession({
      rules: prepareNamingRules([rule({ namePattern: "SW-{nn}" })]),
      registry: new DeviceNameRegistry([{ name: "SW-02", deviceId: "x" }]),
    });

    expect(session.hasRules).toBe(true);
    expect(session.name({ key: "a", facts: {} }).name).toBe("SW-01");
    expect(session.name({ key: "b", facts: {} }).name).toBe("SW-03");

    // A name taken outside the rules (a collision fallback) is held too.
    session.hold("SW-04");
    expect(session.name({ key: "c", facts: {} }).name).toBe("SW-05");
    expect(session.isTaken("sw-05")).toBe(true);
  });

  test("with no rules it names nothing", () => {
    const session: DeviceNamingSession = new DeviceNamingSession({
      rules: [],
      registry: new DeviceNameRegistry(),
    });

    expect(session.hasRules).toBe(false);
    expect(session.name({ key: "a", facts: {} }).outcome).toBe(
      DeviceNamingOutcome.NoMatchingRule,
    );
  });
});

describe("whose name a device has", () => {
  test("isDeviceNamedByPerson", () => {
    expect(
      isDeviceNamedByPerson({ name: "core", discoveredName: "core" }),
    ).toBe(false);
    expect(
      isDeviceNamedByPerson({ name: "UN1216X", ruleAssignedName: "UN1216X" }),
    ).toBe(false);
    expect(
      isDeviceNamedByPerson({ name: "Front desk", discoveredName: "dmb-5" }),
    ).toBe(true);
    // Added by hand: no record of either.
    expect(isDeviceNamedByPerson({ name: "Core switch" })).toBe(true);
    expect(isDeviceNamedByPerson({ name: "" })).toBe(false);
  });

  test("isDeviceStillNamedByRule", () => {
    expect(
      isDeviceStillNamedByRule({ name: " UN1 ", ruleAssignedName: "UN1" }),
    ).toBe(true);
    expect(
      isDeviceStillNamedByRule({ name: "un1", ruleAssignedName: "UN1" }),
    ).toBe(false);
    expect(isDeviceStillNamedByRule({ name: "UN1" })).toBe(false);
    expect(
      isDeviceStillNamedByRule({ name: "", ruleAssignedName: "" }),
    ).toBe(false);
  });
});

describe("property: whatever the rules and devices, no name is given twice (seeded)", () => {
  test("no two devices share a name, and no device takes another's", () => {
    const random: SeededRandom = seededRandom(66190);
    const patterns: Array<string> = [
      "SW-{nn}",
      "{site.code}-{n}",
      "UN{site.code}{lookup}",
      "{discoveredName}",
      "FIXED",
      "{ip.4}",
      "{vendor|first:2|upper}{nn}",
    ];

    for (let attempt: number = 0; attempt < 60; attempt++) {
      const rules: Array<NamingRuleCandidate> = [];
      const ruleCount: number = 1 + random(4);

      for (let index: number = 0; index < ruleCount; index++) {
        rules.push(
          rule({
            _id: `r${index}`,
            priority: random(3),
            namePattern: patterns[random(patterns.length)]!,
            lookupKey: NamingLookupKey.LastIpOctet,
            lookupEntries: DMB_TABLE,
          }),
        );
      }

      const existing: Array<{ name: string; deviceId: string }> = [];

      for (let index: number = 0; index < random(20); index++) {
        existing.push({
          name: ["SW-01", "1216-1", "UN1216MNUPLR01", "FIXED", "51", "SI01"][
            random(6)
          ]!.replace("01", String(1 + random(3)).padStart(2, "0")),
          deviceId: `existing-${index}`,
        });
      }

      const subjects: Array<DeviceNamingSubject> = [];

      for (let index: number = 0; index < 1 + random(60); index++) {
        const lastOctet: number = [51, 54, 151, 2, 3, 40][random(6)]!;

        subjects.push({
          key: `d${index}`,
          facts: {
            ...unitDevice({
              unit: random(2) === 0 ? "1216" : "1188",
              site: random(2) === 0 ? UNIT_1216 : UNIT_1188,
              lastOctet: lastOctet,
              discoveredName: `host-${random(10)}`,
              vendor: ["SICOM", "Samsung", undefined][random(3)],
            }),
          },
        });
      }

      const registry: DeviceNameRegistry = new DeviceNameRegistry(existing);
      const results: Map<string, DeviceNamingResult> = planDeviceNames({
        rules: prepareNamingRules(rules),
        subjects: subjects,
        registry: new DeviceNameRegistry(existing),
      });
      const given: Set<string> = new Set<string>();

      for (const subject of subjects) {
        const result: DeviceNamingResult = results.get(subject.key)!;

        if (result.outcome !== DeviceNamingOutcome.Named) {
          continue;
        }

        const lower: string = result.name!.toLowerCase();

        expect(given.has(lower)).toBe(false);
        expect(registry.isTaken(result.name!)).toBe(false);
        expect(result.name!.length).toBeLessThanOrEqual(MAX_DEVICE_NAME_LENGTH);
        expect(result.name).toBe(result.name!.trim());
        given.add(lower);
      }
    }
  });
});
