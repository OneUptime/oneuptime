import NetworkDeviceOidTemplateService from "../../../Server/Services/NetworkDeviceOidTemplateService";
import { Service as NetworkDeviceServiceType } from "../../../Server/Services/NetworkDeviceService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceOidTemplate from "../../../Models/DatabaseModels/NetworkDeviceOidTemplate";
import BadDataException from "../../../Types/Exception/BadDataException";
import SnmpOid from "../../../Types/Monitor/SnmpMonitor/SnmpOid";
import {
  MAX_DEVICE_SPECIFIC_OIDS,
  MAX_EFFECTIVE_OIDS_PER_DEVICE,
} from "../../../Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import ObjectID from "../../../Types/ObjectID";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  ProjectDirectoryStub,
  stubProjectDirectory,
} from "../TestingUtils/ProjectDirectory";

/*
 * The records these tests name are their project's own: the services check
 * every reference against the project (ProjectReferencesService).
 */
beforeEach(() => {
  stubProjectDirectory({});
});

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * Two write guards on NetworkDevice, and specifically that they RUN.
 *
 * onBeforeUpdate has an early return: a write that changes neither the
 * device's site nor its identity columns bails out before the expensive read
 * it does not need. Both new guards were originally added below that return —
 * which made them dead code for exactly the writes they exist for, because
 * linking a template or editing snmpOids touches neither site nor identity.
 * Nothing failed; the guards simply never ran, which is the worst shape a
 * security check can take.
 *
 * So these tests do not just assert "a cross-project template is refused".
 * They assert it through the real hook, on a payload that trips the early
 * return, in both spellings the UI actually posts.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
// A template of another project: not in this project's directory.
const OTHER_PROJECT_TEMPLATE_ID: string =
  "33333333-3333-4333-8333-0000000000ff";
const DEVICE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

type DeviceServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<NetworkDevice>,
  ) => Promise<OnCreate<NetworkDevice>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<NetworkDevice>,
  ) => Promise<OnUpdate<NetworkDevice>>;
};

function buildDeviceService(): {
  service: NetworkDeviceServiceType;
  internals: DeviceServiceInternals;
} {
  const service: NetworkDeviceServiceType = new NetworkDeviceServiceType();
  return {
    service,
    internals: service as unknown as DeviceServiceInternals,
  };
}

/*
 * The device the update matches. Its projectId is what the guard compares the
 * template against.
 */
function matchedDevice(): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(DEVICE_ID);
  device.projectId = PROJECT_ID;
  return device;
}

function templateInProject(projectId: ObjectID): NetworkDeviceOidTemplate {
  const template: NetworkDeviceOidTemplate = new NetworkDeviceOidTemplate(
    TEMPLATE_ID,
  );
  template.projectId = projectId;
  template.name = "Cisco Catalyst 9300";
  return template;
}

/*
 * A payload that links a template and NOTHING else — no site, no hostname, no
 * name, no sysName. This is the shape the device settings form and the bulk
 * action actually post, and it is precisely the shape that trips
 * onBeforeUpdate's early return.
 */
function templateOnlyUpdate(
  spelling: "id" | "relation",
): UpdateBy<NetworkDevice> {
  const data: Record<string, unknown> =
    spelling === "id"
      ? { oidTemplateId: TEMPLATE_ID }
      : { oidTemplate: templateInProject(PROJECT_ID) };

  return {
    query: { _id: DEVICE_ID.toString() },
    data: data,
    props: { isRoot: true },
  } as unknown as UpdateBy<NetworkDevice>;
}

