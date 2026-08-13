import IP from "../../../Types/IP/IP";
import { ObjectType } from "../../../Types/JSON";

describe("IP()", () => {
  test("expect ip to be defined", () => {
    const ip: IP = new IP("196.223.149.8");
    expect(ip.toString()).toBe("196.223.149.8");
  });

  test("expects type of ip to be a string", () => {
    const ip: IP = new IP("196.223.149.8");
    expect(typeof ip.toString()).toBe("string");
  });

  test("expects ip address to be mutable", () => {
    const ip: IP = new IP("196.223.149.8");
    const newIp: string = "127.0.0.1";
    ip.ip = newIp;
    expect(ip.ip).not.toBe("196.223.149.8");
    expect(ip.ip).toBe("127.0.0.1");
  });

  test("expects ip address to be 127.0.0.1", () => {
    const ip: IP = new IP("196.223.149.8");
    const newIp: string = "127.0.0.1";
    ip.ip = newIp;
    expect(ip.ip).toBe("127.0.0.1");
  });

  test("is valid IPv6 address", () => {
    const ip: IP = new IP("::11.22.33.44");
    expect(ip.isIPv6()).toBeTruthy();
  });

  test("should throw an error for invalid IP", () => {
    expect(() => {
      new IP("");
    }).toThrow("IP is not a valid address");
  });

  test("should return a string", () => {
    expect(IP.toDatabase(new IP("127.0.0.1"))).toBe("127.0.0.1");
  });

  test("should be an instance IP", () => {
    expect(IP.fromDatabase("127.0.0.1")).toBeInstanceOf(IP);
  });

  test("should not create an instance of IP", () => {
    expect(IP.fromDatabase("")).toBeNull();
  });

  test("should create an IP of type IPv4 from database", () => {
    expect(IP.fromDatabase("127.0.0.1")?.isIPv4()).toBeTruthy();
  });

  test("should create an IP of type IPv6 from database", () => {
    expect(
      IP.fromDatabase("2001:0db8:85a3:0000:0000:8a2e:0370:7334")?.isIPv6(),
    ).toBeTruthy();
  });

  test("should create an IP of type IPv4 through the transformer", () => {
    expect(IP.getDatabaseTransformer().from("127.0.0.1").isIPv4()).toBeTruthy();
  });

  test("should create an IP of type IPv6 through the transformer", () => {
    expect(
      IP.getDatabaseTransformer()
        .from("2001:0db8:85a3:0000:0000:8a2e:0370:7334")
        .isIPv6(),
    ).toBeTruthy();
  });

  test("should return a string from the transformers to function", () => {
    expect(IP.getDatabaseTransformer().to("127.0.0.1")).toBe("127.0.0.1");
  });

  test("should return null from the transformers to function", () => {
    expect(IP.getDatabaseTransformer().to("")).toBe(null);
  });
});

/*
 * The validators are anchored, so a value only counts as an address when the
 * WHOLE string is one. These cases pin that down: the IPv6 pattern used to be
 * unanchored and reported anything merely containing an address-shaped
 * substring as valid.
 */
