import { afterEach, describe, expect, jest, test } from "@jest/globals";
import dns from "dns";
import { SpyInstance } from "jest-mock";
import ProbeDnsLookup from "../../../Utils/Monitors/ProbeDnsLookup";

/*
 * The lookup Port and SSL checks resolve with. Node's net.connect asks with
 * dns.ADDRCONFIG, which makes glibc drop AAAA answers on a probe that has no
 * global IPv6 address, so an IPv6-only name failed as ENOTFOUND. This one
 * drops that hint and nothing else.
 */

interface LookupAnswer {
  error: NodeJS.ErrnoException | null;
  address: string | Array<dns.LookupAddress>;
  family?: number | undefined;
}

// dns.lookup is overloaded; only the calls are read back.
type LookupSpy = SpyInstance<(...args: Array<unknown>) => void>;

const lookup: (
  hostname: string,
  options: dns.LookupOptions,
) => Promise<LookupAnswer> = (
  hostname: string,
  options: dns.LookupOptions,
): Promise<LookupAnswer> => {
  return new Promise((resolve: (answer: LookupAnswer) => void) => {
    ProbeDnsLookup.lookupWithoutAddrConfig(
      hostname,
      options,
      (
        error: NodeJS.ErrnoException | null,
        address: string | Array<dns.LookupAddress>,
        family?: number,
      ) => {
        resolve({ error, address, family });
      },
    );
  });
};

const spyOnLookup: () => LookupSpy = (): LookupSpy => {
  return jest.spyOn(dns, "lookup").mockImplementation(((
    _hostname: string,
    _options: dns.LookupOptions,
    callback: (
      error: NodeJS.ErrnoException | null,
      addresses: Array<dns.LookupAddress>,
    ) => void,
  ): void => {
    setImmediate(() => {
      callback(null, [{ address: "2001:db8::64", family: 6 }]);
    });
  }) as never) as unknown as LookupSpy;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProbeDnsLookup.lookupWithoutAddrConfig", () => {
  test("drops dns.ADDRCONFIG from what net.connect asks for, and keeps the rest", async () => {
    const lookupSpy: LookupSpy = spyOnLookup();

    const answer: LookupAnswer = await lookup("v6only.example", {
      all: true,
      family: 0,
      hints: dns.ADDRCONFIG,
    });

    expect(lookupSpy).toHaveBeenCalledTimes(1);
    expect(lookupSpy.mock.calls[0]![0]).toBe("v6only.example");
    expect(lookupSpy.mock.calls[0]![1]).toEqual({
      all: true,
      family: 0,
      hints: 0,
    });
    expect(answer).toEqual({
      error: null,
      address: [{ address: "2001:db8::64", family: 6 }],
      family: undefined,
    });
  });

  test("other hints survive", async () => {
    const lookupSpy: LookupSpy = spyOnLookup();

    await lookup("v6only.example", {
      all: true,
      hints: dns.ADDRCONFIG | dns.V4MAPPED,
    });

    expect(lookupSpy.mock.calls[0]![1]).toEqual({
      all: true,
      hints: dns.V4MAPPED,
    });
  });

  test("no hints at all is passed as none", async () => {
    const lookupSpy: LookupSpy = spyOnLookup();

    await lookup("v6only.example", { all: true });

    expect(lookupSpy.mock.calls[0]![1]).toEqual({ all: true, hints: 0 });
  });

  test("it answers asynchronously, as tls.connect needs", async () => {
    /*
     * A literal never reaches getaddrinfo, so this is the real dns.lookup
     * with no network involved.
     */
    let hasAnswered: boolean = false;

    const answered: Promise<LookupAnswer> = new Promise(
      (resolve: (answer: LookupAnswer) => void) => {
        ProbeDnsLookup.lookupWithoutAddrConfig(
          "::1",
          { all: true, hints: dns.ADDRCONFIG },
          (
            error: NodeJS.ErrnoException | null,
            address: string | Array<dns.LookupAddress>,
          ) => {
            hasAnswered = true;
            resolve({ error, address });
          },
        );
      },
    );

    expect(hasAnswered).toBe(false);

    await expect(answered).resolves.toEqual({
      error: null,
      address: [{ address: "::1", family: 6 }],
    });
  });
});
