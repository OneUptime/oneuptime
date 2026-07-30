import NetworkDeviceLabelRuleEngineService from "../../../Server/Services/NetworkDeviceLabelRuleEngineService";
import NetworkDeviceLabelRuleService from "../../../Server/Services/NetworkDeviceLabelRuleService";
import NetworkDeviceOwnerRuleEngineService from "../../../Server/Services/NetworkDeviceOwnerRuleEngineService";
import NetworkDeviceOwnerRuleService from "../../../Server/Services/NetworkDeviceOwnerRuleService";
import NetworkDeviceOwnerTeamService from "../../../Server/Services/NetworkDeviceOwnerTeamService";
import NetworkDeviceOwnerUserService from "../../../Server/Services/NetworkDeviceOwnerUserService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import Label from "../../../Models/DatabaseModels/Label";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceLabelRule from "../../../Models/DatabaseModels/NetworkDeviceLabelRule";
import NetworkDeviceOwnerRule from "../../../Models/DatabaseModels/NetworkDeviceOwnerRule";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { describe, expect, it, afterEach } from "@jest/globals";

/*
 * Contract under test - the network device label and owner rule engines, and
 * the write-time validation in front of them.
 *
 * The pattern criteria are documented as case-insensitive regexes, but the
 * assignment rules right next to them in Network > Automation take '*'
 * wildcard globs. A rule written with the glob syntax - `*0664*` - used to
 * throw inside `new RegExp`, get swallowed, and silently label nothing
 * (OneUptime/oneuptime#2940). Both engines now accept either syntax, and a
 * pattern that can satisfy neither is rejected at the write.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const LABEL_A_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const LABEL_B_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PREREQUISITE_LABEL_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const TEAM_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

function fakeLabel(id: ObjectID): Label {
  return { id: id, _id: id.toString() } as unknown as Label;
}

// The device as onCreateSuccess hands it to an engine: ids only.
function ruleTarget(): NetworkDevice {
  return {
    id: DEVICE_ID,
    _id: DEVICE_ID.toString(),
    projectId: PROJECT_ID,
  } as unknown as NetworkDevice;
}

/*
 * The row the engine re-reads for the match. A discovery-imported device
 * carries the SNMP identity in `name` and the responding IP in `hostname`.
 */
function fakeDeviceDetails(overrides: Record<string, unknown>): NetworkDevice {
  return {
    id: DEVICE_ID,
    _id: DEVICE_ID.toString(),
    projectId: PROJECT_ID,
    name: "UN0664LANSWI03",
    ...overrides,
  } as unknown as NetworkDevice;
}

function fakeLabelRule(data: Record<string, unknown>): NetworkDeviceLabelRule {
  return {
    id: new ObjectID("77777777-7777-4777-8777-777777777777"),
    labelsToAdd: [fakeLabel(LABEL_A_ID)],
    ...data,
  } as unknown as NetworkDeviceLabelRule;
}

function fakeOwnerRule(data: Record<string, unknown>): NetworkDeviceOwnerRule {
  return {
    id: new ObjectID("88888888-8888-4888-8888-888888888888"),
    ownerUsers: [{ id: USER_ID } as unknown as Label],
    ownerTeams: [],
    ...data,
  } as unknown as NetworkDeviceOwnerRule;
}

/*
 * The label engine attaches through the relation query builder rather than a
 * model write, so the assertion surface is the `.add(ids)` call at the end of
 * that chain.
 */
function mockLabelAttach(): jest.Mock {
  const addSpy: jest.Mock = jest.fn().mockResolvedValue(undefined);

  jest.spyOn(NetworkDeviceService, "getRepository").mockReturnValue({
    createQueryBuilder: (): any => {
      return {
        relation: (): any => {
          return {
            of: (): any => {
              return { add: addSpy };
            },
          };
        },
      };
    },
  } as any);

  return addSpy;
}

