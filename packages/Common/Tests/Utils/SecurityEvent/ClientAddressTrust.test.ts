import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import { JSONObject } from "../../../Types/JSON";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  AddressSlot,
  CLAIMED_FROM_FORWARDED,
  CLAIMED_FROM_X_FORWARDED_FOR,
  CLIENT_ADDRESS_ATTRIBUTES_READ,
  ClaimedClientAddress,
  ClientAddressReading,
  ClientAddressTrust,
  MAX_FORWARDED_HEADER_LENGTH,
  MAX_FORWARDED_RECORDED_LENGTH,
  MAX_TRUSTED_PROXIES,
  NO_TRUSTED_PROXIES,
  TrustedProxies,
  canNameResolvedClientAddress,
  clearClientAddressTrust,
  getTrustedProxyListError,
  isSameAddressSlot,
  isTrustedProxy,
  markClientAddressTrust,
  readAddressSlot,
  readAddressText,
  readClaimedClientAddress,
  readClientAddressEvidence,
  readClientAddressTrust,
  readForwarded,
  readForwardedFor,
  readForwardingHeaderText,
  readTrustedProxyList,
  resolveClientAddress,
  toTrustedProxies,
} from "../../../Utils/SecurityEvent/ClientAddressTrust";
import { ScrubbedAddressKind } from "../../../Utils/SecurityEvent/ScrubbedAddress";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * WHICH ADDRESS A REQUEST CAME FROM (#10416).
 *
 * An attack is blamed on an address its sender could not have written:
 * the connection's own (the peer), or the rightmost address of the
 * recorded X-Forwarded-For that is no proxy the project trusts. Everything
 * else a request names - client.address as instrumentations fill it from
 * X-Forwarded-For, a Forwarded header - is a claim, kept and never blamed.
 */

// Cloudflare's published IPv4 ranges, as a project would list them as its edge.
const CLOUDFLARE: TrustedProxies = toTrustedProxies(
  [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "141.101.64.0/18",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "172.64.0.0/13",
    "2606:4700::/32",
  ].join("\n"),
);

// A Hash rule's token for an address, as the engines make it.
function token(address: string): string {
  return `[HASHED:${crypto.createHash("sha256").update(address).digest("hex").substring(0, 16)}]`;
}

function verified(reading: ClientAddressReading): {
  address: string;
  trust: ClientAddressTrust | null;
} {
  return { address: reading.address, trust: reading.trust };
}

function claim(reading: ClientAddressReading): {
  claimed: string;
  from: string;
} {
  return {
    claimed: reading.claimed
      ? reading.claimed.address || reading.claimed.scrubbed?.value || ""
      : "",
    from: reading.claimedFrom,
  };
}

describe("the issue's cases", () => {
  test("a forwarded client.address from a public peer that is no trusted proxy is only claimed: the peer is blamed", () => {
    const reading: ClientAddressReading = resolveClientAddress({
      peer: "203.0.113.7",
      forwardedClient: "192.0.2.44",
      forwardedClientFrom: "client.address",
    });

    expect(verified(reading)).toEqual({
      address: "203.0.113.7",
      trust: ClientAddressTrust.Peer,
    });
    expect(claim(reading)).toEqual({
      claimed: "192.0.2.44",
      from: "client.address",
    });
  });

  test("through a private load balancer, the rightmost address of the recorded X-Forwarded-For that is no trusted proxy is blamed", () => {
    const reading: ClientAddressReading = resolveClientAddress({
      peer: "10.0.0.5",
      forwardedClient: "192.0.2.44",
      forwardedClientFrom: "client.address",
      forwardedFor: "192.0.2.44, 203.0.113.7",
    });

    expect(verified(reading)).toEqual({
      address: "203.0.113.7",
      trust: ClientAddressTrust.TrustedProxy,
    });
    expect(claim(reading)).toEqual({
      claimed: "192.0.2.44",
      from: "client.address",
    });
  });

  test("client.address alone, with no peer and no header, is claimed: nothing is blamed", () => {
    const reading: ClientAddressReading = resolveClientAddress({
      forwardedClient: "192.0.2.44",
      forwardedClientFrom: "client.address",
    });

    expect(verified(reading)).toEqual({
      address: "",
      trust: ClientAddressTrust.Claimed,
    });
    expect(reading.scrubbed).toBeNull();
    expect(claim(reading)).toEqual({
      claimed: "192.0.2.44",
      from: "client.address",
    });
  });

  test("a connected Cloudflare edge as the peer vouches for the address it forwarded", () => {
    const reading: ClientAddressReading = resolveClientAddress(
      {
        peer: "172.70.38.12",
        forwardedClient: "198.51.100.23",
        forwardedClientFrom: "client.address",
        forwardedFor: "198.51.100.23",
      },
      CLOUDFLARE,
    );

    expect(verified(reading)).toEqual({
      address: "198.51.100.23",
      trust: ClientAddressTrust.TrustedProxy,
    });
    // What the request claimed is the address it came from: no claim beside it.
    expect(reading.claimed).toBeNull();
  });

  test("an edge the project never named is no trusted proxy: its own address is the peer, and what it forwarded a claim", () => {
    const reading: ClientAddressReading = resolveClientAddress({
      peer: "172.70.38.12",
      forwardedClient: "198.51.100.23",
      forwardedClientFrom: "client.address",
      forwardedFor: "198.51.100.23",
    });

    expect(verified(reading)).toEqual({
      address: "172.70.38.12",
      trust: ClientAddressTrust.Peer,
    });
    expect(claim(reading).claimed).toBe("198.51.100.23");
  });
});

describe("a spoofed X-Forwarded-For", () => {
  test("through a peer the project does not trust, names nothing but a claim, whatever it says", () => {
    for (const header of [
      "192.0.2.44",
      "192.0.2.44, 198.51.100.9",
      "10.0.0.1",
      "127.0.0.1",
      "unknown, 192.0.2.44",
      '["192.0.2.44, 10.0.0.5"]',
    ]) {
      const reading: ClientAddressReading = resolveClientAddress({
        peer: "203.0.113.7",
        forwardedFor: header,
      });

      expect({ header, ...verified(reading) }).toEqual({
        header,
        address: "203.0.113.7",
        trust: ClientAddressTrust.Peer,
      });
    }
  });

  test("through a trusted proxy, its sender's part is a claim and the proxy's part is verified", () => {
    // The sender wrote the first two; the load balancer appended the third.
    const reading: ClientAddressReading = resolveClientAddress({
      peer: "10.0.0.5",
      forwardedFor: "192.0.2.44, 198.51.100.9, 203.0.113.7",
    });

    expect(verified(reading)).toEqual({
      address: "203.0.113.7",
      trust: ClientAddressTrust.TrustedProxy,
    });
    expect(claim(reading)).toEqual({
      claimed: "192.0.2.44",
      from: CLAIMED_FROM_X_FORWARDED_FOR,
    });
  });

  test("passes every trusted hop from the right: private ones, and the project's own", () => {
    const own: TrustedProxies = toTrustedProxies(
      "203.0.113.50\n198.51.100.0/28",
    );

    expect(
      resolveClientAddress(
        {
          peer: "10.0.0.5",
          forwardedFor:
            "192.0.2.44, 198.51.100.200, 198.51.100.7, 203.0.113.50, 10.1.1.1",
        },
        own,
      ).address,
    ).toBe("198.51.100.200");
  });

  test("a hop that names no address, right of the client, verifies nothing: no hop is dropped", () => {
    for (const header of [
      "198.51.100.9, unknown",
      "198.51.100.9, _hidden",
      "198.51.100.9, proxy.internal",
      "198.51.100.9,,10.0.0.6",
      "198.51.100.9, 10.0.0.6, ",
    ]) {
      const reading: ClientAddressReading = resolveClientAddress({
        peer: "10.0.0.5",
        forwardedFor: header,
      });

      expect({ header, address: reading.address }).toEqual({
        header,
        address: "",
      });
      expect(reading.trust).toBe(ClientAddressTrust.Claimed);
    }
  });

  test("every hop trusted: the leftmost is the client, a host inside the network", () => {
    expect(
      verified(
        resolveClientAddress({
          peer: "10.0.0.5",
          forwardedFor: "10.20.30.40, 172.16.0.9",
        }),
      ),
    ).toEqual({
      address: "10.20.30.40",
      trust: ClientAddressTrust.TrustedProxy,
    });
  });

  test("a proxy on the same host (loopback) is a trusted proxy too", () => {
    for (const peer of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect({
        peer,
        ...verified(
          resolveClientAddress({
            peer,
            forwardedClient: "192.0.2.44",
            forwardedFor: "192.0.2.44, 203.0.113.7",
          }),
        ),
      }).toEqual({
        peer,
        address: "203.0.113.7",
        trust: ClientAddressTrust.TrustedProxy,
      });
    }
  });

  test("addresses written with ports, brackets and as IPv6 are read as the addresses they are", () => {
    expect(
      resolveClientAddress({
        peer: "[fd00::5]:443",
        forwardedFor: '"[2001:db8::44]:51234", 203.0.113.7:61000',
      }).address,
    ).toBe("203.0.113.7");
    expect(
      resolveClientAddress({
        peer: "fd00::5",
        forwardedFor: "192.0.2.44, [2001:db8::7]",
      }).address,
    ).toBe("2001:db8::7");
    expect(
      resolveClientAddress({
        peer: "10.0.0.5",
        forwardedFor: "::ffff:203.0.113.8",
      }).address,
    ).toBe("203.0.113.8");
  });

  test("padded on the left past what is read, still names the hop its proxy appended: the sender cannot push it out of reach", () => {
    const reading: ClientAddressReading = resolveClientAddress({
      peer: "10.0.0.5",
      forwardedFor: `${"192.0.2.44, ".repeat(2000)}203.0.113.7`,
    });

    expect(verified(reading)).toEqual({
      address: "203.0.113.7",
      trust: ClientAddressTrust.TrustedProxy,
    });
    // Its left end is cut off, so no hop of it is said to be the sender's claim.
    expect(reading.claimed).toBeNull();
  });

  test("one endless hop names no address, and verifies nothing", () => {
    const reading: ClientAddressReading = resolveClientAddress({
      peer: "10.0.0.5",
      forwardedFor: "1".repeat(MAX_FORWARDED_HEADER_LENGTH * 2),
    });

    expect(reading.address).toBe("");
    expect(reading.trust).toBeNull();
    expect(
      resolveClientAddress({
        peer: "10.0.0.5",
        forwardedFor: "1".repeat(MAX_FORWARDED_RECORDED_LENGTH + 1),
      }).address,
    ).toBe("10.0.0.5");
  });
});

describe("a Forwarded header", () => {
  test("is only ever a claim, even from a trusted proxy: proxies append to X-Forwarded-For, and pass this one on as the sender wrote it", () => {
    const reading: ClientAddressReading = resolveClientAddress({
      peer: "10.0.0.5",
      forwarded: "for=192.0.2.44;proto=https, for=203.0.113.7",
    });

    expect(verified(reading)).toEqual({
      address: "",
      trust: ClientAddressTrust.Claimed,
    });
    expect(claim(reading)).toEqual({
      claimed: "192.0.2.44",
      from: CLAIMED_FROM_FORWARDED,
    });
  });

  test("beside a peer the project does not trust, the peer is blamed", () => {
    const reading: ClientAddressReading = resolveClientAddress({
      peer: "203.0.113.7",
      forwarded: 'for="[2001:db8:cafe::17]:4711"',
    });

    expect(verified(reading).address).toBe("203.0.113.7");
    expect(claim(reading).claimed).toBe("2001:db8:cafe::17");
  });

  test("is read as RFC 7239 writes it", () => {
    const hops: Array<AddressSlot | null> = readForwarded(
      'for=192.0.2.60;proto=http;by=203.0.113.43, FOR="[2001:db8:cafe::17]:4711", for=unknown, for=_hidden, proto=https, For=198.51.100.17',
    );

    expect(
      hops.map((hop: AddressSlot | null): string | null => {
        return hop ? hop.address : null;
      }),
    ).toEqual([
      "192.0.2.60",
      "2001:db8:cafe::17",
      null,
      null,
      null,
      "198.51.100.17",
    ]);
  });
});

describe("a request that forwarded nothing", () => {
  test("is from its peer, whatever the peer is", () => {
    for (const peer of ["203.0.113.7", "10.0.3.7", "2001:db8::7", "fd00::7"]) {
      expect({ peer, ...verified(resolveClientAddress({ peer })) }).toEqual({
        peer,
        address: peer,
        trust: ClientAddressTrust.Peer,
      });
    }
  });

  test("whose client.address is its peer's address, however written, claims nothing beside it", () => {
    const reading: ClientAddressReading = resolveClientAddress({
      peer: "::ffff:203.0.113.7",
      forwardedClient: "203.0.113.7",
      forwardedClientFrom: "client.address",
    });

    expect(verified(reading)).toEqual({
      address: "203.0.113.7",
      trust: ClientAddressTrust.Peer,
    });
    expect(reading.claimed).toBeNull();
  });

  test("through a trusted proxy, but with client.address unlike it, is only claimed: the proxy forwarded something unrecorded", () => {
    const reading: ClientAddressReading = resolveClientAddress({
      peer: "10.0.0.5",
      forwardedClient: "198.51.100.23",
      forwardedClientFrom: "http.client_ip",
    });

    expect(verified(reading)).toEqual({
      address: "",
      trust: ClientAddressTrust.Claimed,
    });
    expect(claim(reading)).toEqual({
      claimed: "198.51.100.23",
      from: "http.client_ip",
    });
  });

  test("names nothing when its record names no address", () => {
    for (const evidence of [
      {},
      { peer: "app.internal" },
      { forwardedClient: "/var/run/app.sock" },
      { peer: "unknown", forwardedFor: "" },
    ]) {
      const reading: ClientAddressReading = resolveClientAddress(evidence);

      expect({ evidence, ...verified(reading) }).toEqual({
        evidence,
        address: "",
        trust: null,
      });
      expect(reading.claimed).toBeNull();
    }
  });
});

describe("an address a scrub rule hid", () => {
  test("a hidden peer of a request that forwarded nothing is the client, hidden: what the address vault resolves", () => {
    for (const scrubbed of [
      "[REDACTED]",
      "***.***.***.***",
      token("203.0.113.7"),
    ]) {
      const reading: ClientAddressReading = resolveClientAddress({
        peer: scrubbed,
      });

      expect({ scrubbed, address: reading.address }).toEqual({
        scrubbed,
        address: "",
      });
      expect(reading.scrubbed?.value).toBe(scrubbed);
      expect(reading.trust).toBe(ClientAddressTrust.Peer);
    }
  });

  test("a hidden peer whose client.address holds the same token is still the client", () => {
    const hidden: string = token("203.0.113.7");
    const reading: ClientAddressReading = resolveClientAddress({
      peer: hidden,
      forwardedClient: hidden,
    });

    expect(reading.scrubbed?.value).toBe(hidden);
    expect(reading.trust).toBe(ClientAddressTrust.Peer);
    expect(reading.claimed).toBeNull();
  });

  test("a hidden peer of a request that forwarded an address is no client: it may be a proxy, and a proxy is never blamed", () => {
    const reading: ClientAddressReading = resolveClientAddress({
      peer: token("172.70.38.12"),
      forwardedClient: token("198.51.100.23"),
      forwardedClientFrom: "client.address",
    });

    expect(reading.address).toBe("");
    expect(reading.scrubbed).toBeNull();
    expect(reading.trust).toBe(ClientAddressTrust.Claimed);
    // The claim is kept as the rule left it: never resolved into an address.
    expect(claim(reading).claimed).toBe(token("198.51.100.23"));
  });

  test("a hidden hop of the recorded X-Forwarded-For, reached through trusted proxies, is the client, hidden", () => {
    const reading: ClientAddressReading = resolveClientAddress({
      peer: "10.0.0.5",
      forwardedClient: token("192.0.2.44"),
      forwardedFor: `${token("192.0.2.44")}, ${token("203.0.113.7")}, 10.0.0.9`,
    });

    expect(reading.address).toBe("");
    expect(reading.scrubbed?.value).toBe(token("203.0.113.7"));
    expect(reading.trust).toBe(ClientAddressTrust.TrustedProxy);
    expect(claim(reading).claimed).toBe(token("192.0.2.44"));
  });

  test("through a trusted proxy with no recorded header, a hidden client.address is a hidden claim", () => {
    const reading: ClientAddressReading = resolveClientAddress({
      peer: "10.0.0.5",
      forwardedClient: "[REDACTED]",
    });

    expect(reading.scrubbed).toBeNull();
    expect(reading.trust).toBe(ClientAddressTrust.Claimed);
    expect(reading.claimed?.scrubbed?.kind).toBe(ScrubbedAddressKind.Redacted);
  });
});

describe("the project's trusted proxies", () => {
  test("every address that is nobody's on the internet is one, without being listed", () => {
    for (const address of [
      "10.0.0.5",
      "172.16.4.4",
      "192.168.1.1",
      "100.64.0.9",
      "127.0.0.1",
      "169.254.169.254",
      "fd12:3456::1",
      "fe80::1",
      "::1",
      "::ffff:10.0.0.5",
    ]) {
      expect({ address, trusted: isTrustedProxy(address, undefined) }).toEqual({
        address,
        trusted: true,
      });
    }
  });

  test("a public address is one only when the project lists it, or a range that holds it", () => {
    const proxies: TrustedProxies = toTrustedProxies(
      "203.0.113.50\n198.51.100.0/24\n2001:db8:1::/48",
    );

    for (const [address, trusted] of [
      ["203.0.113.50", true],
      ["203.0.113.51", false],
      ["198.51.100.200", true],
      ["198.51.101.1", false],
      ["2001:db8:1::99", true],
      ["2001:db8:2::99", false],
      ["::ffff:198.51.100.9", true],
      ["192.0.2.44", false],
    ] as Array<[string, boolean]>) {
      expect({ address, trusted: isTrustedProxy(address, proxies) }).toEqual({
        address,
        trusted,
      });
      expect(isTrustedProxy(address, NO_TRUSTED_PROXIES)).toBe(false);
    }
  });

  test("nothing that is no address is a proxy", () => {
    for (const value of ["", "proxy", "[REDACTED]", "300.1.1.1"]) {
      expect(isTrustedProxy(value, CLOUDFLARE)).toBe(false);
    }
  });

  test("are read one a line, or apart by commas and spaces, each once and written one way", () => {
    expect(
      readTrustedProxyList(
        "203.0.113.50\r\n198.51.100.35/24, 2001:DB8:1::/48 ;\t203.0.113.50\n\n",
      ),
    ).toEqual({
      blocks: [
        expect.objectContaining({ text: "203.0.113.50" }),
        expect.objectContaining({ text: "198.51.100.0/24" }),
        expect.objectContaining({ text: "2001:db8:1::/48" }),
      ],
      invalid: [],
    });
  });

  test("say what is wrong with what was typed, or nothing", () => {
    expect(getTrustedProxyListError("")).toBeNull();
    expect(getTrustedProxyListError(null)).toBeNull();
    expect(getTrustedProxyListError("203.0.113.0/24\n10.0.0.1")).toBeNull();
    expect(getTrustedProxyListError("203.0.113.0/24\ncloudflare")).toBe(
      '"cloudflare" is not an IP address or a range. Write an address, such as 203.0.113.7, or a range, such as 203.0.113.0/24.',
    );
    expect(getTrustedProxyListError("203.0.113.0/33")).toContain(
      "is not an IP address or a range",
    );

    const many: Array<string> = [];

    for (let index: number = 0; index <= MAX_TRUSTED_PROXIES; index++) {
      many.push(`10.${Math.floor(index / 256)}.${index % 256}.1`);
    }

    expect(getTrustedProxyListError(many.join("\n"))).toBe(
      `Trusted Proxies can hold ${MAX_TRUSTED_PROXIES} addresses and ranges. Use ranges, such as 203.0.113.0/24, for a block of addresses.`,
    );
    expect(toTrustedProxies(many.join("\n")).blocks).toHaveLength(
      MAX_TRUSTED_PROXIES,
    );
  });
});

describe("reading an address", () => {
  test("as headers and attributes write one", () => {
    for (const [value, address] of [
      ["203.0.113.7", "203.0.113.7"],
      [" 203.0.113.7:51234 ", "203.0.113.7"],
      ['"203.0.113.7"', "203.0.113.7"],
      ["[2001:db8::7]:443", "2001:db8::7"],
      ["[2001:db8::7]", "2001:db8::7"],
      ["2001:db8::7", "2001:db8::7"],
      ["::ffff:203.0.113.7", "203.0.113.7"],
    ]) {
      expect({ value, address: readAddressText(value) }).toEqual({
        value,
        address,
      });
    }
  });

  test("never as anything that is no address", () => {
    for (const value of [
      "",
      "unknown",
      "_hidden",
      "app.internal",
      "[2001:db8::7",
      "[2001:db8::7]x",
      "203.0.113.7:http",
      "203.0.113.7:123456",
      "300.1.1.1",
      "1".repeat(80),
      "[REDACTED]",
    ]) {
      expect({ value, address: readAddressText(value) }).toEqual({
        value,
        address: "",
      });
    }
  });

  test("a scrub rule's leftover is a hidden address; anything else no slot at all", () => {
    expect(readAddressSlot("[REDACTED]:51234")?.scrubbed?.kind).toBe(
      ScrubbedAddressKind.Redacted,
    );
    expect(readAddressSlot(token("203.0.113.7"))?.scrubbed?.kind).toBe(
      ScrubbedAddressKind.Hashed,
    );
    expect(readAddressSlot("[Redacted]")).toBeNull();
    expect(readAddressSlot("unknown")).toBeNull();
  });

  test("two slots are one address however written, and one token is one address", () => {
    expect(
      isSameAddressSlot(
        readAddressSlot("::ffff:203.0.113.7"),
        readAddressSlot("203.0.113.7:80"),
      ),
    ).toBe(true);
    expect(
      isSameAddressSlot(
        readAddressSlot("2001:DB8::7"),
        readAddressSlot("[2001:db8:0:0:0:0:0:7]:443"),
      ),
    ).toBe(true);
    expect(
      isSameAddressSlot(
        readAddressSlot(token("203.0.113.7")),
        readAddressSlot(token("203.0.113.7")),
      ),
    ).toBe(true);
    expect(
      isSameAddressSlot(
        readAddressSlot(token("203.0.113.7")),
        readAddressSlot(token("203.0.113.8")),
      ),
    ).toBe(false);
    expect(
      isSameAddressSlot(
        readAddressSlot("203.0.113.7"),
        readAddressSlot(token("203.0.113.7")),
      ),
    ).toBe(false);
    expect(isSameAddressSlot(null, readAddressSlot("203.0.113.7"))).toBe(false);
  });

  test("a header is read as sent, or as the list OpenTelemetry records it as", () => {
    expect(readForwardingHeaderText("192.0.2.44, 10.0.0.5")).toBe(
      "192.0.2.44, 10.0.0.5",
    );
    expect(readForwardingHeaderText('["192.0.2.44, 10.0.0.5"]')).toBe(
      "192.0.2.44, 10.0.0.5",
    );
    expect(readForwardingHeaderText('["192.0.2.44", "10.0.0.5"]')).toBe(
      "192.0.2.44, 10.0.0.5",
    );
    // A scrub rule's "[REDACTED]" is no list.
    expect(readForwardingHeaderText("[REDACTED]")).toBe("[REDACTED]");
    expect(
      readForwardingHeaderText("1".repeat(MAX_FORWARDED_RECORDED_LENGTH + 1)),
    ).toBe("");
    expect(
      readForwardedFor('["198.51.100.9, unknown", "10.0.0.5"]').map(
        (hop: AddressSlot | null): string | null => {
          return hop ? hop.address : null;
        },
      ),
    ).toEqual(["198.51.100.9", null, "10.0.0.5"]);
  });
});

describe("a record's attributes", () => {
  test("are read by the names every OpenTelemetry convention gives them", () => {
    expect(
      readClientAddressEvidence({
        "network.peer.address": "10.0.0.5",
        "client.address": "192.0.2.44",
        "http.request.header.x-forwarded-for": '["192.0.2.44, 203.0.113.7"]',
        "http.request.header.forwarded": "for=192.0.2.44",
      }),
    ).toEqual({
      peer: "10.0.0.5",
      forwardedClient: "192.0.2.44",
      forwardedClientFrom: "client.address",
      forwardedFor: '["192.0.2.44, 203.0.113.7"]',
      forwarded: "for=192.0.2.44",
    });

    // The older names: net.sock.peer.addr and net.peer.ip, http.client_ip, the header with underscores.
    expect(
      readClientAddressEvidence({
        "net.peer.ip": "10.0.0.6",
        "http.client_ip": "192.0.2.45",
        "http.request.header.x_forwarded_for": ["192.0.2.45", "203.0.113.8"],
      }),
    ).toEqual({
      peer: "10.0.0.6",
      forwardedClient: "192.0.2.45",
      forwardedClientFrom: "http.client_ip",
      forwardedFor: "192.0.2.45, 203.0.113.8",
      forwarded: "",
    });

    expect(
      readClientAddressEvidence(
        { "source.address": "203.0.113.9" },
        { extraPeerKeys: ["source.address"] },
      ).peer,
    ).toBe("203.0.113.9");
    expect(readClientAddressEvidence(null)).toEqual({
      peer: "",
      forwardedClient: "",
      forwardedClientFrom: "",
      forwardedFor: "",
      forwarded: "",
    });
  });

  test("every one of them is read by a scan", () => {
    expect([...CLIENT_ADDRESS_ATTRIBUTES_READ].sort()).toEqual(
      [
        "network.peer.address",
        "net.sock.peer.addr",
        "net.peer.ip",
        "client.address",
        "http.client_ip",
        "http.request.header.x-forwarded-for",
        "http.request.header.x_forwarded_for",
        "http.request.header.forwarded",
      ].sort(),
    );
  });
});

describe("on the event", () => {
  test("the trust and the claim are request attributes, set and cleared together", () => {
    const attributes: JSONObject = {};

    markClientAddressTrust(
      attributes,
      resolveClientAddress({
        peer: "203.0.113.7",
        forwardedClient: "192.0.2.44",
        forwardedClientFrom: "client.address",
      }),
    );

    expect(attributes).toEqual({
      [SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust]: "peer",
      [SECURITY_REQUEST_ATTRIBUTES.claimedClientAddress]: "192.0.2.44",
      [SECURITY_REQUEST_ATTRIBUTES.claimedClientAddressFrom]: "client.address",
    });
    expect(SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust).toBe(
      "oneuptime.request.client_address_trust",
    );

    clearClientAddressTrust(attributes);
    expect(attributes).toEqual({});
  });

  test("a claim is read back as claimed, and as all there is when nothing is verified", () => {
    const attributes: JSONObject = {};
    markClientAddressTrust(
      attributes,
      resolveClientAddress({
        forwardedClient: "192.0.2.44",
        forwardedClientFrom: "client.address",
      }),
    );

    expect(readClientAddressTrust({ attributes })).toBe(
      ClientAddressTrust.Claimed,
    );
    expect(readClaimedClientAddress({ principalIp: "", attributes })).toEqual({
      address: "192.0.2.44",
      scrubbedKind: null,
      from: "client.address",
      isOnlyAddress: true,
    } as ClaimedClientAddress);

    // An event that names the same address claims nothing beside it.
    expect(
      readClaimedClientAddress({ principalIp: "192.0.2.44", attributes }),
    ).toBeNull();
  });

  test("a hidden claim is read as hidden, never as an address", () => {
    const attributes: JSONObject = {};
    markClientAddressTrust(
      attributes,
      resolveClientAddress({ peer: "10.0.0.5", forwardedClient: "[REDACTED]" }),
    );

    expect(readClaimedClientAddress({ attributes })).toEqual({
      address: "",
      scrubbedKind: ScrubbedAddressKind.Redacted,
      from: "",
      isOnlyAddress: true,
    });
  });

  test("an event that says nothing, or something that is neither an address nor a rule's leftover, claims nothing", () => {
    expect(readClaimedClientAddress({})).toBeNull();
    expect(
      readClaimedClientAddress({
        attributes: {
          [SECURITY_REQUEST_ATTRIBUTES.claimedClientAddress]: "app.internal",
        },
      }),
    ).toBeNull();
    expect(readClientAddressTrust({ attributes: { x: 1 } })).toBeNull();
    expect(
      readClientAddressTrust({
        attributes: {
          [SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust]: "trusted",
        },
      }),
    ).toBeNull();
  });
});

describe("the address vault's address (#10395)", () => {
  test("is named when it is a hidden peer of a request that forwarded nothing", () => {
    const attributes: JSONObject = {};
    markClientAddressTrust(
      attributes,
      resolveClientAddress({ peer: token("10.0.0.5") }),
    );

    // Even a private one: nothing forwarded, so the peer is the client.
    expect(
      canNameResolvedClientAddress({
        attributes,
        address: "10.0.0.5",
        proxies: undefined,
      }),
    ).toBe(true);
  });

  test("is named when a trusted proxy forwarded it, unless it turns out to be a trusted proxy itself", () => {
    const attributes: JSONObject = {};
    markClientAddressTrust(
      attributes,
      resolveClientAddress({
        peer: "10.0.0.5",
        forwardedFor: `192.0.2.44, ${token("172.70.38.12")}`,
      }),
    );

    expect(
      canNameResolvedClientAddress({
        attributes,
        address: "198.51.100.23",
        proxies: CLOUDFLARE,
      }),
    ).toBe(true);
    expect(
      canNameResolvedClientAddress({
        attributes,
        address: "172.70.38.12",
        proxies: CLOUDFLARE,
      }),
    ).toBe(false);
  });

  test("is named for an event of a source with no forwarding at all - an SSH sign-in - whatever it is", () => {
    expect(
      canNameResolvedClientAddress({
        attributes: {
          [SECURITY_REQUEST_ATTRIBUTES.clientAddressHidden]: "scrub-rule",
        },
        address: "172.70.38.12",
        proxies: CLOUDFLARE,
      }),
    ).toBe(true);
  });

  test("a peer beside a claim may be a proxy: one the project trusts is not named", () => {
    const attributes: JSONObject = {
      [SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust]: "peer",
      [SECURITY_REQUEST_ATTRIBUTES.claimedClientAddress]: "192.0.2.44",
    };

    expect(
      canNameResolvedClientAddress({
        attributes,
        address: "172.70.38.12",
        proxies: CLOUDFLARE,
      }),
    ).toBe(false);
    expect(
      canNameResolvedClientAddress({
        attributes,
        address: "203.0.113.7",
        proxies: CLOUDFLARE,
      }),
    ).toBe(true);
  });

  test("is never named for a request that only claimed one", () => {
    const attributes: JSONObject = {};
    markClientAddressTrust(
      attributes,
      resolveClientAddress({ forwardedClient: token("192.0.2.44") }),
    );

    expect(
      canNameResolvedClientAddress({
        attributes,
        address: "192.0.2.44",
        proxies: undefined,
      }),
    ).toBe(false);
    expect(
      canNameResolvedClientAddress({
        attributes: {},
        address: "not an address",
        proxies: undefined,
      }),
    ).toBe(false);
  });
});

describe("cost", () => {
  test("a header of the longest length read, of every hop shape, is read in time in line with it", () => {
    const hops: Array<string> = [];

    while (hops.join(", ").length < MAX_FORWARDED_HEADER_LENGTH - 60) {
      hops.push(
        ["10.0.0.1", "[fd00::1]:443", "unknown", "[REDACTED]", '"10.0.0.2"'][
          hops.length % 5
        ]!,
      );
    }

    // Its last hop names no address, so the walk reads every hop before it stops.
    const header: string = `${hops.join(", ")}, unknown`;
    const run: FastestRun<ClientAddressReading> = fastestRun({
      run: (): ClientAddressReading => {
        let reading: ClientAddressReading = resolveClientAddress({
          peer: "10.0.0.5",
          forwardedFor: header,
          forwarded: header,
        });

        for (let index: number = 0; index < 200; index++) {
          reading = resolveClientAddress({
            peer: "10.0.0.5",
            forwardedFor: header,
            forwarded: header,
          });
        }

        return reading;
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
    expect(run.result.address).toBe("");
    expect(run.result.trust).toBe(ClientAddressTrust.Claimed);
  });
});
