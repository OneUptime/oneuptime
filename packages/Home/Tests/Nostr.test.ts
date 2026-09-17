import {
  NostrCanonicalHost,
  NostrProfileUrl,
  NostrRootName,
  NostrRootNpub,
  NostrRootPublicKeyHex,
  generateNostrWellKnown,
  npubToPublicKeyHex,
} from "../Utils/Nostr";
import { JSONObject } from "Common/Types/JSON";
import fs from "fs";
import path from "path";

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

/*
 * The templates below hard-code the profile URL the way they hard-code every
 * other social link, so nothing about rendering them depends on a local being
 * threaded through every res.render call. The cost of that choice is that the
 * npub now lives in more than one place, and the failure it invites is a
 * quiet one: rotate the key in Utils/Nostr.ts, miss a template, and the site
 * goes on sending visitors to whoever owns the old npub while
 * /.well-known/nostr.json vouches for the new one. Nobody sees an error. This
 * suite is what turns that into a failing test instead.
 */
const REPOSITORY_ROOT: string = path.join(__dirname, "..", "..");

/*
 * Every template outside Home/Views that links to the account. Home's own
 * templates are not listed because they are discovered below - a new social
 * link added to the marketing site should be covered without anyone
 * remembering to edit this file.
 */
const SharedTemplatesLinkingToNostr: Array<string> = [
  "Common/Server/Views/Partials/Head.ejs",
  "App/FeatureSet/Identity/Views/Partials/Head.ejs",
  "App/FeatureSet/APIReference/views/partials/head.ejs",
  "App/FeatureSet/APIReference/views/partials/footer.ejs",
];

function listFilesRecursively(directory: string): Array<string> {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent) => {
      const entryPath: string = path.join(directory, entry.name);
      return entry.isDirectory()
        ? listFilesRecursively(entryPath)
        : [entryPath];
    });
}

describe("Nostr profile link", () => {
  test("the link is built from the npub this domain publishes", () => {
    expect(NostrProfileUrl).toBe(`https://njump.me/${NostrRootNpub}`);

    /*
     * Pinned rather than derived, so swapping the account is a deliberate
     * edit here too - the same reason expectedPublicKeyHex is written out.
     */
    expect(NostrProfileUrl).toBe(
      "https://njump.me/npub1kggtaw83q0mctlwvh854xdu3wjmen8tmq9cx9l030x2ylay6wk8qy2f2e6",
    );
  });

  test("the marketing site links to the account and nowhere else", () => {
    const viewsRoot: string = path.join(__dirname, "..", "Views");
    const linkingFiles: Array<string> = [];

    for (const filePath of listFilesRecursively(viewsRoot)) {
      const contents: string = fs.readFileSync(filePath, "utf-8");

      if (!contents.includes("njump.me")) {
        continue;
      }

      linkingFiles.push(path.relative(viewsRoot, filePath));

      for (const link of contents.match(/https:\/\/njump\.me\/[^"'\s]+/g) ||
        []) {
        expect(link).toBe(NostrProfileUrl);
      }
    }

    /*
     * The footer social row is the link users actually click, and the
     * Organization schema is what search engines and AI crawlers read the
     * account off. Losing either silently is the point of naming them.
     */
    expect(linkingFiles.sort()).toEqual(["footer.ejs", "head-social.ejs"]);
  });

  test("the other services agree on the same account", () => {
    for (const relativePath of SharedTemplatesLinkingToNostr) {
      const contents: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, relativePath),
        "utf-8",
      );

      expect([relativePath, contents.includes(NostrProfileUrl)]).toEqual([
        relativePath,
        true,
      ]);

      for (const link of contents.match(/https:\/\/njump\.me\/[^"'\s]+/g) ||
        []) {
        expect([relativePath, link]).toEqual([relativePath, NostrProfileUrl]);
      }
    }
  });
});
