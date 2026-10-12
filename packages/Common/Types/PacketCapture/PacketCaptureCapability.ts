import IP from "../IP/IP";
import { JSONObject } from "../JSON";
import {
  HARD_MAX_PACKET_CAPTURE_LIMITS,
  PacketCaptureLimits,
  PacketCaptureLimitsUtil,
} from "./PacketCaptureLimits";

/*
 * What a probe says about packet capture: whether whoever runs it turned
 * captures on (PROBE_PACKET_CAPTURE_ENABLED), whether the capture tool is
 * installed, the network interfaces it can capture on, and the limits its
 * operator set. The probe reports it when it starts and every few minutes;
 * the server keeps the last report on the probe (Probe
 * .packetCaptureCapability) and the dashboard reads it to say whether, and
 * on which interfaces, a capture can be started.
 *
 * A probe that never reported is older than packet capture: the dashboard
 * says to update it.
 */

export interface PacketCaptureInterface {
  // As the capture tool names it: "eth0", "ens192.20", "any".
  name: string;
  /*
   * Its IPv4 and IPv6 addresses, with their prefix length where the probe
   * knows it ("10.0.0.2/24"). A mirror port usually has none.
   */
  addresses: Array<string>;
  // Whether the link is up, when the probe could tell.
  isUp?: boolean | undefined;
  isLoopback?: boolean | undefined;
}

export interface PacketCaptureCapability {
  /*
   * Whether whoever runs the probe turned packet capture on. Off on every
   * probe until they do: a probe that is off reports nothing else.
   */
  isEnabled: boolean;
  // Whether the capture tool (tcpdump) is installed on the probe.
  isToolAvailable: boolean;
  // The capture tool's version line, for support ("tcpdump version 4.99.3").
  toolVersion?: string | undefined;
  interfaces: Array<PacketCaptureInterface>;
  /*
   * The most a capture on this probe may ask for: the hard maximums, or the
   * lower ones its operator set.
   */
  limits: PacketCaptureLimits;
}

// The pseudo-interface that captures on every interface at once (Linux).
export const ALL_INTERFACES_NAME: string = "any";

// How many interfaces, and addresses per interface, a report may carry.
export const MAX_REPORTED_INTERFACES: number = 128;
export const MAX_REPORTED_ADDRESSES_PER_INTERFACE: number = 16;

/*
 * A name the capture tool can be handed as `-i <name>`: Linux allows up to
 * 15 characters, and what interfaces are called in practice - eth0, ens192,
 * enp0s31f6, eth0.20, bond0:1, br-1a2b3c, wlan0, any - is letters, digits
 * and . _ : @ + -. Never a leading dash, so it can never read as an option.
 */
const INTERFACE_NAME: RegExp = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,63}$/;

// An address with its prefix length: "10.0.0.2/24", "fe80::1/64".
const ADDRESS_WITH_PREFIX: RegExp = /^([^/\s]{2,64})\/(\d{1,3})$/;

const MAX_TOOL_VERSION_LENGTH: number = 120;

export default class PacketCaptureCapabilityUtil {
  public static isInterfaceName(value: unknown): value is string {
    return typeof value === "string" && INTERFACE_NAME.test(value);
  }

  /*
   * A report as the server keeps it, built from whatever the probe posted:
   * only the fields above, each of the right type and size, unknown keys
   * dropped. Null when it is not a report at all. An interface whose name
   * could not be handed to the capture tool is left out, so the dashboard
   * never offers it.
   */
  public static sanitize(value: unknown): PacketCaptureCapability | null {
    if (!PacketCaptureCapabilityUtil.isObject(value)) {
      return null;
    }

    if (typeof value["isEnabled"] !== "boolean") {
      return null;
    }

    if (!value["isEnabled"]) {
      return {
        isEnabled: false,
        isToolAvailable: false,
        interfaces: [],
        limits: { ...HARD_MAX_PACKET_CAPTURE_LIMITS },
      };
    }

    const interfaces: Array<PacketCaptureInterface> = [];
    const seen: Set<string> = new Set();
    const reportedInterfaces: Array<unknown> = Array.isArray(
      value["interfaces"],
    )
      ? (value["interfaces"] as Array<unknown>)
      : [];

    for (const reported of reportedInterfaces) {
      if (interfaces.length >= MAX_REPORTED_INTERFACES) {
        break;
      }

      const networkInterface: PacketCaptureInterface | null =
        PacketCaptureCapabilityUtil.sanitizeInterface(reported);

      if (!networkInterface || seen.has(networkInterface.name)) {
        continue;
      }

      seen.add(networkInterface.name);
      interfaces.push(networkInterface);
    }

    const capability: PacketCaptureCapability = {
      isEnabled: true,
      isToolAvailable: value["isToolAvailable"] === true,
      interfaces: interfaces,
      limits: PacketCaptureLimitsUtil.getMaximums(
        PacketCaptureCapabilityUtil.isObject(value["limits"])
          ? (value["limits"] as Partial<PacketCaptureLimits>)
          : null,
      ),
    };

    if (typeof value["toolVersion"] === "string" && value["toolVersion"]) {
      capability.toolVersion = value["toolVersion"]
        .split("\n")[0]!
        .trim()
        .substring(0, MAX_TOOL_VERSION_LENGTH);
    }

    return capability;
  }

