import DataSourceEgressGuard, {
  AddressVerdict,
} from "../../../Server/Utils/DataSource/EgressGuard";
import SSRFProtection from "../../../Server/Utils/SSRFProtection";
import IP from "../../../Types/IP/IP";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";
import dns from "dns";
import net from "net";
import { startEachTestOnSelfHostedEgressPolicy } from "./EgressPolicyEnvironment";

jest.mock("../../../Server/Utils/Logger");

/*
 * AN IPv4 ADDRESS WRITTEN AS IPv6, IN EVERY SPELLING, AT EVERY ADDRESS CHECK
 * (issue #8927).
 *
 * IP.isIPv6 now takes every text form of RFC 4291, an IPv4 address at the
 * end included ("0:0:0:0:0:ffff:127.0.0.1", "64:ff9b:0:0:0:0:10.0.0.1"), so
 * a URL with such a host now parses where it used to be refused as "not a
 * valid URL". These hold that no spelling of a blocked address gets past the
 * two checks every outbound request goes through: SSRFProtection (webhooks,
 * workflow requests) and the egress guard (data sources, LLM providers,
 * calendars and the rest). Each reads an IPv6 address by its 128 bits, so:
 *
 *   - an IPv4 address carried in IPv6 - IPv4-mapped (::ffff:0:0/96),
 *     IPv4-compatible (::/96), NAT64 (64:ff9b::/96), 6to4 (2002::/16, the
 *     router's address in bits 16 to 48) and Teredo (2001::/32, the server's
 *     address and the client's, inverted) - is judged as that IPv4 address,
 *     loopback and cloud metadata refused everywhere, a private one only
 *     where private addresses are allowed;
 *   - the translation prefixes whose IPv4 layout no one can read (SIIT's
 *     ::ffff:0:0:0/96, NAT64's local-use 64:ff9b:1::/48) are refused
 *     outright;
 *   - every spelling of one address gets one verdict: hex or dotted, every
 *     group written out or "::" in any run of zeros, upper or lower case,
 *     leading zeros or none, in a URL, behind a port, and in a DNS answer;
 *   - an address that merely ends in an IPv4 address (1:2:3:4:5:6:127.0.0.1)
 *     carries none, and is judged by the range it is in, the same as its hex
 *     spelling.
 */

startEachTestOnSelfHostedEgressPolicy();

enum Tier {
  Public = "Public",
  Private = "Private",
  Forbidden = "Forbidden",
}

const ALLOW_ENV: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";
const ALLOWLIST_ENV: string = "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST";

type LookupSpy = SpyInstance<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
>;

let savedAllow: string | undefined;
let savedAllowlist: string | undefined;
let lookupSpy: LookupSpy;

beforeEach(() => {
  savedAllow = process.env[ALLOW_ENV];
  savedAllowlist = process.env[ALLOWLIST_ENV];
  delete process.env[ALLOW_ENV];
  delete process.env[ALLOWLIST_ENV];

  // A literal is never looked up; a name in these tests resolves only here.
  lookupSpy = jest.spyOn(dns.promises, "lookup") as unknown as LookupSpy;
  lookupSpy.mockRejectedValue(
    Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
  );
});

