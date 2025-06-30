import DatabaseProperty from "../Database/DatabaseProperty";
import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import Typeof from "../Typeof";
import IPType from "./IPType";
import { FindOperator } from "typeorm";
import Zod, { ZodSchema } from "../../Utils/Schema/Zod";

export default class IP extends DatabaseProperty {
  private _ip: string = "";
  protected type: IPType = IPType.IPv4;
  public get ip(): string {
    return this._ip;
  }

  public static isInWhitelist(data: {
    ips: Array<string>;
    whitelist: string[];
  }): boolean {
    for (const ip of data.ips) {
      // If whitelist is empty, return false
      if (!data.whitelist || data.whitelist.length === 0) {
        return false;
      }

      // Check if IP is valid
      if (!IP.isIP(ip)) {
        throw new BadDataException("Invalid IP address");
      }

      // Check each whitelist entry
      for (const entry of data.whitelist) {
        // Skip empty entries
        if (!entry || entry.trim() === "") {
          continue;
        }

        // Direct IP match
        if (entry === ip) {
          return true;
        }

        // CIDR notation check (IPv4 only for now)
        if (entry.includes("/") && IP.isIPv4(ip)) {
          try {
            const [network, prefixStr] = entry.split("/");

            if (!network || !prefixStr) {
              continue;
            }

            if (!IP.isIPv4(network)) {
              continue;
            }

            const prefix: number = parseInt(prefixStr, 10);
            if (isNaN(prefix) || prefix < 0 || prefix > 32) {
              continue;
            }

            // Convert IPs to integers for comparison
            const ipInt: number = this._ipv4ToInt(ip);
            const networkInt: number = this._ipv4ToInt(network);

            // Create mask from prefix
            const mask: number = ~((1 << (32 - prefix)) - 1) >>> 0;

            // Check if IP is in network
            if ((ipInt & mask) === (networkInt & mask)) {
              return true;
            }
          } catch {
            continue;
          }
        }
      }
    }

    return false;
  }

  // Helper method to convert IPv4 to integer
  private static _ipv4ToInt(ip: string): number {
    const octets: number[] = ip.split(".").map(Number);

    if (
      octets.length !== 4 ||
      octets.some((octet: number) => {
        return isNaN(octet) || octet < 0 || octet > 255;
      })
    ) {
      throw new BadDataException("Invalid IPv4 address");
    }

    return (
      ((octets[0]! << 24) >>> 0) +
      ((octets[1]! << 16) >>> 0) +
      ((octets[2]! << 8) >>> 0) +
      octets[3]!
    );
  }

  public set ip(value: string) {
    if (IP.isIPv4(value)) {
      this._ip = value;
      this.type = IPType.IPv4;
    } else if (IP.isIPv6(value)) {
      this._ip = value;
      this.type = IPType.IPv6;
    } else {
      throw new BadDataException("IP is not a valid address");
    }
  }

  public constructor(ip: string) {
    super();

    this.ip = ip;
  }

  public static fromString(ip: string): IP {
    return new IP(ip);
  }

  public static isIP(ip: string): boolean {
    if (IP.isIPv4(ip) || IP.isIPv6(ip)) {
      return true;
    }
    return false;
  }

  public override toString(): string {
    return this.ip;
  }

  private static isIPv4(str: string): boolean {
    const regexExp: RegExp =
      /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/gi;
    const result: boolean = regexExp.test(str);

    return result;
  }

  private static isIPv6(str: string): boolean {
    const regexExp: RegExp =
      /(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))/gi;
    return regexExp.test(str);
  }

  public isIPv4(): boolean {
    if (IP.isIPv4(this.ip)) {
      return true;
    }
    return false;
  }

  public isIPv6(): boolean {
    if (IP.isIPv6(this.ip)) {
      return true;
    }
    return false;
  }

  public static override fromJSON(json: JSONObject): IP {
    if (json && json["_type"] !== ObjectType.IP) {
      throw new BadDataException("Invalid JSON for IP");
    }

    if (json && json["value"] && typeof json["value"] !== Typeof.String) {
      throw new BadDataException("Invalid JSON for IP");
    }

    return new IP(json["value"] as string);
  }

  public override toJSON(): JSONObject {
    return {
      value: this.toString(),
      _type: ObjectType.IP,
    };
  }

  public static override toDatabase(
    value: IP | FindOperator<IP>,
  ): string | null {
    if (value) {
      if (typeof value === "string") {
        value = new IP(value);
      }

      return value.toString();
    }

    return null;
  }

  public static override fromDatabase(value: string): IP | null {
    if (value) {
      return new IP(value);
    }
    return null;
  }

  public static override getSchema(): ZodSchema {
    return Zod.object({
      _type: Zod.literal(ObjectType.IP),
      value: Zod.string().openapi({
        type: "string",
        example: "192.168.1.1",
      }),
    }).openapi({
      type: "object",
      description: "IP object",
      example: { _type: ObjectType.IP, value: "192.168.1.1" },
    });
  }
}
