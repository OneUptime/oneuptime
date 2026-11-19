/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time via the services' queue imports; nothing queue-related is
 * under test here, so the module is replaced - same idiom as
 * AndroidDeviceAgentIngest.test.ts in this directory.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

// See AndroidDeviceAgentIngest.test.ts: replaced with a factory.
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import InventoryItem, {
  EntityAttributes,
  ExtractedEntity,
} from "Common/Server/Utils/Telemetry/TelemetryEntity";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import {
  ManagedDeviceHostCandidate,
  ManagedDeviceHostChoice,
  chooseManagedDeviceHost,
  getManagedDeviceHostAttributes,
  mergeManagedDeviceHostAttributes,
} from "Common/Server/Utils/DeviceManagement/ManagedDeviceInventory";
import {
  ANDROID_SECURITY_PATCH_LEVEL_ATTRIBUTE,
  MANAGED_DEVICE_HOST_NAME_ATTRIBUTE,
  MANAGED_DEVICE_SERIAL_NUMBER_ATTRIBUTE,
  ManagedDeviceHostMatch,
  canonicalizeManagedDeviceIdentity,
  getManagedDeviceHostName,
  getUsableSerialNumber,
} from "Common/Types/DeviceManagement/ManagedDeviceIdentity";
import Dictionary from "Common/Types/Dictionary";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  canonicalizeEntityValue,
  keyForHost,
} from "Common/Utils/Telemetry/EntityKey";
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ONE DEVICE, ONE INVENTORY ITEM: AN ESPER DEVICE AND THE ANDROID AGENT ON
 * IT (issues #9586 and #9587).
 *
 * The agent's own golden OTLP request (agents/AndroidAgent, the resource
 * DeviceResource builds) is run through the same entity extraction ingest
 * uses, and the device it describes is then imported from Esper the way
 * ManagedDeviceInventory imports it:
 *
 *   - with the agent's documented Esper configuration, `device_name:
 *     ${esper.deviceName}`, the agent's host is keyed by the device's Esper
 *     name: the import finds that very item (rule 1), and its host.name is
 *     the one the Hosts product keys the agent's Host by;
 *   - an agent named anything else is still found by `device_serial:
 *     ${esper.serialNumber}` (rule 2);
 *   - the import adds Esper's facts beside the agent's and overwrites none
 *     of them, and its patch level is the agent's own key.
 */

const FIXTURES: string = path.resolve(
  __dirname,
  "../../../../agents/AndroidAgent/app/src/test/resources/otlp",
);

const METRICS: JSONObject = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, "android-agent-metrics.json"), "utf8"),
) as JSONObject;

const RESOURCE_ATTRIBUTES: JSONArray = (
  ((METRICS["resourceMetrics"] as JSONArray)[0] as JSONObject)[
    "resource"
  ] as JSONObject
)["attributes"] as JSONArray;

const PROJECT_ID: string = ObjectID.generate().toString();

// The resource as ingest flattens it for entity extraction.
const RESOURCE: EntityAttributes = TelemetryUtil.getAttributes({
  items: RESOURCE_ATTRIBUTES,
  prefixKeysWithString: "",
}) as EntityAttributes;

const AGENT_HOST: ExtractedEntity = InventoryItem.extractEntities({
  projectId: PROJECT_ID,
  attributes: RESOURCE,
}).find((entity: ExtractedEntity): boolean => {
  return entity.entityType === EntityType.Host;
})!;

const DEVICE_NAME: string = String(RESOURCE["host.name"]);
const SERIAL_NUMBER: string = String(RESOURCE["host.serial_number"]);

// The agent's item, as the import reads a candidate host.
function agentItem(): ManagedDeviceHostCandidate {
  return {
    id: "agent-host",
    entityKey: AGENT_HOST.entityKey,
    source: EntitySource.Discovered,
    resourceType: "",
    resourceId: "",
    displayName: DEVICE_NAME,
    descriptiveAttributes: {
      ...(AGENT_HOST.descriptiveAttributes as Record<string, unknown>),
    },
    hasCustomFields: false,
    isArchived: false,
    lastSeenAt: null,
  };
}

function choose(byName: boolean): ManagedDeviceHostChoice {
  return chooseManagedDeviceHost({
    device: {
      id: "device-row",
      inventoryItemId: "",
      inventoryMatch: undefined,
      written: { attributes: {}, displayName: "" },
    },
    current: undefined,
    byName: byName ? agentItem() : undefined,
    bySerial: [agentItem()],
    heldByOthers: new Set<string>(),
  });
}

describe("an Esper device the Android agent also reports", () => {
  test("the golden request is the agent's: a host, named and numbered by the device manager", () => {
    expect(AGENT_HOST).toBeDefined();
    expect(DEVICE_NAME).toBe("store-0412-kiosk-02");
    expect(getUsableSerialNumber(SERIAL_NUMBER)).toBe("elo123456");
    // ANDROID_ID: nothing a device manager knows, so not part of the contract.
    expect(RESOURCE["host.id"]).toBe("3f2a9c1b7d4e5a60");
  });

  test("named by its Esper name, its item is the one the import keys the device by", () => {
    expect(AGENT_HOST.entityKey).toBe(
      keyForHost(
        PROJECT_ID,
        canonicalizeManagedDeviceIdentity(
          getManagedDeviceHostName({ deviceName: DEVICE_NAME }),
        ),
      ),
    );
    expect(choose(true)).toEqual({
      match: ManagedDeviceHostMatch.Name,
      itemId: "agent-host",
    });
  });

  test("...and its host.name is the one the Hosts product keys the agent's Host by", () => {
    expect(
      AGENT_HOST.identifyingAttributes[MANAGED_DEVICE_HOST_NAME_ATTRIBUTE],
    ).toBe(canonicalizeEntityValue(DEVICE_NAME));
  });

  test("named anything else, it is still found by its serial number", () => {
    expect(
      String(
        AGENT_HOST.descriptiveAttributes?.[
          MANAGED_DEVICE_SERIAL_NUMBER_ATTRIBUTE
        ],
      ).toLowerCase(),
    ).toBe(getUsableSerialNumber(SERIAL_NUMBER));
    expect(choose(false)).toEqual({
      match: ManagedDeviceHostMatch.SerialNumber,
      itemId: "agent-host",
    });
  });

  test("the import adds Esper's facts and overwrites none of the agent's, with one patch level", () => {
    const current: Record<string, unknown> = {
      ...(AGENT_HOST.descriptiveAttributes as Record<string, unknown>),
    };
    // What Esper reports about the same device, worded its own way.
    const desired: Dictionary<string> = getManagedDeviceHostAttributes({
      providerDeviceId: "811a2d27-13fd-4358-8dc3-aed049e73ce7",
      deviceName: DEVICE_NAME,
      serialNumber: SERIAL_NUMBER,
      manufacturer: "Elo Touch Solutions",
      model: "Elo-i3-15",
      osVersion: "14.0",
      buildNumber: "ELO-I3-15-14.0.0-2024.06",
      securityPatchLevel: "2024-06-05",
      groupPath: "All Devices/Stores/EMEA",
      ipAddresses: "10.20.30.40",
      isKioskMode: true,
    });
    const merged: { attributes: JSONObject } | null =
      mergeManagedDeviceHostAttributes({ current, desired, written: {} });

    expect(merged).not.toBeNull();

    for (const [key, value] of Object.entries(current)) {
      expect({ key, value: merged!.attributes[key] }).toEqual({ key, value });
    }

    // The patch level under the key the agent sends it with, one value.
    expect(ANDROID_SECURITY_PATCH_LEVEL_ATTRIBUTE).toBe(
      "android.os.security_patch",
    );
    expect(RESOURCE[ANDROID_SECURITY_PATCH_LEVEL_ATTRIBUTE]).toBe("2024-06-05");
    expect(merged!.attributes[ANDROID_SECURITY_PATCH_LEVEL_ATTRIBUTE]).toBe(
      "2024-06-05",
    );
    expect(merged!.attributes["esper.group"]).toBe("All Devices/Stores/EMEA");
  });
});