describe("NetworkDeviceLabelRuleEngineService - wildcard patterns", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The reported bug, end to end: an enabled rule with the glob the user
   * typed, against the device the dashboard showed them.
   */
  it("attaches labels for the *0664* pattern from issue #2940", async () => {
    jest
      .spyOn(NetworkDeviceLabelRuleService, "findBy")
      .mockResolvedValue([
        fakeLabelRule({ networkDeviceNamePattern: "*0664*" }),
      ]);
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(fakeDeviceDetails({ labels: [] }));
    const addSpy: jest.Mock = mockLabelAttach();

    await NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(
      ruleTarget(),
    );

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy.mock.calls[0]![0]).toEqual([LABEL_A_ID.toString()]);
  });

  it("does not attach labels to a device the pattern does not match", async () => {
    jest
      .spyOn(NetworkDeviceLabelRuleService, "findBy")
      .mockResolvedValue([
        fakeLabelRule({ networkDeviceNamePattern: "*0664*" }),
      ]);
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(
        fakeDeviceDetails({ name: "UN0661LANSWI03", labels: [] }),
      );
    const addSpy: jest.Mock = mockLabelAttach();

    await NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(
      ruleTarget(),
    );

    expect(addSpy).not.toHaveBeenCalled();
  });

  it("still honours a plain regex pattern", async () => {
    jest
      .spyOn(NetworkDeviceLabelRuleService, "findBy")
      .mockResolvedValue([
        fakeLabelRule({ networkDeviceNamePattern: "un0664.*swi03" }),
      ]);
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(fakeDeviceDetails({ labels: [] }));
    const addSpy: jest.Mock = mockLabelAttach();

    await NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(
      ruleTarget(),
    );

    expect(addSpy).toHaveBeenCalledTimes(1);
  });

  it("matches a wildcard description pattern", async () => {
    jest.spyOn(NetworkDeviceLabelRuleService, "findBy").mockResolvedValue([
      fakeLabelRule({
        networkDeviceDescriptionPattern: "*IOS-XE*",
      }),
    ]);
    jest.spyOn(NetworkDeviceService, "findOneById").mockResolvedValue(
      fakeDeviceDetails({
        description: "Cisco IOS-XE Software, Catalyst L3 Switch",
        labels: [],
      }),
    );
    const addSpy: jest.Mock = mockLabelAttach();

    await NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(
      ruleTarget(),
    );

    expect(addSpy).toHaveBeenCalledTimes(1);
  });

  it("requires every configured pattern to match", async () => {
    jest.spyOn(NetworkDeviceLabelRuleService, "findBy").mockResolvedValue([
      fakeLabelRule({
        networkDeviceNamePattern: "*0664*",
        networkDeviceDescriptionPattern: "*IOS-XE*",
      }),
    ]);
    jest.spyOn(NetworkDeviceService, "findOneById").mockResolvedValue(
      fakeDeviceDetails({
        description: "Juniper JUNOS",
        labels: [],
      }),
    );
    const addSpy: jest.Mock = mockLabelAttach();

    await NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(
      ruleTarget(),
    );

    expect(addSpy).not.toHaveBeenCalled();
  });

  it("cannot match a pattern against a device with no name", async () => {
    jest
      .spyOn(NetworkDeviceLabelRuleService, "findBy")
      .mockResolvedValue([
        fakeLabelRule({ networkDeviceNamePattern: "*0664*" }),
      ]);
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(fakeDeviceDetails({ name: undefined, labels: [] }));
    const addSpy: jest.Mock = mockLabelAttach();

    await NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(
      ruleTarget(),
    );

    expect(addSpy).not.toHaveBeenCalled();
  });

  /*
   * A pattern that is neither a regex nor a glob cannot match anything. It
   * must not match everything either, and it must not throw out of the
   * engine.
   */
  it("never matches - and never throws on - an unparseable pattern", async () => {
    jest
      .spyOn(NetworkDeviceLabelRuleService, "findBy")
      .mockResolvedValue([
        fakeLabelRule({ networkDeviceNamePattern: "switch-(01" }),
      ]);
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(fakeDeviceDetails({ labels: [] }));
    const addSpy: jest.Mock = mockLabelAttach();

    await expect(
      NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(
        ruleTarget(),
      ),
    ).resolves.toBeUndefined();
    expect(addSpy).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only pattern as no criterion at all", async () => {
    jest
      .spyOn(NetworkDeviceLabelRuleService, "findBy")
      .mockResolvedValue([fakeLabelRule({ networkDeviceNamePattern: "   " })]);
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(fakeDeviceDetails({ labels: [] }));
    const addSpy: jest.Mock = mockLabelAttach();

    await NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(
      ruleTarget(),
    );

    expect(addSpy).toHaveBeenCalledTimes(1);
  });
});

