import DataSecurityIdentities, {
  IdentityDraft,
  IdentityGrant,
  IdentityStoreFacts,
  MAX_IDENTITIES_PER_PROJECT,
  buildIdentityDrafts,
  identityColumns,
} from "../../../../Server/Utils/DataSecurity/DataSecurityIdentities";
import DataSecurityIdentityService from "../../../../Server/Services/DataSecurityIdentityService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import logger from "../../../../Server/Utils/Logger";
import DataSecurityIdentity from "../../../../Models/DatabaseModels/DataSecurityIdentity";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import DataSensitivity from "../../../../Types/DataSecurity/DataSensitivity";
import {
  DataStoreAccessLevel,
  DataStorePrincipalType,
  UNUSED_ACCESS_DAYS,
} from "../../../../Types/DataSecurity/DataStoreAccess";
import { DataStoreProvider } from "../../../../Types/DataSecurity/DataStoreKind";
import { getIdentityRiskScore } from "../../../../Types/DataSecurity/DataSecurityIdentity";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Who can reach a project's data, one identity at a time
 * (DataSecurityIdentities): every principal of the stores' grants, with
 * what all of its grants add up to - the stores it reaches and how
 * sensitive the most sensitive one is, the data types of its sensitive
 * stores and about how many records they hold, the most it may do and
 * whether it can change sensitive data, who it is, when it was last used
 * and its risk score - and those rows written only when they changed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const APP: string = "arn:aws:iam::123456789012:role/app";

const VAULT: string = "vault";
const PROFILES: string = "profiles";
const WEBSITE: string = "website";
const WIKI: string = "wiki";

function storesOf(): Map<string, IdentityStoreFacts> {
  return new Map<string, IdentityStoreFacts>([
    [
      VAULT,
      {
        sensitivity: DataSensitivity.Restricted,
        dataTypeIds: ["credit-card-number", "email-address"],
        estimatedRecords: 1200000,
        provider: DataStoreProvider.Aws,
      },
    ],
    [
      PROFILES,
      {
        sensitivity: DataSensitivity.Confidential,
        dataTypeIds: ["email-address", "phone-number"],
        estimatedRecords: 50000,
        provider: DataStoreProvider.Aws,
      },
    ],
    [
      WEBSITE,
      {
        sensitivity: DataSensitivity.Public,
        dataTypeIds: [],
        provider: DataStoreProvider.Aws,
      },
    ],
    [
      WIKI,
      {
        sensitivity: DataSensitivity.Internal,
        dataTypeIds: ["document-internal"],
        estimatedRecords: 300,
        provider: DataStoreProvider.Gcp,
      },
    ],
  ]);
}

function grant(
  dataStoreId: string,
  principal: string,
  extra: Partial<IdentityGrant> = {},
): IdentityGrant {
  return {
    dataStoreId,
    principal,
    accessLevel: DataStoreAccessLevel.Read,
    isExternal: false,
    isPublic: false,
    isSeenInTraces: false,
    isUnused: false,
    ...extra,
  };
}

function draftsOf(grants: Array<IdentityGrant>): Map<string, IdentityDraft> {
  return new Map(
    buildIdentityDrafts(grants, storesOf(), NOW).map(
      (draft: IdentityDraft): [string, IdentityDraft] => {
        return [draft.principal, draft];
      },
    ),
  );
}

