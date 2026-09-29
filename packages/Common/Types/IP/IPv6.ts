import BadDataException from "../Exception/BadDataException";
import IP from "./IP";

/*
 * The class used to be declared `class IPv4 extends IP` here — a copy-paste
 * that the default export hid from every import site, while leaving
 * IPv6.name === "IPv4" in error messages, serialized output and API docs.
 */
export default class IPv6 extends IP {
  public constructor(ip: string) {
    super(ip);

    if (!this.isIPv6()) {
      throw new BadDataException("IP is not a valid IPv6 address");
    }
  }
}
