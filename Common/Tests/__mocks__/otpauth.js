// Mock for otpauth package
module.exports = {
  HOTP: class HOTP {
    generate() {
      return "123456";
    }
    validate() {
      return true;
    }
  },
  TOTP: class TOTP {
    generate() {
      return "123456";
    }
    validate() {
      return true;
    }
  },
  Secret: class Secret {
    static fromBase32() {
      return new Secret();
    }
    base32 = "JBSWY3DPEHPK3PXP";
  },
  URI: {
    parse: jest.fn(),
    stringify: jest.fn(),
  },
  version: "9.0.0",
};
