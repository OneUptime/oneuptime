import BlogPostUtil from "../Utils/BlogPost";
import { BlogRootPath } from "../Utils/Config";
import NotFoundUtil from "../Utils/NotFound";
import "../API/BlogAPI";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
} from "Common/Server/Utils/Express";
import fs from "fs";
import http from "http";
import { JSDOM } from "jsdom";
import { AddressInfo } from "net";
import path from "path";

/*
 * THE BLOG'S LISTS, TAG PAGES, TAG FEEDS AND POSTS, SERVED.
 *
 * Search Console (13 October 2026) had 26,417 tag URLs excluded as noindex
 * and 16,116 blog URLs "Crawled - currently not indexed": tag feeds, and
 * /blog?page=N at two page sizes. Every /blog?page=N declared /blog as its
 * canonical, /blog?page=99999 answered 200, and ?pageSize= took any value
 * from 1 to 100. A tag with a slash in it ("CI/CD", "Pub/Sub") had pagination
 * and feed links that were 404s, and a post's <title>, meta description,
 * Open Graph tags and structured data all began with a space.
 *
 * These run the real routes of API/BlogAPI.ts on a real Express server, with
 * the real BlogPostUtil reading a blog written to a temporary folder and the
 * real templates rendering it. Only what reaches outside is stood in for:
 * the home URL (the database), the git history (contributors) and Markdown
 * (a post body is not what is tested here).
 */

/*
 * Each test renders whole pages - head, navigation, footer and 25 posts -
 * through a real server, some of them twice.
 */
jest.setTimeout(60000);

jest.mock("../Utils/Config", () => {
  const nodeFs: typeof fs = jest.requireActual("fs");
  const nodeOs: typeof import("os") = jest.requireActual("os");
  const nodePath: typeof path = jest.requireActual("path");

  return {
    ...jest.requireActual("../Utils/Config"),
    ViewsPath: nodePath.join(__dirname, "..", "Views"),
    BlogRootPath: nodeFs.mkdtempSync(
      nodePath.join(nodeOs.tmpdir(), "home-blog-pages-"),
    ),
  };
});

jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: {
      getHomeUrl: async (): Promise<{ toString: () => string }> => {
        return {
          toString: (): string => {
            return "https://oneuptime.com/";
          },
        };
      },
    },
  };
});

jest.mock("Common/Server/Utils/CodeRepository/CodeRepository", () => {
  return {
    __esModule: true,
    default: {
      getCommitAuthorsWithFiles: async (): Promise<Array<unknown>> => {
        return [];
      },
    },
  };
});

jest.mock("Common/Server/Types/Markdown", () => {
  return {
    __esModule: true,
    MarkdownContentType: { Blog: "Blog", BlogValidation: "BlogValidation" },
    default: {
      convertToHTML: async (markdown: string): Promise<string> => {
        return `<p>${markdown.replace(/</g, "&lt;")}</p>`;
      },
    },
  };
});

// BlogAPI uses it only for its redirect and file routes, which these do not reach.
jest.mock("Common/Server/Utils/Response", () => {
  return { __esModule: true, default: {} };
});

const HOME_URL: string = "https://oneuptime.com";

interface BlogsJsonEntry {
  post: string;
  title: string;
  description: string;
  authorGitHubUsername: string;
  tags: Array<string>;
}

// Blogs.json lists posts oldest first; the blog shows them newest first.
const POSTS: Array<BlogsJsonEntry> = [];

const addPost: (
  slug: string,
  tags: Array<string>,
  title?: string,
) => BlogsJsonEntry = (
  slug: string,
  tags: Array<string>,
  title?: string,
): BlogsJsonEntry => {
  const day: Date = new Date(Date.UTC(2025, 0, 1 + POSTS.length));
  const entry: BlogsJsonEntry = {
    post: `${day.toISOString().slice(0, 10)}-${slug}`,
    title: title || `Post about ${slug}`,
    description: `What ${slug} is about.`,
    authorGitHubUsername: "someone",
    tags: tags,
  };

  POSTS.push(entry);

  return entry;
};

