import BlogPostUtil, {
  BlogPost,
  BlogPostHeader,
  BlogTagSummary,
} from "../Utils/BlogPost";
import { ViewsPath } from "../Utils/Config";
import "../API/BlogAPI";
import Express, {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import ejs from "ejs";
import path from "path";

/*
 * The canonical URL of every page the blog renders.
 *
 * The blog's routes (API/BlogAPI.ts) register before the middleware in
 * Routes.ts that hands every other page its `seo` local, so each blog page has
 * to pass its own. From January to October 2026 none did: the post template
 * declared a `const seo` that never reached the head it includes, the head
 * fell back to the homepage, and every post and tag page told search engines
 * it was a copy of https://oneuptime.com. Search Console showed Google
 * dropping posts as "Alternate page with proper canonical tag".
 *
 * These tests call the real route handlers, with the blog's content stubbed
 * out, and render the real templates with exactly the locals the routes hand
 * them - no homeUrl and no seo beyond what the route passes, as in production.
 */

type RouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

jest.mock("../Utils/BlogPost", () => {
  return {
    __esModule: true,
    default: {
      getBlogPost: jest.fn(),
      getBlogPostList: jest.fn(),
      getTagBySlug: jest.fn(),
      getTags: jest.fn(),
      getHomeUrl: jest.fn(),
    },
  };
});

// Collects the routes BlogAPI registers, so the tests can call them directly.
jest.mock("Common/Server/Utils/Express", () => {
  const registeredRoutes: Map<string, RouteHandler> = new Map();

  return {
    __esModule: true,
    default: {
      registeredRoutes: registeredRoutes,
      getExpressApp: (): {
        get: (path: string, handler: RouteHandler) => void;
      } => {
        return {
          get: (routePath: string, handler: RouteHandler): void => {
            registeredRoutes.set(routePath, handler);
          },
        };
      },
    },
  };
});

// BlogAPI only uses it for redirects and files, which these tests do not reach.
jest.mock("Common/Server/Utils/Response", () => {
  return { __esModule: true, default: {} };
});

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const HOME_URL: string = "https://oneuptime.com";
const POST_FILE: string = "2026-03-02-how-to-install-google-chrome-on-ubuntu";
const POST_URL: string = `${HOME_URL}/blog/post/${POST_FILE}/view`;

const registeredRoutes: Map<string, RouteHandler> = (
  Express as unknown as { registeredRoutes: Map<string, RouteHandler> }
).registeredRoutes;

const blogPost: BlogPost = {
  title: "How to Install Google Chrome on Ubuntu",
  description: "Installing Chrome from Google's Debian package.",
  formattedPostDate: "March 02, 2026",
  fileName: POST_FILE,
  tags: ["Ubuntu"],
  postDate: "2026-03-02",
  blogUrl: POST_URL,
  contributors: [],
  htmlBody: "<p>Download the package and install it.</p>",
  markdownBody: "Download the package and install it.",
  socialMediaImageUrl: `${HOME_URL}/blog/post/${POST_FILE}/social-media.png`,
  author: {
    username: "someone",
    githubUrl: "https://github.com/someone",
    profileImageUrl: "https://github.com/someone.png",
    name: "Some One",
  },
  validationStatus: null,
  validationDate: null,
};

const postHeader: (index: number) => BlogPostHeader = (
  index: number,
): BlogPostHeader => {
  const fileName: string = `2026-01-${String((index % 28) + 1).padStart(2, "0")}-post-${index}`;

  return {
    title: `Post ${index}`,
    description: `Description of post ${index}.`,
    formattedPostDate: "January 01, 2026",
    fileName: fileName,
    tags: ["Kubernetes"],
    postDate: "2026-01-01",
    blogUrl: `${HOME_URL}/blog/post/${fileName}/view`,
    contributors: [],
    authorGitHubUsername: "someone",
  };
};

interface RenderedPage {
  view: string;
  locals: Record<string, unknown>;
}

// Calls a registered route and returns what it asked Express to render.
const renderedBy: (
  routePath: string,
  req: { params: Record<string, string>; query: Record<string, string> },
) => Promise<RenderedPage> = async (
  routePath: string,
  req: { params: Record<string, string>; query: Record<string, string> },
): Promise<RenderedPage> => {
  const handler: RouteHandler | undefined = registeredRoutes.get(routePath);

  if (!handler) {
    throw new Error(`BlogAPI registers no route for ${routePath}`);
  }

  const rendered: Array<RenderedPage> = [];
  const res: ExpressResponse = {
    render: (view: string, locals: Record<string, unknown>): void => {
      rendered.push({ view, locals });
    },
    status: (): ExpressResponse => {
      return res;
    },
  } as unknown as ExpressResponse;
  const next: jest.Mock = jest.fn();

  await handler(req as unknown as ExpressRequest, res, next);

  expect(next).not.toHaveBeenCalled();
  expect(rendered).toHaveLength(1);

  return rendered[0]!;
};

// Renders the template a route chose, from this checkout, with the route's locals.
const html: (page: RenderedPage) => Promise<string> = async (
  page: RenderedPage,
): Promise<string> => {
  expect(page.view.startsWith(`${ViewsPath}/`)).toBe(true);

  const template: string = path.join(
    VIEWS_ROOT,
    `${page.view.slice(ViewsPath.length + 1)}.ejs`,
  );

  return (await ejs.renderFile(template, page.locals, {
    views: [VIEWS_ROOT],
  })) as string;
};

const REL_CANONICAL: RegExp = /\brel=["']canonical["']/i;
const PROPERTY_OG_URL: RegExp = /\bproperty=["']og:url["']/i;

const canonicalUrls: (page: string) => Array<string> = (
  page: string,
): Array<string> => {
  return (page.match(/<link\b[^>]*>/gi) || [])
    .filter((tag: string): boolean => {
      return REL_CANONICAL.test(tag);
    })
    .map((tag: string): string => {
      return tag.match(/\bhref=["']([^"']*)["']/i)?.[1] || "";
    });
};

const ogUrl: (page: string) => string | null = (
  page: string,
): string | null => {
  const tag: string | undefined = (page.match(/<meta\b[^>]*>/gi) || []).find(
    (meta: string): boolean => {
      return PROPERTY_OG_URL.test(meta);
    },
  );

  return tag?.match(/\bcontent=["']([^"']*)["']/i)?.[1] || null;
};

// The tags that have a page, by slug, as BlogPostUtil.getTagBySlug finds them.
const TAGS: Map<string, BlogTagSummary> = new Map([
  ["kubernetes", { slug: "kubernetes", name: "Kubernetes" }],
  ["c-plus-plus", { slug: "c-plus-plus", name: "C++" }],
  ["日本語", { slug: "日本語", name: "日本語" }],
]);

beforeEach(() => {
  jest.mocked(BlogPostUtil.getBlogPost).mockResolvedValue(blogPost);
  jest.mocked(BlogPostUtil.getBlogPostList).mockResolvedValue(
    Array.from({ length: 60 }, (_: unknown, index: number): BlogPostHeader => {
      return postHeader(index);
    }),
  );
  jest
    .mocked(BlogPostUtil.getTagBySlug)
    .mockImplementation(async (slug: string) => {
      return TAGS.get(slug) || null;
    });
  jest.mocked(BlogPostUtil.getTags).mockResolvedValue(["kubernetes", "c++"]);
  jest.mocked(BlogPostUtil.getHomeUrl).mockResolvedValue({
    toString: (): string => {
      return `${HOME_URL}/`;
    },
  } as unknown as Awaited<ReturnType<typeof BlogPostUtil.getHomeUrl>>);
});

describe("Blog post canonical URL", () => {
  test("a post declares its own URL as its only canonical", async () => {
    const page: string = await html(
      await renderedBy("/blog/post/:file/view", {
        params: { file: POST_FILE },
        query: {},
      }),
    );

    expect(canonicalUrls(page)).toEqual([POST_URL]);
  });

  test("a post never declares the homepage as its canonical", async () => {
    const page: string = await html(
      await renderedBy("/blog/post/:file/view", {
        params: { file: POST_FILE },
        query: {},
      }),
    );

    for (const url of canonicalUrls(page)) {
      expect(url.replace(/\/$/, "")).not.toBe(HOME_URL);
    }
  });
});

describe("Blog tag page canonical URL", () => {
  test("a tag page declares its own first page as its only canonical", async () => {
    const page: string = await html(
      await renderedBy("/blog/tag/:tagSlug", {
        params: { tagSlug: "kubernetes" },
        query: {},
      }),
    );

    expect(canonicalUrls(page)).toEqual([`${HOME_URL}/blog/tag/kubernetes`]);
  });

  test("a later page of a tag is its own canonical, with only its page number", async () => {
    const page: string = await html(
      await renderedBy("/blog/tag/:tagSlug", {
        params: { tagSlug: "kubernetes" },
        query: { page: "2", utm_source: "newsletter" },
      }),
    );

    expect(canonicalUrls(page)).toEqual([
      `${HOME_URL}/blog/tag/kubernetes?page=2`,
    ]);
  });

  test("the social preview URL matches the canonical instead of the homepage", async () => {
    const page: string = await html(
      await renderedBy("/blog/tag/:tagSlug", {
        params: { tagSlug: "kubernetes" },
        query: {},
      }),
    );

    expect(ogUrl(page)).toBe(`${HOME_URL}/blog/tag/kubernetes`);
  });

  test("a tag whose name is not URL-safe is addressed by its slug", async () => {
    const page: string = await html(
      await renderedBy("/blog/tag/:tagSlug", {
        params: { tagSlug: "c-plus-plus" },
        query: {},
      }),
    );

    expect(canonicalUrls(page)).toEqual([`${HOME_URL}/blog/tag/c-plus-plus`]);
  });

  test("a tag in another script is percent-encoded in the canonical", async () => {
    const page: string = await html(
      await renderedBy("/blog/tag/:tagSlug", {
        params: { tagSlug: "日本語" },
        query: {},
      }),
    );

    expect(canonicalUrls(page)).toEqual([
      `${HOME_URL}/blog/tag/%E6%97%A5%E6%9C%AC%E8%AA%9E`,
    ]);
  });
});

describe("Blog list canonical URL", () => {
  test("the first page of the blog declares /blog as its canonical", async () => {
    const page: string = await html(
      await renderedBy("/blog", { params: {}, query: {} }),
    );

    expect(canonicalUrls(page)).toEqual([`${HOME_URL}/blog`]);
  });

  test("a later page of the blog is its own canonical", async () => {
    const page: string = await html(
      await renderedBy("/blog", { params: {}, query: { page: "3" } }),
    );

    expect(canonicalUrls(page)).toEqual([`${HOME_URL}/blog?page=3`]);
    expect(ogUrl(page)).toBe(`${HOME_URL}/blog?page=3`);
  });
});

describe("Shared head canonical fallback", () => {
  test("a page that supplies no canonical gets none, not the homepage's", async () => {
    const head: string = (await ejs.renderFile(
      path.join(VIEWS_ROOT, "head-basic.ejs"),
      {
        enableGoogleTagManager: false,
        homeUrl: HOME_URL,
      },
    )) as string;

    expect(canonicalUrls(head)).toEqual([]);
  });

  test("a page that supplies a canonical gets exactly that one", async () => {
    const head: string = (await ejs.renderFile(
      path.join(VIEWS_ROOT, "head-basic.ejs"),
      {
        enableGoogleTagManager: false,
        homeUrl: HOME_URL,
        seo: { fullCanonicalUrl: `${HOME_URL}/pricing` },
      },
    )) as string;

    expect(canonicalUrls(head)).toEqual([`${HOME_URL}/pricing`]);
  });
});
