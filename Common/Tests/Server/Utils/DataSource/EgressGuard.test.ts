import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { IsBillingEnabled } from "../../../../Server/EnvironmentConfig";
import DataSourceEgressGuard, {
  AddressVerdict,
  EgressResolveFunction,
  ResolvedAddress,
} from "../../../../Server/Utils/DataSource/EgressGuard";
import BadDataException from "../../../../Types/Exception/BadDataException";

const ENV_VAR_NAME: string = "DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES";

let savedEnvValue: string | undefined = undefined;

beforeEach(() => {
  savedEnvValue = process.env[ENV_VAR_NAME];
  delete process.env[ENV_VAR_NAME];
});

afterEach(() => {
  if (savedEnvValue === undefined) {
    delete process.env[ENV_VAR_NAME];
  } else {
    process.env[ENV_VAR_NAME] = savedEnvValue;
  }
  jest.restoreAllMocks();
});

type CheckFunction = (
  address: string,
  blockPrivateAddresses: boolean,
) => AddressVerdict;

const check: CheckFunction = (
  address: string,
  blockPrivateAddresses: boolean,
): AddressVerdict => {
  return DataSourceEgressGuard.checkAddress(address, {
    blockPrivateAddresses: blockPrivateAddresses,
  });
};

interface Resolver {
  resolveFunction: EgressResolveFunction;
  calls: Array<string>;
}

type MakeResolverFunction = (addresses: Array<ResolvedAddress>) => Resolver;

const makeResolver: MakeResolverFunction = (
  addresses: Array<ResolvedAddress>,
): Resolver => {
  const calls: Array<string> = [];
  const resolveFunction: EgressResolveFunction = (
    hostname: string,
  ): Promise<Array<ResolvedAddress>> => {
    calls.push(hostname);
    return Promise.resolve(addresses);
  };
  return { resolveFunction: resolveFunction, calls: calls };
};

type CaptureRejectionFunction = (promise: Promise<unknown>) => Promise<Error>;

const captureRejection: CaptureRejectionFunction = async (
  promise: Promise<unknown>,
): Promise<Error> => {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected promise to reject, but it resolved.");
};

const bothFlags: Array<boolean> = [true, false];

describe("DataSourceEgressGuard.checkAddress - IPv4 always blocked", () => {
  const alwaysBlockedIpv4: Array<[string, string]> = [
    ["127.0.0.1", "loopback address"],
    ["127.255.255.254", "loopback address"],
    ["169.254.169.254", "link-local address (cloud metadata range)"],
    ["0.0.0.0", "unspecified address"],
    ["224.0.0.1", "multicast address"],
    ["240.0.0.1", "reserved address"],
    ["255.255.255.255", "broadcast address"],
  ];

  for (const entry of alwaysBlockedIpv4) {
    const address: string = entry[0];
    const expectedReason: string = entry[1];
    for (const flag of bothFlags) {
      test(`${address} is blocked when blockPrivateAddresses=${flag}`, () => {
        const verdict: AddressVerdict = check(address, flag);
        expect(verdict.blocked).toBe(true);
        expect(verdict.reason).toBe(expectedReason);
      });
    }
  }
});

describe("DataSourceEgressGuard.checkAddress - IPv4 private ranges", () => {
  const privateIpv4: Array<[string, string]> = [
    ["10.0.0.5", "private network address"],
    ["172.16.0.1", "private network address"],
    ["172.31.255.255", "private network address"],
    ["192.168.1.1", "private network address"],
    ["100.64.0.1", "carrier-grade NAT address"],
    ["192.0.0.10", "IETF protocol assignment address"],
    ["198.18.0.1", "benchmarking address"],
    ["192.0.2.5", "documentation address"],
    ["198.51.100.7", "documentation address"],
    ["203.0.113.9", "documentation address"],
  ];

  for (const entry of privateIpv4) {
    const address: string = entry[0];
    const expectedReason: string = entry[1];

    test(`${address} is blocked when blockPrivateAddresses=true`, () => {
      const verdict: AddressVerdict = check(address, true);
      expect(verdict.blocked).toBe(true);
      expect(verdict.reason).toBe(expectedReason);
    });

    test(`${address} is allowed when blockPrivateAddresses=false`, () => {
      const verdict: AddressVerdict = check(address, false);
      expect(verdict.blocked).toBe(false);
      expect(verdict.reason).toBeUndefined();
    });
  }

  const boundaryPublicIpv4: Array<string> = [
    "172.15.255.255",
    "172.32.0.0",
    "100.128.0.0",
    "9.255.255.255",
    "11.0.0.0",
  ];

  for (const address of boundaryPublicIpv4) {
    for (const flag of bothFlags) {
      test(`boundary address ${address} is public when blockPrivateAddresses=${flag}`, () => {
        const verdict: AddressVerdict = check(address, flag);
        expect(verdict.blocked).toBe(false);
      });
    }
  }
});

