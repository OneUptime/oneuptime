import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/*
 * Certificate fixtures for the SSL Certificate Monitor suites.
 *
 * These are generated with openssl at test time rather than checked in as
 * PEM blobs, for the same reason WebsiteMonitor.mtls.test.ts does it: a
 * checked-in "currently valid" certificate silently becomes an expired one,
 * and the suite would start failing on a date rather than on a regression.
 *
 * Every distinct TLS failure mode the probe must tell apart gets its own
 * fixture, because the defect being guarded against is precisely that they
 * were all collapsed into "self signed".
 */
export interface SslCertificateFixtures {
  workDir: string;

  // A CA the tests can hand to Node as a trusted root.
  caCertPem: string;

  // Signed by the CA above, SAN covers localhost/127.0.0.1, unexpired.
  validCert: string;
  validKey: string;

  // Signed by the CA, but SAN names a host we will never connect to.
  wrongHostCert: string;
  wrongHostKey: string;

  /*
   * Signed by the CA, already past its notAfter.
   *
   * Backdating needs `openssl x509 -not_before/-not_after`, which only
   * exists from OpenSSL 3.4. On older toolchains these are null and the one
   * test that needs them skips itself rather than failing the suite - the
   * expiry LOGIC is covered without a live server in
   * Common/Tests/Server/Utils/Monitor/Criteria/SSLMonitorCriteria.test.ts,
   * which builds expiry dates synthetically.
   */
  expiredCert: string | null;
  expiredKey: string | null;

  // Its own issuer - a true DEPTH_ZERO_SELF_SIGNED_CERT.
  selfSignedCert: string;
  selfSignedKey: string;
}

function openssl(args: Array<string>): void {
  execFileSync("openssl", args, { stdio: "pipe" });
}

export function generateSslCertificateFixtures(): SslCertificateFixtures {
  const workDir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-ssl-monitor-test-"),
  );

  const configPath: string = path.join(workDir, "openssl.cnf");
  fs.writeFileSync(
    configPath,
    [
      "[req]",
      "distinguished_name = req_distinguished_name",
      "prompt = no",
      "[req_distinguished_name]",
      "CN = test",
      "[v3_local]",
      "subjectAltName = DNS:localhost,IP:127.0.0.1",
      "extendedKeyUsage = serverAuth",
      "[v3_elsewhere]",
      "subjectAltName = DNS:not-the-host-we-dial.example",
      "extendedKeyUsage = serverAuth",
    ].join("\n"),
  );

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
    "2",
    "-subj",
    "/CN=oneuptime-ssl-monitor-test-ca",
  ]);

  type Leaf = { cert: string; key: string };

  const issueLeaf: (data: {
    name: string;
    extension: string;
    notBeforeDays?: number;
    days: number;
  }) => Leaf = (data: {
    name: string;
    extension: string;
    notBeforeDays?: number;
    days: number;
  }): Leaf => {
    const key: string = path.join(workDir, `${data.name}.key`);
    const csr: string = path.join(workDir, `${data.name}.csr`);
    const cert: string = path.join(workDir, `${data.name}.crt`);

    openssl(["genrsa", "-out", key, "2048"]);
    openssl([
      "req",
      "-new",
      "-key",
      key,
      "-out",
      csr,
      "-subj",
      `/CN=${data.name}.oneuptime-test`,
    ]);

    const args: Array<string> = [
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
      "-extfile",
      configPath,
      "-extensions",
      data.extension,
    ];

    /*
     * An already-expired certificate is produced by backdating both ends of
     * the validity window with -not_before / -not_after, which is the only
     * way to get one without waiting.
     */
    if (data.notBeforeDays !== undefined) {
      const notBefore: Date = new Date(
        Date.now() - data.notBeforeDays * 24 * 60 * 60 * 1000,
      );
      const notAfter: Date = new Date(
        Date.now() - (data.notBeforeDays - data.days) * 24 * 60 * 60 * 1000,
      );

      args.push(
        "-not_before",
        formatOpensslDate(notBefore),
        "-not_after",
        formatOpensslDate(notAfter),
      );
    } else {
      args.push("-days", String(data.days));
    }

    openssl(args);

    return { cert, key };
  };

  const valid: Leaf = issueLeaf({
    name: "valid",
    extension: "v3_local",
    days: 2,
  });

  const wrongHost: Leaf = issueLeaf({
    name: "wronghost",
    extension: "v3_elsewhere",
    days: 2,
  });

  /*
   * Best effort: older OpenSSL has no way to issue an already-expired
   * certificate without waiting for time to pass.
   */
  let expired: Leaf | null = null;

  try {
    expired = issueLeaf({
      name: "expired",
      extension: "v3_local",
      notBeforeDays: 10,
      days: 5,
    });
  } catch {
    expired = null;
  }

  // Self-signed: no CA involved at all, so the leaf is its own issuer.
  const selfSignedKey: string = path.join(workDir, "selfsigned.key");
  const selfSignedCert: string = path.join(workDir, "selfsigned.crt");
  openssl(["genrsa", "-out", selfSignedKey, "2048"]);
  /*
   * `req -x509` takes its extensions from -config/-extensions; -extfile is
   * an `x509` option only and this command rejects it.
   */
  openssl([
    "req",
    "-x509",
    "-new",
    "-key",
    selfSignedKey,
    "-out",
    selfSignedCert,
    "-days",
    "2",
    "-subj",
    "/CN=selfsigned.oneuptime-test",
    "-config",
    configPath,
    "-extensions",
    "v3_local",
  ]);

  return {
    workDir,
    caCertPem: fs.readFileSync(caCert, "utf8"),
    validCert: fs.readFileSync(valid.cert, "utf8"),
    validKey: fs.readFileSync(valid.key, "utf8"),
    wrongHostCert: fs.readFileSync(wrongHost.cert, "utf8"),
    wrongHostKey: fs.readFileSync(wrongHost.key, "utf8"),
    expiredCert: expired ? fs.readFileSync(expired.cert, "utf8") : null,
    expiredKey: expired ? fs.readFileSync(expired.key, "utf8") : null,
    selfSignedCert: fs.readFileSync(selfSignedCert, "utf8"),
    selfSignedKey: fs.readFileSync(selfSignedKey, "utf8"),
  };
}