describe("buildIdentityDrafts: one identity per principal", () => {
  test("what an identity's grants add up to across every store it reaches", () => {
    const app: IdentityDraft = draftsOf([
      grant(VAULT, APP, { principalName: "app", principalType: "Role" }),
      grant(PROFILES, APP, { accessLevel: DataStoreAccessLevel.Write }),
      grant(WEBSITE, APP, { accessLevel: DataStoreAccessLevel.Admin }),
      grant(WIKI, APP),
    ]).get(APP)!;

    expect(app).toEqual({
      identityKey: APP,
      principal: APP,
      principalName: "app",
      principalType: "Role",
      provider: DataStoreProvider.Aws,
      isSeenInTraces: false,
      storeCount: 4,
      sensitiveStoreCount: 2,
      restrictedStoreCount: 1,
      highestSensitivity: DataSensitivity.Restricted,
      highestAccessLevel: DataStoreAccessLevel.Admin,
      canChangeSensitiveData: true,
      isPublic: false,
      isExternal: false,
      isUnused: false,
      // The sensitive stores' data types and records only, each type once.
      dataTypeIds: ["credit-card-number", "email-address", "phone-number"],
      estimatedRecords: 1250000,
      // Restricted 50, can change it 15, two sensitive stores 2.
      riskScore: 67,
      lastUsedAt: undefined,
    });
  });

  test("Admin on a public store is not changing sensitive data; Write on a Confidential one is", () => {
    const drafts: Map<string, IdentityDraft> = draftsOf([
      grant(WEBSITE, "deployer", { accessLevel: DataStoreAccessLevel.Admin }),
      grant(VAULT, "deployer"),
      grant(PROFILES, "editor", { accessLevel: DataStoreAccessLevel.Write }),
    ]);

    expect(drafts.get("deployer")!.canChangeSensitiveData).toBe(false);
    expect(drafts.get("deployer")!.highestAccessLevel).toBe(
      DataStoreAccessLevel.Admin,
    );
    expect(drafts.get("editor")!.canChangeSensitiveData).toBe(true);
  });

  test("a second grant on a store it already reaches counts its level, not the store again", () => {
    const twice: IdentityDraft = draftsOf([
      grant(VAULT, APP, { accessLevel: DataStoreAccessLevel.Read }),
      grant(VAULT, APP, { accessLevel: DataStoreAccessLevel.Write }),
    ]).get(APP)!;

    expect(twice.storeCount).toBe(1);
    expect(twice.restrictedStoreCount).toBe(1);
    expect(twice.estimatedRecords).toBe(1200000);
    expect(twice.canChangeSensitiveData).toBe(true);
    expect(twice.highestAccessLevel).toBe(DataStoreAccessLevel.Write);
  });

  test("anyone on the internet, and an account outside, are said so and score for it", () => {
    const drafts: Map<string, IdentityDraft> = draftsOf([
      grant(VAULT, "*", { isPublic: true, isExternal: true }),
      grant(PROFILES, "210987654321", {
        isExternal: true,
        principalType: DataStorePrincipalType.Account,
      }),
    ]);

    expect(drafts.get("*")).toEqual(
      expect.objectContaining({ isPublic: true, isExternal: true }),
    );
    // Restricted 50, anyone 20, one sensitive store 1.
    expect(drafts.get("*")!.riskScore).toBe(71);
    // Confidential 30, outside 15, one sensitive store 1.
    expect(drafts.get("210987654321")!.riskScore).toBe(46);
  });

  test("unused when a grant says so and none shows it used lately; its last use is its newest", () => {
    const old: Date = new Date(
      NOW.getTime() - (UNUSED_ACCESS_DAYS + 5) * DAY_IN_MS,
    );
    const recent: Date = new Date(NOW.getTime() - DAY_IN_MS);
    const drafts: Map<string, IdentityDraft> = draftsOf([
      grant(VAULT, "old-etl", { isUnused: true, lastUsedAt: old }),
      grant(VAULT, "never-used", { isUnused: true }),
      grant(VAULT, "two-clouds", { isUnused: true }),
      grant(PROFILES, "two-clouds", { lastUsedAt: recent }),
    ]);

    expect(drafts.get("old-etl")).toEqual(
      expect.objectContaining({ isUnused: true, lastUsedAt: old }),
    );
    expect(drafts.get("never-used")).toEqual(
      expect.objectContaining({ isUnused: true, lastUsedAt: undefined }),
    );
    expect(drafts.get("two-clouds")).toEqual(
      expect.objectContaining({ isUnused: false, lastUsedAt: recent }),
    );
  });

  test("a service seen in traces is OneUptime's; its name comes from the grant that has one", () => {
    const service: IdentityDraft = draftsOf([
      grant(WIKI, "66666666-6666-4666-8666-666666666666", {
        isSeenInTraces: true,
        principalType: DataStorePrincipalType.Service,
      }),
      grant(VAULT, "66666666-6666-4666-8666-666666666666", {
        isSeenInTraces: true,
        principalName: "checkout",
        principalType: DataStorePrincipalType.Service,
      }),
    ]).get("66666666-6666-4666-8666-666666666666")!;

    expect(service.provider).toBe(DataStoreProvider.OneUptime);
    expect(service.principalName).toBe("checkout");
    expect(service.isSeenInTraces).toBe(true);
  });

  test("grants of stores the evaluation did not read, and blank principals, are no identity", () => {
    expect(
      buildIdentityDrafts(
        [grant("archived", APP), grant(VAULT, "   ")],
        storesOf(),
        NOW,
      ),
    ).toEqual([]);
  });

  test("a store with nothing sensitive gives no data types and no records", () => {
    const viewer: IdentityDraft = draftsOf([grant(WEBSITE, "viewer")]).get(
      "viewer",
    )!;

    expect(viewer).toEqual(
      expect.objectContaining({
        highestSensitivity: DataSensitivity.Public,
        sensitiveStoreCount: 0,
        dataTypeIds: [],
        estimatedRecords: undefined,
        riskScore: 0,
      }),
    );
  });

  test("the riskiest first, then by principal", () => {
    const drafts: Array<IdentityDraft> = buildIdentityDrafts(
      [
        grant(WEBSITE, "b-viewer"),
        grant(WEBSITE, "a-viewer"),
        grant(VAULT, "z-reader"),
        grant(PROFILES, "m-reader"),
      ],
      storesOf(),
      NOW,
    );

    expect(
      drafts.map((draft: IdentityDraft): string => {
        return draft.principal;
      }),
    ).toEqual(["z-reader", "m-reader", "a-viewer", "b-viewer"]);
    expect(drafts[0]!.riskScore).toBe(
      getIdentityRiskScore({
        highestSensitivity: DataSensitivity.Restricted,
        canChangeSensitiveData: false,
        isPublic: false,
        isExternal: false,
        isUnused: false,
        sensitiveStoreCount: 1,
      }),
    );
  });
});

