/*
 * Mock for the @simplewebauthn/server package, wired in through
 * `moduleNameMapper` in Common/jest.config.json rather than through
 * jest.mock(), so every Common test that reaches UserWebAuthnService gets it
 * without asking.
 *
 * THE RETURN SHAPES MATTER. `registrationInfo.credential` is the v13 shape --
 * v7 and earlier put `credentialID` / `credentialPublicKey` at the top of
 * `registrationInfo`, and UserWebAuthnService reads the v13 one. A stub left
 * on the old shape does not fail loudly; it hands the service `undefined` and
 * the row is written with no credential id at all.
 *
 * WHAT THIS STUB CANNOT TELL YOU. It has no opinion about
 * `requireUserVerification`, which is exactly the library default that caused
 * issue #3652 -- so a test of that behaviour written against this stub would
 * have passed before the fix and after it. The end-to-end test of that lives
 * in App/Tests/FeatureSet/Identity/WebAuthnUserVerification.test.ts, where the
 * REAL library runs; what belongs here is assertions about the arguments the
 * service passes in.
 */

const MOCK_CREDENTIAL_ID = "mock-credential-id";

module.exports = {
  generateRegistrationOptions: jest.fn().mockResolvedValue({
    challenge: "mock-challenge",
    rp: { name: "Mock RP", id: "localhost" },
    user: { id: "user-id", name: "user@example.com", displayName: "User" },
    pubKeyCredParams: [],
    timeout: 60000,
    attestation: "none",
    excludeCredentials: [],
    authenticatorSelection: {},
  }),
  verifyRegistrationResponse: jest.fn().mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: MOCK_CREDENTIAL_ID,
        publicKey: Buffer.from("mock-public-key"),
        counter: 0,
        transports: ["internal"],
      },
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false,
    },
  }),
  generateAuthenticationOptions: jest.fn().mockResolvedValue({
    challenge: "mock-challenge",
    timeout: 60000,
    rpId: "localhost",
    allowCredentials: [],
    userVerification: "preferred",
  }),
  verifyAuthenticationResponse: jest.fn().mockResolvedValue({
    verified: true,
    authenticationInfo: {
      newCounter: 1,
      credentialID: MOCK_CREDENTIAL_ID,
      userVerified: false,
    },
  }),
};