  /*
   * A stored report as the dashboard and the server read it: the same
   * rules as a fresh one, so a row written by an older server reads safely.
   */
  public static parse(value: unknown): PacketCaptureCapability | null {
    return PacketCaptureCapabilityUtil.sanitize(value);
  }

  // Whether a capture can be started on a probe with this report.
  public static canCapture(
    capability: PacketCaptureCapability | null | undefined,
  ): boolean {
    return Boolean(
      capability &&
        capability.isEnabled &&
        capability.isToolAvailable &&
        capability.interfaces.length > 0,
    );
  }

  public static findInterface(
    capability: PacketCaptureCapability | null | undefined,
    name: string | null | undefined,
  ): PacketCaptureInterface | undefined {
    if (!capability || !name) {
      return undefined;
    }

    return capability.interfaces.find(
      (networkInterface: PacketCaptureInterface): boolean => {
        return networkInterface.name === name;
      },
    );
  }

  /*
   * The interface a new capture starts on: every interface at once when the
   * probe offers it - which, with a host or port in the filter, is what most
   * people want - else the first one that is up and not loopback, else the
   * first one.
   */
  public static getDefaultInterfaceName(
    capability: PacketCaptureCapability | null | undefined,
  ): string | undefined {
    if (!capability || capability.interfaces.length === 0) {
      return undefined;
    }

    if (
      PacketCaptureCapabilityUtil.findInterface(capability, ALL_INTERFACES_NAME)
    ) {
      return ALL_INTERFACES_NAME;
    }

    const usable: PacketCaptureInterface | undefined =
      capability.interfaces.find(
        (networkInterface: PacketCaptureInterface): boolean => {
          return (
            networkInterface.isUp !== false && !networkInterface.isLoopback
          );
        },
      );

    return (usable || capability.interfaces[0])!.name;
  }

  private static sanitizeInterface(
    value: unknown,
  ): PacketCaptureInterface | null {
    if (!PacketCaptureCapabilityUtil.isObject(value)) {
      return null;
    }

    const name: unknown = value["name"];

    if (!PacketCaptureCapabilityUtil.isInterfaceName(name)) {
      return null;
    }

    const addresses: Array<string> = [];

    for (const address of Array.isArray(value["addresses"])
      ? (value["addresses"] as Array<unknown>)
      : []) {
      if (addresses.length >= MAX_REPORTED_ADDRESSES_PER_INTERFACE) {
        break;
      }

      if (
        PacketCaptureCapabilityUtil.isAddress(address) &&
        !addresses.includes(address)
      ) {
        addresses.push(address);
      }
    }

    const networkInterface: PacketCaptureInterface = {
      name: name,
      addresses: addresses,
    };

    if (typeof value["isUp"] === "boolean") {
      networkInterface.isUp = value["isUp"];
    }

    if (typeof value["isLoopback"] === "boolean") {
      networkInterface.isLoopback = value["isLoopback"];
    }

    return networkInterface;
  }

  // An IPv4 or IPv6 address, alone or with its prefix length.
  private static isAddress(value: unknown): value is string {
    if (typeof value !== "string" || value.length > 70) {
      return false;
    }

    const withPrefix: RegExpExecArray | null = ADDRESS_WITH_PREFIX.exec(value);

    if (!withPrefix) {
      return IP.isIP(value);
    }

    // new IP() throws on anything that is not an address.
    if (!IP.isIP(withPrefix[1] || "")) {
      return false;
    }

    const address: IP = new IP(withPrefix[1] || "");
    const prefixLength: number = Number(withPrefix[2]);

    if (address.isIPv4()) {
      return prefixLength <= 32;
    }

    return address.isIPv6() && prefixLength <= 128;
  }

  private static isObject(value: unknown): value is JSONObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
