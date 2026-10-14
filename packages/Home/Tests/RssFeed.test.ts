import type { BlogPostHeader, BlogTagSummary } from "../Utils/BlogPost";

/*
 * The RSS feed is machine-read by aggregators, so a single unescaped `&` or `<`
 * in a post title makes the whole document invalid XML and the feed silently
 * disappears from every reader. These exercise the generator end to end (through
 * the private escaper and URL-absolutizer) and pin the things that break feeds
 * in the wild: XML escaping, the 100-item cap, and relative→absolute links.
 *
 * BlogPostUtil reads posts off disk and resolves the home URL from config, so it
 * is mocked. The generator caches its output with no exported reset, so each
 * scenario loads the module fresh (resetModules + doMock + isolateModules).
 */

interface MakePostOptions {
  title?: string;
  description?: string;
  blogUrl?: string;
  postDate?: string;
  tags?: string[];
  authorGitHubUsername?: string;
}

type MakePostFunction = (options: MakePostOptions) => BlogPostHeader;

const makePost: MakePostFunction = (
  options: MakePostOptions,
): BlogPostHeader => {
  return {
    title: options.title ?? "A Post",
    description: options.description ?? "A description.",
    formattedPostDate: "January 1, 2024",
    fileName: "a-post",
    tags: options.tags ?? [],
    postDate: options.postDate ?? "2024-01-01",
    blogUrl: options.blogUrl ?? "/blog/post/a-post/view",
    contributors: [],
    authorGitHubUsername: options.authorGitHubUsername ?? "",
  };
};

interface RssModule {
  generateBlogRssFeed: () => Promise<string>;
  generateTagRssFeed: (tag: BlogTagSummary) => Promise<string>;
}

const HOME_URL: string = "https://oneuptime.com/";

// The mocked BlogPostUtil.getBlogPostList of the module loadRss loaded last.
let getBlogPostListMock: jest.Mock = jest.fn();

type LoadRssFunction = (posts: Array<BlogPostHeader>) => RssModule;