describe("NetworkDeviceLabelRuleEngineService - rule selection and attach", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("only ever evaluates enabled rules from the device's project", async () => {
    const rulesSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceLabelRuleService, "findBy")
      .mockResolvedValue([]);
    const deviceSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "findOneById",
    );

    await NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(
      ruleTarget(),
    );

    const query: any = rulesSpy.mock.calls[0]![0].query;
    expect(query.isEnabled).toBe(true);
    expect(query.projectId.toString()).toBe(PROJECT_ID.toString());
    // No rules means no reason to re-read the device.
    expect(deviceSpy).not.toHaveBeenCalled();
  });

  it("unions the labels of every matching rule", async () => {
    jest.spyOn(NetworkDeviceLabelRuleService, "findBy").mockResolvedValue([
      fakeLabelRule({
        networkDeviceNamePattern: "*0664*",
        labelsToAdd: [fakeLabel(LABEL_A_ID)],
      }),
      fakeLabelRule({
        networkDeviceNamePattern: "*LANSWI*",
        labelsToAdd: [fakeLabel(LABEL_B_ID)],
      }),
      fakeLabelRule({
        networkDeviceNamePattern: "*NOMATCH*",
        labelsToAdd: [fakeLabel(PREREQUISITE_LABEL_ID)],
      }),
    ]);
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(fakeDeviceDetails({ labels: [] }));
    const addSpy: jest.Mock = mockLabelAttach();

    await NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(
      ruleTarget(),
    );

    expect(addSpy.mock.calls[0]![0].sort()).toEqual(
      [LABEL_A_ID.toString(), LABEL_B_ID.toString()].sort(),
    );
  });

  it("skips labels the device already carries", async () => {
    jest.spyOn(NetworkDeviceLabelRuleService, "findBy").mockResolvedValue([
      fakeLabelRule({
        networkDeviceNamePattern: "*0664*",
        labelsToAdd: [fakeLabel(LABEL_A_ID), fakeLabel(LABEL_B_ID)],
      }),
    ]);
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(
        fakeDeviceDetails({ labels: [fakeLabel(LABEL_A_ID)] }),
      );
    const addSpy: jest.Mock = mockLabelAttach();

    await NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(
      ruleTarget(),
    );

    expect(addSpy.mock.calls[0]![0]).toEqual([LABEL_B_ID.toString()]);
  });

  it("writes nothing when every matched label is already attached", async () => {
    jest
      .spyOn(NetworkDeviceLabelRuleService, "findBy")
      .mockResolvedValue([
        fakeLabelRule({ networkDeviceNamePattern: "*0664*" }),
      ]);
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(
        fakeDeviceDetails({ labels: [fakeLabel(LABEL_A_ID)] }),
      );
    const addSpy: jest.Mock = mockLabelAttach();

    await NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(
      ruleTarget(),
    );

    expect(addSpy).not.toHaveBeenCalled();
  });

  it("honours the 'device already has one of these labels' prerequisite", async () => {
    jest.spyOn(NetworkDeviceLabelRuleService, "findBy").mockResolvedValue([
      fakeLabelRule({
        networkDeviceLabels: [fakeLabel(PREREQUISITE_LABEL_ID)],
        networkDeviceNamePattern: "*0664*",
      }),
    ]);
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(fakeDeviceDetails({ labels: [] }));
    const addSpy: jest.Mock = mockLabelAttach();

    await NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(
      ruleTarget(),
    );

    expect(addSpy).not.toHaveBeenCalled();
  });

  it("fires once the prerequisite label is present", async () => {
    jest.spyOn(NetworkDeviceLabelRuleService, "findBy").mockResolvedValue([
      fakeLabelRule({
        networkDeviceLabels: [fakeLabel(PREREQUISITE_LABEL_ID)],
        networkDeviceNamePattern: "*0664*",
      }),
    ]);
    jest.spyOn(NetworkDeviceService, "findOneById").mockResolvedValue(
      fakeDeviceDetails({
        labels: [fakeLabel(PREREQUISITE_LABEL_ID)],
      }),
    );
    const addSpy: jest.Mock = mockLabelAttach();

    await NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(
      ruleTarget(),
    );

    expect(addSpy).toHaveBeenCalledTimes(1);
  });

  /*
   * The owner engine runs next in the same chain and matches on labels, so
   * the labels this engine just attached have to be visible on the in-memory
   * device it was handed.
   */
  it("syncs the attached labels onto the passed device", async () => {
    jest
      .spyOn(NetworkDeviceLabelRuleService, "findBy")
      .mockResolvedValue([
        fakeLabelRule({ networkDeviceNamePattern: "*0664*" }),
      ]);
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(fakeDeviceDetails({ labels: [] }));
    mockLabelAttach();

    const device: NetworkDevice = ruleTarget();
    await NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(device);

    expect(
      (device.labels || []).map((label: Label) => {
        return label.id?.toString();
      }),
    ).toEqual([LABEL_A_ID.toString()]);
  });

  it("does nothing for a device with no id or no project", async () => {
    const rulesSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceLabelRuleService,
      "findBy",
    );

    await NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice({
      projectId: PROJECT_ID,
    } as unknown as NetworkDevice);
    await NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice({
      id: DEVICE_ID,
    } as unknown as NetworkDevice);

    expect(rulesSpy).not.toHaveBeenCalled();
  });

  it("does nothing when the device row has gone", async () => {
    jest
      .spyOn(NetworkDeviceLabelRuleService, "findBy")
      .mockResolvedValue([
        fakeLabelRule({ networkDeviceNamePattern: "*0664*" }),
      ]);
    jest.spyOn(NetworkDeviceService, "findOneById").mockResolvedValue(null);
    const addSpy: jest.Mock = mockLabelAttach();

    await NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(
      ruleTarget(),
    );

    expect(addSpy).not.toHaveBeenCalled();
  });

  // A labelling failure must never break the device create it rides on.
  it("swallows a lookup failure instead of propagating it", async () => {
    jest
      .spyOn(NetworkDeviceLabelRuleService, "findBy")
      .mockRejectedValue(new Error("database is down"));

    await expect(
      NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(
        ruleTarget(),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("NetworkDeviceOwnerRuleEngineService - wildcard patterns", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("adds owners for a *0664* pattern", async () => {
    jest
      .spyOn(NetworkDeviceOwnerRuleService, "findBy")
      .mockResolvedValue([
        fakeOwnerRule({ networkDeviceNamePattern: "*0664*" }),
      ]);
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(fakeDeviceDetails({ labels: [] }));
    const createUserSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceOwnerUserService, "create")
      .mockResolvedValue(undefined as never);

    await NetworkDeviceOwnerRuleEngineService.applyRulesToNetworkDevice(
      ruleTarget(),
    );

    expect(createUserSpy).toHaveBeenCalledTimes(1);
    expect(createUserSpy.mock.calls[0]![0].data.userId.toString()).toBe(
      USER_ID.toString(),
    );
  });

  it("adds owner teams too", async () => {
    jest.spyOn(NetworkDeviceOwnerRuleService, "findBy").mockResolvedValue([
      fakeOwnerRule({
        networkDeviceNamePattern: "*0664*",
        ownerUsers: [],
        ownerTeams: [{ id: TEAM_ID } as unknown as Label],
      }),
    ]);
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(fakeDeviceDetails({ labels: [] }));
    const createTeamSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceOwnerTeamService, "create")
      .mockResolvedValue(undefined as never);

    await NetworkDeviceOwnerRuleEngineService.applyRulesToNetworkDevice(
      ruleTarget(),
    );

    expect(createTeamSpy).toHaveBeenCalledTimes(1);
    expect(createTeamSpy.mock.calls[0]![0].data.teamId.toString()).toBe(
      TEAM_ID.toString(),
    );
  });

  it("marks silently-added owners as already notified", async () => {
    jest.spyOn(NetworkDeviceOwnerRuleService, "findBy").mockResolvedValue([
      fakeOwnerRule({
        networkDeviceNamePattern: "*0664*",
        notifyOwners: false,
      }),
    ]);
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(fakeDeviceDetails({ labels: [] }));
    const createUserSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceOwnerUserService, "create")
      .mockResolvedValue(undefined as never);

    await NetworkDeviceOwnerRuleEngineService.applyRulesToNetworkDevice(
      ruleTarget(),
    );

    expect(createUserSpy.mock.calls[0]![0].data.isOwnerNotified).toBe(true);
  });

  it("does not add owners when the pattern does not match", async () => {
    jest
      .spyOn(NetworkDeviceOwnerRuleService, "findBy")
      .mockResolvedValue([
        fakeOwnerRule({ networkDeviceNamePattern: "*0664*" }),
      ]);
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(
        fakeDeviceDetails({ name: "UN0661LANSWI03", labels: [] }),
      );
    const createUserSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceOwnerUserService,
      "create",
    );

    await NetworkDeviceOwnerRuleEngineService.applyRulesToNetworkDevice(
      ruleTarget(),
    );

    expect(createUserSpy).not.toHaveBeenCalled();
  });

  it("never matches - and never throws on - an unparseable pattern", async () => {
    jest
      .spyOn(NetworkDeviceOwnerRuleService, "findBy")
      .mockResolvedValue([
        fakeOwnerRule({ networkDeviceNamePattern: "switch-(01" }),
      ]);
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(fakeDeviceDetails({ labels: [] }));
    const createUserSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceOwnerUserService,
      "create",
    );

    await expect(
      NetworkDeviceOwnerRuleEngineService.applyRulesToNetworkDevice(
        ruleTarget(),
      ),
    ).resolves.toBeUndefined();
    expect(createUserSpy).not.toHaveBeenCalled();
  });

  it("swallows a lookup failure instead of propagating it", async () => {
    jest
      .spyOn(NetworkDeviceOwnerRuleService, "findBy")
      .mockRejectedValue(new Error("database is down"));

    await expect(
      NetworkDeviceOwnerRuleEngineService.applyRulesToNetworkDevice(
        ruleTarget(),
      ),
    ).resolves.toBeUndefined();
  });
});

