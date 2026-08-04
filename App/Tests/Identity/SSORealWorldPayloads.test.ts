/*
 * SAML responses shaped like the ones real identity providers actually send.
 *
 * SSO.test.ts proves the security properties against minimal, purpose-built
 * documents. That leaves a gap: the documents a customer's IdP posts to the ACS
 * are considerably messier — `saml2:`/`saml2p:` prefixes instead of `saml:`,
 * an XML declaration, pretty-printing whitespace, `Destination` and
 * `InResponseTo` attributes, `<Conditions>` with an audience restriction, an
 * `<AuthnStatement>`, a `<SubjectConfirmation>`, xsi-typed attribute values,
 * multi-valued attributes, and the signature sitting immediately after the
 * assertion's `<Issuer>` rather than at the end.
 *
 * Every document below is transcribed from a real response from that provider,
 * with hostnames, ids and names replaced. Each one is signed at run time with a
 * generated key.
 *
 * These tests also pin a behaviour worth being explicit about: the email
 * always comes from `<NameID>`, but the display name is only ever read from the
 * Microsoft `displayname` claim. Providers that send a name under a different
 * attribute name (Okta's `firstName`/`lastName`, Auth0's and OneLogin's
 * `.../claims/name`, Shibboleth's `displayName`) yield a null name and the user
 * is created from the email alone. That is the current contract, and the
 * per-vendor expectations below state it plainly rather than leaving it
 * untested.
 */
import SSOUtil, {
  VerifiedSamlResponse,
} from "../../FeatureSet/Identity/Utils/SSO";
import {
  SamlKeyPair,
  generateRsaKeyPair,
  signElement,
  signElementAfterIssuer,
  toBase64,
} from "./SamlTestKit";
import { beforeAll, describe, expect, test } from "@jest/globals";

let idpKeys: SamlKeyPair;
/*
 * Stands in for a different provider's certificate. Generated once: RSA keygen
 * is slow enough to dominate the suite if done per case.
 */
let unrelatedKeys: SamlKeyPair;

beforeAll(() => {
  idpKeys = generateRsaKeyPair();
  unrelatedKeys = generateRsaKeyPair();
});

const ACS_URL: string =
  "https://oneuptime.example.com/identity/sso-callback/6570b1d3e2f4a5c6d7e8f901/6570b1d3e2f4a5c6d7e8f902";
const AUDIENCE: string =
  "https://oneuptime.example.com/identity/sso/6570b1d3e2f4a5c6d7e8f902";
const MS_DISPLAY_NAME_CLAIM: string =
  "http://schemas.microsoft.com/identity/claims/displayname";

/*
 * ---------------------------------------------------------------------------
 * Provider documents.
 * ---------------------------------------------------------------------------
 */

// Okta. Uses saml2/saml2p prefixes and xsi-typed attribute values.
function oktaResponse(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><saml2p:Response xmlns:saml2p="urn:oasis:names:tc:SAML:2.0:protocol" Destination="${ACS_URL}" ID="id16901234567890123456789" InResponseTo="_a1b2c3d4e5f6" IssueInstant="2026-01-15T09:12:33.145Z" Version="2.0"><saml2:Issuer xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion" Format="urn:oasis:names:tc:SAML:2.0:nameid-format:entity">http://www.okta.com/exk1a2b3c4D5E6F7g8h9</saml2:Issuer><saml2p:Status><saml2p:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></saml2p:Status><saml2:Assertion xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion" ID="id16901234567890123456790" IssueInstant="2026-01-15T09:12:33.145Z" Version="2.0"><saml2:Issuer Format="urn:oasis:names:tc:SAML:2.0:nameid-format:entity">http://www.okta.com/exk1a2b3c4D5E6F7g8h9</saml2:Issuer><saml2:Subject><saml2:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">isaac.brock@example.com</saml2:NameID><saml2:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml2:SubjectConfirmationData InResponseTo="_a1b2c3d4e5f6" NotOnOrAfter="2026-01-15T09:17:33.145Z" Recipient="${ACS_URL}"/></saml2:SubjectConfirmation></saml2:Subject><saml2:Conditions NotBefore="2026-01-15T09:07:33.145Z" NotOnOrAfter="2026-01-15T09:17:33.145Z"><saml2:AudienceRestriction><saml2:Audience>${AUDIENCE}</saml2:Audience></saml2:AudienceRestriction></saml2:Conditions><saml2:AuthnStatement AuthnInstant="2026-01-15T09:12:33.145Z" SessionIndex="_a1b2c3d4e5f6"><saml2:AuthnContext><saml2:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml2:AuthnContextClassRef></saml2:AuthnContext></saml2:AuthnStatement><saml2:AttributeStatement><saml2:Attribute Name="email" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:unspecified"><saml2:AttributeValue xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="xs:string">isaac.brock@example.com</saml2:AttributeValue></saml2:Attribute><saml2:Attribute Name="firstName" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:unspecified"><saml2:AttributeValue xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="xs:string">Isaac</saml2:AttributeValue></saml2:Attribute><saml2:Attribute Name="lastName" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:unspecified"><saml2:AttributeValue xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="xs:string">Brock</saml2:AttributeValue></saml2:Attribute><saml2:Attribute Name="groups" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:unspecified"><saml2:AttributeValue xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="xs:string">Everyone</saml2:AttributeValue><saml2:AttributeValue xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="xs:string">Engineering</saml2:AttributeValue></saml2:Attribute></saml2:AttributeStatement></saml2:Assertion></saml2p:Response>`;
}

