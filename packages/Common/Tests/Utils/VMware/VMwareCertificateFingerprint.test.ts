import { describe, expect, test } from "@jest/globals";
import VMwareCertificateFingerprint from "../../../Utils/VMware/VMwareCertificateFingerprint";

/*
 * A trusted certificate is named by its SHA-256 fingerprint, in whichever
 * spelling the tool a person used prints it, and stored in one.
 */

const HEX: string =
  "3f2c9a1b0e7d4c5a6b8f9e0d1c2b3a4f5e6d7c8b9a0f1e2d3c4b5a6f7e8d9c0b";
const CANONICAL: string =
  "3F:2C:9A:1B:0E:7D:4C:5A:6B:8F:9E:0D:1C:2B:3A:4F:5E:6D:7C:8B:9A:0F:1E:2D:3C:4B:5A:6F:7E:8D:9C:0B";

describe("VMwareCertificateFingerprint", () => {
  test.each([
    ["Node's and the dashboard's", CANONICAL],
    ["lower case", CANONICAL.toLowerCase()],
    ["a bare hex string", HEX],
    ["openssl's", `SHA256 Fingerprint=${CANONICAL}`],
    ["openssl's lower case", `sha256 Fingerprint=${CANONICAL}`],
    ["with SHA-256: in front", `SHA-256: ${CANONICAL}`],
    ["spaced", HEX.match(/.{2}/g)!.join(" ")],
    ["dashed", HEX.match(/.{2}/g)!.join("-")],
    ["with whitespace around", `  ${CANONICAL}\n`],
  ])("reads %s spelling", (_name: string, input: string) => {
    expect(VMwareCertificateFingerprint.normalize(input)).toBe(CANONICAL);
    expect(VMwareCertificateFingerprint.isValid(input)).toBe(true);
  });

  test.each([
    ["nothing", ""],
    [
      "a SHA-1 fingerprint",
      "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01",
    ],
    ["one character short", HEX.substring(1)],
    ["not hex", HEX.replace("3f", "zz")],
    ["two fingerprints", `${HEX}${HEX}`],
  ])("refuses %s", (_name: string, input: string) => {
    expect(VMwareCertificateFingerprint.normalize(input)).toBeNull();
    expect(VMwareCertificateFingerprint.isValid(input)).toBe(false);
  });

  test("null and undefined are no fingerprint", () => {
    expect(VMwareCertificateFingerprint.normalize(null)).toBeNull();
    expect(VMwareCertificateFingerprint.normalize(undefined)).toBeNull();
  });

  test("two spellings of one certificate are equal; nothing equals nothing", () => {
    expect(VMwareCertificateFingerprint.areEqual(HEX, CANONICAL)).toBe(true);
    expect(
      VMwareCertificateFingerprint.areEqual(
        CANONICAL,
        CANONICAL.replace("0B", "0C"),
      ),
    ).toBe(false);
    expect(VMwareCertificateFingerprint.areEqual(null, null)).toBe(false);
    expect(VMwareCertificateFingerprint.areEqual("x", "x")).toBe(false);
    expect(VMwareCertificateFingerprint.areEqual(CANONICAL, null)).toBe(false);
  });
});
