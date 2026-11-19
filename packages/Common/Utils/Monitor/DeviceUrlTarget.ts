import Hostname from "../../Types/API/Hostname";
import URL from "../../Types/API/URL";
import BadDataException from "../../Types/Exception/BadDataException";
import IP from "../../Types/IP/IP";
import MonitorType from "../../Types/Monitor/MonitorType";
import { translationKey } from "../../Types/Translator";
import DeviceWebUiUtil from "../NetworkDevice/DeviceWebUiUtil";

/*
 * A WEBSITE, API OR SSL CERTIFICATE TEMPLATE'S URL, ON EACH DEVICE (OneUptime
 * issue #9546).
 *
 * A discovery import or an auto import rule can give each device a monitor
 * from a template. A Ping, IP, Port or NTP template's steps name an address,
 * and each device's monitor checks the device's own address instead. A
 * Website, API or SSL Certificate template's steps name a URL, and the same
 * goes for its host: each device's monitor checks the template's URL with
 * the device's address as the host.
 *
 * Everything else in the URL is the template's, kept exactly as written - the
 * scheme, any user name, the port, the path, the query and the fragment - so
 * whoever writes the template decides where on each device to look:
 *
 *   https://device:8443/status   ->  https://10.0.0.5:8443/status
 *   http://printer/hp/device/    ->  http://10.20.0.7/hp/device/
 *   https://ups/                 ->  https://[2001:db8::1]/
 *
 * The template's own host is only a placeholder. It must be one, though: a
 * URL with no host has nothing to replace, and a host written as a variable
 * ({{monitorSecrets.host}}) is meant to be read when the check runs, not
 * thrown away - both are refused with a sentence that says what to change.
 * Only http and https URLs carry a host a device's address can take.
 *
 * Why the text is cut by hand rather than read by the WHATWG parser: that
 * parser re-encodes what it does not like, and a query such as
 * ?token={{monitorSecrets.ApiKey}} has to reach the probe exactly as written
 * for the secret to be put in it. It also takes "{{x}}" for an ordinary host,
 * and quietly ignores a host it cannot set. So only the host is replaced, and
 * every other character of the URL stays the template's.
 *
 * Pure: no database, no permission work.
 */

/*
 * What the refusals below say, so a caller and its tests use the same words.
 * The template ones are also shown before an import starts, in the
 * reader's language: the import's Monitoring step says why a template it
 * lists cannot give each device a monitor.
 */
export const URL_TEMPLATE_NEEDS_URL: string = translationKey(
  "Every step of a Website, API or SSL Certificate template must check a URL. Add one to the template, then pick it again.",
);

export const URL_TEMPLATE_NEEDS_WEB_SCHEME: string = translationKey(
  "A Website, API or SSL Certificate template's URL must start with http:// or https:// for each device's address to be put in it. Change the template's URL, then pick it again.",
);

export const URL_TEMPLATE_NEEDS_HOST: string = translationKey(
  "Each device's address takes the place of the host in the template's URL, and this URL has none. Write one in, such as https://device/, then pick it again.",
);

export const URL_TEMPLATE_HOST_IS_VARIABLE: string = translationKey(
  "This template's URL names its host with a variable, which is read when the check runs, so each device's address cannot take its place. Write a host into the URL, such as https://device/, then pick it again.",
);

export const URL_TEMPLATE_PORT_NOT_A_NUMBER: string = translationKey(
  "The port in this template's URL is not a number. Write the port each device answers on, such as https://device:8443/, then pick it again.",
);

export const DEVICE_ADDRESS_NOT_A_URL_HOST: string =
  "This device's address cannot be the host of a URL, so a Website, API or SSL Certificate monitor cannot check it.";

// The port a URL asks on when it names none.
export const DEFAULT_PORT_BY_SCHEME: Readonly<Record<string, number>> = {
  http: 80,
  https: 443,
};

/*
 * A URL as written, cut at its host: what comes before it, the host itself,
 * and what comes after it. Joined back together they are the URL, character
 * for character.
 */