for (let index: number = 0; index < 60; index++) {
  addPost(`kubernetes-${index}`, ["Kubernetes"]);
}

// One tag written three ways: 30 posts, and the README post below makes 31.
for (let index: number = 0; index < 26; index++) {
  addPost(`ci-cd-${index}`, ["CI/CD"]);
}
addPost("ci-cd-dashed-0", ["Ci-cd"]);
addPost("ci-cd-dashed-1", ["Ci-cd"]);
addPost("ci-cd-spaced-0", ["CI CD"]);
addPost("ci-cd-spaced-1", ["CI CD"]);

addPost("pub-sub-0", ["Pub/Sub"]);
addPost("pub-sub-1", ["Pub/Sub", "Kafka"]);
addPost("pub-sub-2", ["Pub/Sub"]);
addPost("c", ["C"]);
addPost("c-sharp", ["C#"]);
addPost("c-plus-plus", ["C++"]);
addPost("nihongo", ["日本語"]);
addPost("cafe", ["Café"]);
addPost("ipv6-unspecified", ["::", "IPv6"]);
addPost("dollar-lookup", ["$lookup"]);
addPost("lookup-0", ["Lookup"]);
addPost("lookup-1", ["Lookup"]);

// Blogs.json's own title and description, with the space around them.
const SPACED_LIST_POST: BlogsJsonEntry = addPost(
  "spaced-list-entry",
  ["Kafka"],
  "  Leading Space Title  ",
);
SPACED_LIST_POST.description = " A description with space around it. ";

// The newest two: posts with a README, opened by /blog/post/:file/view.
const README_POST: BlogsJsonEntry = addPost(
  "install-chrome-on-ubuntu",
  ["CI/CD", "Pub/Sub", "::", "Let's Encrypt"],
  "How to Install Google Chrome on Ubuntu",
);
const CRLF_POST: BlogsJsonEntry = addPost("spaced-readme", ["Kafka"]);

const README: string = [
  "# How to Install Google Chrome on Ubuntu",
  "",
  "Author: [someone](https://github.com/someone)",
  "",
  "Tags: CI/CD, Pub/Sub, ::, Let's Encrypt",
  "",
  "Description: Installing Chrome from the Debian package Google publishes.",
  "",
  "Download the package and install it.",
].join("\n");

// A README saved with CRLF line ends and more space after its markers.
const CRLF_README: string = [
  "#    A Title With Space Around It   ",
  "",
  "Author: [someone](https://github.com/someone)",
  "",
  "Tags: Kafka,",
  "",
  "Description:    A description with space around it.   ",
  "",
  "The body.",
].join("\r\n");

const TOTAL_POSTS: number = POSTS.length;

let server: http.Server;
let port: number = 0;

beforeAll(async () => {
  fs.writeFileSync(
    path.join(BlogRootPath, "Blogs.json"),
    JSON.stringify(POSTS, null, 2),
  );
  fs.writeFileSync(
    path.join(BlogRootPath, "Tags.md"),
    ["# Tags", "", "- Kubernetes", "- CI/CD", "- Pub/Sub", "- C++"].join("\n"),
  );
  fs.writeFileSync(
    path.join(BlogRootPath, "Authors.json"),
    JSON.stringify({ someone: { authorName: "Some One" } }),
  );

  for (const [entry, readme] of [
    [README_POST, README],
    [CRLF_POST, CRLF_README],
  ] as Array<[BlogsJsonEntry, string]>) {
    fs.mkdirSync(path.join(BlogRootPath, "posts", entry.post), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(BlogRootPath, "posts", entry.post, "README.md"),
      readme,
    );
  }

  BlogPostUtil.clearAllCaches();

  // BlogAPI registered its routes on this app; Routes.ts ends with the not-found page.
  const app: ExpressApplication = Express.getExpressApp();

  app.set("view engine", "ejs");
  app.get("/*", (_req: ExpressRequest, res: ExpressResponse) => {
    return NotFoundUtil.renderNotFound(res);
  });

  server = http.createServer(app);
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
  fs.rmSync(BlogRootPath, { recursive: true, force: true });
});

