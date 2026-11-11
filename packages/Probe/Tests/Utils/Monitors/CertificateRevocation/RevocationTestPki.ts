import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/*
 * A small certificate authority for the revocation suites, made with openssl
 * at test time (like SslTestCertificates.ts), so nothing checked in expires
 * and every OCSP response and CRL is a real one, from a real CA database.
 *
 *   root (RSA)  ->  intermediate (EC P-256), the issuer every check asks
 *                     -> good leaf      (OCSP + CRL named, never revoked)
 *                     -> revoked leaf   (revoked: keyCompromise)
 *                     -> bare leaf      (names no OCSP responder, no CRL)
 *                     -> unrecorded leaf (signed outside the CA database:
 *                                         OCSP status "unknown")
 *                     -> responder      (RSA, id-kp-OCSPSigning: may sign
 *                                         OCSP responses for the issuer)
 *                     -> impostor       (RSA, no OCSPSigning: may not)
 *   stranger (RSA): an unrelated CA, for forged responses and CRLs.
 *
 * The issuer signs with ECDSA and the responder with RSA, so both signature
 * families the probe verifies are exercised.
 */

export const OCSP_URL: string = "http://ocsp.revocation-test.example/";
export const CRL_URL: string = "http://crl.revocation-test.example/int.crl";

export type OcspSigner = "issuer" | "responder" | "impostor" | "stranger";

export interface RevocationTestPki {
  workDir: string;
  rootPem: string;
  intermediatePem: string;
  intermediateDer: Buffer;

  goodLeafPem: string;
  goodLeafKeyPem: string;
  goodLeafDer: Buffer;
  revokedLeafPem: string;
  revokedLeafKeyPem: string;
  revokedLeafDer: Buffer;
  bareLeafDer: Buffer;
  unrecordedLeafDer: Buffer;
  responderDer: Buffer;
  strangerDer: Buffer;

  // The intermediate's CRL, listing the revoked leaf (DER and PEM).
  crlDer: Buffer;
  crlPem: string;
  // The same list, signed by the stranger.
  forgedCrlDer: Buffer;

  // An OCSP response from the intermediate's database, signed by signer.
  ocspResponse: (
    leaf: "good" | "revoked" | "unrecorded",
    signer: OcspSigner,
  ) => Buffer;
  // Asks the intermediate's database to answer a request built elsewhere.
  answerOcspRequest: (request: Buffer) => Buffer;
}

function openssl(args: Array<string>, cwd: string): void {
  execFileSync("openssl", args, { stdio: "pipe", cwd: cwd });
}

