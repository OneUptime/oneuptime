import UUID from "../../Utils/UUID";

const UUID_V4_REGEX: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("UUID", () => {
  test("UUID.generate() should generate a valid UUID", () => {
    const uuid: string = UUID.generate();
    expect(uuid).toBeDefined();
    expect(uuid).toMatch(UUID_V4_REGEX);
    expect(uuid.length).toBe(36);
  });

  test("UUID.generate() should fall back to getRandomValues when randomUUID is unavailable", () => {
    const cryptoObj: Crypto = globalThis.crypto;
    const originalRandomUUID: typeof cryptoObj.randomUUID =
      cryptoObj.randomUUID.bind(cryptoObj);

    Object.defineProperty(cryptoObj, "randomUUID", {
      value: undefined,
      configurable: true,
    });

    try {
      const uuid: string = UUID.generate();
      expect(uuid).toMatch(UUID_V4_REGEX);
      expect(uuid.length).toBe(36);
    } finally {
      Object.defineProperty(cryptoObj, "randomUUID", {
        value: originalRandomUUID,
        configurable: true,
      });
    }
  });

  test("UUID.generate() should fall back to Math.random when Web Crypto is unavailable", () => {
    const originalCrypto: Crypto = globalThis.crypto;

    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
    });

    try {
      const uuid: string = UUID.generate();
      expect(uuid).toMatch(UUID_V4_REGEX);
      expect(uuid.length).toBe(36);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: originalCrypto,
        configurable: true,
      });
    }
  });
});
