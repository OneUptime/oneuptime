import {
  NostrCanonicalHost,
  NostrRootName,
  NostrRootNpub,
  NostrRootPublicKeyHex,
  generateNostrWellKnown,
  npubToPublicKeyHex,
} from "../Utils/Nostr";
import { JSONObject } from "Common/Types/JSON";

/*
 * The hex key a nostr client compares against the profile. Written out here
 * rather than derived, so a change to either the npub constant or the bech32
 * decoder has to be a deliberate edit to this file too.
 */
const expectedPublicKeyHex: string =
  "b210beb8f103f785fdccb9e953379174b7999d7b017062fdf179944ff49a758e";

describe("Nostr", () => {
  test("the account npub decodes to its 32-byte hex public key", () => {
    expect(npubToPublicKeyHex(NostrRootNpub)).toBe(expectedPublicKeyHex);
    expect(NostrRootPublicKeyHex).toBe(expectedPublicKeyHex);
    expect(NostrRootPublicKeyHex).toMatch(/^[0-9a-f]{64}$/);
  });

  test("the decoder agrees with the NIP-19 specification's own example", () => {
    /*
     * A vector from outside this repository, so the decoder is pinned to the
     * spec rather than only to itself and the key above.
     */
    expect(
      npubToPublicKeyHex(
        "npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg",
      ),
    ).toBe("7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e");
  });

  test("the npub is rejected when its checksum, prefix or charset is wrong", () => {
    // Last character flipped: valid charset, broken checksum.
    expect(() => {
      return npubToPublicKeyHex(`${NostrRootNpub.slice(0, -1)}q`);
    }).toThrow("checksum");

    // A well-formed bech32 value that is not a public key (nsec, note, ...).
    expect(() => {
      return npubToPublicKeyHex(NostrRootNpub.replace("npub1", "nsec1"));
    }).toThrow("npub prefix");

    // "b" and "i" are not in the bech32 charset.
    expect(() => {
      return npubToPublicKeyHex(`${NostrRootNpub.slice(0, -1)}b`);
    }).toThrow("bad character");

    expect(() => {
      return npubToPublicKeyHex(NostrRootNpub.toUpperCase());
    }).toThrow("upper case");

    expect(() => {
      return npubToPublicKeyHex("npub1qqqqqq");
    }).toThrow();
  });

  test("the document publishes the account under the root name", () => {
    const document: JSONObject = generateNostrWellKnown({
      host: NostrCanonicalHost,
    });
    const names: JSONObject = document["names"] as JSONObject;

    expect(NostrRootName).toBe("_");
    expect(names[NostrRootName]).toBe(expectedPublicKeyHex);
    // Bech32 must never leak into the document; NIP-05 is hex only.
    expect(JSON.stringify(document)).not.toContain("npub1");
  });

  test("a requested name is answered on its own, and an unknown one is empty", () => {
    expect(
      (
        generateNostrWellKnown({
          host: NostrCanonicalHost,
          requestedName: "_",
        })["names"] as JSONObject
      )["_"],
    ).toBe(expectedPublicKeyHex);

    expect(
      generateNostrWellKnown({
        host: NostrCanonicalHost,
        requestedName: "someone-else",
      }),
    ).toEqual({ names: {} });
  });

  test("a self-hosted domain does not claim the OneUptime identity", () => {
    expect(generateNostrWellKnown({ host: "status.example.com" })).toEqual({
      names: {},
    });

    expect(
      generateNostrWellKnown({ host: "localhost", requestedName: "_" }),
    ).toEqual({ names: {} });
  });
});