describe("DataSourceEgressGuard.checkAddress - IPv4 public addresses", () => {
  const publicIpv4: Array<string> = ["8.8.8.8", "1.1.1.1", "93.184.216.34"];

  for (const address of publicIpv4) {
    for (const flag of bothFlags) {
      test(`${address} is allowed when blockPrivateAddresses=${flag}`, () => {
        const verdict: AddressVerdict = check(address, flag);
        expect(verdict.blocked).toBe(false);
        expect(verdict.reason).toBeUndefined();
      });
    }
  }
});

describe("DataSourceEgressGuard.checkAddress - IPv6 always blocked", () => {
  const alwaysBlockedIpv6: Array<[string, string]> = [
    ["::1", "loopback address"],
    ["::", "unspecified address"],
    ["fe80::1", "link-local address"],
    ["ff02::1", "multicast address"],
    ["::ffff:127.0.0.1", "loopback address"],
    ["64:ff9b::7f00:0001", "loopback address"],
  ];

  for (const entry of alwaysBlockedIpv6) {
    const address: string = entry[0];
    const expectedReason: string = entry[1];
    for (const flag of bothFlags) {
      test(`${address} is blocked when blockPrivateAddresses=${flag}`, () => {
        const verdict: AddressVerdict = check(address, flag);
        expect(verdict.blocked).toBe(true);
        expect(verdict.reason).toBe(expectedReason);
      });
    }
  }

  for (const flag of bothFlags) {
    test(`zone-id address fe80::1%en0 is blocked when blockPrivateAddresses=${flag}`, () => {
      /*
       * Node's net.isIP rejects zone ids, so this is refused as an invalid
       * IP rather than reaching the IPv6 range checks — blocked either way.
       */
      const verdict: AddressVerdict = check("fe80::1%en0", flag);
      expect(verdict.blocked).toBe(true);
      expect(verdict.reason).toBeDefined();
    });
  }
});

describe("DataSourceEgressGuard.checkAddress - IPv6 private ranges", () => {
  const privateIpv6: Array<[string, string]> = [
    ["fc00::1", "private network address"],
    ["fd12:3456::1", "private network address"],
    ["2001:db8::1", "documentation address"],
    ["::ffff:10.0.0.1", "private network address"],
    ["64:ff9b::0a00:0001", "private network address"],
  ];

  for (const entry of privateIpv6) {
    const address: string = entry[0];
    const expectedReason: string = entry[1];

    test(`${address} is blocked when blockPrivateAddresses=true`, () => {
      const verdict: AddressVerdict = check(address, true);
      expect(verdict.blocked).toBe(true);
      expect(verdict.reason).toBe(expectedReason);
    });

    test(`${address} is allowed when blockPrivateAddresses=false`, () => {
      const verdict: AddressVerdict = check(address, false);
      expect(verdict.blocked).toBe(false);
      expect(verdict.reason).toBeUndefined();
    });
  }

  for (const flag of bothFlags) {
    test(`public IPv6 2607:f8b0::1 is allowed when blockPrivateAddresses=${flag}`, () => {
      const verdict: AddressVerdict = check("2607:f8b0::1", flag);
      expect(verdict.blocked).toBe(false);
      expect(verdict.reason).toBeUndefined();
    });
  }
});

describe("DataSourceEgressGuard.checkAddress - invalid input", () => {
  const garbageAddresses: Array<string> = ["not-an-ip", "1.2.3.4.5"];

  for (const address of garbageAddresses) {
    for (const flag of bothFlags) {
      test(`${address} is blocked as invalid when blockPrivateAddresses=${flag}`, () => {
        const verdict: AddressVerdict = check(address, flag);
        expect(verdict.blocked).toBe(true);
        expect(verdict.reason).toBe("not a valid IP address");
      });
    }
  }
});