describe("IP.isIP() anchoring", () => {
  const VALID_IPV4: Array<string> = [
    "0.0.0.0",
    "127.0.0.1",
    "10.0.0.4",
    "196.223.149.8",
    "203.0.113.7",
    "255.255.255.255",
  ];

  const VALID_IPV6: Array<string> = [
    "::",
    "::1",
    "fd00::1",
    "fe80::1",
    "2001:db8::1",
    "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
    "2001:db8:0:0:0:0:0:1",
    "a:b:c:d:e:f:1:2",
    // Uppercase hex is valid.
    "2001:DB8::1",
    // Zone identifier, as reported for link-local addresses.
    "fe80::1%eth0",
    // IPv4-mapped, the form Node reports for a dual-stack socket.
    "::ffff:127.0.0.1",
    "::ffff:203.0.113.7",
    "::11.22.33.44",
    "2001:db8::192.168.0.1",
  ];

  test.each(VALID_IPV4)("accepts the IPv4 address %s", (value: string) => {
    expect(IP.isIP(value)).toBe(true);
    expect(new IP(value).isIPv4()).toBe(true);
    expect(new IP(value).isIPv6()).toBe(false);
  });

  test.each(VALID_IPV6)("accepts the IPv6 address %s", (value: string) => {
    expect(IP.isIP(value)).toBe(true);
    expect(new IP(value).isIPv6()).toBe(true);
    expect(new IP(value).isIPv4()).toBe(false);
  });

  /*
   * Every one of these was accepted before the pattern was anchored. They are
   * the whole point of the change, so they are listed out rather than folded
   * into the generic invalid list below.
   */
  const ADDRESS_SHAPED_SUBSTRINGS: Array<string> = [
    "evil 2001:db8::1 evil",
    "not-an-ip-::1",
    "x2001:db8::1",
    "2001:db8::1x",
    "<script>::1</script>",
    // Leading/trailing whitespace is not part of an address.
    "  ::1  ",
    "::1 ",
    " ::1",
    // A whole forwarded-for chain is a list, not an address.
    "::1, 1.2.3.4",
    "2001:db8::1, 198.51.100.5",
    // A newline is the classic way to smuggle a second value past a check.
    "2001:db8::1\n1.2.3.4",
    // Bracketed host:port, which is what a proxy emits for IPv6.
    "[2001:db8::1]:443",
    "[2001:db8::1]",
    // Triple colon is not valid IPv6 -- only one "::" run is allowed.
    "2001:0db8:85a3:::8a2e:0370:7334",
    // A CIDR entry is a range, not a single address.
    "2001:db8::/32",
    // Out-of-range hex group.
    "gggg::1",
    "2001:db8::1::2",
  ];

  test.each(ADDRESS_SHAPED_SUBSTRINGS)(
    "rejects %j, which only contains something address-shaped",
    (value: string) => {
      expect(IP.isIP(value)).toBe(false);
    },
  );

  const NOT_ADDRESSES: Array<string> = [
    "",
    " ",
    "hello",
    "Invalid IP",
    "unknown",
    "localhost",
    "example.com",
    "1.2.3.4.5",
    "1.2.3",
    "256.1.1.1",
    "10.0.0.0/8",
    "203.0.113.7:51234",
    "-1.0.0.0",
    "01.02.03.04.05",
  ];

  test.each(NOT_ADDRESSES)("rejects %j", (value: string) => {
    expect(IP.isIP(value)).toBe(false);
  });

  test.each([...ADDRESS_SHAPED_SUBSTRINGS, ...NOT_ADDRESSES])(
    "constructing an IP from %j throws",
    (value: string) => {
      expect(() => {
        return new IP(value);
      }).toThrow("IP is not a valid address");
    },
  );

  /*
   * The validators no longer carry the `g` flag. `.test()` on a `g` regex
   * advances lastIndex between calls, so the same input could otherwise
   * answer differently depending on how many times it had been asked.
   */
  test("answers the same for repeated calls with the same input", () => {
    for (let i: number = 0; i < 5; i++) {
      expect(IP.isIP("2001:db8::1")).toBe(true);
      expect(IP.isIP("127.0.0.1")).toBe(true);
      expect(IP.isIP("evil 2001:db8::1 evil")).toBe(false);
    }
  });

  test("answers the same when interleaving valid and invalid input", () => {
    const inputs: Array<[string, boolean]> = [
      ["2001:db8::1", true],
      ["[2001:db8::1]:443", false],
      ["2001:db8::1", true],
      ["::1, 1.2.3.4", false],
      ["::1", true],
    ];

    for (const [value, expected] of inputs) {
      expect(IP.isIP(value)).toBe(expected);
    }
  });
});

