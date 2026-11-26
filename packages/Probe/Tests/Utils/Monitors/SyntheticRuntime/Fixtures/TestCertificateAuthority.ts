import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import tls from "tls";

/*
 * A CERTIFICATE AUTHORITY FOR A TEST, AND CERTIFICATES FOR ITS SITES.
 *
 * A synthetic check's https requests are verified against the site they
 * were made for, name or address. These tests need a site with a real
 * certificate for a public address (93.184.215.14), as an operator's site
 * would have, so they issue one from an authority of their own, and trust
 * that authority for the length of the test as NODE_EXTRA_CA_CERTS would.
 *
 * openssl does the work, as it does for the SSL monitor's tests
 * (MonitorTypes/SslTestCertificates).
 */

export interface IssuedCertificate {
  cert: string;
  key: string;
}

function openssl(args: Array<string>): void {
  execFileSync("openssl", args, { stdio: "pipe" });
}

export default class TestCertificateAuthority {
  public readonly certificate: string;
  private readonly directory: string;
  private readonly keyPath: string;
  private readonly certificatePath: string;
  private issued: number = 0;

  private constructor(directory: string) {
    this.directory = directory;
    this.keyPath = path.join(directory, "ca.key");
    this.certificatePath = path.join(directory, "ca.crt");
    openssl(["genrsa", "-out", this.keyPath, "2048"]);
    openssl([
      "req",
      "-x509",
      "-new",
      "-key",
      this.keyPath,
      "-out",
      this.certificatePath,
      "-days",
      "2",
      "-subj",
      "/CN=oneuptime-egress-test-ca",
    ]);
    this.certificate = fs.readFileSync(this.certificatePath, "utf8");
  }

  public static create(): TestCertificateAuthority {
    return new TestCertificateAuthority(
      fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-egress-ca-")),
    );
  }

  // A certificate for the names and addresses given, signed by this authority.
  public issue(data: {
    names?: Array<string>;
    addresses?: Array<string>;
  }): IssuedCertificate {
    this.issued += 1;
    const base: string = path.join(this.directory, `site-${this.issued}`);
    const subjectAltName: string = [
      ...(data.names || []).map((name: string) => {
        return `DNS:${name}`;
      }),
      ...(data.addresses || []).map((address: string) => {
        return `IP:${address}`;
      }),
    ].join(",");

    fs.writeFileSync(
      `${base}.cnf`,
      [
        "[site]",
        `subjectAltName = ${subjectAltName}`,
        "extendedKeyUsage = serverAuth",
      ].join("\n"),
    );
    openssl(["genrsa", "-out", `${base}.key`, "2048"]);
    openssl([
      "req",
      "-new",
      "-key",
      `${base}.key`,
      "-out",
      `${base}.csr`,
      "-subj",
      `/CN=site-${this.issued}.oneuptime-test`,
    ]);
    openssl([
      "x509",
      "-req",
      "-in",
      `${base}.csr`,
      "-CA",
      this.certificatePath,
      "-CAkey",
      this.keyPath,
      "-CAcreateserial",
      "-out",
      `${base}.crt`,
      "-days",
      "2",
      "-extfile",
      `${base}.cnf`,
      "-extensions",
      "site",
    ]);

    return {
      cert: fs.readFileSync(`${base}.crt`, "utf8"),
      key: fs.readFileSync(`${base}.key`, "utf8"),
    };
  }

  /*
   * Trusts this authority in this process, beside the default ones, as
   * NODE_EXTRA_CA_CERTS would. Returns what puts the defaults back.
   */
  public trustInThisProcess(): () => void {
    const defaults: Array<string> = tls.getCACertificates("default");
    tls.setDefaultCACertificates([...defaults, this.certificate]);

    return (): void => {
      tls.setDefaultCACertificates(defaults);
    };
  }

  public remove(): void {
    fs.rmSync(this.directory, { recursive: true, force: true });
  }
}
