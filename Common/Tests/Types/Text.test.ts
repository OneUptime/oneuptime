import Text from "../../Types/Text";

describe("class Text", () => {
  test("Text.uppercaseFirstLetter should make string first letter Uppercase", () => {
    expect(Text.uppercaseFirstLetter("text")).toEqual("Text");
    expect(Text.uppercaseFirstLetter("another test")).toEqual("Another test");
  });

  describe("Text.convertOtlpIdToHex", () => {
    test("passes 32-char hex trace ids through, normalised to lowercase", () => {
      const hexTraceId: string = "4BF92F3577B34DA6A3CE929D0E0E4736";
      expect(Text.convertOtlpIdToHex(hexTraceId)).toEqual(
        "4bf92f3577b34da6a3ce929d0e0e4736",
      );
      expect(
        Text.convertOtlpIdToHex("4bf92f3577b34da6a3ce929d0e0e4736"),
      ).toEqual("4bf92f3577b34da6a3ce929d0e0e4736");
    });

    test("passes 16-char hex span ids through, normalised to lowercase", () => {
      expect(Text.convertOtlpIdToHex("00F067AA0BA902B7")).toEqual(
        "00f067aa0ba902b7",
      );
    });

    test("decodes base64 ids (the OTLP/protobuf wire form) to hex", () => {
      // 16-byte trace id -> 24-char base64 -> 32-char hex
      const traceIdBytes: Buffer = Buffer.from(
        "4bf92f3577b34da6a3ce929d0e0e4736",
        "hex",
      );
      expect(Text.convertOtlpIdToHex(traceIdBytes.toString("base64"))).toEqual(
        "4bf92f3577b34da6a3ce929d0e0e4736",
      );

      // 8-byte span id -> 12-char base64 -> 16-char hex
      const spanIdBytes: Buffer = Buffer.from("00f067aa0ba902b7", "hex");
      expect(Text.convertOtlpIdToHex(spanIdBytes.toString("base64"))).toEqual(
        "00f067aa0ba902b7",
      );
    });

    test("returns empty string for missing ids", () => {
      expect(Text.convertOtlpIdToHex(undefined)).toEqual("");
      expect(Text.convertOtlpIdToHex("")).toEqual("");
    });

    test("hex detection requires the exact id lengths — other hex-looking strings still take the base64 path", () => {
      /*
       * A 24-char hex-only string is a valid base64 payload and is NOT
       * an OTLP hex id (ids are exactly 16 or 32 chars), so it must be
       * treated as base64 — same behaviour as convertBase64ToHex.
       */
      const ambiguous: string = "abcdefabcdefabcdefabcdef";
      expect(Text.convertOtlpIdToHex(ambiguous)).toEqual(
        Text.convertBase64ToHex(ambiguous),
      );
    });
  });
});