interface Answer {
  status: number;
  location: string | null;
  robots: string | null;
  contentType: string;
  body: string;
}

const get: (urlPath: string) => Promise<Answer> = (
  urlPath: string,
): Promise<Answer> => {
  return new Promise<Answer>(
    (resolve: (answer: Answer) => void, reject: (error: Error) => void) => {
      http
        .request(
          {
            method: "GET",
            host: "127.0.0.1",
            port: port,
            path: urlPath,
            agent: false,
          },
          (response: http.IncomingMessage) => {
            let body: string = "";

            response.setEncoding("utf8");
            response.on("data", (chunk: string) => {
              body += chunk;
            });
            response.on("end", () => {
              const header: (name: string) => string | null = (
                name: string,
              ): string | null => {
                const value: string | Array<string> | undefined =
                  response.headers[name];

                return value === undefined ? null : String(value);
              };

              resolve({
                status: response.statusCode || 0,
                location: header("location"),
                robots: header("x-robots-tag"),
                contentType: header("content-type") || "",
                body: body,
              });
            });
          },
        )
        .on("error", reject)
        .end();
    },
  );
};

const REL_CANONICAL: RegExp = /\brel="canonical"/i;

// The page's canonical URLs (there must be exactly one).
const canonicalUrlsIn: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  return (html.match(/<link\b[^>]*>/gi) || [])
    .filter((tag: string) => {
      return REL_CANONICAL.test(tag);
    })
    .map((tag: string) => {
      return tag.match(/\bhref="([^"]*)"/i)?.[1] || "";
    });
};

// Every href of an <a> on the page.
const linksIn: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/gi)].map(
    (match: RegExpMatchArray) => {
      return match[1] || "";
    },
  );
};

// The pagination's links: the hrefs in its <nav>.
const paginationLinksIn: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  const nav: string =
    html.match(/<nav\b[^>]*aria-label="Pagination"[\s\S]*?<\/nav>/i)?.[0] || "";

  return linksIn(nav);
};

// The posts a list page shows, by file name, in order.
const postsShownIn: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  const shown: Array<string> = [];

  for (const match of html.matchAll(/href="\/blog\/post\/([^/"]+)\/view"/g)) {
    const fileName: string = match[1] || "";

    if (!shown.includes(fileName)) {
      shown.push(fileName);
    }
  }

  return shown;
};

const titleOf: (html: string) => string = (html: string): string => {
  return html.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "";
};

// The newest posts first, as the blog lists them.
const NEWEST_FIRST: Array<string> = POSTS.map((entry: BlogsJsonEntry) => {
  return entry.post;
}).reverse();

