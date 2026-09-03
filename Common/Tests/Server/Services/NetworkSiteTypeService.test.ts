import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import NetworkSiteTypeService from "../../../Server/Services/NetworkSiteTypeService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import NetworkSiteHierarchyLock, {
  NETWORK_SITE_HIERARCHY_ROOT_SCOPE_ERROR_MESSAGE,
} from "../../../Server/Utils/NetworkSite/NetworkSiteHierarchyLock";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "../../../Models/DatabaseModels/NetworkSiteType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * NetworkSiteService imports the complete monitoring/alerting service graph.
 * This suite tests NetworkSiteTypeService at its service boundary, so replace
 * that collaborator before modules load; the individual tests still spy and
 * assert every site read made through the boundary.
 */
jest.mock("../../../Server/Services/NetworkSiteService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findOneBy: jest.fn(),
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function typeId(index: number): ObjectID {
  return new ObjectID(
    `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString().padStart(12, "0")}`,
  );
}

function siteId(index: number): ObjectID {
  return new ObjectID(
    `bbbbbbbb-bbbb-4bbb-8bbb-${index.toString().padStart(12, "0")}`,
  );
}

function makeType(data: {
  index: number;
  projectId?: ObjectID | undefined;
  parentIndex?: number | undefined;
  isUnitLevel?: boolean | undefined;
  order?: number | null | undefined;
}): NetworkSiteType {
  const networkSiteType: NetworkSiteType = new NetworkSiteType();
  networkSiteType.id = typeId(data.index);
  networkSiteType.projectId = data.projectId || PROJECT_ID;

  if (data.isUnitLevel !== undefined) {
    networkSiteType.isUnitLevel = data.isUnitLevel;
  }

  if (typeof data.order === "number") {
    networkSiteType.order = data.order;
  }

  if (data.parentIndex !== undefined) {
    networkSiteType.parentNetworkSiteTypeId = typeId(data.parentIndex);
  }

  return networkSiteType;
}

function makeSite(data: {
  index: number;
  typeIndex?: number | undefined;
  parentIndex?: number | undefined;
}): NetworkSite {
  const site: NetworkSite = new NetworkSite();
  site.id = siteId(data.index);

  if (data.typeIndex !== undefined) {
    site.networkSiteTypeId = typeId(data.typeIndex);
  }

  if (data.parentIndex !== undefined) {
    site.parentSiteId = siteId(data.parentIndex);
  }

  return site;
}

function createBy(data: Partial<NetworkSiteType>): CreateBy<NetworkSiteType> {
  const networkSiteType: NetworkSiteType = new NetworkSiteType();
  networkSiteType.projectId = PROJECT_ID;
  networkSiteType.name = "New Type";
  Object.assign(networkSiteType, data);

  return {
    data: networkSiteType,
    props: { isRoot: true },
  };
}

function updateBy(
  data: Record<string, unknown>,
  props: Record<string, unknown> = { isRoot: true },
): UpdateBy<NetworkSiteType> {
  return {
    query: { _id: typeId(2).toString() },
    data,
    limit: new PositiveNumber(1),
    skip: new PositiveNumber(0),
    props,
  } as unknown as UpdateBy<NetworkSiteType>;
}

function deleteBy(
  props: Record<string, unknown> = { isRoot: true },
): DeleteBy<NetworkSiteType> {
  return {
    query: { _id: typeId(2).toString() },
    limit: new PositiveNumber(1),
    skip: new PositiveNumber(0),
    props,
  } as unknown as DeleteBy<NetworkSiteType>;
}

/*
 * Configure the three type reads made by a parent update: rows matched by the
 * update, all project types for cycle detection, and destination siblings for
 * automatic order assignment.
 */
function mockParentUpdate(data: {
  moving?: NetworkSiteType | undefined;
  parent?: NetworkSiteType | null | undefined;
  projectTypes?: Array<NetworkSiteType> | undefined;
  siblings?: Array<NetworkSiteType> | undefined;
}): void {
  const moving: NetworkSiteType =
    data.moving || makeType({ index: 2, parentIndex: 1 });

  jest
    .spyOn(NetworkSiteTypeService, "findOneById")
    .mockResolvedValue(
      data.parent === undefined ? makeType({ index: 4 }) : data.parent,
    );

  jest
    .spyOn(NetworkSiteTypeService, "findBy")
    .mockImplementation(async (findBy: any) => {
      if (findBy.skip > 0) {
        return [];
      }

      if (findBy.query?._id) {
        return [moving];
      }

      if (findBy.query?.parentNetworkSiteTypeId !== undefined) {
        return data.siblings || [];
      }

      return data.projectTypes || [moving];
    });
}

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe("NetworkSiteTypeService create hierarchy validation", () => {
  it("accepts an ID parent in the same project and appends after the maximum numbered sibling", async () => {
    jest
      .spyOn(NetworkSiteTypeService, "findOneById")
      .mockResolvedValue(makeType({ index: 1 }));
    jest
      .spyOn(NetworkSiteTypeService, "findBy")
      .mockResolvedValue([
        makeType({ index: 3, order: null }),
        makeType({ index: 4, order: 7 }),
        makeType({ index: 5, order: 2 }),
      ]);
    const input: CreateBy<NetworkSiteType> = createBy({
      parentNetworkSiteTypeId: typeId(1),
    });

    await (NetworkSiteTypeService as any).onBeforeCreate(input);

    expect(input.data.order).toBe(8);
    expect(NetworkSiteTypeService.findOneById).toHaveBeenCalledWith(
      expect.objectContaining({ id: typeId(1) }),
    );
  });

  it("accepts the relation-object spelling used by entity pickers", async () => {
    const parent: NetworkSiteType = makeType({ index: 1 });
    jest.spyOn(NetworkSiteTypeService, "findOneById").mockResolvedValue(parent);
    jest.spyOn(NetworkSiteTypeService, "findBy").mockResolvedValue([]);

    await expect(
      (NetworkSiteTypeService as any).onBeforeCreate(
        createBy({ parentNetworkSiteType: parent }),
      ),
    ).resolves.toBeDefined();
  });

  it("rejects conflicting relation and ID parent values", async () => {
    const parent: NetworkSiteType = makeType({ index: 1 });

    await expect(
      (NetworkSiteTypeService as any).onBeforeCreate(
        createBy({
          parentNetworkSiteTypeId: typeId(3),
          parentNetworkSiteType: parent,
        }),
      ),
    ).rejects.toThrow("Conflicting parent Network Site Type references");
  });

  it("rejects a non-null relation object that does not carry an ID", async () => {
    await expect(
      (NetworkSiteTypeService as any).onBeforeCreate(
        createBy({
          parentNetworkSiteType: {} as NetworkSiteType,
        }),
      ),
    ).rejects.toThrow("must contain a valid Network Site Type ID");
  });

  it("rejects a raw SQL parent expression", async () => {
    await expect(
      (NetworkSiteTypeService as any).onBeforeCreate(
        createBy({
          parentNetworkSiteTypeId: (() => {
            return "some SQL";
          }) as unknown as ObjectID,
        }),
      ),
    ).rejects.toThrow("cannot be set to a raw SQL expression");
  });

  it("rejects a raw SQL isUnitLevel expression on create", async () => {
    await expect(
      (NetworkSiteTypeService as any).onBeforeCreate(
        createBy({
          isUnitLevel: (() => {
            return true;
          }) as unknown as boolean,
        }),
      ),
    ).rejects.toThrow("unit-level leaf rules must be validated");
  });

  it("rejects a missing parent", async () => {
    jest.spyOn(NetworkSiteTypeService, "findOneById").mockResolvedValue(null);

    await expect(
      (NetworkSiteTypeService as any).onBeforeCreate(
        createBy({ parentNetworkSiteTypeId: typeId(1) }),
      ),
    ).rejects.toThrow(
      new BadDataException("Parent Network Site Type not found."),
    );
  });

  it("rejects a parent from another project", async () => {
    jest
      .spyOn(NetworkSiteTypeService, "findOneById")
      .mockResolvedValue(makeType({ index: 1, projectId: OTHER_PROJECT_ID }));

    await expect(
      (NetworkSiteTypeService as any).onBeforeCreate(
        createBy({ parentNetworkSiteTypeId: typeId(1) }),
      ),
    ).rejects.toThrow("must belong to the same project");
  });

  it("rejects a unit-level parent", async () => {
    jest
      .spyOn(NetworkSiteTypeService, "findOneById")
      .mockResolvedValue(makeType({ index: 1, isUnitLevel: true }));

    await expect(
      (NetworkSiteTypeService as any).onBeforeCreate(
        createBy({ parentNetworkSiteTypeId: typeId(1) }),
      ),
    ).rejects.toThrow("unit-level Network Site Type cannot have child types");
  });

  it("rejects self-parenting when a server-side caller supplies the new ID", async () => {
    await expect(
      (NetworkSiteTypeService as any).onBeforeCreate(
        createBy({ id: typeId(2), parentNetworkSiteTypeId: typeId(2) }),
      ),
    ).rejects.toThrow("cannot be its own parent");
  });

  it("assigns the next root sibling order when no parent is supplied", async () => {
    const findOneByIdSpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteTypeService,
      "findOneById",
    );
    jest
      .spyOn(NetworkSiteTypeService, "findBy")
      .mockResolvedValue([
        makeType({ index: 1, order: 3 }),
        makeType({ index: 3, order: 9 }),
      ]);
    const input: CreateBy<NetworkSiteType> = createBy({});

    await (NetworkSiteTypeService as any).onBeforeCreate(input);

    expect(input.data.order).toBe(10);
    expect(findOneByIdSpy).not.toHaveBeenCalled();
  });

  it("preserves an explicitly supplied order without reading siblings", async () => {
    const findBySpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteTypeService,
      "findBy",
    );
    const input: CreateBy<NetworkSiteType> = createBy({ order: 42 });

    await (NetworkSiteTypeService as any).onBeforeCreate(input);

    expect(input.data.order).toBe(42);
    expect(findBySpy).not.toHaveBeenCalled();
  });
});

