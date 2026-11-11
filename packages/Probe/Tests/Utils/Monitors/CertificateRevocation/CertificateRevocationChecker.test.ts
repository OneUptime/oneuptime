// Set required env vars before importing anything that pulls Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

import CertificateRevocationChecker, {
  CertificateRevocationCheckResult,
} from "../../../../Utils/Monitors/CertificateRevocation/CertificateRevocationChecker";
import RevocationHttpClient, {
  RevocationFetchError,
  RevocationFetchOptions,
} from "../../../../Utils/Monitors/CertificateRevocation/RevocationHttpClient";
import {
  CRL_URL,
  OCSP_URL,
  RevocationTestPki,
  cleanupRevocationTestPki,
  generateRevocationTestPki,
} from "./RevocationTestPki";
import CertificateRevocationCheckMethod from "Common/Types/Monitor/SSLMonitor/CertificateRevocationCheckMethod";
import CertificateRevocationStatus from "Common/Types/Monitor/SSLMonitor/CertificateRevocationStatus";

/*
 * The order the probe asks in - stapled OCSP, the OCSP responder, the CRL -
 * what it does when a source has no answer, and what it caches. The network
 * is replaced at RevocationHttpClient.fetch; the answers behind it come from
 * a real CA database, so the OCSP requests the probe builds are answered by
 * OpenSSL's own responder.
 */

type Handler = (options: RevocationFetchOptions) => Promise<Buffer>;

let pki: RevocationTestPki;
let fetchSpy: jest.SpiedFunction<typeof RevocationHttpClient.fetch>;

const unreachable: Handler = async (): Promise<Buffer> => {
  throw new RevocationFetchError("could not be reached (Cannot Find Host.)");
};

const ocspFromCa: Handler = async (
  options: RevocationFetchOptions,
): Promise<Buffer> => {
  return pki.answerOcspRequest(options.body as Buffer);
};

const crlFromCa: Handler = async (): Promise<Buffer> => {
  return pki.crlDer;
};

function serve(handlers: { ocsp?: Handler; crl?: Handler }): void {
  fetchSpy.mockImplementation(
    async (options: RevocationFetchOptions): Promise<Buffer> => {
      if (options.url === OCSP_URL) {
        return await (handlers.ocsp || unreachable)(options);
      }

      if (options.url === CRL_URL) {
        return await (handlers.crl || unreachable)(options);
      }

      throw new Error(`Unexpected URL ${options.url}`);
    },
  );
}

function fetchesOf(url: string): number {
  return fetchSpy.mock.calls.filter(
    (call: [RevocationFetchOptions]): boolean => {
      return call[0].url === url;
    },
  ).length;
}

async function check(
  certificate: Buffer,
  extra: { stapled?: Buffer; issuer?: Buffer; timeoutInMs?: number } = {},
): Promise<CertificateRevocationCheckResult> {
  return await CertificateRevocationChecker.check({
    certificate: certificate,
    issuer: extra.issuer || pki.intermediateDer,
    stapledOcspResponse: extra.stapled,
    timeoutInMs: extra.timeoutInMs,
  });
}

beforeAll(() => {
  pki = generateRevocationTestPki();
}, 60000);

afterAll(() => {
  cleanupRevocationTestPki(pki);
});