/*
 * Microsoft Entra ID (Azure AD). The only family of providers whose display
 * name claim SSOUtil reads.
 */
function entraIdResponse(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_5f2a1b3c-4d5e-6f70-8192-a3b4c5d6e7f8" Version="2.0" IssueInstant="2026-01-15T09:12:33.145Z" Destination="${ACS_URL}" InResponseTo="_a1b2c3d4e5f6"><Issuer xmlns="urn:oasis:names:tc:SAML:2.0:assertion">https://sts.windows.net/9188040d-6c67-4c5b-b112-36a304b66dad/</Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><Assertion xmlns="urn:oasis:names:tc:SAML:2.0:assertion" ID="_b1c2d3e4-f5a6-7b8c-9d0e-1f2a3b4c5d6e" IssueInstant="2026-01-15T09:12:33.145Z" Version="2.0"><Issuer>https://sts.windows.net/9188040d-6c67-4c5b-b112-36a304b66dad/</Issuer><Subject><NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">abe.lincoln@contoso.com</NameID><SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><SubjectConfirmationData InResponseTo="_a1b2c3d4e5f6" NotOnOrAfter="2026-01-15T09:17:33.145Z" Recipient="${ACS_URL}"/></SubjectConfirmation></Subject><Conditions NotBefore="2026-01-15T09:07:33.145Z" NotOnOrAfter="2026-01-15T10:12:33.145Z"><AudienceRestriction><Audience>${AUDIENCE}</Audience></AudienceRestriction></Conditions><AttributeStatement><Attribute Name="http://schemas.microsoft.com/identity/claims/tenantid"><AttributeValue>9188040d-6c67-4c5b-b112-36a304b66dad</AttributeValue></Attribute><Attribute Name="http://schemas.microsoft.com/identity/claims/objectidentifier"><AttributeValue>00000000-0000-0000-66f3-3332eca7ea81</AttributeValue></Attribute><Attribute Name="${MS_DISPLAY_NAME_CLAIM}"><AttributeValue>Abe Lincoln</AttributeValue></Attribute><Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"><AttributeValue>Abe</AttributeValue></Attribute><Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname"><AttributeValue>Lincoln</AttributeValue></Attribute><Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"><AttributeValue>abe.lincoln@contoso.com</AttributeValue></Attribute></AttributeStatement><AuthnStatement AuthnInstant="2026-01-15T09:12:30.000Z" SessionIndex="_b1c2d3e4-f5a6-7b8c-9d0e-1f2a3b4c5d6e"><AuthnContext><AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</AuthnContextClassRef></AuthnContext></AuthnStatement></Assertion></samlp:Response>`;
}

