/*
 * Addresses into OneUptime's docs, as other code writes them: the website's
 * views, data and AI discovery files, and the product's own screens. A link
 * there to a page the docs do not have, or to a category's own address,
 * which names no page, is found here and reported by the suites that read
 * them: App's DocsLinksResolve holds the product's links to the docs' nav,
 * App's WebsiteDocsLinks follows the website's through the docs' real
 * routes, and Home's DocsLinks holds the website's pages and AI discovery
 * files to the docs' nav and pages.
 *
 * It imports nothing, so Home's tests (whose CI job installs only Home's and
 * Common's dependencies) read addresses exactly as App's do.
 */

export interface DocsAddress {
  // The address as written, without an origin: "/docs/cli/index#install-the-cli".
  address: string;
  // The names after /docs: ["cli", "index"], and [] for the docs' root.
  names: Array<string>;
  // The anchor it names, decoded, or null.
  anchor: string | null;
  // Where it starts in the text, and its line there (1-based).
  index: number;
  line: number;
  /*
   * False when the path goes on in code, as "/docs/${page}",
   * "/docs/<%= page %>" or "/docs/" + page do: which page it opens is only
   * known when it runs.
   */
  writtenWhole: boolean;
}

/*
 * "/docs" where it stands as an address of this site: at the start, after a
 * quote, a bracket, "=", whitespace, ">" (where an ejs tag writes the site's
 * origin) or "}" (where a template literal does), or after the site's own
 * host. Another site's docs (tailwindcss.com/docs/...) are not this site's,
 * and neither is a longer word that starts with "docs".
 */
const DOCS_ADDRESS: RegExp =
  /(?<=^|["'`(=\s>}]|oneuptime\.com)\/docs(?![\w.~-])(?:\/[\w.~-]+)*\/?(?:\?[^\s"'`<>#)\]]*)?(?:#[^\s"'`<>)\]]*)?/g;

// An address's parts: the names after /docs, then a query and an anchor.
const ADDRESS_PARTS: RegExp =
  /^\/docs((?:\/[\w.~-]+)*)\/?(?:\?[^#]*)?(?:#(.*))?$/;

// Punctuation that ends a sentence rather than an address: "see /docs/x/y."
const TRAILING_PUNCTUATION: RegExp = /[.,;:!?]+$/;

// What a path that goes on in code continues with.
const CODE_AFTER_PATH: RegExp = /^(?:\$\{|<%|\{\{)/;
// A path ending in "/" that is joined to code: "/docs/" + page.
const JOINED_AFTER_PATH: RegExp = /^["'`]\s*\+/;

const NEWLINE: string = "\n";

/*
 * An anchor as the heading slug it names. Anchors are percent-encoded in
 * links; one that is not valid percent-encoding ("#100%") is kept as
 * written, so the link is reported as broken rather than throwing.
 */
const decodeAnchor: (raw: string) => string = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

// Every docs address in a text, in the order they are written.
export const docsAddressesIn: (text: string) => Array<DocsAddress> = (
  text: string,
): Array<DocsAddress> => {
  const addresses: Array<DocsAddress> = [];
  let line: number = 1;
  let counted: number = 0;

  for (const match of text.matchAll(DOCS_ADDRESS)) {
    const index: number = match.index || 0;
    const written: string = match[0];
    const address: string = written.replace(TRAILING_PUNCTUATION, "");
    const parts: RegExpMatchArray | null = address.match(ADDRESS_PARTS);
    const after: string = text.slice(
      index + written.length,
      index + written.length + 2,
    );

    while (counted < index) {
      const next: number = text.indexOf(NEWLINE, counted);

      if (next === -1 || next >= index) {
        break;
      }

      line += 1;
      counted = next + 1;
    }

    addresses.push({
      address: address,
      names: (parts?.[1] || "").split("/").filter((name: string): boolean => {
        return name.length > 0;
      }),
      anchor:
        parts?.[2] === undefined || parts[2] === ""
          ? null
          : decodeAnchor(parts[2]),
      index: index,
      line: line,
      writtenWhole: !(
        CODE_AFTER_PATH.test(after) ||
        (written.endsWith("/") &&
          JOINED_AFTER_PATH.test(text.slice(index + written.length)))
      ),
    });
  }

  return addresses;
};

/*
 * What an address opens, given the docs' language codes:
 *
 *   - "root": the docs' own address, /docs or /docs/<lang>;
 *   - "file": a file the docs serve at their root, /docs/llms.txt;
 *   - "category": a category's own address, /docs/terraform or
 *     /docs/<lang>/terraform, which names no page;
 *   - "page": /docs/[<lang>/]<category>/<page>, a page;
 *   - "other": anything deeper, such as the docs' static files.
 */
export type DocsAddressKind = "root" | "file" | "category" | "page" | "other";

export interface DocsAddressTarget {
  kind: DocsAddressKind;
  // The language it names first, or null.
  lang: string | null;
  /*
   * "category/page" for a page, the category for a category's own address,
   * the file's name for a file, and null for the others.
   */
  name: string | null;
}

export const targetOfDocsAddress: (
  address: DocsAddress,
  languages: ReadonlyArray<string>,
) => DocsAddressTarget = (
  address: DocsAddress,
  languages: ReadonlyArray<string>,
): DocsAddressTarget => {
  const first: string | undefined = address.names[0];
  const lang: string | null =
    first !== undefined && languages.includes(first) ? first : null;
  const rest: Array<string> =
    lang === null ? address.names : address.names.slice(1);

  if (rest.length === 0) {
    return { kind: "root", lang: lang, name: null };
  }

  if (rest.length === 1) {
    const name: string = rest[0]!;

    return lang === null && name.includes(".")
      ? { kind: "file", lang: null, name: name }
      : { kind: "category", lang: lang, name: name };
  }

  if (rest.length === 2) {
    return { kind: "page", lang: lang, name: `${rest[0]}/${rest[1]}` };
  }

  return { kind: "other", lang: lang, name: null };
};