const loadRss: LoadRssFunction = (posts: Array<BlogPostHeader>): RssModule => {
  jest.resetModules();

  getBlogPostListMock = jest.fn().mockResolvedValue(posts);

  jest.doMock("../Utils/BlogPost", () => {
    return {
      __esModule: true,
      default: {
        // The code only calls .toString() on the returned URL.
        getHomeUrl: jest.fn().mockResolvedValue({
          toString: (): string => {
            return HOME_URL;
          },
        }),
        getBlogPostList: getBlogPostListMock,
        getTags: jest.fn().mockResolvedValue([]),
      },
    };
  });

  let mod: RssModule | undefined;
  jest.isolateModules(() => {
    /* eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    mod = require("../Utils/RssFeed") as RssModule;
  });

  return mod as RssModule;
};

type RenderBlogFeedFunction = (posts: Array<BlogPostHeader>) => Promise<string>;

const renderBlogFeed: RenderBlogFeedFunction = async (
  posts: Array<BlogPostHeader>,
): Promise<string> => {
  const mod: RssModule = loadRss(posts);
  return mod.generateBlogRssFeed();
};

type RenderTagFeedFunction = (
  posts: Array<BlogPostHeader>,
  tag: BlogTagSummary,
) => Promise<string>;

const renderTagFeed: RenderTagFeedFunction = async (
  posts: Array<BlogPostHeader>,
  tag: BlogTagSummary,
): Promise<string> => {
  const mod: RssModule = loadRss(posts);
  return mod.generateTagRssFeed(tag);
};

describe("RssFeed generateBlogRssFeed", () => {
  afterEach(() => {
    jest.dontMock("../Utils/BlogPost");
    jest.resetModules();
  });

  test("produces a well-formed RSS 2.0 channel", async () => {
    const xml: string = await renderBlogFeed([
      makePost({ title: "Hello", description: "World" }),
    ]);

    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain("<channel>");
    expect(xml).toContain("<title>OneUptime Blog</title>");
    // Atom self-link points at the absolute feed URL.
    expect(xml).toContain('href="https://oneuptime.com/blog/rss.xml"');
    expect(xml).toContain("<item>");
  });

  test("escapes XML-significant characters in title and description", async () => {
    const xml: string = await renderBlogFeed([
      makePost({
        title: "A & B <tag> \"q\" 'a'",
        description: "1 < 2 & 3 > 0",
      }),
    ]);

    // The raw, unescaped title must never appear verbatim.
    expect(xml).not.toContain("A & B <tag>");
    expect(xml).toContain("A &amp; B &lt;tag&gt;");
    expect(xml).toContain("1 &lt; 2 &amp; 3 &gt; 0");
  });

  test("caps the feed at 100 items even when more posts exist", async () => {
    const posts: Array<BlogPostHeader> = [];
    for (let i: number = 0; i < 150; i++) {
      posts.push(makePost({ title: `Post ${i}`, blogUrl: `/blog/post/${i}` }));
    }

    const xml: string = await renderBlogFeed(posts);

    const itemCount: number = (xml.match(/<item>/g) || []).length;
    expect(itemCount).toBe(100);
  });

  test("turns a relative blogUrl into an absolute link and preserves an absolute one", async () => {
    const xml: string = await renderBlogFeed([
      makePost({ title: "Relative", blogUrl: "/blog/post/relative/view" }),
      makePost({
        title: "Absolute",
        blogUrl: "https://elsewhere.example.com/x",
      }),
    ]);

    expect(xml).toContain(
      "<link>https://oneuptime.com/blog/post/relative/view</link>",
    );
    expect(xml).toContain("<link>https://elsewhere.example.com/x</link>");
  });

  test("emits a category element per non-empty tag and skips blanks", async () => {
    const xml: string = await renderBlogFeed([
      makePost({ title: "Tagged", tags: ["Monitoring", "  ", "SRE"] }),
    ]);

    expect(xml).toContain("<category>Monitoring</category>");
    expect(xml).toContain("<category>SRE</category>");
    // The blank/whitespace tag must not become an empty category.
    expect(xml).not.toContain("<category></category>");
    expect(xml).not.toContain("<category>  </category>");
  });

  test("includes an author element only when a github username is present", async () => {
    const withAuthor: string = await renderBlogFeed([
      makePost({ authorGitHubUsername: "octocat" }),
    ]);
    expect(withAuthor).toContain("<author>octocat</author>");

    const withoutAuthor: string = await renderBlogFeed([
      makePost({ authorGitHubUsername: "" }),
    ]);
    expect(withoutAuthor).not.toContain("<author>");
  });

  test("formats pubDate as an RFC-822 UTC string derived from postDate", async () => {
    const xml: string = await renderBlogFeed([
      makePost({ postDate: "2024-03-05" }),
    ]);

    const expected: string = new Date("2024-03-05T00:00:00.000Z").toUTCString();
    expect(xml).toContain(`<pubDate>${expected}</pubDate>`);
  });
});

describe("RssFeed generateTagRssFeed", () => {
  afterEach(() => {
    jest.dontMock("../Utils/BlogPost");
    jest.resetModules();
  });

  test("titles the feed with the tag's name and links to the tag's feed URL", async () => {
    const xml: string = await renderTagFeed([makePost({ title: "Tag Post" })], {
      slug: "incident-management",
      name: "Incident Management",
    });

    expect(xml).toContain(
      "<title>OneUptime Blog - Incident Management</title>",
    );
    expect(xml).toContain(
      'href="https://oneuptime.com/blog/tag/incident-management/rss.xml"',
    );
    expect(xml).toContain(
      "<link>https://oneuptime.com/blog/tag/incident-management</link>",
    );
  });

  test("reads the tag's posts by its slug", async () => {
    await renderTagFeed([makePost({ title: "Tag Post" })], {
      slug: "ci-cd",
      name: "CI/CD",
    });

    expect(getBlogPostListMock).toHaveBeenCalledWith("ci-cd");
  });

  test("a tag with a slash in its name links to its one address, never to two path segments", async () => {
    const xml: string = await renderTagFeed([makePost({ title: "Tag Post" })], {
      slug: "ci-cd",
      name: "CI/CD",
    });

    // The name reads as the posts write it; the links use the slug.
    expect(xml).toContain("<title>OneUptime Blog - CI/CD</title>");
    expect(xml).toContain(
      'href="https://oneuptime.com/blog/tag/ci-cd/rss.xml"',
    );
    expect(xml).toContain("<link>https://oneuptime.com/blog/tag/ci-cd</link>");
    expect(xml).not.toContain("/blog/tag/ci/cd");
    expect(xml).not.toContain("ci%2Fcd");
  });

  test("percent-encodes a slug in another script in the feed links", async () => {
    const xml: string = await renderTagFeed([makePost({ title: "Tag Post" })], {
      slug: "日本語",
      name: "日本語",
    });

    expect(xml).toContain(
      'href="https://oneuptime.com/blog/tag/%E6%97%A5%E6%9C%AC%E8%AA%9E/rss.xml"',
    );
    expect(xml).toContain("<title>OneUptime Blog - 日本語</title>");
  });

  test("escapes a tag name with XML-significant characters in the feed title", async () => {
    const xml: string = await renderTagFeed([makePost({ title: "Tag Post" })], {
      slug: "r-and-d",
      name: "R&D <Labs>",
    });

    expect(xml).toContain(
      "<title>OneUptime Blog - R&amp;D &lt;Labs&gt;</title>",
    );
    expect(xml).not.toContain("R&D <Labs>");
  });
});
