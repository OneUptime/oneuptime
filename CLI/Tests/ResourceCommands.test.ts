import { discoverResources } from "../Commands/ResourceCommands";
import { ResourceInfo } from "../Types/CLITypes";

describe("ResourceCommands", () => {
  describe("discoverResources", () => {
    let resources: ResourceInfo[];

    beforeAll(() => {
      resources = discoverResources();
    });

    it("should discover at least one resource", () => {
      expect(resources.length).toBeGreaterThan(0);
    });

    it("should discover the Incident resource", () => {
      const incident = resources.find((r) => r.singularName === "Incident");
      expect(incident).toBeDefined();
      expect(incident!.modelType).toBe("database");
      expect(incident!.apiPath).toBe("/incident");
    });

    it("should discover the Monitor resource", () => {
      const monitor = resources.find((r) => r.singularName === "Monitor");
      expect(monitor).toBeDefined();
      expect(monitor!.modelType).toBe("database");
    });

    it("should discover the Alert resource", () => {
      const alert = resources.find((r) => r.singularName === "Alert");
      expect(alert).toBeDefined();
    });

    it("should have kebab-case names for all resources", () => {
      for (const r of resources) {
        expect(r.name).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    });

    it("should have apiPath for all resources", () => {
      for (const r of resources) {
        expect(r.apiPath).toBeTruthy();
        expect(r.apiPath.startsWith("/")).toBe(true);
      }
    });

    it("should have valid modelType for all resources", () => {
      for (const r of resources) {
        expect(["database", "analytics"]).toContain(r.modelType);
      }
    });
  });
});
