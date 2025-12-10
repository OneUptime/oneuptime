import StatusPageResourceUtil from "../../../Server/Utils/StatusPageResource";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import ObjectID from "../../../Types/ObjectID";

describe("StatusPageResourceUtil", () => {
  describe("getResourcesGroupedByGroupName", () => {
    it("should return empty string for empty resources array", () => {
      const result: string =
        StatusPageResourceUtil.getResourcesGroupedByGroupName([]);
      expect(result).toBe("");
    });

    it("should return custom default value for empty resources array", () => {
      const result: string =
        StatusPageResourceUtil.getResourcesGroupedByGroupName(
          [],
          "No resources",
        );
      expect(result).toBe("No resources");
    });

    it("should return simple comma-separated list when no resources have groups", () => {
      const resources: Array<StatusPageResource> = [
        createResource("API"),
        createResource("Website"),
        createResource("Database"),
      ];

      const result: string =
        StatusPageResourceUtil.getResourcesGroupedByGroupName(resources);
      expect(result).toBe("API, Website, Database");
    });

    it("should group resources by their resource group name", () => {
      const resources: Array<StatusPageResource> = [
        createResourceWithGroup("Infrastructure", "EU"),
        createResourceWithGroup("Website", "EU"),
        createResourceWithGroup("Infrastructure", "UK"),
        createResourceWithGroup("API", "UK"),
      ];

      const result: string =
        StatusPageResourceUtil.getResourcesGroupedByGroupName(resources);
      /*
       * Groups should be formatted as "GroupName: Resource1, Resource2"
       * Multiple groups separated by <br/> for HTML rendering
       */
      expect(result).toContain("EU: Infrastructure, Website");
      expect(result).toContain("UK: Infrastructure, API");
      expect(result).toContain("<br/>");
    });

    it("should handle mixed grouped and ungrouped resources", () => {
      const resources: Array<StatusPageResource> = [
        createResourceWithGroup("Infrastructure", "EU"),
        createResource("Global API"),
        createResourceWithGroup("Website", "UK"),
      ];

      const result: string =
        StatusPageResourceUtil.getResourcesGroupedByGroupName(resources);
      expect(result).toContain("EU: Infrastructure");
      expect(result).toContain("UK: Website");
      // Ungrouped resources should appear on their own line without "Other" label
      expect(result).toContain("Global API");
      expect(result).not.toContain("Other:");
    });

    it("should handle single grouped resource", () => {
      const resources: Array<StatusPageResource> = [
        createResourceWithGroup("Infrastructure", "EU"),
      ];

      const result: string =
        StatusPageResourceUtil.getResourcesGroupedByGroupName(resources);
      expect(result).toBe("EU: Infrastructure");
    });

    it("should handle single ungrouped resource", () => {
      const resources: Array<StatusPageResource> = [createResource("API")];

      const result: string =
        StatusPageResourceUtil.getResourcesGroupedByGroupName(resources);
      expect(result).toBe("API");
    });

    it("should skip resources without displayName", () => {
      const resources: Array<StatusPageResource> = [
        createResource("API"),
        createResourceWithoutDisplayName(),
        createResource("Website"),
      ];

      const result: string =
        StatusPageResourceUtil.getResourcesGroupedByGroupName(resources);
      expect(result).toBe("API, Website");
    });

    it("should handle null resources array", () => {
      const result: string =
        StatusPageResourceUtil.getResourcesGroupedByGroupName(
          null as unknown as Array<StatusPageResource>,
        );
      expect(result).toBe("");
    });

    it("should return empty string as default when specified", () => {
      const result: string =
        StatusPageResourceUtil.getResourcesGroupedByGroupName([], "");
      expect(result).toBe("");
    });

    it("should handle multiple resources in same group", () => {
      const resources: Array<StatusPageResource> = [
        createResourceWithGroup("Infrastructure", "EU"),
        createResourceWithGroup("Website", "EU"),
        createResourceWithGroup("API", "EU"),
      ];

      const result: string =
        StatusPageResourceUtil.getResourcesGroupedByGroupName(resources);
      expect(result).toBe("EU: Infrastructure, Website, API");
    });
  });
});

/**
 * Helper function to create a StatusPageResource without a group
 */
function createResource(displayName: string): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = ObjectID.generate().toString();
  resource.displayName = displayName;
  return resource;
}

/**
 * Helper function to create a StatusPageResource with a group
 */
function createResourceWithGroup(
  displayName: string,
  groupName: string,
): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = ObjectID.generate().toString();
  resource.displayName = displayName;
  resource.statusPageGroupId = ObjectID.generate();
  resource.statusPageGroup = {
    name: groupName,
  } as any;
  return resource;
}

/**
 * Helper function to create a StatusPageResource without a displayName
 */
function createResourceWithoutDisplayName(): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = ObjectID.generate().toString();
  return resource;
}
