import { describe, expect, test } from "@jest/globals";
import { createHash } from "crypto";
import { sha256 } from "../../../Utils/DataSecurity/Sha256";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * THE SHA-256 BEHIND BASE58CHECK.
 *
 * Held to the FIPS 180-2 examples and, for every length around the 64-byte
 * block and its 56-byte padding boundary, to Node's own crypto.
 */

function asciiBytes(text: string): Uint8Array {
  const bytes: Uint8Array = new Uint8Array(text.length);

  for (let index: number = 0; index < text.length; index++) {
    bytes[index] = text.charCodeAt(index);
  }

  return bytes;
}

function hex(bytes: Uint8Array): string {
  let text: string = "";

  for (const byte of bytes) {
    text += byte.toString(16).padStart(2, "0");
  }

  return text;
}

function nodeSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("sha256", () => {
  test.each([
    [
      "the empty message",
      "",
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ],
    [
      "abc",
      "abc",
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    ],
    [
      "the 448-bit message",
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
    [
      "the 896-bit message",
      "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
      "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
    ],
  ])(
    "hashes %s as FIPS 180-2 prints it, and as Node does",
    (_name: string, message: string, digest: string) => {
      const bytes: Uint8Array = asciiBytes(message);

      expect(hex(sha256(bytes))).toBe(digest);
      expect(hex(sha256(bytes))).toBe(nodeSha256(bytes));
    },
  );

  test("hashes a million 'a' characters, across thousands of blocks", () => {
    const bytes: Uint8Array = new Uint8Array(1_000_000).fill(0x61);

    expect(hex(sha256(bytes))).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
    expect(hex(sha256(bytes))).toBe(nodeSha256(bytes));
  });

  test("agrees with Node for every length from 0 to 300 bytes", () => {
    const random: SeededRandom = seededRandom(25_600);

    for (let length: number = 0; length <= 300; length++) {
      const bytes: Uint8Array = new Uint8Array(length);

      for (let index: number = 0; index < length; index++) {
        bytes[index] = random(256);
      }

      expect([length, hex(sha256(bytes))]).toEqual([length, nodeSha256(bytes)]);
    }
  });

  test("returns 32 bytes and leaves the message as it was", () => {
    const bytes: Uint8Array = asciiBytes("abc");
    const digest: Uint8Array = sha256(bytes);

    expect(digest).toBeInstanceOf(Uint8Array);
    expect(digest).toHaveLength(32);
    expect(Array.from(bytes)).toEqual([0x61, 0x62, 0x63]);
  });

  test("hashes a digest again, as Base58Check's double hash does", () => {
    const once: Uint8Array = sha256(asciiBytes("hello"));

    expect(hex(sha256(once))).toBe(nodeSha256(Uint8Array.from(once)));
  });
});
