import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import StorageArrayCollectionErrorCode from "Common/Types/StorageArray/Collection/StorageArrayCollectionErrorCode";
import {
  StorageArrayCollectionReport,
  StorageArrayConnectionTestReport,
} from "Common/Types/StorageArray/Collection/StorageArrayProbeCollection";
import http from "http";
import net from "net";
import { PowerMaxPoller } from "../../../../../Utils/StorageArray/Dell/PowerMax/PowerMaxPoller";
import {
  DEFAULT_STORAGE_ARRAY_POLLER_DEPENDENCIES,
  StorageArrayPollerDependencies,
} from "../../../../../Utils/StorageArray/StorageArrayTransport";
import {
  TestCertificate,
  makeSelfSignedCertificate,
} from "../../../VMware/Helpers/TestCertificates";
import FakeUnisphere from "./Helpers/FakeUnisphere";
import {
  NOW_MS,
  PASSWORD,
  collectionJob,
  makeUnisphere,
  testJob,
} from "./Helpers/PowerMaxScenario";

/*
 * The poller over the probe's real transport (#11004), to a Unisphere on
 * HTTPS with a certificate it signed itself - as Unisphere for PowerMax's
 * is unless someone replaced it. The password is sent only after the
 * certificate passed: publicly trusted for the host, or exactly the one a
 * person trusted. Otherwise the test names the certificate, so it can be
 * checked and trusted in one click, and nothing at all reaches the server.
 *
 * The address resolves to 127.0.0.1 here (in production, a loopback
 * address is refused: SSRFProtection), and the socket is pinned to it.
 */

const HOST: string = "unisphere.test";

const unisphereCertificate: TestCertificate = makeSelfSignedCertificate(
  HOST,
  `DNS:${HOST},IP:127.0.0.1`,
);
const otherCertificate: TestCertificate =
  makeSelfSignedCertificate("other.test");

let unisphere: FakeUnisphere;
let port: number;

function dependencies(): StorageArrayPollerDependencies {
  return {
    ...DEFAULT_STORAGE_ARRAY_POLLER_DEPENDENCIES,
    resolve: async (): Promise<Array<string>> => {
      return ["127.0.0.1"];
    },
    now: (): Date => {
      return new Date(NOW_MS);
    },
  };
}

function reader(): PowerMaxPoller {
  return new PowerMaxPoller({ dependencies: dependencies() });
}

beforeAll(async () => {
  unisphere = makeUnisphere();
  port = await unisphere.listen(unisphereCertificate);
});

afterAll(async () => {
  await unisphere.close();
});

describe("PowerMaxPoller over HTTPS", () => {
  test("a self-signed certificate nobody trusted: named, fingerprinted, and nothing sent", async () => {
    const before: number = unisphere.requests.length;
    const report: StorageArrayConnectionTestReport = await reader().test(
      testJob({ address: `https://${HOST}:${port}` }),
    );

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(
      StorageArrayCollectionErrorCode.UntrustedCertificate,
    );
    expect(report.presentedCertificate).toMatchObject({
      fingerprint256: unisphereCertificate.fingerprint256,
      isSelfSigned: true,
    });
    expect(report.presentedCertificate!.subject).toContain(HOST);
    expect(report.errorMessage).toContain(unisphereCertificate.fingerprint256);
    expect(report.errorMessage).toContain("Unisphere's certificate");
    expect(report.errorMessage).not.toContain("vCenter");
    expect(report.errorMessage).not.toContain(PASSWORD);
    // Not one request reached the server.
    expect(unisphere.requests.length).toBe(before);
  });

  test("once trusted, the test logs in and reads the arrays", async () => {
    const report: StorageArrayConnectionTestReport = await reader().test(
      testJob({
        address: `https://${HOST}:${port}`,
        trustedCertificateFingerprint: unisphereCertificate.fingerprint256,
      }),
    );

    expect(report.status).toBe("Succeeded");
    expect(report.summary!.arrays).toHaveLength(3);
    // Over the wire, as Unisphere reads it.
    expect(
      unisphere.requests[unisphere.requests.length - 1]!.authorization,
    ).toMatch(/^Basic /);
  });

  test("a trusted fingerprint is matched however it is written", async () => {
    const report: StorageArrayConnectionTestReport = await reader().test(
      testJob({
        address: `https://${HOST}:${port}`,
        trustedCertificateFingerprint: unisphereCertificate.fingerprint256
          .replace(/:/g, "")
          .toLowerCase(),
      }),
    );
    expect(report.status).toBe("Succeeded");
  });

  test("and the collection reads every local array over the same connection", async () => {
    const report: StorageArrayCollectionReport = await reader().collect(
      collectionJob({
        address: `https://${HOST}:${port}`,
        trustedCertificateFingerprint: unisphereCertificate.fingerprint256,
      }),
    );

    expect(report.status).toBe("Succeeded");
    expect(report.resourceMetrics).toHaveLength(2);
  });

  test("a certificate other than the one trusted: changed, and nothing sent", async () => {
    const before: number = unisphere.requests.length;
    const report: StorageArrayConnectionTestReport = await reader().test(
      testJob({
        address: `https://${HOST}:${port}`,
        trustedCertificateFingerprint: otherCertificate.fingerprint256,
      }),
    );

    expect(report.errorCode).toBe(
      StorageArrayCollectionErrorCode.CertificateChanged,
    );
    expect(report.presentedCertificate!.fingerprint256).toBe(
      unisphereCertificate.fingerprint256,
    );
    expect(report.errorMessage).toContain(
      "If Unisphere's certificate was renewed",
    );
    expect(unisphere.requests.length).toBe(before);
  });

  test("nothing listening: refused", async () => {
    const closed: net.Server = net.createServer();
    const closedPort: number = await new Promise<number>(
      (resolve: (value: number) => void) => {
        closed.listen(0, "127.0.0.1", () => {
          resolve((closed.address() as net.AddressInfo).port);
        });
      },
    );
    await new Promise<void>((resolve: () => void) => {
      closed.close(() => {
        resolve();
      });
    });

    const report: StorageArrayConnectionTestReport = await reader().test(
      testJob({ address: `https://${HOST}:${closedPort}` }),
    );

    expect(report.errorCode).toBe(
      StorageArrayCollectionErrorCode.ConnectionRefused,
    );
    expect(report.errorMessage).toBe(
      `${HOST}:${closedPort} refused the connection: nothing listens on port ${closedPort} there. Check the port Unisphere serves its REST API on.`,
    );
  });

  test("a port that speaks plain HTTP: the secure connection fails", async () => {
    const plain: http.Server = http.createServer(
      (_request: http.IncomingMessage, response: http.ServerResponse) => {
        response.end("hello");
      },
    );
    const plainPort: number = await new Promise<number>(
      (resolve: (value: number) => void) => {
        plain.listen(0, "127.0.0.1", () => {
          resolve((plain.address() as net.AddressInfo).port);
        });
      },
    );

    try {
      const report: StorageArrayConnectionTestReport = await reader().test(
        testJob({ address: `https://${HOST}:${plainPort}` }),
      );

      expect(report.status).toBe("Failed");
      expect([
        StorageArrayCollectionErrorCode.TlsFailed,
        StorageArrayCollectionErrorCode.ConnectionFailed,
      ]).toContain(report.errorCode);
    } finally {
      await new Promise<void>((resolve: () => void) => {
        plain.close(() => {
          resolve();
        });
      });
    }
  });
});