export interface DeviceUrlParts {
  // "http" or "https", lower-cased.
  scheme: string;
  // A user name (and password) with its "@", as written; empty when none.
  userInfo: string;
  // The host as written: an IPv6 literal keeps its brackets. May be empty.
  host: string;
  // The port with its ":", as written; empty when the URL names none.
  port: string;
  // The path, query and fragment, as written; empty when none.
  rest: string;
}

const SCHEME_AND_AUTHORITY: RegExp =
  /^\s*([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([\s\S]*)$/;

const PORT: RegExp = /^:\d{1,5}$/;

function readText(url: URL | string | null | undefined): string {
  return (url?.toString() || "").trim();
}

function isVariable(text: string): boolean {
  return text.includes("{{") || text.includes("}}");
}

export default class DeviceUrlTarget {
  /*
   * The URL cut at its host (DeviceUrlParts), or null when it has no
   * "scheme://" to cut at. Reads, and refuses nothing: an http URL with no
   * host still has parts, with an empty host.
   */
  public static readParts(
    url: URL | string | null | undefined,
  ): DeviceUrlParts | null {
    const match: RegExpMatchArray | null =
      readText(url).match(SCHEME_AND_AUTHORITY);

    if (!match) {
      return null;
    }

    const authority: string = match[2] || "";
    const at: number = authority.lastIndexOf("@");
    const userInfo: string = at === -1 ? "" : authority.substring(0, at + 1);
    const hostAndPort: string = authority.substring(at + 1);

    let host: string = hostAndPort;
    let port: string = "";

    if (hostAndPort.startsWith("[")) {
      const closing: number = hostAndPort.indexOf("]");

      host =
        closing === -1 ? hostAndPort : hostAndPort.substring(0, closing + 1);
      port = closing === -1 ? "" : hostAndPort.substring(closing + 1);
    } else {
      const colon: number = hostAndPort.indexOf(":");

      if (colon !== -1) {
        host = hostAndPort.substring(0, colon);
        port = hostAndPort.substring(colon);
      }
    }

    return {
      scheme: (match[1] || "").toLowerCase(),
      userInfo: userInfo,
      host: host,
      port: port,
      rest: match[3] || "",
    };
  }

  /*
   * The parts of a template's URL a device's address can be put in, or the
   * refusal that says what to change in the template: a URL to start with,
   * http or https, a host that is a placeholder - not empty, not a variable -
   * and a port that is a number.
   */
  public static assertTemplateUrl(
    url: URL | string | null | undefined,
  ): DeviceUrlParts {
    if (!readText(url)) {
      throw new BadDataException(URL_TEMPLATE_NEEDS_URL);
    }

    const parts: DeviceUrlParts | null = this.readParts(url);

    if (!parts || (parts.scheme !== "http" && parts.scheme !== "https")) {
      throw new BadDataException(URL_TEMPLATE_NEEDS_WEB_SCHEME);
    }

    /*
     * The host only: a password read from a secret
     * (https://admin:{{monitorSecrets.pw}}@device/) is the template's to
     * keep, and is kept.
     */
    if (isVariable(parts.host)) {
      throw new BadDataException(URL_TEMPLATE_HOST_IS_VARIABLE);
    }

    if (!parts.host || parts.host === "[]") {
      throw new BadDataException(URL_TEMPLATE_NEEDS_HOST);
    }

    if (parts.port && !PORT.test(parts.port)) {
      throw new BadDataException(URL_TEMPLATE_PORT_NOT_A_NUMBER);
    }

    return parts;
  }

  /*
   * How a device's address is written as a URL's host: an IPv6 address in
   * brackets, anything else as it is, without a port someone typed after it.
   * The template decides the port. Refused when the address cannot be a
   * host at all.
   */
  public static toUrlHost(address: string | null | undefined): string {
    const host: string = DeviceWebUiUtil.getHost(address || "");

    if (!host) {
      throw new BadDataException(
        "This device has no address, so a monitor cannot check it.",
      );
    }

    const urlHost: string =
      IP.isIP(host) && host.includes(":") ? `[${host}]` : host;

    if (!Hostname.isValid(urlHost)) {
      throw new BadDataException(DEVICE_ADDRESS_NOT_A_URL_HOST);
    }

    return urlHost;
  }

  /*
   * The URL a device's monitor checks: the template's URL with the device's
   * address as its host, and every other character as the template wrote
   * it (see the top of this file).
   */
  public static buildDeviceUrl(data: {
    templateUrl: URL | string | null | undefined;
    address: string | null | undefined;
  }): URL {
    const parts: DeviceUrlParts = this.assertTemplateUrl(data.templateUrl);
    const host: string = this.toUrlHost(data.address);

    const text: string = `${parts.scheme}://${parts.userInfo}${host}${parts.port}${parts.rest}`;

    try {
      return URL.fromString(text);
    } catch {
      throw new BadDataException(DEVICE_ADDRESS_NOT_A_URL_HOST);
    }
  }

  /*
   * The host a URL checks, without brackets, or empty when it names none: the
   * device's address on a monitor made from a template, which a template sync
   * keeps (DeviceMonitorTemplateUtil.keepTargetAddress).
   */
  public static readHost(url: URL | string | null | undefined): string {
    const parts: DeviceUrlParts | null = this.readParts(url);

    if (!parts || isVariable(parts.host)) {
      return "";
    }

    const host: string = parts.host;

    if (host.startsWith("[") && host.endsWith("]")) {
      return host.substring(1, host.length - 1);
    }

    return host;
  }

  /*
   * The port a URL asks on: the one it names, else its scheme's (443 for
   * https, 80 for http). Null for a URL with no port to tell.
   */
  public static readPort(url: URL | string | null | undefined): number | null {
    const parts: DeviceUrlParts | null = this.readParts(url);

    if (!parts) {
      return null;
    }

    if (parts.port) {
      const port: number = Number(parts.port.substring(1));

      return PORT.test(parts.port) && port > 0 ? port : null;
    }

    return DEFAULT_PORT_BY_SCHEME[parts.scheme] ?? null;
  }

  /*
   * What a Website, API or SSL Certificate monitor of a device checks on it,
   * as a key two monitors share when they check the same thing there - the
   * host is the device's either way, so it is left out:
   *
   *   - Website, API: the scheme, the port and the path with its query
   *     ("https:8443/status"). Another path is another page, and another
   *     port another server.
   *   - SSL Certificate: the port ("tls:443"). The certificate is the
   *     server's, whatever path the URL goes on to name.
   *
   * Null for a URL there is nothing to read from.
   */
  public static getCheckKey(data: {
    monitorType: MonitorType | string | null | undefined;
    url: URL | string | null | undefined;
  }): string | null {
    const parts: DeviceUrlParts | null = this.readParts(data.url);
    const port: number | null = this.readPort(data.url);

    if (!parts || port === null) {
      return null;
    }

    if (data.monitorType === MonitorType.SSLCertificate) {
      return `tls:${port}`;
    }

    // The fragment never reaches the server.
    let target: string = parts.rest.split("#")[0] || "";

    if (!target.startsWith("/")) {
      target = `/${target}`;
    }

    return `${parts.scheme}:${port}${target}`;
  }

  /*
   * A template's URL as a person reads it, with what each device puts in its
   * place where the host is: "https://<device>:8443/status". `deviceHost` is
   * the words for it, in the reader's language. Null when the URL is not one
   * a device's address can be put in.
   */
  public static describeTemplateUrl(data: {
    templateUrl: URL | string | null | undefined;
    deviceHost: string;
  }): string | null {
    let parts: DeviceUrlParts;

    try {
      parts = this.assertTemplateUrl(data.templateUrl);
    } catch {
      return null;
    }

    // A path of "/" alone says nothing: "https://<device>" reads as the site.
    const rest: string = parts.rest === "/" ? "" : parts.rest;

    return `${parts.scheme}://${data.deviceHost}${parts.port}${rest}`;
  }
}
