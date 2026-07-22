import NetworkSiteType from "../../../Types/NetworkSite/NetworkSiteType";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";

describe("NetworkSiteType", () => {
  test("contains every hierarchy level with its display value", () => {
    expect(NetworkSiteType.AccountType).toBe("Account Type");
    expect(NetworkSiteType.Region).toBe("Region");
    expect(NetworkSiteType.Franchisee).toBe("Franchisee");
    expect(NetworkSiteType.Market).toBe("Market");
    expect(NetworkSiteType.Unit).toBe("Unit");
    expect(NetworkSiteType.DataCenter).toBe("Data Center");
    expect(NetworkSiteType.Other).toBe("Other");
  });

  test("has exactly the expected members", () => {
    expect(Object.keys(NetworkSiteType).sort()).toEqual(
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
  };

  const permissions: Array<Permission> = Object.values(permissionsByName);

  test.each(Object.keys(permissionsByName))(
    "%s has an enum value identical to its key",
    (name: string) => {
      expect(permissionsByName[name]).toBe(name);
    },
  );

  test("the enum values are exactly the twenty expected strings", () => {
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
