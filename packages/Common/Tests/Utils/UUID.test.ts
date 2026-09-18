import UUID from "../../Utils/UUID";

const UUID_V4_REGEX: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const UUID_V7_REGEX: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// First 12 hex chars (hyphen removed) = the 48-bit unix-ms timestamp prefix.
function timestampPrefixOf(uuid: string): number {
  return parseInt(uuid.replace(/-/g, "").slice(0, 12), 16);
}

describe("UUID", () => {
  test("UUID.generate() should generate a valid UUID", () => {
    const uuid: string = UUID.generate();
    expect(uuid).toBeDefined();
    expect(uuid).toMatch(UUID_V4_REGEX);
    expect(uuid.length).toBe(36);
  });

  test("UUID.generateTimeOrdered() should generate a valid UUIDv7", () => {
    const uuid: string = UUID.generateTimeOrdered();
    expect(uuid).toMatch(UUID_V7_REGEX);
    expect(uuid.length).toBe(36);
  });

  test("UUID.generateTimeOrdered() prefix should encode the current unix-ms time", () => {
    const before: number = Date.now();
    const uuid: string = UUID.generateTimeOrdered();
    const after: number = Date.now();

    const prefix: number = timestampPrefixOf(uuid);
    expect(prefix).toBeGreaterThanOrEqual(before);
    expect(prefix).toBeLessThanOrEqual(after);
  });

  test("UUID.generateTimeOrdered() prefixes should be monotonically non-decreasing", async () => {
    const first: string = UUID.generateTimeOrdered();

    // Cross a millisecond boundary so the prefix strictly advances.
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 5);
    });

    const second: string = UUID.generateTimeOrdered();

    expect(timestampPrefixOf(second)).toBeGreaterThan(timestampPrefixOf(first));
    // Time-ordered ids sort lexicographically by generation time.
    expect(second > first).toBe(true);

    // Same burst: prefixes never go backwards.
    let previous: number = timestampPrefixOf(UUID.generateTimeOrdered());
    for (let i: number = 0; i < 100; i++) {
      const current: number = timestampPrefixOf(UUID.generateTimeOrdered());
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
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