describe("/blog", () => {
  test("its first page shows 25 posts, newest first, and is its own canonical", async () => {
    const answer: Answer = await get("/blog");

    expect(answer.status).toBe(200);
    expect(canonicalUrlsIn(answer.body)).toEqual([`${HOME_URL}/blog`]);
    expect(postsShownIn(answer.body)).toEqual(NEWEST_FIRST.slice(0, 25));
    expect(titleOf(answer.body)).toBe(
      "OneUptime Blog - Latest posts on Observability, Monitoring, Reliability and more.",
    );
  });

  test("each later page shows the next 25 posts and is its own canonical", async () => {
    const answer: Answer = await get("/blog?page=2");

    expect(answer.status).toBe(200);
    expect(canonicalUrlsIn(answer.body)).toEqual([`${HOME_URL}/blog?page=2`]);
    expect(postsShownIn(answer.body)).toEqual(NEWEST_FIRST.slice(25, 50));
    expect(titleOf(answer.body)).toBe(
      "OneUptime Blog - Page 2 - Latest posts on Observability, Monitoring, Reliability and more.",
    );
  });

  test("the last page shows what is left", async () => {
    const lastPage: number = Math.ceil(TOTAL_POSTS / 25);
    const answer: Answer = await get(`/blog?page=${lastPage}`);

    expect(answer.status).toBe(200);
    expect(postsShownIn(answer.body)).toEqual(
      NEWEST_FIRST.slice((lastPage - 1) * 25),
    );
  });

  test("its pagination links name pages by number alone: no page size, and page 1 is /blog", async () => {
    const answer: Answer = await get("/blog?page=3");
    const links: Array<string> = paginationLinksIn(answer.body);

    expect(links).toEqual(
      expect.arrayContaining(["/blog?page=2", "/blog", "/blog?page=4"]),
    );
    expect(
      links.filter((link: string) => {
        return (
          link.includes("pageSize") ||
          link.includes("page=1&") ||
          link.endsWith("page=1")
        );
      }),
    ).toEqual([]);
    expect(answer.body).not.toContain("pageSize=");
  });

  test.each([
    `?page=${Math.ceil(TOTAL_POSTS / 25) + 1}`,
    "?page=99999",
    "?page=0",
    "?page=-1",
    "?page=abc",
    "?page=2.5",
    "?page=",
    "?page=1&page=2",
  ])("/blog%s is a 404", async (query: string) => {
    const answer: Answer = await get(`/blog${query}`);

    expect(answer.status).toBe(404);
    expect(titleOf(answer.body)).toBe("OneUptime | Page not found");
    expect(answer.location).toBeNull();
  });

  test.each([
    ["?page=2&pageSize=24", "/blog?page=2"],
    ["?page=2&pageSize=25", "/blog?page=2"],
    ["?pageSize=100", "/blog"],
    ["?page=3&pageSize=1", "/blog?page=3"],
    ["?page=1", "/blog"],
    ["?page=02", "/blog?page=2"],
    [
      "?page=2&pageSize=24&utm_source=newsletter",
      "/blog?page=2&utm_source=newsletter",
    ],
  ])("/blog%s is sent (301) to %s", async (query: string, target: string) => {
    const answer: Answer = await get(`/blog${query}`);

    expect(answer.status).toBe(301);
    expect(answer.location).toBe(target);
  });

  test("a page size on a page past the end is a 404, not a redirect to one", async () => {
    const answer: Answer = await get("/blog?page=99999&pageSize=24");

    expect(answer.status).toBe(404);
    expect(answer.location).toBeNull();
  });
});

describe("a tag's page", () => {
  test("is its own canonical, page by page, 25 posts a page", async () => {
    const first: Answer = await get("/blog/tag/kubernetes");
    const third: Answer = await get("/blog/tag/kubernetes?page=3");

    expect(first.status).toBe(200);
    expect(canonicalUrlsIn(first.body)).toEqual([
      `${HOME_URL}/blog/tag/kubernetes`,
    ]);
    expect(postsShownIn(first.body)).toHaveLength(25);

    expect(third.status).toBe(200);
    expect(canonicalUrlsIn(third.body)).toEqual([
      `${HOME_URL}/blog/tag/kubernetes?page=3`,
    ]);
    expect(postsShownIn(third.body)).toHaveLength(10);
    expect(titleOf(third.body)).toBe(
      "Latest Posts on Kubernetes - Page 3 - OneUptime Blog",
    );
  });

  test("stays out of the index and lets its links be followed", async () => {
    const answer: Answer = await get("/blog/tag/kubernetes?page=2");

    expect(answer.body).toContain(
      '<meta name="robots" content="noindex, follow">',
    );
  });

  test("links its pages by number alone", async () => {
    const answer: Answer = await get("/blog/tag/kubernetes?page=2");

    expect(paginationLinksIn(answer.body)).toEqual(
      expect.arrayContaining([
        "/blog/tag/kubernetes",
        "/blog/tag/kubernetes?page=3",
      ]),
    );
    expect(answer.body).not.toContain("pageSize=");
  });

  test.each(["?page=4", "?page=0", "?page=abc", "?page=99999"])(
    "/blog/tag/kubernetes%s is a 404",
    async (query: string) => {
      const answer: Answer = await get(`/blog/tag/kubernetes${query}`);

      expect(answer.status).toBe(404);
      expect(answer.location).toBeNull();
    },
  );

  test.each([
    ["?page=2&pageSize=10", "/blog/tag/kubernetes?page=2"],
    ["?pageSize=25", "/blog/tag/kubernetes"],
    ["?page=1", "/blog/tag/kubernetes"],
  ])(
    "/blog/tag/kubernetes%s is sent (301) to %s",
    async (query: string, target: string) => {
      const answer: Answer = await get(`/blog/tag/kubernetes${query}`);

      expect(answer.status).toBe(301);
      expect(answer.location).toBe(target);
    },
  );

  test("a tag no post carries is a 404, not an empty page", async () => {
    const answer: Answer = await get("/blog/tag/no-such-tag");

    expect(answer.status).toBe(404);
    expect(titleOf(answer.body)).toBe("OneUptime | Page not found");
  });

  test("a tag that is written differently is sent to its own address", async () => {
    const answer: Answer = await get("/blog/tag/Kubernetes?page=2");

    expect(answer.status).toBe(301);
    expect(answer.location).toBe("/blog/tag/kubernetes?page=2");
  });
});

