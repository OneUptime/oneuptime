import Dictionary from "../../Types/Dictionary";
import {
  LinkHeaderLink,
  linkHeaderUrls,
  readLinkHeader,
} from "../../Utils/LinkHeader";
import { seededRandom, SeededRandom } from "../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * THE LINK RESPONSE HEADER (Utils/LinkHeader), READ AS RFC 8288 WRITES IT.
 *
 * GitHub's commit count on the website and Okta's System Log pages are read
 * from Link headers. The website took GitHub's apart by position - the
 * second link, with its first "<" and first ">" replaced - which named
 * the wrong page whenever the links came in another order, and threw on an
 * answer that had no header. Now one reader takes each address whole, up to
 * its ">", reads each parameter (a quoted value to its closing quote), and
 * finds a link by its relation.
 */

const GITHUB_COMMITS: string =
  '<https://api.github.com/repositories/380744866/commits?sha=master&per_page=1&page=2>; rel="next", <https://api.github.com/repositories/380744866/commits?sha=master&per_page=1&page=22486>; rel="last"';

describe("readLinkHeader", () => {
  test("reads GitHub's pagination header into its two links", () => {
    expect(readLinkHeader(GITHUB_COMMITS)).toEqual([
      {
        url: "https://api.github.com/repositories/380744866/commits?sha=master&per_page=1&page=2",
        relations: ["next"],
        parameters: { rel: "next" },
      },
      {
        url: "https://api.github.com/repositories/380744866/commits?sha=master&per_page=1&page=22486",
        relations: ["last"],
        parameters: { rel: "last" },
      },
    ]);
  });

  test("takes an address whole: a comma or a semicolon inside it is part of it", () => {
    const url: string =
      "https://example.okta.com/api/v1/logs?filter=eventType%20eq%20%22a,b%22&x=1;2";

    expect(readLinkHeader(`<${url}>; rel="next"`)).toEqual([
      { url: url, relations: ["next"], parameters: { rel: "next" } },
    ]);
  });

  test("reads a quoted value to its closing quote, a backslash escaping the character after it", () => {
    const links: Array<LinkHeaderLink> = readLinkHeader(
      '<https://a.example/1>; title="a, b; c \\"d\\" \\\\ e"; rel="next", <https://a.example/2>; rel=last',
    );

    expect(links).toHaveLength(2);
    expect(links[0]!.parameters["title"]).toBe('a, b; c "d" \\ e');
    expect(links[0]!.relations).toEqual(["next"]);
    expect(links[1]!.relations).toEqual(["last"]);
  });

  test("reads unquoted values, names and relations whatever their case", () => {
    expect(
      readLinkHeader('<https://a.example/1>; REL="Next Prefetch"; Title=x'),
    ).toEqual([
      {
        url: "https://a.example/1",
        relations: ["next", "prefetch"],
        parameters: { rel: "Next Prefetch", title: "x" },
      },
    ]);
  });

  test("the first parameter of a name counts, as RFC 8288 says", () => {
    expect(
      readLinkHeader('<https://a.example/1>; rel="next"; rel="last"')[0]!
        .relations,
    ).toEqual(["next"]);
  });

  test("allows spaces and tabs around every part", () => {
    expect(
      readLinkHeader(
        '  < https://a.example/1 >\t;\trel = "next" ,\t<https://a.example/2>;rel=last  ',
      ),
    ).toEqual([
      {
        url: "https://a.example/1",
        relations: ["next"],
        parameters: { rel: "next" },
      },
      {
        url: "https://a.example/2",
        relations: ["last"],
        parameters: { rel: "last" },
      },
    ]);
  });

  test("reads links written one after another with no comma", () => {
    expect(
      readLinkHeader(
        "<https://a.example/1>; rel=next<https://a.example/2>; rel=last",
      ).map((link: LinkHeaderLink): string => {
        return link.url;
      }),
    ).toEqual(["https://a.example/1", "https://a.example/2"]);
  });

  test("skips what is not a link, and never throws", () => {
    for (const value of [
      "",
      "   ",
      ",,,",
      "rel=next",
      "https://a.example/1; rel=next",
      "<https://a.example/1",
      '<https://a.example/1>; rel="next',
      "<>; rel=next",
      ";;;",
      '"',
      "<",
      ">",
      undefined,
      null,
    ]) {
      expect(() => {
        return readLinkHeader(value);
      }).not.toThrow();
    }

    expect(readLinkHeader("")).toEqual([]);
    expect(readLinkHeader(undefined)).toEqual([]);
    expect(readLinkHeader(null)).toEqual([]);
    expect(readLinkHeader("rel=next")).toEqual([]);
    expect(readLinkHeader("<>; rel=next")).toEqual([]);
    expect(readLinkHeader("<https://a.example/1")).toEqual([]);
    // An unclosed quote takes the rest of the header as its value.
    expect(readLinkHeader('<https://a.example/1>; rel="next')).toEqual([
      {
        url: "https://a.example/1",
        relations: ["next"],
        parameters: { rel: "next" },
      },
    ]);
  });

  test("skips garbage before a link and reads the links after it", () => {
    expect(
      readLinkHeader('nonsense; rel=x, <https://a.example/2>; rel="last"').map(
        (link: LinkHeaderLink): string => {
          return link.url;
        },
      ),
    ).toEqual(["https://a.example/2"]);
  });

  test("reads back every header written from generated links", () => {
    const random: SeededRandom = seededRandom(8288);
    // What an address may hold: commas and semicolons included.
    const urlPieces: ReadonlyArray<string> = [
      "a",
      "Z",
      "0",
      "/",
      "?",
      "=",
      "&",
      ",",
      ";",
      "%2C",
      '"',
    ];
    // What a quoted title may hold: quotes and backslashes, escaped.
    const titlePieces: ReadonlyArray<string> = [
      ...urlPieces,
      " ",
      "\\",
      "<",
      ">",
    ];
    const relations: ReadonlyArray<string> = [
      "next",
      "prev",
      "last",
      "first",
      "self",
    ];

    for (let round: number = 0; round < 2000; round++) {
      const links: Array<{
        url: string;
        relations: Array<string>;
        title: string;
      }> = [];
      const count: number = 1 + random(4);

      for (let index: number = 0; index < count; index++) {
        let url: string = "https://h.example/";
        let title: string = "";

        for (let piece: number = random(12); piece > 0; piece--) {
          url += urlPieces[random(urlPieces.length)];
          title += titlePieces[random(titlePieces.length)];
        }

        links.push({
          url: url,
          relations: [relations[random(relations.length)]!],
          title: title,
        });
      }

      const header: string = links
        .map(
          (link: {
            url: string;
            relations: Array<string>;
            title: string;
          }): string => {
            const quotedTitle: string = Array.from(link.title)
              .map((character: string): string => {
                return character === '"' || character === "\\"
                  ? `\\${character}`
                  : character;
              })
              .join("");

            return `<${link.url}>; title="${quotedTitle}"; rel="${link.relations.join(" ")}"`;
          },
        )
        .join(", ");

      expect(readLinkHeader(header)).toEqual(
        links.map(
          (link: {
            url: string;
            relations: Array<string>;
            title: string;
          }): LinkHeaderLink => {
            return {
              url: link.url,
              relations: link.relations,
              parameters: { title: link.title, rel: link.relations.join(" ") },
            };
          },
        ),
      );
    }
  });

  test("a header of a megabyte is read in one pass", () => {
    const header: string = Array.from(
      { length: 20000 },
      (_: unknown, index: number): string => {
        return `<https://a.example/items?page=${index}&x=a,b;c>; rel="item"; title="x, y; \\" z"`;
      },
    ).join(", ");
    const startedAt: number = performance.now();
    const links: Array<LinkHeaderLink> = readLinkHeader(header);
    const tookMs: number = performance.now() - startedAt;

    expect(links).toHaveLength(20000);
    expect(links[19999]!.url).toBe(
      "https://a.example/items?page=19999&x=a,b;c",
    );
    expect(tookMs).toBeLessThan(2000);
  });
});