// AD FS. Pretty-printed, as ADFS emits it, with the same MS claim URIs.
function adfsResponse(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_c3d4e5f6-a7b8-9012-cdef-345678901234" Version="2.0" IssueInstant="2026-01-15T09:12:33.145Z" Destination="${ACS_URL}" Consent="urn:oasis:names:tc:SAML:2.0:consent:unspecified" InResponseTo="_a1b2c3d4e5f6">
  <saml:Issuer>http://adfs.example.com/adfs/services/trust</saml:Issuer>
  <samlp:Status>
    <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
  </samlp:Status>
  <saml:Assertion ID="_d4e5f6a7-b8c9-0123-defa-456789012345" IssueInstant="2026-01-15T09:12:33.145Z" Version="2.0">
    <saml:Issuer>http://adfs.example.com/adfs/services/trust</saml:Issuer>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">sam.carter@example.com</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData InResponseTo="_a1b2c3d4e5f6" NotOnOrAfter="2026-01-15T09:17:33.145Z" Recipient="${ACS_URL}"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="2026-01-15T09:12:33.129Z" NotOnOrAfter="2026-01-15T10:12:33.129Z">
      <saml:AudienceRestriction>
        <saml:Audience>${AUDIENCE}</saml:Audience>
      </saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AttributeStatement>
      <saml:Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress">
        <saml:AttributeValue>sam.carter@example.com</saml:AttributeValue>
      </saml:Attribute>
      <saml:Attribute Name="${MS_DISPLAY_NAME_CLAIM}">
        <saml:AttributeValue>Sam Carter</saml:AttributeValue>
      </saml:Attribute>
      <saml:Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn">
        <saml:AttributeValue>sam.carter@example.com</saml:AttributeValue>
      </saml:Attribute>
    </saml:AttributeStatement>
    <saml:AuthnStatement AuthnInstant="2026-01-15T09:12:32.000Z" SessionIndex="_d4e5f6a7-b8c9-0123-defa-456789012345">
      <saml:AuthnContext>
        <saml:AuthnContextClassRef>urn:federation:authentication:windows</saml:AuthnContextClassRef>
      </saml:AuthnContext>
    </saml:AuthnStatement>
  </saml:Assertion>
</samlp:Response>`;
}

// Google Workspace. Notably sends no attribute statement by default.
function googleWorkspaceResponse(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_e5f6a7b8c90123defa456789012345ab" Version="2.0" IssueInstant="2026-01-15T09:12:33.145Z" Destination="${ACS_URL}" InResponseTo="_a1b2c3d4e5f6"><saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">https://accounts.google.com/o/saml2?idpid=C01abcdefg</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_f6a7b8c90123defa456789012345abcd" IssueInstant="2026-01-15T09:12:33.145Z" Version="2.0"><saml:Issuer>https://accounts.google.com/o/saml2?idpid=C01abcdefg</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">jane.smith@example.com</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="_a1b2c3d4e5f6" NotOnOrAfter="2026-01-15T09:17:33.145Z" Recipient="${ACS_URL}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="2026-01-15T09:07:33.145Z" NotOnOrAfter="2026-01-15T09:17:33.145Z"><saml:AudienceRestriction><saml:Audience>${AUDIENCE}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="2026-01-15T09:12:33.145Z" SessionIndex="_f6a7b8c90123defa456789012345abcd"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement></saml:Assertion></samlp:Response>`;
}