describe("IP deserialization rejects invalid addresses", () => {
  test("fromDatabase throws for an address-shaped substring", () => {
    expect(() => {
      return IP.fromDatabase("[2001:db8::1]:443");
    }).toThrow("IP is not a valid address");
  });

  test("fromJSON throws for an address-shaped substring", () => {
    expect(() => {
      return IP.fromJSON({ _type: ObjectType.IP, value: "evil ::1 evil" });
    }).toThrow("IP is not a valid address");
  });

  test("fromJSON round-trips a valid address", () => {
    const ip: IP = new IP("2001:db8::1");
    expect(IP.fromJSON(ip.toJSON()).toString()).toBe("2001:db8::1");
  });

  test("the database transformer throws for an address-shaped substring", () => {
    expect(() => {
      return IP.getDatabaseTransformer().from("evil 2001:db8::1 evil");
    }).toThrow("IP is not a valid address");
  });
});

describe("IP.isInWhitelist()", () => {
  test("matches an exact IPv4 entry", () => {
    expect(
      IP.isInWhitelist({ ips: ["203.0.113.7"], whitelist: ["203.0.113.7"] }),
    ).toBe(true);
  });

  test("matches an exact IPv6 entry", () => {
    expect(
      IP.isInWhitelist({ ips: ["2001:db8::1"], whitelist: ["2001:db8::1"] }),
    ).toBe(true);
  });

  test("does not match a different address", () => {
    expect(
      IP.isInWhitelist({ ips: ["198.51.100.5"], whitelist: ["203.0.113.7"] }),
    ).toBe(false);
  });

  test("matches an IPv4 CIDR range", () => {
    expect(
      IP.isInWhitelist({ ips: ["10.1.2.3"], whitelist: ["10.0.0.0/8"] }),
    ).toBe(true);
  });

  test("does not match an address outside the CIDR range", () => {
    expect(
      IP.isInWhitelist({ ips: ["11.1.2.3"], whitelist: ["10.0.0.0/8"] }),
    ).toBe(false);
  });

  test("returns false for an empty whitelist", () => {
    expect(IP.isInWhitelist({ ips: ["203.0.113.7"], whitelist: [] })).toBe(
      false,
    );
  });

  test("skips blank whitelist entries", () => {
    expect(
      IP.isInWhitelist({
        ips: ["203.0.113.7"],
        whitelist: ["", "   ", "203.0.113.7"],
      }),
    ).toBe(true);
  });

  /*
   * The caller is expected to hand this one address it has already resolved.
   * A value that merely contains an address is not one, and asking about it
   * is a caller bug -- it throws rather than quietly answering false, which
   * an access check would then read as a clean deny.
   */
  test("throws for an address-shaped substring", () => {
    expect(() => {
      return IP.isInWhitelist({
        ips: ["evil 2001:db8::1 evil"],
        whitelist: ["2001:db8::1"],
      });
    }).toThrow("Invalid IP address");
  });

  test("throws for a bracketed host:port", () => {
    expect(() => {
      return IP.isInWhitelist({
        ips: ["[2001:db8::1]:443"],
        whitelist: ["2001:db8::1"],
      });
    }).toThrow("Invalid IP address");
  });

  test("throws for a whole forwarded-for chain passed as one value", () => {
    expect(() => {
      return IP.isInWhitelist({
        ips: ["203.0.113.7, 198.51.100.5"],
        whitelist: ["203.0.113.7"],
      });
    }).toThrow("Invalid IP address");
  });

  /*
   * A bracketed or padded spelling of an allowlisted address never matched an
   * entry anyway -- it just used to reach the comparison instead of being
   * rejected. Either way it is not granted access.
   */
  test("does not grant access to a padded spelling of a listed address", () => {
    expect(() => {
      return IP.isInWhitelist({
        ips: [" 203.0.113.7 "],
        whitelist: ["203.0.113.7"],
      });
    }).toThrow("Invalid IP address");
  });
});
