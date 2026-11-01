import { normalizeMac } from "./EndpointAttachmentUtil";

/*
 * What the name a neighbour advertises says about the box behind it.
 *
 * LLDP and CDP carry whatever the far end chooses to call itself, and two
 * families of device put more in that field than a name:
 *
 *   - A Meraki device advertises its model in front of the name it carries in
 *     the dashboard: "Meraki MX85 - UN0660WANRTR01", or without the brand,
 *     "MS130-48P - UN0660LANSWI01" (both spellings are in the examples of
 *     Meraki's API, getDeviceLldpCdp and
 *     getOrganizationSwitchPortsTopologyDiscoveryByDevice). Read whole, that
 *     is nobody's name: the switch had reported the router, and the map drew
 *     a stranger beside it and left the router's cable to be drawn by hand
 *     (OneUptime issue #5379).
 *   - A Cisco IP phone is called SEP and its own MAC address, so its name is
 *     a MAC match the moment anything else has seen that MAC.
 *
 * Both read a value the far end sent, so both look at no more than a name's
 * length of it, and neither pattern can backtrack.
 */

export interface MerakiAdvertisedName {
  // The name the device carries in the dashboard.
  name: string;
  // What it advertised in front of it: "MX85".
  model: string;
}

// DNS's own limit on a name: nothing longer is one.
const MAX_ADVERTISED_NAME_LENGTH: number = 255;

const NAME_SEPARATOR: string = " - ";
const MERAKI_BRAND: string = "meraki ";

// With the brand in front, whatever follows it up to the separator is a model.
const BRANDED_MODEL_PATTERN: RegExp = /^[a-z0-9][a-z0-9-]*$/i;

/*
 * Without the brand, only Meraki's own product lines. "SW1 - Core" is one
 * person's name for a switch, and reading half of it as a device's name would
 * draw a cable to the wrong box.
 */
const MERAKI_MODEL_PATTERN: RegExp =
  /^(?:MS|MR|MX|MV|MG|MT|CW|GR|GS|GX|Z)\d[a-z0-9-]*$/i;

const CISCO_PHONE_NAME_PATTERN: RegExp = /^sep[0-9a-f]{12}$/i;

/**
 * The dashboard name and model in a name a Meraki device advertises, or
 * undefined when the value is not one of those. The first separator is the
 * one that counts: a dashboard name may hold " - " itself.
 */
export function parseMerakiAdvertisedName(
  value: string | undefined,
): MerakiAdvertisedName | undefined {
  if (!value) {
    return undefined;
  }

  const text: string = value.substring(0, MAX_ADVERTISED_NAME_LENGTH).trim();
  const separatorAt: number = text.indexOf(NAME_SEPARATOR);

  if (separatorAt <= 0) {
    return undefined;
  }

  const lead: string = text.substring(0, separatorAt).trim();
  const name: string = text
    .substring(separatorAt + NAME_SEPARATOR.length)
    .trim();

  if (!name) {
    return undefined;
  }

  if (lead.toLowerCase().startsWith(MERAKI_BRAND)) {
    const model: string = lead.substring(MERAKI_BRAND.length).trim();

    return BRANDED_MODEL_PATTERN.test(model) ? { name, model } : undefined;
  }

  return MERAKI_MODEL_PATTERN.test(lead) ? { name, model: lead } : undefined;
}

/**
 * The MAC address in a Cisco IP phone's name ("SEP002F5C7BF3E4"), normalised,
 * or undefined when the value is not such a name.
 */
export function getCiscoPhoneMac(
  value: string | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const text: string = value.substring(0, MAX_ADVERTISED_NAME_LENGTH).trim();

  return CISCO_PHONE_NAME_PATTERN.test(text)
    ? normalizeMac(text.substring(3))
    : undefined;
}