// Auth0.
function auth0Response(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" Destination="${ACS_URL}" ID="_a7b8c90123defa456789" InResponseTo="_a1b2c3d4e5f6" IssueInstant="2026-01-15T09:12:33.145Z" Version="2.0"><saml:Issuer>urn:oneuptime.us.auth0.com</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="_b8c90123defa45678901" IssueInstant="2026-01-15T09:12:33.145Z" Version="2.0"><saml:Issuer>urn:oneuptime.us.auth0.com</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">jane@example.com</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="_a1b2c3d4e5f6" NotOnOrAfter="2026-01-15T10:12:33.145Z" Recipient="${ACS_URL}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="2026-01-15T09:12:33.145Z" NotOnOrAfter="2026-01-15T10:12:33.145Z"><saml:AudienceRestriction><saml:Audience>${AUDIENCE}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AttributeStatement xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><saml:Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"><saml:AttributeValue xsi:type="xs:string">auth0|5f7c8ec7c33c6c004bbafe82</saml:AttributeValue></saml:Attribute><saml:Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"><saml:AttributeValue xsi:type="xs:string">jane@example.com</saml:AttributeValue></saml:Attribute><saml:Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"><saml:AttributeValue xsi:type="xs:string">Jane Smith</saml:AttributeValue></saml:Attribute></saml:AttributeStatement><saml:AuthnStatement AuthnInstant="2026-01-15T09:12:33.145Z" SessionIndex="_b8c90123defa45678901"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:unspecified</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement></saml:Assertion></samlp:Response>`;
}

// Keycloak.
function keycloakResponse(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" Destination="${ACS_URL}" ID="ID_c90123de-fa45-6789-0123-456789abcdef" InResponseTo="_a1b2c3d4e5f6" IssueInstant="2026-01-15T09:12:33.145Z" Version="2.0"><saml:Issuer>https://keycloak.example.com/realms/oneuptime</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="ID_d0123def-a456-7890-1234-56789abcdef0" IssueInstant="2026-01-15T09:12:33.145Z" Version="2.0"><saml:Issuer>https://keycloak.example.com/realms/oneuptime</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">jdoe@example.com</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="_a1b2c3d4e5f6" NotOnOrAfter="2026-01-15T09:17:33.145Z" Recipient="${ACS_URL}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="2026-01-15T09:12:03.145Z" NotOnOrAfter="2026-01-15T09:17:33.145Z"><saml:AudienceRestriction><saml:Audience>${AUDIENCE}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="2026-01-15T09:12:33.145Z" SessionIndex="b1f0a1a4-3f2b-4f0e-9c1a-2b3c4d5e6f70::abcdef01"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:unspecified</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute FriendlyName="email" Name="urn:oid:1.2.840.113549.1.9.1" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri"><saml:AttributeValue xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="xs:string">jdoe@example.com</saml:AttributeValue></saml:Attribute><saml:Attribute FriendlyName="givenName" Name="urn:oid:2.5.4.42" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri"><saml:AttributeValue xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="xs:string">John</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion></samlp:Response>`;
}

// OneLogin.
function oneLoginResponse(): string {
  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" Destination="${ACS_URL}" ID="R1e2f3a4b5c6d7e8f90123456789abcdef" InResponseTo="_a1b2c3d4e5f6" IssueInstant="2026-01-15T09:12:33Z" Version="2.0"><saml:Issuer>https://app.onelogin.com/saml/metadata/1234567</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="pfx1e2f3a4-b5c6-d7e8-f901-23456789abcd" IssueInstant="2026-01-15T09:12:33Z" Version="2.0"><saml:Issuer>https://app.onelogin.com/saml/metadata/1234567</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">maria.garcia@example.com</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="_a1b2c3d4e5f6" NotOnOrAfter="2026-01-15T09:15:33Z" Recipient="${ACS_URL}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="2026-01-15T09:09:33Z" NotOnOrAfter="2026-01-15T09:15:33Z"><saml:AudienceRestriction><saml:Audience>${AUDIENCE}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="2026-01-15T09:12:32Z" SessionIndex="_1e2f3a4b5c6d7e8f9012" SessionNotOnOrAfter="2026-01-16T09:12:33Z"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute Name="User.email" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:basic"><saml:AttributeValue xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="xs:string">maria.garcia@example.com</saml:AttributeValue></saml:Attribute><saml:Attribute Name="User.FirstName" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:basic"><saml:AttributeValue xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="xs:string">Maria</saml:AttributeValue></saml:Attribute><saml:Attribute Name="memberOf" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:basic"><saml:AttributeValue xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="xs:string">Engineering</saml:AttributeValue><saml:AttributeValue xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="xs:string">On-Call</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion></samlp:Response>`;
}

// PingFederate / PingOne.
function pingResponse(): string {
  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" Destination="${ACS_URL}" ID="OyLnHiFCDPvCTuFcOxaVzKmSMBd" InResponseTo="_a1b2c3d4e5f6" IssueInstant="2026-01-15T09:12:33.145Z" Version="2.0"><saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">https://auth.pingone.com/1e2f3a4b-5c6d-7e8f-9012-3456789abcde</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="fJKQpTbLYnMWaXsRvUeGhZdCiEo" IssueInstant="2026-01-15T09:12:33.145Z" Version="2.0"><saml:Issuer>https://auth.pingone.com/1e2f3a4b-5c6d-7e8f-9012-3456789abcde</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified">chen.wei@example.com</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="_a1b2c3d4e5f6" NotOnOrAfter="2026-01-15T09:17:33.145Z" Recipient="${ACS_URL}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="2026-01-15T09:07:33.145Z" NotOnOrAfter="2026-01-15T09:17:33.145Z"><saml:AudienceRestriction><saml:Audience>${AUDIENCE}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="2026-01-15T09:12:33.145Z" SessionIndex="fJKQpTbLYnMWaXsRvUeGhZdCiEo"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:unspecified</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute Name="mail" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:basic"><saml:AttributeValue xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="xs:string">chen.wei@example.com</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion></samlp:Response>`;
}

