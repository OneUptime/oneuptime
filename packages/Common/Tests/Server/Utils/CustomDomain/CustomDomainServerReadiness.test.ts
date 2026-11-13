import CustomDomainServerReadiness from "../../../../Server/Utils/CustomDomain/CustomDomainServerReadiness";
import { EncryptionSecret } from "../../../../Server/EnvironmentConfig";
import TokenSigningKey from "../../../../Server/Utils/TokenSigningKey";
import DnsLookup, {
  DnsLookupAnswer,
  DnsLookupFailure,
} from "../../../../Server/Utils/CustomDomain/DnsLookup";
import Domain from "../../../../Server/Types/Domain";
import CustomDomainServerReadinessJSON, {
  CustomDomainReadinessCheck,
  CustomDomainReadinessCheckId,
  CustomDomainReadinessOutcome,
  CustomDomainReadinessReason,
  CustomDomainReadinessWords,
  CustomDomainServerReadinessResult,
  describeReadinessCheck,
  describeReadinessCheckInEnglish,
} from "../../../../Types/CustomDomain/CustomDomainServerReadiness";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import crypto from "crypto";

/*
 * Whether a self-hosted server can serve a custom domain, checked before
 * anybody changes their DNS - three of the four open reports (#1521, #1692,
 * #1774) were servers that could not, found out only from "CNAME is not
 * verified". DNS, the request to the target and the connection to port 443
 * are stubbed: nothing here touches the network.
 */

type MockedFn = ReturnType<typeof jest.fn>;

interface Server {
  addresses: DnsLookupAnswer;
  // What a request to http://<target>/... answers: a status, or nothing.
  port80: number | "no answer";
  port443: boolean;
  letsEncryptKey: string;
}

let server: Server;
let probedUrls: Array<string>;
let connect: MockedFn;
let resolveAddresses: MockedFn;
const originalKey: string | undefined = process.env["LETS_ENCRYPT_ACCOUNT_KEY"];

const REQUEST: { target: string; variable: string; helmValue: string } = {
  target: "oneuptime.yourcompany.com",
  variable: "STATUS_PAGE_CNAME_RECORD",
  helmValue: "statusPage.cnameRecord",
};

function check(
  result: CustomDomainServerReadinessResult,
  id: CustomDomainReadinessCheckId,
): CustomDomainReadinessCheck | undefined {
  return result.checks.find((item: CustomDomainReadinessCheck) => {
    return item.id === id;
  });
}

beforeEach(() => {
  CustomDomainServerReadiness.clearCache();
  probedUrls = [];

  server = {
    addresses: { values: ["203.0.113.10"] },
    port80: 200,
    port443: true,
    letsEncryptKey: "a-key",
  };

  process.env["LETS_ENCRYPT_ACCOUNT_KEY"] = server.letsEncryptKey;

  resolveAddresses = jest
    .spyOn(DnsLookup, "resolveAddresses")
    .mockImplementation((async (): Promise<DnsLookupAnswer> => {
      return server.addresses;
    }) as never) as unknown as MockedFn;

  jest
    .spyOn(Domain, "getForDomainVerification")
    .mockImplementation((async (data: { url: string }) => {
      probedUrls.push(data.url);

      if (server.port80 === "no answer") {
        throw new Error("connect ECONNREFUSED");
      }

      const status: number = server.port80;

      return {
        statusCode: status,
        isSuccess: (): boolean => {
          return status === 200;
        },
        isFailure: (): boolean => {
          return status !== 200;
        },
      };
    }) as never);

  connect = jest
    .spyOn(CustomDomainServerReadiness, "canConnect")
    .mockImplementation((async (): Promise<boolean> => {
      return server.port443;
    }) as never) as unknown as MockedFn;
});

afterEach(() => {
  jest.restoreAllMocks();

  if (originalKey === undefined) {
    delete process.env["LETS_ENCRYPT_ACCOUNT_KEY"];
  } else {
    process.env["LETS_ENCRYPT_ACCOUNT_KEY"] = originalKey;
  }
});