export function generateRevocationTestPki(): RevocationTestPki {
  const workDir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-revocation-test-"),
  );
  const file: (name: string) => string = (name: string): string => {
    return path.join(workDir, name);
  };
  const run: (args: Array<string>) => void = (args: Array<string>): void => {
    openssl(args, workDir);
  };

  fs.mkdirSync(file("db"));
  fs.mkdirSync(file("db/certs"));
  fs.writeFileSync(file("db/index.txt"), "");
  fs.writeFileSync(file("db/serial"), "1000\n");
  fs.writeFileSync(file("db/crlnumber"), "01\n");

  const config: string = file("openssl.cnf");
  fs.writeFileSync(
    config,
    [
      "[ca]",
      "default_ca = int_ca",
      "[int_ca]",
      `dir = ${file("db")}`,
      "database = $dir/index.txt",
      "new_certs_dir = $dir/certs",
      "serial = $dir/serial",
      "crlnumber = $dir/crlnumber",
      `certificate = ${file("int.crt")}`,
      `private_key = ${file("int.key")}`,
      "default_md = sha256",
      "default_days = 3650",
      "default_crl_days = 7",
      "policy = policy_any",
      "unique_subject = no",
      "copy_extensions = none",
      "[policy_any]",
      "commonName = supplied",
      "[req]",
      "distinguished_name = dn",
      "prompt = no",
      "[dn]",
      "CN = placeholder",
      "[root_ext]",
      "basicConstraints = critical, CA:true",
      "keyUsage = critical, keyCertSign, cRLSign",
      "subjectKeyIdentifier = hash",
      "[int_ext]",
      "basicConstraints = critical, CA:true, pathlen:0",
      "keyUsage = critical, keyCertSign, cRLSign, digitalSignature",
      "subjectKeyIdentifier = hash",
      "authorityKeyIdentifier = keyid",
      "[leaf_ext]",
      "basicConstraints = CA:false",
      "keyUsage = critical, digitalSignature",
      "extendedKeyUsage = serverAuth",
      "subjectAltName = DNS:localhost, IP:127.0.0.1",
      `authorityInfoAccess = OCSP;URI:${OCSP_URL}, caIssuers;URI:http://ca.revocation-test.example/int.crt`,
      `crlDistributionPoints = URI:${CRL_URL}`,
      "subjectKeyIdentifier = hash",
      "authorityKeyIdentifier = keyid",
      "[bare_leaf_ext]",
      "basicConstraints = CA:false",
      "keyUsage = critical, digitalSignature",
      "extendedKeyUsage = serverAuth",
      "subjectAltName = DNS:localhost, IP:127.0.0.1",
      "[responder_ext]",
      "basicConstraints = CA:false",
      "keyUsage = critical, digitalSignature",
      "extendedKeyUsage = OCSPSigning",
      "[impostor_ext]",
      "basicConstraints = CA:false",
      "keyUsage = critical, digitalSignature",
      "extendedKeyUsage = serverAuth",
    ].join("\n"),
  );

  const rsaKey: (name: string) => void = (name: string): void => {
    run([
      "genpkey",
      "-algorithm",
      "RSA",
      "-pkeyopt",
      "rsa_keygen_bits:2048",
      "-out",
      name,
    ]);
  };
  const ecKey: (name: string) => void = (name: string): void => {
    run([
      "genpkey",
      "-algorithm",
      "EC",
      "-pkeyopt",
      "ec_paramgen_curve:P-256",
      "-out",
      name,
    ]);
  };

  // Root and intermediate.
  rsaKey("root.key");
  run([
    "req",
    "-x509",
    "-new",
    "-key",
    "root.key",
    "-subj",
    "/CN=Revocation Test Root",
    "-days",
    "3650",
    "-config",
    config,
    "-extensions",
    "root_ext",
    "-out",
    "root.crt",
  ]);

  ecKey("int.key");
  run([
    "req",
    "-new",
    "-key",
    "int.key",
    "-subj",
    "/CN=Revocation Test Intermediate",
    "-config",
    config,
    "-out",
    "int.csr",
  ]);
  run([
    "x509",
    "-req",
    "-in",
    "int.csr",
    "-CA",
    "root.crt",
    "-CAkey",
    "root.key",
    "-set_serial",
    "1",
    "-days",
    "3650",
    "-extfile",
    config,
    "-extensions",
    "int_ext",
    "-out",
    "int.crt",
  ]);

  // Certificates the intermediate issues through its database.
  const issue: (name: string, extensions: string, isRsa: boolean) => void = (
    name: string,
    extensions: string,
    isRsa: boolean,
  ): void => {
    if (isRsa) {
      rsaKey(`${name}.key`);
    } else {
      ecKey(`${name}.key`);
    }

    run([
      "req",
      "-new",
      "-key",
      `${name}.key`,
      "-subj",
      `/CN=${name}.revocation-test.example`,
      "-config",
      config,
      "-out",
      `${name}.csr`,
    ]);
    run([
      "ca",
      "-batch",
      "-config",
      config,
      "-extensions",
      extensions,
      "-notext",
      "-in",
      `${name}.csr`,
      "-out",
      `${name}.crt`,
    ]);
  };

  issue("good", "leaf_ext", false);
  issue("revoked", "leaf_ext", false);
  issue("bare", "bare_leaf_ext", false);
  issue("responder", "responder_ext", true);
  issue("impostor", "impostor_ext", true);

  // A leaf the intermediate signs outside its database: OCSP says "unknown".
  ecKey("unrecorded.key");
  run([
    "req",
    "-new",
    "-key",
    "unrecorded.key",
    "-subj",
    "/CN=unrecorded.revocation-test.example",
    "-config",
    config,
    "-out",
    "unrecorded.csr",
  ]);
  run([
    "x509",
    "-req",
    "-in",
    "unrecorded.csr",
    "-CA",
    "int.crt",
    "-CAkey",
    "int.key",
    "-set_serial",
    "77777",
    "-days",
    "3650",
    "-extfile",
    config,
    "-extensions",
    "leaf_ext",
    "-out",
    "unrecorded.crt",
  ]);

  run([
    "ca",
    "-config",
    config,
    "-revoke",
    "revoked.crt",
    "-crl_reason",
    "keyCompromise",
  ]);

  run(["ca", "-config", config, "-gencrl", "-out", "int.crl.pem"]);
  run(["crl", "-in", "int.crl.pem", "-outform", "DER", "-out", "int.crl.der"]);

  // The stranger: an unrelated CA with a list in the intermediate's name.
  rsaKey("stranger.key");
  run([
    "req",
    "-x509",
    "-new",
    "-key",
    "stranger.key",
    "-subj",
    "/CN=Revocation Test Intermediate",
    "-days",
    "3650",
    "-config",
    config,
    "-extensions",
    "root_ext",
    "-out",
    "stranger.crt",
  ]);
  run([
    "ca",
    "-config",
    config,
    "-gencrl",
    "-cert",
    "stranger.crt",
    "-keyfile",
    "stranger.key",
    "-out",
    "forged.crl.pem",
  ]);
  run([
    "crl",
    "-in",
    "forged.crl.pem",
    "-outform",
    "DER",
    "-out",
    "forged.crl.der",
  ]);

  const der: (certificateFile: string) => Buffer = (
    certificateFile: string,
  ): Buffer => {
    const out: string = `${certificateFile}.der`;
    run(["x509", "-in", certificateFile, "-outform", "DER", "-out", out]);
    return fs.readFileSync(file(out));
  };

  const signerFiles: Record<OcspSigner, { cert: string; key: string }> = {
    issuer: { cert: "int.crt", key: "int.key" },
    responder: { cert: "responder.crt", key: "responder.key" },
    impostor: { cert: "impostor.crt", key: "impostor.key" },
    stranger: { cert: "stranger.crt", key: "stranger.key" },
  };

  let responseCount: number = 0;

  const answer: (requestFile: string, signer: OcspSigner) => Buffer = (
    requestFile: string,
    signer: OcspSigner,
  ): Buffer => {
    responseCount++;
    const responseFile: string = `response-${responseCount}.der`;
    run([
      "ocsp",
      "-index",
      file("db/index.txt"),
      "-CA",
      "int.crt",
      "-rsigner",
      signerFiles[signer].cert,
      "-rkey",
      signerFiles[signer].key,
      "-reqin",
      requestFile,
      "-respout",
      responseFile,
      "-ndays",
      "7",
      // The issuer signs alone; a delegated responder sends its certificate.
      ...(signer === "issuer" ? ["-resp_no_certs"] : []),
    ]);
    return fs.readFileSync(file(responseFile));
  };

  const ocspResponse: (
    leaf: "good" | "revoked" | "unrecorded",
    signer: OcspSigner,
  ) => Buffer = (
    leaf: "good" | "revoked" | "unrecorded",
    signer: OcspSigner,
  ): Buffer => {
    const requestFile: string = `${leaf}.req`;

    if (!fs.existsSync(file(requestFile))) {
      run([
        "ocsp",
        "-issuer",
        "int.crt",
        "-cert",
        `${leaf}.crt`,
        "-no_nonce",
        "-reqout",
        requestFile,
      ]);
    }

    return answer(requestFile, signer);
  };

  const answerOcspRequest: (request: Buffer) => Buffer = (
    request: Buffer,
  ): Buffer => {
    responseCount++;
    const requestFile: string = `external-${responseCount}.req`;
    fs.writeFileSync(file(requestFile), request);
    return answer(requestFile, "issuer");
  };

  return {
    workDir: workDir,
    rootPem: fs.readFileSync(file("root.crt"), "utf8"),
    intermediatePem: fs.readFileSync(file("int.crt"), "utf8"),
    intermediateDer: der("int.crt"),
    goodLeafPem: fs.readFileSync(file("good.crt"), "utf8"),
    goodLeafKeyPem: fs.readFileSync(file("good.key"), "utf8"),
    goodLeafDer: der("good.crt"),
    revokedLeafPem: fs.readFileSync(file("revoked.crt"), "utf8"),
    revokedLeafKeyPem: fs.readFileSync(file("revoked.key"), "utf8"),
    revokedLeafDer: der("revoked.crt"),
    bareLeafDer: der("bare.crt"),
    unrecordedLeafDer: der("unrecorded.crt"),
    responderDer: der("responder.crt"),
    strangerDer: der("stranger.crt"),
    crlDer: fs.readFileSync(file("int.crl.der")),
    crlPem: fs.readFileSync(file("int.crl.pem"), "utf8"),
    forgedCrlDer: fs.readFileSync(file("forged.crl.der")),
    ocspResponse: ocspResponse,
    answerOcspRequest: answerOcspRequest,
  };
}

export function cleanupRevocationTestPki(
  pki: RevocationTestPki | undefined,
): void {
  if (pki) {
    fs.rmSync(pki.workDir, { recursive: true, force: true });
  }
}
