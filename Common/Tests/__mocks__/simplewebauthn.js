// Mock for @simplewebauthn/server package
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
      credentialID: Buffer.from("mock-credential-id"),
      credentialPublicKey: Buffer.from("mock-public-key"),
      counter: 0,
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
    },
  }),
};
