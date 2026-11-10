import NetworkDeviceNamingRuleEngineService, {
  DeviceNamingContext,
  ImportNamingSession,
  NamingSiteDirectory,
  NamingSiteInfo,
} from "../../../Server/Services/NetworkDeviceNamingRuleEngineService";
import NetworkDeviceNamingRuleService from "../../../Server/Services/NetworkDeviceNamingRuleService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import NetworkSiteAssignmentRuleService from "../../../Server/Services/NetworkSiteAssignmentRuleService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceNamingRule from "../../../Models/DatabaseModels/NetworkDeviceNamingRule";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import NetworkSiteAssignmentRule from "../../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  DeviceNamingApplyResult,
  DeviceNamingOutcome,
  DeviceNamingPlan,
  DeviceNamingPlanItem,
  DeviceNamingPreview,
  MAX_RENAMES_PER_NAMING_APPLY,
  NAMING_APPLY_DEVICE_GONE_REASON,
  NAMING_APPLY_NAME_CHANGED_REASON,
  NAMING_APPLY_RULES_CHANGED_REASON,
  NamingLookupKey,
} from "../../../Types/NetworkDevice/DeviceNaming";
import { DeviceNameRegistry } from "../../../Utils/NetworkDevice/Naming/DeviceNamingPlanner";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The naming rules on the server (OneUptime issue #6619): the engine reads
 * the project's rules, sites, site assignment rules and device names, and
 * hands them to the pure planner. These drive it with the services mocked:
 *
 *   - a project with no enabled rule costs one read and names nothing;
 *   - a scan's host is named in the site the site assignment rules will put
 *     it in, read before the device exists ("UN{site.code}...");
 *   - a device the Discovered Devices list adds is named in the site it was
 *     seen in, with its MAC and vendor;
 *   - the plan for existing devices lists only what does not follow the
 *     rules, and marks what a person named;
 *   - applying renames only what still matches what the person saw, and
 *     writes the name with the rule-assigned name on the person's behalf.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const REGION_ID: string = "22222222-2222-4222-8222-222222222200";
const UNIT_1216_ID: string = "22222222-2222-4222-8222-222222221216";
const UNIT_1188_ID: string = "22222222-2222-4222-8222-222222221188";
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

function deviceId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

const DMB_RULE: NetworkDeviceNamingRule = {
  _id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Menu boards",
  isEnabled: true,
  priority: 2,
  createdAt: new Date("2026-11-01T00:00:00.000Z"),
  namePattern: "UN{site.code}{lookup}",
  // The units' addresses: a device elsewhere is no rule's.
  ipMatchTarget: "10.0.0.0/8",
  lookupKey: NamingLookupKey.LastIpOctet,
  lookupEntries: [
    { key: "51", value: "MNUPLR01" },
    { key: "55", value: "DRTPLR02" },
    { key: "159", value: "DRTSCR06" },
  ],
} as unknown as NetworkDeviceNamingRule;

const SWITCH_RULE: NetworkDeviceNamingRule = {
  _id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Switches",
  isEnabled: true,
  priority: 1,
  createdAt: new Date("2026-11-01T00:00:00.000Z"),
  namePattern: "UN{site.code}LANSWI{nn}",
  vendorPattern: "*Cisco*",
} as unknown as NetworkDeviceNamingRule;

const SITES: Array<NetworkSite> = [
  { _id: REGION_ID, name: "Texas", code: "TX" },
  {
    _id: UNIT_1216_ID,
    name: "Unit 1216",
    code: "1216",
    parentSiteId: new ObjectID(REGION_ID),
  },
  {
    _id: UNIT_1188_ID,
    name: "Unit 1188",
    code: "1188",
    parentSiteId: new ObjectID(REGION_ID),
  },
] as unknown as Array<NetworkSite>;

const SITE_RULES: Array<NetworkSiteAssignmentRule> = [
  {
    _id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    siteId: new ObjectID(UNIT_1216_ID),
    subnetCidr: "10.48.145.0/24",
    priority: 0,
  },
  {
    _id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    siteId: new ObjectID(UNIT_1188_ID),
    subnetCidr: "10.48.137.0/24",
    priority: 0,
  },
] as unknown as Array<NetworkSiteAssignmentRule>;

interface ProjectState {
  rules?: Array<NetworkDeviceNamingRule>;
  sites?: Array<NetworkSite>;
  siteRules?: Array<NetworkSiteAssignmentRule>;
  devices?: Array<NetworkDevice>;
}

/*
 * The project as the services answer it. findBy on devices answers both the
 * plan's read of selected devices and the apply's read of current names.
 */
function mockProject(state: ProjectState): {
  ruleRead: jest.SpiedFunction<typeof NetworkDeviceNamingRuleService.findBy>;
  siteRead: jest.SpiedFunction<typeof NetworkSiteService.findAllBy>;
  update: jest.SpiedFunction<typeof NetworkDeviceService.updateOneById>;
} {
  const devices: Array<NetworkDevice> = state.devices || [];

  const ruleRead: jest.SpiedFunction<
    typeof NetworkDeviceNamingRuleService.findBy
  > = jest.spyOn(NetworkDeviceNamingRuleService, "findBy").mockResolvedValue(
    (state.rules || []).filter((rule: NetworkDeviceNamingRule) => {
      return rule.isEnabled !== false;
    }),
  );
  const siteRead: jest.SpiedFunction<typeof NetworkSiteService.findAllBy> = jest
    .spyOn(NetworkSiteService, "findAllBy")
    .mockResolvedValue(state.sites || SITES);

  jest
    .spyOn(NetworkSiteAssignmentRuleService, "findBy")
    .mockResolvedValue(state.siteRules || SITE_RULES);
  jest.spyOn(NetworkDeviceService, "findAllBy").mockResolvedValue(devices);
  jest
    .spyOn(NetworkDeviceService, "findBy")
    .mockImplementation(
      async (data: unknown): Promise<Array<NetworkDevice>> => {
        const query: Record<string, unknown> =
          ((data as Record<string, unknown>)["query"] as Record<
            string,
            unknown
          >) || {};
        /*
         * QueryHelper.any is a Raw condition carrying the ids as its one
         * parameter.
         */
        const parameters: Record<string, unknown> =
          (
            query["_id"] as
              | { objectLiteralParameters?: Record<string, unknown> }
              | undefined
          )?.objectLiteralParameters || {};
        const wanted: Array<string> = Object.values(parameters)
          .flat()
          .map((value: unknown): string => {
            return String(value);
          });

        if (wanted.length === 0) {
          return devices;
        }

        return devices.filter((device: NetworkDevice): boolean => {
          return wanted.includes(String(device._id));
        });
      },
    );

  const update: jest.SpiedFunction<typeof NetworkDeviceService.updateOneById> =
    jest
      .spyOn(NetworkDeviceService, "updateOneById")
      .mockResolvedValue(undefined as never);

  return { ruleRead: ruleRead, siteRead: siteRead, update: update };
}

function device(overrides: Record<string, unknown>): NetworkDevice {
  return {
    projectId: PROJECT_ID,
    createdAt: new Date("2026-11-02T00:00:00.000Z"),
    ...overrides,
  } as unknown as NetworkDevice;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("NamingSiteDirectory", () => {
  test("a site's code, name, and every site above it, nearest first", () => {
    const directory: NamingSiteDirectory = new NamingSiteDirectory([
      { id: "region", name: "Texas", code: "TX" },
      { id: "district", name: "Houston", parentSiteId: "region" },
      { id: "unit", name: "Unit 1216", code: "1216", parentSiteId: "district" },
    ]);
    const unit: NamingSiteInfo | undefined = directory.describe("unit");

    expect(unit).toEqual({
      id: "unit",
      name: "Unit 1216",
      code: "1216",
      siteIds: ["unit", "district", "region"],
    });
    expect(directory.describe("missing")).toBeUndefined();
    expect(directory.describe(undefined)).toBeUndefined();
  });

  test("a cycle in the parents ends the walk instead of looping", () => {
    const directory: NamingSiteDirectory = new NamingSiteDirectory([
      { id: "a", parentSiteId: "b" },
      { id: "b", parentSiteId: "a" },
    ]);

    expect(directory.describe("a")?.siteIds).toEqual(["a", "b"]);
  });
});

describe("a project with no enabled naming rule", () => {
  test("costs one read, and its preview says there are no rules", async () => {
    const spies: ReturnType<typeof mockProject> = mockProject({
      rules: [{ ...DMB_RULE, isEnabled: false } as NetworkDeviceNamingRule],
    });

    const preview: DeviceNamingPreview =
      await NetworkDeviceNamingRuleEngineService.previewScanHosts({
        projectId: PROJECT_ID,
        hosts: [{ ipAddress: "10.48.145.51" }],
        scan: { useShortDeviceNames: false },
      });

    expect(preview).toEqual({ hasRules: false, items: [] });
    expect(spies.ruleRead).toHaveBeenCalledTimes(1);
    expect(spies.siteRead).not.toHaveBeenCalled();
    expect(
      await NetworkDeviceNamingRuleEngineService.startImportSession(PROJECT_ID),
    ).toBeNull();
  });

  test("reads only the project's enabled rules, in the order they are tried", async () => {
    const spies: ReturnType<typeof mockProject> = mockProject({});

    await NetworkDeviceNamingRuleEngineService.loadRules(PROJECT_ID);

    expect(spies.ruleRead).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { projectId: PROJECT_ID, isEnabled: true },
        props: { isRoot: true },
      }),
    );
  });
});