describe("a tag with a slash in its name", () => {
  test("has a page at /blog/tag/ci-cd, named as its posts write it", async () => {
    const answer: Answer = await get("/blog/tag/ci-cd");

    expect(answer.status).toBe(200);
    expect(titleOf(answer.body)).toBe("Latest Posts on CI/CD - OneUptime Blog");
    expect(canonicalUrlsIn(answer.body)).toEqual([
      `${HOME_URL}/blog/tag/ci-cd`,
    ]);
  });

  test("its page lists the posts of every way of writing it: CI/CD, Ci-cd and CI CD", async () => {
    const first: Answer = await get("/blog/tag/ci-cd");
    const second: Answer = await get("/blog/tag/ci-cd?page=2");
    const shown: Array<string> = [
      ...postsShownIn(first.body),
      ...postsShownIn(second.body),
    ];

    expect(shown).toHaveLength(31);
    expect(shown).toEqual(
      expect.arrayContaining([
        POSTS.find((entry: BlogsJsonEntry) => {
          return entry.post.endsWith("ci-cd-dashed-0");
        })?.post,
        POSTS.find((entry: BlogsJsonEntry) => {
          return entry.post.endsWith("ci-cd-spaced-1");
        })?.post,
        README_POST.post,
      ]),
    );
    expect((await get("/blog/tag/ci-cd?page=3")).status).toBe(404);
  });

  test("its pagination and feed links stay on its one address", async () => {
    const answer: Answer = await get("/blog/tag/ci-cd");

    expect(paginationLinksIn(answer.body)).toContain("/blog/tag/ci-cd?page=2");
    expect(linksIn(answer.body)).toContain("/blog/tag/ci-cd/rss.xml");
    expect(answer.body).toContain(
      '<link rel="alternate" type="application/rss+xml" title="OneUptime Blog - CI/CD RSS Feed" href="/blog/tag/ci-cd/rss.xml">',
    );
    expect(answer.body).not.toContain("/blog/tag/ci/cd");
    expect(answer.body.toLowerCase()).not.toContain("ci%2fcd");
  });

  test.each([
    ["/blog/tag/ci%2Fcd", "/blog/tag/ci-cd"],
    ["/blog/tag/CI%2FCD", "/blog/tag/ci-cd"],
    ["/blog/tag/ci/cd", "/blog/tag/ci-cd"],
    ["/blog/tag/ci/cd?page=2&pageSize=25", "/blog/tag/ci-cd?page=2"],
    ["/blog/tag/ci/cd?page=1&pageSize=25", "/blog/tag/ci-cd"],
    ["/blog/tag/pub%2Fsub", "/blog/tag/pub-sub"],
    ["/blog/tag/pub/sub", "/blog/tag/pub-sub"],
    ["/blog/tag/ci/cd/rss.xml", "/blog/tag/ci-cd/rss.xml"],
    ["/blog/tag/ci%2Fcd/rss.xml", "/blog/tag/ci-cd/rss.xml"],
    [
      "/blog/tag/CI%2FCD/rss.xml?utm_source=feedly",
      "/blog/tag/ci-cd/rss.xml?utm_source=feedly",
    ],
    ["/blog/tag/pub/sub/rss.xml", "/blog/tag/pub-sub/rss.xml"],
  ])(
    "its old address %s is sent (301) to %s",
    async (from: string, to: string) => {
      const answer: Answer = await get(from);

      expect(answer.status).toBe(301);
      expect(answer.location).toBe(to);
    },
  );

  test("an old address past its last page is a 404, not a redirect to one", async () => {
    const answer: Answer = await get("/blog/tag/ci/cd?page=3&pageSize=25");

    expect(answer.status).toBe(404);
    expect(answer.location).toBeNull();
  });

  test("a path of segments that names no tag is a 404", async () => {
    for (const urlPath of [
      "/blog/tag/a/b/c",
      "/blog/tag/no/such",
      "/blog/tag/no/such/rss.xml",
    ]) {
      const answer: Answer = await get(urlPath);

      expect([urlPath, answer.status, answer.location]).toEqual([
        urlPath,
        404,
        null,
      ]);
    }
  });
});

