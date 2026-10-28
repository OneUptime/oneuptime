import NetworkAddressBlockUtil, {
  MAX_NETWORK_ADDRESS_BLOCK_TEXT_LENGTH,
  NetworkAddressBlock,
} from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import { describe, expect, test } from "@jest/globals";

/*
 * What an Address Name names (issue #5340): one address, or a subnet of
 * them, written the one way it is kept - so two spellings of one block are
 * one block, a page's address matches the row someone saved, and a subnet
 * holds exactly the addresses it says.
 */

function parsed(text: string): NetworkAddressBlock {
  const block: NetworkAddressBlock | null = NetworkAddressBlockUtil.parse(text);

  if (!block) {
    throw new Error(`${text} did not parse`);
  }

  return block;
}

describe("NetworkAddressBlockUtil.canonicalAddress", () => {
  test("an IPv4 address is kept as written, white space around it forgiven", () => {
    expect(NetworkAddressBlockUtil.canonicalAddress("10.18.167.35")).toBe(
      "10.18.167.35",
    );
    expect(NetworkAddressBlockUtil.canonicalAddress("  10.0.0.5\t")).toBe(
      "10.0.0.5",
    );
    expect(NetworkAddressBlockUtil.canonicalAddress("0.0.0.0")).toBe(
      "0.0.0.0",
    );
    expect(NetworkAddressBlockUtil.canonicalAddress("255.255.255.255")).toBe(
      "255.255.255.255",
    );
  });

  test("an IPv6 address is compressed and lowercased (RFC 5952)", () => {
    expect(
      NetworkAddressBlockUtil.canonicalAddress("2001:DB8:0:0:0:0:0:5"),
    ).toBe("2001:db8::5");
    expect(
      NetworkAddressBlockUtil.canonicalAddress(
        "2001:0db8:0000:0000:0001:0000:0000:0001",
      ),
    ).toBe("2001:db8::1:0:0:1");
    expect(NetworkAddressBlockUtil.canonicalAddress("FE80::1")).toBe(
      "fe80::1",
    );
    expect(NetworkAddressBlockUtil.canonicalAddress("::")).toBe("::");
    expect(NetworkAddressBlockUtil.canonicalAddress("::1")).toBe("::1");
  });

  test("an IPv4 address an IPv6 one maps is that IPv4 address", () => {
    expect(NetworkAddressBlockUtil.canonicalAddress("::ffff:10.0.0.5")).toBe(
      "10.0.0.5",
    );
    expect(NetworkAddressBlockUtil.canonicalAddress("::FFFF:a00:5")).toBe(
      "10.0.0.5",
    );
  });

  test("two spellings of one address are one address", () => {
    expect(
      NetworkAddressBlockUtil.canonicalAddress("2001:db8:0:0:0:0:0:5"),
    ).toBe(NetworkAddressBlockUtil.canonicalAddress("2001:DB8::5"));
  });

  test("anything that is not one address is null: a name, a zone, a port, a subnet, a range", () => {
    for (const value of [
      "",
      "   ",
      "fileserver-01",
      "fe80::1%eth0",
      "10.0.0.5:443",
      "[2001:db8::5]",
      "10.0.0.0/24",
      "10.0.0.1-10.0.0.9",
      "10.0.0",
      "10.0.0.256",
      "10.0.0.5.6",
      "1:2:3:4:5:6:7:8:9",
      "2001:db8:::5",
      "2001:db8::5::6",
      "gggg::1",
      "10.0.0.5 10.0.0.6",
    ]) {
      expect(NetworkAddressBlockUtil.canonicalAddress(value)).toBeNull();
    }
  });

  test("a value that is not text is null", () => {
    for (const value of [undefined, null, 5, {}, [], true]) {
      expect(NetworkAddressBlockUtil.canonicalAddress(value)).toBeNull();
    }
  });

  test("text longer than any address is refused before it is read", () => {
    const long: string = `${"0".repeat(MAX_NETWORK_ADDRESS_BLOCK_TEXT_LENGTH)}1`;

    expect(NetworkAddressBlockUtil.canonicalAddress(long)).toBeNull();
  });
});

