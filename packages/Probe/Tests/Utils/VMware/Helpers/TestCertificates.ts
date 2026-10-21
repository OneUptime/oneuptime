import { execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * Self-signed certificates made with openssl for the TLS tests - like the
 * certificate vCenter's own VMCA issues, no authority the probe trusts has
 * signed them. Made fresh in a temporary directory, so no key is checked in.
 */

export interface TestCertificate {
  key: string;
  cert: string;
  // SHA-256 of the DER certificate, "AB:CD:..." as Node writes it.
  fingerprint256: string;
}

export function makeSelfSignedCertificate(
  commonName: string,
  subjectAltName: string = "DNS:localhost,IP:127.0.0.1",
): TestCertificate {
  const directory: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "vmware-tls-test-"),
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
        `/O=Test VMCA/CN=${commonName}`,
        "-addext",
        `subjectAltName=${subjectAltName}`,
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
