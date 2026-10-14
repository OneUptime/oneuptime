import { arubaAosCx, arubaAosSwitch } from "./Vendors/Aruba";
import cambiumEnterpriseWifi from "./Vendors/Cambium";
import cisco from "./Vendors/Cisco";
import { extremeExos, extremeVoss } from "./Vendors/Extreme";
import fortinetFortiGate from "./Vendors/Fortinet";
import linux from "./Vendors/Linux";
import mikroTikRouterOs from "./Vendors/MikroTik";
import sophosFirewall from "./Vendors/Sophos";
import ubiquitiUniFi from "./Vendors/UniFi";
import { SyslogParserId, SyslogVendorParser } from "./SyslogVendorParser";

/*
 * THE BUILT-IN SYSLOG PARSERS, in the order they are tried.
 *
 * A message is read by the first parser that recognises it. The order only
 * matters where two could claim a line, and it goes from the most certain
 * mark to the least: a CEF header naming the vendor, key=value layouts with
 * a vendor's own field names, marks no other vendor writes
 * (%FACILITY-SEVERITY-MNEMONIC, <Info:...>, Event|ID|LOG_...), and last the
 * programs every Linux-based device runs.
 */
export const SYSLOG_VENDOR_PARSERS: ReadonlyArray<SyslogVendorParser> = [
  ubiquitiUniFi,
  sophosFirewall,
  fortinetFortiGate,
  cisco,
  extremeExos,
  extremeVoss,
  arubaAosCx,
  arubaAosSwitch,
  mikroTikRouterOs,
  cambiumEnterpriseWifi,
  linux,
];

export default class SyslogVendorCatalog {
  public static getParsers(): ReadonlyArray<SyslogVendorParser> {
    return SYSLOG_VENDOR_PARSERS;
  }

  public static getParser(id: unknown): SyslogVendorParser | null {
    return (
      SYSLOG_VENDOR_PARSERS.find((parser: SyslogVendorParser): boolean => {
        return parser.id === id;
      }) || null
    );
  }

  /*
   * The makers the parsers read, each once, in catalog order. The parser
   * for Linux-based devices names none.
   */
  public static getVendors(): Array<string> {
    const vendors: Array<string> = [];

    for (const parser of SYSLOG_VENDOR_PARSERS) {
      if (parser.vendor && !vendors.includes(parser.vendor)) {
        vendors.push(parser.vendor);
      }
    }

    return vendors;
  }

  // The parsers of one maker.
  public static getParsersOfVendor(vendor: string): Array<SyslogVendorParser> {
    return SYSLOG_VENDOR_PARSERS.filter(
      (parser: SyslogVendorParser): boolean => {
        return parser.vendor === vendor;
      },
    );
  }

  public static isParserId(value: unknown): value is SyslogParserId {
    return (
      typeof value === "string" &&
      (Object.values(SyslogParserId) as Array<string>).includes(value)
    );
  }
}