/*
 * Write-time validation. The engines are forgiving, but a pattern neither
 * reading can rescue is a typo that would fail silently forever - so it is
 * refused where the user can still see the form.
 */
describe("Network device rule pattern validation", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function labelRuleCreate(
    data: Record<string, unknown>,
  ): CreateBy<NetworkDeviceLabelRule> {
    return {
      data: data,
      props: { tenantId: PROJECT_ID },
    } as unknown as CreateBy<NetworkDeviceLabelRule>;
  }

  it("accepts a wildcard name pattern", async () => {
    await expect(
      (NetworkDeviceLabelRuleService as any).onBeforeCreate(
        labelRuleCreate({ networkDeviceNamePattern: "*0664*" }),
      ),
    ).resolves.toBeDefined();
  });

  it("accepts a regex name pattern", async () => {
    await expect(
      (NetworkDeviceLabelRuleService as any).onBeforeCreate(
        labelRuleCreate({ networkDeviceNamePattern: "core-switch-.*" }),
      ),
    ).resolves.toBeDefined();
  });

  it("accepts a rule with no pattern at all", async () => {
    await expect(
      (NetworkDeviceLabelRuleService as any).onBeforeCreate(
        labelRuleCreate({ name: "Tag everything" }),
      ),
    ).resolves.toBeDefined();
  });

  it("rejects a name pattern that can never match", async () => {
    await expect(
      (NetworkDeviceLabelRuleService as any).onBeforeCreate(
        labelRuleCreate({ networkDeviceNamePattern: "switch-(01" }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("rejects a description pattern that can never match", async () => {
    await expect(
      (NetworkDeviceLabelRuleService as any).onBeforeCreate(
        labelRuleCreate({ networkDeviceDescriptionPattern: "[unclosed" }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("names the offending field in the error", async () => {
    await expect(
      (NetworkDeviceLabelRuleService as any).onBeforeCreate(
        labelRuleCreate({ networkDeviceNamePattern: "switch-(01" }),
      ),
    ).rejects.toThrow(/Network Device Name Pattern/);
  });

  it("rejects a bad pattern on update as well as on create", async () => {
    await expect(
      (NetworkDeviceLabelRuleService as any).onBeforeUpdate({
        query: {},
        data: { networkDeviceNamePattern: "+bad" },
        props: { tenantId: PROJECT_ID },
      } as unknown as UpdateBy<NetworkDeviceLabelRule>),
    ).rejects.toThrow(BadDataException);
  });

  it("lets an unrelated update through", async () => {
    await expect(
      (NetworkDeviceLabelRuleService as any).onBeforeUpdate({
        query: {},
        data: { isEnabled: false },
        props: { tenantId: PROJECT_ID },
      } as unknown as UpdateBy<NetworkDeviceLabelRule>),
    ).resolves.toBeDefined();
  });

  it("applies the same validation to owner rules", async () => {
    await expect(
      (NetworkDeviceOwnerRuleService as any).onBeforeCreate({
        data: { networkDeviceNamePattern: "switch-(01" },
        props: { tenantId: PROJECT_ID },
      } as unknown as CreateBy<NetworkDeviceOwnerRule>),
    ).rejects.toThrow(BadDataException);

    await expect(
      (NetworkDeviceOwnerRuleService as any).onBeforeCreate({
        data: { networkDeviceNamePattern: "*0664*" },
        props: { tenantId: PROJECT_ID },
      } as unknown as CreateBy<NetworkDeviceOwnerRule>),
    ).resolves.toBeDefined();
  });
});
