/*
 * The SHA-256 fingerprint of the one certificate a person trusts for a
 * vCenter that does not have a certificate from a public authority - which,
 * with vCenter's own VMCA certificates, is most of them.
 *
 * Trusting a fingerprint is the opposite of skipping verification: the probe
 * still does a full TLS handshake, and then accepts exactly that certificate
 * and nothing else. A renewed certificate, or anyone in the middle, shows a
 * different fingerprint and nothing is sent.
 *
 * Fingerprints arrive in every spelling the tools print them in - Node's and
 * the dashboard's "AB:CD:...", openssl's "SHA256 Fingerprint=AB:CD:...", a
 * bare 64-character hex string, with or without spaces - and are stored in
 * one: 32 upper-case hex pairs joined by colons.
 */

const SHA256_HEX_LENGTH: number = 64;
const HEX_PATTERN: RegExp = /^[0-9a-f]+$/i;
const PREFIX_PATTERN: RegExp = /^(sha-?256)\s*(fingerprint)?\s*[:=]?\s*/i;
const SEPARATOR_PATTERN: RegExp = /[\s:-]/g;
const PAIR_PATTERN: RegExp = /.{2}/g;

export default class VMwareCertificateFingerprint {
  /*
   * The canonical "AB:CD:..." form of a SHA-256 fingerprint, or null when the
   * input is not one (an empty input included).
   */
  public static normalize(input: string | null | undefined): string | null {
    let value: string = (input || "").trim();

    if (!value) {
      return null;
    }

    value = value.replace(PREFIX_PATTERN, "");
    value = value.replace(SEPARATOR_PATTERN, "");

    if (value.length !== SHA256_HEX_LENGTH || !HEX_PATTERN.test(value)) {
      return null;
    }

    const pairs: Array<string> = value.toUpperCase().match(PAIR_PATTERN) || [];

    return pairs.join(":");
  }

  public static isValid(input: string | null | undefined): boolean {
    return VMwareCertificateFingerprint.normalize(input) !== null;
  }

  // Whether two fingerprints, in any spelling, name the same certificate.
  public static areEqual(
    first: string | null | undefined,
    second: string | null | undefined,
  ): boolean {
    const a: string | null = VMwareCertificateFingerprint.normalize(first);
    const b: string | null = VMwareCertificateFingerprint.normalize(second);

    return a !== null && a === b;
  }
}