describe("previewing an import of a scan's hosts", () => {
  test("each host is named in the site the site assignment rules will give it", async () => {
    mockProject({ rules: [DMB_RULE, SWITCH_RULE] });

    const preview: DeviceNamingPreview =
      await NetworkDeviceNamingRuleEngineService.previewScanHosts({
        projectId: PROJECT_ID,
        hosts: [
          { ipAddress: "10.48.145.51", netbiosName: "DMB-1" },
          { ipAddress: "10.48.137.55" },
          { ipAddress: "10.48.145.40", sysName: "printer-1" },
          { ipAddress: "10.99.0.51" },
        ],
        scan: { useShortDeviceNames: false },
      });

    expect(preview.hasRules).toBe(true);
    expect(preview.items).toEqual([
      {
        key: "10.48.145.51",
        discoveredName: "DMB-1",
        outcome: DeviceNamingOutcome.Named,
        name: "UN1216MNUPLR01",
        ruleId: DMB_RULE._id,
        ruleName: "Menu boards",
      },
      {
        key: "10.48.137.55",
        discoveredName: "10.48.137.55",
        outcome: DeviceNamingOutcome.Named,
        name: "UN1188DRTPLR02",
        ruleId: DMB_RULE._id,
        ruleName: "Menu boards",
      },
      {
        // No row in the table for .40, and not a Cisco: left as it is found.
        key: "10.48.145.40",
        discoveredName: "printer-1",
        outcome: DeviceNamingOutcome.MissingValue,
        ruleId: DMB_RULE._id,
        ruleName: "Menu boards",
        missing: "lookup",
      },
      {
        // In no site: the rule has no site code to give it.
        key: "10.99.0.51",
        discoveredName: "10.99.0.51",
        outcome: DeviceNamingOutcome.MissingValue,
        ruleId: DMB_RULE._id,
        ruleName: "Menu boards",
        missing: "site.code",
      },
    ]);
  });

  test("a host's vendor is read from its SNMP answer, so vendor rules name it", async () => {
    mockProject({ rules: [SWITCH_RULE] });

    const preview: DeviceNamingPreview =
      await NetworkDeviceNamingRuleEngineService.previewScanHosts({
        projectId: PROJECT_ID,
        hosts: [
          {
            ipAddress: "10.48.145.2",
            sysName: "core-sw",
            sysObjectId: "1.3.6.1.4.1.9.1.1208",
          },
          {
            ipAddress: "10.48.145.3",
            sysName: "access-sw",
            sysObjectId: "1.3.6.1.4.1.9.1.1208",
          },
        ],
        scan: { useShortDeviceNames: false },
      });

    expect(
      preview.items.map((item: { name?: string | undefined }) => {
        return item.name;
      }),
    ).toEqual(["UN1216LANSWI01", "UN1216LANSWI02"]);
  });

  test("numbers skip the names the project's devices already have", async () => {
    mockProject({
      rules: [SWITCH_RULE],
      devices: [
        device({ _id: deviceId(1), name: "UN1216LANSWI01" }),
        device({ _id: deviceId(2), name: "un1216lanswi03" }),
      ],
    });

    const preview: DeviceNamingPreview =
      await NetworkDeviceNamingRuleEngineService.previewScanHosts({
        projectId: PROJECT_ID,
        hosts: [
          {
            ipAddress: "10.48.145.2",
            sysObjectId: "1.3.6.1.4.1.9.1.1208",
          },
          {
            ipAddress: "10.48.145.4",
            sysObjectId: "1.3.6.1.4.1.9.1.1208",
          },
        ],
        scan: { useShortDeviceNames: false },
      });

    expect(
      preview.items.map((item: { name?: string | undefined }) => {
        return item.name;
      }),
    ).toEqual(["UN1216LANSWI02", "UN1216LANSWI04"]);
  });
});