describe("NetworkAddressBlockUtil.parse", () => {
  test("one address is a block of one", () => {
    const block: NetworkAddressBlock = parsed("10.0.0.5");

    expect(block.family).toBe(4);
    expect(block.prefixLength).toBe(32);
    expect(block.text).toBe("10.0.0.5");
    expect(NetworkAddressBlockUtil.isSingleAddress(block)).toBe(true);
  });

  test("a subnet is kept as its first address and its length", () => {
    expect(parsed("10.18.167.0/24").text).toBe("10.18.167.0/24");
    // The subnet the person meant, whatever address of it they typed.
    expect(parsed("10.18.167.35/24").text).toBe("10.18.167.0/24");
    // White space around the address and around the slash is forgiven.
    expect(parsed(" 10.18.167.35/24 ").text).toBe("10.18.167.0/24");
    expect(parsed("10.18.167.35 / 24").text).toBe("10.18.167.0/24");
    expect(parsed("10.18.167.200/25").text).toBe("10.18.167.128/25");
    expect(parsed("172.16.5.4/12").text).toBe("172.16.0.0/12");
    expect(parsed("10.1.2.3/0").text).toBe("0.0.0.0/0");
    expect(NetworkAddressBlockUtil.isSingleAddress(parsed("10.0.0.0/8"))).toBe(
      false,
    );
  });

  test("a /32 (or /128) is one address, written without its length", () => {
    expect(parsed("10.0.0.5/32").text).toBe("10.0.0.5");
    expect(parsed("2001:db8::5/128").text).toBe("2001:db8::5");
    expect(NetworkAddressBlockUtil.isSingleAddress(parsed("10.0.0.5/32"))).toBe(
      true,
    );
  });

  test("an IPv6 subnet is compressed, lowercased and masked", () => {
    const block: NetworkAddressBlock = parsed("2001:DB8:1:FFFF::1/48");

    expect(block.family).toBe(6);
    expect(block.prefixLength).toBe(48);
    expect(block.text).toBe("2001:db8:1::/48");
    expect(parsed("2001:db8:abcd:12ff::/52").text).toBe("2001:db8:abcd:1000::/52");
  });

  test("a mapped IPv4 address is IPv4; with a length it is an IPv6 subnet", () => {
    expect(parsed("::ffff:10.0.0.5").text).toBe("10.0.0.5");
    expect(parsed("::ffff:10.0.0.5").family).toBe(4);
    expect(parsed("::ffff:10.0.0.0/120").family).toBe(6);
    expect(parsed("::ffff:10.0.0.0/120").text).toBe("::ffff:a00:0/120");
  });

  test("anything else is refused: a name, a zone, a length the family has not, two slashes", () => {
    for (const value of [
      "",
      "fileserver-01",
      "fileserver-01/24",
      "10.0.0.0/33",
      "2001:db8::/129",
      "10.0.0.0/-1",
      "10.0.0.0/2a",
      "10.0.0.0/",
      "10.0.0.0/0024",
      "10.0.0.0/24/8",
      "/24",
      "fe80::1%eth0/64",
      "10.0.0.1-10.0.0.9",
      "10.0.0.5:443",
    ]) {
      expect(NetworkAddressBlockUtil.parse(value)).toBeNull();
    }

    for (const value of [undefined, null, 24, {}, []]) {
      expect(NetworkAddressBlockUtil.parse(value)).toBeNull();
    }
  });

  test("two spellings of one subnet are one block", () => {
    expect(parsed("2001:0DB8:0001:0000::/48").text).toBe(
      parsed("2001:db8:1::/48").text,
    );
    expect(parsed("10.18.167.1/24").text).toBe(parsed("10.18.167.0/24").text);
  });
});

