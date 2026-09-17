import DataSourceEgressGuard, {
  EgressLookupFunction,
  EgressResolveFunction,
  PinnedAgents,
  ResolvedAddress,
} from "../../../../Server/Utils/DataSource/EgressGuard";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * The egress guard is only half a control on its own: validating an address
 * and then letting the socket re-resolve the hostname leaves a DNS-rebind
 * window, and a redirect walks around the check entirely. These tests pin the
 * two pieces that close the first half — the pinned lookup handed to an
 * http.Agent, and the guarded lookup handed to libraries that build their own
 * URLs — plus the message labelling that lets one guard serve several
 * subsystems.
 *
 * DNS is injected everywhere, so nothing here touches the network.
 */

type ResolverFor = (addresses: Array<ResolvedAddress>) => EgressResolveFunction;

const resolverFor: ResolverFor = (
  addresses: Array<ResolvedAddress>,
): EgressResolveFunction => {
  return (): Promise<Array<ResolvedAddress>> => {
    return Promise.resolve(addresses);
  };
};

interface LookupResult {
  error: NodeJS.ErrnoException | null;
  address: string | Array<{ address: string; family: number }>;
  family?: number | undefined;
}

type CallLookup = (
  lookup: EgressLookupFunction,
  hostname: string,
  options: { all?: boolean | undefined; family?: number | undefined },
) => Promise<LookupResult>;

const callLookup: CallLookup = (
  lookup: EgressLookupFunction,
  hostname: string,
  options: { all?: boolean | undefined; family?: number | undefined },
): Promise<LookupResult> => {
  return new Promise((resolve: (value: LookupResult) => void) => {
    lookup(
      hostname,
      options,
      (
        error: NodeJS.ErrnoException | null,
        address: string | Array<{ address: string; family: number }>,
        family?: number,
      ) => {
        resolve({ error, address, family });
      },
    );
  });
};