/*
 * Shibboleth. A persistent, opaque NameID — no email in the subject at all —
 * which is the one real-world shape this implementation genuinely cannot use,
 * since the email is only ever read from the NameID.
 */
function shibbolethPersistentNameIdResponse(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" Destination="${ACS_URL}" ID="_2f3a4b5c6d7e8f90123456789abcdef0" InResponseTo="_a1b2c3d4e5f6" IssueInstant="2026-01-15T09:12:33.145Z" Version="2.0"><saml:Issuer>https://idp.university.example.edu/idp/shibboleth</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="_3a4b5c6d7e8f90123456789abcdef012" IssueInstant="2026-01-15T09:12:33.145Z" Version="2.0"><saml:Issuer>https://idp.university.example.edu/idp/shibboleth</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent" NameQualifier="https://idp.university.example.edu/idp/shibboleth" SPNameQualifier="${AUDIENCE}">bWFyaWEuZ2FyY2lhQGV4YW1wbGUuZWR1</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData Address="203.0.113.10" InResponseTo="_a1b2c3d4e5f6" NotOnOrAfter="2026-01-15T09:17:33.145Z" Recipient="${ACS_URL}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="2026-01-15T09:12:33.145Z" NotOnOrAfter="2026-01-15T09:17:33.145Z"><saml:AudienceRestriction><saml:Audience>${AUDIENCE}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="2026-01-15T09:12:33.145Z" SessionIndex="_4b5c6d7e8f90123456789abcdef01234"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute FriendlyName="mail" Name="urn:oid:0.9.2342.19200300.100.1.3" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri"><saml:AttributeValue>maria.garcia@example.edu</saml:AttributeValue></saml:Attribute><saml:Attribute FriendlyName="displayName" Name="urn:oid:2.16.840.1.113730.3.1.241" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri"><saml:AttributeValue>Maria Garcia</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion></samlp:Response>`;
}

/*
 * ---------------------------------------------------------------------------
 * Tests.
 * ---------------------------------------------------------------------------
 */

interface ProviderCase {
  vendor: string;
  document: () => string;
  expectedEmail: string;
  // Only Entra ID and ADFS send the Microsoft displayname claim.
  expectedName: string | null;
}

const providers: Array<ProviderCase> = [
  {
    vendor: "Okta",
    document: oktaResponse,
    expectedEmail: "isaac.brock@example.com",
    expectedName: null,
  },
  {
    vendor: "Microsoft Entra ID",
    document: entraIdResponse,
    expectedEmail: "abe.lincoln@contoso.com",
    expectedName: "Abe Lincoln",
  },
  {
    vendor: "AD FS",
    document: adfsResponse,
    expectedEmail: "sam.carter@example.com",
    expectedName: "Sam Carter",
  },
  {
    vendor: "Google Workspace",
    document: googleWorkspaceResponse,
    expectedEmail: "jane.smith@example.com",
    expectedName: null,
  },
  {
    vendor: "Auth0",
    document: auth0Response,
    expectedEmail: "jane@example.com",
    expectedName: null,
  },
  {
    vendor: "Keycloak",
    document: keycloakResponse,
    expectedEmail: "jdoe@example.com",
    expectedName: null,
  },
  {
    vendor: "OneLogin",
    document: oneLoginResponse,
    expectedEmail: "maria.garcia@example.com",
    expectedName: null,
  },
  {
    vendor: "PingOne",
    document: pingResponse,
    expectedEmail: "chen.wei@example.com",
    expectedName: null,
  },
];

