import IncomingCallPolicy from "../../../Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyPhoneNumber from "../../../Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncomingCallPolicyPhoneNumberService from "../../../Server/Services/IncomingCallPolicyPhoneNumberService";
import IncomingCallPolicyService from "../../../Server/Services/IncomingCallPolicyService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import Query from "../../../Server/Types/Database/Query";
import releaseIncomingCallPhoneNumber from "../../../Server/Utils/IncomingCallPhoneNumber";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/IncomingCallPhoneNumber", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

const POLICY_A: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const POLICY_B: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CONFIG_A: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const CONFIG_B: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

const releasePhoneNumber: jest.Mock =
  releaseIncomingCallPhoneNumber as unknown as jest.Mock;

type ProviderConfigUpdateData =
  | { projectCallSMSConfigId: ObjectID | null }
  | {
      projectCallSMSConfig:
        | ProjectCallSMSConfig
        | ObjectID
        | string
        | { id?: ObjectID | string | null; _id?: string | null }
        | null;
    };

function makePolicy(data: {
  id?: ObjectID | undefined;
  configId?: ObjectID | undefined;
  legacySid?: string | undefined;
  legacyPhone?: string | undefined;
}): IncomingCallPolicy {
  const item: IncomingCallPolicy = new IncomingCallPolicy();
  if (data.id) {
    item.id = data.id;
  }
  if (data.configId) {
    item.projectCallSMSConfigId = data.configId;
  }
  if (data.legacySid) {
    item.callProviderPhoneNumberId = data.legacySid;
  }
  if (data.legacyPhone) {
    item.routingPhoneNumber = new Phone(data.legacyPhone);
  }
  return item;
}

function makePhoneNumber(data: {
  id?: string | undefined;
  policyId?: ObjectID | undefined;
  configId?: ObjectID | undefined;
  sid?: string | undefined;
  phone?: string | undefined;
  countryCode?: string | undefined;
  areaCode?: string | undefined;
  purchasedAt?: Date | undefined;
}): IncomingCallPolicyPhoneNumber {
  const item: IncomingCallPolicyPhoneNumber =
    new IncomingCallPolicyPhoneNumber();
  if (data.id) {
    item.id = new ObjectID(data.id);
  }
  if (data.policyId) {
    item.incomingCallPolicyId = data.policyId;
  }
  if (data.configId) {
    item.projectCallSMSConfigId = data.configId;
  }
  if (data.sid) {
    item.callProviderPhoneNumberId = data.sid;
  }
  if (data.phone) {
    item.phoneNumber = new Phone(data.phone);
  }
  if (data.countryCode !== undefined) {
    item.countryCode = data.countryCode;
  }
  if (data.areaCode !== undefined) {
    item.areaCode = data.areaCode;
  }
  if (data.purchasedAt) {
    item.phoneNumberPurchasedAt = data.purchasedAt;
  }
  return item;
}

function makeConfig(id?: ObjectID): ProjectCallSMSConfig {
  const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
  if (id) {
    config.id = id;
  }
  return config;
}

function silenceLogger(): void {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
}

describe("IncomingCallPolicyPhoneNumberService primary compatibility mirror", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    releasePhoneNumber.mockResolvedValue(undefined);
    silenceLogger();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("mirrors the oldest attached number and every legacy scalar field", async () => {
    const purchasedAt: Date = new Date("2026-09-11T08:00:00.000Z");
    const primary: IncomingCallPolicyPhoneNumber = makePhoneNumber({
      policyId: POLICY_A,
      configId: CONFIG_A,
      sid: "PN-primary",
      phone: "+14155550101",
      countryCode: "US",
      areaCode: "415",
      purchasedAt,
    });

    const findPrimary: any = jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findOneBy")
      .mockResolvedValue(primary);
    const updatePolicy: any = jest
      .spyOn(DatabaseService.prototype, "updateOneById")
      .mockResolvedValue(undefined as never);

    await IncomingCallPolicyPhoneNumberService.syncPrimaryPhoneNumberToPolicy(
      POLICY_A,
    );

    expect(findPrimary).toHaveBeenCalledWith({
      query: { incomingCallPolicyId: POLICY_A },
      select: {
        phoneNumber: true,
        callProviderPhoneNumberId: true,
        projectCallSMSConfigId: true,
        countryCode: true,
        areaCode: true,
        phoneNumberPurchasedAt: true,
      },
      sort: { createdAt: "ASC", _id: "ASC" },
      props: { isRoot: true },
    });
    expect(updatePolicy).toHaveBeenCalledWith({
      id: POLICY_A,
      data: {
        routingPhoneNumber: primary.phoneNumber,
        callProviderPhoneNumberId: "PN-primary",
        projectCallSMSConfigId: CONFIG_A,
        phoneNumberCountryCode: "US",
        phoneNumberAreaCode: "415",
        phoneNumberPurchasedAt: purchasedAt,
      },
      props: { isRoot: true },
    });
  });

  test("clears phone scalars but preserves the selected config when no numbers remain", async () => {
    jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findOneBy")
      .mockResolvedValue(null);
    const updatePolicy: any = jest
      .spyOn(DatabaseService.prototype, "updateOneById")
      .mockResolvedValue(undefined as never);

    await IncomingCallPolicyPhoneNumberService.syncPrimaryPhoneNumberToPolicy(
      POLICY_A,
    );

    expect(updatePolicy).toHaveBeenCalledWith({
      id: POLICY_A,
      data: {
        routingPhoneNumber: null,
        callProviderPhoneNumberId: null,
        phoneNumberCountryCode: null,
        phoneNumberAreaCode: null,
        phoneNumberPurchasedAt: null,
      },
      props: { isRoot: true },
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        updatePolicy.mock.calls[0]?.[0].data,
        "projectCallSMSConfigId",
      ),
    ).toBe(false);
  });

  test("creating a second or third row repairs the mirror without rejecting the row", async () => {
    const created: IncomingCallPolicyPhoneNumber = makePhoneNumber({
      id: "33333333-3333-4333-8333-333333333333",
      policyId: POLICY_A,
      configId: CONFIG_A,
      sid: "PN-third",
      phone: "+14155550103",
    });
    const sync: any = jest
      .spyOn(
        IncomingCallPolicyPhoneNumberService,
        "syncPrimaryPhoneNumberToPolicy",
      )
      .mockResolvedValue(undefined);

    const returned: IncomingCallPolicyPhoneNumber = await (
      IncomingCallPolicyPhoneNumberService as any
    ).onCreateSuccess({ carryForward: null }, created);

    expect(returned).toBe(created);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith(POLICY_A);
  });

  test("a mirror failure after create is logged but never turns a committed child into a failed create", async () => {
    const created: IncomingCallPolicyPhoneNumber = makePhoneNumber({
      id: "33333333-3333-4333-8333-333333333333",
      policyId: POLICY_A,
      configId: CONFIG_A,
      sid: "PN-second",
      phone: "+14155550102",
    });
    const failure: Error = new Error("legacy policy update failed");
    jest
      .spyOn(
        IncomingCallPolicyPhoneNumberService,
        "syncPrimaryPhoneNumberToPolicy",
      )
      .mockRejectedValue(failure);

    await expect(
      (IncomingCallPolicyPhoneNumberService as any).onCreateSuccess(
        { carryForward: null },
        created,
      ),
    ).resolves.toBe(created);

    expect(logger.error).toHaveBeenCalledWith(
      `Failed to mirror incoming call phone numbers to policy ${POLICY_A.toString()}`,
    );
    expect(logger.error).toHaveBeenCalledWith(failure);
  });

  test("delete hooks deduplicate affected policies and reselect a new primary after deletion", async () => {
    jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findBy")
      .mockResolvedValue([
        makePhoneNumber({ policyId: POLICY_A }),
        makePhoneNumber({ policyId: POLICY_A }),
        makePhoneNumber({ policyId: POLICY_B }),
        makePhoneNumber({}),
      ]);

    const beforeDelete: any = await (
      IncomingCallPolicyPhoneNumberService as any
    ).onBeforeDelete({
      query: { projectCallSMSConfigId: CONFIG_A },
      limit: 100,
      skip: 0,
      props: { isRoot: true },
    });

    expect(
      beforeDelete.carryForward.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([POLICY_A.toString(), POLICY_B.toString()]);

    const sync: any = jest
      .spyOn(
        IncomingCallPolicyPhoneNumberService,
        "syncPrimaryPhoneNumberToPolicy",
      )
      .mockResolvedValue(undefined);

    await (IncomingCallPolicyPhoneNumberService as any).onDeleteSuccess(
      beforeDelete,
      [],
    );

    expect(sync).toHaveBeenCalledTimes(2);
    expect(
      sync.mock.calls.map((call: Array<ObjectID>) => {
        return call[0]?.toString();
      }),
    ).toEqual([POLICY_A.toString(), POLICY_B.toString()]);
  });
});