describe("NetworkSiteTypeService update hierarchy validation", () => {
  it("rejects moving a type to another project", async () => {
    jest
      .spyOn(NetworkSiteTypeService, "findBy")
      .mockResolvedValue([makeType({ index: 2 })]);

    await expect(
      (NetworkSiteTypeService as any).onBeforeUpdate(
        updateBy({ projectId: OTHER_PROJECT_ID }),
      ),
    ).rejects.toThrow("cannot be moved to another project");
  });

  it("accepts a valid ID parent move and places the type last among its new siblings", async () => {
    mockParentUpdate({
      parent: makeType({ index: 4 }),
      siblings: [
        makeType({ index: 6, order: 2 }),
        makeType({ index: 7, order: 5 }),
      ],
    });
    jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue([]);
    const input: UpdateBy<NetworkSiteType> = updateBy({
      parentNetworkSiteTypeId: typeId(4),
    });

    await (NetworkSiteTypeService as any).onBeforeUpdate(input);

    expect(input.data.order).toBe(6);
  });

  it("accepts the relation-object parent spelling on update", async () => {
    const parent: NetworkSiteType = makeType({ index: 4 });
    mockParentUpdate({ parent });
    jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue([]);

    await expect(
      (NetworkSiteTypeService as any).onBeforeUpdate(
        updateBy({ parentNetworkSiteType: parent }),
      ),
    ).resolves.toBeDefined();
  });

  it("rejects conflicting relation and ID values before reading target rows", async () => {
    const findBySpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteTypeService,
      "findBy",
    );

    await expect(
      (NetworkSiteTypeService as any).onBeforeUpdate(
        updateBy({
          parentNetworkSiteTypeId: typeId(3),
          parentNetworkSiteType: makeType({ index: 4 }),
        }),
      ),
    ).rejects.toThrow("Conflicting parent Network Site Type references");
    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("rejects self-parenting", async () => {
    mockParentUpdate({ moving: makeType({ index: 2 }) });

    await expect(
      (NetworkSiteTypeService as any).onBeforeUpdate(
        updateBy({ parentNetworkSiteTypeId: typeId(2) }),
      ),
    ).rejects.toThrow("cannot be its own parent");
  });

  it("rejects moving a type under its direct child", async () => {
    const moving: NetworkSiteType = makeType({ index: 2 });
    const child: NetworkSiteType = makeType({
      index: 3,
      parentIndex: 2,
    });
    mockParentUpdate({
      moving,
      parent: child,
      projectTypes: [moving, child],
    });

    await expect(
      (NetworkSiteTypeService as any).onBeforeUpdate(
        updateBy({ parentNetworkSiteTypeId: typeId(3) }),
      ),
    ).rejects.toThrow("cannot be moved under one of its descendants");
  });

  it("rejects moving a type under a deeper descendant", async () => {
    const moving: NetworkSiteType = makeType({ index: 2 });
    const child: NetworkSiteType = makeType({ index: 3, parentIndex: 2 });
    const grandchild: NetworkSiteType = makeType({
      index: 4,
      parentIndex: 3,
    });
    mockParentUpdate({
      moving,
      parent: grandchild,
      projectTypes: [moving, child, grandchild],
    });

    await expect(
      (NetworkSiteTypeService as any).onBeforeUpdate(
        updateBy({ parentNetworkSiteTypeId: typeId(4) }),
      ),
    ).rejects.toThrow("cannot be moved under one of its descendants");
  });

  it("rejects a missing, cross-project, or unit-level parent", async () => {
    const cases: Array<{ parent: NetworkSiteType | null; message: string }> = [
      { parent: null, message: "not found" },
      {
        parent: makeType({ index: 4, projectId: OTHER_PROJECT_ID }),
        message: "same project",
      },
      {
        parent: makeType({ index: 4, isUnitLevel: true }),
        message: "unit-level",
      },
    ];

    for (const testCase of cases) {
      jest.restoreAllMocks();
      mockParentUpdate({ parent: testCase.parent });

      await expect(
        (NetworkSiteTypeService as any).onBeforeUpdate(
          updateBy({ parentNetworkSiteTypeId: typeId(4) }),
        ),
      ).rejects.toThrow(testCase.message);
    }
  });

  it("allows detaching a type when all existing sites of that type are roots", async () => {
    mockParentUpdate({});
    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([makeSite({ index: 1, typeIndex: 2 })]);

    await expect(
      (NetworkSiteTypeService as any).onBeforeUpdate(
        updateBy({ parentNetworkSiteTypeId: null }),
      ),
    ).resolves.toBeDefined();
  });

  it("rejects detaching a type while one of its sites still has a parent", async () => {
    mockParentUpdate({});
    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([
        makeSite({ index: 1, typeIndex: 2, parentIndex: 10 }),
      ]);

    await expect(
      (NetworkSiteTypeService as any).onBeforeUpdate(
        updateBy({ parentNetworkSiteTypeId: null }),
      ),
    ).rejects.toThrow(
      "Create a new site type under the desired parent, then move and reassign the sites to it",
    );
  });

  it("accepts a new parent type when every site's actual parent has that type", async () => {
    mockParentUpdate({ parent: makeType({ index: 4 }) });
    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockImplementation(async (findBy: any) => {
        if (findBy.query?._id) {
          return [makeSite({ index: 10, typeIndex: 4 })];
        }

        return [
          makeSite({ index: 1, typeIndex: 2, parentIndex: 10 }),
          makeSite({ index: 2, typeIndex: 2, parentIndex: 10 }),
        ];
      });

    await expect(
      (NetworkSiteTypeService as any).onBeforeUpdate(
        updateBy({ parentNetworkSiteTypeId: typeId(4) }),
      ),
    ).resolves.toBeDefined();
  });

  it("rejects a new parent when an existing site is root or its parent has another type", async () => {
    const cases: Array<{
      sites: Array<NetworkSite>;
      parentSites: Array<NetworkSite>;
    }> = [
      {
        sites: [makeSite({ index: 1, typeIndex: 2 })],
        parentSites: [],
      },
      {
        sites: [makeSite({ index: 1, typeIndex: 2, parentIndex: 10 })],
        parentSites: [makeSite({ index: 10, typeIndex: 9 })],
      },
    ];

    for (const testCase of cases) {
      jest.restoreAllMocks();
      mockParentUpdate({ parent: makeType({ index: 4 }) });
      jest
        .spyOn(NetworkSiteService, "findBy")
        .mockImplementation(async (findBy: any) => {
          return findBy.query?._id ? testCase.parentSites : testCase.sites;
        });

      await expect(
        (NetworkSiteTypeService as any).onBeforeUpdate(
          updateBy({ parentNetworkSiteTypeId: typeId(4) }),
        ),
      ).rejects.toThrow("Create a new site type under the desired parent");
    }
  });

  it("does not revalidate sites or reorder when the parent did not change", async () => {
    const moving: NetworkSiteType = makeType({ index: 2, parentIndex: 4 });
    mockParentUpdate({ moving, parent: makeType({ index: 4 }) });
    const siteFindSpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "findBy",
    );
    const input: UpdateBy<NetworkSiteType> = updateBy({
      parentNetworkSiteTypeId: typeId(4),
    });

    await (NetworkSiteTypeService as any).onBeforeUpdate(input);

    expect(siteFindSpy).not.toHaveBeenCalled();
    expect(input.data.order).toBeUndefined();
  });

  it("does no hierarchy reads for an update that touches neither parent nor unit-level", async () => {
    const findBySpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteTypeService,
      "findBy",
    );

    await expect(
      (NetworkSiteTypeService as any).onBeforeUpdate(
        updateBy({ name: "Renamed" }),
      ),
    ).resolves.toBeDefined();
    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("rejects a raw SQL isUnitLevel expression before it can bypass leaf validation", async () => {
    const findBySpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteTypeService,
      "findBy",
    );

    await expect(
      (NetworkSiteTypeService as any).onBeforeUpdate(
        updateBy({
          isUnitLevel: () => {
            return true;
          },
        }),
      ),
    ).rejects.toThrow("unit-level leaf rules must be validated");
    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("reapplies the caller tenant before resolving rows matched by an update", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteTypeService, "findBy")
      .mockResolvedValue([]);

    await (NetworkSiteTypeService as any).onBeforeUpdate(
      updateBy(
        { parentNetworkSiteTypeId: null },
        { tenantId: PROJECT_ID, isRoot: false },
      ),
    );

    expect(findBySpy.mock.calls[0]![0].query).toEqual(
      expect.objectContaining({ projectId: PROJECT_ID }),
    );
  });

  it("honors the update limit and skip when selecting rows to validate", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteTypeService, "findBy")
      .mockResolvedValue([]);
    const input: UpdateBy<NetworkSiteType> = updateBy({
      parentNetworkSiteTypeId: null,
    });
    input.limit = new PositiveNumber(7);
    input.skip = new PositiveNumber(3);

    await (NetworkSiteTypeService as any).onBeforeUpdate(input);

    expect(findBySpy).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 7, skip: 3 }),
    );
  });

  it("rejects making a type unit-level when it has child types", async () => {
    const moving: NetworkSiteType = makeType({
      index: 2,
      isUnitLevel: false,
    });
    jest.spyOn(NetworkSiteTypeService, "findBy").mockResolvedValue([moving]);
    jest
      .spyOn(NetworkSiteTypeService, "findOneBy")
      .mockResolvedValue(makeType({ index: 3, parentIndex: 2 }));

    await expect(
      (NetworkSiteTypeService as any).onBeforeUpdate(
        updateBy({ isUnitLevel: true }),
      ),
    ).rejects.toThrow("with child types cannot be made unit-level");
  });

  it("rejects making a type unit-level when one of its sites has child sites", async () => {
    const moving: NetworkSiteType = makeType({
      index: 2,
      isUnitLevel: false,
    });
    jest.spyOn(NetworkSiteTypeService, "findBy").mockResolvedValue([moving]);
    jest.spyOn(NetworkSiteTypeService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([makeSite({ index: 1, typeIndex: 2 })]);
    const childSiteFindSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "findOneBy")
      .mockResolvedValue(makeSite({ index: 2, parentIndex: 1 }));

    await expect(
      (NetworkSiteTypeService as any).onBeforeUpdate(
        updateBy({ isUnitLevel: true }),
      ),
    ).rejects.toThrow("whose sites have child sites cannot be made unit-level");

    expect(childSiteFindSpy.mock.calls[0]![0].query.projectId).toBeDefined();
  });

  it("batches child-site checks when a type is used by more than 1,000 sites", async () => {
    const moving: NetworkSiteType = makeType({
      index: 2,
      isUnitLevel: false,
    });
    jest.spyOn(NetworkSiteTypeService, "findBy").mockResolvedValue([moving]);
    jest.spyOn(NetworkSiteTypeService, "findOneBy").mockResolvedValue(null);
    jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue(
      Array.from({ length: 1001 }, (_value: unknown, index: number) => {
        return makeSite({ index: index + 1, typeIndex: 2 });
      }),
    );
    const childSiteFindSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "findOneBy")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeSite({ index: 2000, parentIndex: 1001 }));

    await expect(
      (NetworkSiteTypeService as any).onBeforeUpdate(
        updateBy({ isUnitLevel: true }),
      ),
    ).rejects.toThrow("whose sites have child sites cannot be made unit-level");

    expect(childSiteFindSpy).toHaveBeenCalledTimes(2);
  });

  it("does not rerun transition checks for a type that is already unit-level", async () => {
    jest
      .spyOn(NetworkSiteTypeService, "findBy")
      .mockResolvedValue([makeType({ index: 2, isUnitLevel: true })]);
    const childTypeFindSpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteTypeService,
      "findOneBy",
    );
    const siteFindSpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "findBy",
    );

    await expect(
      (NetworkSiteTypeService as any).onBeforeUpdate(
        updateBy({ isUnitLevel: true }),
      ),
    ).resolves.toBeDefined();

    expect(childTypeFindSpy).not.toHaveBeenCalled();
    expect(siteFindSpy).not.toHaveBeenCalled();
  });

  it("validates site parent consistency beyond the first 10,000 rows", async () => {
    mockParentUpdate({});
    const rootSite: NetworkSite = makeSite({ index: 1, typeIndex: 2 });
    const mismatch: NetworkSite = makeSite({
      index: 2,
      typeIndex: 2,
      parentIndex: 10,
    });
    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockImplementation(async (findBy: any) => {
        if (findBy.skip === 0) {
          return new Array<NetworkSite>(10_000).fill(rootSite);
        }

        return [mismatch];
      });

    await expect(
      (NetworkSiteTypeService as any).onBeforeUpdate(
        updateBy({ parentNetworkSiteTypeId: null }),
      ),
    ).rejects.toThrow("Create a new site type under the desired parent");

    expect(NetworkSiteService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10_000 }),
    );
  });
});