describe("DataSecurityIdentities.write", () => {
  let table: Array<DataSecurityIdentity>;
  let findSpy: jest.SpyInstance;
  let createSpy: jest.SpyInstance;
  let updateSpy: jest.SpyInstance;
  let deleteSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    table = [];
    findSpy = jest
      .spyOn(DataSecurityIdentityService, "findBy")
      .mockImplementation((async (findBy: { skip: number; limit: number }) => {
        return table.slice(findBy.skip, findBy.skip + findBy.limit);
      }) as never);
    createSpy = jest
      .spyOn(DataSecurityIdentityService, "create")
      .mockImplementation((async (
        createBy: CreateBy<DataSecurityIdentity>,
      ): Promise<DataSecurityIdentity> => {
        createBy.data.id = ObjectID.generate();
        table.push(createBy.data);
        return createBy.data;
      }) as never);
    updateSpy = jest
      .spyOn(DataSecurityIdentityService, "updateColumnsByIdWithoutHooks")
      .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
        const row: DataSecurityIdentity | undefined = table.find(
          (identity: DataSecurityIdentity) => {
            return identity.id?.toString() === data.id.toString();
          },
        );

        for (const [column, value] of Object.entries(data.data)) {
          row?.setColumnValue(column, value as never);
        }
      }) as never);
    deleteSpy = jest
      .spyOn(DataSecurityIdentityService, "deleteOneById")
      .mockImplementation((async (data: { id: ObjectID }) => {
        table = table.filter((identity: DataSecurityIdentity) => {
          return identity.id?.toString() !== data.id.toString();
        });
      }) as never);
    errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function draft(
    principal: string,
    extra: Partial<IdentityDraft> = {},
  ): IdentityDraft {
    return {
      ...buildIdentityDrafts([grant(VAULT, principal)], storesOf(), NOW)[0]!,
      ...extra,
    };
  }

  function write(drafts: Array<IdentityDraft>): Promise<void> {
    return DataSecurityIdentities.write({
      projectId: PROJECT_ID,
      drafts,
      now: NOW,
    });
  }

  test("a new identity is made, as root, with every column and when it was first and last found", async () => {
    const used: Date = new Date(NOW.getTime() - DAY_IN_MS);

    await write([draft(APP, { principalName: "app", lastUsedAt: used })]);

    expect(createSpy).toHaveBeenCalledTimes(1);

    const created: DataSecurityIdentity = table[0]!;

    expect(created.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(created.identityKey).toBe(APP);
    expect(created.principalName).toBe("app");
    expect(created.highestSensitivity).toBe(DataSensitivity.Restricted);
    expect(created.restrictedStoreCount).toBe(1);
    expect(created.dataTypeIds).toEqual([
      "credit-card-number",
      "email-address",
    ]);
    expect(created.lastUsedAt).toEqual(used);
    expect(created.firstSeenAt).toEqual(NOW);
    expect(created.lastSeenAt).toEqual(NOW);
    expect(
      (createSpy.mock.calls[0]![0] as { props: JSONObject }).props,
    ).toEqual({ isRoot: true });
    expect((findSpy.mock.calls[0]![0] as { query: JSONObject }).query).toEqual({
      projectId: PROJECT_ID,
    });
  });

  test("an identity that did not change is not written again; one that did is, with when it was last found", async () => {
    await write([draft(APP), draft("other")]);
    createSpy.mockClear();

    await write([draft(APP), draft("other", { isUnused: true })]);

    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect((updateSpy.mock.calls[0]![0] as { data: JSONObject }).data).toEqual(
      expect.objectContaining({
        isUnused: true,
        lastSeenAt: NOW,
        lastUsedAt: null,
      }),
    );
  });

  test("an identity that reaches nothing any more is removed", async () => {
    await write([draft(APP), draft("gone")]);
    await write([draft(APP)]);

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(
      table.map((identity: DataSecurityIdentity): string => {
        return identity.identityKey || "";
      }),
    ).toEqual([APP]);
  });

  test("an identity that cannot be written is logged, and the others are", async () => {
    createSpy.mockImplementationOnce((async () => {
      throw new Error("conflict");
    }) as never);

    await write([draft("first"), draft("second")]);

    expect(errorSpy).toHaveBeenCalledWith(
      `DataSecurity: could not write the identity first of project ${PROJECT_ID.toString()}:`,
    );
    expect(table).toHaveLength(1);
  });

  test("every column an identity writes is a column of DataSecurityIdentity", () => {
    const columns: Set<string> = new Set(
      Object.keys(getTableColumns(new DataSecurityIdentity())),
    );

    for (const column of Object.keys(identityColumns(draft(APP)))) {
      expect([column, columns.has(column)]).toEqual([column, true]);
    }

    expect(MAX_IDENTITIES_PER_PROJECT).toBe(20000);
  });
});