describe("the readiness proof", () => {
  test("a proof this installation made is valid", () => {
    const proof: string = CustomDomainServerReadiness.createProof();

    expect(proof).toMatch(/^[0-9a-f]{32}\.[0-9a-f]{64}$/);
    expect(CustomDomainServerReadiness.isValidProof(proof)).toBe(true);
  });

  test("a forged, altered, or malformed proof is not", () => {
    const proof: string = CustomDomainServerReadiness.createProof();
    const [nonce, signature] = proof.split(".") as [string, string];
    const flipped: string =
      signature.substring(0, 63) + (signature.endsWith("0") ? "1" : "0");

    for (const forged of [
      `${nonce}.${flipped}`,
      `${"0".repeat(32)}.${signature}`,
      nonce,
      `${nonce}.`,
      `${nonce}.${signature}.extra`,
      "",
      undefined,
      "x".repeat(500),
      `${nonce.toUpperCase()}.${signature}`,
    ]) {
      expect([
        forged,
        CustomDomainServerReadiness.isValidProof(forged),
      ]).toEqual([forged, false]);
    }
  });

  test("a proof is signed with a key of its own: ENCRYPTION_SECRET, public while it is a shipped value, or the key every token shares, is refused", () => {
    // This process's ENCRYPTION_SECRET is unset: the shipped fallback.
    expect(TokenSigningKey.isEncryptionSecretUsed()).toBe(false);

    const nonce: string = "0123456789abcdef0123456789abcdef";
    const proofSignedWith: (key: string | Buffer) => string = (
      key: string | Buffer,
    ): string => {
      const signature: string = crypto
        .createHmac("sha256", key)
        .update(`custom-domain-readiness:${nonce}`)
        .digest("hex");

      return `${nonce}.${signature}`;
    };

    expect(
      CustomDomainServerReadiness.isValidProof(
        proofSignedWith(EncryptionSecret.toString()),
      ),
    ).toBe(false);
    expect(
      CustomDomainServerReadiness.isValidProof(
        proofSignedWith(TokenSigningKey.get()),
      ),
    ).toBe(false);

    // Control: the same nonce under the proof's own derived key is valid.
    expect(
      CustomDomainServerReadiness.isValidProof(
        proofSignedWith(
          TokenSigningKey.deriveKey("custom-domain-readiness-proof"),
        ),
      ),
    ).toBe(true);
  });

  test("a proof holds only under the signing key it was made with", () => {
    const proof: string = CustomDomainServerReadiness.createProof();

    // The installation loads a key of its own, as the server does at boot.
    TokenSigningKey.useInstallationKey(
      TokenSigningKey.generateInstallationKey(),
    );

    expect(CustomDomainServerReadiness.isValidProof(proof)).toBe(false);
    expect(
      CustomDomainServerReadiness.isValidProof(
        CustomDomainServerReadiness.createProof(),
      ),
    ).toBe(true);
  });
});