afterEach(() => {
  jest.restoreAllMocks();

  for (const [name, value] of [
    [ALLOW_ENV, savedAllow],
    [ALLOWLIST_ENV, savedAllowlist],
  ] as Array<[string, string | undefined]>) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

// ---- spellings ----------------------------------------------------------

function toGroupsOfIpv4(ipv4: string): [number, number] {
  const octets: Array<number> = ipv4.split(".").map(Number);

  return [(octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!];
}

function toDotted(high: number, low: number): string {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

interface GroupStyle {
  pad: boolean;
  upper: boolean;
}

const GROUP_STYLES: Array<GroupStyle> = [
  { pad: false, upper: false },
  { pad: true, upper: false },
  { pad: true, upper: true },
  { pad: false, upper: true },
];

function writeGroup(group: number, style: GroupStyle): string {
  const text: string = group.toString(16).padStart(style.pad ? 4 : 1, "0");

  return style.upper ? text.toUpperCase() : text;
}

// Every run of zero groups in groups[from, to): [start, end).
function zeroRuns(
  groups: Array<number>,
  from: number,
  to: number,
): Array<[number, number]> {
  const runs: Array<[number, number]> = [];

  for (let start: number = from; start < to; start++) {
    for (let end: number = start + 1; end <= to; end++) {
      if (
        groups.slice(start, end).every((group: number) => {
          return group === 0;
        })
      ) {
        runs.push([start, end]);
      }
    }
  }

  return runs;
}

/*
 * Every way to write the eight groups: in hex, each group in four styles,
 * whole or with "::" for any run of zeros; and with the last two groups as
 * an IPv4 address, the six before them whole or with "::" for any of their
 * runs of zeros.
 */
function spellingsOf(groups: Array<number>): Array<string> {
  const spellings: Set<string> = new Set<string>();

  for (const style of GROUP_STYLES) {
    const written: Array<string> = groups.map((group: number) => {
      return writeGroup(group, style);
    });

    spellings.add(written.join(":"));

    for (const [start, end] of zeroRuns(groups, 0, 8)) {
      spellings.add(
        `${written.slice(0, start).join(":")}::${written.slice(end).join(":")}`,
      );
    }

    const dotted: string = toDotted(groups[6]!, groups[7]!);
    const head: Array<string> = written.slice(0, 6);

    spellings.add(`${head.join(":")}:${dotted}`);

    for (const [start, end] of zeroRuns(groups, 0, 6)) {
      const after: Array<string> = head.slice(end);

      spellings.add(
        `${head.slice(0, start).join(":")}::${
          after.length > 0 ? `${after.join(":")}:` : ""
        }${dotted}`,
      );
    }
  }

  return Array.from(spellings);
}

// ---- what each check makes of an address ----------------------------------

async function webhookTierOf(
  url: string,
  options?: { allowPrivateNetworkTargets: boolean },
): Promise<Tier> {
  try {
    await SSRFProtection.validateWebhookTargetIsSafe(url, options);
    return Tier.Public;
  } catch (error) {
    const message: string = (error as Error).message;

    if (message.includes("private, loopback, or link-local")) {
      return Tier.Forbidden;
    }

    if (message.includes("private network address")) {
      return Tier.Private;
    }

    return Promise.reject(
      new Error(`${url}: an unexpected refusal: ${message}`),
    );
  }
}

// What SSRFProtection says of a host name DNS answers with `address` for.
async function webhookTierOfDnsAnswer(address: string): Promise<Tier> {
  lookupSpy.mockResolvedValueOnce([{ address: address, family: 6 }]);

  return await webhookTierOf("http://embedded.example.test/hook");
}

function egressTierOf(address: string): Tier {
  const selfHosted: AddressVerdict = DataSourceEgressGuard.checkAddress(
    address,
    { blockPrivateAddresses: false },
  );

  // Refused even where private addresses are allowed.
  if (selfHosted.blocked) {
    return Tier.Forbidden;
  }

  const strict: AddressVerdict = DataSourceEgressGuard.checkAddress(address, {
    blockPrivateAddresses: true,
  });

  return strict.blocked && strict.isPrivateNetwork ? Tier.Private : Tier.Public;
}

async function egressUrlIsRefused(
  url: string,
  blockPrivateAddresses: boolean,
): Promise<boolean> {
  try {
    await DataSourceEgressGuard.assertUrlAllowed(url, {
      blockPrivateAddresses: blockPrivateAddresses,
    });
    return false;
  } catch {
    return true;
  }
}

async function egressNameIsRefused(
  address: string,
  blockPrivateAddresses: boolean,
): Promise<boolean> {
  try {
    await DataSourceEgressGuard.assertHostnameAllowed("embedded.example.test", {
      blockPrivateAddresses: blockPrivateAddresses,
      resolveFunction: async () => {
        return [{ address: address, family: 6 }];
      },
    });
    return false;
  } catch {
    return true;
  }
}

/*
 * Every spelling of `groups` through every check: what each says, wherever
 * it differs from `expected`. Empty when every spelling gets one verdict.
 */
async function disagreementsFor(
  groups: Array<number>,
  expected: Tier,
): Promise<Array<string>> {
  const disagreements: Array<string> = [];
  const spellings: Array<string> = spellingsOf(groups);

  expect(spellings.length).toBeGreaterThan(4);

  for (const spelling of spellings) {
    const said: (check: string, tier: Tier | boolean) => void = (
      check: string,
      tier: Tier | boolean,
    ): void => {
      disagreements.push(`${spelling}: ${check} says ${String(tier)}`);
    };

    // Every spelling is an address, to Node and to the app alike.
    if (!net.isIPv6(spelling)) {
      said("net.isIPv6", false);
      continue;
    }

    if (!(IP.isIP(spelling) && new IP(spelling).isIPv6())) {
      said("IP.isIPv6", false);
    }

    for (const url of [
      `http://[${spelling}]/`,
      `https://[${spelling}]:8443/hook?x=1`,
    ]) {
      const tier: Tier = await webhookTierOf(url);

      if (tier !== expected) {
        said(`SSRFProtection of ${url}`, tier);
      }

      // Opted in to private addresses: only the private tier opens.
      process.env[ALLOW_ENV] = "true";
      const optedIn: Tier = await webhookTierOf(url, {
        allowPrivateNetworkTargets: true,
      });
      delete process.env[ALLOW_ENV];

      const expectedOptedIn: Tier =
        expected === Tier.Private ? Tier.Public : expected;

      if (optedIn !== expectedOptedIn) {
        said(`SSRFProtection, opted in, of ${url}`, optedIn);
      }
    }

    // The pinned form: refused, or approved at the address the URL names.
    try {
      const target: { addresses: Array<{ address: string }> } =
        await SSRFProtection.validateAndResolveWebhookTarget(
          `http://[${spelling}]/`,
        );

      if (expected !== Tier.Public) {
        said("validateAndResolveWebhookTarget", true);
      } else if (
        target.addresses.length !== 1 ||
        !net.isIPv6(target.addresses[0]!.address)
      ) {
        said("validateAndResolveWebhookTarget's address", false);
      }
    } catch {
      if (expected === Tier.Public) {
        said("validateAndResolveWebhookTarget", false);
      }
    }

    const dnsTier: Tier = await webhookTierOfDnsAnswer(spelling);

    if (dnsTier !== expected) {
      said("SSRFProtection of a name DNS answers with it", dnsTier);
    }

    const egressTier: Tier = egressTierOf(spelling);

    if (egressTier !== expected) {
      said("the egress guard", egressTier);
    }

    for (const blockPrivateAddresses of [true, false]) {
      const shouldRefuse: boolean =
        expected === Tier.Forbidden ||
        (expected === Tier.Private && blockPrivateAddresses);

      if (
        (await egressUrlIsRefused(
          `http://[${spelling}]/`,
          blockPrivateAddresses,
        )) !== shouldRefuse
      ) {
        said(
          `the egress guard's URL check (private ${blockPrivateAddresses ? "refused" : "allowed"})`,
          !shouldRefuse,
        );
      }

      if (
        (await egressNameIsRefused(spelling, blockPrivateAddresses)) !==
        shouldRefuse
      ) {
        said(
          `the egress guard's check of a DNS answer (private ${blockPrivateAddresses ? "refused" : "allowed"})`,
          !shouldRefuse,
        );
      }
    }
  }

  return disagreements;
}

// ---- the addresses ------------------------------------------------------

interface CarriedIpv4 {
  ipv4: string;
  name: string;
  tier: Tier;
}

const CARRIED: Array<CarriedIpv4> = [
  { ipv4: "127.0.0.1", name: "loopback", tier: Tier.Forbidden },
  { ipv4: "127.1.2.3", name: "loopback, not .1", tier: Tier.Forbidden },
  {
    ipv4: "169.254.169.254",
    name: "the metadata endpoint",
    tier: Tier.Forbidden,
  },
  { ipv4: "100.100.100.200", name: "Alibaba's metadata", tier: Tier.Forbidden },
  { ipv4: "0.0.0.1", name: "this network", tier: Tier.Forbidden },
  { ipv4: "224.0.0.1", name: "multicast", tier: Tier.Forbidden },
  { ipv4: "10.0.0.1", name: "RFC 1918 10/8", tier: Tier.Private },
  { ipv4: "172.16.5.4", name: "RFC 1918 172.16/12", tier: Tier.Private },
  { ipv4: "192.168.1.1", name: "RFC 1918 192.168/16", tier: Tier.Private },
  { ipv4: "100.64.0.1", name: "CGNAT", tier: Tier.Private },
  { ipv4: "8.8.8.8", name: "a public address", tier: Tier.Public },
];

interface Wrapper {
  name: string;
  groups: (high: number, low: number) => Array<number>;
  // When the wrapper is refused whatever it carries.
  alwaysForbidden?: boolean;
}

// Teredo's public server 65.54.227.120, and its client 8.8.8.8 inverted.
const TEREDO_SERVER: [number, number] = [0x4136, 0xe378];
const TEREDO_PUBLIC_CLIENT: [number, number] = [0xf7f7, 0xf7f7];

const WRAPPERS: Array<Wrapper> = [
  {
    name: "IPv4-mapped (::ffff:a.b.c.d)",
    groups: (high: number, low: number): Array<number> => {
      return [0, 0, 0, 0, 0, 0xffff, high, low];
    },
  },
  {
    name: "IPv4-compatible (::a.b.c.d)",
    groups: (high: number, low: number): Array<number> => {
      return [0, 0, 0, 0, 0, 0, high, low];
    },
  },
  {
    name: "NAT64's well-known prefix (64:ff9b::a.b.c.d)",
    groups: (high: number, low: number): Array<number> => {
      return [0x64, 0xff9b, 0, 0, 0, 0, high, low];
    },
  },
  {
    name: "6to4 (2002:aabb:ccdd::)",
    groups: (high: number, low: number): Array<number> => {
      return [0x2002, high, low, 0, 0, 0, 0, 1];
    },
  },
  {
    name: "6to4, another /64 of its /48",
    groups: (high: number, low: number): Array<number> => {
      return [0x2002, high, low, 0xbeef, 0, 0, 0, 0];
    },
  },
  {
    name: "Teredo, as its client",
    groups: (high: number, low: number): Array<number> => {
      return [
        0x2001,
        0,
        ...TEREDO_SERVER,
        0x8000,
        0x63bf,
        high ^ 0xffff,
        low ^ 0xffff,
      ];
    },
  },
  {
    name: "Teredo, as its server",
    groups: (high: number, low: number): Array<number> => {
      return [0x2001, 0, high, low, 0x8000, 0x63bf, ...TEREDO_PUBLIC_CLIENT];
    },
  },
  {
    name: "SIIT's IPv4-translated prefix (::ffff:0:a.b.c.d)",
    groups: (high: number, low: number): Array<number> => {
      return [0, 0, 0, 0, 0xffff, 0, high, low];
    },
    alwaysForbidden: true,
  },
  {
    name: "NAT64's local-use prefix (64:ff9b:1::a.b.c.d)",
    groups: (high: number, low: number): Array<number> => {
      return [0x64, 0xff9b, 1, 0, 0, 0, high, low];
    },
    alwaysForbidden: true,
  },
];

describe.each(WRAPPERS)("an IPv4 address carried $name", (wrapper: Wrapper) => {
  test.each(CARRIED)(
    "carrying $ipv4 ($name) is judged as $ipv4, in every spelling, at every check",
    async (carried: CarriedIpv4) => {
      const [high, low] = toGroupsOfIpv4(carried.ipv4);
      const expected: Tier = wrapper.alwaysForbidden
        ? Tier.Forbidden
        : carried.tier;

      expect(
        await disagreementsFor(wrapper.groups(high, low), expected),
      ).toEqual([]);
    },
  );
});

describe("an address that only ends in an IPv4 address carries none", () => {
  const ENDS_IN_IPV4: Array<[string, Array<number>, Tier]> = [
    [
      "1:2:3:4:5:6:127.0.0.1 (in the reserved ::/8, no loopback)",
      [1, 2, 3, 4, 5, 6, 0x7f00, 1],
      Tier.Public,
    ],
    [
      "2606:4700::1:169.254.169.254 (a public address)",
      [0x2606, 0x4700, 0, 0, 0, 1, 0xa9fe, 0xa9fe],
      Tier.Public,
    ],
    [
      "2001:db8::1:192.0.2.1 (documentation)",
      [0x2001, 0xdb8, 0, 0, 0, 1, 0xc000, 0x201],
      Tier.Private,
    ],
    [
      "fd00::1:127.0.0.1 (unique local)",
      [0xfd00, 0, 0, 0, 0, 1, 0x7f00, 1],
      Tier.Private,
    ],
    [
      "fe80::1:8.8.8.8 (link-local)",
      [0xfe80, 0, 0, 0, 0, 1, 0x808, 0x808],
      Tier.Forbidden,
    ],
    [
      "ff02::1:8.8.8.8 (multicast)",
      [0xff02, 0, 0, 0, 0, 1, 0x808, 0x808],
      Tier.Forbidden,
    ],
    [
      "fd00:ec2::169.254.169.254 (AWS's IPv6 metadata range)",
      [0xfd00, 0xec2, 0, 0, 0, 0, 0xa9fe, 0xa9fe],
      Tier.Forbidden,
    ],
  ];

  test.each(ENDS_IN_IPV4)(
    "%s is judged by its range, in every spelling",
    async (_name: string, groups: Array<number>, expected: Tier) => {
      expect(await disagreementsFor(groups, expected)).toEqual([]);
    },
  );
});

describe("the forms IP.isIPv6 newly takes reach the checks as addresses", () => {
  /*
   * Before #8927 the app's own URL parser refused these hosts, so the check
   * failed closed with "not a valid URL". Now they parse, and the check says
   * what they are.
   */
  test.each([
    ["http://[0:0:0:0:0:ffff:127.0.0.1]/", Tier.Forbidden],
    [
      "http://[0:0:0:0:0:FFFF:169.254.169.254]/latest/meta-data/",
      Tier.Forbidden,
    ],
    ["http://[0::ffff:10.0.0.1]:8065/hooks/x", Tier.Private],
    ["http://[64:ff9b:0:0:0:0:127.0.0.1]/", Tier.Forbidden],
    ["http://[0:0:0:0:0:0:127.0.0.1]/", Tier.Forbidden],
    ["http://[2002:7f00:1::1.2.3.4]/", Tier.Forbidden],
    ["http://[1:2:3:4:5:6:127.0.0.1]/", Tier.Public],
    ["http://[0:0:0:0:0:ffff:8.8.8.8]/", Tier.Public],
  ])("%s is %s", async (url: string, expected: Tier) => {
    const host: string = url.slice(url.indexOf("[") + 1, url.indexOf("]"));

    expect(IP.isIP(host) && new IP(host).isIPv6()).toBe(true);
    expect(await webhookTierOf(url)).toBe(expected);
  });

  test("a forbidden one's refusal says why, not that the URL is malformed", async () => {
    await expect(
      SSRFProtection.validateWebhookTargetIsSafe(
        "http://[0:0:0:0:0:ffff:127.0.0.1]/",
      ),
    ).rejects.toThrow(
      "Webhook URL points to a private, loopback, or link-local address and is not allowed.",
    );
  });
});

describe("the spellings these tests try are every spelling", () => {
  test("::ffff:127.0.0.1 is tried in hex and dotted, whole and with :: in each run of zeros", () => {
    const spellings: Array<string> = spellingsOf([
      0, 0, 0, 0, 0, 0xffff, 0x7f00, 1,
    ]);

    for (const spelling of [
      "::ffff:7f00:1",
      "::ffff:127.0.0.1",
      "0:0:0:0:0:ffff:7f00:1",
      "0:0:0:0:0:ffff:127.0.0.1",
      "0::ffff:127.0.0.1",
      "0:0::0:0:ffff:7f00:1",
      "0000:0000:0000:0000:0000:FFFF:7F00:0001",
      "::FFFF:127.0.0.1",
    ]) {
      expect(spellings).toContain(spelling);
    }

    expect(
      spellings.every((spelling: string): boolean => {
        return net.isIPv6(spelling);
      }),
    ).toBe(true);
  });
});
