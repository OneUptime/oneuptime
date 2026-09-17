import { normalizeMac } from "../../../Utils/Monitor/EndpointAttachmentUtil";
import OuiVendorsJson from "./Data/OuiVendors.json";

/*
 * MAC OUI → hardware vendor lookup for discovered network endpoints.
 *
 * Data/OuiVendors.json is generated from the IEEE MA-L registry:
 *   source:  https://standards-oui.ieee.org/oui/oui.csv
 *   fetched: 2026-07-22
 *   filter:  organization name contains (case-insensitive substring) any of:
 *            Cisco, Meraki, Aruba, Hewlett Packard, HPE, Ubiquiti, MikroTik,
 *            Juniper, Fortinet, Palo Alto, Ruckus, Extreme, Netgear, TP-Link,
 *            D-Link, Zyxel, Dell, Intel, VMware, Raspberry Pi, NCR, Toshiba,
 *            Elo Touch, Epson, Star Micronics, Zebra, Honeywell, Datalogic,
 *            Verifone, Ingenico, PAX, Clover, Samsung, LG Electronics, Sony,
 *            Apple, Microsoft, Axis Communications, Bose, Sonos, Brother,
 *            Canon, Xerox, Lexmark
 *   shape:   { "<6 lowercase hex chars, no separators>": "<Organization
 *            Name from the registry row>" }, keys sorted ascending.
 *
 * Values are the registry's own organization names ("Cisco Systems, Inc",
 * "Raspberry Pi Foundation", …), not the filter labels. To refresh, re-run
 * the same fetch + filter and regenerate the file; keep it well under 400KB
 * (the network/POS-focused filter above lands around 240KB).
 *
 * Only 24-bit MA-L (OUI) prefixes are supported — the 28/36-bit MA-M/MA-S
 * registries are intentionally out of scope.
 */

const vendorByOuiPrefix: Record<string, string> = OuiVendorsJson as Record<
  string,
  string
>;

export default class OuiLookupUtil {
  /*
   * Returns the registered vendor for a MAC address, or undefined when the
   * MAC is malformed or its OUI is not in the (filtered) registry data.
   * Accepts any spelling normalizeMac understands.
   */
  public static lookupVendor(mac: string | undefined): string | undefined {
    const normalized: string | undefined = normalizeMac(mac);
    if (!normalized) {
      return undefined;
    }
    const prefix: string = normalized.replace(/:/g, "").substring(0, 6);
    return vendorByOuiPrefix[prefix];
  }
}
