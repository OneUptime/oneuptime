import { execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * Self-signed certificates for the XCP-ng TLS tests, made fresh with
 * openssl in a temporary directory so no key is checked in - as Xen
 * Orchestra's and each XCP-ng host's own are: no authority the probe trusts
 * signed them. Xen Orchestra's own one names no address at all (no
 * subjectAltName), which is why #10995's agent could not pin it: leave
 * `subjectAltName` out to make one like it.
 */

export interface TestCertificate {
  key: string;
  cert: string;
  // SHA-256 of the DER certificate, "AB:CD:..." as Node writes it.
  fingerprint256: string;
}

export function makeTestCertificate(
  commonName: string,
  subjectAltName?: string | undefined,
): TestCertificate {
  const directory: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "xcp-ng-tls-test-"),
  );

  try {
    const keyPath: string = path.join(directory, "key.pem");
    const certPath: string = path.join(directory, "cert.pem");

    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "2",
        "-subj",
        `/O=Test XCP-ng/CN=${commonName}`,
        ...(subjectAltName ? ["-addext", `subjectAltName=${subjectAltName}`] : []),
      ],
      { stdio: "ignore" },
    );

    const cert: string = fs.readFileSync(certPath, "utf8");
    const x509: crypto.X509Certificate = new crypto.X509Certificate(cert);

    return {
      key: fs.readFileSync(keyPath, "utf8"),
      cert: cert,
      fingerprint256: x509.fingerprint256,
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