describe("tags with symbols and other scripts", () => {
  test("C, C# and C++ have pages of their own", async () => {
    const pages: Array<Answer> = await Promise.all([
      get("/blog/tag/c"),
      get("/blog/tag/c-sharp"),
      get("/blog/tag/c-plus-plus"),
    ]);

    expect(
      pages.map((answer: Answer) => {
        return [
          answer.status,
          titleOf(answer.body),
          postsShownIn(answer.body).length,
        ];
      }),
    ).toEqual([
      [200, "Latest Posts on C - OneUptime Blog", 1],
      [200, "Latest Posts on C# - OneUptime Blog", 1],
      [200, "Latest Posts on C++ - OneUptime Blog", 1],
    ]);
  });

  test.each([
    ["/blog/tag/c%2B%2B", "/blog/tag/c-plus-plus"],
    ["/blog/tag/c%23", "/blog/tag/c-sharp"],
    ["/blog/tag/let's-encrypt", "/blog/tag/lets-encrypt"],
    ["/blog/tag/%24lookup", "/blog/tag/lookup"],
    ["/blog/tag/cafe%CC%81", "/blog/tag/caf%C3%A9"],
    ["/blog/tag/CAF%C3%89", "/blog/tag/caf%C3%A9"],
  ])(
    "the old or other address %s is sent (301) to %s",
    async (from: string, to: string) => {
      const answer: Answer = await get(from);

      expect(answer.status).toBe(301);
      expect(answer.location).toBe(to);
    },
  );

  test("a tag in another script has a page at its percent-encoded slug", async () => {
    const answer: Answer = await get("/blog/tag/%E6%97%A5%E6%9C%AC%E8%AA%9E");

    expect(answer.status).toBe(200);
    expect(titleOf(answer.body)).toBe(
      "Latest Posts on 日本語 - OneUptime Blog",
    );
    expect(canonicalUrlsIn(answer.body)).toEqual([
      `${HOME_URL}/blog/tag/%E6%97%A5%E6%9C%AC%E8%AA%9E`,
    ]);
  });

  test("$lookup and Lookup share the page of the slug they share, named as most of its posts write it", async () => {
    const answer: Answer = await get("/blog/tag/lookup");

    expect(answer.status).toBe(200);
    expect(titleOf(answer.body)).toBe(
      "Latest Posts on Lookup - OneUptime Blog",
    );
    expect(postsShownIn(answer.body)).toHaveLength(3);
  });

  test("a tag with nothing that can go into a URL has no page", async () => {
    expect((await get("/blog/tag/%3A%3A")).status).toBe(404);
  });
});