describe("IncomingCallPolicyService provider-config update invariant", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    silenceLogger();
    jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockImplementation(
        async (
          _modelType: { new (): IncomingCallPolicy },
          query: Query<IncomingCallPolicy>,
        ): Promise<Query<IncomingCallPolicy>> => {
          return query;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    [
      "projectCallSMSConfigId to another config",
      { projectCallSMSConfigId: CONFIG_B },
    ],
    ["projectCallSMSConfigId to null", { projectCallSMSConfigId: null }],
    [
      "projectCallSMSConfig relation to another config",
      { projectCallSMSConfig: makeConfig(CONFIG_B) },
    ],
    [
      "plain projectCallSMSConfig relation to another config",
      { projectCallSMSConfig: { _id: CONFIG_B.toString() } },
    ],
    [
      "ObjectID projectCallSMSConfig relation to another config",
      { projectCallSMSConfig: CONFIG_B },
    ],
    [
      "string projectCallSMSConfig relation to another config",
      { projectCallSMSConfig: CONFIG_B.toString() },
    ],
    ["projectCallSMSConfig relation to null", { projectCallSMSConfig: null }],
  ])(
    "blocks %s while any affected policy has a child number",
    async (_label: string, data: ProviderConfigUpdateData): Promise<void> => {
      const updateBy: any = {
        query: { projectId: new ObjectID("project-a") },
        data,
        limit: 25,
        skip: 5,
        props: { isRoot: false },
      };
      jest
        .spyOn(IncomingCallPolicyService, "findBy")
        .mockResolvedValue([makePolicy({ id: POLICY_A, configId: CONFIG_A })]);
      jest
        .spyOn(IncomingCallPolicyPhoneNumberService, "findOneBy")
        .mockResolvedValue(makePhoneNumber({ policyId: POLICY_A }));

      await expect(
        (IncomingCallPolicyService as any).onBeforeUpdate(updateBy),
      ).rejects.toThrow(
        "Release all phone numbers before changing the Twilio configuration.",
      );
    },
  );

  test("allows an unrelated policy edit without even querying attached numbers", async () => {
    const findPolicies: any = jest.spyOn(IncomingCallPolicyService, "findBy");
    const findPhoneNumber: any = jest.spyOn(
      IncomingCallPolicyPhoneNumberService,
      "findOneBy",
    );
    const updateBy: any = {
      query: { _id: POLICY_A },
      data: { name: "Renamed policy" },
      limit: 1,
      skip: 0,
      props: { isRoot: false },
    };

    await expect(
      (IncomingCallPolicyService as any).onBeforeUpdate(updateBy),
    ).resolves.toEqual({ updateBy, carryForward: null });

    expect(findPolicies).not.toHaveBeenCalled();
    expect(findPhoneNumber).not.toHaveBeenCalled();
  });

  test.each([
    ["the id field", { projectCallSMSConfigId: CONFIG_B }],
    ["the id field to null", { projectCallSMSConfigId: null }],
    ["the relation field", { projectCallSMSConfig: makeConfig(CONFIG_B) }],
    ["the relation field to null", { projectCallSMSConfig: null }],
  ])(
    "allows changing %s when affected policies have zero child numbers",
    async (_label: string, data: ProviderConfigUpdateData): Promise<void> => {
      const updateBy: any = {
        query: { _id: POLICY_A },
        data,
        limit: 1,
        skip: 0,
        props: { isRoot: false },
      };
      jest
        .spyOn(IncomingCallPolicyService, "findBy")
        .mockResolvedValue([makePolicy({ id: POLICY_A, configId: CONFIG_A })]);
      jest
        .spyOn(IncomingCallPolicyPhoneNumberService, "findOneBy")
        .mockResolvedValue(null);

      await expect(
        (IncomingCallPolicyService as any).onBeforeUpdate(updateBy),
      ).resolves.toEqual({ updateBy, carryForward: null });
    },
  );

  test("checks the exact update batch using its query, limit, skip, and every policy id", async () => {
    const updateBy: any = {
      query: { projectId: new ObjectID("project-a"), name: "Batch" },
      data: { projectCallSMSConfigId: CONFIG_B },
      limit: 17,
      skip: 9,
      props: { isRoot: false },
    };
    const findPolicies: any = jest
      .spyOn(IncomingCallPolicyService, "findBy")
      .mockResolvedValue([
        makePolicy({ id: POLICY_A }),
        makePolicy({ id: POLICY_B }),
        makePolicy({}),
      ]);
    const findPhoneNumber: any = jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findOneBy")
      .mockResolvedValue(makePhoneNumber({ policyId: POLICY_B }));

    await expect(
      (IncomingCallPolicyService as any).onBeforeUpdate(updateBy),
    ).rejects.toThrow("Release all phone numbers");

    expect(findPolicies).toHaveBeenCalledWith({
      query: updateBy.query,
      select: {
        _id: true,
        projectCallSMSConfigId: true,
        routingPhoneNumber: true,
        callProviderPhoneNumberId: true,
      },
      limit: 17,
      skip: 9,
      props: { isRoot: true },
    });
    const phoneQuery: any =
      findPhoneNumber.mock.calls[0]?.[0].query.incomingCallPolicyId;
    expect(phoneQuery.getSql("phone.incomingCallPolicyId")).toMatch(
      /phone\.incomingCallPolicyId IN/,
    );
    expect(Object.values(phoneQuery.objectLiteralParameters)).toEqual([
      [POLICY_A.toString(), POLICY_B.toString()],
    ]);
    expect(findPhoneNumber.mock.calls[0]?.[0]).toMatchObject({
      select: { _id: true },
      props: { isRoot: true },
    });
  });

  test("blocks changing provider config for a scalar-only legacy policy", async () => {
    const updateBy: any = {
      query: { _id: POLICY_A },
      data: { projectCallSMSConfigId: CONFIG_B },
      limit: 1,
      skip: 0,
      props: { isRoot: false },
    };
    const findPolicies: any = jest
      .spyOn(IncomingCallPolicyService, "findBy")
      .mockResolvedValue([
        makePolicy({
          id: POLICY_A,
          configId: CONFIG_A,
          legacySid: "PN-legacy-only",
        }),
      ]);
    const findPhoneNumber: any = jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findOneBy")
      .mockResolvedValue(null);

    await expect(
      (IncomingCallPolicyService as any).onBeforeUpdate(updateBy),
    ).rejects.toThrow(
      "Release all phone numbers before changing the Twilio configuration.",
    );

    expect(findPolicies).toHaveBeenCalledWith({
      query: updateBy.query,
      select: {
        _id: true,
        projectCallSMSConfigId: true,
        routingPhoneNumber: true,
        callProviderPhoneNumberId: true,
      },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });
    expect(findPhoneNumber).not.toHaveBeenCalled();
  });

  test("allows a config update that matches no policies without querying children", async () => {
    const updateBy: any = {
      query: { _id: POLICY_A },
      data: { projectCallSMSConfigId: null },
      limit: 1,
      skip: 0,
      props: { isRoot: false },
    };
    jest.spyOn(IncomingCallPolicyService, "findBy").mockResolvedValue([]);
    const findPhoneNumber: any = jest.spyOn(
      IncomingCallPolicyPhoneNumberService,
      "findOneBy",
    );

    await expect(
      (IncomingCallPolicyService as any).onBeforeUpdate(updateBy),
    ).resolves.toEqual({ updateBy, carryForward: null });
    expect(findPhoneNumber).not.toHaveBeenCalled();
  });

  test.each([
    ["the id field", { projectCallSMSConfigId: CONFIG_A }],
    ["the relation field", { projectCallSMSConfig: makeConfig(CONFIG_A) }],
    [
      "a plain relation field",
      { projectCallSMSConfig: { _id: CONFIG_A.toString() } },
    ],
    ["an ObjectID relation field", { projectCallSMSConfig: CONFIG_A }],
    ["a string relation field", { projectCallSMSConfig: CONFIG_A.toString() }],
    [
      "an uppercase id field",
      {
        projectCallSMSConfigId: new ObjectID(CONFIG_A.toString().toUpperCase()),
      },
    ],
    [
      "an uppercase persisted relation id",
      {
        projectCallSMSConfig: {
          _id: CONFIG_A.toString().toUpperCase(),
        },
      },
    ],
    [
      "matching public and persisted relation ids",
      {
        projectCallSMSConfig: {
          id: CONFIG_A,
          _id: CONFIG_A.toString().toUpperCase(),
        },
      },
    ],
  ])(
    "allows an idempotent config update through %s while numbers are attached",
    async (_label: string, data: ProviderConfigUpdateData): Promise<void> => {
      const updateBy: any = {
        query: { _id: POLICY_A },
        data,
        limit: 1,
        skip: 0,
        props: { isRoot: false },
      };
      jest.spyOn(IncomingCallPolicyService, "findBy").mockResolvedValue([
        makePolicy({
          id: POLICY_A,
          configId: CONFIG_A,
          legacySid: "PN-primary",
        }),
      ]);
      const findPhoneNumber: any = jest.spyOn(
        IncomingCallPolicyPhoneNumberService,
        "findOneBy",
      );

      await expect(
        (IncomingCallPolicyService as any).onBeforeUpdate(updateBy),
      ).resolves.toEqual({ updateBy, carryForward: null });

      expect(findPhoneNumber).not.toHaveBeenCalled();
    },
  );

  test("rejects conflicting public and persisted relation ids before reading policies", async () => {
    const findPolicies: any = jest.spyOn(IncomingCallPolicyService, "findBy");
    const checkPermission: any = jest.spyOn(
      ModelPermission,
      "checkUpdateQueryPermissions",
    );
    const updateBy: any = {
      query: { _id: POLICY_A },
      data: {
        projectCallSMSConfig: {
          id: CONFIG_A,
          _id: CONFIG_B.toString(),
        },
      },
      limit: 1,
      skip: 0,
      props: { isRoot: false },
    };

    await expect(
      (IncomingCallPolicyService as any).onBeforeUpdate(updateBy),
    ).rejects.toThrow("Conflicting Twilio configuration identifiers");

    expect(checkPermission).not.toHaveBeenCalled();
    expect(findPolicies).not.toHaveBeenCalled();
  });

  test("permission-scopes the update query before inspecting policies", async () => {
    const originalQuery: any = { _id: POLICY_A };
    const scopedQuery: any = {
      _id: POLICY_A,
      projectId: new ObjectID("allowed-project"),
    };
    const updateBy: any = {
      query: originalQuery,
      data: { projectCallSMSConfigId: CONFIG_B },
      limit: 1,
      skip: 0,
      props: { isRoot: false, tenantId: new ObjectID("allowed-project") },
    };
    const checkPermission: any = jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockResolvedValue(scopedQuery);
    const findPolicies: any = jest
      .spyOn(IncomingCallPolicyService, "findBy")
      .mockResolvedValue([]);
    const findPhoneNumber: any = jest.spyOn(
      IncomingCallPolicyPhoneNumberService,
      "findOneBy",
    );

    await expect(
      (IncomingCallPolicyService as any).onBeforeUpdate(updateBy),
    ).resolves.toEqual({ updateBy, carryForward: null });

    expect(checkPermission).toHaveBeenCalledWith(
      IncomingCallPolicy,
      originalQuery,
      updateBy.data,
      updateBy.props,
    );
    expect(findPolicies).toHaveBeenCalledWith(
      expect.objectContaining({ query: scopedQuery }),
    );
    expect(findPhoneNumber).not.toHaveBeenCalled();
  });
});