describe("SSOUtil - assertion-signed responses from real providers", () => {
  test.each(providers)(
    "accepts a $vendor assertion and extracts the identity",
    (providerCase: ProviderCase) => {
      const xml: string = signElement(
        providerCase.document(),
        "Assertion",
        idpKeys.privateKey,
      );

      const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
        xml,
        idpKeys.publicKey,
      );

      expect(result.email.toString()).toBe(providerCase.expectedEmail);

      if (providerCase.expectedName === null) {
        expect(result.name).toBeNull();
      } else {
        expect(result.name?.toString()).toBe(providerCase.expectedName);
      }
    },
  );

  test.each(providers)(
    "reports a $vendor assertion signature as valid",
    (providerCase: ProviderCase) => {
      const xml: string = signElement(
        providerCase.document(),
        "Assertion",
        idpKeys.privateKey,
      );

      expect(SSOUtil.isSignatureValid(xml, idpKeys.publicKey)).toBe(true);
    },
  );
});

describe("SSOUtil - response-signed documents from real providers", () => {
  test.each(providers)(
    "accepts a $vendor response signed at the Response level",
    (providerCase: ProviderCase) => {
      const xml: string = signElement(
        providerCase.document(),
        "Response",
        idpKeys.privateKey,
      );

      const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
        xml,
        idpKeys.publicKey,
      );

      expect(result.email.toString()).toBe(providerCase.expectedEmail);
    },
  );
});

describe("SSOUtil - signature placed where real providers put it", () => {
  /*
   * Okta, Entra ID, ADFS and Shibboleth all emit the <Signature> immediately
   * after the assertion's <Issuer>, not appended at the end of the assertion.
   */
  test.each(providers)(
    "accepts a $vendor assertion whose Signature follows the Issuer",
    (providerCase: ProviderCase) => {
      const xml: string = signElementAfterIssuer(
        providerCase.document(),
        "Assertion",
        idpKeys.privateKey,
      );

      const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
        xml,
        idpKeys.publicKey,
      );

      expect(result.email.toString()).toBe(providerCase.expectedEmail);
    },
  );
});

describe("SSOUtil - the base64 payload the ACS actually receives", () => {
  /*
   * The IdP posts SAMLResponse as base64. Decoding and verifying it is the
   * whole server-side path, so exercise it as one piece rather than assuming
   * the decode is lossless for these documents.
   */
  test.each(providers)(
    "round-trips a $vendor response through base64 as the ACS does",
    (providerCase: ProviderCase) => {
      const signed: string = signElement(
        providerCase.document(),
        "Assertion",
        idpKeys.privateKey,
      );

      const posted: string = toBase64(signed);
      const decoded: string = Buffer.from(posted, "base64").toString();

      const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
        decoded,
        idpKeys.publicKey,
      );

      expect(result.email.toString()).toBe(providerCase.expectedEmail);
    },
  );
});

describe("SSOUtil - real documents are still held to the security rules", () => {
  test.each(providers)(
    "rejects a $vendor response verified against the wrong certificate",
    (providerCase: ProviderCase) => {
      const xml: string = signElement(
        providerCase.document(),
        "Assertion",
        idpKeys.privateKey,
      );

      expect(SSOUtil.isSignatureValid(xml, unrelatedKeys.publicKey)).toBe(
        false,
      );
      expect(() => {
        return SSOUtil.getSamlResponseFromXML(xml, unrelatedKeys.publicKey);
      }).toThrow();
    },
  );

  test.each(providers)(
    "rejects a $vendor response whose NameID was edited after signing",
    (providerCase: ProviderCase) => {
      const xml: string = signElement(
        providerCase.document(),
        "Assertion",
        idpKeys.privateKey,
      );

      const tampered: string = xml.replace(
        providerCase.expectedEmail,
        "attacker@evil.example.com",
      );

      expect(tampered).not.toBe(xml);
      expect(SSOUtil.isSignatureValid(tampered, idpKeys.publicKey)).toBe(false);
    },
  );

  test("rejects an unsigned response that is otherwise a valid Okta document", () => {
    expect(SSOUtil.isSignatureValid(oktaResponse(), idpKeys.publicKey)).toBe(
      false,
    );
    expect(() => {
      return SSOUtil.getSamlResponseFromXML(oktaResponse(), idpKeys.publicKey);
    }).toThrow();
  });
});

