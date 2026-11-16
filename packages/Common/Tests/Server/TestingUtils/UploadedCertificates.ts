import acme from "acme-client";
import crypto from "crypto";

/*
 * Certificates and private keys for the suites that check what a custom
 * domain's owner uploads (UploadedCertificate), made when a suite runs - a
 * self-signed certificate for a name, and the key it was issued for - so no
 * key is ever kept in the repository. acme-client makes them as it makes
 * the certificate of a TLS-ALPN-01 challenge.
 */

export interface CertificatePair {
  certificate: string;
  privateKey: string;
}

const pairs: Map<string, Promise<CertificatePair>> = new Map();

// A certificate for `name` and its key; one per name for the whole run.
export const makeCertificatePair: (
  name?: string,
) => Promise<CertificatePair> = (
  name: string = "report.acme.com",
): Promise<CertificatePair> => {
  let pair: Promise<CertificatePair> | undefined = pairs.get(name);

  if (!pair) {
    pair = acme.crypto
      .createAlpnCertificate(
        { identifier: { type: "dns", value: name } } as never,
        `key-authorization-${name}`,
      )
      .then(([privateKey, certificate]: [Buffer, Buffer]): CertificatePair => {
        return {
          certificate: certificate.toString(),
          privateKey: privateKey.toString(),
        };
      });

    pairs.set(name, pair);
  }

  return pair;
};

// The same key, as OpenSSL writes it with a passphrase on it.
export const withPassphrase: (
  privateKey: string,
  format: "pkcs8" | "pkcs1",
) => string = (privateKey: string, format: "pkcs8" | "pkcs1"): string => {
  return crypto
    .createPrivateKey(privateKey)
    .export({
      format: "pem",
      type: format,
      cipher: "aes-256-cbc",
      passphrase: "correct horse battery staple",
    })
    .toString();
};

// The key's public half, which is no private key.
export const publicHalfOf: (privateKey: string) => string = (
  privateKey: string,
): string => {
  return crypto
    .createPublicKey(privateKey)
    .export({ format: "pem", type: "spki" })
    .toString();
};

// The key in its traditional, PKCS #1 form ("BEGIN RSA PRIVATE KEY").
export const inPkcs1: (privateKey: string) => string = (
  privateKey: string,
): string => {
  return crypto
    .createPrivateKey(privateKey)
    .export({ format: "pem", type: "pkcs1" })
    .toString();
};
