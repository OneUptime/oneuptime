import {
  DocsAddress,
  DocsAddressTarget,
  docsAddressesIn,
  targetOfDocsAddress,
} from "./DocsAddresses";
import { describe, expect, test } from "@jest/globals";

/*
 * The reading of docs addresses that App's DocsLinksResolve and
 * WebsiteDocsLinks and Home's DocsLinks hold the product's and the
 * website's links with (Tests/Helpers/DocsAddresses). A reading that missed
 * an address would pass every one of those checks by checking nothing, so
 * each way an address is written is read here on its own.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "fr", "zh-CN"];

// The addresses a text holds, as written.
const addressesOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return docsAddressesIn(text).map((found: DocsAddress): string => {
    return found.address;
  });
};

// The one address a text holds.
const onlyAddressOf: (text: string) => DocsAddress = (
  text: string,
): DocsAddress => {
  const found: Array<DocsAddress> = docsAddressesIn(text);

  expect(found).toHaveLength(1);

  return found[0]!;
};

const targetOf: (address: string) => DocsAddressTarget = (
  address: string,
): DocsAddressTarget => {
  return targetOfDocsAddress(onlyAddressOf(address), LANGUAGES);
};

describe("docsAddressesIn", () => {
  test.each([
    [
      "a double-quoted attribute",
      '<a href="/docs/cli/index">',
      "/docs/cli/index",
    ],
    [
      "a single-quoted attribute",
      "<a href='/docs/cli/index'>",
      "/docs/cli/index",
    ],
    ["a template literal", "`/docs/cli/index`", "/docs/cli/index"],
    ["a Markdown link", "[CLI](/docs/cli/index)", "/docs/cli/index"],
    [
      "an attribute without quotes",
      "<a href=/docs/cli/index>",
      "/docs/cli/index",
    ],
    ["prose", "Read /docs/cli/index first", "/docs/cli/index"],
    ["the start of a text", "/docs/cli/index", "/docs/cli/index"],
    [
      "a template literal's origin",
      "`${baseUrl}/docs/ai/mcp-server`",
      "/docs/ai/mcp-server",
    ],
    [
      "an ejs tag that writes the origin",
      '<a href="<%= homeUrl %>/docs/telemetry/queues">',
      "/docs/telemetry/queues",
    ],
    [
      "the site's own host",
      "https://oneuptime.com/docs/terraform/index",
      "/docs/terraform/index",
    ],
    ["a line of its own", "  /docs/cli/index\n", "/docs/cli/index"],
  ])(
    "finds an address in %s",
    (_way: string, text: string, address: string) => {
      expect(addressesOf(text)).toEqual([address]);
    },
  );

  test.each([
    ["another site's docs", "https://tailwindcss.com/docs/preflight"],
    [
      "another site's docs under a path",
      "https://developer.mozilla.org/en-US/docs/Web/HTML",
    ],
    ["a longer word", '"/docsearch/index"'],
    ["a path that only ends in docs", '"/helm/docs/values"'],
    ["a file name", '"README.docs"'],
  ])("finds none in %s", (_way: string, text: string) => {
    expect(addressesOf(text)).toEqual([]);
  });

  test("finds every address in a text, in order, on the lines they are on", () => {
    const found: Array<DocsAddress> = docsAddressesIn(
      [
        '<a href="/docs">Docs</a>',
        '<a href="/docs/terraform">Terraform</a> and',
        "",
        "[a page](/docs/cli/index#install-the-cli) and `/docs/llms.txt`",
      ].join("\n"),
    );

    expect(
      found.map((address: DocsAddress): [string, number] => {
        return [address.address, address.line];
      }),
    ).toEqual([
      ["/docs", 1],
      ["/docs/terraform", 2],
      ["/docs/cli/index#install-the-cli", 4],
      ["/docs/llms.txt", 4],
    ]);
    expect(found[1]!.index).toBe('<a href="/docs">Docs</a>\n<a href="'.length);
  });

  test("reads the names after /docs, the root's as none", () => {
    expect(onlyAddressOf('"/docs"').names).toEqual([]);
    expect(onlyAddressOf('"/docs/"').names).toEqual([]);
    expect(onlyAddressOf('"/docs/terraform"').names).toEqual(["terraform"]);
    expect(onlyAddressOf('"/docs/cli/index/"').names).toEqual(["cli", "index"]);
    expect(onlyAddressOf('"/docs/de/cli/index"').names).toEqual([
      "de",
      "cli",
      "index",
    ]);
    expect(onlyAddressOf('"/docs/llms.txt"').names).toEqual(["llms.txt"]);
  });

  test("reads the anchor, decoded, and keeps a query out of the names", () => {
    const address: DocsAddress = onlyAddressOf(
      '"/docs/cli/index?utm_source=site#install-the-cli"',
    );

    expect(address.names).toEqual(["cli", "index"]);
    expect(address.anchor).toBe("install-the-cli");
    expect(onlyAddressOf('"/docs/a/b#caf%C3%A9"').anchor).toBe("café");
    expect(onlyAddressOf('"/docs/a/b#100%"').anchor).toBe("100%");
    expect(onlyAddressOf('"/docs/a/b"').anchor).toBeNull();
    expect(onlyAddressOf('"/docs/a/b#"').anchor).toBeNull();
  });

  test("leaves out the punctuation that ends a sentence", () => {
    expect(addressesOf("See /docs/cli/index.")).toEqual(["/docs/cli/index"]);
    expect(addressesOf("See /docs/cli/index#install-the-cli, then")).toEqual([
      "/docs/cli/index#install-the-cli",
    ]);
    expect(onlyAddressOf("See /docs/cli/index#install-the-cli.").anchor).toBe(
      "install-the-cli",
    );
    expect(addressesOf("Is it /docs/terraform?")).toEqual(["/docs/terraform"]);
    // A dot inside a name is the name's.
    expect(addressesOf("Fetch /docs/llms.txt.")).toEqual(["/docs/llms.txt"]);
  });

  test("tells an address written whole from one that goes on in code", () => {
    for (const text of [
      '"/docs/cli/index"',
      '"/docs/"',
      "`${origin}/docs/ai/mcp-server`",
      '"/docs" + "/cli/index"',
      "the /docs/<lang>/<category>/<page> form",
    ]) {
      expect({ text, writtenWhole: onlyAddressOf(text).writtenWhole }).toEqual({
        text,
        writtenWhole: true,
      });
    }

    for (const text of [
      "`/docs/${page}`",
      "`/docs/cli/${page}`",
      '"/docs/<%= page %>"',
      '"/docs/{{page}}"',
      '"/docs/" + page',
      "'/docs/cli/' +\n  page",
    ]) {
      expect({ text, writtenWhole: onlyAddressOf(text).writtenWhole }).toEqual({
        text,
        writtenWhole: false,
      });
    }
  });
});

describe("targetOfDocsAddress", () => {
  test("the docs' own address, with or without a language", () => {
    for (const address of ['"/docs"', '"/docs/"', '"/docs?x=1"']) {
      expect(targetOf(address)).toEqual({
        kind: "root",
        lang: null,
        name: null,
      });
    }
    expect(targetOf('"/docs/de"')).toEqual({
      kind: "root",
      lang: "de",
      name: null,
    });
    expect(targetOf('"/docs/zh-CN/"')).toEqual({
      kind: "root",
      lang: "zh-CN",
      name: null,
    });
  });

  test("a file the docs serve at their root", () => {
    expect(targetOf('"/docs/llms.txt"')).toEqual({
      kind: "file",
      lang: null,
      name: "llms.txt",
    });
    expect(targetOf('"/docs/sitemap.xml"')).toEqual({
      kind: "file",
      lang: null,
      name: "sitemap.xml",
    });
  });

  test("a category's own address names no page", () => {
    expect(targetOf('"/docs/terraform"')).toEqual({
      kind: "category",
      lang: null,
      name: "terraform",
    });
    expect(targetOf('"/docs/de/terraform"')).toEqual({
      kind: "category",
      lang: "de",
      name: "terraform",
    });
    // Under a language, a name with a dot is no file of the docs either.
    expect(targetOf('"/docs/de/llms.txt"')).toEqual({
      kind: "category",
      lang: "de",
      name: "llms.txt",
    });
    // A language code it does not know is a name like any other.
    expect(targetOf('"/docs/xx"')).toEqual({
      kind: "category",
      lang: null,
      name: "xx",
    });
  });

  test("a page, with or without a language", () => {
    expect(targetOf('"/docs/cli/index#install-the-cli"')).toEqual({
      kind: "page",
      lang: null,
      name: "cli/index",
    });
    expect(targetOf('"/docs/fr/cli/index"')).toEqual({
      kind: "page",
      lang: "fr",
      name: "cli/index",
    });
  });

  test("anything deeper is not a page", () => {
    for (const address of [
      '"/docs/static/scripts/install.sh"',
      '"/docs/as-markdown/en/cli/index"',
      '"/docs/de/a/b/c"',
    ]) {
      expect(targetOf(address).kind).toBe("other");
      expect(targetOf(address).name).toBeNull();
    }
  });
});
