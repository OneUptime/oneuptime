import ejs from "ejs";
import path from "path";

const views: string = path.join(__dirname, "../Views");
const homeUrl: string = "https://oneuptime.com";

function canonicalTags(html: string): Array<string> {
  return html.match(/<link\s+rel="canonical"[^>]*>/g) || [];
}

describe("blog canonical rendering", () => {
  afterEach(() => {
    ejs.clearCache();
  });

  test.each([false, true])(
    "keeps article canonicals isolated across A-B-A renders (cache=%s)",
    async (cache: boolean): Promise<void> => {
      for (const fileName of [
        "2026-09-01-article-a",
        "2026-09-02-article-b",
        "2026-09-01-article-a",
      ]) {
        const url: string = `${homeUrl}/blog/post/${fileName}/view`;
        const html: string = await ejs.renderFile(
          path.join(views, "Blog/Post.ejs"),
          {
            homeUrl,
            enableGoogleTagManager: false,
            support: false,
            footerCards: false,
            cta: false,
            blackLogo: false,
            requestDemoCta: false,
            blogPost: {
              fileName,
              blogUrl: url,
              title: "Canonical regression fixture",
              description:
                "Synthetic article used only in local rendering tests.",
              tags: [],
              postDate: "2026-09-01",
              formattedPostDate: "September 1, 2026",
              socialMediaImageUrl: `${homeUrl}/fixture.png`,
              htmlBody: "<p>Local fixture.</p>",
              contributors: [],
              author: {
                name: "Fixture Author",
                username: "fixture",
                githubUrl: "https://github.com/oneuptime",
                profileImageUrl: `${homeUrl}/fixture.png`,
                bio: "Test fixture",
              },
            },
          },
          { cache, views: [views] },
        );

        expect(canonicalTags(html)).toEqual([
          `<link rel="canonical" href="${url}">`,
        ]);
        expect(html).toContain(`<meta property="og:url" content="${url}">`);
        expect(html).toContain(`"mainEntityOfPage": "${url}"`);
        expect(html).not.toMatch(/<meta\b[^>]*\bnoindex\b[^>]*>/i);
      }
    },
  );

  test.each(["/", "/blog", "/pricing"])(
    "preserves the shared-head canonical for %s",
    async (pagePath: string): Promise<void> => {
      const url: string = `${homeUrl}${pagePath}`;
      const html: string = await ejs.renderFile(
        path.join(views, "head-basic.ejs"),
        {
          homeUrl,
          enableGoogleTagManager: false,
          seo: { fullCanonicalUrl: url },
        },
        { views: [views] },
      );

      expect(canonicalTags(html)).toEqual([
        `<link rel="canonical" href="${url}">`,
      ]);
    },
  );
});
