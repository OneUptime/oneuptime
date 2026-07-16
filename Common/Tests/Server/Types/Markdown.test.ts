import Markdown from "../../../Server/Types/Markdown";

/*
 * slugify turns a heading into the `id` the docs renderer emits, and therefore
 * into the target every in-page `](#anchor)` link has to match. These tests pin
 * the two properties that are easy to break by accident:
 *
 *   - non-ASCII scripts must survive (they used to be stripped to an empty id,
 *     which silently 404'd every anchor in the ru/ja/ko/hi/zh docs), and
 *   - existing English ids must not move, because they are published URLs.
 */
describe("Markdown.slugify", () => {
  describe("English headings keep their existing ids", () => {
    test.each([
      [
        "Reducing the Volume of Data Collected",
        "reducing-the-volume-of-data-collected",
      ],
      ["Filtering by Log Severity", "filtering-by-log-severity"],
      ["Step 1 — Install the Collector", "step-1-install-the-collector"],
      ["What's New?", "whats-new"],
      ["Namespace Filtering", "namespace-filtering"],
    ])("%s", (heading: string, expected: string) => {
      expect(Markdown.slugify(heading)).toBe(expected);
    });
  });

  /*
   * \p{L}/\p{N} do not match "_", so it is listed explicitly in the character
   * class. The old `\w` matched it. These are real headings — dropping the
   * underscore would change ids that are already linked to.
   */
  describe("underscores are preserved", () => {
    test.each([
      [
        "`ceph_health_status` is 1 but no incident fires",
        "ceph_health_status-is-1-but-no-incident-fires",
      ],
      [
        "Counters like `pve_network_receive_bytes` only ever grow",
        "counters-like-pve_network_receive_bytes-only-ever-grow",
      ],
    ])("%s", (heading: string, expected: string) => {
      expect(Markdown.slugify(heading)).toBe(expected);
    });
  });

  describe("non-Latin scripts produce a usable id, not an empty one", () => {
    test.each([
      ["Фильтрация по важности логов", "фильтрация-по-важности-логов"],
      ["ログの重大度によるフィルタリング", "ログの重大度によるフィルタリング"],
      ["按日志严重性过滤", "按日志严重性过滤"],
      ["로그 심각도별 필터링", "로그-심각도별-필터링"],
      [
        "लॉग गंभीरता के अनुसार फ़िल्टर करना",
        "लॉग-गंभीरता-के-अनुसार-फ़िल्टर-करना",
      ],
    ])("%s", (heading: string, expected: string) => {
      const slug: string = Markdown.slugify(heading);
      expect(slug).not.toBe("");
      expect(slug).toBe(expected);
    });
  });

  describe("accented Latin keeps the accented letter", () => {
    test.each([
      [
        "Filtrage par gravité des journaux",
        "filtrage-par-gravité-des-journaux",
      ],
      [
        "Reduktion af mængden af indsamlede data",
        "reduktion-af-mængden-af-indsamlede-data",
      ],
      ["Fehlerbehebung für Größen", "fehlerbehebung-für-größen"],
    ])("%s", (heading: string, expected: string) => {
      expect(Markdown.slugify(heading)).toBe(expected);
    });
  });

  describe("markup and punctuation are still stripped", () => {
    test("strips inline HTML tags", () => {
      expect(Markdown.slugify("A <em>heading</em> here")).toBe(
        "a-heading-here",
      );
    });

    test("strips HTML entities", () => {
      expect(Markdown.slugify("Tom &amp; Jerry")).toBe("tom-jerry");
    });

    test("strips punctuation but keeps hyphens", () => {
      expect(Markdown.slugify("Set up SSO (SAML): step-by-step!")).toBe(
        "set-up-sso-saml-step-by-step",
      );
    });

    test("collapses whitespace runs and trims leading/trailing hyphens", () => {
      expect(Markdown.slugify("  spaced   out  ")).toBe("spaced-out");
    });

    test("emoji are dropped rather than becoming part of the id", () => {
      expect(Markdown.slugify("🚀 Getting Started")).toBe("getting-started");
    });
  });
});
