/*
 * Signing helpers for the SAML tests.
 *
 * Keys are generated at runtime — nothing secret is committed — and xml-crypto
 * verifies against a raw public key just as well as against an X.509
 * certificate, so the generated public key PEM stands in for the provider's
 * configured `publicCertificate`.
 */
import crypto from "crypto";
import { SignedXml } from "xml-crypto";

export const XMLDSIG_ENVELOPED: string =
  "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
export const XMLDSIG_EXC_C14N: string =
  "http://www.w3.org/2001/10/xml-exc-c14n#";
export const XMLENC_SHA256: string = "http://www.w3.org/2001/04/xmlenc#sha256";
export const RSA_SHA256: string =
  "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";

export const SAML_STATUS_SUCCESS: string =
  "urn:oasis:names:tc:SAML:2.0:status:Success";

export interface SamlKeyPair {
  privateKey: string;
  publicKey: string;
}

export function generateRsaKeyPair(): SamlKeyPair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  return { privateKey, publicKey };
}

export interface SignOptions {
  // XPath of the element whose content is digested.
  referenceXPath: string;
  privateKey: string;
  /*
   * Where the <Signature> element is inserted. Defaults to appending it into
   * the referenced element, which is where most providers put it.
   */
  location?:
    | {
        reference: string;
        action: "append" | "prepend" | "before" | "after";
      }
    | undefined;
}

export function signXml(xml: string, options: SignOptions): string {
  const sig: SignedXml = new SignedXml({
    privateKey: options.privateKey,
    signatureAlgorithm: RSA_SHA256,
    canonicalizationAlgorithm: XMLDSIG_EXC_C14N,
    getKeyInfoContent: (): string => {
      return "<X509Data></X509Data>";
    },
  });

  sig.addReference({
    xpath: options.referenceXPath,
    transforms: [XMLDSIG_ENVELOPED, XMLDSIG_EXC_C14N],
    digestAlgorithm: XMLENC_SHA256,
  });

  sig.computeSignature(xml, {
    location: options.location ?? {
      reference: options.referenceXPath,
      action: "append",
    },
  });

  return sig.getSignedXml();
}

/*
 * Sign the single element with this local name. Providers sign either the
 * Assertion or the whole Response; both are exercised.
 */
export function signElement(
  xml: string,
  localName: string,
  privateKey: string,
): string {
  return signXml(xml, {
    referenceXPath: `//*[local-name(.)='${localName}']`,
    privateKey,
  });
}

/*
 * Sign an element but place the <Signature> immediately after the assertion's
 * <Issuer>, which is where Okta, Entra ID, ADFS and Shibboleth actually put it.
 */
export function signElementAfterIssuer(
  xml: string,
  localName: string,
  privateKey: string,
): string {
  return signXml(xml, {
    referenceXPath: `//*[local-name(.)='${localName}']`,
    privateKey,
    location: {
      reference: `//*[local-name(.)='${localName}']/*[local-name(.)='Issuer']`,
      action: "after",
    },
  });
}

export function toBase64(xml: string): string {
  return Buffer.from(xml).toString("base64");
}
