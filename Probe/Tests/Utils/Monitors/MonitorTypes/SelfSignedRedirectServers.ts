import SelfSignedCertificate from "./SslTestCertificates";
import { execFileSync } from "child_process";
import * as fs from "fs";
import http, { IncomingMessage, ServerResponse } from "http";
import https from "https";
import { AddressInfo } from "net";
import * as os from "os";
import * as path from "path";
import { PeerCertificate, TLSSocket } from "tls";

/*
 * Two local servers for the "Allow self-signed certificates" redirect suites:
 *
 * - an HTTP server whose /to-https/<path> answers 302 to the HTTPS server on
 *   the same host (127.0.0.1, so only the scheme and port change), and whose
 *   /to-localhost/<path> answers 302 to the same HTTPS server under a
 *   different hostname (localhost);
 * - an HTTPS server with a self-signed certificate that asks for, but does
 *   not require, a client certificate and records which one it was shown.
 *   Its /to-http/<path> answers 302 back to the HTTP server's /to-https/<path>,
 *   and /same-origin-redirect answers 302 to /final.
 *
 * The suites stub the egress guard to pin every hop to 127.0.0.1, so both
 * hostnames reach these servers through the production agent path.
 */

export const CLIENT_CERTIFICATE_CN: string = "oneuptime-monitor-client";
export const CLIENT_KEY_PASSPHRASE: string = "monitor-client-key-passphrase";
export const FINAL_BODY_MARKER: string = "self-signed-redirect-final";

export interface HttpsHit {
  path: string;
  // Subject CN of the client certificate the monitor presented, if any.
  clientCertificateCN: string | undefined;
}

export interface SelfSignedRedirectServers {
  httpOrigin: string;
  httpsOrigin: string;
  httpsHits: Array<HttpsHit>;
  clientCertificate: string;
  // PEM, encrypted with CLIENT_KEY_PASSPHRASE.
  clientKey: string;
  close: () => Promise<void>;
}

function generateClientIdentity(): { certificate: string; key: string } {
  const workDir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-redirect-client-"),
  );

  try {
    const keyPath: string = path.join(workDir, "client.key");
    const certificatePath: string = path.join(workDir, "client.crt");

    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-keyout",
        keyPath,
        "-out",
        certificatePath,
        "-days",
        "2",
        "-subj",
        `/CN=${CLIENT_CERTIFICATE_CN}`,
        "-passout",
        `pass:${CLIENT_KEY_PASSPHRASE}`,
      ],
      { stdio: "pipe" },
    );

    return {
      certificate: fs.readFileSync(certificatePath, "utf8"),
      key: fs.readFileSync(keyPath, "utf8"),
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function listen(server: http.Server | https.Server): Promise<number> {
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return (server.address() as AddressInfo).port;
}

async function close(server: http.Server | https.Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
}

function redirect(response: ServerResponse, location: string): void {
  response.statusCode = 302;
  response.setHeader("Location", location);
  response.end();
}

export async function startSelfSignedRedirectServers(): Promise<SelfSignedRedirectServers> {
  const clientIdentity: { certificate: string; key: string } =
    generateClientIdentity();
  const httpsHits: Array<HttpsHit> = [];

  let httpPort: number = 0;
  let httpsPort: number = 0;

  const httpServer: http.Server = http.createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      const requestPath: string = request.url || "/";

      if (requestPath.startsWith("/to-https/")) {
        redirect(
          response,
          `https://127.0.0.1:${httpsPort}/${requestPath.slice("/to-https/".length)}`,
        );
        return;
      }

      if (requestPath.startsWith("/to-localhost/")) {
        redirect(
          response,
          `https://localhost:${httpsPort}/${requestPath.slice("/to-localhost/".length)}`,
        );
        return;
      }

      response.statusCode = 404;
      response.end();
    },
  );

  const httpsServer: https.Server = https.createServer(
    {
      key: SelfSignedCertificate.key,
      cert: SelfSignedCertificate.cert,
      requestCert: true,
      rejectUnauthorized: false,
    },
    (request: IncomingMessage, response: ServerResponse) => {
      const requestPath: string = request.url || "/";
      const peerCertificate: PeerCertificate = (
        request.socket as TLSSocket
      ).getPeerCertificate();

      // An empty object when the client presented no certificate.
      const commonName: string | Array<string> | undefined =
        peerCertificate?.subject?.CN;
      httpsHits.push({
        path: requestPath,
        clientCertificateCN: commonName ? String(commonName) : undefined,
      });

      if (requestPath.startsWith("/to-http/")) {
        redirect(
          response,
          `http://127.0.0.1:${httpPort}/to-https/${requestPath.slice("/to-http/".length)}`,
        );
        return;
      }

      if (requestPath === "/same-origin-redirect") {
        redirect(response, "/final");
        return;
      }

      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: FINAL_BODY_MARKER }));
    },
  );

  httpPort = await listen(httpServer);
  httpsPort = await listen(httpsServer);

  return {
    httpOrigin: `http://127.0.0.1:${httpPort}`,
    httpsOrigin: `https://127.0.0.1:${httpsPort}`,
    httpsHits: httpsHits,
    clientCertificate: clientIdentity.certificate,
    clientKey: clientIdentity.key,
    close: async (): Promise<void> => {
      await Promise.all([close(httpServer), close(httpsServer)]);
    },
  };
}