describe("DataSourceEgressGuard.createPinnedLookup", () => {
  const addresses: Array<ResolvedAddress> = [
    { address: "93.184.216.34", family: 4 },
    { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
  ];

  test("answers with every validated address when all is set", async () => {
    const lookup: EgressLookupFunction =
      DataSourceEgressGuard.createPinnedLookup(addresses);

    const result: LookupResult = await callLookup(lookup, "anything.example", {
      all: true,
    });

    expect(result.error).toBeNull();
    expect(result.address).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
  });

  test("answers with the first validated address when all is not set", async () => {
    const lookup: EgressLookupFunction =
      DataSourceEgressGuard.createPinnedLookup(addresses);

    const result: LookupResult = await callLookup(lookup, "anything.example", {
      all: false,
    });

    expect(result.error).toBeNull();
    expect(result.address).toBe("93.184.216.34");
    expect(result.family).toBe(4);
  });

  test("ignores the hostname it is asked about — the pin is the point", async () => {
    /*
     * This is the anti-rebind property: once validated, the socket dials the
     * checked address no matter what DNS would say a millisecond later.
     */
    const lookup: EgressLookupFunction =
      DataSourceEgressGuard.createPinnedLookup([
        { address: "93.184.216.34", family: 4 },
      ]);

    const result: LookupResult = await callLookup(
      lookup,
      "rebind.attacker.example",
      { all: false },
    );

    expect(result.address).toBe("93.184.216.34");
  });
});

describe("DataSourceEgressGuard.createPinnedAgents", () => {
  test("builds http and https agents that both carry the pinned lookup", async () => {
    const agents: PinnedAgents = DataSourceEgressGuard.createPinnedAgents([
      { address: "93.184.216.34", family: 4 },
    ]);

    const httpLookup: EgressLookupFunction = (
      agents.httpAgent as unknown as {
        options: { lookup: EgressLookupFunction };
      }
    ).options.lookup;
    const httpsLookup: EgressLookupFunction = (
      agents.httpsAgent as unknown as {
        options: { lookup: EgressLookupFunction };
      }
    ).options.lookup;

    expect(typeof httpLookup).toBe("function");
    expect(typeof httpsLookup).toBe("function");

    await expect(
      callLookup(httpLookup, "example.com", { all: false }),
    ).resolves.toMatchObject({ address: "93.184.216.34" });
    await expect(
      callLookup(httpsLookup, "example.com", { all: false }),
    ).resolves.toMatchObject({ address: "93.184.216.34" });
  });
});

describe("DataSourceEgressGuard.assertUrlAllowedAndPin", () => {
  test("returns agents pinned to the validated address", async () => {
    const result: { addresses: Array<ResolvedAddress> } & PinnedAgents =
      await DataSourceEgressGuard.assertUrlAllowedAndPin(
        "https://provider.example.com/v1",
        {
          blockPrivateAddresses: true,
          resolveFunction: resolverFor([
            { address: "93.184.216.34", family: 4 },
          ]),
        },
      );

    expect(result.addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
    expect(result.httpAgent).toBeDefined();
    expect(result.httpsAgent).toBeDefined();
  });

  test("rejects the metadata endpoint before any agent is built", async () => {
    await expect(
      DataSourceEgressGuard.assertUrlAllowedAndPin(
        "http://169.254.169.254/latest/meta-data/",
        { blockPrivateAddresses: true },
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("rejects a hostname that resolves to loopback", async () => {
    await expect(
      DataSourceEgressGuard.assertUrlAllowedAndPin("https://rebind.example/", {
        blockPrivateAddresses: true,
        resolveFunction: resolverFor([{ address: "127.0.0.1", family: 4 }]),
      }),
    ).rejects.toThrow(BadDataException);
  });
});

describe("DataSourceEgressGuard.createGuardedLookup", () => {
  test("passes through the validated addresses for an allowed host", async () => {
    const lookup: EgressLookupFunction =
      DataSourceEgressGuard.createGuardedLookup({
        blockPrivateAddresses: true,
        resolveFunction: resolverFor([{ address: "93.184.216.34", family: 4 }]),
      });

    const result: LookupResult = await callLookup(lookup, "idp.example.com", {
      all: false,
    });

    expect(result.error).toBeNull();
    expect(result.address).toBe("93.184.216.34");
    expect(result.family).toBe(4);
  });

  test("errors instead of connecting when the host resolves to link-local", async () => {
    /*
     * This is the property that makes the OIDC fix work: openid-client picks
     * the endpoint URLs out of a document the tenant controls, so the block
     * has to happen at connect time, for whatever host it decided on.
     */
    const lookup: EgressLookupFunction =
      DataSourceEgressGuard.createGuardedLookup({
        blockPrivateAddresses: true,
        resolveFunction: resolverFor([
          { address: "169.254.169.254", family: 4 },
        ]),
      });

    const result: LookupResult = await callLookup(
      lookup,
      "token-endpoint.attacker.example",
      { all: false },
    );

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(result.error?.message).toContain("link-local");
  });

  test("errors for a literal loopback host", async () => {
    const lookup: EgressLookupFunction =
      DataSourceEgressGuard.createGuardedLookup({
        blockPrivateAddresses: true,
      });

    const result: LookupResult = await callLookup(lookup, "127.0.0.1", {
      all: false,
    });

    expect(result.error).toBeInstanceOf(BadDataException);
  });

  test("filters to the requested address family", async () => {
    const lookup: EgressLookupFunction =
      DataSourceEgressGuard.createGuardedLookup({
        blockPrivateAddresses: true,
        resolveFunction: resolverFor([
          { address: "93.184.216.34", family: 4 },
          { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
        ]),
      });

    const result: LookupResult = await callLookup(lookup, "idp.example.com", {
      all: false,
      family: 6,
    });

    expect(result.error).toBeNull();
    expect(result.address).toBe("2606:2800:220:1:248:1893:25c8:1946");
    expect(result.family).toBe(6);
  });

  test("reports ENOTFOUND when no address matches the requested family", async () => {
    const lookup: EgressLookupFunction =
      DataSourceEgressGuard.createGuardedLookup({
        blockPrivateAddresses: true,
        resolveFunction: resolverFor([{ address: "93.184.216.34", family: 4 }]),
      });

    const result: LookupResult = await callLookup(lookup, "idp.example.com", {
      all: false,
      family: 6,
    });

    expect(result.error?.code).toBe("ENOTFOUND");
  });

  test("a mixed answer is refused outright — one bad record poisons the set", async () => {
    const lookup: EgressLookupFunction =
      DataSourceEgressGuard.createGuardedLookup({
        blockPrivateAddresses: true,
        resolveFunction: resolverFor([
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.5", family: 4 },
        ]),
      });

    const result: LookupResult = await callLookup(lookup, "idp.example.com", {
      all: true,
    });

    expect(result.error).toBeInstanceOf(BadDataException);
  });
});

describe("DataSourceEgressGuard error labelling", () => {
  test("defaults to the data source wording", async () => {
    await expect(
      DataSourceEgressGuard.assertHostnameAllowed("127.0.0.1", {
        blockPrivateAddresses: true,
      }),
    ).rejects.toThrow("Data source host 127.0.0.1 is not allowed");
  });

  test("names the subsystem when one is given", async () => {
    await expect(
      DataSourceEgressGuard.assertHostnameAllowed("127.0.0.1", {
        blockPrivateAddresses: true,
        targetLabel: "LLM provider",
      }),
    ).rejects.toThrow("LLM provider host 127.0.0.1 is not allowed");
  });

  test("names the subsystem for a resolved-address rejection too", async () => {
    await expect(
      DataSourceEgressGuard.assertHostnameAllowed("ollama.attacker.example", {
        blockPrivateAddresses: true,
        targetLabel: "LLM provider",
        resolveFunction: resolverFor([
          { address: "169.254.169.254", family: 4 },
        ]),
      }),
    ).rejects.toThrow(
      "LLM provider host ollama.attacker.example resolves to 169.254.169.254",
    );
  });

  test("names the subsystem for a bad scheme", async () => {
    await expect(
      DataSourceEgressGuard.assertUrlAllowed("file:///etc/passwd", {
        targetLabel: "OAuth token URL",
      }),
    ).rejects.toThrow("OAuth token URL URL must use http or https");
  });
});