describe("previewing devices the Discovered Devices list adds", () => {
  test("named in the site they were seen in, keyed like the import's results", async () => {
    mockProject({
      rules: [
        {
          ...DMB_RULE,
          namePattern: "UN{site.code}{lookup}",
        } as NetworkDeviceNamingRule,
        {
          _id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          name: "Samsung screens",
          isEnabled: true,
          priority: 0,
          namePattern: "{site.code}-SCR-{mac|last:4}",
          vendorPattern: "Samsung*",
        } as unknown as NetworkDeviceNamingRule,
      ],
    });

    const preview: DeviceNamingPreview =
      await NetworkDeviceNamingRuleEngineService.previewDiscoveredDevices({
        projectId: PROJECT_ID,
        hosts: [
          {
            ipAddress: "10.64.145.159",
            facts: {
              endpointId: "endpoint-1",
              name: "Samsung",
              macAddress: "38:8c:ef:09:9f:8a",
              siteId: UNIT_1216_ID,
              vendor: "Samsung Electronics Co.,Ltd",
            },
          },
          {
            ipAddress: "10.64.145.153",
            facts: {
              endpointId: "endpoint-2",
              name: "204MXKD3P005 UH5F",
              macAddress: "74:e6:b8:89:a4:7c",
              siteId: UNIT_1216_ID,
              vendor: "Samsung Electronics Co.,Ltd",
            },
          },
        ],
      });

    expect(preview.items).toEqual([
      {
        key: "endpoint:endpoint-1",
        discoveredName: "Samsung",
        outcome: DeviceNamingOutcome.Named,
        name: "UN1216DRTSCR06",
        ruleId: DMB_RULE._id,
        ruleName: "Menu boards",
      },
      {
        // Not in the menu board table: the Samsung rule names it by its MAC.
        key: "endpoint:endpoint-2",
        discoveredName: "204MXKD3P005 UH5F",
        outcome: DeviceNamingOutcome.Named,
        name: "1216-SCR-A47C",
        ruleId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        ruleName: "Samsung screens",
      },
    ]);
  });
});

