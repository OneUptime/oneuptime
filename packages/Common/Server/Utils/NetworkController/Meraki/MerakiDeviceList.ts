import IP from "../../../../Types/IP/IP";
import { JSONObject } from "../../../../Types/JSON";
import {
  MAX_CONTROLLER_VALUE_LENGTH,
  NETWORK_CONTROLLER_PRODUCT_TYPES,
  NetworkDeviceControllerField,
} from "../../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import {
  NetworkControllerAppliance,
  NetworkControllerDevice,
} from "../NetworkControllerTypes";
import { TEXT_LIMITS, cleanMac, cleanSerial, cleanText } from "./MerakiUsageRecords";

/*
 * THE ORGANIZATION'S DEVICE LIST (GET organizations/{id}/devices, every
 * product type), as the read keeps it.
 *
 * One listing serves two readers. The traffic read names and attributes its
 * uplinks by the appliances in it (MX and Z, product type "appliance"), as
 * it did when it listed only those; and Inventory takes the details a device
 * in OneUptime lacks from what Meraki says about the same box - its model,
 * serial number, firmware, MAC, management address, name, network and the
 * street address it is filed under (NetworkControllerInventory). Listing
 * every product type costs nothing more for an organization of up to 1,000
 * devices - one page either way - and a page for each 1,000 past that.
 *
 * Nothing in it is trusted: every text is cleaned and cut, a MAC goes
 * through the one MAC normaliser, an address must be an address literal, a
 * product type must be one Meraki names, and a device with no serial number
 * or no network is skipped - Meraki lists every device of a network with
 * both, and the serial number is what a device is known by.
 */

function asObject(value: unknown): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

// An address literal Meraki gave, or "".
function readAddressLiteral(value: unknown): string {
  const text: string = cleanText(
    value,
    MAX_CONTROLLER_VALUE_LENGTH[NetworkDeviceControllerField.IpAddress],
  );

  return text && IP.isIP(text) ? text : "";
}

// A product type Meraki names, or "".
function readProductType(value: unknown): string {
  const text: string = cleanText(
    value,
    MAX_CONTROLLER_VALUE_LENGTH[NetworkDeviceControllerField.ProductType],
  );

  return NETWORK_CONTROLLER_PRODUCT_TYPES.includes(text) ? text : "";
}

/*
 * The devices of an organization's device list, each once (by serial number,
 * the first listing wins), with the network each belongs to named from the
 * read's listing of networks.
 */
export function readMerakiDevices(
  values: Array<unknown>,
  networkNames: Map<string, string>,
): Array<NetworkControllerDevice> {
  const devices: Array<NetworkControllerDevice> = [];
  const seen: Set<string> = new Set();

  for (const value of values) {
    const device: JSONObject | null = asObject(value);

    if (!device) {
      continue;
    }

    const serial: string = cleanSerial(device["serial"]);
    const networkId: string = cleanText(
      device["networkId"],
      TEXT_LIMITS.networkId,
    );

    if (!serial || !networkId || seen.has(serial)) {
      continue;
    }

    seen.add(serial);
    devices.push({
      serial: serial,
      name: cleanText(device["name"], TEXT_LIMITS.deviceName),
      model: cleanText(device["model"], TEXT_LIMITS.model),
      mac: cleanMac(device["mac"]),
      lanIp: readAddressLiteral(device["lanIp"]),
      firmware: cleanText(
        device["firmware"],
        MAX_CONTROLLER_VALUE_LENGTH[NetworkDeviceControllerField.FirmwareVersion],
      ),
      productType: readProductType(device["productType"]),
      controllerNetworkId: networkId,
      networkName: networkNames.get(networkId) || "",
      address: cleanText(
        device["address"],
        MAX_CONTROLLER_VALUE_LENGTH[NetworkDeviceControllerField.Address],
      ),
    });
  }

  return devices;
}

/*
 * The appliances of a device list (MX and Z: product type "appliance"): what
 * the traffic read's uplinks are attributed and named by.
 */
export function getMerakiAppliances(
  devices: Array<NetworkControllerDevice>,
): Array<NetworkControllerAppliance> {
  return devices
    .filter((device: NetworkControllerDevice): boolean => {
      return device.productType === "appliance";
    })
    .map((device: NetworkControllerDevice): NetworkControllerAppliance => {
      return {
        serial: device.serial,
        name: device.name,
        model: device.model,
        mac: device.mac,
        controllerNetworkId: device.controllerNetworkId,
      };
    });
}