describe("SSOUtil - NameID shapes seen in the wild", () => {
  /*
   * A persistent, opaque NameID carries no address, and the email lives in a
   * `mail` attribute this implementation does not read. The login is refused
   * outright — Email rejects the opaque handle as malformed — rather than
   * creating a user whose address is a base64 blob. Worth pinning: the
   * safe outcome here comes from Email's format check, so anything that
   * loosened that validation would silently turn this into account creation.
   */
  test("a Shibboleth persistent NameID is refused rather than becoming an address", () => {
    const xml: string = signElement(
      shibbolethPersistentNameIdResponse(),
      "Assertion",
      idpKeys.privateKey,
    );

    expect(() => {
      return SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey);
    }).toThrow("is not in valid format");

    /*
     * isSignatureValid reports false here even though the signature itself is
     * sound: it runs the whole extraction and answers "is this document
     * usable", not "does the cryptography check out".
     */
    expect(SSOUtil.isSignatureValid(xml, idpKeys.publicKey)).toBe(false);
  });

  test("an unspecified NameID format carrying an address is accepted", () => {
    const xml: string = signElement(
      pingResponse(),
      "Assertion",
      idpKeys.privateKey,
    );

    const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
      xml,
      idpKeys.publicKey,
    );

    expect(result.email.toString()).toBe("chen.wei@example.com");
  });
});

describe("SSOUtil - provider formatting quirks", () => {
  test("pretty-printed XML with indentation and newlines is handled", () => {
    const xml: string = signElement(
      adfsResponse(),
      "Assertion",
      idpKeys.privateKey,
    );

    expect(xml).toContain("\n");

    const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
      xml,
      idpKeys.publicKey,
    );

    // Whitespace around the NameID text must not leak into the address.
    expect(result.email.toString()).toBe("sam.carter@example.com");
    expect(result.name?.toString()).toBe("Sam Carter");
  });

  test("an XML declaration present at signing time is handled", () => {
    const xml: string = signElement(
      oktaResponse(),
      "Assertion",
      idpKeys.privateKey,
    );

    expect(xml).toContain("<?xml");

    expect(
      SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey).email.toString(),
    ).toBe("isaac.brock@example.com");
  });

  test("a document with no XML declaration is handled", () => {
    const xml: string = signElement(
      oneLoginResponse(),
      "Assertion",
      idpKeys.privateKey,
    );

    expect(xml.startsWith("<?xml")).toBe(false);

    expect(
      SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey).email.toString(),
    ).toBe("maria.garcia@example.com");
  });

  test("a multi-valued attribute alongside the identity does not confuse extraction", () => {
    const xml: string = signElement(
      oneLoginResponse(),
      "Assertion",
      idpKeys.privateKey,
    );

    // memberOf carries two AttributeValues in this document.
    expect(xml).toContain("On-Call");

    expect(
      SSOUtil.getSamlResponseFromXML(xml, idpKeys.publicKey).email.toString(),
    ).toBe("maria.garcia@example.com");
  });

  test("the default-namespace layout Entra ID uses is handled", () => {
    const xml: string = signElement(
      entraIdResponse(),
      "Assertion",
      idpKeys.privateKey,
    );

    // Entra puts the assertion in a default xmlns, with samlp: only on Response.
    expect(xml).toContain(
      '<Assertion xmlns="urn:oasis:names:tc:SAML:2.0:assertion"',
    );

    const result: VerifiedSamlResponse = SSOUtil.getSamlResponseFromXML(
      xml,
      idpKeys.publicKey,
    );

    expect(result.email.toString()).toBe("abe.lincoln@contoso.com");
    expect(result.name?.toString()).toBe("Abe Lincoln");
  });
});