describe("NetworkSiteTypeService deletion guards", () => {
  function mockDeleteTarget(): jest.SpyInstance {
    return jest
      .spyOn(NetworkSiteTypeService, "findBy")
      .mockImplementation(async (findBy: any) => {
        return findBy.query?._id ? [makeType({ index: 2 })] : [];
      });
  }

  it("rejects deleting a type used as another type's parent", async () => {
    jest
      .spyOn(NetworkSiteTypeService, "findBy")
      .mockImplementation(async (findBy: any) => {
        return findBy.query?._id
          ? [makeType({ index: 2 })]
          : [makeType({ index: 3, parentIndex: 2 })];
      });

    await expect(
      (NetworkSiteTypeService as any).onBeforeDelete(deleteBy()),
    ).rejects.toThrow("while child types use it as their parent");
  });

  it("rejects deleting a type used by a Network Site", async () => {
    mockDeleteTarget();
    jest
      .spyOn(NetworkSiteService, "findOneBy")
      .mockResolvedValue(makeSite({ index: 1, typeIndex: 2 }));

    await expect(
      (NetworkSiteTypeService as any).onBeforeDelete(deleteBy()),
    ).rejects.toThrow("while Network Sites use it");
  });

  it("allows deleting an unused leaf type", async () => {
    const findBySpy: jest.SpyInstance = mockDeleteTarget();
    jest.spyOn(NetworkSiteService, "findOneBy").mockResolvedValue(null);

    await expect(
      (NetworkSiteTypeService as any).onBeforeDelete(deleteBy()),
    ).resolves.toBeDefined();

    const childQueryCall: Array<any> = findBySpy.mock.calls.find(
      (call: Array<any>) => {
        return Boolean(call[0].query?.parentNetworkSiteTypeId);
      },
    )!;
    expect(childQueryCall[0].query.projectId).toBeDefined();
  });

  it("allows a parent and its child type to be deleted together", async () => {
    const parent: NetworkSiteType = makeType({ index: 2 });
    const child: NetworkSiteType = makeType({ index: 3, parentIndex: 2 });
    jest
      .spyOn(NetworkSiteTypeService, "findBy")
      .mockImplementation(async (findBy: any) => {
        return findBy.query?.parentNetworkSiteTypeId
          ? [child]
          : [parent, child];
      });
    jest.spyOn(NetworkSiteService, "findOneBy").mockResolvedValue(null);
    const input: DeleteBy<NetworkSiteType> = deleteBy();
    input.query = { projectId: PROJECT_ID };
    input.limit = new PositiveNumber(2);

    await expect(
      (NetworkSiteTypeService as any).onBeforeDelete(input),
    ).resolves.toBeDefined();
  });

  it("honors the delete limit and skip when determining the deletion set", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteTypeService, "findBy")
      .mockImplementation(async (findBy: any) => {
        return findBy.query?._id ? [makeType({ index: 2 })] : [];
      });
    jest.spyOn(NetworkSiteService, "findOneBy").mockResolvedValue(null);
    const input: DeleteBy<NetworkSiteType> = deleteBy();
    input.limit = new PositiveNumber(7);
    input.skip = new PositiveNumber(3);

    await (NetworkSiteTypeService as any).onBeforeDelete(input);

    expect(findBySpy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ limit: 7, skip: 3 }),
    );
  });

  it("reapplies the caller tenant before resolving rows matched by a delete", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteTypeService, "findBy")
      .mockResolvedValue([]);

    await (NetworkSiteTypeService as any).onBeforeDelete(
      deleteBy({ tenantId: PROJECT_ID, isRoot: false }),
    );

    expect(findBySpy.mock.calls[0]![0].query).toEqual(
      expect.objectContaining({ projectId: PROJECT_ID }),
    );
  });

  it("matches root delete preflight scoping when a tenant is supplied", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteTypeService, "findBy")
      .mockResolvedValue([]);

    await (NetworkSiteTypeService as any).onBeforeDelete(
      deleteBy({ tenantId: PROJECT_ID, isRoot: true }),
    );

    expect(findBySpy.mock.calls[0]![0].query).toEqual(
      expect.objectContaining({ projectId: PROJECT_ID }),
    );
  });

  it("does not invent a tenant scope for a root multi-tenant delete preflight", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteTypeService, "findBy")
      .mockResolvedValue([]);

    await (NetworkSiteTypeService as any).onBeforeDelete(
      deleteBy({
        tenantId: PROJECT_ID,
        isRoot: true,
        isMultiTenantRequest: true,
      }),
    );

    expect(findBySpy.mock.calls[0]![0].query.projectId).toBeUndefined();
  });
});

