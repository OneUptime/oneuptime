import { describe, expect, test } from "@jest/globals";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import {
  InventorySettingsPolicy,
  getInventorySettingsPolicy,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventorySettingsPolicy";

describe("Inventory Settings source ownership", () => {
  test("manual items remain editable", () => {
    const policy: InventorySettingsPolicy = getInventorySettingsPolicy(
      EntitySource.Manual,
    );

    expect(policy.isEditable).toBe(true);
    expect(policy.readOnlyExplanation).toBeNull();
  });

  test.each([EntitySource.Discovered, EntitySource.Inventory])(
    "%s items are read-only and explain source ownership",
    (source: EntitySource) => {
      const policy: InventorySettingsPolicy =
        getInventorySettingsPolicy(source);

      expect(policy.isEditable).toBe(false);
      expect(policy.readOnlyExplanation).toContain("owns its name");
      expect(policy.readOnlyExplanation).toContain("Inventory would overwrite");
    },
  );

  test("an unknown source fails closed", () => {
    const policy: InventorySettingsPolicy =
      getInventorySettingsPolicy("future-source");

    expect(policy.isEditable).toBe(false);
    expect(policy.readOnlyExplanation).toContain("source-owned");
  });
});
