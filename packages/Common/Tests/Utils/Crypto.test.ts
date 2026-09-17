import Crypto from "../../Utils/Crypto";

describe("Crypto", () => {
  describe("getMd5Hash", () => {
    test("should return the known md5 hash of a string", () => {
      expect(Crypto.getMd5Hash("hello")).toEqual(
        "5d41402abc4b2a76b9719d911017c592",
      );
    });

    test("should return a 32 character lowercase hex digest", () => {
      expect(Crypto.getMd5Hash("oneuptime")).toMatch(/^[0-9a-f]{32}$/);
    });

    test("should be deterministic and case sensitive", () => {
      expect(Crypto.getMd5Hash("OneUptime")).toEqual(
        Crypto.getMd5Hash("OneUptime"),
      );
      expect(Crypto.getMd5Hash("OneUptime")).not.toEqual(
        Crypto.getMd5Hash("oneuptime"),
      );
    });
  });

  describe("getSha256Hash", () => {
    test("should return the known sha256 hash of a string", () => {
      expect(Crypto.getSha256Hash("hello")).toEqual(
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      );
    });

    test("should return a 64 character lowercase hex digest", () => {
      expect(Crypto.getSha256Hash("oneuptime")).toMatch(/^[0-9a-f]{64}$/);
    });

    test("should hash the empty string", () => {
      expect(Crypto.getSha256Hash("")).toEqual(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
    });
  });

  test("md5 and sha256 of the same input should differ", () => {
    expect(Crypto.getMd5Hash("hello")).not.toEqual(
      Crypto.getSha256Hash("hello"),
    );
  });
});