describe("linkHeaderUrls", () => {
  test("maps each relation to its address, whatever the order of the links", () => {
    const swapped: string =
      '<https://a.example/last>; rel="last", <https://a.example/next>; rel="next"';

    expect(linkHeaderUrls(swapped)).toEqual({
      last: "https://a.example/last",
      next: "https://a.example/next",
    });
    expect(linkHeaderUrls(GITHUB_COMMITS)["last"]).toBe(
      "https://api.github.com/repositories/380744866/commits?sha=master&per_page=1&page=22486",
    );
  });

  test("gives every relation of a link the link's address", () => {
    expect(
      linkHeaderUrls('<https://a.example/b>; rel="next prefetch"; title="x"'),
    ).toEqual({
      next: "https://a.example/b",
      prefetch: "https://a.example/b",
    });
  });

  test("keeps the last address given for a relation named twice", () => {
    expect(
      linkHeaderUrls(
        '<https://a.example/1>; rel="next", <https://a.example/2>; rel="next"',
      ),
    ).toEqual({ next: "https://a.example/2" });
  });

  test("leaves out a link with no relation", () => {
    const urls: Dictionary<string> = linkHeaderUrls(
      '<https://a.example/1>; title="x", <https://a.example/2>; rel=last',
    );

    expect(urls).toEqual({ last: "https://a.example/2" });
  });

  test("is empty for no header", () => {
    expect(linkHeaderUrls(undefined)).toEqual({});
    expect(linkHeaderUrls("")).toEqual({});
  });
});
