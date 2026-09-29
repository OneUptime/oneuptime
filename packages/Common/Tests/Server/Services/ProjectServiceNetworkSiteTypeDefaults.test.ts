import NetworkSiteTypeService from "../../../Server/Services/NetworkSiteTypeService";
import ProjectService from "../../../Server/Services/ProjectService";
import NetworkSiteType from "../../../Models/DatabaseModels/NetworkSiteType";
import Project from "../../../Models/DatabaseModels/Project";
import DefaultNetworkSiteType from "../../../Types/NetworkSite/DefaultNetworkSiteType";
import {
  DefaultNetworkSiteTypeCreationOrder,
  DefaultNetworkSiteTypeParent,
} from "../../../Types/NetworkSite/DefaultNetworkSiteTypeHierarchy";
import ObjectID from "../../../Types/ObjectID";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { afterEach, describe, expect, it } from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function typeId(index: number): ObjectID {
  return new ObjectID(
    `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString().padStart(12, "0")}`,
  );
}

function project(): Project {
  const project: Project = new Project();
  project.id = PROJECT_ID;
  return project;
}

function existingType(
  name: DefaultNetworkSiteType,
  index: number,
): NetworkSiteType {
  const networkSiteType: NetworkSiteType = new NetworkSiteType();
  networkSiteType.id = typeId(index);
  networkSiteType.name = name;
  networkSiteType.projectId = PROJECT_ID;
  return networkSiteType;
}

function mockCreatesWithIds(startingIndex: number = 1): jest.SpyInstance {
  let index: number = startingIndex;

  return jest
    .spyOn(NetworkSiteTypeService, "create")
    .mockImplementation(async (createBy: any) => {
      createBy.data.id = typeId(index);
      index++;
      return createBy.data;
    });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProjectService default Network Site Type hierarchy", () => {
  it("creates defaults parent-first with the explicit hierarchy and sibling orders", async () => {
    jest.spyOn(NetworkSiteTypeService, "findBy").mockResolvedValue([]);
    const createSpy: jest.SpyInstance = mockCreatesWithIds();

    await ProjectService.addDefaultNetworkSiteTypes(project());

    const created: Array<NetworkSiteType> = createSpy.mock.calls.map(
      (call: Array<any>) => {
        return call[0].data as NetworkSiteType;
      },
    );
    const byName: Map<DefaultNetworkSiteType, NetworkSiteType> = new Map(
      created.map((networkSiteType: NetworkSiteType) => {
        return [
          networkSiteType.name as DefaultNetworkSiteType,
          networkSiteType,
        ];
      }),
    );

    expect(
      created.map((networkSiteType: NetworkSiteType) => {
        return networkSiteType.name;
      }),
    ).toEqual(DefaultNetworkSiteTypeCreationOrder);

    for (const name of DefaultNetworkSiteTypeCreationOrder) {
      const networkSiteType: NetworkSiteType = byName.get(name)!;
      const parentName: DefaultNetworkSiteType | null =
        DefaultNetworkSiteTypeParent[name];

      expect(networkSiteType.projectId).toEqual(PROJECT_ID);
      expect(networkSiteType.isUnitLevel).toBe(
        name === DefaultNetworkSiteType.Unit,
      );

      if (parentName) {
        expect(networkSiteType.parentNetworkSiteTypeId).toEqual(
          byName.get(parentName)!.id,
        );
        expect(networkSiteType.order).toBe(1);
      } else {
        expect(networkSiteType.parentNetworkSiteTypeId).toBeUndefined();
      }
    }

    expect(byName.get(DefaultNetworkSiteType.AccountType)!.order).toBe(1);
    expect(byName.get(DefaultNetworkSiteType.DataCenter)!.order).toBe(2);
    expect(byName.get(DefaultNetworkSiteType.Other)!.order).toBe(3);
  });

  it("can seed legacy defaults without pre-empting the concrete-tree backfill", async () => {
    jest.spyOn(NetworkSiteTypeService, "findBy").mockResolvedValue([]);
    const createSpy: jest.SpyInstance = mockCreatesWithIds();

    await ProjectService.addDefaultNetworkSiteTypes(project(), {
      setParentRelationships: false,
    });

    const created: Array<NetworkSiteType> = createSpy.mock.calls.map(
      (call: Array<any>) => {
        return call[0].data as NetworkSiteType;
      },
    );

    expect(created).toHaveLength(DefaultNetworkSiteTypeCreationOrder.length);
    expect(
      created.every((networkSiteType: NetworkSiteType): boolean => {
        return !networkSiteType.parentNetworkSiteTypeId;
      }),
    ).toBe(true);
    expect(
      created.map((networkSiteType: NetworkSiteType) => {
        return networkSiteType.order;
      }),
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("is idempotent when every default already exists", async () => {
    jest.spyOn(NetworkSiteTypeService, "findBy").mockResolvedValue(
      DefaultNetworkSiteTypeCreationOrder.map(
        (name: DefaultNetworkSiteType, index: number) => {
          return existingType(name, index + 1);
        },
      ),
    );
    const createSpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteTypeService,
      "create",
    );

    await ProjectService.addDefaultNetworkSiteTypes(project());

    expect(createSpy).not.toHaveBeenCalled();
  });

  it("reads every type page before deciding which defaults are missing", async () => {
    const customType: NetworkSiteType = new NetworkSiteType(typeId(98));
    customType.name = "Custom type";
    customType.projectId = PROJECT_ID;
    const existingUnit: NetworkSiteType = existingType(
      DefaultNetworkSiteType.Unit,
      99,
    );
    const findSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteTypeService, "findBy")
      .mockResolvedValueOnce(
        Array.from({ length: LIMIT_MAX }, () => {
          return customType;
        }),
      )
      .mockResolvedValueOnce([existingUnit]);
    const createSpy: jest.SpyInstance = mockCreatesWithIds();

    await ProjectService.addDefaultNetworkSiteTypes(project());

    expect(findSpy).toHaveBeenCalledTimes(2);
    expect(findSpy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        skip: 0,
        limit: LIMIT_MAX,
        sort: { _id: SortOrder.Ascending },
      }),
    );
    expect(findSpy.mock.calls[1]![0]).toEqual(
      expect.objectContaining({ skip: LIMIT_MAX, limit: LIMIT_MAX }),
    );
    expect(
      createSpy.mock.calls.some((call: Array<any>): boolean => {
        return call[0].data.name === DefaultNetworkSiteType.Unit;
      }),
    ).toBe(false);
  });

  it("resolves a newly created child against an existing default parent", async () => {
    const existingAccount: NetworkSiteType = existingType(
      DefaultNetworkSiteType.AccountType,
      99,
    );
    jest
      .spyOn(NetworkSiteTypeService, "findBy")
      .mockResolvedValue([existingAccount]);
    const createSpy: jest.SpyInstance = mockCreatesWithIds(1);

    await ProjectService.addDefaultNetworkSiteTypes(project());

    const region: NetworkSiteType = createSpy.mock.calls.find(
      (call: Array<any>) => {
        return call[0].data.name === DefaultNetworkSiteType.Region;
      },
    )![0].data;

    expect(region.parentNetworkSiteTypeId).toEqual(existingAccount.id);
    expect(createSpy).toHaveBeenCalledTimes(6);
  });
});
