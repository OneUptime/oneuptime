/*
 * A blog tag's address: the slug in /blog/tag/<slug>, and the paths of the
 * tag's page and feed built from it. Every link to a tag page or a tag feed
 * is built here - the tag chips on posts and lists, the tag page's own
 * pagination and feed links, its canonical URL, the feed's links and the
 * redirects from old addresses - so they all agree on one slug per tag.
 *
 * Tags are written by people: "CI/CD", "Pub/Sub", "C++", "Let's Encrypt",
 * "/etc/hosts". The slug used to be the tag lowercased with its spaces turned
 * into hyphens, percent-encoded on its way into a link. "CI/CD" linked to
 * /blog/tag/ci%2Fcd, and its page built its pagination and feed links from
 * the decoded tag: /blog/tag/ci/cd?page=2 and /blog/tag/ci/cd/rss.xml, two
 * path segments the tag route never matches, so every one was a 404.
 *
 * A slug now holds only what a URL path carries as it is - RFC 3986's
 * unreserved characters: ASCII letters and digits, "-", ".", "_" and "~" -
 * and the letters, marks and numbers of other scripts, which a link carries
 * percent-encoded as UTF-8 and the route reads back as they were:
 *
 * - The tag is NFKC-normalised and lowercased, so "CI/CD", "ci/cd" and a
 *   full-width "ＣＩ/ＣＤ" are one tag.
 * - "+", "#", "&" and "@" are spelled out, so "C++", "C#" and "C" keep pages
 *   of their own (c-plus-plus, c-sharp, c), as do "Q&A" and "Lambda@Edge"
 *   (q-and-a, lambda-at-edge). Apostrophes are dropped: "Let's Encrypt" is
 *   lets-encrypt.
 * - Every other character - whitespace, "/", ":", "$", "(", ")", "?", "%",
 *   emoji and the like - becomes a hyphen. A run of hyphens becomes one, and
 *   none is left at either end.
 *
 * Tags that come out the same are one tag and share a page: "CI/CD",
 * "CI CD" and "Ci-cd" are all /blog/tag/ci-cd. A tag with nothing left - "::"
 * - has no page, and is shown without a link.
 */

const SPELLED_OUT_SYMBOLS: ReadonlyArray<[string, string]> = [
  ["+", "plus"],
  ["#", "sharp"],
  ["&", "and"],
  ["@", "at"],
];

/*
 * Variation selectors are marks, so the letters-and-marks class below would
 * keep them - and an emoji tag such as "⚠️ Alerts" carries an invisible
 * U+FE0F after its emoji.
 */
const VARIATION_SELECTORS: RegExp = /[︀-️\u{E0100}-\u{E01EF}]/gu;

// ' and its typographic forms (’ ‘ ʼ): "Let's" is "lets", not "let-s".
const APOSTROPHES: RegExp = /['‘’ʼ]/g;

// Anything that is not a letter, mark or number of any script, or "-._~".
const NOT_KEPT: RegExp = /[^\p{L}\p{M}\p{N}._~-]+/gu;

const HYPHEN_RUNS: RegExp = /-{2,}/g;

const EDGE_HYPHENS: RegExp = /^-|-$/g;

// "." and ".." are steps along a path, never a name: /blog/tag/.. is /blog.
const ONLY_DOTS: RegExp = /^\.+$/;

const TAG_PAGES_PATH: string = "/blog/tag";

export default class BlogTag {
  /*
   * The slug of a tag as it is written, or "" when nothing of it can go into
   * a URL. A slug is its own slug, so anything a tag page is asked for can be
   * read as a tag name too: /blog/tag/CI%2FCD is the tag "CI/CD", whose page
   * is /blog/tag/ci-cd.
   */
  public static getSlug(tag: string): string {
    let slug: string = tag
      .normalize("NFKC")
      .toLowerCase()
      .replace(VARIATION_SELECTORS, "")
      .replace(APOSTROPHES, "");

    for (const [symbol, word] of SPELLED_OUT_SYMBOLS) {
      slug = slug.split(symbol).join(`-${word}-`);
    }

    slug = slug
      .replace(NOT_KEPT, "-")
      .replace(HYPHEN_RUNS, "-")
      .replace(EDGE_HYPHENS, "");

    if (ONLY_DOTS.test(slug)) {
      return "";
    }

    return slug;
  }

  // The path of the page of the tag with this slug.
  public static getPagePath(slug: string): string {
    return `${TAG_PAGES_PATH}/${encodeURIComponent(slug)}`;
  }

  // The path of the RSS feed of the tag with this slug.
  public static getFeedPath(slug: string): string {
    return `${BlogTag.getPagePath(slug)}/rss.xml`;
  }

  /*
   * The path of a tag's page, from the tag as a post writes it, or null when
   * the tag has no slug. The blog's templates link every tag chip with this
   * (BlogAPI hands it to them as `blogTagPath`).
   */
  public static getPagePathOfTag(tag: string): string | null {
    const slug: string = BlogTag.getSlug(tag);

    if (!slug) {
      return null;
    }

    return BlogTag.getPagePath(slug);
  }
}