beforeEach(() => {
  CertificateRevocationChecker.clearCache();
  fetchSpy = jest.spyOn(RevocationHttpClient, "fetch");
  serve({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("stapled OCSP responses", () => {
  test("a stapled 'good' answer is used without asking anyone", async () => {
    const result: CertificateRevocationCheckResult = await check(
      pki.goodLeafDer,
      { stapled: pki.ocspResponse("good", "responder") },
    );

    expect(result).toEqual({
      status: CertificateRevocationStatus.NotRevoked,
      method: CertificateRevocationCheckMethod.StapledOcsp,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a stapled 'revoked' answer is a revocation, with its date and reason", async () => {
    const result: CertificateRevocationCheckResult = await check(
      pki.revokedLeafDer,
      { stapled: pki.ocspResponse("revoked", "issuer") },
    );

    expect(result.status).toBe(CertificateRevocationStatus.Revoked);
    expect(result.method).toBe(CertificateRevocationCheckMethod.StapledOcsp);
    expect(result.reason).toBe("Key Compromise");
    expect(result.revokedAt).toBeInstanceOf(Date);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a forged staple is ignored and the issuer's responder is asked instead", async () => {
    serve({ ocsp: ocspFromCa });

    const result: CertificateRevocationCheckResult = await check(
      pki.revokedLeafDer,
      // A server cannot vouch for itself with a response it signed.
      { stapled: pki.ocspResponse("good", "stranger") },
    );

    expect(result.status).toBe(CertificateRevocationStatus.Revoked);
    expect(result.method).toBe(CertificateRevocationCheckMethod.Ocsp);
  });
});

describe("the issuer's OCSP responder", () => {
  test("answers the request the probe builds", async () => {
    serve({ ocsp: ocspFromCa });

    const revoked: CertificateRevocationCheckResult = await check(
      pki.revokedLeafDer,
    );
    const good: CertificateRevocationCheckResult = await check(pki.goodLeafDer);

    expect(revoked.status).toBe(CertificateRevocationStatus.Revoked);
    expect(revoked.method).toBe(CertificateRevocationCheckMethod.Ocsp);
    expect(good.status).toBe(CertificateRevocationStatus.NotRevoked);
    expect(good.method).toBe(CertificateRevocationCheckMethod.Ocsp);
    expect(fetchesOf(CRL_URL)).toBe(0);
  });

  test("POSTs an OCSP request with the right content type and limits", async () => {
    serve({ ocsp: ocspFromCa });

    await check(pki.goodLeafDer);

    const options: RevocationFetchOptions = fetchSpy.mock.calls[0]![0];
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/ocsp-request");
    expect(options.maxRedirects).toBe(0);
    expect(options.maxResponseBytes).toBeLessThanOrEqual(64 * 1024);
  });

  test("an answer is cached: the next check of the same certificate asks no one", async () => {
    serve({ ocsp: ocspFromCa });

    await check(pki.revokedLeafDer);
    const second: CertificateRevocationCheckResult = await check(
      pki.revokedLeafDer,
    );

    expect(second.status).toBe(CertificateRevocationStatus.Revoked);
    expect(fetchesOf(OCSP_URL)).toBe(1);
  });

  test("checks running at once share one request", async () => {
    serve({ ocsp: ocspFromCa });

    const results: Array<CertificateRevocationCheckResult> = await Promise.all(
      [1, 2, 3, 4, 5].map(() => {
        return check(pki.goodLeafDer);
      }),
    );

    for (const result of results) {
      expect(result.status).toBe(CertificateRevocationStatus.NotRevoked);
    }
    expect(fetchesOf(OCSP_URL)).toBe(1);
  });

  test("'unknown' from the responder falls back to the CRL", async () => {
    serve({ ocsp: ocspFromCa, crl: crlFromCa });

    const result: CertificateRevocationCheckResult = await check(
      pki.unrecordedLeafDer,
    );

    expect(result.status).toBe(CertificateRevocationStatus.NotRevoked);
    expect(result.method).toBe(CertificateRevocationCheckMethod.Crl);
  });
});

describe("the issuer's CRL", () => {
  test("is asked when the OCSP responder cannot be reached", async () => {
    serve({ crl: crlFromCa });

    const revoked: CertificateRevocationCheckResult = await check(
      pki.revokedLeafDer,
    );
    const good: CertificateRevocationCheckResult = await check(pki.goodLeafDer);

    expect(revoked.status).toBe(CertificateRevocationStatus.Revoked);
    expect(revoked.method).toBe(CertificateRevocationCheckMethod.Crl);
    expect(revoked.reason).toBe("Key Compromise");
    expect(good.status).toBe(CertificateRevocationStatus.NotRevoked);
    expect(good.method).toBe(CertificateRevocationCheckMethod.Crl);
  });

  test("is downloaded once and shared by every certificate of the issuer", async () => {
    serve({ crl: crlFromCa });

    await check(pki.revokedLeafDer);
    await check(pki.goodLeafDer);
    await check(pki.unrecordedLeafDer);

    expect(fetchesOf(CRL_URL)).toBe(1);
  });

  test("a forged CRL is no answer", async () => {
    serve({
      crl: async (): Promise<Buffer> => {
        return pki.forgedCrlDer;
      },
    });

    const result: CertificateRevocationCheckResult = await check(
      pki.revokedLeafDer,
    );

    expect(result.status).toBe(CertificateRevocationStatus.Unknown);
    expect(result.error).toContain("not signed by the certificate's issuer");
  });
});

describe("no answer is not a revocation", () => {
  test("every source unreachable: Unknown, naming each source and why", async () => {
    const result: CertificateRevocationCheckResult = await check(
      pki.revokedLeafDer,
    );

    expect(result.status).toBe(CertificateRevocationStatus.Unknown);
    expect(result.error).toContain(`The OCSP responder at ${OCSP_URL}`);
    expect(result.error).toContain(`The CRL at ${CRL_URL}`);
    expect(result.error).toContain("could not be reached");
  });

  test("a failed lookup is remembered, so the next check does not wait for it again", async () => {
    await check(pki.goodLeafDer);
    await check(pki.goodLeafDer);

    expect(fetchesOf(OCSP_URL)).toBe(1);
    expect(fetchesOf(CRL_URL)).toBe(1);
  });

  test("a certificate that names no responder and no CRL", async () => {
    const result: CertificateRevocationCheckResult = await check(
      pki.bareLeafDer,
    );

    expect(result.status).toBe(CertificateRevocationStatus.Unknown);
    expect(result.error).toContain("names no OCSP responder");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("an issuer that did not sign the certificate", async () => {
    const result: CertificateRevocationCheckResult = await check(
      pki.goodLeafDer,
      { issuer: pki.strangerDer },
    );

    expect(result.status).toBe(CertificateRevocationStatus.Unknown);
    expect(result.error).toContain("did not sign it");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("bytes that are not a certificate", async () => {
    const result: CertificateRevocationCheckResult = await check(
      Buffer.from("garbage"),
    );

    expect(result.status).toBe(CertificateRevocationStatus.Unknown);
    expect(result.error).toContain("could not be read");
  });

  test("a slow responder: the check stops waiting, and the late answer is kept for the next check", async () => {
    let finishLookup: () => void = (): void => {};
    const responderAnswered: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        finishLookup = resolve;
      },
    );

    serve({
      ocsp: async (options: RevocationFetchOptions): Promise<Buffer> => {
        await responderAnswered;
        return pki.answerOcspRequest(options.body as Buffer);
      },
      crl: async (): Promise<Buffer> => {
        await responderAnswered;
        return pki.crlDer;
      },
    });

    const startedAt: number = Date.now();
    const first: CertificateRevocationCheckResult = await check(
      pki.revokedLeafDer,
      { timeoutInMs: 200 },
    );

    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(first.status).toBe(CertificateRevocationStatus.Unknown);
    expect(first.error).toContain("did not answer within");

    finishLookup();
    // Let the lookup that was left running settle and fill the cache.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 200);
    });

    const second: CertificateRevocationCheckResult = await check(
      pki.revokedLeafDer,
      { timeoutInMs: 200 },
    );

    expect(second.status).toBe(CertificateRevocationStatus.Revoked);
    expect(fetchesOf(OCSP_URL)).toBe(1);
  });
});

describe("CertificateRevocationChecker.describeRevocation", () => {
  test("says when, why and how it was found, the way TLS errors read", () => {
    expect(
      CertificateRevocationChecker.describeRevocation({
        status: CertificateRevocationStatus.Revoked,
        method: CertificateRevocationCheckMethod.StapledOcsp,
        revokedAt: new Date("2026-11-03T13:03:13.000Z"),
        reason: "Superseded",
      }),
    ).toBe(
      "certificate has been revoked by its issuer on 2026-11-03 13:03:13 UTC (reason: Superseded), according to the OCSP response the server sent. Browsers refuse a revoked certificate.",
    );

    expect(
      CertificateRevocationChecker.describeRevocation({
        status: CertificateRevocationStatus.Revoked,
        method: CertificateRevocationCheckMethod.Crl,
      }),
    ).toBe(
      "certificate has been revoked by its issuer, according to the issuer's certificate revocation list. Browsers refuse a revoked certificate.",
    );
  });

  test("never contains words that would make a check read as a timeout", () => {
    const text: string = CertificateRevocationChecker.describeRevocation({
      status: CertificateRevocationStatus.Revoked,
      method: CertificateRevocationCheckMethod.Ocsp,
      revokedAt: new Date(),
      reason: "Key Compromise",
    }).toLowerCase();

    expect(text).not.toContain("timeout");
    expect(text).not.toContain("exceeded");
  });
});
