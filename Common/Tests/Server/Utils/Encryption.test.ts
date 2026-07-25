import Encryption from "../../../Server/Utils/Encryption";

describe("Encryption", () => {
  describe("encrypt", () => {
    test("should return an empty string for empty input", async () => {
      expect(await Encryption.encrypt("")).toEqual("");
    });

    test("should not return the plain text", async () => {
      const plainText: string = "super-secret-value";
      const cipherText: string = await Encryption.encrypt(plainText);

      expect(cipherText).not.toEqual(plainText);
      expect(cipherText.length).toBeGreaterThan(0);
    });

    test("should produce a different cipher text each time because of the random salt", async () => {
      const first: string = await Encryption.encrypt("same-input");
      const second: string = await Encryption.encrypt("same-input");

      expect(first).not.toEqual(second);
    });
  });

  describe("decrypt", () => {
    test("should return an empty string for empty input", async () => {
      expect(await Encryption.decrypt("")).toEqual("");
    });

    test("should round trip a value", async () => {
      const plainText: string = "round-trip-me";

      expect(
        await Encryption.decrypt(await Encryption.encrypt(plainText)),
      ).toEqual(plainText);
    });

    test("should round trip unicode and long values", async () => {
      const unicode: string = "héllo wörld 🚀 — ünïcodé";
      const long: string = "a".repeat(5000);

      expect(
        await Encryption.decrypt(await Encryption.encrypt(unicode)),
      ).toEqual(unicode);
      expect(await Encryption.decrypt(await Encryption.encrypt(long))).toEqual(
        long,
      );
    });

    test("should round trip json shaped strings", async () => {
      const json: string = JSON.stringify({
        apiKey: "abc-123",
        nested: { value: 42 },
      });

      expect(await Encryption.decrypt(await Encryption.encrypt(json))).toEqual(
        json,
      );
    });

    test("should decrypt every random cipher text of the same input back to that input", async () => {
      const plainText: string = "same-input";
      const first: string = await Encryption.encrypt(plainText);
      const second: string = await Encryption.encrypt(plainText);

      expect(await Encryption.decrypt(first)).toEqual(plainText);
      expect(await Encryption.decrypt(second)).toEqual(plainText);
    });
  });
});