describe("tag chips", () => {
  test("link every tag to its one address, and show a tag with none as text", async () => {
    const answer: Answer = await get("/blog");
    const links: Array<string> = linksIn(answer.body);

    expect(links).toEqual(
      expect.arrayContaining([
        "/blog/tag/ci-cd",
        "/blog/tag/pub-sub",
        "/blog/tag/lets-encrypt",
        "/blog/tag/kafka",
      ]),
    );
    expect(
      links.filter((link: string) => {
        return link.startsWith("/blog/tag/") && link.split("/").length !== 4;
      }),
    ).toEqual([]);
    expect(
      links.filter((link: string) => {
        return (
          link.startsWith("/blog/tag/") && link.toLowerCase().includes("%2f")
        );
      }),
    ).toEqual([]);
    // "::" is shown, but links nowhere.
    expect(answer.body).toMatch(
      /<span class="group\/tag">\s*<span[^>]*>\s*<span[^>]*><\/span>\s*::/,
    );
    expect(links).not.toContain("/blog/tag/");
  });
});

describe("a tag's feed", () => {
  test("is RSS that search engines are told not to index", async () => {
    const answer: Answer = await get("/blog/tag/ci-cd/rss.xml");

    expect(answer.status).toBe(200);
    expect(answer.contentType).toContain("application/rss+xml");
    expect(answer.robots).toBe("noindex");
    expect(answer.body).toContain("<title>OneUptime Blog - CI/CD</title>");
    expect(answer.body).toContain(
      'href="https://oneuptime.com/blog/tag/ci-cd/rss.xml"',
    );
    expect(answer.body).toContain(
      "<link>https://oneuptime.com/blog/tag/ci-cd</link>",
    );
  });

  test("lists the tag's posts, however each writes the tag", async () => {
    const answer: Answer = await get("/blog/tag/ci-cd/rss.xml");

    expect((answer.body.match(/<item>/g) || []).length).toBe(31);
  });

  test("every tag's feed says noindex", async () => {
    for (const urlPath of [
      "/blog/tag/kubernetes/rss.xml",
      "/blog/tag/pub-sub/rss.xml",
      "/blog/tag/c-plus-plus/rss.xml",
      "/blog/tag/%E6%97%A5%E6%9C%AC%E8%AA%9E/rss.xml",
    ]) {
      const answer: Answer = await get(urlPath);

      expect([urlPath, answer.status, answer.robots]).toEqual([
        urlPath,
        200,
        "noindex",
      ]);
    }
  });

  test("of a tag no post carries is a 404", async () => {
    const answer: Answer = await get("/blog/tag/no-such-tag/rss.xml");

    expect(answer.status).toBe(404);
    expect(answer.body).toBe("Blog tag not found.");
  });

  test("written another way is sent (301) to the tag's feed", async () => {
    const answer: Answer = await get("/blog/tag/Kubernetes/rss.xml");

    expect(answer.status).toBe(301);
    expect(answer.location).toBe("/blog/tag/kubernetes/rss.xml");
  });

  test("the main feed stays indexable: Routes.ts serves it without X-Robots-Tag", () => {
    const routes: string = fs.readFileSync(
      path.join(__dirname, "..", "Routes.ts"),
      "utf8",
    );
    const start: number = routes.indexOf('"/blog/rss.xml"');
    const end: number = routes.indexOf("app.get(", start);

    expect(start).toBeGreaterThan(-1);
    expect(routes.slice(start, end)).not.toContain("X-Robots-Tag");
    // The tags' feeds are BlogAPI's, served ahead of its route for old tag addresses.
    expect(routes).not.toContain('"/blog/tag/:tagName/rss.xml"');
  });
});

