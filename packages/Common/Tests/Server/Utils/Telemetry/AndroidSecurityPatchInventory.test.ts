/*
 * Issue #9800: an Android device's security patch level, which the OneUptime
 * Android agent sends on every report and the Esper import writes, never
 * reached its Inventory item: the Host allowlist of descriptive attributes
 * left `android.os.security_patch` out, so neither the Asset Details card,
 * the All Items columns nor a CMDB export could show it.
 *
 * Run at the seam ingest uses: the agent's own resource attributes, flattened
 * as ingest flattens them, through the entity extractor, then read as asset
 * details. The DatabaseService stub keeps the server-side service layer out,
 * as HostAssetAttributesFromOtlp.test.ts explains.
 */
jest.mock("../../../../Server/Services/DatabaseService", () => {
  return {
    __esModule: true,
    default: class DatabaseServiceStub {
      public hardDeleteItemsOlderThanInDays(): void {
        // no-op: retention config.
      }

      public setDoNotAllowDelete(): void {
        // no-op: delete-permission config.
      }

      public keepRowsOnDeleteByQuery(): void {
        // no-op: the rows a delete by query keeps.
      }
    },
  };
});

import TelemetryUtil, {
  AttributeType,
} from "../../../../Server/Utils/Telemetry/Telemetry";
import InventoryItem, {
  EntityAttributes,
  ExtractedEntity,
} from "../../../../Server/Utils/Telemetry/TelemetryEntity";
import { ANDROID_SECURITY_PATCH_LEVEL_ATTRIBUTE } from "../../../../Types/DeviceManagement/ManagedDeviceIdentity";
import Dictionary from "../../../../Types/Dictionary";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import EntityType from "../../../../Types/Telemetry/EntityType";
import {
  INVENTORY_ASSET_ATTRIBUTE_KEYS,
  INVENTORY_ASSET_OPTIONAL_FIELDS,
  InventoryAssetDetail,
  InventoryAssetDetails,
  InventoryAssetField,
  getInventoryAssetDetails,
  getInventoryAssetValue,
} from "../../../../Utils/Inventory/InventoryAssetDetails";
import { describe, expect, test } from "@jest/globals";

function text(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

// The resource the agent builds for an Elo kiosk (agents/AndroidAgent DeviceResource.kt).
function kioskResource(patch: string | null): JSONArray {
  return [
    text("host.name", "store-0412-kiosk-02"),
    text("host.arch", "arm64"),
    text("os.type", "linux"),
    text("os.name", "Android"),
    text("os.version", "14"),
    text(
      "os.description",
      "Android Version 14 (Build UP1A.231005.007 API level 34)",
    ),
    text("device.manufacturer", "Elo Touch Solutions"),
    text("device.model.name", "Elo-i3-15"),
    ...(patch ? [text("android.os.security_patch", patch)] : []),
  ] as JSONArray;
}

function extractHost(attributes: JSONArray): ExtractedEntity {
  const flat: Dictionary<AttributeType | Array<AttributeType>> =
    TelemetryUtil.getAttributes({
      items: attributes,
      prefixKeysWithString: "",
    });

  return InventoryItem.extractEntities({
    projectId: "proj1",
    attributes: flat as EntityAttributes,
  }).find((entity: ExtractedEntity) => {
    return entity.entityType === EntityType.Host;
  })!;
}

function securityPatchOf(
  details: InventoryAssetDetails | undefined,
): InventoryAssetDetail | undefined {
  return details?.details.find((detail: InventoryAssetDetail) => {
    return detail.field === InventoryAssetField.SecurityPatch;
  });
}

describe("an Android device's security patch level in Inventory (issue #9800)", () => {
  test("the agent's patch level reaches the host's Inventory item", () => {
    const host: ExtractedEntity = extractHost(kioskResource("2024-06-05"));

    expect(host.descriptiveAttributes!["android.os.security_patch"]).toBe(
      "2024-06-05",
    );
    // A descriptive fact, never part of the identity: a patch must not fork the device's item.
    expect(host.identifyingAttributes).toEqual({
      "host.name": "store-0412-kiosk-02",
    });
    expect(host.entityKey).toBe(extractHost(kioskResource(null)).entityKey);
  });

  test("its Asset Details show it, after the facts every machine has", () => {
    const host: ExtractedEntity = extractHost(kioskResource("2024-06-05"));
    const details: InventoryAssetDetails | undefined = getInventoryAssetDetails(
      {
        entityType: EntityType.Host,
        identifyingAttributes: host.identifyingAttributes,
        descriptiveAttributes: host.descriptiveAttributes,
      },
    );

    const patch: InventoryAssetDetail | undefined = securityPatchOf(details);
    expect(patch?.value).toBe("2024-06-05");
    expect(details!.details[details!.details.length - 1]!.field).toBe(
      InventoryAssetField.SecurityPatch,
    );
    // Optional: never counted among the unknown facts.
    expect(details!.unknownFields).not.toContain(
      InventoryAssetField.SecurityPatch,
    );
  });

  test("a machine without one shows no row for it, rather than Unknown", () => {
    const details: InventoryAssetDetails | undefined = getInventoryAssetDetails(
      {
        entityType: EntityType.Host,
        identifyingAttributes: { "host.name": "web-01" },
        descriptiveAttributes: { "os.type": "linux" },
      },
    );

    expect(securityPatchOf(details)).toBeUndefined();
    expect(details!.unknownFields).not.toContain(
      InventoryAssetField.SecurityPatch,
    );
  });

  test("a list column and a CSV export read it like any other fact", () => {
    expect(
      getInventoryAssetValue(
        {
          entityType: EntityType.Host,
          identifyingAttributes: { "host.name": "store-0412-kiosk-02" },
          descriptiveAttributes: { "android.os.security_patch": "2024-06-05" },
        },
        InventoryAssetField.SecurityPatch,
      ),
    ).toBe("2024-06-05");
  });

  test("the agent and the Esper import share one key, so a device both report has one value", () => {
    expect(
      INVENTORY_ASSET_ATTRIBUTE_KEYS[InventoryAssetField.SecurityPatch],
    ).toBe(ANDROID_SECURITY_PATCH_LEVEL_ATTRIBUTE);
    expect(ANDROID_SECURITY_PATCH_LEVEL_ATTRIBUTE).toBe(
      "android.os.security_patch",
    );
    expect(INVENTORY_ASSET_OPTIONAL_FIELDS).toContain(
      InventoryAssetField.SecurityPatch,
    );
  });

  test("the patch level an OpenTelemetry Android app sends on its own resource is kept the same way", () => {
    // A kiosk app that names the device in host.name and stamps the patch level joins the same item.
    const host: ExtractedEntity = extractHost([
      text("host.name", "store-0412-kiosk-02"),
      text("os.type", "linux"),
      text("android.os.security_patch", "2024-07-01"),
    ] as JSONArray);

    expect(host.descriptiveAttributes!["android.os.security_patch"]).toBe(
      "2024-07-01",
    );
  });
});