describe("linking a device to an OID Collection Template is tenant-checked", () => {
  const MISSING_TEMPLATE_ID: ObjectID = new ObjectID(
    "33333333-3333-4333-8333-0000000000dd",
  );

  let directory: ProjectDirectoryStub;

  beforeEach(() => {
    jest.restoreAllMocks();
    // The project has one template: TEMPLATE_ID. Nothing else is its own.
    directory = stubProjectDirectory({
      projectId: PROJECT_ID,
      records: { NetworkDeviceOidTemplate: [TEMPLATE_ID.toString()] },
    });
  });

  function templateLookups(): Array<{ ids: Array<string> }> {
    return directory.recordLookups.filter(
      (lookup: { model: string }): boolean => {
        return lookup.model === "NetworkDeviceOidTemplate";
      },
    );
  }

  function updateLinking(
    spelling: "id" | "relation",
    templateId: ObjectID,
  ): UpdateBy<NetworkDevice> {
    const data: Record<string, unknown> =
      spelling === "id"
        ? { oidTemplateId: templateId }
        : { oidTemplate: new NetworkDeviceOidTemplate(templateId) };

    return {
      query: { _id: DEVICE_ID.toString() },
      data: data,
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>;
  }

  /*
   * THE regression test. If the guard drifts back below the early return this
   * resolves cleanly and the cross-project link is persisted, so the assertion
   * has to be that the hook REJECTS — not merely that some code path exists.
   */
  test.each(["id", "relation"] as const)(
    "refuses a template from another project when the payload writes only the %s",
    async (spelling: "id" | "relation") => {
      const { service, internals } = buildDeviceService();

      jest
        .spyOn(service, "findBy")
        .mockResolvedValue([matchedDevice()] as never);

      await expect(
        internals.onBeforeUpdate(
          updateLinking(spelling, new ObjectID(OTHER_PROJECT_TEMPLATE_ID)),
        ),
      ).rejects.toThrow(
        `references records that are not in this project: OID Collection Template "${OTHER_PROJECT_TEMPLATE_ID}"`,
      );
    },
  );

  test("allows a template from the device's own project", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);

    await expect(
      internals.onBeforeUpdate(templateOnlyUpdate("id")),
    ).resolves.toBeDefined();
  });

  /*
   * The guard must actually reach the database rather than being skipped. A
   * hook that returns early looks identical to a hook that passed, so assert
   * the lookup happened - pinned to the device's project.
   */
  test("actually looks the template up, rather than returning early", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);

    await internals.onBeforeUpdate(templateOnlyUpdate("id"));

    expect(templateLookups().length).toBeGreaterThan(0);
    expect(
      directory.recordLookups.every(
        (lookup: { projectId: string }): boolean => {
          return lookup.projectId === PROJECT_ID.toString();
        },
      ),
    ).toBe(true);
  });

  test("refuses a template that does not exist at all, exactly as one of another project", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);

    let missing: string = "";
    let foreign: string = "";

    try {
      await internals.onBeforeUpdate(updateLinking("id", MISSING_TEMPLATE_ID));
    } catch (error) {
      expect(error).toBeInstanceOf(BadDataException);
      missing = (error as Error).message;
    }

    try {
      await internals.onBeforeUpdate(
        updateLinking("id", new ObjectID(OTHER_PROJECT_TEMPLATE_ID)),
      );
    } catch (error) {
      foreign = (error as Error).message;
    }

    expect(missing).not.toBe("");
    expect(
      missing.replace(
        MISSING_TEMPLATE_ID.toString(),
        OTHER_PROJECT_TEMPLATE_ID,
      ),
    ).toBe(foreign);
  });

  test("does no template lookup for an update that links nothing", async () => {
    const { internals } = buildDeviceService();

    await internals.onBeforeUpdate({
      query: { _id: DEVICE_ID.toString() },
      data: { pollingIntervalInMinutes: 10 },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>);

    expect(templateLookups()).toHaveLength(0);
  });

  test("checks the template on create too", async () => {
    const { internals } = buildDeviceService();

    const device: NetworkDevice = new NetworkDevice();
    device.projectId = PROJECT_ID;
    device.oidTemplateId = new ObjectID(OTHER_PROJECT_TEMPLATE_ID);

    await expect(
      internals.onBeforeCreate({
        data: device,
        props: { isRoot: true },
      } as CreateBy<NetworkDevice>),
    ).rejects.toThrow(
      `references records that are not in this project: OID Collection Template "${OTHER_PROJECT_TEMPLATE_ID}"`,
    );
  });
});