describe("a post's title and description", () => {
  interface PostHead {
    title: string;
    description: string | null;
    ogTitle: string | null;
    ogDescription: string | null;
    twitterTitle: string | null;
    twitterDescription: string | null;
    headline: unknown;
    structuredDescription: unknown;
    breadcrumb: unknown;
  }

  const headOf: (html: string) => PostHead = (html: string): PostHead => {
    const document: Document = new JSDOM(html).window.document;
    const meta: (selector: string) => string | null = (
      selector: string,
    ): string | null => {
      return document.querySelector(selector)?.getAttribute("content") ?? null;
    };
    const structuredData: Array<Record<string, unknown>> = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    ).map((script: Element) => {
      return JSON.parse(script.textContent || "{}") as Record<string, unknown>;
    });
    const posting: Record<string, unknown> | undefined = structuredData.find(
      (item: Record<string, unknown>) => {
        return item["@type"] === "BlogPosting";
      },
    );
    const breadcrumbs: Record<string, unknown> | undefined =
      structuredData.find((item: Record<string, unknown>) => {
        return item["@type"] === "BreadcrumbList";
      });

    return {
      // The element's own text, not document.title, which trims it.
      title: document.querySelector("title")?.textContent ?? "",
      description: meta('meta[name="description"]'),
      ogTitle: meta('meta[property="og:title"]'),
      ogDescription: meta('meta[property="og:description"]'),
      twitterTitle: meta('meta[name="twitter:title"]'),
      twitterDescription: meta('meta[name="twitter:description"]'),
      headline: posting?.["headline"],
      structuredDescription: posting?.["description"],
      breadcrumb: (
        breadcrumbs?.["itemListElement"] as Array<Record<string, unknown>>
      )?.[2]?.["name"],
    };
  };

  test("reach every place they go without the space after '#' and 'Description:'", async () => {
    const answer: Answer = await get(`/blog/post/${README_POST.post}/view`);
    const title: string = "How to Install Google Chrome on Ubuntu";
    const description: string =
      "Installing Chrome from the Debian package Google publishes.";

    expect(answer.status).toBe(200);
    expect(headOf(answer.body)).toEqual({
      title: title,
      description: description,
      ogTitle: title,
      ogDescription: description,
      twitterTitle: title,
      twitterDescription: description,
      headline: title,
      structuredDescription: description,
      breadcrumb: title,
    });
  });

  test("are trimmed of every space and the \\r of a README saved with CRLF line ends", async () => {
    const answer: Answer = await get(`/blog/post/${CRLF_POST.post}/view`);
    const title: string = "A Title With Space Around It";
    const description: string = "A description with space around it.";

    expect(answer.status).toBe(200);
    expect(headOf(answer.body)).toEqual({
      title: title,
      description: description,
      ogTitle: title,
      ogDescription: description,
      twitterTitle: title,
      twitterDescription: description,
      headline: title,
      structuredDescription: description,
      breadcrumb: title,
    });
  });

  test("the post's tag chips link to each tag's one address", async () => {
    const answer: Answer = await get(`/blog/post/${README_POST.post}/view`);
    const links: Array<string> = linksIn(answer.body);

    expect(links).toEqual(
      expect.arrayContaining([
        "/blog/tag/ci-cd",
        "/blog/tag/pub-sub",
        "/blog/tag/lets-encrypt",
      ]),
    );
    expect(answer.body).not.toContain("/blog/tag/ci%2Fcd");
  });

  test("a README's trailing comma in Tags: is not an empty tag", async () => {
    const answer: Answer = await get(`/blog/post/${CRLF_POST.post}/view`);

    expect(linksIn(answer.body)).toContain("/blog/tag/kafka");
    expect(answer.body).not.toMatch(
      /<span class="group\/tag">\s*<span[^>]*>\s*<span[^>]*><\/span>\s*<\/span>/,
    );
  });

  test("the Markdown version starts with the title after one '# '", async () => {
    const answer: Answer = await get(`/blog/post/${README_POST.post}/markdown`);

    expect(answer.body.split("\n")[0]).toBe(
      "# How to Install Google Chrome on Ubuntu",
    );
  });

  test("a list reads Blogs.json's title and description trimmed too", async () => {
    const answer: Answer = await get("/blog");

    expect(answer.body).toContain(
      'aria-label="Blog post card: Leading Space Title"',
    );
    expect(answer.body).toContain(">A description with space around it.</p>");
    // The list's search text joins the title, description and tags with one space each.
    expect(answer.body).toContain(
      'data-search="leading space title a description with space around it. kafka"',
    );
  });
});
