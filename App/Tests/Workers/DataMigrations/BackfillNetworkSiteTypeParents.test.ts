import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import Project from "Common/Models/DatabaseModels/Project";
import NetworkSiteService from "Common/Server/Services/NetworkSiteService";
import NetworkSiteTypeService from "Common/Server/Services/NetworkSiteTypeService";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import BadDataException from "Common/Types/Exception/BadDataException";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import DefaultNetworkSiteType from "Common/Types/NetworkSite/DefaultNetworkSiteType";
import ObjectID from "Common/Types/ObjectID";
import BackfillNetworkSiteTypes from "../../../FeatureSet/Workers/DataMigrations/BackfillNetworkSiteTypes";
import BackfillNetworkSiteTypeParents from "../../../FeatureSet/Workers/DataMigrations/BackfillNetworkSiteTypeParents";

jest.mock("Common/Server/Services/NetworkSiteService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkSiteTypeService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      findBy: jest.fn(),
      updateOneBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { addDefaultNetworkSiteTypes: jest.fn(), findBy: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const networkSiteService: {
  findBy: jest.Mock;
  updateColumnsByIdWithoutHooks: jest.Mock;
} = NetworkSiteService as unknown as {
  findBy: jest.Mock;
  updateColumnsByIdWithoutHooks: jest.Mock;
};
const networkSiteTypeService: {
  create: jest.Mock;
  findBy: jest.Mock;
  updateOneBy: jest.Mock;
} = NetworkSiteTypeService as unknown as {
  create: jest.Mock;
  findBy: jest.Mock;
  updateOneBy: jest.Mock;
};
const projectService: {
  addDefaultNetworkSiteTypes: jest.Mock;
  findBy: jest.Mock;
} = ProjectService as unknown as {
  addDefaultNetworkSiteTypes: jest.Mock;
  findBy: jest.Mock;
};
const mockedLogger: { warn: jest.Mock; error: jest.Mock } =
  logger as unknown as { warn: jest.Mock; error: jest.Mock };

function project(id: ObjectID = ObjectID.generate()): Project {
  return new Project(id);
}

function siteType(data: {
  id?: ObjectID | undefined;
  name: string;
  order?: number | undefined;
  isUnitLevel?: boolean | undefined;
  parentTypeId?: ObjectID | undefined;
}): NetworkSiteType {
  const type: NetworkSiteType = new NetworkSiteType(
    data.id || ObjectID.generate(),
  );
  type.name = data.name;

  if (data.order !== undefined) {
    type.order = data.order;
  }

  type.isUnitLevel = data.isUnitLevel || false;

  if (data.parentTypeId) {
    type.parentNetworkSiteTypeId = data.parentTypeId;
  }

  return type;
}

function site(data: {
  typeId?: ObjectID | undefined;
  parentSiteId?: ObjectID | undefined;
  id?: ObjectID | undefined;
}): NetworkSite {
  const networkSite: NetworkSite = new NetworkSite(
    data.id || ObjectID.generate(),
  );

  if (data.typeId) {
    networkSite.networkSiteTypeId = data.typeId;
  }

  if (data.parentSiteId) {
    networkSite.parentSiteId = data.parentSiteId;
  }

  return networkSite;
}

function legacySite(data: {
  legacyType?: string | undefined;
  id?: ObjectID | undefined;
}): NetworkSite {
  const networkSite: NetworkSite = site({ id: data.id });

  if (data.legacyType !== undefined) {
    networkSite.siteType = data.legacyType;
  }

  return networkSite;
}

function updatedParentByTypeId(): Map<string, string> {
  const result: Map<string, string> = new Map<string, string>();

  for (const call of networkSiteTypeService.updateOneBy.mock.calls) {
    const args: {
      query: { _id: ObjectID };
      data: { parentNetworkSiteTypeId: ObjectID };
    } = call[0] as {
      query: { _id: ObjectID };
      data: { parentNetworkSiteTypeId: ObjectID };
    };
    result.set(
      args.query._id.toString(),
      args.data.parentNetworkSiteTypeId.toString(),
    );
  }

  return result;
}

function rawSqlFor(operator: unknown, column: string): string {
  return (operator as { getSql: (alias: string) => string }).getSql(column);
}

describe("BackfillNetworkSiteTypeParents", () => {
  const migration: BackfillNetworkSiteTypeParents =
    new BackfillNetworkSiteTypeParents();
  let projectId: ObjectID;

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(
        BackfillNetworkSiteTypes.prototype,
        "reconcileIncompleteAssignments",
      )
      .mockResolvedValue(undefined);
    projectId = ObjectID.generate();
    projectService.findBy.mockResolvedValue([project(projectId)] as never);
    networkSiteTypeService.findBy.mockResolvedValue([] as never);
    networkSiteTypeService.updateOneBy.mockResolvedValue(1 as never);
    networkSiteService.findBy.mockResolvedValue([] as never);
    networkSiteService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );
    projectService.addDefaultNetworkSiteTypes.mockResolvedValue(
      undefined as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reruns the historical type assignment reconciliation before deriving parents", async () => {
    await migration.migrate();

    expect(
      BackfillNetworkSiteTypes.prototype.reconcileIncompleteAssignments,
    ).toHaveBeenCalledTimes(1);
    expect(projectService.findBy).toHaveBeenCalledTimes(1);
  });

  test("infers a type parent from the concrete site hierarchy", async () => {
    const parentType: NetworkSiteType = siteType({ name: "Campus" });
    const childType: NetworkSiteType = siteType({ name: "Building" });
    const parentSite: NetworkSite = site({ typeId: parentType.id! });
    const childSite: NetworkSite = site({
      typeId: childType.id!,
      parentSiteId: parentSite.id!,
    });

    networkSiteTypeService.findBy.mockResolvedValue([
      parentType,
      childType,
    ] as never);
    networkSiteService.findBy
      .mockResolvedValueOnce([childSite] as never)
      .mockResolvedValueOnce([parentSite] as never);

    await migration.migrate();

    expect(updatedParentByTypeId()).toEqual(
      new Map<string, string>([
        [childType.id!.toString(), parentType.id!.toString()],
      ]),
    );
  });

  test("does not overwrite a parent assigned after the migration snapshot", async () => {
    const accountType: NetworkSiteType = siteType({
      name: DefaultNetworkSiteType.AccountType,
    });
    const regionType: NetworkSiteType = siteType({
      name: DefaultNetworkSiteType.Region,
    });

    networkSiteTypeService.findBy.mockResolvedValue([
      accountType,
      regionType,
    ] as never);

    /*
     * Another writer filled the parent after findBy returned, so the CAS
     * update matched no row.
     */
    networkSiteTypeService.updateOneBy.mockResolvedValue(0 as never);

    await migration.migrate();

    expect(networkSiteTypeService.updateOneBy).toHaveBeenCalledTimes(1);

    const update: {
      query: Record<string, unknown>;
      data: { parentNetworkSiteTypeId: ObjectID };
      props: { isRoot: boolean };
    } = networkSiteTypeService.updateOneBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      data: { parentNetworkSiteTypeId: ObjectID };
      props: { isRoot: boolean };
    };

    expect(update.query["_id"]!.toString()).toBe(regionType.id!.toString());
    expect(update.query["projectId"]!.toString()).toBe(projectId.toString());
    expect(
      rawSqlFor(
        update.query["parentNetworkSiteTypeId"],
        '"parentNetworkSiteTypeId"',
      ),
    ).toContain("IS NULL");
    expect(update.data.parentNetworkSiteTypeId).toEqual(accountType.id);
    expect(update.props).toEqual({ isRoot: true });

    // Do not claim the edge locally when the guarded write lost the race.
    expect(regionType.parentNetworkSiteTypeId).toBeUndefined();
  });

  test("uses the shared hierarchy for unused default types", async () => {
    const typesByName: Map<DefaultNetworkSiteType, NetworkSiteType> = new Map<
      DefaultNetworkSiteType,
      NetworkSiteType
    >();

    for (const name of Object.values(DefaultNetworkSiteType)) {
      typesByName.set(name, siteType({ name }));
    }

    networkSiteTypeService.findBy.mockResolvedValue([
      ...typesByName.values(),
    ] as never);

    await migration.migrate();

    const updates: Map<string, string> = updatedParentByTypeId();
    expect(updates).toEqual(
      new Map<string, string>([
        [
          typesByName.get(DefaultNetworkSiteType.Region)!.id!.toString(),
          typesByName.get(DefaultNetworkSiteType.AccountType)!.id!.toString(),
        ],
        [
          typesByName.get(DefaultNetworkSiteType.Franchisee)!.id!.toString(),
          typesByName.get(DefaultNetworkSiteType.Region)!.id!.toString(),
        ],
        [
          typesByName.get(DefaultNetworkSiteType.Market)!.id!.toString(),
          typesByName.get(DefaultNetworkSiteType.Franchisee)!.id!.toString(),
        ],
        [
          typesByName.get(DefaultNetworkSiteType.Unit)!.id!.toString(),
          typesByName.get(DefaultNetworkSiteType.Market)!.id!.toString(),
        ],
      ]),
    );
  });

  test("does not guess a parent for an unused custom type", async () => {
    networkSiteTypeService.findBy.mockResolvedValue([
      siteType({ name: "Custom level", order: 99 }),
    ] as never);

    await migration.migrate();

    expect(networkSiteTypeService.updateOneBy).not.toHaveBeenCalled();
  });

  test("keeps an observed root type at the top level", async () => {
    const market: NetworkSiteType = siteType({
      name: DefaultNetworkSiteType.Market,
    });
    networkSiteTypeService.findBy.mockResolvedValue([market] as never);
    networkSiteService.findBy.mockResolvedValue([
      site({ typeId: market.id! }),
    ] as never);

    await migration.migrate();

    expect(networkSiteTypeService.updateOneBy).not.toHaveBeenCalled();
  });

  test("skips a type used by both root and child sites", async () => {
    const parentType: NetworkSiteType = siteType({ name: "Parent" });
    const mixedType: NetworkSiteType = siteType({ name: "Mixed" });
    const parentSite: NetworkSite = site({ typeId: parentType.id! });
    networkSiteTypeService.findBy.mockResolvedValue([
      parentType,
      mixedType,
    ] as never);
    networkSiteService.findBy
      .mockResolvedValueOnce([
        site({ typeId: mixedType.id! }),
        site({ typeId: mixedType.id!, parentSiteId: parentSite.id! }),
      ] as never)
      .mockResolvedValueOnce([parentSite] as never);

    await migration.migrate();

    expect(networkSiteTypeService.updateOneBy).not.toHaveBeenCalled();
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("do not agree on one resolvable parent type"),
    );
  });

  test("skips a type whose sites have different parent types", async () => {
    const firstParentType: NetworkSiteType = siteType({ name: "First" });
    const secondParentType: NetworkSiteType = siteType({ name: "Second" });
    const childType: NetworkSiteType = siteType({ name: "Child" });
    const firstParentSite: NetworkSite = site({
      typeId: firstParentType.id!,
    });
    const secondParentSite: NetworkSite = site({
      typeId: secondParentType.id!,
    });
    networkSiteTypeService.findBy.mockResolvedValue([
      firstParentType,
      secondParentType,
      childType,
    ] as never);
    networkSiteService.findBy
      .mockResolvedValueOnce([
        site({ typeId: childType.id!, parentSiteId: firstParentSite.id! }),
        site({ typeId: childType.id!, parentSiteId: secondParentSite.id! }),
      ] as never)
      .mockResolvedValueOnce([firstParentSite, secondParentSite] as never);

    await migration.migrate();

    expect(networkSiteTypeService.updateOneBy).not.toHaveBeenCalled();
    expect(mockedLogger.warn).toHaveBeenCalledTimes(1);
  });

  test("skips an edge whose parent site has no type", async () => {
    const childType: NetworkSiteType = siteType({ name: "Child" });
    const untypedParent: NetworkSite = site({});
    networkSiteTypeService.findBy.mockResolvedValue([childType] as never);
    networkSiteService.findBy
      .mockResolvedValueOnce([
        site({ typeId: childType.id!, parentSiteId: untypedParent.id! }),
      ] as never)
      .mockResolvedValueOnce([untypedParent] as never);

    await migration.migrate();

    expect(networkSiteTypeService.updateOneBy).not.toHaveBeenCalled();
    expect(mockedLogger.warn).toHaveBeenCalledTimes(1);
  });

  test("never puts a type beneath a unit-level type", async () => {
    const unitType: NetworkSiteType = siteType({
      name: "Unit",
      isUnitLevel: true,
    });
    const childType: NetworkSiteType = siteType({ name: "Closet" });
    const unitSite: NetworkSite = site({ typeId: unitType.id! });
    networkSiteTypeService.findBy.mockResolvedValue([
      unitType,
      childType,
    ] as never);
    networkSiteService.findBy
      .mockResolvedValueOnce([
        site({ typeId: childType.id!, parentSiteId: unitSite.id! }),
      ] as never)
      .mockResolvedValueOnce([unitSite] as never);

    await migration.migrate();

    expect(networkSiteTypeService.updateOneBy).not.toHaveBeenCalled();
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("unit-level type"),
    );
  });

  test("leaves an already migrated type unchanged", async () => {
    const parentType: NetworkSiteType = siteType({ name: "Parent" });
    const childType: NetworkSiteType = siteType({
      name: "Child",
      parentTypeId: parentType.id!,
    });
    networkSiteTypeService.findBy.mockResolvedValue([
      parentType,
      childType,
    ] as never);

    await migration.migrate();

    expect(networkSiteTypeService.updateOneBy).not.toHaveBeenCalled();
  });

  test("continues with another type after an explicitly invalid legacy edge", async () => {
    const parentType: NetworkSiteType = siteType({ name: "Parent" });
    const firstChildType: NetworkSiteType = siteType({
      name: "First child",
      order: 1,
    });
    const secondChildType: NetworkSiteType = siteType({
      name: "Second child",
      order: 2,
    });
    const parentSite: NetworkSite = site({ typeId: parentType.id! });
    networkSiteTypeService.findBy.mockResolvedValue([
      parentType,
      firstChildType,
      secondChildType,
    ] as never);
    networkSiteService.findBy
      .mockResolvedValueOnce([
        site({
          typeId: firstChildType.id!,
          parentSiteId: parentSite.id!,
        }),
        site({
          typeId: secondChildType.id!,
          parentSiteId: parentSite.id!,
        }),
      ] as never)
      .mockResolvedValueOnce([parentSite] as never);
    networkSiteTypeService.updateOneBy
      .mockRejectedValueOnce(
        new BadDataException("legacy hierarchy cycle") as never,
      )
      .mockResolvedValueOnce(1 as never);

    await migration.migrate();

    expect(networkSiteTypeService.updateOneBy).toHaveBeenCalledTimes(2);
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(firstChildType.id!.toString()),
    );
  });

  test("throws after an operational write failure so the migration can retry", async () => {
    const parentType: NetworkSiteType = siteType({ name: "Parent" });
    const childType: NetworkSiteType = siteType({ name: "Child" });
    const parentSite: NetworkSite = site({ typeId: parentType.id! });
    networkSiteTypeService.findBy.mockResolvedValue([
      parentType,
      childType,
    ] as never);
    networkSiteService.findBy
      .mockResolvedValueOnce([
        site({ typeId: childType.id!, parentSiteId: parentSite.id! }),
      ] as never)
      .mockResolvedValueOnce([parentSite] as never);
    networkSiteTypeService.updateOneBy.mockRejectedValueOnce(
      new Error("database unavailable") as never,
    );

    await expect(migration.migrate()).rejects.toThrow(
      "parent backfill failed for 1 project",
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(projectId.toString()),
    );
  });

  test("reads every site page at the LIMIT_MAX boundary", async () => {
    const customType: NetworkSiteType = siteType({ name: "Custom" });
    networkSiteTypeService.findBy.mockResolvedValue([customType] as never);
    networkSiteService.findBy
      .mockResolvedValueOnce(
        Array.from({ length: LIMIT_MAX }, () => {
          return site({ typeId: customType.id! });
        }) as never,
      )
      .mockResolvedValueOnce([] as never);

    await migration.migrate();

    expect(networkSiteService.findBy).toHaveBeenCalledTimes(2);
    expect(networkSiteService.findBy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ skip: 0, limit: LIMIT_MAX }),
    );
    expect(networkSiteService.findBy.mock.calls[1]![0]).toEqual(
      expect.objectContaining({ skip: LIMIT_MAX, limit: LIMIT_MAX }),
    );
  });

  test("reads every project page without trying records missing an id", async () => {
    projectService.findBy
      .mockResolvedValueOnce(
        Array.from({ length: LIMIT_MAX }, () => {
          return new Project();
        }) as never,
      )
      .mockResolvedValueOnce([] as never);

    await migration.migrate();

    expect(projectService.findBy).toHaveBeenCalledTimes(2);
    expect(projectService.findBy.mock.calls[1]![0]).toEqual(
      expect.objectContaining({ skip: LIMIT_MAX, limit: LIMIT_MAX }),
    );
    expect(networkSiteTypeService.findBy).not.toHaveBeenCalled();
  });
});