describe("the readiness check", () => {
  test("a ready server passes every check, and the request carries a valid proof", async () => {
    const result: CustomDomainServerReadinessResult =
      await CustomDomainServerReadiness.check(REQUEST);

    expect(
      result.checks.map((item: CustomDomainReadinessCheck) => {
        return [item.id, item.outcome];
      }),
    ).toEqual([
      [
        CustomDomainReadinessCheckId.TargetSet,
        CustomDomainReadinessOutcome.Pass,
      ],
      [
        CustomDomainReadinessCheckId.TargetResolves,
        CustomDomainReadinessOutcome.Pass,
      ],
      [CustomDomainReadinessCheckId.Port80, CustomDomainReadinessOutcome.Pass],
      [CustomDomainReadinessCheckId.Port443, CustomDomainReadinessOutcome.Pass],
      [
        CustomDomainReadinessCheckId.FreeCertificates,
        CustomDomainReadinessOutcome.Pass,
      ],
    ]);
    expect(CustomDomainServerReadinessJSON.isReady(result)).toBe(true);
    expect(CustomDomainServerReadinessJSON.needsAttention(result)).toBe(false);

    expect(probedUrls).toHaveLength(1);
    const url: string = probedUrls[0]!;
    expect(
      url.startsWith(
        `http://oneuptime.yourcompany.com${CustomDomainServerReadiness.PROOF_PATH}`,
      ),
    ).toBe(true);
    expect(
      CustomDomainServerReadiness.isValidProof(
        url.substring(url.lastIndexOf("/") + 1),
      ),
    ).toBe(true);
    expect(connect).toHaveBeenCalledWith("oneuptime.yourcompany.com", 443);
  });

  test("no target: custom domains are off, and it names the variable and the Helm value (#1774)", async () => {
    const result: CustomDomainServerReadinessResult =
      await CustomDomainServerReadiness.check({ ...REQUEST, target: "" });

    const targetSet: CustomDomainReadinessCheck = check(
      result,
      CustomDomainReadinessCheckId.TargetSet,
    )!;

    expect(targetSet.outcome).toBe(CustomDomainReadinessOutcome.Fail);
    expect(describeReadinessCheckInEnglish(targetSet)).toBe(
      "Custom domains are off: STATUS_PAGE_CNAME_RECORD is not set. Set it to a hostname that points to this server (statusPage.cnameRecord in the Helm chart's values), then restart OneUptime.",
    );
    // Nothing is looked up for a target that is not there.
    expect(resolveAddresses).not.toHaveBeenCalled();
    expect(probedUrls).toEqual([]);
    expect(CustomDomainServerReadinessJSON.isReady(result)).toBe(false);
  });

  test("a target that does not resolve says to add an A record, and probes no port", async () => {
    server.addresses = {
      values: [],
      failure: DnsLookupFailure.NameNotFound,
    };

    const result: CustomDomainServerReadinessResult =
      await CustomDomainServerReadiness.check(REQUEST);

    expect(
      check(result, CustomDomainReadinessCheckId.TargetResolves)?.outcome,
    ).toBe(CustomDomainReadinessOutcome.Fail);
    expect(check(result, CustomDomainReadinessCheckId.Port80)).toBeUndefined();
    expect(probedUrls).toEqual([]);
    expect(connect).not.toHaveBeenCalled();
  });

  test("a proxy that answers port 80 itself is not this server, and its status is named (#1521)", async () => {
    server.port80 = 404;

    const result: CustomDomainServerReadinessResult =
      await CustomDomainServerReadiness.check(REQUEST);

    const port80: CustomDomainReadinessCheck = check(
      result,
      CustomDomainReadinessCheckId.Port80,
    )!;

    expect(port80.outcome).toBe(CustomDomainReadinessOutcome.Fail);
    expect(port80.reason).toBe(CustomDomainReadinessReason.NotThisServer);
    expect(describeReadinessCheckInEnglish(port80)).toContain(
      "answers on port 80, but not as this OneUptime server (HTTP 404)",
    );
  });

  test("nothing on port 80, or on port 443, is said", async () => {
    server.port80 = "no answer";
    server.port443 = false;

    const result: CustomDomainServerReadinessResult =
      await CustomDomainServerReadiness.check(REQUEST);

    expect(check(result, CustomDomainReadinessCheckId.Port80)?.reason).toBe(
      CustomDomainReadinessReason.NoAnswer,
    );
    expect(
      describeReadinessCheckInEnglish(
        check(result, CustomDomainReadinessCheckId.Port80)!,
      ),
    ).toContain("does not answer on port 80");
    expect(check(result, CustomDomainReadinessCheckId.Port443)?.outcome).toBe(
      CustomDomainReadinessOutcome.Fail,
    );
  });

  test("without a Let's Encrypt key it warns, and is still ready", async () => {
    delete process.env["LETS_ENCRYPT_ACCOUNT_KEY"];

    const result: CustomDomainServerReadinessResult =
      await CustomDomainServerReadiness.check(REQUEST);

    const certificates: CustomDomainReadinessCheck = check(
      result,
      CustomDomainReadinessCheckId.FreeCertificates,
    )!;

    expect(certificates.outcome).toBe(CustomDomainReadinessOutcome.Warn);
    expect(describeReadinessCheckInEnglish(certificates)).toContain(
      "LETS_ENCRYPT_ACCOUNT_KEY is not set (letsEncrypt.accountKey in the Helm chart)",
    );
    expect(CustomDomainServerReadinessJSON.isReady(result)).toBe(true);
    expect(CustomDomainServerReadinessJSON.needsAttention(result)).toBe(true);
  });

  test("an answer is kept a few minutes per target, and can be asked afresh", async () => {
    await CustomDomainServerReadiness.check(REQUEST);
    await CustomDomainServerReadiness.check(REQUEST);

    expect(resolveAddresses).toHaveBeenCalledTimes(1);

    await CustomDomainServerReadiness.check(REQUEST, { useCache: false });
    expect(resolveAddresses).toHaveBeenCalledTimes(2);

    await CustomDomainServerReadiness.check({
      ...REQUEST,
      target: "dashboards.yourcompany.com",
      variable: "DASHBOARD_CNAME_RECORD",
    });
    expect(resolveAddresses).toHaveBeenCalledTimes(3);
  });
});

