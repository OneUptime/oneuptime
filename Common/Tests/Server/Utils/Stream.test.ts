import StreamUtil from "../../../Server/Utils/Stream";
import { PassThrough, Readable } from "stream";

describe("StreamUtil", () => {
  describe("convertStreamToText", () => {
    test("should concatenate chunks in order", async () => {
      const stream: Readable = Readable.from(["hello ", "world"]);

      expect(await StreamUtil.convertStreamToText(stream)).toEqual(
        "hello world",
      );
    });

    test("should return an empty string for an empty stream", async () => {
      expect(await StreamUtil.convertStreamToText(Readable.from([]))).toEqual(
        "",
      );
    });

    test("should handle buffer chunks", async () => {
      const stream: Readable = Readable.from([
        Buffer.from("abc"),
        Buffer.from("def"),
      ]);

      expect(await StreamUtil.convertStreamToText(stream)).toEqual("abcdef");
    });

    test("should decode multi-byte characters split across chunks", async () => {
      /*
       * Chunks are collected as buffers and only decoded once at the end, so a
       * character whose bytes straddle a chunk boundary must still come out
       * intact.
       */
      const euro: Buffer = Buffer.from("€", "utf8");
      const stream: Readable = Readable.from([
        euro.subarray(0, 1),
        euro.subarray(1),
      ]);

      expect(await StreamUtil.convertStreamToText(stream)).toEqual("€");
    });

    test("should reject when the stream errors", async () => {
      const stream: PassThrough = new PassThrough();

      const result: Promise<string> = StreamUtil.convertStreamToText(stream);

      stream.emit("error", new Error("stream blew up"));

      await expect(result).rejects.toThrow("stream blew up");
    });
  });

  describe("toStringArray", () => {
    test("should split the stream on newlines", async () => {
      const stream: Readable = Readable.from(["first\nsecond\nthird"]);

      expect(await StreamUtil.toStringArray(stream)).toEqual([
        "first",
        "second",
        "third",
      ]);
    });

    test("should keep the trailing empty entry from a trailing newline", async () => {
      // split() on a trailing separator yields a final empty string.
      expect(await StreamUtil.toStringArray(Readable.from(["a\n"]))).toEqual([
        "a",
        "",
      ]);
    });

    test("should return a single empty entry for an empty stream", async () => {
      expect(await StreamUtil.toStringArray(Readable.from([]))).toEqual([""]);
    });

    test("should not split lines that span chunk boundaries", async () => {
      const stream: Readable = Readable.from(["fir", "st\nsec", "ond"]);

      expect(await StreamUtil.toStringArray(stream)).toEqual([
        "first",
        "second",
      ]);
    });
  });
});
