import CustomDomainDnsCheck, {
  CnameCheckRequest,
} from "../../../../Server/Utils/CustomDomain/CustomDomainDnsCheck";
import DnsLookup, {
  DnsLookupAnswer,
  DnsLookupFailure,
} from "../../../../Server/Utils/CustomDomain/DnsLookup";
import Domain from "../../../../Server/Types/Domain";
import {
  DnsRecordCheck,
  DnsRecordCheckOutcome,
  DnsRecordType,
} from "../../../../Types/CustomDomain/DnsRecordCheck";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The CNAME and TXT checks behind a custom domain's records, with DNS and
 * the HTTP request to the domain stubbed: nothing here touches the network.
 *
 * The CNAME check is what status page, dashboard and form domains share. It
 * used to compare the FIRST CNAME record, with its trailing dot, to the
 * installation's target, and say only "not verified" (#1521, #1664). Now it
 * follows the chain, ignores case and the trailing dot, says what it found,
 * and tells a name whose DNS provider hides the CNAME (an address instead)
 * from a name with no record at all.
 */

type MockedFn = ReturnType<typeof jest.fn>;

// The world the checks see: DNS by name, and what each URL answers.
interface World {
  cname: Map<string, DnsLookupAnswer>;
  addresses: Map<string, DnsLookupAnswer>;
  txt: Map<string, DnsLookupAnswer>;
  // By protocol: a status code, or "no answer" (a timeout, a refusal).
  http: { http: number | "no answer"; https: number | "no answer" };
}

let world: World;
let resolveCname: MockedFn;
let resolveAddresses: MockedFn;
let getForDomainVerification: MockedFn;

const noRecords: DnsLookupAnswer = {
  values: [],
  failure: DnsLookupFailure.NoRecords,
  errorCode: "ENODATA",
};

function answers(...values: Array<string>): DnsLookupAnswer {
  return { values };
}

function request(extra?: Partial<CnameCheckRequest>): CnameCheckRequest {
  return {
    fullDomain: "status.example.com",
    expectedTarget: "statuspage.oneuptime.com",
    getVerificationUrl: (protocol: "http" | "https"): string => {
      return `${protocol}://status.example.com/status-page-api/cname-verification/token`;
    },
    targetLabel: "Status page domain",
    ...extra,
  };
}

