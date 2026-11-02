import { JSONArray, JSONObject } from "Common/Types/JSON";

/*
 * A READING CARRIES ITS FLEET AS ONEUPTIME STORES IT.
 *
 * A fleet is found and created by name case aside (IoTFleetService), so a
 * gateway sending `iot.fleet.name=warehouse` lands in the fleet named
 * "Warehouse" - but its rows kept "warehouse", and the fleet's own pages,
 * which filter on the stored name exactly, left them out. Ingest now writes
 * the stored name onto the reading before its rows are built. Monitors match
 * the fleet case aside already (MonitorTelemetryMonitor), and a device
 * authenticated over MQTT publishes under the stored name (MqttTelemetryMapper
 * .scopePublishToDevice): this covers OTLP senders and MQTT clients on a
 * project key.
 *
 * Only the case and the spaces around the name are corrected. A name that
 * differs otherwise is not this fleet's - a fleet renamed since the id cache
 * last read it - and is left as sent.
 */

// The keys a fleet name rides under: OTLP's, and the flattened form's alias.
export const IOT_FLEET_NAME_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  "iot.fleet.name",
  "resource.iot.fleet.name",
];

// Whether two fleet names name the same fleet, as fleet find-or-create matches.
export function isSameIoTFleetName(a: string, b: string): boolean {
  return (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
}

/*
 * Rewrites, in place, every fleet-name attribute that names the stored fleet
 * in another case or with spaces around it. Returns whether any changed.
 */
export function stampStoredIoTFleetName(data: {
  attributes: JSONArray;
  storedName: string;
}): boolean {
  const storedName: string = (data.storedName || "").trim();

  if (!storedName) {
    return false;
  }

  let changed: boolean = false;

  for (const attribute of data.attributes || []) {
    if (!attribute || typeof attribute !== "object") {
      continue;
    }

    const entry: JSONObject = attribute as JSONObject;

    if (!IOT_FLEET_NAME_ATTRIBUTE_KEYS.includes(String(entry["key"]))) {
      continue;
    }

    const value: JSONObject | undefined = entry["value"] as
      | JSONObject
      | undefined;
    const sent: unknown = value?.["stringValue"];

    if (
      !value ||
      typeof sent !== "string" ||
      sent === storedName ||
      !isSameIoTFleetName(sent, storedName)
    ) {
      continue;
    }

    value["stringValue"] = storedName;
    changed = true;
  }

  return changed;
}
