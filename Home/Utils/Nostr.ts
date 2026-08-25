/*
 * NIP-05 identity for the marketing domain, served at
 * /.well-known/nostr.json (Home/Routes.ts).
 *
 * NIP-05 is how a nostr client proves that a human-readable identifier like
 * "_@oneuptime.com" belongs to a public key: it fetches this document from
 * the domain in the identifier and checks that the name maps to the key on
 * the profile. The reserved name "_" is the root identifier — it renders as
 * the bare domain ("oneuptime.com") rather than "something@oneuptime.com",
 * which is why the OneUptime account is published under it here.
 *
 * The npub below is a PUBLIC key. It is the account's address, not a secret,
 * and the whole point of this file is to publish it.
 *
 * This module is pure: no filesystem, database or network access.
 */

import { JSONObject } from "Common/Types/JSON";

// The OneUptime nostr account, in the bech32 form users copy and paste.
export const NostrRootNpub: string =
  "npub1kggtaw83q0mctlwvh854xdu3wjmen8tmq9cx9l030x2ylay6wk8qy2f2e6";

/*
 * The reserved NIP-05 root name. A client resolving "oneuptime.com" (no
 * local part) looks up "_", so this is what makes the npub above the identity
 * of the domain itself.
 */
export const NostrRootName: string = "_";

/*
 * Only this host publishes the identity. Every self-hosted OneUptime install
 * runs the same Home service, and a self-hosted domain answering with
 * OneUptime's key would be claiming an identity it does not hold.
 */
export const NostrCanonicalHost: string = "oneuptime.com";

const Bech32Charset: string = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

const Bech32GeneratorPolynomials: Array<number> = [
  0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3,
];

/*
 * BIP-173 checksum. Bech32 is a small enough algorithm that decoding it here
 * beats taking a dependency, and it means the npub above — the value a human
 * actually verifies against the nostr client — stays the single source of
 * truth for the hex key NIP-05 requires on the wire.
 */
function bech32Polymod(values: Array<number>): number {
  let checksum: number = 1;

  for (const value of values) {
    const top: number = checksum >> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;

    for (let i: number = 0; i < 5; i++) {
      if (((top >> i) & 1) !== 0) {
        checksum ^= Bech32GeneratorPolynomials[i]!;
      }
    }
  }

  return checksum;
}

function bech32HumanReadablePartExpand(hrp: string): Array<number> {
  const high: Array<number> = [];
  const low: Array<number> = [];

  for (let i: number = 0; i < hrp.length; i++) {
    const code: number = hrp.charCodeAt(i);
    high.push(code >> 5);
    low.push(code & 31);
  }

  return [...high, 0, ...low];
}

/*
 * Regroup 5-bit bech32 data words into 8-bit bytes. Padding bits are only
 * allowed to be leftover zeroes; anything else means the payload was not a
 * whole number of bytes and the value is malformed.
 */
function fiveBitWordsToBytes(words: Array<number>): Array<number> {
  let accumulator: number = 0;
  let bits: number = 0;
  const bytes: Array<number> = [];

  for (const word of words) {
    accumulator = (accumulator << 5) | word;
    bits += 5;

    while (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
  }

  if (bits >= 5 || ((accumulator << (8 - bits)) & 0xff) !== 0) {
    throw new Error("Invalid npub: non-zero padding");
  }

  return bytes;
}

/*
 * Decode an npub (NIP-19 bech32) into the lowercase 32-byte hex public key
 * that NIP-05 documents are required to carry. Throws on anything that is not
 * a well-formed npub — this runs at module load over a constant, so a typo in
 * the key surfaces immediately rather than as a silently unverifiable
 * identity.
 */
export function npubToPublicKeyHex(npub: string): string {
  if (npub !== npub.toLowerCase()) {
    throw new Error("Invalid npub: mixed or upper case");
  }

  const separatorIndex: number = npub.lastIndexOf("1");

  if (separatorIndex === -1) {
    throw new Error("Invalid npub: no separator");
  }

  const humanReadablePart: string = npub.slice(0, separatorIndex);

  if (humanReadablePart !== "npub") {
    throw new Error(
      `Invalid npub: expected npub prefix, got ${humanReadablePart}`,
    );
  }

  const words: Array<number> = [];

  for (const character of npub.slice(separatorIndex + 1)) {
    const word: number = Bech32Charset.indexOf(character);

    if (word === -1) {
      throw new Error(`Invalid npub: bad character ${character}`);
    }

    words.push(word);
  }

  // Six trailing words are the checksum, and the payload needs to survive it.
  if (words.length <= 6) {
    throw new Error("Invalid npub: too short");
  }

  if (
    bech32Polymod([
      ...bech32HumanReadablePartExpand(humanReadablePart),
      ...words,
    ]) !== 1
  ) {
    throw new Error("Invalid npub: bad checksum");
  }

  const bytes: Array<number> = fiveBitWordsToBytes(words.slice(0, -6));

  if (bytes.length !== 32) {
    throw new Error(`Invalid npub: expected 32 bytes, got ${bytes.length}`);
  }

  return bytes
    .map((byte: number) => {
      return byte.toString(16).padStart(2, "0");
    })
    .join("");
}

// NIP-05 documents carry the key in hex, never in bech32.
export const NostrRootPublicKeyHex: string = npubToPublicKeyHex(NostrRootNpub);

/*
 * Build the NIP-05 document. Clients request a single name
 * (/.well-known/nostr.json?name=_) and the spec's answer for a name this
 * domain does not publish is an empty names object, not an error — so an
 * unknown name and a non-canonical host produce the same benign response.
 */
export function generateNostrWellKnown(options: {
  host: string;
  requestedName?: string | undefined;
}): JSONObject {
  if (options.host !== NostrCanonicalHost) {
    return { names: {} };
  }

  const names: JSONObject = {
    [NostrRootName]: NostrRootPublicKeyHex,
  };

  if (!options.requestedName) {
    return { names };
  }

  const publicKey: string | undefined = names[options.requestedName] as
    | string
    | undefined;

  if (!publicKey) {
    return { names: {} };
  }

  return { names: { [options.requestedName]: publicKey } };
}