describe("NetworkSiteTypeService hierarchy mutation lock", () => {
  const runThroughLock: (data: {
    operation: () => Promise<unknown>;
  }) => Promise<unknown> = async (data: {
    operation: () => Promise<unknown>;
  }): Promise<unknown> => {
    return await data.operation();
  };

  it("holds the shared project lock around create", async () => {
    const created: NetworkSiteType = makeType({ index: 9 });
    const runExclusiveSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteHierarchyLock, "runExclusive")
      .mockImplementation(runThroughLock as never);
    const superCreateSpy: jest.SpyInstance = jest
      .spyOn(DatabaseService.prototype, "create")
      .mockResolvedValue(created);

    await expect(NetworkSiteTypeService.create(createBy({}))).resolves.toBe(
      created,
    );

    expect(runExclusiveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ projectIds: [PROJECT_ID] }),
    );
    expect(runExclusiveSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      superCreateSpy.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    ["updateOneBy", { parentNetworkSiteTypeId: typeId(1) }],
    ["updateBy", { isUnitLevel: true }],
    ["updateOneBy", { projectId: PROJECT_ID }],
  ])(
    "locks a hierarchy-changing %s",
    async (method: string, data: Record<string, unknown>) => {
      const runExclusiveSpy: jest.SpyInstance = jest
        .spyOn(NetworkSiteHierarchyLock, "runExclusive")
        .mockImplementation(runThroughLock as never);
      const findBySpy: jest.SpyInstance = jest
        .spyOn(NetworkSiteTypeService, "findBy")
        .mockResolvedValue([makeType({ index: 2 })]);
      const superMethodSpy: jest.SpyInstance = jest
        .spyOn(DatabaseService.prototype as any, method)
        .mockResolvedValue(1);
      const input: Record<string, unknown> = {
        query: { _id: typeId(2).toString() },
        data,
        props: { isRoot: true },
      };

      if (method === "updateBy") {
        input["limit"] = new PositiveNumber(1);
        input["skip"] = new PositiveNumber(0);
      }

      await expect(
        (NetworkSiteTypeService as any)[method](input),
      ).resolves.toBe(1);

      expect(findBySpy).toHaveBeenCalledWith(
        expect.objectContaining({ select: { projectId: true } }),
      );
      expect(runExclusiveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ projectIds: [PROJECT_ID] }),
      );
      expect(superMethodSpy).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["deleteOneBy", "deleteBy", "hardDeleteBy"])(
    "locks %s and resolves all affected projects first",
    async (method: string) => {
      const runExclusiveSpy: jest.SpyInstance = jest
        .spyOn(NetworkSiteHierarchyLock, "runExclusive")
        .mockImplementation(runThroughLock as never);
      jest
        .spyOn(NetworkSiteTypeService, "findBy")
        .mockResolvedValue([
          makeType({ index: 2, projectId: OTHER_PROJECT_ID }),
          makeType({ index: 3, projectId: PROJECT_ID }),
        ]);
      const superMethodSpy: jest.SpyInstance = jest
        .spyOn(DatabaseService.prototype as any, method)
        .mockResolvedValue(2);
      const input: Record<string, unknown> = {
        query: { projectId: PROJECT_ID },
        props: { isRoot: true },
      };

      if (method !== "deleteOneBy") {
        input["limit"] = new PositiveNumber(2);
        input["skip"] = new PositiveNumber(0);
      }

      await expect(
        (NetworkSiteTypeService as any)[method](input),
      ).resolves.toBe(2);

      expect(runExclusiveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          projectIds: [OTHER_PROJECT_ID, PROJECT_ID],
        }),
      );
      expect(superMethodSpy).toHaveBeenCalledTimes(1);
    },
  );

  it("bypasses locking for unrelated updates and trusted ignoreHooks writes", async () => {
    const runExclusiveSpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteHierarchyLock,
      "runExclusive",
    );
    jest.spyOn(DatabaseService.prototype, "updateOneBy").mockResolvedValue(1);
    jest
      .spyOn(DatabaseService.prototype, "create")
      .mockResolvedValue(makeType({ index: 7 }));

    await NetworkSiteTypeService.updateOneBy({
      query: { _id: typeId(2).toString() },
      data: { name: "Renamed" },
      props: { isRoot: true },
    });
    await NetworkSiteTypeService.create({
      ...createBy({}),
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(runExclusiveSpy).not.toHaveBeenCalled();
  });

  it("rejects an unscoped root hierarchy bulk mutation before writing", async () => {
    const superUpdateSpy: jest.SpyInstance = jest.spyOn(
      DatabaseService.prototype,
      "updateBy",
    );

    await expect(
      NetworkSiteTypeService.updateBy({
        query: { name: "Any matching type" },
        data: { parentNetworkSiteTypeId: null },
        limit: new PositiveNumber(10),
        skip: new PositiveNumber(0),
        props: { isRoot: true },
      }),
    ).rejects.toThrow(NETWORK_SITE_HIERARCHY_ROOT_SCOPE_ERROR_MESSAGE);

    expect(superUpdateSpy).not.toHaveBeenCalled();
  });

  it("rejects an open-ended root update even when root supplies tenantId", async () => {
    const superUpdateSpy: jest.SpyInstance = jest.spyOn(
      DatabaseService.prototype,
      "updateBy",
    );

    await expect(
      NetworkSiteTypeService.updateBy({
        query: { name: "Any matching type" },
        data: { parentNetworkSiteTypeId: null },
        limit: new PositiveNumber(10),
        skip: new PositiveNumber(0),
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(NETWORK_SITE_HIERARCHY_ROOT_SCOPE_ERROR_MESSAGE);

    expect(superUpdateSpy).not.toHaveBeenCalled();
  });

  it("turns the retention cron's open root query into an unused leaf-only ID batch", async () => {
    const retentionQuery: any = { deletedAt: { olderThanThirtyDays: true } };
    const parent: NetworkSiteType = makeType({ index: 2 });
    const leaf: NetworkSiteType = makeType({ index: 3, parentIndex: 2 });
    const usedLeaf: NetworkSiteType = makeType({ index: 4 });

    jest
      .spyOn(NetworkSiteTypeService, "findBy")
      .mockImplementation(async (findBy: any) => {
        if (findBy.query?.parentNetworkSiteTypeId) {
          return [leaf];
        }

        if (findBy.skip > 0) {
          return [];
        }

        return [parent, leaf, usedLeaf];
      });
    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([makeSite({ index: 1, typeIndex: 4 })]);
    const runExclusiveSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteHierarchyLock, "runExclusive")
      .mockImplementation(runThroughLock as never);
    const superHardDeleteSpy: jest.SpyInstance = jest
      .spyOn(DatabaseService.prototype, "hardDeleteBy")
      .mockResolvedValue(1);

    await expect(
      NetworkSiteTypeService.hardDeleteBy({
        query: retentionQuery,
        limit: new PositiveNumber(3),
        skip: new PositiveNumber(0),
        props: { isRoot: true },
      } as DeleteBy<NetworkSiteType>),
    ).resolves.toBe(1);

    expect(runExclusiveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ projectIds: [PROJECT_ID] }),
    );
    const closedDelete: any = superHardDeleteSpy.mock.calls[0]![0];
    expect(closedDelete.query.deletedAt).toBe(retentionQuery.deletedAt);
    expect(
      Object.values(closedDelete.query._id.objectLiteralParameters)[0],
    ).toEqual([leaf.id!.toString()]);
    expect(closedDelete.limit).toBe(1);
    expect(closedDelete.skip).toBe(0);
  });
});
