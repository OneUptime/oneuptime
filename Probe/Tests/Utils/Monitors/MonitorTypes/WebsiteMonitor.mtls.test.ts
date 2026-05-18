// Set required env vars before importing anything that pulls Config.ts
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import WebsiteMonitor, {
  ProbeWebsiteResponse,
} from "../../../../Utils/Monitors/MonitorTypes/WebsiteMonitor";
import URL from "Common/Types/API/URL";
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

  return {
    caCertPath: caCert,
    serverCertPath: server.cert,
    serverKeyPath: server.key,
    clientCertPem: fs.readFileSync(client.cert, "utf8"),
    clientKeyPem: fs.readFileSync(client.key, "utf8"),
  };
}

describe("WebsiteMonitor mTLS (client certificate)", () => {
  let workDir: string;
  let certs: CertSet;
  let server: https.Server;
  let serverUrl: URL;

  beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-mtls-web-"));
    certs = generateCerts(workDir);

    server = https.createServer(
      {
        key: fs.readFileSync(certs.serverKeyPath),
        cert: fs.readFileSync(certs.serverCertPath),
        ca: fs.readFileSync(certs.caCertPath),
        requestCert: true,
        rejectUnauthorized: true,
      },
      (_req, res) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html");
        res.end("<html><body>OK</body></html>");
      },
    );

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", () => {
        const addr: AddressInfo = server.address() as AddressInfo;
        serverUrl = URL.fromString(`https://127.0.0.1:${addr.port}/`);
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
    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      serverUrl,
      {
        retry: 0,
        isOnlineCheckRequest: true,
        allowSelfSignedCertificates: true,
        tlsClientCertificate: certs.clientCertPem,
        tlsClientKey: certs.clientKeyPem,
      },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(true);
    expect(response!.statusCode).toBe(200);
  }, 30000);

  it("fails when no client certificate is supplied", async () => {
    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      serverUrl,
      {
        retry: 0,
        isOnlineCheckRequest: true,
        allowSelfSignedCertificates: true,
      },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
  }, 30000);
});
