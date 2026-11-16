/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import {
  BackupHttpResponse,
  BackupHttpTransport,
  createGuardedBackupTransport,
  readResponseText,
} from "../../../Server/Backup/Storage/BackupHttp";
import BackupSettingsUtil from "Common/Server/Utils/Backup/BackupSettings";
import EgressGuardException from "Common/Types/Exception/EgressGuardException";
import {
  LocalHttpServer,
  PROXY_HOST_NAME,
  approveOnLoopback,
  clearOutboundProxyEnvironmentForEachTest,
  useLocalHttpServers,
} from "Common/Tests/Server/TestingUtils/OutboundProxyFixture";
import { startEachTestOnSelfHostedEgressPolicy } from "Common/Tests/Server/Utils/EgressPolicyEnvironment";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import dns from "dns";
import http from "http";

jest.mock("Common/Server/Utils/Logger");

/*
 * BACKUPS BEHIND AN OUTBOUND PROXY (issue #8932).
 *
 * The backup storage clients (Amazon S3, S3-compatible storage, Google Cloud
 * Storage, Azure Blob Storage) send with Node's own http client, which reads
 * no proxy setting, so on a server that reaches the internet only through a
 * proxy no backup could be sent. The transport now takes the egress guard's
 * agents for each request (createGuardedAgentsForNodeHttp): through the
 * proxy set in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY, as every axios request
 * of the server goes, apart from the hosts NO_PROXY names - a MinIO on the
 * operator's own network, say - which are dialled directly, at the address
 * the guard approved. Through a proxy the storage's host is checked first,
 * so the proxy never carries a backup to an address the policy refuses.
 */

clearOutboundProxyEnvironmentForEachTest();
startEachTestOnSelfHostedEgressPolicy();

const serve: (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> = useLocalHttpServers();

afterEach(() => {
  jest.restoreAllMocks();
});

// What the guard's DNS answers: these names at a public address, nothing else.
function resolvePublicly(hostnames: Array<string>): void {
  jest.spyOn(dns.promises, "lookup").mockImplementation((async (
    name: string,
  ) => {
    if (!hostnames.includes(name)) {
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${name}`), {
        code: "ENOTFOUND",
      });
    }

    return [{ address: "93.184.216.34", family: 4 }];
  }) as never);
}

function transport(): BackupHttpTransport {
  return createGuardedBackupTransport(
    BackupSettingsUtil.getEgressOptions("Backup destination"),
  );
}

async function failureOf(sending: Promise<unknown>): Promise<Error> {
  try {
    await sending;
  } catch (error) {
    return error as Error;
  }

  throw new Error("The request succeeded.");
}

describe("the backup transport, behind an outbound proxy", () => {
  test("over http, a part of a backup goes to a proxy named by host name, whole", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    resolvePublicly(["minio.example.test"]);
    proxy.handler = (
      _request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      response.writeHead(200, { ETag: '"part-1"' });
      response.end("stored");
    };

    const part: Buffer = Buffer.alloc(64 * 1024, 7);
    const response: BackupHttpResponse = await transport()({
      method: "PUT",
      url: "http://minio.example.test:9000/backups/prod/part-1?uploadId=u1",
      headers: { "Content-Type": "application/octet-stream" },
      body: part,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["etag"]).toBe('"part-1"');
    expect(await readResponseText(response)).toBe("stored");
    expect(proxy.requests).toEqual([
      {
        method: "PUT",
        url: "http://minio.example.test:9000/backups/prod/part-1?uploadId=u1",
        host: "minio.example.test:9000",
        body: part.toString(),
      },
    ]);
  });

  test("over https, the proxy is asked to tunnel to the storage by name", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTPS_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    resolvePublicly(["acme-backups.s3.eu-west-1.amazonaws.com"]);

    // The proxy refuses every tunnel here; where it was asked to is the point.
    await failureOf(
      transport()({
        method: "GET",
        url: "https://acme-backups.s3.eu-west-1.amazonaws.com/?list-type=2",
        headers: {},
      }),
    );

    expect(proxy.connects).toEqual([
      "acme-backups.s3.eu-west-1.amazonaws.com:443",
    ]);
    expect(proxy.requests).toEqual([]);
  });

  test("a storage host that resolves somewhere refused is never asked of the proxy", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([
        { address: "169.254.169.254", family: 4 },
      ] as unknown as never);

    const error: Error = await failureOf(
      transport()({
        method: "GET",
        url: "http://storage.example.test/latest/meta-data/",
        headers: {},
      }),
    );

    expect(error).toBeInstanceOf(EgressGuardException);
    expect(proxy.isUntouched).toBe(true);
  });

  test("a storage in NO_PROXY is dialled directly, at the address the guard approved", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const minio: LocalHttpServer = await serve({ name: "minio" });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${proxy.port}`;
    process.env["NO_PROXY"] = ".internal.test";
    // The name resolves nowhere real: only the guard's answer reaches it.
    approveOnLoopback({ "minio.internal.test": [minio.host] });

    const response: BackupHttpResponse = await transport()({
      method: "GET",
      url: `http://minio.internal.test:${minio.port}/backups/?list-type=2`,
      headers: {},
    });
    await readResponseText(response);

    expect(
      minio.requests.map((request: { url: string }) => {
        return request.url;
      }),
    ).toEqual(["/backups/?list-type=2"]);
    expect(proxy.isUntouched).toBe(true);
  });

  test("with no proxy, the storage is dialled at the address the guard approved", async () => {
    const minio: LocalHttpServer = await serve({ name: "minio" });
    approveOnLoopback({ "minio.internal.test": [minio.host] });

    const response: BackupHttpResponse = await transport()({
      method: "HEAD",
      url: `http://minio.internal.test:${minio.port}/backups/manifest.json`,
      headers: {},
    });
    await readResponseText(response);

    expect(response.statusCode).toBe(200);
    expect(minio.requests).toHaveLength(1);
  });

  test("with no proxy, a storage address the policy refuses is refused before a socket opens", async () => {
    const error: Error = await failureOf(
      transport()({
        method: "GET",
        url: "http://169.254.169.254/latest/meta-data/",
        headers: {},
      }),
    );

    expect(error).toBeInstanceOf(EgressGuardException);
    expect(error.message).toContain("Backup destination host 169.254.169.254");
  });
});
