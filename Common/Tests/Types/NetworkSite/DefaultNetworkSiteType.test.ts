import DefaultNetworkSiteType from "../../../Types/NetworkSite/DefaultNetworkSiteType";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";

describe("DefaultNetworkSiteType", () => {
  /*
   * These values are the names seeded into every project's NetworkSiteType
   * table (and the names the backfill migration matches legacy site type
   * strings against), so they are data, not just labels - renaming a member
   * value here would leave existing sites pointing at a type that no longer
   * gets seeded.
   */
  test("contains every hierarchy level with its display value", () => {
    expect(DefaultNetworkSiteType.AccountType).toBe("Account Type");
    expect(DefaultNetworkSiteType.Region).toBe("Region");
    expect(DefaultNetworkSiteType.Franchisee).toBe("Franchisee");
    expect(DefaultNetworkSiteType.Market).toBe("Market");
    expect(DefaultNetworkSiteType.Unit).toBe("Unit");
    expect(DefaultNetworkSiteType.DataCenter).toBe("Data Center");
    expect(DefaultNetworkSiteType.Other).toBe("Other");
  });

  test("has exactly the expected members", () => {
    expect(Object.keys(DefaultNetworkSiteType).sort()).toEqual(
      [
        "AccountType",
        "DataCenter",
        "Franchisee",
        "Market",
        "Other",
        "Region",
        "Unit",
      ].sort(),
    );
  });
});

describe("NetworkSite permissions", () => {
  /*
   * Keyed by the enum member name on purpose: the VALUE is what gets
   * persisted in team/API-key permission rows and compared as a raw string
   * across services, so a value that drifts from its key is a silent
   * authorization break. Referencing the members by symbol also keeps this
   * a compile error if one is ever removed.
   */
  const permissionsByName: Record<string, Permission> = {
    CreateNetworkSite: Permission.CreateNetworkSite,
    DeleteNetworkSite: Permission.DeleteNetworkSite,
    EditNetworkSite: Permission.EditNetworkSite,
    ReadNetworkSite: Permission.ReadNetworkSite,
    CreateNetworkEndpoint: Permission.CreateNetworkEndpoint,
    DeleteNetworkEndpoint: Permission.DeleteNetworkEndpoint,
    EditNetworkEndpoint: Permission.EditNetworkEndpoint,
    ReadNetworkEndpoint: Permission.ReadNetworkEndpoint,
    CreateNetworkSiteStatusTimeline: Permission.CreateNetworkSiteStatusTimeline,
    DeleteNetworkSiteStatusTimeline: Permission.DeleteNetworkSiteStatusTimeline,
    EditNetworkSiteStatusTimeline: Permission.EditNetworkSiteStatusTimeline,
    ReadNetworkSiteStatusTimeline: Permission.ReadNetworkSiteStatusTimeline,
    CreateNetworkSiteLink: Permission.CreateNetworkSiteLink,
    DeleteNetworkSiteLink: Permission.DeleteNetworkSiteLink,
    EditNetworkSiteLink: Permission.EditNetworkSiteLink,
    ReadNetworkSiteLink: Permission.ReadNetworkSiteLink,
    CreateNetworkSiteAssignmentRule: Permission.CreateNetworkSiteAssignmentRule,
    DeleteNetworkSiteAssignmentRule: Permission.DeleteNetworkSiteAssignmentRule,
    EditNetworkSiteAssignmentRule: Permission.EditNetworkSiteAssignmentRule,
    ReadNetworkSiteAssignmentRule: Permission.ReadNetworkSiteAssignmentRule,
    CreateNetworkSiteType: Permission.CreateNetworkSiteType,
    DeleteNetworkSiteType: Permission.DeleteNetworkSiteType,
    EditNetworkSiteType: Permission.EditNetworkSiteType,
    ReadNetworkSiteType: Permission.ReadNetworkSiteType,
  };

  const permissions: Array<Permission> = Object.values(permissionsByName);

  test.each(Object.keys(permissionsByName))(
    "%s has an enum value identical to its key",
    (name: string) => {
      expect(permissionsByName[name]).toBe(name);
    },
  );

  test("the enum values are exactly the twenty four expected strings", () => {
    expect(permissions).toEqual([
      "CreateNetworkSite",
      "DeleteNetworkSite",
      "EditNetworkSite",
      "ReadNetworkSite",
      "CreateNetworkEndpoint",
      "DeleteNetworkEndpoint",
      "EditNetworkEndpoint",
      "ReadNetworkEndpoint",
      "CreateNetworkSiteStatusTimeline",
      "DeleteNetworkSiteStatusTimeline",
      "EditNetworkSiteStatusTimeline",
      "ReadNetworkSiteStatusTimeline",
      "CreateNetworkSiteLink",
      "DeleteNetworkSiteLink",
      "EditNetworkSiteLink",
      "ReadNetworkSiteLink",
      "CreateNetworkSiteAssignmentRule",
      "DeleteNetworkSiteAssignmentRule",
      "EditNetworkSiteAssignmentRule",
      "ReadNetworkSiteAssignmentRule",
      "CreateNetworkSiteType",
      "DeleteNetworkSiteType",
      "EditNetworkSiteType",
      "ReadNetworkSiteType",
    ]);
  });

  test.each(permissions)(
    "%s has permission props with a title and description",
    (permission: Permission) => {
      const props: PermissionProps | undefined =
        PermissionHelper.getAllPermissionProps().find(
          (item: PermissionProps) => {
            return item.permission === permission;
          },
        );

      expect(props).toBeDefined();
      expect(props?.title.length).toBeGreaterThan(0);
      expect(props?.description.length).toBeGreaterThan(0);
      expect(props?.isAssignableToTenant).toBe(true);
    },
  );
});
