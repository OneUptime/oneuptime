import { describe, expect, test } from "@jest/globals";
import DigestMethod from "../../../Types/SSO/DigestMethod";
import {
  DEFAULT_SAML_DIGEST_METHOD,
  DEFAULT_SAML_SIGNATURE_METHOD,
  SamlProviderDefaultFields,
  fillSamlProviderDefaults,
} from "../../../Types/SSO/SamlProviderDefaults";
import SignatureMethod from "../../../Types/SSO/SignatureMethod";

/*
 * A SAML provider is given its sign-on URL, issuer and certificate by the
 * identity provider. What it was also asked for has an answer: the
 * signature method RSA-SHA256, the digest method SHA256 (what nearly every
 * identity provider uses; the old forms' help said to leave them at that),
 * and the description "Sign in with <name>". fillSamlProviderDefaults is
 * what the three SAML services run before the required-field check, so an
 * API caller who leaves them out gets the provider the forms make.
 */

function provider(
  values: Partial<SamlProviderDefaultFields>,
): SamlProviderDefaultFields {
  return { ...values };
}

describe("the defaults", () => {
  test("are RSA-SHA256 and SHA256, values the columns already accept", () => {
    expect(DEFAULT_SAML_SIGNATURE_METHOD).toBe("RSA-SHA256");
    expect(DEFAULT_SAML_SIGNATURE_METHOD).toBe(SignatureMethod.SHA256);
    expect(Object.values(SignatureMethod)).toContain(
      DEFAULT_SAML_SIGNATURE_METHOD,
    );

    expect(DEFAULT_SAML_DIGEST_METHOD).toBe("SHA256");
    expect(DEFAULT_SAML_DIGEST_METHOD).toBe(DigestMethod.SHA256);
    expect(Object.values(DigestMethod)).toContain(DEFAULT_SAML_DIGEST_METHOD);
  });
});

describe("fillSamlProviderDefaults", () => {
  test("fills in the signature method, digest method and description of a provider given only its name", () => {
    const created: SamlProviderDefaultFields = provider({ name: "Okta" });

    fillSamlProviderDefaults(created);

    expect(created).toEqual({
      name: "Okta",
      signatureMethod: SignatureMethod.SHA256,
      digestMethod: DigestMethod.SHA256,
      description: "Sign in with Okta",
    });
  });

  test("keeps every value the caller sent", () => {
    const created: SamlProviderDefaultFields = provider({
      name: "Okta",
      signatureMethod: SignatureMethod.SHA512,
      digestMethod: DigestMethod.SHA1,
      description: "Staff only",
    });

    fillSamlProviderDefaults(created);

    expect(created).toEqual({
      name: "Okta",
      signatureMethod: SignatureMethod.SHA512,
      digestMethod: DigestMethod.SHA1,
      description: "Staff only",
    });
  });

  test.each([
    ["undefined", undefined],
    ["an empty string", ""],
    ["spaces", "   "],
  ])(
    "reads a method given as %s as left out",
    (_label: string, value: string | undefined) => {
      const created: SamlProviderDefaultFields = {
        name: "Okta",
        signatureMethod: value as SignatureMethod | undefined,
        digestMethod: value as DigestMethod | undefined,
      };

      fillSamlProviderDefaults(created);

      expect(created.signatureMethod).toBe(SignatureMethod.SHA256);
      expect(created.digestMethod).toBe(DigestMethod.SHA256);
    },
  );

  test("fills each method on its own: one given, the other left out", () => {
    const onlySignature: SamlProviderDefaultFields = provider({
      name: "Okta",
      signatureMethod: SignatureMethod.SHA384,
    });
    const onlyDigest: SamlProviderDefaultFields = provider({
      name: "Okta",
      digestMethod: DigestMethod.SHA512,
    });

    fillSamlProviderDefaults(onlySignature);
    fillSamlProviderDefaults(onlyDigest);

    expect([onlySignature.signatureMethod, onlySignature.digestMethod]).toEqual(
      [SignatureMethod.SHA384, DigestMethod.SHA256],
    );
    expect([onlyDigest.signatureMethod, onlyDigest.digestMethod]).toEqual([
      SignatureMethod.SHA256,
      DigestMethod.SHA512,
    ]);
  });

  test("without a name, leaves the description missing for the required-field check to name", () => {
    const created: SamlProviderDefaultFields = provider({});

    fillSamlProviderDefaults(created);

    expect(created.description).toBeUndefined();
    // The methods have an answer whatever the name.
    expect(created.signatureMethod).toBe(SignatureMethod.SHA256);
    expect(created.digestMethod).toBe(DigestMethod.SHA256);
  });

  test("touches nothing the identity provider gives", () => {
    const created: Record<string, unknown> = {
      name: "Okta",
      signOnURL: "https://example.okta.com/app/sso/saml",
      issuerURL: "http://www.okta.com/exk1",
      publicCertificate: "-----BEGIN CERTIFICATE-----",
    };

    fillSamlProviderDefaults(created as SamlProviderDefaultFields);

    expect(created["signOnURL"]).toBe("https://example.okta.com/app/sso/saml");
    expect(created["issuerURL"]).toBe("http://www.okta.com/exk1");
    expect(created["publicCertificate"]).toBe("-----BEGIN CERTIFICATE-----");
  });

  test("filling twice changes nothing more", () => {
    const created: SamlProviderDefaultFields = provider({ name: "Okta" });

    fillSamlProviderDefaults(created);
    const once: SamlProviderDefaultFields = { ...created };
    fillSamlProviderDefaults(created);

    expect(created).toEqual(once);
  });
});
