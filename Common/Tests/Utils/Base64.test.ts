import Base64 from "../../Utils/Base64";

describe("Base64", () => {
  describe("uint8ArrayToBase64Url", () => {
    test("should encode bytes without padding characters", () => {
      const bytes: Uint8Array = new Uint8Array([1, 2, 3, 4, 5]);
      const encoded: string = Base64.uint8ArrayToBase64Url(bytes);

      expect(encoded).not.toContain("=");
      expect(encoded).toEqual("AQIDBAU");
    });

    test("should use url safe alphabet instead of + and /", () => {
      // 0xFB 0xFF encodes to "+/8=" in standard base64.
      const bytes: Uint8Array = new Uint8Array([0xfb, 0xff]);
      const encoded: string = Base64.uint8ArrayToBase64Url(bytes);

      expect(encoded).not.toContain("+");
      expect(encoded).not.toContain("/");
      expect(encoded).toEqual("-_8");
    });

    test("should return an empty string for empty input", () => {
      expect(Base64.uint8ArrayToBase64Url(new Uint8Array([]))).toEqual("");
    });
  });

  describe("base64UrlToUint8Array", () => {
    test("should decode a url safe string back to the original bytes", () => {
      const decoded: Uint8Array = Base64.base64UrlToUint8Array("-_8");

      expect(Array.from(decoded)).toEqual([0xfb, 0xff]);
    });

    test("should return an empty array for empty input", () => {
      expect(Array.from(Base64.base64UrlToUint8Array(""))).toEqual([]);
    });
  });

  test("should round trip arbitrary bytes", () => {
    const bytes: Uint8Array = new Uint8Array([
      0, 1, 62, 63, 64, 127, 128, 200, 254, 255,
    ]);

    const roundTripped: Uint8Array = Base64.base64UrlToUint8Array(
      Base64.uint8ArrayToBase64Url(bytes),
    );

    expect(Array.from(roundTripped)).toEqual(Array.from(bytes));
  });
});