describe("the readiness answer", () => {
  test("survives the trip through JSON, and leaves out what it does not know", () => {
    const result: CustomDomainServerReadinessResult = {
      target: "oneuptime.yourcompany.com",
      checkedAt: new Date("2026-11-11T10:00:00.000Z"),
      checks: [
        {
          id: CustomDomainReadinessCheckId.Port80,
          outcome: CustomDomainReadinessOutcome.Fail,
          reason: CustomDomainReadinessReason.NotThisServer,
          values: { target: "oneuptime.yourcompany.com", status: "404" },
        },
      ],
    };

    expect(
      CustomDomainServerReadinessJSON.fromJSON(
        CustomDomainServerReadinessJSON.toJSON(result),
      ),
    ).toEqual(result);

    expect(
      CustomDomainServerReadinessJSON.fromJSON({
        target: 5,
        checks: [
          { id: "Port99", outcome: "Pass", values: {} },
          { id: "Port80", outcome: "Maybe", values: {} },
          {
            id: "Port443",
            outcome: "Pass",
            reason: "Because",
            values: { target: "t", count: 3 },
          },
          "junk",
        ],
      }),
    ).toEqual({
      target: "",
      checks: [
        {
          id: CustomDomainReadinessCheckId.Port443,
          outcome: CustomDomainReadinessOutcome.Pass,
          values: { target: "t" },
        },
      ],
    });
  });

  test("every check and outcome has its sentence, with nothing left unfilled", () => {
    const values: Record<string, string> = {
      target: "oneuptime.yourcompany.com",
      variable: "STATUS_PAGE_CNAME_RECORD",
      helmValue: "statusPage.cnameRecord",
      addresses: "203.0.113.10",
      status: "404",
    };

    const seen: Set<string> = new Set();

    for (const id of Object.values(CustomDomainReadinessCheckId)) {
      for (const outcome of Object.values(CustomDomainReadinessOutcome)) {
        for (const reason of [
          undefined,
          ...Object.values(CustomDomainReadinessReason),
        ]) {
          const described: { template: string } = describeReadinessCheck({
            id,
            outcome,
            reason,
            values,
          });

          seen.add(described.template);

          expect(
            describeReadinessCheckInEnglish({ id, outcome, reason, values }),
          ).not.toContain("{{");
        }
      }
    }

    // Every sentence but the notice's own title and footnote is reachable.
    const sentences: Array<string> = Object.entries(CustomDomainReadinessWords)
      .filter(([key]: [string, string]) => {
        return !["notReadyTitle", "warningTitle", "checkedFromServer"].includes(
          key,
        );
      })
      .map(([, template]: [string, string]) => {
        return template;
      });

    for (const template of sentences) {
      expect([template, seen.has(template)]).toEqual([template, true]);
    }
  });
});