describe("legacy Network Site Type backfill compatibility", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    projectService.findBy.mockResolvedValue([] as never);
    projectService.addDefaultNetworkSiteTypes.mockResolvedValue(
      undefined as never,
    );
    networkSiteTypeService.findBy.mockResolvedValue([] as never);
    networkSiteService.findBy.mockResolvedValue([] as never);
    networkSiteService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );
  });

  test("does not resurrect a renamed default during targeted reconciliation", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const renamedUnit: NetworkSiteType = siteType({
      name: "Store",
      isUnitLevel: true,
    });
    const oldUnitSite: NetworkSite = legacySite({
      legacyType: DefaultNetworkSiteType.Unit,
    });

    projectService.findBy.mockResolvedValue([project(projectId)] as never);
    networkSiteTypeService.findBy.mockResolvedValue([renamedUnit] as never);
    networkSiteService.findBy.mockResolvedValue([oldUnitSite] as never);

    await new BackfillNetworkSiteTypes().reconcileIncompleteAssignments();

    expect(projectService.addDefaultNetworkSiteTypes).not.toHaveBeenCalled();
    expect(networkSiteTypeService.create).not.toHaveBeenCalled();
    expect(
      networkSiteService.updateColumnsByIdWithoutHooks,
    ).not.toHaveBeenCalled();
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(projectId.toString()),
    );
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(oldUnitSite.id!.toString()),
    );
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(DefaultNetworkSiteType.Unit),
    );
  });

  test("does not recreate a deleted default alongside a surviving catalog", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const survivingRegion: NetworkSiteType = siteType({
      name: DefaultNetworkSiteType.Region,
    });
    const oldUnitSite: NetworkSite = legacySite({
      legacyType: DefaultNetworkSiteType.Unit,
    });

    projectService.findBy.mockResolvedValue([project(projectId)] as never);
    networkSiteTypeService.findBy.mockResolvedValue([survivingRegion] as never);
    networkSiteService.findBy.mockResolvedValue([oldUnitSite] as never);

    await new BackfillNetworkSiteTypes().reconcileIncompleteAssignments();

    expect(projectService.addDefaultNetworkSiteTypes).not.toHaveBeenCalled();
    expect(networkSiteTypeService.create).not.toHaveBeenCalled();
    expect(
      networkSiteService.updateColumnsByIdWithoutHooks,
    ).not.toHaveBeenCalled();
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(DefaultNetworkSiteType.Unit),
    );
  });

  test("does not restore defaults when an administrator deleted the whole catalog", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const oldUnitSite: NetworkSite = legacySite({
      legacyType: DefaultNetworkSiteType.Unit,
    });

    projectService.findBy.mockResolvedValue([project(projectId)] as never);
    networkSiteTypeService.findBy.mockResolvedValue([] as never);
    networkSiteService.findBy.mockResolvedValue([oldUnitSite] as never);

    await new BackfillNetworkSiteTypes().reconcileIncompleteAssignments();

    expect(projectService.addDefaultNetworkSiteTypes).not.toHaveBeenCalled();
    expect(networkSiteTypeService.create).not.toHaveBeenCalled();
    expect(
      networkSiteService.updateColumnsByIdWithoutHooks,
    ).not.toHaveBeenCalled();
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(DefaultNetworkSiteType.Unit),
    );
  });

  test("reconnects a case-insensitive legacy name to a surviving renamed type", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const renamedUnit: NetworkSiteType = siteType({
      name: "Store",
      isUnitLevel: true,
    });
    const storeSite: NetworkSite = legacySite({ legacyType: " store " });

    projectService.findBy.mockResolvedValue([project(projectId)] as never);
    networkSiteTypeService.findBy.mockResolvedValue([renamedUnit] as never);
    networkSiteService.findBy.mockResolvedValue([storeSite] as never);

    await new BackfillNetworkSiteTypes().reconcileIncompleteAssignments();

    expect(projectService.addDefaultNetworkSiteTypes).not.toHaveBeenCalled();
    expect(networkSiteTypeService.create).not.toHaveBeenCalled();
    expect(
      networkSiteService.updateColumnsByIdWithoutHooks,
    ).toHaveBeenCalledWith({
      id: storeSite.id,
      data: { networkSiteTypeId: renamedUnit.id },
      expectedData: {
        networkSiteTypeId: null,
        siteType: " store ",
      },
    });
    expect(mockedLogger.warn).not.toHaveBeenCalled();
  });

  test("does not overwrite a site type assigned after the migration snapshot", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const inferredType: NetworkSiteType = siteType({ name: "Store" });
    const concurrentlyChosenType: NetworkSiteType = siteType({
      name: "Warehouse",
    });
    const staleSite: NetworkSite = legacySite({ legacyType: " Store " });
    let persistedTypeId: ObjectID | null = concurrentlyChosenType.id!;
    const persistedLegacyType: string = staleSite.siteType!;

    projectService.findBy.mockResolvedValue([project(projectId)] as never);
    networkSiteTypeService.findBy.mockResolvedValue([inferredType] as never);
    networkSiteService.findBy.mockResolvedValue([staleSite] as never);
    networkSiteService.updateColumnsByIdWithoutHooks.mockImplementation(
      (async (input: {
        data: { networkSiteTypeId: ObjectID };
        expectedData?: {
          networkSiteTypeId: ObjectID | null;
          siteType: string;
        };
      }): Promise<void> => {
        const expected:
          | {
              networkSiteTypeId: ObjectID | null;
              siteType: string;
            }
          | undefined = input.expectedData;
        const matchesSnapshot: boolean = Boolean(
          expected &&
            expected.networkSiteTypeId === null &&
            persistedTypeId === null &&
            expected.siteType === persistedLegacyType,
        );

        if (!expected || matchesSnapshot) {
          persistedTypeId = input.data.networkSiteTypeId;
        }
      }) as never,
    );

    await new BackfillNetworkSiteTypes().reconcileIncompleteAssignments();

    expect(persistedTypeId!.toString()).toBe(
      concurrentlyChosenType.id!.toString(),
    );
    expect(
      networkSiteService.updateColumnsByIdWithoutHooks,
    ).toHaveBeenCalledWith({
      id: staleSite.id,
      data: { networkSiteTypeId: inferredType.id },
      expectedData: {
        networkSiteTypeId: null,
        /*
         * The lookup is normalized, but the CAS must use the exact stored
         * legacy value to notice an old-pod edit too.
         */
        siteType: " Store ",
      },
    });
  });

  test("keeps historical default seeding and missing-name creation behavior", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const unitType: NetworkSiteType = siteType({
      name: DefaultNetworkSiteType.Unit,
      isUnitLevel: true,
    });
    const customType: NetworkSiteType = siteType({ name: "Warehouse" });
    const unitSite: NetworkSite = legacySite({
      legacyType: DefaultNetworkSiteType.Unit,
    });
    const customSite: NetworkSite = legacySite({ legacyType: "Warehouse" });

    projectService.findBy.mockResolvedValue([project(projectId)] as never);
    networkSiteTypeService.findBy.mockResolvedValue([unitType] as never);
    networkSiteTypeService.create.mockResolvedValue(customType as never);
    networkSiteService.findBy.mockResolvedValue([
      unitSite,
      customSite,
    ] as never);

    await new BackfillNetworkSiteTypes().migrate();

    expect(projectService.addDefaultNetworkSiteTypes).toHaveBeenCalledWith(
      expect.objectContaining({ id: projectId }),
      { setParentRelationships: false },
    );
    expect(networkSiteTypeService.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId,
        name: "Warehouse",
        isUnitLevel: false,
      }),
      props: { isRoot: true },
    });
    expect(
      networkSiteService.updateColumnsByIdWithoutHooks,
    ).toHaveBeenCalledWith({
      id: unitSite.id,
      data: { networkSiteTypeId: unitType.id },
      expectedData: {
        networkSiteTypeId: null,
        siteType: DefaultNetworkSiteType.Unit,
      },
    });
    expect(
      networkSiteService.updateColumnsByIdWithoutHooks,
    ).toHaveBeenCalledWith({
      id: customSite.id,
      data: { networkSiteTypeId: customType.id },
      expectedData: {
        networkSiteTypeId: null,
        siteType: "Warehouse",
      },
    });
  });

  test("keyset-pages past a full batch of unresolved sites", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const unitType: NetworkSiteType = siteType({
      name: DefaultNetworkSiteType.Unit,
    });
    const blankSites: Array<NetworkSite> = Array.from(
      { length: LIMIT_MAX },
      (): NetworkSite => {
        return legacySite({});
      },
    );
    const resolvableSite: NetworkSite = legacySite({
      legacyType: DefaultNetworkSiteType.Unit,
    });

    projectService.findBy.mockResolvedValue([project(projectId)] as never);
    networkSiteTypeService.findBy.mockResolvedValue([unitType] as never);
    networkSiteService.findBy
      .mockResolvedValueOnce(blankSites as never)
      .mockResolvedValueOnce([resolvableSite] as never);

    await new BackfillNetworkSiteTypes().reconcileIncompleteAssignments();

    expect(networkSiteService.findBy).toHaveBeenCalledTimes(2);
    expect(networkSiteService.findBy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        query: expect.not.objectContaining({ _id: expect.anything() }),
        sort: { _id: SortOrder.Ascending },
        skip: 0,
        limit: LIMIT_MAX,
      }),
    );
    expect(networkSiteService.findBy.mock.calls[1]![0]).toEqual(
      expect.objectContaining({
        query: expect.objectContaining({ _id: expect.anything() }),
        sort: { _id: SortOrder.Ascending },
        skip: 0,
        limit: LIMIT_MAX,
      }),
    );
    expect(
      networkSiteService.updateColumnsByIdWithoutHooks,
    ).toHaveBeenCalledWith({
      id: resolvableSite.id,
      data: { networkSiteTypeId: unitType.id },
      expectedData: {
        networkSiteTypeId: null,
        siteType: DefaultNetworkSiteType.Unit,
      },
    });
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("legacy site type is empty"),
    );
  });

  test("loads configured types beyond the first LIMIT_MAX page", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const firstTypePage: Array<NetworkSiteType> = Array.from(
      { length: LIMIT_MAX },
      (_value: unknown, index: number): NetworkSiteType => {
        return siteType({ name: `Custom ${index}` });
      },
    );
    const unitType: NetworkSiteType = siteType({
      name: DefaultNetworkSiteType.Unit,
    });
    const unitSite: NetworkSite = legacySite({
      legacyType: DefaultNetworkSiteType.Unit,
    });

    projectService.findBy.mockResolvedValue([project(projectId)] as never);
    networkSiteTypeService.findBy
      .mockResolvedValueOnce(firstTypePage as never)
      .mockResolvedValueOnce([unitType] as never);
    networkSiteService.findBy.mockResolvedValue([unitSite] as never);

    await new BackfillNetworkSiteTypes().reconcileIncompleteAssignments();

    expect(networkSiteTypeService.findBy).toHaveBeenCalledTimes(2);
    expect(networkSiteTypeService.findBy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        sort: { _id: SortOrder.Ascending },
        skip: 0,
        limit: LIMIT_MAX,
      }),
    );
    expect(networkSiteTypeService.findBy.mock.calls[1]![0]).toEqual(
      expect.objectContaining({
        sort: { _id: SortOrder.Ascending },
        skip: LIMIT_MAX,
        limit: LIMIT_MAX,
      }),
    );
    expect(networkSiteTypeService.create).not.toHaveBeenCalled();
    expect(
      networkSiteService.updateColumnsByIdWithoutHooks,
    ).toHaveBeenCalledWith({
      id: unitSite.id,
      data: { networkSiteTypeId: unitType.id },
      expectedData: {
        networkSiteTypeId: null,
        siteType: DefaultNetworkSiteType.Unit,
      },
    });
  });

  test("continues to later pages before surfacing an operational write failure", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const unitType: NetworkSiteType = siteType({
      name: DefaultNetworkSiteType.Unit,
    });
    const failedSite: NetworkSite = legacySite({
      legacyType: DefaultNetworkSiteType.Unit,
    });
    const laterSite: NetworkSite = legacySite({
      legacyType: DefaultNetworkSiteType.Unit,
    });
    const firstSitePage: Array<NetworkSite> = [
      failedSite,
      ...Array.from({ length: LIMIT_MAX - 1 }, () => {
        return new NetworkSite();
      }),
    ];

    projectService.findBy.mockResolvedValue([project(projectId)] as never);
    networkSiteTypeService.findBy.mockResolvedValue([unitType] as never);
    networkSiteService.findBy
      .mockResolvedValueOnce(firstSitePage as never)
      .mockResolvedValueOnce([laterSite] as never);
    networkSiteService.updateColumnsByIdWithoutHooks
      .mockRejectedValueOnce(new Error("database unavailable") as never)
      .mockResolvedValue(undefined as never);

    await expect(
      new BackfillNetworkSiteTypes().reconcileIncompleteAssignments(),
    ).rejects.toThrow("backfill failed for 1 project");

    expect(
      networkSiteService.updateColumnsByIdWithoutHooks,
    ).toHaveBeenCalledTimes(2);
    expect(
      networkSiteService.updateColumnsByIdWithoutHooks,
    ).toHaveBeenLastCalledWith({
      id: laterSite.id,
      data: { networkSiteTypeId: unitType.id },
      expectedData: {
        networkSiteTypeId: null,
        siteType: DefaultNetworkSiteType.Unit,
      },
    });
  });

  test("is a no-op when targeted reconciliation is rerun after success", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const unitType: NetworkSiteType = siteType({
      name: DefaultNetworkSiteType.Unit,
    });
    const unitSite: NetworkSite = legacySite({
      legacyType: DefaultNetworkSiteType.Unit,
    });

    projectService.findBy.mockResolvedValue([project(projectId)] as never);
    networkSiteTypeService.findBy.mockResolvedValue([unitType] as never);
    networkSiteService.findBy
      .mockResolvedValueOnce([unitSite] as never)
      .mockResolvedValueOnce([] as never);

    const migration: BackfillNetworkSiteTypes = new BackfillNetworkSiteTypes();
    await migration.reconcileIncompleteAssignments();
    await migration.reconcileIncompleteAssignments();

    expect(projectService.addDefaultNetworkSiteTypes).not.toHaveBeenCalled();
    expect(networkSiteTypeService.create).not.toHaveBeenCalled();
    expect(
      networkSiteService.updateColumnsByIdWithoutHooks,
    ).toHaveBeenCalledTimes(1);
  });

  test("warns and leaves blank legacy assignments unresolved", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const blankSite: NetworkSite = legacySite({});

    projectService.findBy.mockResolvedValue([project(projectId)] as never);
    networkSiteService.findBy.mockResolvedValue([blankSite] as never);

    await new BackfillNetworkSiteTypes().reconcileIncompleteAssignments();

    expect(
      networkSiteService.updateColumnsByIdWithoutHooks,
    ).not.toHaveBeenCalled();
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(blankSite.id!.toString()),
    );
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("legacy site type is empty"),
    );
  });

  test("pages through every project before completing", async () => {
    projectService.findBy
      .mockResolvedValueOnce(
        Array.from({ length: LIMIT_MAX }, () => {
          return new Project();
        }) as never,
      )
      .mockResolvedValueOnce([] as never);

    await new BackfillNetworkSiteTypes().migrate();

    expect(projectService.findBy).toHaveBeenCalledTimes(2);
    expect(projectService.findBy.mock.calls[1]![0]).toEqual(
      expect.objectContaining({ skip: LIMIT_MAX, limit: LIMIT_MAX }),
    );
  });

  test("surfaces an operational project failure so the migration retries", async () => {
    const projectId: ObjectID = ObjectID.generate();
    projectService.findBy.mockResolvedValue([project(projectId)] as never);
    projectService.addDefaultNetworkSiteTypes.mockRejectedValue(
      new Error("database unavailable") as never,
    );

    await expect(new BackfillNetworkSiteTypes().migrate()).rejects.toThrow(
      "backfill failed for 1 project",
    );
  });

  test("writes recovered type IDs without invoking the new hierarchy hooks", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const type: NetworkSiteType = siteType({
      name: DefaultNetworkSiteType.Unit,
    });
    const legacySite: NetworkSite = site({});
    legacySite.siteType = DefaultNetworkSiteType.Unit;

    projectService.findBy.mockResolvedValue([project(projectId)] as never);
    projectService.addDefaultNetworkSiteTypes.mockResolvedValue(
      undefined as never,
    );
    networkSiteTypeService.findBy.mockResolvedValue([type] as never);
    networkSiteService.findBy
      .mockResolvedValueOnce([legacySite] as never)
      .mockResolvedValueOnce([] as never);
    networkSiteService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );

    await new BackfillNetworkSiteTypes().migrate();

    expect(projectService.addDefaultNetworkSiteTypes).toHaveBeenCalledWith(
      expect.objectContaining({ id: projectId }),
      { setParentRelationships: false },
    );
    expect(
      networkSiteService.updateColumnsByIdWithoutHooks,
    ).toHaveBeenCalledWith({
      id: legacySite.id,
      data: { networkSiteTypeId: type.id },
      expectedData: {
        networkSiteTypeId: null,
        siteType: DefaultNetworkSiteType.Unit,
      },
    });
  });
});
