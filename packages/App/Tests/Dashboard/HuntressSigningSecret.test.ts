import { describe, expect, test } from "@jest/globals";
import {
  HUNTRESS_SIGNING_SECRET_PROBLEM,
  getHuntressSigningSecretProblem,
} from "../../FeatureSet/Dashboard/src/Components/Huntress/HuntressSigningSecret";
import StandardWebhookSignature from "Common/Server/Utils/Webhook/StandardWebhookSignature";
import crypto from "crypto";

/*
 * The signing secret dialog's first look at what was pasted. It catches the
 * usual slips while the dialog is open - the webhook URL pasted back, a
 * secret cut short, a sentence copied with it - and must never refuse a
 * secret the server would take: the server's check
 * (StandardWebhookSignature) has the last word.
 */

function svixSecret(bytes: number): string {
  return `whsec_${crypto.randomBytes(bytes).toString("base64")}`;
}

describe("the signing secret dialog", () => {
  test("takes a secret as Huntress shows it, with or without whsec_", () => {
    const secret: string = svixSecret(24);

    expect(getHuntressSigningSecretProblem(secret)).toBeNull();
    expect(getHuntressSigningSecretProblem(secret.slice("whsec_".length))).toBeNull();
    expect(getHuntressSigningSecretProblem(`  ${secret}\n`)).toBeNull();
  });

  test("leaves an empty field to the form's own required check", () => {
    expect(getHuntressSigningSecretProblem("")).toBeNull();
    expect(getHuntressSigningSecretProblem("   ")).toBeNull();
    expect(getHuntressSigningSecretProblem(null)).toBeNull();
    expect(getHuntressSigningSecretProblem(undefined)).toBeNull();
  });

  test("refuses the usual slips, saying where the secret is", () => {
    for (const slip of [
      "https://oneuptime.com/api/huntress/webhook/6d1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b",
      "whsec_short",
      "whsec_ abc def ghi jkl mno pqr stu",
      "View Signing Secret",
      `${svixSecret(24)} copied with a sentence`,
      `whsec_${"A".repeat(1200)}`,
    ]) {
      expect({ slip, problem: getHuntressSigningSecretProblem(slip) }).toEqual({
        slip,
        problem: HUNTRESS_SIGNING_SECRET_PROBLEM,
      });
    }

    expect(HUNTRESS_SIGNING_SECRET_PROBLEM).toContain("View Signing Secret");
    expect(HUNTRESS_SIGNING_SECRET_PROBLEM).toContain("whsec_");
  });

  test("never refuses a secret the server accepts", () => {
    for (const bytes of [16, 24, 32, 64, 128, 256, 512]) {
      const secret: string = svixSecret(bytes);

      expect(StandardWebhookSignature.isValidSecret(secret)).toBe(true);
      expect({ bytes, problem: getHuntressSigningSecretProblem(secret) }).toEqual(
        { bytes, problem: null },
      );
    }
  });

  test("refuses nothing but secrets the server refuses too", () => {
    for (const slip of [
      "https://oneuptime.com/api/huntress/webhook/abc",
      "whsec_short",
      "whsec_ abc def ghi jkl mno pqr stu",
    ]) {
      expect(getHuntressSigningSecretProblem(slip)).not.toBeNull();
      expect(StandardWebhookSignature.isValidSecret(slip)).toBe(false);
    }
  });
});