describe("an import's naming session", () => {
  test("holds every name given, and names the import's collision fallbacks take", async () => {
    mockProject({ rules: [SWITCH_RULE] });

    const session: ImportNamingSession | null =
      await NetworkDeviceNamingRuleEngineService.startImportSession(PROJECT_ID);

    expect(session).not.toBeNull();

    const host: { ipAddress: string; sysObjectId: string } = {
      ipAddress: "10.48.145.2",
      sysObjectId: "1.3.6.1.4.1.9.1.1208",
    };

    expect(
      session!.nameScanHost(host, { useShortDeviceNames: false }).name,
    ).toBe("UN1216LANSWI01");

    session!.hold("UN1216LANSWI02");

    expect(
      session!.nameScanHost(
        { ...host, ipAddress: "10.48.145.3" },
        { useShortDeviceNames: false },
      ),
    ).toMatchObject({
      name: "UN1216LANSWI03",
      siteId: UNIT_1216_ID,
      discoveredName: "10.48.145.3",
    });
  });
});

describe("planning the devices already in the project", () => {
  const devices: Array<NetworkDevice> = [
    // Named by discovery: renamed, ticked.
    device({
      _id: deviceId(1),
      name: "dmb-5",
      discoveredName: "dmb-5",
      discoveredNameSource: "netbios-name",
      hostname: "10.48.145.55",
      siteId: new ObjectID(UNIT_1216_ID),
      createdAt: new Date("2026-11-02T00:00:00.000Z"),
    }),
    // Already follows the rules: counted, not listed.
    device({
      _id: deviceId(2),
      name: "UN1216MNUPLR01",
      ruleAssignedName: "UN1216MNUPLR01",
      hostname: "10.48.145.51",
      siteId: new ObjectID(UNIT_1216_ID),
      createdAt: new Date("2026-11-01T00:00:00.000Z"),
    }),
    // Typed by a person: listed, flagged.
    device({
      _id: deviceId(3),
      name: "Drive-thru screen 6",
      discoveredName: "Samsung",
      hostname: "10.48.145.159",
      siteId: new ObjectID(UNIT_1216_ID),
      createdAt: new Date("2026-11-03T00:00:00.000Z"),
    }),
    // In no site: the rule cannot name it.
    device({
      _id: deviceId(4),
      name: "10.99.0.51",
      hostname: "10.99.0.51",
      createdAt: new Date("2026-11-04T00:00:00.000Z"),
    }),
    // No rule covers it at all.
    device({
      _id: deviceId(5),
      name: "core-router",
      hostname: "192.168.1.1",
      createdAt: new Date("2026-11-05T00:00:00.000Z"),
    }),
  ];

  test("lists what does not follow the rules, oldest first, and counts what does", async () => {
    mockProject({ rules: [DMB_RULE], devices: devices });

    const plan: DeviceNamingPlan =
      await NetworkDeviceNamingRuleEngineService.planExistingDevices({
        projectId: PROJECT_ID,
      });

    expect(plan.hasRules).toBe(true);
    expect(plan.devicesChecked).toBe(5);
    expect(plan.followingCount).toBe(1);
    expect(plan.isTruncated).toBe(false);
    expect(
      plan.items.map((item: DeviceNamingPlanItem) => {
        return {
          deviceId: item.deviceId,
          currentName: item.currentName,
          outcome: item.outcome,
          name: item.name,
          isNamedByPerson: item.isNamedByPerson,
        };
      }),
    ).toEqual([
      {
        deviceId: deviceId(1),
        currentName: "dmb-5",
        outcome: DeviceNamingOutcome.Named,
        name: "UN1216DRTPLR02",
        isNamedByPerson: false,
      },
      {
        deviceId: deviceId(3),
        currentName: "Drive-thru screen 6",
        outcome: DeviceNamingOutcome.Named,
        name: "UN1216DRTSCR06",
        isNamedByPerson: true,
      },
      {
        deviceId: deviceId(4),
        currentName: "10.99.0.51",
        outcome: DeviceNamingOutcome.MissingValue,
        name: undefined,
        isNamedByPerson: false,
      },
      {
        deviceId: deviceId(5),
        currentName: "core-router",
        outcome: DeviceNamingOutcome.NoMatchingRule,
        name: undefined,
        isNamedByPerson: true,
      },
    ]);
  });

  test("a project with no rules plans nothing", async () => {
    mockProject({ rules: [], devices: devices });

    expect(
      await NetworkDeviceNamingRuleEngineService.planExistingDevices({
        projectId: PROJECT_ID,
      }),
    ).toEqual({
      hasRules: false,
      devicesChecked: 0,
      items: [],
      followingCount: 0,
      isTruncated: false,
    });
  });

  test("a selection is planned on its own: ids that are not ids are ignored", async () => {
    mockProject({ rules: [DMB_RULE], devices: devices });

    const plan: DeviceNamingPlan =
      await NetworkDeviceNamingRuleEngineService.planExistingDevices({
        projectId: PROJECT_ID,
        deviceIds: [deviceId(1), "not-an-id"],
      });

    expect(plan.devicesChecked).toBe(1);
    expect(
      plan.items.map((item: DeviceNamingPlanItem) => {
        return item.deviceId;
      }),
    ).toEqual([deviceId(1)]);
  });
});