function formatOpensslDate(date: Date): string {
  // openssl expects YYYYMMDDHHMMSSZ for -not_before / -not_after.
  const pad: (value: number) => string = (value: number): string => {
    return String(value).padStart(2, "0");
  };

  return (
    `${date.getUTCFullYear()}` +
    `${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}` +
    `${pad(date.getUTCMinutes())}` +
    `${pad(date.getUTCSeconds())}Z`
  );
}

export function cleanupSslCertificateFixtures(
  fixtures: SslCertificateFixtures,
): void {
  fs.rmSync(fixtures.workDir, { recursive: true, force: true });
}

/*
 * A standalone self-signed pair for suites that only need SOME certificate
 * to put in front of a TLS listener (the timeout suite, where the
 * certificate itself is irrelevant). Generated once per process.
 */
let cachedSelfSigned: { key: string; cert: string } | null = null;

const SelfSignedCertificate: { readonly key: string; readonly cert: string } = {
  get key(): string {
    return ensureSelfSigned().key;
  },
  get cert(): string {
    return ensureSelfSigned().cert;
  },
};

function ensureSelfSigned(): { key: string; cert: string } {
  if (cachedSelfSigned) {
    return cachedSelfSigned;
  }

  const dir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-ssl-monitor-selfsigned-"),
  );
  const keyPath: string = path.join(dir, "key.pem");
  const certPath: string = path.join(dir, "cert.pem");

  openssl(["genrsa", "-out", keyPath, "2048"]);
  openssl([
    "req",
    "-x509",
    "-new",
    "-key",
    keyPath,
    "-out",
    certPath,
    "-days",
    "2",
    "-subj",
    "/CN=localhost",
  ]);

  cachedSelfSigned = {
    key: fs.readFileSync(keyPath, "utf8"),
    cert: fs.readFileSync(certPath, "utf8"),
  };

  fs.rmSync(dir, { recursive: true, force: true });

  return cachedSelfSigned;
}

export default SelfSignedCertificate;
