// Set required env vars before importing anything that pulls Config.ts
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import ApiMonitor, {
  APIResponse,
} from "../../../../Utils/Monitors/MonitorTypes/ApiMonitor";
import URL from "Common/Types/API/URL";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { AddressInfo } from "net";
import * as https from "https";

interface CertSet {
  caCertPath: string;
  serverCertPath: string;
  serverKeyPath: string;
  clientCertPem: string;
  clientKeyPem: string;
  rogueClientCertPem: string;
  rogueClientKeyPem: string;
}

function generateCerts(workDir: string): CertSet {
  const opensslConfigPath: string = path.join(workDir, "openssl.cnf");
  fs.writeFileSync(
    opensslConfigPath,
    [
      "[req]",
      "distinguished_name = req_distinguished_name",
      "prompt = no",
      "[req_distinguished_name]",
      "CN = test",
      "[v3_server]",
      "subjectAltName = DNS:localhost,IP:127.0.0.1",
      "extendedKeyUsage = serverAuth",
      "[v3_client]",
      "extendedKeyUsage = clientAuth",
    ].join("\n"),
  );

  const openssl: (args: Array<string>) => void = (
    args: Array<string>,
  ): void => {
    execFileSync("openssl", args, { stdio: "pipe" });
  };

  const caKey: string = path.join(workDir, "ca.key");
  const caCert: string = path.join(workDir, "ca.crt");
  openssl(["genrsa", "-out", caKey, "2048"]);
  openssl([
    "req",
    "-x509",
    "-new",
    "-key",
    caKey,
    "-out",
    caCert,
    "-days",
    "1",
    "-subj",
    "/CN=oneuptime-test-ca",
  ]);

  const issueLeaf: (cn: string, ext: string) => { cert: string; key: string } =
    (cn: string, ext: string): { cert: string; key: string } => {
      const key: string = path.join(workDir, `${cn}.key`);
      const csr: string = path.join(workDir, `${cn}.csr`);
      const cert: string = path.join(workDir, `${cn}.crt`);
      openssl(["genrsa", "-out", key, "2048"]);
      openssl(["req", "-new", "-key", key, "-out", csr, "-subj", `/CN=${cn}`]);
      openssl([
        "x509",
        "-req",
        "-in",
        csr,
        "-CA",
        caCert,
        "-CAkey",
        caKey,
        "-CAcreateserial",
        "-out",
        cert,
        "-days",
        "1",
        "-extfile",
        opensslConfigPath,
        "-extensions",
        ext,
      ]);
      return { cert, key };
    };

  const server: { cert: string; key: string } = issueLeaf(
    "server",
    "v3_server",
  );
  const client: { cert: string; key: string } = issueLeaf(
    "client",
    "v3_client",
  );

  // A rogue client cert signed by a different (untrusted) CA
  const rogueCaKey: string = path.join(workDir, "rogueca.key");
  const rogueCaCert: string = path.join(workDir, "rogueca.crt");
  openssl(["genrsa", "-out", rogueCaKey, "2048"]);
  openssl([
    "req",
    "-x509",
    "-new",
    "-key",
    rogueCaKey,
    "-out",
    rogueCaCert,
    "-days",
    "1",
    "-subj",
    "/CN=rogue-ca",
  ]);
  const rogueKey: string = path.join(workDir, "rogueclient.key");
  const rogueCsr: string = path.join(workDir, "rogueclient.csr");
  const rogueCert: string = path.join(workDir, "rogueclient.crt");
  openssl(["genrsa", "-out", rogueKey, "2048"]);
  openssl([
    "req",
    "-new",
    "-key",
    rogueKey,
    "-out",
    rogueCsr,
    "-subj",
    "/CN=rogueclient",
  ]);
  openssl([
    "x509",
    "-req",
    "-in",
    rogueCsr,
    "-CA",
    rogueCaCert,
    "-CAkey",
    rogueCaKey,
    "-CAcreateserial",
    "-out",
    rogueCert,
    "-days",
    "1",
    "-extfile",
    opensslConfigPath,
    "-extensions",
    "v3_client",
  ]);

  return {
    caCertPath: caCert,
    serverCertPath: server.cert,
    serverKeyPath: server.key,
    clientCertPem: fs.readFileSync(client.cert, "utf8"),
    clientKeyPem: fs.readFileSync(client.key, "utf8"),
    rogueClientCertPem: fs.readFileSync(rogueCert, "utf8"),
    rogueClientKeyPem: fs.readFileSync(rogueKey, "utf8"),
  };
}

describe("ApiMonitor mTLS (client certificate)", () => {
  let workDir: string;
  let certs: CertSet;
  let server: https.Server;
  let serverUrl: URL;

  beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-mtls-"));
    certs = generateCerts(workDir);

    server = https.createServer(
      {
        key: fs.readFileSync(certs.serverKeyPath),
        cert: fs.readFileSync(certs.serverCertPath),
        ca: fs.readFileSync(certs.caCertPath),
        requestCert: true,
        rejectUnauthorized: true,
      },
      (req, res) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, path: req.url }));
      },
    );

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", () => {
        const addr: AddressInfo = server.address() as AddressInfo;
        serverUrl = URL.fromString(
          `https://127.0.0.1:${addr.port}/players/health`,
        );
        resolve();
      });
    });
  }, 30000);

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("succeeds when a valid client certificate + key are supplied", async () => {
    const response: APIResponse | null = await ApiMonitor.ping(serverUrl, {
      requestType: HTTPMethod.GET,
      retry: 0,
      isOnlineCheckRequest: true,
      allowSelfSignedCertificates: true,
      tlsClientCertificate: certs.clientCertPem,
      tlsClientKey: certs.clientKeyPem,
    });

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(true);
    expect(response!.statusCode).toBe(200);
    expect(response!.responseBody).toContain('"ok":true');
  }, 30000);

  it("fails when no client certificate is supplied", async () => {
    const response: APIResponse | null = await ApiMonitor.ping(serverUrl, {
      requestType: HTTPMethod.GET,
      retry: 0,
      isOnlineCheckRequest: true,
      allowSelfSignedCertificates: true,
    });

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
  }, 30000);

  it("fails when a client certificate from an untrusted CA is supplied", async () => {
    const response: APIResponse | null = await ApiMonitor.ping(serverUrl, {
      requestType: HTTPMethod.GET,
      retry: 0,
      isOnlineCheckRequest: true,
      allowSelfSignedCertificates: true,
      tlsClientCertificate: certs.rogueClientCertPem,
      tlsClientKey: certs.rogueClientKeyPem,
    });

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
  }, 30000);
});
