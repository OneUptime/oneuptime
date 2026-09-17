import { describe, expect, test } from "@jest/globals";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
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

  test("child creation offers every type except the ones above the parent", () => {
    expect(
      SiteTypeHierarchyFormUtil.getAllowedChildTypeOptions({
        parentNetworkSiteTypeValue: ROOT_ID,
        networkSiteTypes: hierarchy(),
      }),
    ).toEqual([
      { value: MARKET_ID.toString(), label: "Region › Market" },
      { value: ROOT_ID.toString(), label: "Region" },
      { value: UNIT_ID.toString(), label: "Region › Market › Unit" },
      { value: BRANCH_ID.toString(), label: "Branch" },
    ]);
  });

  test("child creation under a deeper parent drops that parent's ancestors", () => {
    expect(
      SiteTypeHierarchyFormUtil.getAllowedChildTypeOptions({
        parentNetworkSiteTypeValue: MARKET_ID,
        networkSiteTypes: hierarchy(),
      }),
    ).toEqual([
      { value: MARKET_ID.toString(), label: "Region › Market" },
      { value: UNIT_ID.toString(), label: "Region › Market › Unit" },
      { value: BRANCH_ID.toString(), label: "Branch" },
    ]);
  });

  test("child creation under a unit-level parent offers nothing", () => {
    const types: Array<NetworkSiteType> = hierarchy().map(
      (networkSiteType: NetworkSiteType): NetworkSiteType => {
        if (networkSiteType.id?.toString() === UNIT_ID.toString()) {
          networkSiteType.isUnitLevel = true;
        }
        return networkSiteType;
      },
    );

    expect(
      SiteTypeHierarchyFormUtil.getAllowedChildTypeOptions({
        parentNetworkSiteTypeValue: UNIT_ID,
        networkSiteTypes: types,
      }),
    ).toEqual([]);
  });

  test("child creation under an untyped parent offers every type", () => {
    expect(
      SiteTypeHierarchyFormUtil.getAllowedChildTypeOptions({
        parentNetworkSiteTypeValue: null,
        networkSiteTypes: hierarchy(),
      }),
    ).toHaveLength(4);
  });

  test("resolves the preferred parent type for the selected type", () => {
    const types: Array<NetworkSiteType> = hierarchy();

    expect(
      SiteTypeHierarchyFormUtil.getPreferredParentTypeId({
        selectedNetworkSiteTypeValue: MARKET_ID.toString(),
        networkSiteTypes: types,
      }),
    ).toBe(ROOT_ID.toString());
    expect(
      SiteTypeHierarchyFormUtil.getPreferredParentTypeId({
        selectedNetworkSiteTypeValue: ROOT_ID.toString(),
        networkSiteTypes: types,
      }),
    ).toBeNull();
  });

  /*
   * The placement rule behind GitHub issue #3744: a parent may be anything the
   * hierarchy does not place BELOW the child, so unrelated types and skipped
   * levels are fine and only an inversion is refused.
   */
  describe("site placement rule", () => {
    const types: Array<NetworkSiteType> = hierarchy();

    test("an unrelated type may be the parent", () => {
      expect(
        SiteTypeHierarchyFormUtil.isParentSitePlacementAllowed({
          childNetworkSiteTypeValue: MARKET_ID,
          parentNetworkSiteTypeValue: BRANCH_ID,
          networkSiteTypes: types,
        }),
      ).toBe(true);
    });

    test("a skipped level is allowed", () => {
      expect(
        SiteTypeHierarchyFormUtil.isParentSitePlacementAllowed({
          childNetworkSiteTypeValue: UNIT_ID,
          parentNetworkSiteTypeValue: ROOT_ID,
          networkSiteTypes: types,
        }),
      ).toBe(true);
    });

    test("the same type on both sides is allowed", () => {
      expect(
        SiteTypeHierarchyFormUtil.isParentSitePlacementAllowed({
          childNetworkSiteTypeValue: MARKET_ID,
          parentNetworkSiteTypeValue: MARKET_ID,
          networkSiteTypes: types,
        }),
      ).toBe(true);
    });

    test("a parent with no type at all is allowed", () => {
      expect(
        SiteTypeHierarchyFormUtil.isParentSitePlacementAllowed({
          childNetworkSiteTypeValue: MARKET_ID,
          parentNetworkSiteTypeValue: null,
          networkSiteTypes: types,
        }),
      ).toBe(true);
    });

    test("a parent whose type sits below the child's is refused", () => {
      expect(
        SiteTypeHierarchyFormUtil.isParentSitePlacementAllowed({
          childNetworkSiteTypeValue: ROOT_ID,
          parentNetworkSiteTypeValue: UNIT_ID,
          networkSiteTypes: types,
        }),
      ).toBe(false);
    });

    test("a unit-level parent is refused whatever the child type", () => {
      const unitLevelTypes: Array<NetworkSiteType> = hierarchy().map(
        (networkSiteType: NetworkSiteType): NetworkSiteType => {
          if (networkSiteType.id?.toString() === BRANCH_ID.toString()) {
            networkSiteType.isUnitLevel = true;
          }
          return networkSiteType;
        },
      );

      expect(
        SiteTypeHierarchyFormUtil.isParentSitePlacementAllowed({
          childNetworkSiteTypeValue: MARKET_ID,
          parentNetworkSiteTypeValue: BRANCH_ID,
          networkSiteTypes: unitLevelTypes,
        }),
      ).toBe(false);
    });
  });

  describe("parent site picker", () => {
    function makeSite(data: {
      id: string;
      name: string;
      typeId?: ObjectID | undefined;
      materializedPath?: string | undefined;
    }): NetworkSite {
      const site: NetworkSite = new NetworkSite(new ObjectID(data.id));
      site.name = data.name;
      if (data.typeId) {
        site.networkSiteTypeId = data.typeId;
      }
      if (data.materializedPath) {
        site.materializedPath = data.materializedPath;
      }
      return site;
    }

    const REGION_SITE_ID: string = "20000000-0000-4000-8000-000000000001";
    const BRANCH_SITE_ID: string = "20000000-0000-4000-8000-000000000002";
    const UNIT_SITE_ID: string = "20000000-0000-4000-8000-000000000003";
    const SELF_SITE_ID: string = "20000000-0000-4000-8000-000000000004";
    const DESCENDANT_SITE_ID: string = "20000000-0000-4000-8000-000000000005";

    function candidates(): Array<NetworkSite> {
      return [
        makeSite({
          id: REGION_SITE_ID,
          name: "East Region",
          typeId: ROOT_ID,
          materializedPath: `/${REGION_SITE_ID}/`,
        }),
        makeSite({
          id: BRANCH_SITE_ID,
          name: "Warehouse 7",
          typeId: BRANCH_ID,
          materializedPath: `/${BRANCH_SITE_ID}/`,
        }),
        makeSite({
          id: UNIT_SITE_ID,
          name: "Unit 1042",
          typeId: UNIT_ID,
          materializedPath: `/${UNIT_SITE_ID}/`,
        }),
        makeSite({
          id: SELF_SITE_ID,
          name: "Springfield Market",
          typeId: MARKET_ID,
          materializedPath: `/${SELF_SITE_ID}/`,
        }),
        makeSite({
          id: DESCENDANT_SITE_ID,
          name: "Downtown Store",
          typeId: UNIT_ID,
          materializedPath: `/${SELF_SITE_ID}/${DESCENDANT_SITE_ID}/`,
        }),
      ];
    }

    test("suggests the configured parent type first and still offers the rest", () => {
      expect(
        SiteTypeHierarchyFormUtil.buildParentSiteOptions({
          networkSites: candidates(),
          childNetworkSiteTypeValue: MARKET_ID,
          networkSiteTypes: hierarchy(),
          currentNetworkSiteId: SELF_SITE_ID,
        }),
      ).toEqual([
        {
          label: "Suggested — Region",
          options: [{ value: REGION_SITE_ID, label: "East Region (Region)" }],
        },
        {
          label: "Other sites",
          options: [{ value: BRANCH_SITE_ID, label: "Warehouse 7 (Branch)" }],
        },
      ]);
    });

    test("never offers the site itself or anything in its own subtree", () => {
      const options: Array<unknown> =
        SiteTypeHierarchyFormUtil.buildParentSiteOptions({
          networkSites: candidates(),
          childNetworkSiteTypeValue: MARKET_ID,
          networkSiteTypes: hierarchy(),
          currentNetworkSiteId: SELF_SITE_ID,
        });

      expect(JSON.stringify(options)).not.toContain(SELF_SITE_ID);
      expect(JSON.stringify(options)).not.toContain(DESCENDANT_SITE_ID);
    });

    test("drops sites whose type sits below this one", () => {
      const options: Array<unknown> =
        SiteTypeHierarchyFormUtil.buildParentSiteOptions({
          networkSites: candidates(),
          childNetworkSiteTypeValue: ROOT_ID,
          networkSiteTypes: hierarchy(),
        });

      expect(JSON.stringify(options)).not.toContain(UNIT_SITE_ID);
      expect(JSON.stringify(options)).not.toContain(SELF_SITE_ID);
      expect(JSON.stringify(options)).toContain(BRANCH_SITE_ID);
    });

    /*
     * The reported project: no type has a configured parent, so there is
     * nothing to suggest and the picker must still list every candidate as one
     * plain group rather than coming back empty.
     */
    test("a flat type catalog still yields a full, ungrouped list", () => {
      const flatTypes: Array<NetworkSiteType> = [
        makeType({ id: ROOT_ID, name: "Other", order: 1 }),
        makeType({ id: MARKET_ID, name: "Market", order: 2 }),
      ];

      expect(
        SiteTypeHierarchyFormUtil.buildParentSiteOptions({
          networkSites: [
            makeSite({
              id: REGION_SITE_ID,
              name: "Aramark",
              typeId: ROOT_ID,
              materializedPath: `/${REGION_SITE_ID}/`,
            }),
          ],
          childNetworkSiteTypeValue: MARKET_ID,
          networkSiteTypes: flatTypes,
        }),
      ).toEqual([{ value: REGION_SITE_ID, label: "Aramark (Other)" }]);
    });
  });
});
