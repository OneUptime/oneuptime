import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The DNS lookups behind the custom domain checks, with Node's resolver
 * replaced: what each lookup answers, what a resolver's error means, and
 * that every lookup is bounded - a DNS server that drops packets must not
 * hold Check now past the proxy in front of it (#1692).
 */

interface ResolverCall {
  method: string;
  name: string;
}

const mockCalls: Array<ResolverCall> = [];
const mockOptions: Array<unknown> = [];
let mockAnswers: Record<string, (name: string) => Promise<unknown>> = {};

jest.mock("dns", () => {
  class FakeResolver {
    public constructor(options: unknown) {
      mockOptions.push(options);
    }
  }

  // One resolver method, answering from mockAnswers as it stands at the call.
  const fakeMethod: (method: string) => (name: string) => Promise<unknown> = (
    method: string,
  ): ((name: string) => Promise<unknown>) => {
    return async (name: string): Promise<unknown> => {
      mockCalls.push({ method, name });
      const answer: ((name: string) => Promise<unknown>) | undefined =
        mockAnswers[method];

      if (!answer) {
        const error: Error & { code?: string } = new Error(
          `query${method} ENODATA ${name}`,
        );
        error.code = "ENODATA";
        throw error;
      }

      return await answer(name);
    };
  };

  for (const method of ["resolveCname", "resolveTxt", "resolve4", "resolve6"]) {
    (FakeResolver.prototype as unknown as Record<string, unknown>)[method] =
      fakeMethod(method);
  }

  const dns: Record<string, unknown> = {
    promises: { Resolver: FakeResolver },
  };

  return { __esModule: true, default: dns, ...dns };
});

import DnsLookup, {
  DnsLookupAnswer,
  DnsLookupFailure,
} from "../../../../Server/Utils/CustomDomain/DnsLookup";

function failWith(code: string): () => Promise<never> {
  return async (): Promise<never> => {
    const error: Error & { code?: string } = new Error(code);
    error.code = code;
    throw error;
  };
}

beforeEach(() => {
  mockCalls.length = 0;
  mockOptions.length = 0;
  mockAnswers = {};
});

describe("DnsLookup", () => {
  test("every lookup is bounded: a short timeout and one retry", async () => {
    await DnsLookup.resolveCname("status.example.com");

    expect(mockOptions).toEqual([
      { timeout: DnsLookup.TIMEOUT_IN_MS, tries: DnsLookup.TRIES },
    ]);
    expect(DnsLookup.TIMEOUT_IN_MS * DnsLookup.TRIES).toBeLessThanOrEqual(
      10000,
    );
  });

  test("a CNAME answers its target", async () => {
    mockAnswers["resolveCname"] = async (): Promise<Array<string>> => {
      return ["statuspage.oneuptime.com"];
    };

    expect(await DnsLookup.resolveCname("status.example.com")).toEqual({
      values: ["statuspage.oneuptime.com"],
    });
    expect(mockCalls).toEqual([
      { method: "resolveCname", name: "status.example.com" },
    ]);
  });

  test("TXT values are joined the way DNS splits them into strings", async () => {
    mockAnswers["resolveTxt"] = async (): Promise<Array<Array<string>>> => {
      return [["oneuptime-verification-", "abc"], ["v=spf1 -all"]];
    };

    expect(await DnsLookup.resolveTxt("example.com")).toEqual({
      values: ["oneuptime-verification-abc", "v=spf1 -all"],
    });
  });

  test("an empty answer is no records", async () => {
    mockAnswers["resolveTxt"] = async (): Promise<Array<Array<string>>> => {
      return [];
    };

    expect(await DnsLookup.resolveTxt("example.com")).toEqual({
      values: [],
      failure: DnsLookupFailure.NoRecords,
    });
  });

  test("what each resolver error means", async () => {
    const cases: Array<[string, DnsLookupFailure]> = [
      ["ENODATA", DnsLookupFailure.NoRecords],
      ["ENOTFOUND", DnsLookupFailure.NameNotFound],
      ["ETIMEOUT", DnsLookupFailure.NoAnswer],
      ["ESERVFAIL", DnsLookupFailure.NoAnswer],
      ["EREFUSED", DnsLookupFailure.NoAnswer],
      ["ECONNREFUSED", DnsLookupFailure.NoAnswer],
    ];

    for (const [code, failure] of cases) {
      mockAnswers["resolveCname"] = failWith(code);

      const answer: DnsLookupAnswer =
        await DnsLookup.resolveCname("status.example.com");

      expect([code, answer]).toEqual([
        code,
        { values: [], failure, errorCode: code },
      ]);
    }
  });

  test("an error with no code is no answer, never a crash", () => {
    expect(DnsLookup.toFailedAnswer(new Error("boom"))).toEqual({
      values: [],
      failure: DnsLookupFailure.NoAnswer,
      errorCode: "EUNKNOWN",
    });
    expect(DnsLookup.toFailedAnswer(undefined).failure).toBe(
      DnsLookupFailure.NoAnswer,
    );
  });

  test("addresses are the IPv4 and the IPv6 ones together", async () => {
    mockAnswers["resolve4"] = async (): Promise<Array<string>> => {
      return ["203.0.113.10"];
    };
    mockAnswers["resolve6"] = async (): Promise<Array<string>> => {
      return ["2001:db8::1"];
    };

    expect(await DnsLookup.resolveAddresses("status.example.com")).toEqual({
      values: ["203.0.113.10", "2001:db8::1"],
    });
  });

  test("no address: the A lookup says why", async () => {
    mockAnswers["resolve4"] = failWith("ENOTFOUND");

    const answer: DnsLookupAnswer = await DnsLookup.resolveAddresses(
      "missing.example.com",
    );

    expect(answer.values).toEqual([]);
    expect(answer.failure).toBe(DnsLookupFailure.NameNotFound);
  });
});