beforeEach(() => {
  world = {
    cname: new Map(),
    addresses: new Map(),
    txt: new Map(),
    http: { http: "no answer", https: "no answer" },
  };

  resolveCname = jest
    .spyOn(DnsLookup, "resolveCname")
    .mockImplementation((async (name: string): Promise<DnsLookupAnswer> => {
      return world.cname.get(name) || noRecords;
    }) as never) as unknown as MockedFn;

  resolveAddresses = jest
    .spyOn(DnsLookup, "resolveAddresses")
    .mockImplementation((async (name: string): Promise<DnsLookupAnswer> => {
      return world.addresses.get(name) || noRecords;
    }) as never) as unknown as MockedFn;

  jest.spyOn(DnsLookup, "resolveTxt").mockImplementation((async (
    name: string,
  ): Promise<DnsLookupAnswer> => {
    return world.txt.get(name) || noRecords;
  }) as never);

  getForDomainVerification = jest
    .spyOn(Domain, "getForDomainVerification")
    .mockImplementation((async (data: { url: string }) => {
      const protocol: "http" | "https" = data.url.startsWith("https://")
        ? "https"
        : "http";
      const answer: number | "no answer" = world.http[protocol];

      if (answer === "no answer") {
        throw new Error("connect ETIMEDOUT");
      }

      return {
        statusCode: answer,
        isSuccess: (): boolean => {
          return answer >= 200 && answer < 300;
        },
        isFailure: (): boolean => {
          return !(answer >= 200 && answer < 300);
        },
      };
    }) as never) as unknown as MockedFn;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the CNAME check", () => {
  test("a domain whose request reaches OneUptime is found, without a DNS lookup (the sweeps)", async () => {
    world.http.http = 200;

    const check: DnsRecordCheck =
      await CustomDomainDnsCheck.checkCname(request());

    expect(check.outcome).toBe(DnsRecordCheckOutcome.Found);
    expect(check.reachedOneUptime).toBe(true);
    expect(check.type).toBe(DnsRecordType.CNAME);
    expect(resolveCname).not.toHaveBeenCalled();
    // http answered: https was never asked.
    expect(getForDomainVerification).toHaveBeenCalledTimes(1);
  });

  test("Check now looks the record up even then, to say what it is", async () => {
    world.http.http = 200;
    world.cname.set("status.example.com", answers("statuspage.oneuptime.com"));

    const check: DnsRecordCheck = await CustomDomainDnsCheck.checkCname(
      request({ lookUpDnsEvenWhenReached: true }),
    );

    expect(check.outcome).toBe(DnsRecordCheckOutcome.Found);
    expect(check.foundValues).toEqual(["statuspage.oneuptime.com"]);
  });

  test("https is tried when http does not reach OneUptime", async () => {
    world.http.http = 301;
    world.http.https = 200;

    const check: DnsRecordCheck =
      await CustomDomainDnsCheck.checkCname(request());

    expect(check.outcome).toBe(DnsRecordCheckOutcome.Found);
    expect(getForDomainVerification).toHaveBeenCalledTimes(2);
  });

  test("a record typed with the root's trailing dot and in capitals is the target", async () => {
    world.cname.set("status.example.com", answers("StatusPage.OneUptime.com."));

    const check: DnsRecordCheck = await CustomDomainDnsCheck.checkCname(
      request({ expectedTarget: "statuspage.oneuptime.com." }),
    );

    expect(check.outcome).toBe(DnsRecordCheckOutcome.Found);
    expect(check.expectedValue).toBe("statuspage.oneuptime.com");
    expect(check.foundValues).toEqual(["statuspage.oneuptime.com"]);
  });

  test("a chain through a name of the customer's own reaches the target (#1664)", async () => {
    world.cname.set("status.example.com", answers("status-alias.example.com"));
    world.cname.set(
      "status-alias.example.com",
      answers("statuspage.oneuptime.com"),
    );

    const check: DnsRecordCheck =
      await CustomDomainDnsCheck.checkCname(request());

    expect(check.outcome).toBe(DnsRecordCheckOutcome.Found);
    expect(check.foundValues).toEqual([
      "status-alias.example.com",
      "statuspage.oneuptime.com",
    ]);
  });

  test("a record that points elsewhere is a wrong value, with the whole chain found", async () => {
    world.cname.set("status.example.com", answers("other.example.net"));
    world.cname.set("other.example.net", answers("lb.example.net"));

    const check: DnsRecordCheck =
      await CustomDomainDnsCheck.checkCname(request());

    expect(check.outcome).toBe(DnsRecordCheckOutcome.WrongValue);
    expect(check.foundValues).toEqual(["other.example.net", "lb.example.net"]);
  });

  test("a chain that loops stops, and is a wrong value", async () => {
    world.cname.set("status.example.com", answers("a.example.com"));
    world.cname.set("a.example.com", answers("b.example.com"));
    world.cname.set("b.example.com", answers("a.example.com"));

    const check: DnsRecordCheck =
      await CustomDomainDnsCheck.checkCname(request());

    expect(check.outcome).toBe(DnsRecordCheckOutcome.WrongValue);
    expect(check.foundValues).toEqual(["a.example.com", "b.example.com"]);
  });

  test("a chain is followed at most MAX_CNAME_HOPS hops", async () => {
    for (let hop: number = 0; hop < 20; hop++) {
      world.cname.set(
        hop === 0 ? "status.example.com" : `hop${hop}.example.com`,
        answers(`hop${hop + 1}.example.com`),
      );
    }

    const check: DnsRecordCheck =
      await CustomDomainDnsCheck.checkCname(request());

    expect(check.foundValues).toHaveLength(CustomDomainDnsCheck.MAX_CNAME_HOPS);
    expect(resolveCname).toHaveBeenCalledTimes(
      CustomDomainDnsCheck.MAX_CNAME_HOPS,
    );
  });

  test("no CNAME, but addresses: not found, with the addresses (a proxied or flattened name)", async () => {
    world.addresses.set(
      "status.example.com",
      answers("104.21.3.4", "172.67.1.2", "2606:4700::1", "2606:4700::2", "x"),
    );

    const check: DnsRecordCheck =
      await CustomDomainDnsCheck.checkCname(request());

    expect(check.outcome).toBe(DnsRecordCheckOutcome.NotFound);
    expect(check.addresses).toEqual([
      "104.21.3.4",
      "172.67.1.2",
      "2606:4700::1",
      "2606:4700::2",
    ]);
  });

  test("no CNAME and no address: not found, with nothing more", async () => {
    const check: DnsRecordCheck =
      await CustomDomainDnsCheck.checkCname(request());

    expect(check.outcome).toBe(DnsRecordCheckOutcome.NotFound);
    expect(check.addresses).toBeUndefined();
    expect(check.foundValues).toEqual([]);
  });

  test("a name that does not exist is said so", async () => {
    world.cname.set("status.example.com", {
      values: [],
      failure: DnsLookupFailure.NameNotFound,
      errorCode: "ENOTFOUND",
    });

    const check: DnsRecordCheck =
      await CustomDomainDnsCheck.checkCname(request());

    expect(check.outcome).toBe(DnsRecordCheckOutcome.NameNotFound);
    expect(resolveAddresses).not.toHaveBeenCalled();
  });

  test("a DNS server that does not answer is a failed lookup, with its code", async () => {
    world.cname.set("status.example.com", {
      values: [],
      failure: DnsLookupFailure.NoAnswer,
      errorCode: "ETIMEOUT",
    });

    const check: DnsRecordCheck =
      await CustomDomainDnsCheck.checkCname(request());

    expect(check.outcome).toBe(DnsRecordCheckOutcome.LookupFailed);
    expect(check.lookupError).toBe("ETIMEOUT");
  });

  test("a right record whose request a proxy answers is found, and says what answered (#1521)", async () => {
    world.http.http = 404;
    world.cname.set("status.example.com", answers("statuspage.oneuptime.com"));

    const check: DnsRecordCheck =
      await CustomDomainDnsCheck.checkCname(request());

    expect(check.outcome).toBe(DnsRecordCheckOutcome.Found);
    expect(check.reachedOneUptime).toBe(false);
    expect(check.httpStatus).toBe(404);
  });

  test("the first status that is not OneUptime's is kept: http's before https's", async () => {
    world.http.http = 404;
    world.http.https = 502;

    const check: DnsRecordCheck =
      await CustomDomainDnsCheck.checkCname(request());

    expect(check.httpStatus).toBe(404);
  });

  test("without a target only a request that reached OneUptime counts, and DNS is not asked", async () => {
    world.cname.set("status.example.com", answers("anything.example.net"));

    expect(
      (await CustomDomainDnsCheck.checkCname(request({ expectedTarget: "" })))
        .outcome,
    ).toBe(DnsRecordCheckOutcome.NotFound);
    expect(resolveCname).not.toHaveBeenCalled();

    world.http.https = 200;

    expect(
      (await CustomDomainDnsCheck.checkCname(request({ expectedTarget: "" })))
        .outcome,
    ).toBe(DnsRecordCheckOutcome.Found);
  });

  test("says when it looked", async () => {
    const before: number = Date.now();
    const check: DnsRecordCheck =
      await CustomDomainDnsCheck.checkCname(request());

    expect(check.checkedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  test("an unchecked domain is a check with nothing found", () => {
    expect(
      CustomDomainDnsCheck.unchecked({
        fullDomain: "Status.Example.com.",
        expectedTarget: "statuspage.oneuptime.com",
        outcome: DnsRecordCheckOutcome.LookupFailed,
      }),
    ).toEqual(
      expect.objectContaining({
        type: DnsRecordType.CNAME,
        name: "status.example.com",
        foundValues: [],
        outcome: DnsRecordCheckOutcome.LookupFailed,
      }),
    );
  });
});

describe("the TXT check", () => {
  test("found among other TXT records, by its exact value", async () => {
    world.txt.set(
      "example.com",
      answers("v=spf1 -all", " oneuptime-verification-abc "),
    );

    const check: DnsRecordCheck = await CustomDomainDnsCheck.checkTxt({
      domain: "Example.com.",
      expectedValue: "oneuptime-verification-abc",
    });

    expect(check.type).toBe(DnsRecordType.TXT);
    expect(check.name).toBe("example.com");
    expect(check.outcome).toBe(DnsRecordCheckOutcome.Found);
  });

  test("other TXT records only: a wrong value, with what was found", async () => {
    world.txt.set(
      "example.com",
      answers("v=spf1 -all", "oneuptime-verification-OTHER"),
    );

    const check: DnsRecordCheck = await CustomDomainDnsCheck.checkTxt({
      domain: "example.com",
      expectedValue: "oneuptime-verification-abc",
    });

    expect(check.outcome).toBe(DnsRecordCheckOutcome.WrongValue);
    expect(check.foundValues).toEqual([
      "v=spf1 -all",
      "oneuptime-verification-OTHER",
    ]);
  });

  test("no TXT record, no such name, no answer", async () => {
    expect(
      (
        await CustomDomainDnsCheck.checkTxt({
          domain: "example.com",
          expectedValue: "x",
        })
      ).outcome,
    ).toBe(DnsRecordCheckOutcome.NotFound);

    world.txt.set("nope.example", {
      values: [],
      failure: DnsLookupFailure.NameNotFound,
    });

    expect(
      (
        await CustomDomainDnsCheck.checkTxt({
          domain: "nope.example",
          expectedValue: "x",
        })
      ).outcome,
    ).toBe(DnsRecordCheckOutcome.NameNotFound);

    world.txt.set("slow.example", {
      values: [],
      failure: DnsLookupFailure.NoAnswer,
      errorCode: "ESERVFAIL",
    });

    const slow: DnsRecordCheck = await CustomDomainDnsCheck.checkTxt({
      domain: "slow.example",
      expectedValue: "x",
    });

    expect(slow.outcome).toBe(DnsRecordCheckOutcome.LookupFailed);
    expect(slow.lookupError).toBe("ESERVFAIL");
  });
});
