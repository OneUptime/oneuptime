/*
 * Heading text -> the `id` used for in-page anchors.
 *
 * This is the single source of truth for anchor ids. The docs renderer
 * (Common/Server/Types/Markdown.ts) exposes it as Markdown.slugify, and the
 * docs anchor scripts (Scripts/Docs/CheckAnchors.ts, Scripts/Docs/FixAnchors.ts)
 * import it directly; a second copy of these rules would drift and then pass a
 * link the renderer serves as a 404.
 *
 * It lives in its own module with ZERO imports on purpose: Markdown.ts pulls in
 * marked and the telemetry stack, which only resolve inside a fully installed
 * package. The scripts run in CI with nothing but the root npm install, so they
 * must be able to load the slugify rules without any of that.
 *
 * The character class keeps letters and numbers in ANY script, via \p{L} and
 * \p{N} with the /u flag. It used to be `\w`, which is ASCII-only — so every
 * Cyrillic, CJK and Devanagari heading was stripped to nothing and rendered
 * as id="", breaking every anchor in those locales. Accented Latin lost the
 * accented letter alone ("gravité" -> "gravit").
 *
 * \p{M} (combining marks) is required alongside \p{L}: Devanagari matras and
 * Arabic/Thai vowel signs are marks, not letters, so without it Hindi headings
 * come out mangled rather than merely transliterated ("लॉग" -> "लग"). It also
 * covers decomposed (NFD) Latin, where "é" is "e" + a combining accent.
 *
 * Variation selectors are dropped first. They are marks too, so \p{M} would
 * otherwise keep them — and an emoji heading like "⚠️ Important" carries an
 * invisible U+FE0F that would survive its emoji and lead the id.
 *
 * `_` is listed explicitly because \p{L}/\p{N} do not cover it but the old
 * `\w` did, and real headings depend on it — e.g. "`ceph_health_status` is 1
 * but no incident fires". Dropping it would silently renumber existing
 * English anchors and break inbound deep links.
 */
const slugify: (text: string) => string = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/&[^;]+;/g, "")
    .replace(/[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu, "")
    .replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
};

export default slugify;