describe("applying renames a person confirmed", () => {
  const devices: Array<NetworkDevice> = [
    device({
      _id: deviceId(1),
      name: "dmb-5",
      discoveredName: "dmb-5",
      hostname: "10.48.145.55",
      siteId: new ObjectID(UNIT_1216_ID),
    }),
    device({
      _id: deviceId(2),
      name: "renamed meanwhile",
      hostname: "10.48.145.51",
      siteId: new ObjectID(UNIT_1216_ID),
    }),
    device({
      _id: deviceId(3),
      name: "Samsung",
      discoveredName: "Samsung",
      hostname: "10.48.145.159",
      siteId: new ObjectID(UNIT_1216_ID),
    }),
  ];

  test("renames what still matches, skips the rest with the reason, writes on the person's behalf", async () => {
    const spies: ReturnType<typeof mockProject> = mockProject({
      rules: [DMB_RULE],
      devices: devices,
    });

    const result: DeviceNamingApplyResult =
      await NetworkDeviceNamingRuleEngineService.applyRenames({
        projectId: PROJECT_ID,
        props: { userId: USER_ID, tenantId: PROJECT_ID },
        renames: [
          {
            deviceId: deviceId(1),
            fromName: "dmb-5",
            toName: "UN1216DRTPLR02",
          },
          // The person saw another name.
          {
            deviceId: deviceId(2),
            fromName: "10.48.145.51",
            toName: "UN1216MNUPLR01",
          },
          // The rules give it another name now.
          { deviceId: deviceId(3), fromName: "Samsung", toName: "UN1216OLD" },
          // Gone.
          { deviceId: deviceId(9), fromName: "x", toName: "y" },
        ],
      });

    expect(result).toEqual({
      renamed: 1,
      skipped: [
        { deviceId: deviceId(2), reason: NAMING_APPLY_NAME_CHANGED_REASON },
        { deviceId: deviceId(3), reason: NAMING_APPLY_RULES_CHANGED_REASON },
        { deviceId: deviceId(9), reason: NAMING_APPLY_DEVICE_GONE_REASON },
      ],
    });
    expect(spies.update).toHaveBeenCalledTimes(1);

    const call: Record<string, unknown> = spies.update.mock
      .calls[0]![0] as unknown as Record<string, unknown>;

    expect(String(call["id"])).toBe(deviceId(1));
    expect(call["data"]).toEqual({
      name: "UN1216DRTPLR02",
      ruleAssignedName: "UN1216DRTPLR02",
    });
    // Root, crediting the person who applied the rules (RuleRunWriteProps).
    expect((call["props"] as Record<string, unknown>)["isRoot"]).toBe(true);
  });

  test("a rename the database refuses is reported, and the rest go on", async () => {
    const spies: ReturnType<typeof mockProject> = mockProject({
      rules: [DMB_RULE],
      devices: [devices[0]!, devices[2]!],
    });

    spies.update.mockRejectedValueOnce(new BadDataException("refused"));

    const result: DeviceNamingApplyResult =
      await NetworkDeviceNamingRuleEngineService.applyRenames({
        projectId: PROJECT_ID,
        renames: [
          {
            deviceId: deviceId(1),
            fromName: "dmb-5",
            toName: "UN1216DRTPLR02",
          },
          {
            deviceId: deviceId(3),
            fromName: "Samsung",
            toName: "UN1216DRTSCR06",
          },
        ],
      });

    expect(result).toEqual({
      renamed: 1,
      skipped: [{ deviceId: deviceId(1), reason: "refused" }],
    });
  });

  test("nothing to rename does nothing, and too many renames are refused", async () => {
    const spies: ReturnType<typeof mockProject> = mockProject({
      rules: [DMB_RULE],
    });

    expect(
      await NetworkDeviceNamingRuleEngineService.applyRenames({
        projectId: PROJECT_ID,
        renames: [],
      }),
    ).toEqual({ renamed: 0, skipped: [] });
    expect(spies.ruleRead).not.toHaveBeenCalled();

    await expect(
      NetworkDeviceNamingRuleEngineService.applyRenames({
        projectId: PROJECT_ID,
        renames: Array.from(
          { length: MAX_RENAMES_PER_NAMING_APPLY + 1 },
          (_value: unknown, index: number) => {
            return { deviceId: deviceId(index), fromName: "a", toName: "b" };
          },
        ),
      }),
    ).rejects.toThrow(BadDataException);
  });
});

describe("the facts a device already in the project is named from", () => {
  test("its address, its discovered name before its name, its MAC and its site", () => {
    const context: DeviceNamingContext = {
      projectId: PROJECT_ID,
      rules: [],
      sites: new NamingSiteDirectory([
        { id: UNIT_1216_ID, name: "Unit 1216", code: "1216" },
      ]),
      siteAssignmentRules: [],
      registry: new DeviceNameRegistry(),
    };

    expect(
      NetworkDeviceNamingRuleEngineService.factsOfDevice(
        context,
        device({
          name: "UN1216MNUPLR01",
          discoveredName: "dmb-1",
          hostname: "10.48.145.51",
          macAddress: "00:05:0b:b0:7f:fc",
          vendor: "SICOM Systems",
          siteId: new ObjectID(UNIT_1216_ID),
        }),
      ),
    ).toEqual({
      ipAddress: "10.48.145.51",
      // As its Overview shows it (NetworkDeviceAssetFacts).
      macAddress: "00-05-0B-B0-7F-FC",
      vendor: "SICOM Systems",
      discoveredName: "dmb-1",
      siteId: UNIT_1216_ID,
      siteIds: [UNIT_1216_ID],
      siteName: "Unit 1216",
      siteCode: "1216",
    });
  });
});
