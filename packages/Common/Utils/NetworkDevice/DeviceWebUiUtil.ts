import Hostname from "../../Types/API/Hostname";
import URL from "../../Types/API/URL";
import IP from "../../Types/IP/IP";

/*
 * A NETWORK DEVICE'S WEB UI, MONITORED.
 *
 * Most switches, routers, firewalls, printers and access points serve a
 * management page on their own address. "Monitor web UI" on a device's
 * Monitors card opens Create Monitor on a Website monitor of that page
 * (follow-up of issue #5145 and #5281): the address the device's probe
 * polls, over https, checked from the device's own probe, with self-signed
 * certificates allowed - a device's management page almost always has one.
 *
 * Why an action, and not Website templates a discovery import fills in per
 * device: putting a device's address into a template's URL is unsound once
 * a name in a certificate, a Host header or a path is involved. The action
 * makes one monitor, on a form the person reads before saving, and the URL
 * stays theirs to change (http, a port, a path).
 *
 * The device's Monitors card finds such a monitor again by what it is: a
 * Website monitor named after the device whose URL is on the device's
 * address (isWebUiMonitorOf).
 */

// Create Monitor's query parameter that says which check of a device to make.
export const DEVICE_MONITOR_CHECK_QUERY_PARAM: string = "check";

export enum DeviceMonitorCheck {
  // A Website monitor of the device's management page.
  WebUi = "web-ui",
}

export default class DeviceWebUiUtil {
  /*
   * The host part of a device's address: an IP, an IPv6 literal (bare or
   * in brackets) or a name, without a port someone typed after it. Empty
   * when there is none.
   */
  public static getHost(address: string | undefined): string {
    let host: string = (address || "").trim();

    if (host.startsWith("[")) {
      const closing: number = host.indexOf("]");

      return closing > 1 ? host.substring(1, closing) : "";
    }

    // Two colons or more: an IPv6 literal, not "host:port".
    if (host.indexOf(":") !== host.lastIndexOf(":")) {
      return host;
    }

    const colon: number = host.indexOf(":");

    if (colon !== -1) {
      host = host.substring(0, colon);
    }

    return host;
  }

  /*
   * The web UI's address: https on the device's own address -
   * "https://10.20.0.1/", "https://[2001:db8::1]/",
   * "https://core-sw-01.example.net/". Null when the device has no address
   * a URL can carry.
   */
  public static getUrl(address: string | undefined): URL | null {
    const host: string = DeviceWebUiUtil.getHost(address);

    if (!host) {
      return null;
    }

    const authority: string =
      IP.isIP(host) && host.includes(":") ? `[${host}]` : host;

    if (!Hostname.isValid(authority)) {
      return null;
    }

    try {
      return URL.fromString(`https://${authority}/`);
    } catch {
      return null;
    }
  }

  /*
   * The host a URL is on, lower-cased and without brackets or port, or
   * empty when the text is not a URL: what an address is compared with.
   */
  public static getUrlHost(url: URL | string | undefined | null): string {
    const text: string = (url?.toString() || "").trim();

    if (!text) {
      return "";
    }

    try {
      const parsed: globalThis.URL = new globalThis.URL(text);
      let host: string = parsed.hostname.toLowerCase();

      if (host.startsWith("[") && host.endsWith("]")) {
        host = host.substring(1, host.length - 1);
      }

      return host;
    } catch {
      return "";
    }
  }

  // Whether a URL is on the device's address, whatever its scheme or path.
  public static isOnAddress(data: {
    url: URL | string | undefined | null;
    address: string | undefined;
  }): boolean {
    const deviceHost: string = DeviceWebUiUtil.getHost(
      data.address,
    ).toLowerCase();

    if (!deviceHost) {
      return false;
    }

    const urlHost: string = DeviceWebUiUtil.getUrlHost(data.url);

    if (!urlHost) {
      return false;
    }

    if (urlHost === deviceHost) {
      return true;
    }

    // One IPv6 address written two ways ("2001:DB8::1", "2001:db8:0::1").
    const deviceUrlHost: string = DeviceWebUiUtil.getUrlHost(
      DeviceWebUiUtil.getUrl(deviceHost),
    );

    return Boolean(deviceUrlHost) && deviceUrlHost === urlHost;
  }

  /*
   * Whether a Website monitor is a device's web UI monitor, as the device's
   * Monitors card lists it: named after the device - the action names it
   * "<device> web UI", in the reader's language - with a step on the
   * device's address.
   */
  public static isWebUiMonitorOf(data: {
    monitorName: string | undefined;
    destinations: Array<URL | string | undefined | null>;
    deviceName: string | undefined;
    deviceAddress: string | undefined;
  }): boolean {
    const deviceName: string = (data.deviceName || "").trim().toLowerCase();
    const monitorName: string = (data.monitorName || "").trim().toLowerCase();

    if (!deviceName || !monitorName.includes(deviceName)) {
      return false;
    }

    return data.destinations.some(
      (destination: URL | string | undefined | null): boolean => {
        return DeviceWebUiUtil.isOnAddress({
          url: destination,
          address: data.deviceAddress,
        });
      },
    );
  }
}