describe("device-specific OID validation runs on the write that carries it", () => {
  function oidOnlyUpdate(oids: Array<SnmpOid>): UpdateBy<NetworkDevice> {
    return {
      query: { _id: DEVICE_ID.toString() },
      data: { snmpOids: oids },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>;
  }

  beforeEach(() => {
    jest.restoreAllMocks();
    stubProjectDirectory({});
  });

  /*
   * Same dead-code hazard as above: a snmpOids-only write changes neither
   * site nor identity, so validation placed after the early return would
   * never run on the only write that carries an OID list.
   */
  test("refuses a malformed OID on an snmpOids-only update", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);

    await expect(
      internals.onBeforeUpdate(oidOnlyUpdate([{ oid: "sysUpTime.0" }])),
    ).rejects.toThrow(/is not a numeric OID/);
  });

  function oidList(length: number): Array<SnmpOid> {
    return Array.from({ length: length }, (_unused: unknown, index: number) => {
      return { oid: `1.3.6.1.4.1.${index}` };
    });
  }

  function linkedDevice(): NetworkDevice {
    const device: NetworkDevice = matchedDevice();
    device.oidTemplateId = TEMPLATE_ID;
    return device;
  }

  /*
   * The tight per-device budget is what ADOPTING a template costs, not a
   * retroactive limit on every device that already exists.
   *
   * Enforcing it unconditionally would have locked a device that predates
   * this feature, carrying a long hand-built list, out of saving ANY polling
   * setting — the fleet in #3507 being the likeliest example, since it is the
   * one with a hundred OIDs on it.
   */
  test("a device with no template may carry more than the device-specific budget", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      oidOnlyUpdate(oidList(MAX_DEVICE_SPECIFIC_OIDS + 1)),
    );

    expect(result.updateBy.data.snmpOids).toHaveLength(
      MAX_DEVICE_SPECIFIC_OIDS + 1,
    );
  });

  test("but never more than a device may effectively poll", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);

    await expect(
      internals.onBeforeUpdate(
        oidOnlyUpdate(oidList(MAX_EFFECTIVE_OIDS_PER_DEVICE + 1)),
      ),
    ).rejects.toThrow(
      new RegExp(`more than the limit of ${MAX_EFFECTIVE_OIDS_PER_DEVICE}`),
    );
  });

  /*
   * Once a template IS linked, the two halves have to compose: the template
   * budget plus the device-specific budget is the effective ceiling, so the
   * device-specific half is what gives.
   */
  test("a LINKED device is held to the device-specific budget", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([linkedDevice()] as never);

    await expect(
      internals.onBeforeUpdate(
        oidOnlyUpdate(oidList(MAX_DEVICE_SPECIFIC_OIDS + 1)),
      ),
    ).rejects.toThrow(
      new RegExp(`more than the limit of ${MAX_DEVICE_SPECIFIC_OIDS}`),
    );
  });

  /*
   * And the same write that adopts a template is held to it immediately —
   * otherwise the budget could be dodged by linking and editing in one call.
   */
  test("adopting a template in the same write applies the tighter budget at once", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);
    jest
      .spyOn(NetworkDeviceOidTemplateService, "findOneById")
      .mockResolvedValue(templateInProject(PROJECT_ID) as never);

    await expect(
      internals.onBeforeUpdate({
        query: { _id: DEVICE_ID.toString() },
        data: {
          oidTemplateId: TEMPLATE_ID,
          snmpOids: oidList(MAX_DEVICE_SPECIFIC_OIDS + 1),
        },
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkDevice>),
    ).rejects.toThrow(
      new RegExp(`more than the limit of ${MAX_DEVICE_SPECIFIC_OIDS}`),
    );
  });

  test("normalizes what it stores, so criteria can match with equality", async () => {
    const { service, internals } = buildDeviceService();

    jest.spyOn(service, "findBy").mockResolvedValue([matchedDevice()] as never);

    const result: OnUpdate<NetworkDevice> = await internals.onBeforeUpdate(
      oidOnlyUpdate([{ oid: ".1.3.6.1.4.1.9.1", name: "cpu" }]),
    );

    expect((result.updateBy.data.snmpOids as Array<SnmpOid>)[0]!.oid).toBe(
      "1.3.6.1.4.1.9.1",
    );
  });

  /*
   * Linking a device whose STORED list already exceeds the device-specific
   * budget would push the merge over the effective ceiling, and truncation
   * drops from the end — so the operator's own OIDs would silently stop being
   * polled, on a write that never mentioned them. Refuse the link instead,
   * and say how many to trim.
   */
  test("refuses to link a device whose existing list already exceeds the linked budget", async () => {
    const { service, internals } = buildDeviceService();

    const crowdedDevice: NetworkDevice = matchedDevice();
    crowdedDevice.snmpOids = oidList(MAX_DEVICE_SPECIFIC_OIDS + 5);

    jest.spyOn(service, "findBy").mockResolvedValue([crowdedDevice] as never);
    jest
      .spyOn(NetworkDeviceOidTemplateService, "findOneById")
      .mockResolvedValue(templateInProject(PROJECT_ID) as never);

    await expect(
      internals.onBeforeUpdate(templateOnlyUpdate("id")),
    ).rejects.toThrow(/Remove 5 of them/);
  });

  test("allows the link when the existing list fits", async () => {
    const { service, internals } = buildDeviceService();

    const tidyDevice: NetworkDevice = matchedDevice();
    tidyDevice.snmpOids = oidList(3);

    jest.spyOn(service, "findBy").mockResolvedValue([tidyDevice] as never);
    jest
      .spyOn(NetworkDeviceOidTemplateService, "findOneById")
      .mockResolvedValue(templateInProject(PROJECT_ID) as never);

    await expect(
      internals.onBeforeUpdate(templateOnlyUpdate("id")),
    ).resolves.toBeDefined();
  });

  test("validates on create as well", async () => {
    const { internals } = buildDeviceService();

    const device: NetworkDevice = new NetworkDevice();
    device.projectId = PROJECT_ID;
    device.snmpOids = [{ oid: "not-an-oid" }];

    await expect(
      internals.onBeforeCreate({
        data: device,
        props: { isRoot: true },
      } as CreateBy<NetworkDevice>),
    ).rejects.toThrow(BadDataException);
  });
});