describe("IncomingCallPolicyService multi-number cleanup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    releasePhoneNumber.mockResolvedValue(undefined);
    silenceLogger();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("releases every attached number across every policy and skips incomplete rows", async () => {
    const policies: Array<IncomingCallPolicy> = [
      makePolicy({
        id: POLICY_A,
        configId: CONFIG_A,
        legacySid: "PN-a1",
      }),
      makePolicy({
        id: POLICY_B,
        configId: CONFIG_B,
        legacySid: "PN-legacy-b",
      }),
      makePolicy({ configId: CONFIG_A, legacySid: "PN-no-policy-id" }),
    ];
    jest.spyOn(IncomingCallPolicyService, "findBy").mockResolvedValue(policies);
    const findPhoneNumbers: any = jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findAllBy")
      .mockImplementation(
        (args: any): Promise<Array<IncomingCallPolicyPhoneNumber>> => {
          if (
            args.query.incomingCallPolicyId.toString() === POLICY_A.toString()
          ) {
            return Promise.resolve([
              makePhoneNumber({
                policyId: POLICY_A,
                configId: CONFIG_A,
                sid: "PN-a1",
              }),
              makePhoneNumber({
                policyId: POLICY_A,
                configId: CONFIG_A,
                sid: "PN-a2",
              }),
              makePhoneNumber({ policyId: POLICY_A, configId: CONFIG_A }),
              makePhoneNumber({ policyId: POLICY_A, sid: "PN-no-config" }),
            ]);
          }

          return Promise.resolve([
            makePhoneNumber({
              policyId: POLICY_B,
              configId: CONFIG_B,
              sid: "PN-b1",
            }),
          ]);
        },
      );

    await (IncomingCallPolicyService as any).onBeforeDelete({
      query: { projectId: new ObjectID("project-a") },
      limit: 100,
      skip: 0,
      props: { isRoot: true },
    });

    expect(findPhoneNumbers).toHaveBeenCalledTimes(2);
    expect(findPhoneNumbers.mock.calls[0]?.[0]).toEqual({
      query: { incomingCallPolicyId: POLICY_A },
      select: {
        callProviderPhoneNumberId: true,
        projectCallSMSConfigId: true,
      },
      props: { isRoot: true },
    });
    expect(findPhoneNumbers.mock.calls[1]?.[0]).toEqual({
      query: { incomingCallPolicyId: POLICY_B },
      select: {
        callProviderPhoneNumberId: true,
        projectCallSMSConfigId: true,
      },
      props: { isRoot: true },
    });
    expect(releasePhoneNumber.mock.calls).toEqual([
      [
        {
          projectCallSMSConfigId: CONFIG_A,
          callProviderPhoneNumberId: "PN-a1",
        },
      ],
      [
        {
          projectCallSMSConfigId: CONFIG_A,
          callProviderPhoneNumberId: "PN-a2",
        },
      ],
      [
        {
          projectCallSMSConfigId: CONFIG_B,
          callProviderPhoneNumberId: "PN-b1",
        },
      ],
      [
        {
          projectCallSMSConfigId: CONFIG_B,
          callProviderPhoneNumberId: "PN-legacy-b",
        },
      ],
    ]);
  });

  test("does not double-release the scalar mirror of a child row", async () => {
    jest.spyOn(IncomingCallPolicyService, "findBy").mockResolvedValue([
      makePolicy({
        id: POLICY_A,
        configId: CONFIG_A,
        legacySid: "PN-primary",
      }),
    ]);
    jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findAllBy")
      .mockResolvedValue([
        makePhoneNumber({
          policyId: POLICY_A,
          configId: CONFIG_A,
          sid: "PN-primary",
        }),
        makePhoneNumber({
          policyId: POLICY_A,
          configId: CONFIG_A,
          sid: "PN-secondary",
        }),
      ]);

    await (IncomingCallPolicyService as any).onBeforeDelete({
      query: { _id: POLICY_A },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    expect(releasePhoneNumber).toHaveBeenCalledTimes(2);
    expect(
      releasePhoneNumber.mock.calls.map((call: Array<any>) => {
        return call[0].callProviderPhoneNumberId;
      }),
    ).toEqual(["PN-primary", "PN-secondary"]);
  });

  test("keeps scalar-only rolling-upgrade policies releasable", async () => {
    jest.spyOn(IncomingCallPolicyService, "findBy").mockResolvedValue([
      makePolicy({
        id: POLICY_A,
        configId: CONFIG_A,
        legacySid: "PN-legacy-only",
      }),
    ]);
    jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findAllBy")
      .mockResolvedValue([]);

    await (IncomingCallPolicyService as any).onBeforeDelete({
      query: { _id: POLICY_A },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    expect(releasePhoneNumber).toHaveBeenCalledTimes(1);
    expect(releasePhoneNumber).toHaveBeenCalledWith({
      projectCallSMSConfigId: CONFIG_A,
      callProviderPhoneNumberId: "PN-legacy-only",
    });
  });

  test("propagates provider failures so policy retry metadata is not deleted", async () => {
    jest.spyOn(IncomingCallPolicyService, "findBy").mockResolvedValue([
      makePolicy({
        id: POLICY_A,
        configId: CONFIG_A,
        legacySid: "PN-primary",
      }),
    ]);
    jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findAllBy")
      .mockResolvedValue([
        makePhoneNumber({
          policyId: POLICY_A,
          configId: CONFIG_A,
          sid: "PN-primary",
        }),
      ]);
    releasePhoneNumber.mockRejectedValue(
      new Error("provider unavailable") as never,
    );

    await expect(
      (IncomingCallPolicyService as any).onBeforeDelete({
        query: { _id: POLICY_A },
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      }),
    ).rejects.toThrow("provider unavailable");

    expect(releasePhoneNumber).toHaveBeenCalledTimes(1);
  });

  test("pins the final policy delete to the exact snapshotted ids", async () => {
    const originalQuery: any = {
      name: "Production",
      projectId: new ObjectID("allowed-project"),
    };
    const scopedQuery: any = {
      ...originalQuery,
      _isAccessible: true,
    };
    jest
      .spyOn(ModelPermission, "checkDeleteQueryPermission")
      .mockResolvedValue(scopedQuery);
    const findPolicies: any = jest
      .spyOn(IncomingCallPolicyService, "findBy")
      .mockResolvedValue([
        makePolicy({ id: POLICY_A }),
        makePolicy({ id: POLICY_B }),
      ]);
    jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findAllBy")
      .mockResolvedValue([]);
    const deleteBy: any = {
      query: originalQuery,
      limit: 17,
      skip: 9,
      props: { isRoot: false, tenantId: new ObjectID("allowed-project") },
    };

    const result: OnDelete<IncomingCallPolicy> = await (
      IncomingCallPolicyService as any
    ).onBeforeDelete(deleteBy);

    expect(findPolicies).toHaveBeenCalledWith(
      expect.objectContaining({
        query: scopedQuery,
        limit: 17,
        skip: 9,
      }),
    );
    expect(Object.keys(result.deleteBy.query)).toEqual(["_id"]);
    const pinnedIds: any = (result.deleteBy.query as any)._id;
    expect(Object.values(pinnedIds.objectLiteralParameters)).toEqual([
      [POLICY_A.toString(), POLICY_B.toString()],
    ]);
    expect(result.deleteBy.limit).toBe(2);
    expect(result.deleteBy.skip).toBe(0);
  });

  test("permission-scopes the exact policy delete window before provider side effects", async () => {
    const originalQuery: any = { _id: POLICY_A };
    const scopedQuery: any = {
      _id: POLICY_A,
      projectId: new ObjectID("allowed-project"),
    };
    const checkPermission: any = jest
      .spyOn(ModelPermission, "checkDeleteQueryPermission")
      .mockResolvedValue(scopedQuery);
    const findPolicies: any = jest
      .spyOn(IncomingCallPolicyService, "findBy")
      .mockResolvedValue([]);
    const findPhoneNumbers: any = jest.spyOn(
      IncomingCallPolicyPhoneNumberService,
      "findAllBy",
    );
    const deleteBy: any = {
      query: originalQuery,
      limit: 1,
      skip: 2,
      props: { isRoot: false, tenantId: new ObjectID("allowed-project") },
    };

    const result: OnDelete<IncomingCallPolicy> = await (
      IncomingCallPolicyService as any
    ).onBeforeDelete(deleteBy);

    expect(checkPermission).toHaveBeenCalledWith(
      IncomingCallPolicy,
      originalQuery,
      deleteBy.props,
    );
    expect(findPolicies).toHaveBeenCalledWith(
      expect.objectContaining({
        query: scopedQuery,
        limit: 1,
        skip: 2,
      }),
    );
    expect(findPhoneNumbers).not.toHaveBeenCalled();
    expect(releasePhoneNumber).not.toHaveBeenCalled();
    expect(Object.keys(result.deleteBy.query)).toEqual(["_id"]);
    const emptyIds: any = (result.deleteBy.query as any)._id;
    expect(emptyIds.getSql("policy._id")).toBe("TRUE = FALSE");
    expect(Object.keys(emptyIds.objectLiteralParameters)).toHaveLength(0);
    expect(result.deleteBy.limit).toBe(0);
    expect(result.deleteBy.skip).toBe(0);
  });
});

describe("ProjectCallSMSConfigService multi-number cleanup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    releasePhoneNumber.mockResolvedValue(undefined);
    silenceLogger();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("releases all child rows, deletes only rows for that config, and clears scalar mirrors", async () => {
    const childPrimary: IncomingCallPolicyPhoneNumber = makePhoneNumber({
      id: "33333333-3333-4333-8333-333333333333",
      policyId: POLICY_A,
      configId: CONFIG_A,
      sid: "PN-a1",
    });
    const childSecond: IncomingCallPolicyPhoneNumber = makePhoneNumber({
      id: "44444444-4444-4444-8444-444444444444",
      policyId: POLICY_A,
      configId: CONFIG_A,
      sid: "PN-a2",
    });

    jest
      .spyOn(ProjectCallSMSConfigService, "findBy")
      .mockResolvedValue([makeConfig(CONFIG_A), makeConfig(undefined)]);
    const findPhoneNumbers: any = jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findAllBy")
      .mockResolvedValue([childPrimary, childSecond]);
    const deleteChildren: any = jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "deleteBy")
      .mockResolvedValue(2 as never);
    const findPolicies: any = jest
      .spyOn(IncomingCallPolicyService, "findAllBy")
      .mockResolvedValue([
        makePolicy({
          id: POLICY_A,
          configId: CONFIG_A,
          legacySid: "PN-a1",
        }),
        makePolicy({
          id: POLICY_B,
          configId: CONFIG_A,
          legacySid: "PN-legacy-only",
        }),
      ]);
    jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findOneBy")
      .mockResolvedValue(null);
    const clearPolicy: any = jest
      .spyOn(IncomingCallPolicyService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await (ProjectCallSMSConfigService as any).onBeforeDelete({
      query: { _id: CONFIG_A },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    expect(releasePhoneNumber.mock.calls).toEqual([
      [
        {
          projectCallSMSConfigId: CONFIG_A,
          callProviderPhoneNumberId: "PN-a1",
        },
      ],
      [
        {
          projectCallSMSConfigId: CONFIG_A,
          callProviderPhoneNumberId: "PN-a2",
        },
      ],
      [
        {
          projectCallSMSConfigId: CONFIG_A,
          callProviderPhoneNumberId: "PN-legacy-only",
        },
      ],
    ]);
    expect(findPhoneNumbers).toHaveBeenCalledWith({
      query: { projectCallSMSConfigId: CONFIG_A },
      select: {
        _id: true,
        callProviderPhoneNumberId: true,
        projectCallSMSConfigId: true,
      },
      props: { isRoot: true },
    });
    expect(findPolicies).toHaveBeenCalledWith({
      query: { projectCallSMSConfigId: CONFIG_A },
      select: {
        _id: true,
        callProviderPhoneNumberId: true,
        projectCallSMSConfigId: true,
      },
      props: { isRoot: true },
    });
    expect(deleteChildren).toHaveBeenCalledTimes(1);
    const deleteChildIds: any = deleteChildren.mock.calls[0]?.[0].query._id;
    expect(Object.values(deleteChildIds.objectLiteralParameters)).toEqual([
      [childPrimary.id!.toString(), childSecond.id!.toString()],
    ]);
    expect(deleteChildren.mock.calls[0]?.[0]).toMatchObject({
      limit: 2,
      skip: 0,
      props: { isRoot: true },
    });
    expect(clearPolicy).toHaveBeenCalledTimes(2);
    for (const call of clearPolicy.mock.calls) {
      expect(call[0].data).toEqual({
        routingPhoneNumber: null,
        callProviderPhoneNumberId: null,
        phoneNumberCountryCode: null,
        phoneNumberAreaCode: null,
        phoneNumberPurchasedAt: null,
      });
    }
  });

  test("releases unmatched legacy state before real child delete hooks clear the mirror", async () => {
    const events: Array<string> = [];
    const child: IncomingCallPolicyPhoneNumber = makePhoneNumber({
      id: "33333333-3333-4333-8333-333333333333",
      policyId: POLICY_A,
      configId: CONFIG_A,
      sid: "PN-child",
    });
    const childServiceWithHooks: {
      onBeforeDelete: (
        deleteBy: DeleteBy<IncomingCallPolicyPhoneNumber>,
      ) => Promise<OnDelete<IncomingCallPolicyPhoneNumber>>;
      onDeleteSuccess: (
        onDelete: OnDelete<IncomingCallPolicyPhoneNumber>,
        itemIdsBeforeDelete: Array<ObjectID>,
      ) => Promise<OnDelete<IncomingCallPolicyPhoneNumber>>;
    } = IncomingCallPolicyPhoneNumberService as unknown as {
      onBeforeDelete: (
        deleteBy: DeleteBy<IncomingCallPolicyPhoneNumber>,
      ) => Promise<OnDelete<IncomingCallPolicyPhoneNumber>>;
      onDeleteSuccess: (
        onDelete: OnDelete<IncomingCallPolicyPhoneNumber>,
        itemIdsBeforeDelete: Array<ObjectID>,
      ) => Promise<OnDelete<IncomingCallPolicyPhoneNumber>>;
    };

    releasePhoneNumber.mockImplementation(
      async (data: { callProviderPhoneNumberId: string }): Promise<void> => {
        events.push(`release:${data.callProviderPhoneNumberId}`);
      },
    );
    jest
      .spyOn(ProjectCallSMSConfigService, "findBy")
      .mockResolvedValue([makeConfig(CONFIG_A)]);
    jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findAllBy")
      .mockResolvedValue([child]);
    jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findBy")
      .mockResolvedValue([child]);
    jest.spyOn(IncomingCallPolicyService, "findAllBy").mockResolvedValue([
      makePolicy({
        id: POLICY_A,
        configId: CONFIG_A,
        legacySid: "PN-legacy-unmatched",
      }),
    ]);
    jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findOneBy")
      .mockResolvedValue(null);

    const beforeDeleteHook: any = jest.spyOn(
      childServiceWithHooks,
      "onBeforeDelete",
    );
    const deleteSuccessHook: any = jest.spyOn(
      childServiceWithHooks,
      "onDeleteSuccess",
    );
    const clearPolicy: any = jest
      .spyOn(IncomingCallPolicyService, "updateOneById")
      .mockResolvedValue(1);
    const mirrorPolicy: any = jest
      .spyOn(DatabaseService.prototype, "updateOneById")
      .mockImplementation(async (): Promise<number> => {
        events.push("mirror-cleared");
        return 1;
      });
    const deleteChildren: any = jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "deleteBy")
      .mockImplementation(
        async (
          deleteBy: DeleteBy<IncomingCallPolicyPhoneNumber>,
        ): Promise<number> => {
          const onDelete: OnDelete<IncomingCallPolicyPhoneNumber> =
            await childServiceWithHooks.onBeforeDelete(deleteBy);
          events.push("children-deleted");
          await childServiceWithHooks.onDeleteSuccess(onDelete, [child.id!]);
          return 1;
        },
      );

    await (ProjectCallSMSConfigService as any).onBeforeDelete({
      query: { _id: CONFIG_A },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    expect(events).toEqual([
      "release:PN-child",
      "release:PN-legacy-unmatched",
      "children-deleted",
      "mirror-cleared",
    ]);
    const exactChildIds: any = deleteChildren.mock.calls[0]?.[0].query._id;
    expect(Object.values(exactChildIds.objectLiteralParameters)).toEqual([
      [child.id!.toString()],
    ]);
    expect(deleteChildren.mock.calls[0]?.[0]).toMatchObject({
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });
    expect(beforeDeleteHook).toHaveBeenCalledTimes(1);
    expect(deleteSuccessHook).toHaveBeenCalledTimes(1);
    expect(mirrorPolicy).toHaveBeenCalledWith({
      id: POLICY_A,
      data: {
        routingPhoneNumber: null,
        callProviderPhoneNumberId: null,
        phoneNumberCountryCode: null,
        phoneNumberAreaCode: null,
        phoneNumberPurchasedAt: null,
      },
      props: { isRoot: true },
    });
    expect(clearPolicy).toHaveBeenCalledTimes(1);
  });

  test("does not release a child-backed scalar primary twice", async () => {
    jest
      .spyOn(ProjectCallSMSConfigService, "findBy")
      .mockResolvedValue([makeConfig(CONFIG_A)]);
    jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findAllBy")
      .mockResolvedValue([
        makePhoneNumber({
          id: "33333333-3333-4333-8333-333333333333",
          policyId: POLICY_A,
          configId: CONFIG_A,
          sid: "PN-primary",
        }),
      ]);
    jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "deleteBy")
      .mockResolvedValue(1 as never);
    jest.spyOn(IncomingCallPolicyService, "findAllBy").mockResolvedValue([
      makePolicy({
        id: POLICY_A,
        configId: CONFIG_A,
        legacySid: "PN-primary",
      }),
    ]);
    jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findOneBy")
      .mockResolvedValue(null);
    jest
      .spyOn(IncomingCallPolicyService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await (ProjectCallSMSConfigService as any).onBeforeDelete({
      query: { _id: CONFIG_A },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    expect(releasePhoneNumber).toHaveBeenCalledTimes(1);
    expect(releasePhoneNumber).toHaveBeenCalledWith({
      projectCallSMSConfigId: CONFIG_A,
      callProviderPhoneNumberId: "PN-primary",
    });
  });

  test("promotes a surviving number and its config when the old config is deleted", async () => {
    const survivingNumber: IncomingCallPolicyPhoneNumber = makePhoneNumber({
      policyId: POLICY_A,
      configId: CONFIG_B,
      sid: "PN-survives",
      phone: "+14155550102",
      countryCode: "US",
      areaCode: "415",
    });
    jest
      .spyOn(ProjectCallSMSConfigService, "findBy")
      .mockResolvedValue([makeConfig(CONFIG_A)]);
    jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findAllBy")
      .mockResolvedValue([
        makePhoneNumber({
          id: "33333333-3333-4333-8333-333333333333",
          policyId: POLICY_A,
          configId: CONFIG_A,
          sid: "PN-old-config",
        }),
      ]);
    jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "deleteBy")
      .mockResolvedValue(1 as never);
    jest.spyOn(IncomingCallPolicyService, "findAllBy").mockResolvedValue([
      makePolicy({
        id: POLICY_A,
        configId: CONFIG_A,
        legacySid: "PN-old-config",
      }),
    ]);
    jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findOneBy")
      .mockResolvedValueOnce(survivingNumber)
      .mockResolvedValueOnce(survivingNumber);
    const clearPolicy: any = jest
      .spyOn(IncomingCallPolicyService, "updateOneById")
      .mockResolvedValue(undefined as never);
    const mirrorPolicy: any = jest
      .spyOn(DatabaseService.prototype, "updateOneById")
      .mockResolvedValue(undefined as never);

    await (ProjectCallSMSConfigService as any).onBeforeDelete({
      query: { _id: CONFIG_A },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    expect(clearPolicy).not.toHaveBeenCalled();
    expect(mirrorPolicy).toHaveBeenCalledWith({
      id: POLICY_A,
      data: {
        routingPhoneNumber: survivingNumber.phoneNumber,
        callProviderPhoneNumberId: "PN-survives",
        projectCallSMSConfigId: CONFIG_B,
        phoneNumberCountryCode: "US",
        phoneNumberAreaCode: "415",
        phoneNumberPurchasedAt: null,
      },
      props: { isRoot: true },
    });
    expect(releasePhoneNumber).toHaveBeenCalledWith({
      projectCallSMSConfigId: CONFIG_A,
      callProviderPhoneNumberId: "PN-old-config",
    });
    expect(releasePhoneNumber).not.toHaveBeenCalledWith(
      expect.objectContaining({ callProviderPhoneNumberId: "PN-survives" }),
    );
  });

  test("deletes more than LIMIT_MAX snapshotted child rows in exact id batches", async () => {
    const childCount: number = 10_001;
    const phoneNumbers: Array<IncomingCallPolicyPhoneNumber> = Array.from(
      { length: childCount },
      (_value: unknown, index: number): IncomingCallPolicyPhoneNumber => {
        return makePhoneNumber({
          id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
        });
      },
    );
    jest
      .spyOn(ProjectCallSMSConfigService, "findBy")
      .mockResolvedValue([makeConfig(CONFIG_A)]);
    const findPhoneNumbers: any = jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findAllBy")
      .mockResolvedValue(phoneNumbers);
    jest.spyOn(IncomingCallPolicyService, "findAllBy").mockResolvedValue([]);
    const deleteChildren: any = jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "deleteBy")
      .mockResolvedValue(0 as never);

    await (ProjectCallSMSConfigService as any).onBeforeDelete({
      query: { _id: CONFIG_A },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    expect(findPhoneNumbers).toHaveBeenCalledWith({
      query: { projectCallSMSConfigId: CONFIG_A },
      select: {
        _id: true,
        callProviderPhoneNumberId: true,
        projectCallSMSConfigId: true,
      },
      props: { isRoot: true },
    });
    expect(deleteChildren).toHaveBeenCalledTimes(2);
    expect(
      Object.values(
        deleteChildren.mock.calls[0]?.[0].query._id.objectLiteralParameters,
      )[0],
    ).toHaveLength(10_000);
    expect(deleteChildren.mock.calls[0]?.[0]).toMatchObject({
      limit: 10_000,
      skip: 0,
      props: { isRoot: true },
    });
    const lastBatchIds: any = Object.values(
      deleteChildren.mock.calls[1]?.[0].query._id.objectLiteralParameters,
    )[0];
    expect(lastBatchIds).toEqual([phoneNumbers[10_000]!.id!.toString()]);
    expect(deleteChildren.mock.calls[1]?.[0]).toMatchObject({
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });
    expect(releasePhoneNumber).not.toHaveBeenCalled();
  });

  test("does not delete child rows when a provider release fails", async () => {
    jest
      .spyOn(ProjectCallSMSConfigService, "findBy")
      .mockResolvedValue([makeConfig(CONFIG_A)]);
    jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findAllBy")
      .mockResolvedValue([
        makePhoneNumber({
          id: "33333333-3333-4333-8333-333333333333",
          policyId: POLICY_A,
          configId: CONFIG_A,
          sid: "PN-primary",
        }),
      ]);
    jest.spyOn(IncomingCallPolicyService, "findAllBy").mockResolvedValue([]);
    const deleteChildren: any = jest.spyOn(
      IncomingCallPolicyPhoneNumberService,
      "deleteBy",
    );
    releasePhoneNumber.mockRejectedValue(
      new Error("provider unavailable") as never,
    );

    await expect(
      (ProjectCallSMSConfigService as any).onBeforeDelete({
        query: { _id: CONFIG_A },
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      }),
    ).rejects.toThrow("provider unavailable");

    expect(deleteChildren).not.toHaveBeenCalled();
  });

  test("pins the final config delete to the exact snapshotted ids", async () => {
    const originalQuery: any = {
      name: "Twilio",
      projectId: new ObjectID("allowed-project"),
    };
    const scopedQuery: any = {
      ...originalQuery,
      _isAccessible: true,
    };
    jest
      .spyOn(ModelPermission, "checkDeleteQueryPermission")
      .mockResolvedValue(scopedQuery);
    const findConfigs: any = jest
      .spyOn(ProjectCallSMSConfigService, "findBy")
      .mockResolvedValue([makeConfig(CONFIG_A), makeConfig(CONFIG_B)]);
    jest
      .spyOn(IncomingCallPolicyPhoneNumberService, "findAllBy")
      .mockResolvedValue([]);
    jest.spyOn(IncomingCallPolicyService, "findAllBy").mockResolvedValue([]);
    const deleteBy: any = {
      query: originalQuery,
      limit: 11,
      skip: 4,
      props: { isRoot: false, tenantId: new ObjectID("allowed-project") },
    };

    const result: OnDelete<ProjectCallSMSConfig> = await (
      ProjectCallSMSConfigService as any
    ).onBeforeDelete(deleteBy);

    expect(findConfigs).toHaveBeenCalledWith(
      expect.objectContaining({
        query: scopedQuery,
        limit: 11,
        skip: 4,
      }),
    );
    expect(Object.keys(result.deleteBy.query)).toEqual(["_id"]);
    const pinnedIds: any = (result.deleteBy.query as any)._id;
    expect(Object.values(pinnedIds.objectLiteralParameters)).toEqual([
      [CONFIG_A.toString(), CONFIG_B.toString()],
    ]);
    expect(result.deleteBy.limit).toBe(2);
    expect(result.deleteBy.skip).toBe(0);
  });

  test("permission-scopes the exact config delete window before number cleanup", async () => {
    const originalQuery: any = { _id: CONFIG_A };
    const scopedQuery: any = {
      _id: CONFIG_A,
      projectId: new ObjectID("allowed-project"),
    };
    const checkPermission: any = jest
      .spyOn(ModelPermission, "checkDeleteQueryPermission")
      .mockResolvedValue(scopedQuery);
    const findConfigs: any = jest
      .spyOn(ProjectCallSMSConfigService, "findBy")
      .mockResolvedValue([]);
    const findPhoneNumbers: any = jest.spyOn(
      IncomingCallPolicyPhoneNumberService,
      "findAllBy",
    );
    const findPolicies: any = jest.spyOn(
      IncomingCallPolicyService,
      "findAllBy",
    );
    const deleteChildren: any = jest.spyOn(
      IncomingCallPolicyPhoneNumberService,
      "deleteBy",
    );
    const deleteBy: any = {
      query: originalQuery,
      limit: 1,
      skip: 3,
      props: { isRoot: false, tenantId: new ObjectID("allowed-project") },
    };

    const result: OnDelete<ProjectCallSMSConfig> = await (
      ProjectCallSMSConfigService as any
    ).onBeforeDelete(deleteBy);

    expect(checkPermission).toHaveBeenCalledWith(
      ProjectCallSMSConfig,
      originalQuery,
      deleteBy.props,
    );
    expect(findConfigs).toHaveBeenCalledWith(
      expect.objectContaining({
        query: scopedQuery,
        limit: 1,
        skip: 3,
      }),
    );
    expect(findPhoneNumbers).not.toHaveBeenCalled();
    expect(findPolicies).not.toHaveBeenCalled();
    expect(deleteChildren).not.toHaveBeenCalled();
    expect(releasePhoneNumber).not.toHaveBeenCalled();
    expect(Object.keys(result.deleteBy.query)).toEqual(["_id"]);
    const emptyIds: any = (result.deleteBy.query as any)._id;
    expect(emptyIds.getSql("config._id")).toBe("TRUE = FALSE");
    expect(Object.keys(emptyIds.objectLiteralParameters)).toHaveLength(0);
    expect(result.deleteBy.limit).toBe(0);
    expect(result.deleteBy.skip).toBe(0);
  });
});