describe("NetworkAddressBlockUtil.contains", () => {
  test("a subnet holds its own addresses and no other", () => {
    const office: NetworkAddressBlock = parsed("10.18.167.0/24");

    expect(NetworkAddressBlockUtil.contains(office, "10.18.167.0")).toBe(true);
    expect(NetworkAddressBlockUtil.contains(office, "10.18.167.35")).toBe(true);
    expect(NetworkAddressBlockUtil.contains(office, "10.18.167.255")).toBe(
      true,
    );
    expect(NetworkAddressBlockUtil.contains(office, "10.18.168.0")).toBe(
      false,
    );
    expect(NetworkAddressBlockUtil.contains(office, "10.18.166.255")).toBe(
      false,
    );
  });

  test("lengths that do not fall on a byte are honoured", () => {
    const block: NetworkAddressBlock = parsed("10.18.167.128/25");

    expect(NetworkAddressBlockUtil.contains(block, "10.18.167.127")).toBe(
      false,
    );
    expect(NetworkAddressBlockUtil.contains(block, "10.18.167.128")).toBe(
      true,
    );
    expect(NetworkAddressBlockUtil.contains(parsed("172.16.0.0/12"), "172.31.255.1")).toBe(true);
    expect(NetworkAddressBlockUtil.contains(parsed("172.16.0.0/12"), "172.32.0.1")).toBe(false);
  });

  test("a block of one holds that address only", () => {
    const one: NetworkAddressBlock = parsed("10.0.0.5");

    expect(NetworkAddressBlockUtil.contains(one, "10.0.0.5")).toBe(true);
    expect(NetworkAddressBlockUtil.contains(one, "10.0.0.50")).toBe(false);
  });

  test("/0 holds every address of its family, and none of the other", () => {
    expect(NetworkAddressBlockUtil.contains(parsed("0.0.0.0/0"), "203.0.113.9")).toBe(true);
    expect(NetworkAddressBlockUtil.contains(parsed("0.0.0.0/0"), "2001:db8::1")).toBe(false);
    expect(NetworkAddressBlockUtil.contains(parsed("::/0"), "2001:db8::1")).toBe(true);
  });

  test("IPv6, however the address is written", () => {
    const block: NetworkAddressBlock = parsed("2001:db8:1::/48");

    expect(NetworkAddressBlockUtil.contains(block, "2001:DB8:1:ffff::5")).toBe(
      true,
    );
    expect(NetworkAddressBlockUtil.contains(block, "2001:db8:2::5")).toBe(
      false,
    );
  });

  test("a mapped address is matched as the IPv4 address it is", () => {
    expect(
      NetworkAddressBlockUtil.contains(parsed("10.0.0.0/8"), "::ffff:10.1.2.3"),
    ).toBe(true);
  });

  test("something that is not an address is in no block", () => {
    expect(NetworkAddressBlockUtil.contains(parsed("0.0.0.0/0"), "router-1")).toBe(false);
    expect(NetworkAddressBlockUtil.contains(parsed("0.0.0.0/0"), "")).toBe(false);
  });
});

describe("NetworkAddressBlockUtil.mostSpecific", () => {
  interface NamedBlock {
    name: string;
    text: string;
  }

  const read: (item: NamedBlock) => NetworkAddressBlock | null = (
    item: NamedBlock,
  ): NetworkAddressBlock | null => {
    return NetworkAddressBlockUtil.parse(item.text);
  };

  const NAMED: Array<NamedBlock> = [
    { name: "Corporate", text: "10.0.0.0/8" },
    { name: "Mumbai office", text: "10.18.167.0/24" },
    { name: "Mumbai campus", text: "10.18.0.0/16" },
    { name: "Broken", text: "not a subnet" },
  ];

  test("the narrowest subnet that holds the address says the most", () => {
    expect(
      NetworkAddressBlockUtil.mostSpecific("10.18.167.35", NAMED, read)?.name,
    ).toBe("Mumbai office");
    expect(
      NetworkAddressBlockUtil.mostSpecific("10.18.5.1", NAMED, read)?.name,
    ).toBe("Mumbai campus");
    expect(
      NetworkAddressBlockUtil.mostSpecific("10.99.0.1", NAMED, read)?.name,
    ).toBe("Corporate");
  });

  test("no subnet holds it: null", () => {
    expect(
      NetworkAddressBlockUtil.mostSpecific("192.168.1.1", NAMED, read),
    ).toBeNull();
    expect(NetworkAddressBlockUtil.mostSpecific("10.0.0.1", [], read)).toBeNull();
  });

  test("on a tie the first item wins, whatever order it is read in", () => {
    const tie: Array<NamedBlock> = [
      { name: "First", text: "10.18.167.0/24" },
      { name: "Second", text: "10.18.167.9/24" },
    ];

    expect(
      NetworkAddressBlockUtil.mostSpecific("10.18.167.35", tie, read)?.name,
    ).toBe("First");
  });
});

describe("NetworkAddressBlockUtil.readAddress", () => {
  test("gives the family and the 16-bit groups", () => {
    expect(NetworkAddressBlockUtil.readAddress("10.18.167.35")).toEqual({
      family: 4,
      groups: [10 * 256 + 18, 167 * 256 + 35],
    });
    expect(NetworkAddressBlockUtil.readAddress("2001:db8::1")).toEqual({
      family: 6,
      groups: [0x2001, 0xdb8, 0, 0, 0, 0, 0, 1],
    });
  });
});
