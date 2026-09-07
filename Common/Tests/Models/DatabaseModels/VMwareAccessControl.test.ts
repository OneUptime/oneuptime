import VMwareSource from "../../../Models/DatabaseModels/VMwareSource";
import VMwareResource from "../../../Models/DatabaseModels/VMwareResource";
import Permission from "../../../Types/Permission";

describe("VMware inventory access control", () => {
  it("uses project tenant scope and refuses public/unrelated project-user grants", () => {
    for (const model of [new VMwareSource(), new VMwareResource()]) {
      expect(model.getTenantColumn()).toBe("projectId");
      expect(model.hasReadPermissions([Permission.Public])).toBe(false);
      expect(model.hasReadPermissions([Permission.ProjectUser])).toBe(false);
      expect(model.hasReadPermissions([Permission.ReadVMwareResource])).toBe(
        true,
      );
      expect(model.hasReadPermissions([Permission.ReadProjectMonitor])).toBe(
        false,
      );
    }
  });
  it("keeps source-only grants separate from resource inventory", () => {
    expect(
      new VMwareSource().hasReadPermissions([Permission.ReadVMwareSource]),
    ).toBe(true);
    expect(
      new VMwareResource().hasReadPermissions([Permission.ReadVMwareSource]),
    ).toBe(false);
    expect(
      new VMwareSource().hasReadPermissions([Permission.ReadVMwareResource]),
    ).toBe(true);
  });
  it("lets viewers read while reserving changes for explicit editors", () => {
    const model: VMwareResource = new VMwareResource();
    expect(model.hasReadPermissions([Permission.Viewer])).toBe(true);
    expect(model.hasUpdatePermissions([Permission.Viewer])).toBe(false);
    expect(model.hasUpdatePermissions([Permission.ReadVMwareSource])).toBe(
      false,
    );
    expect(
      model.hasUpdatePermissions(
        [Permission.EditVMwareResource],
        "expectedRunning",
      ),
    ).toBe(true);
    expect(
      model.hasUpdatePermissions(
        [Permission.EditVMwareResource],
        "maintenanceMode",
      ),
    ).toBe(true);
  });
  it("does not expose telemetry identity/state as writable API columns", () => {
    const resource: VMwareResource = new VMwareResource();
    for (const field of [
      "projectId",
      "sourceId",
      "source",
      "resourceIdentifier",
      "resourceType",
      "name",
      "metadata",
      "metrics",
      "lastSeenAt",
      "lastReportedAt",
    ]) {
      expect(resource.getColumnAccessControlFor(field)?.update).toEqual([]);
    }
    expect(resource.createRecordPermissions).toEqual([]);
    expect(resource.deleteRecordPermissions).toEqual([]);
    const source: VMwareSource = new VMwareSource();
    for (const field of [
      "projectId",
      "sourceIdentifier",
      "metrics",
      "lastSeenAt",
      "lastCollectionAt",
      "lastSuccessfulCollectionAt",
      "collectionIntervalSeconds",
    ]) {
      expect(source.getColumnAccessControlFor(field)?.update).toEqual([]);
    }
    expect(
      source.hasUpdatePermissions([Permission.EditVMwareSource], "name"),
    ).toBe(true);
    expect(
      source.hasUpdatePermissions([Permission.EditVMwareSource], "isArchived"),
    ).toBe(true);
  });
});
