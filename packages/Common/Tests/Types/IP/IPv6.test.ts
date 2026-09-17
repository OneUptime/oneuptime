import IP from "../../../Types/IP/IPv6";

describe("IPv6()", () => {
  test("should be IPv6", () => {
    const ip: IP = new IP("2001:0db8:85a3::8a2e:0370:7334");
    expect(ip.isIPv6()).toBeTruthy();
  });

  /*
   * This address used to be accepted: a triple colon is not valid IPv6, but
   * the validator was unanchored and matched the address-shaped substring
   * inside it.
   */
  test("should reject an address with a triple colon", () => {
    expect(() => {
      new IP("2001:0db8:85a3:::8a2e:0370:7334");
    }).toThrow("IP is not a valid address");
  });

  test("should not be IPv4", () => {
    const ip: IP = new IP("2001:0db8:85a3:0000:0000:8a2e:0370:7334");
    expect(ip.isIPv4()).toBeFalsy();
  });

  test("Is not a valid address", () => {
    expect(() => {
      new IP("Invalid Ip");
    }).toThrow("IP is not a valid address");
  });
});