describe("DataSourceEgressGuard.assertHostnameAllowed", () => {
  test("returns the literal IPv4 address without calling the resolver", async () => {
    const resolver: Resolver = makeResolver([
      { address: "203.0.113.10", family: 4 },
    ]);
    const addresses: Array<ResolvedAddress> =
      await DataSourceEgressGuard.assertHostnameAllowed("8.8.8.8", {
        blockPrivateAddresses: true,
        resolveFunction: resolver.resolveFunction,
      });
    expect(addresses).toEqual([{ address: "8.8.8.8", family: 4 }]);
    expect(resolver.calls).toHaveLength(0);
  });

  test("returns the literal IPv6 address with family 6", async () => {
    const addresses: Array<ResolvedAddress> =
      await DataSourceEgressGuard.assertHostnameAllowed("2607:f8b0::1", {
        blockPrivateAddresses: true,
      });
    expect(addresses).toEqual([{ address: "2607:f8b0::1", family: 6 }]);
  });

  test("strips brackets from a bracketed IPv6 literal", async () => {
    const addresses: Array<ResolvedAddress> =
      await DataSourceEgressGuard.assertHostnameAllowed("[2607:f8b0::1]", {
        blockPrivateAddresses: true,
      });
    expect(addresses).toEqual([{ address: "2607:f8b0::1", family: 6 }]);
  });

  test("throws BadDataException for a blocked literal IPv4", async () => {
    const error: Error = await captureRejection(
      DataSourceEgressGuard.assertHostnameAllowed("169.254.169.254", {
        blockPrivateAddresses: false,
      }),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("169.254.169.254");
    expect(error.message).toContain("link-local");
  });

  test("throws BadDataException for bracketed [::1]", async () => {
    const error: Error = await captureRejection(
      DataSourceEgressGuard.assertHostnameAllowed("[::1]", {
        blockPrivateAddresses: false,
      }),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("::1");
    expect(error.message).toContain("loopback");
  });

  test("allows a literal private IPv4 when blockPrivateAddresses is false", async () => {
    const addresses: Array<ResolvedAddress> =
      await DataSourceEgressGuard.assertHostnameAllowed("10.0.0.5", {
        blockPrivateAddresses: false,
      });
    expect(addresses).toEqual([{ address: "10.0.0.5", family: 4 }]);
  });

  test("throws BadDataException for a literal private IPv4 when the flag is on", async () => {
    const error: Error = await captureRejection(
      DataSourceEgressGuard.assertHostnameAllowed("10.0.0.5", {
        blockPrivateAddresses: true,
      }),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("10.0.0.5");
    expect(error.message).toContain("private network");
  });

  test("resolves a hostname through the injected resolver and returns all public addresses", async () => {
    const resolvedAddresses: Array<ResolvedAddress> = [
      { address: "93.184.216.34", family: 4 },
      { address: "2607:f8b0::1", family: 6 },
    ];
    const resolver: Resolver = makeResolver(resolvedAddresses);
    const addresses: Array<ResolvedAddress> =
      await DataSourceEgressGuard.assertHostnameAllowed("db.example.com", {
        blockPrivateAddresses: true,
        resolveFunction: resolver.resolveFunction,
      });
    expect(addresses).toEqual(resolvedAddresses);
    expect(resolver.calls).toEqual(["db.example.com"]);
  });

  test("throws when ANY resolved address is private and the flag is on", async () => {
    const resolver: Resolver = makeResolver([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    const error: Error = await captureRejection(
      DataSourceEgressGuard.assertHostnameAllowed("db.example.com", {
        blockPrivateAddresses: true,
        resolveFunction: resolver.resolveFunction,
      }),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("db.example.com");
    expect(error.message).toContain("10.0.0.5");
    expect(error.message).toContain("private network");
  });

  test("allows a mixed public/private answer when the flag is off", async () => {
    const resolver: Resolver = makeResolver([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    const addresses: Array<ResolvedAddress> =
      await DataSourceEgressGuard.assertHostnameAllowed("db.example.com", {
        blockPrivateAddresses: false,
        resolveFunction: resolver.resolveFunction,
      });
    expect(addresses).toHaveLength(2);
  });

  test("always blocks a hostname resolving to loopback even with the flag off", async () => {
    const resolver: Resolver = makeResolver([
      { address: "127.0.0.1", family: 4 },
    ]);
    const error: Error = await captureRejection(
      DataSourceEgressGuard.assertHostnameAllowed("evil.example.com", {
        blockPrivateAddresses: false,
        resolveFunction: resolver.resolveFunction,
      }),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("evil.example.com");
    expect(error.message).toContain("127.0.0.1");
    expect(error.message).toContain("loopback");
  });

  test("throws when the resolver returns no addresses", async () => {
    const resolver: Resolver = makeResolver([]);
    const error: Error = await captureRejection(
      DataSourceEgressGuard.assertHostnameAllowed("db.example.com", {
        blockPrivateAddresses: true,
        resolveFunction: resolver.resolveFunction,
      }),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain(
      "Could not resolve data source host db.example.com",
    );
  });

  test("surfaces resolver rejections as BadDataException naming the host", async () => {
    const resolveFunction: EgressResolveFunction = (
      _hostname: string,
    ): Promise<Array<ResolvedAddress>> => {
      return Promise.reject(new Error("getaddrinfo ENOTFOUND"));
    };
    const error: Error = await captureRejection(
      DataSourceEgressGuard.assertHostnameAllowed("missing.example.com", {
        blockPrivateAddresses: true,
        resolveFunction: resolveFunction,
      }),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("missing.example.com");
    expect(error.message).toContain("getaddrinfo ENOTFOUND");
  });

  test("stringifies non-Error resolver rejections", async () => {
    const resolveFunction: EgressResolveFunction = (
      _hostname: string,
    ): Promise<Array<ResolvedAddress>> => {
      return Promise.reject("plain-string-failure");
    };
    const error: Error = await captureRejection(
      DataSourceEgressGuard.assertHostnameAllowed("missing.example.com", {
        blockPrivateAddresses: true,
        resolveFunction: resolveFunction,
      }),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("plain-string-failure");
  });

  test("throws when the hostname is empty", async () => {
    const error: Error = await captureRejection(
      DataSourceEgressGuard.assertHostnameAllowed("", {
        blockPrivateAddresses: true,
      }),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("Data source host is required");
  });
});

describe("DataSourceEgressGuard.assertUrlAllowed", () => {
  test("rejects ftp:// URLs", async () => {
    const error: Error = await captureRejection(
      DataSourceEgressGuard.assertUrlAllowed("ftp://example.com/file", {
        blockPrivateAddresses: true,
      }),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("http or https");
    expect(error.message).toContain("ftp");
  });

  test("rejects file:// URLs", async () => {
    const error: Error = await captureRejection(
      DataSourceEgressGuard.assertUrlAllowed("file:///etc/passwd", {
        blockPrivateAddresses: true,
      }),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("http or https");
    expect(error.message).toContain("file");
  });

  test("rejects an unparseable URL string", async () => {
    const error: Error = await captureRejection(
      DataSourceEgressGuard.assertUrlAllowed("not a valid url", {
        blockPrivateAddresses: true,
      }),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("Invalid data source URL");
  });

  test("rejects an empty URL string", async () => {
    const error: Error = await captureRejection(
      DataSourceEgressGuard.assertUrlAllowed("", {
        blockPrivateAddresses: true,
      }),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("Data source URL is required");
  });

  test("allows an http URL and validates the extracted hostname via the resolver", async () => {
    const resolvedAddresses: Array<ResolvedAddress> = [
      { address: "93.184.216.34", family: 4 },
    ];
    const resolver: Resolver = makeResolver(resolvedAddresses);
    const result: { url: URL; addresses: Array<ResolvedAddress> } =
      await DataSourceEgressGuard.assertUrlAllowed("http://api.example.com", {
        blockPrivateAddresses: true,
        resolveFunction: resolver.resolveFunction,
      });
    expect(result.url.hostname).toBe("api.example.com");
    expect(result.addresses).toEqual(resolvedAddresses);
    expect(resolver.calls).toEqual(["api.example.com"]);
  });

  test("preserves port, path and query in the returned URL", async () => {
    const resolver: Resolver = makeResolver([
      { address: "93.184.216.34", family: 4 },
    ]);
    const result: { url: URL; addresses: Array<ResolvedAddress> } =
      await DataSourceEgressGuard.assertUrlAllowed(
        "https://api.example.com:8443/v1/data?limit=10&from=abc",
        {
          blockPrivateAddresses: true,
          resolveFunction: resolver.resolveFunction,
        },
      );
    expect(result.url.protocol).toBe("https:");
    expect(result.url.port).toBe("8443");
    expect(result.url.pathname).toBe("/v1/data");
    expect(result.url.search).toBe("?limit=10&from=abc");
    expect(result.url.href).toBe(
      "https://api.example.com:8443/v1/data?limit=10&from=abc",
    );
  });

  test("rejects a URL whose host resolves to a private address when the flag is on", async () => {
    const resolver: Resolver = makeResolver([
      { address: "192.168.1.1", family: 4 },
    ]);
    const error: Error = await captureRejection(
      DataSourceEgressGuard.assertUrlAllowed("https://internal.example.com", {
        blockPrivateAddresses: true,
        resolveFunction: resolver.resolveFunction,
      }),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("internal.example.com");
    expect(error.message).toContain("192.168.1.1");
  });

  test("always rejects the cloud metadata endpoint as a literal URL host", async () => {
    const error: Error = await captureRejection(
      DataSourceEgressGuard.assertUrlAllowed(
        "http://169.254.169.254/latest/meta-data",
        { blockPrivateAddresses: false },
      ),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("169.254.169.254");
    expect(error.message).toContain("link-local");
  });

  test("rejects a bracketed IPv6 loopback URL host", async () => {
    const error: Error = await captureRejection(
      DataSourceEgressGuard.assertUrlAllowed("http://[::1]:8080/status", {
        blockPrivateAddresses: false,
      }),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("loopback");
  });
});

describe("DataSourceEgressGuard.assertHostnameAllowed - numeric hostname encodings", () => {
  /*
   * These hostnames are not IP literals to net.isIP, so they take the
   * RESOLVER path — and getaddrinfo parses numeric encodings of 127.0.0.1
   * without any network I/O, which is exactly the classic SSRF filter
   * bypass. No resolveFunction is injected: the point is to prove the real
   * system resolver path catches them. blockPrivateAddresses is OFF so the
   * block can only come from the always-on loopback rule (or from the form
   * failing to resolve on this platform — either way the call must throw).
   */
  const numericLoopbackEncodings: Array<[string, string]> = [
    ["2130706433", "decimal encoding of 127.0.0.1"],
    ["0x7f000001", "hex encoding of 127.0.0.1"],
    ["017700000001", "octal encoding of 127.0.0.1"],
    ["0x7f.0.0.1", "mixed hex/dotted encoding of 127.0.0.1"],
  ];

  for (const entry of numericLoopbackEncodings) {
    const hostname: string = entry[0];
    const label: string = entry[1];
    test(`${hostname} (${label}) is rejected through the real system resolver`, async () => {
      const error: Error = await captureRejection(
        DataSourceEgressGuard.assertHostnameAllowed(hostname, {
          blockPrivateAddresses: false,
        }),
      );
      expect(error instanceof BadDataException).toBe(true);
      expect(error.message).toContain(hostname);
      /*
       * getaddrinfo variance: on platforms where the form parses, it
       * resolves to 127.0.0.1 and is blocked as loopback; where it does
       * not parse, resolution fails. Both are rejections.
       */
      expect(error.message).toMatch(
        /loopback address|Could not resolve data source host/,
      );
    }, 15000);
  }

  for (const flag of bothFlags) {
    test(`expanded IPv6 loopback 0:0:0:0:0:0:0:1 is blocked when blockPrivateAddresses=${flag}`, async () => {
      /*
       * The unabbreviated form of ::1 IS an IP literal, so it takes the
       * literal path — but must land on the same loopback verdict.
       */
      const error: Error = await captureRejection(
        DataSourceEgressGuard.assertHostnameAllowed("0:0:0:0:0:0:0:1", {
          blockPrivateAddresses: flag,
        }),
      );
      expect(error instanceof BadDataException).toBe(true);
      expect(error.message).toContain("0:0:0:0:0:0:0:1");
      expect(error.message).toContain("loopback");
    });
  }
});

describe("DataSourceEgressGuard.shouldBlockPrivateAddresses", () => {
  test("returns true when DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true", () => {
    process.env[ENV_VAR_NAME] = "true";
    expect(DataSourceEgressGuard.shouldBlockPrivateAddresses()).toBe(true);
  });

  test("falls back to the billing flag when the env var is unset", () => {
    delete process.env[ENV_VAR_NAME];
    expect(DataSourceEgressGuard.shouldBlockPrivateAddresses()).toBe(
      IsBillingEnabled,
    );
  });

  test("treats any value other than 'true' as unset", () => {
    process.env[ENV_VAR_NAME] = "false";
    expect(DataSourceEgressGuard.shouldBlockPrivateAddresses()).toBe(
      IsBillingEnabled,
    );
  });

  test("checkAddress derives the policy from the env var when options omit the flag", () => {
    process.env[ENV_VAR_NAME] = "true";
    const verdict: AddressVerdict =
      DataSourceEgressGuard.checkAddress("10.0.0.5");
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toBe("private network address");
  });

  test("an explicit blockPrivateAddresses=false overrides the env var", () => {
    process.env[ENV_VAR_NAME] = "true";
    const verdict: AddressVerdict = check("10.0.0.5", false);
    expect(verdict.blocked).toBe(false);
  });
});

/*
 * The private-address policy reads BILLING_ENABLED from process.env at call
 * time (SaaS blocks private ranges; a self-hosted install with billing off
 * reaches its own 10.x/192.168.x). These tests pin that call-time behaviour so
 * the two policy inputs (this flag and DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES)
 * stay consistent and independently controllable.
 */
describe("DataSourceEgressGuard.shouldBlockPrivateAddresses - BILLING_ENABLED is read dynamically", () => {
  const BILLING_ENV: string = "BILLING_ENABLED";
  let savedBilling: string | undefined = undefined;

  beforeEach(() => {
    savedBilling = process.env[BILLING_ENV];
  });

  afterEach(() => {
    if (savedBilling === undefined) {
      delete process.env[BILLING_ENV];
    } else {
      process.env[BILLING_ENV] = savedBilling;
    }
  });

  test("SaaS (BILLING_ENABLED=true) blocks private ranges by default", () => {
    process.env[BILLING_ENV] = "true";
    delete process.env[ENV_VAR_NAME];
    expect(DataSourceEgressGuard.shouldBlockPrivateAddresses()).toBe(true);
  });

  test("self-hosted (BILLING_ENABLED unset) allows private ranges by default", () => {
    delete process.env[BILLING_ENV];
    delete process.env[ENV_VAR_NAME];
    expect(DataSourceEgressGuard.shouldBlockPrivateAddresses()).toBe(false);
  });

  test("BILLING_ENABLED with any value other than 'true' counts as off", () => {
    process.env[BILLING_ENV] = "1";
    delete process.env[ENV_VAR_NAME];
    expect(DataSourceEgressGuard.shouldBlockPrivateAddresses()).toBe(false);
  });

  test("DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true blocks even when billing is off", () => {
    delete process.env[BILLING_ENV];
    process.env[ENV_VAR_NAME] = "true";
    expect(DataSourceEgressGuard.shouldBlockPrivateAddresses()).toBe(true);
  });

  test("checkAddress follows the billing flag when no explicit policy is given", () => {
    delete process.env[ENV_VAR_NAME];

    process.env[BILLING_ENV] = "true";
    expect(DataSourceEgressGuard.checkAddress("10.0.0.5").blocked).toBe(true);

    delete process.env[BILLING_ENV];
    expect(DataSourceEgressGuard.checkAddress("10.0.0.5").blocked).toBe(false);
  });

  test("a self-hosted install still cannot reach loopback or metadata ranges", () => {
    delete process.env[BILLING_ENV];
    delete process.env[ENV_VAR_NAME];

    // Always-blocked ranges ignore the billing flag entirely.
    expect(DataSourceEgressGuard.checkAddress("127.0.0.1").blocked).toBe(true);
    expect(DataSourceEgressGuard.checkAddress("169.254.169.254").blocked).toBe(
      true,
    );
  });
});
