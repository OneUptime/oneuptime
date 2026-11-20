import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { ReactElement } from "react";

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/ResolveTypedRowLink",
  () => {
    return {
      __esModule: true,
      resolveTypedRowLink: () => {
        return Promise.resolve(null);
      },
    };
  },
);

import {
  INVENTORY_ASSET_COLUMN_ID_PREFIX,
  INVENTORY_SECURITY_PATCH_COLUMN_ID,
  getInventorySecurityPatchColumn,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryTable";
import { INVENTORY_ASSET_FIELD_LABELS } from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryAssetLabels";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import EntityType from "../../../Types/Telemetry/EntityType";
import Columns from "../../../UI/Components/ModelTable/Columns";
import { InventoryAssetField } from "../../../Utils/Inventory/InventoryAssetDetails";

/*
 * Inventory > All Items' Security Patch Level column (#9965): an Android
 * device's patch level, and whether it is behind - more than 90 days old -
 * hidden until the viewer turns it on, as the other asset facts are, and
 * the level itself in the CSV export.
 */

const NOW: Date = new Date("2026-11-19T08:27:37.467Z");

const column: Columns<InventoryItem>[number] =
  getInventorySecurityPatchColumn(NOW);

function item(
  entityType: EntityType,
  descriptive: Record<string, unknown> | undefined,
): InventoryItem {
  const row: InventoryItem = new InventoryItem();
  row.entityType = entityType;
  row.identifyingAttributes = { "host.name": "store-0412-kiosk-02" };
  if (descriptive) {
    row.descriptiveAttributes = descriptive as never;
  }
  return row;
}

function draw(row: InventoryItem): void {
  render(column.getElement!(row) as ReactElement);
}

afterEach(() => {
  cleanup();
});

describe("the Security Patch Level column", () => {
  test("is the asset detail's, hidden until turned on, never sorted, and phone cards leave it out", () => {
    expect(column.id).toBe(INVENTORY_SECURITY_PATCH_COLUMN_ID);
    expect(column.id).toBe(
      `${INVENTORY_ASSET_COLUMN_ID_PREFIX}${InventoryAssetField.SecurityPatch}`,
    );
    expect(column.title).toBe(
      INVENTORY_ASSET_FIELD_LABELS[InventoryAssetField.SecurityPatch],
    );
    expect(column.title).toBe("Security Patch Level");
    expect(column.isHiddenByDefault).toBe(true);
    expect(column.disableSort).toBe(true);
    expect(column.hideOnMobile).toBe(true);
  });

  test("a device more than 90 days behind reads its level, and Out of Date", () => {
    draw(item(EntityType.Host, { "android.os.security_patch": "2024-06-05" }));

    expect(screen.getByText("2024-06-05")).toBeInTheDocument();
    expect(screen.getByText("Out of Date")).toBeInTheDocument();
  });

  test("a device patched within 90 days reads Up to Date, at the boundary too", () => {
    draw(item(EntityType.Host, { "android.os.security_patch": "2026-08-21" }));

    expect(screen.getByText("2026-08-21")).toBeInTheDocument();
    expect(screen.getByText("Up to Date")).toBeInTheDocument();
  });

  test("anything with no patch level reads the quiet dash, and exports an empty cell", () => {
    for (const row of [
      item(EntityType.Host, { "os.type": "linux" }),
      item(EntityType.Host, { "android.os.security_patch": "unknown" }),
      item(EntityType.Service, undefined),
    ]) {
      const { container } = render(column.getElement!(row) as ReactElement);

      expect(container.textContent).not.toContain("Out of Date");
      expect(container.textContent).not.toContain("Up to Date");
      expect(column.getExportValue!(row)).toBe(
        row.descriptiveAttributes?.["android.os.security_patch"] === "unknown"
          ? "unknown"
          : "",
      );
      cleanup();
    }
  });

  test("the CSV export carries the level as the device reports it", () => {
    expect(
      column.getExportValue!(
        item(EntityType.Host, { "android.os.security_patch": "2024-06-05" }),
      ),
    ).toBe("2024-06-05");
  });
});
