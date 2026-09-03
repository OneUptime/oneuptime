import { describe, expect, test } from "@jest/globals";
import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import ObjectID from "Common/Types/ObjectID";
import SiteTypeHierarchyFormUtil from "../../FeatureSet/Dashboard/src/Components/NetworkSite/SiteTypeHierarchyFormUtil";

const ROOT_ID: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const MARKET_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000002",
);
const UNIT_ID: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000003");
const BRANCH_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000004",
);

function makeType(data: {
  id: ObjectID;
  name: string;
  parentId?: ObjectID | undefined;
  order?: number | undefined;
  isUnitLevel?: boolean | undefined;
}): NetworkSiteType {
  const networkSiteType: NetworkSiteType = new NetworkSiteType(data.id);
  networkSiteType.name = data.name;
  if (data.parentId) {
    networkSiteType.parentNetworkSiteTypeId = data.parentId;
  }
  if (data.order !== undefined) {
    networkSiteType.order = data.order;
  }
  networkSiteType.isUnitLevel = data.isUnitLevel || false;
  return networkSiteType;
}

function hierarchy(): Array<NetworkSiteType> {
  return [
    makeType({ id: UNIT_ID, name: "Unit", parentId: MARKET_ID, order: 1 }),
    makeType({ id: BRANCH_ID, name: "Branch", order: 2 }),
    makeType({ id: ROOT_ID, name: "Region", order: 1 }),
    makeType({ id: MARKET_ID, name: "Market", parentId: ROOT_ID, order: 1 }),
  ];
}

describe("SiteTypeHierarchyFormUtil", () => {
  test("reads ids from every value shape used by model forms", () => {
    expect(SiteTypeHierarchyFormUtil.getEntityId(ROOT_ID)).toBe(
      ROOT_ID.toString(),
    );
    expect(
      SiteTypeHierarchyFormUtil.getEntityId({
        value: MARKET_ID.toString(),
        label: "Market",
      }),
    ).toBe(MARKET_ID.toString());
    expect(
      SiteTypeHierarchyFormUtil.getEntityId(
        makeType({ id: UNIT_ID, name: "Unit" }),
      ),
    ).toBe(UNIT_ID.toString());
    expect(SiteTypeHierarchyFormUtil.getEntityId(undefined)).toBeNull();
  });

  test("lists site types in tree order with unambiguous breadcrumbs", () => {
    expect(
      SiteTypeHierarchyFormUtil.getAllTypeOptions({
        networkSiteTypes: hierarchy(),
      }),
    ).toEqual([
      { value: ROOT_ID.toString(), label: "Region" },
      { value: MARKET_ID.toString(), label: "Region › Market" },
      { value: UNIT_ID.toString(), label: "Region › Market › Unit" },
      { value: BRANCH_ID.toString(), label: "Branch" },
    ]);
  });

  test("a parent picker excludes the type, its descendants, and leaf types", () => {
    const types: Array<NetworkSiteType> = hierarchy();
    const leafRoot: NetworkSiteType = makeType({
      id: new ObjectID("10000000-0000-4000-8000-000000000005"),
      name: "Standalone Unit",
      isUnitLevel: true,
      order: 3,
    });
    types.push(leafRoot);

    expect(
      SiteTypeHierarchyFormUtil.getValidParentTypeOptions({
        currentNetworkSiteTypeValue: MARKET_ID,
        networkSiteTypes: types,
      }),
    ).toEqual([
      { value: ROOT_ID.toString(), label: "Region" },
      { value: BRANCH_ID.toString(), label: "Branch" },
    ]);
  });

  test("child creation offers only direct children of the known parent type", () => {
    expect(
      SiteTypeHierarchyFormUtil.getChildTypeOptions({
        parentNetworkSiteTypeValue: ROOT_ID,
        networkSiteTypes: hierarchy(),
      }),
    ).toEqual([{ value: MARKET_ID.toString(), label: "Region › Market" }]);
  });

  test("resolves the configured parent required by the selected type", () => {
    const types: Array<NetworkSiteType> = hierarchy();

    expect(
      SiteTypeHierarchyFormUtil.getConfiguredParentTypeId({
        selectedNetworkSiteTypeValue: MARKET_ID.toString(),
        networkSiteTypes: types,
      }),
    ).toBe(ROOT_ID.toString());
    expect(
      SiteTypeHierarchyFormUtil.getConfiguredParentTypeId({
        selectedNetworkSiteTypeValue: ROOT_ID.toString(),
        networkSiteTypes: types,
      }),
    ).toBeNull();
  });

  test("requires a parent site only when the selected type has a parent type", () => {
    const types: Array<NetworkSiteType> = hierarchy();

    expect(
      SiteTypeHierarchyFormUtil.isParentSiteRequired({
        selectedNetworkSiteTypeValue: MARKET_ID,
        networkSiteTypes: types,
      }),
    ).toBe(true);
    expect(
      SiteTypeHierarchyFormUtil.isParentSiteRequired({
        selectedNetworkSiteTypeValue: ROOT_ID,
        networkSiteTypes: types,
      }),
    ).toBe(false);
    expect(
      SiteTypeHierarchyFormUtil.isParentSiteRequired({
        selectedNetworkSiteTypeValue: undefined,
        networkSiteTypes: types,
      }),
    ).toBe(false);
  });
});
