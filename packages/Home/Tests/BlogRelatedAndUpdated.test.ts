import BlogPostUtil from "../Utils/BlogPost";
import { BlogRootPath } from "../Utils/Config";
import NotFoundUtil from "../Utils/NotFound";
import {
  generateBlogSitemapXml,
  generateSitemapIndexXml,
} from "../Utils/Sitemap";
import "../API/BlogAPI";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
} from "Common/Server/Utils/Express";
import fs from "fs";
import http from "http";
import { AddressInfo } from "net";
import path from "path";

/*
 * A BLOG POST'S RELATED POSTS AND ITS UPDATED DATE, SERVED.
 *
 * Of 60 posts drawn at random from the blog, 54 linked to no other post, and
 * every post's page, structured data and sitemap entry said it was modified
 * the day it was published, whatever changed after. Now each post's page
 * links the posts most like it (Utils/BlogRelatedPosts.ts), and a post whose
 * README a later commit changed says when (Utils/BlogPostUpdatedDate.ts):
 * on its page, in its structured data, in its Markdown copy and in the
 * sitemap.
 *
 * These run the real routes of API/BlogAPI.ts on a real Express server, with
 * the real BlogPostUtil reading a blog written to a temporary folder and the
 * real templates rendering it. Only what reaches outside is stood in for:
 * the home URL (the database), the git history and Markdown.
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
      nodePath.join(nodeOs.tmpdir(), "home-blog-related-"),
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

// The blog's git history, newest first, as getCommitAuthorsWithFiles lists it.
interface MockCommit {
  authorName: string;
  authorEmail: string;
  committedAt: string;
  files: Array<string>;
}

const mockGitHistory: { commits: Array<MockCommit>; failure: Error | null } = {
  commits: [],
  failure: null,
};

jest.mock("Common/Server/Utils/CodeRepository/CodeRepository", () => {
  return {
    __esModule: true,
    default: {
      getCommitAuthorsWithFiles: async (): Promise<Array<MockCommit>> => {
        if (mockGitHistory.failure) {
          throw mockGitHistory.failure;
        }

        return mockGitHistory.commits;
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

// Blogs.json lists posts oldest first.
const POSTS: Array<BlogsJsonEntry> = [];

const addPost: (
  post: string,
  tags: Array<string>,
  title: string,
) => BlogsJsonEntry = (
  post: string,
  tags: Array<string>,
  title: string,
): BlogsJsonEntry => {
  const entry: BlogsJsonEntry = {
    post: post,
    title: title,
    description: `What ${title} is about.`,
    authorGitHubUsername: "someone",
    tags: tags,
  };

  POSTS.push(entry);

  return entry;
};

// Posts on tags of their own, so the tags under test are rare enough to weigh.
for (let index: number = 0; index < 40; index++) {
  const day: string = new Date(Date.UTC(2025, 0, 1 + index))
    .toISOString()
    .slice(0, 10);
  addPost(`${day}-filler-${index}`, [`Filler ${index}`], `Filler ${index}`);
}

const TYPHA_TLS: BlogsJsonEntry = addPost(
  "2026-01-05-automate-typha-tls",
  ["Calico", "Typha", "Kubernetes"],
  "How to Automate Typha TLS in a Calico Hard Way Installation",
);
const TYPHA_HA: BlogsJsonEntry = addPost(
  "2026-01-06-automate-typha-ha",
  ["Calico", "Typha", "Kubernetes"],
  "How to Automate Typha High Availability in a Calico Hard Way Installation",
);
const CALICO_BGP: BlogsJsonEntry = addPost(
  "2026-01-07-calico-bgp-peering",
  ["Calico", "Networking"],
  "How to Configure BGP Peering in Calico",
);
const MYSQL_GRANTS: BlogsJsonEntry = addPost(
  "2026-01-08-mysql-column-grants",
  ["MySQL"],
  "How to Grant Column-Level Privileges in MySQL",
);

const README_OF: (entry: BlogsJsonEntry) => string = (
  entry: BlogsJsonEntry,
): string => {
  return [
    `# ${entry.title}`,
    "",
    "Author: [someone](https://github.com/someone)",
    "",
    `Tags: ${entry.tags.join(", ")}`,
    "",
    `Description: ${entry.description}`,
    "",
    `The body of ${entry.post}.`,
  ].join("\n");
};

const commitOf: (committedAt: string, ...files: Array<string>) => MockCommit = (
  committedAt: string,
  ...files: Array<string>
): MockCommit => {
  return {
    authorName: "Some One",
    authorEmail: "someone@users.noreply.github.com",
    committedAt: committedAt,
    files: files,
  };
};

const readmeOf: (entry: BlogsJsonEntry) => string = (
  entry: BlogsJsonEntry,
): string => {
  return `posts/${entry.post}/README.md`;
};

// Newest first.
const GIT_HISTORY: Array<MockCommit> = [
  // The validator found nothing to fix: only its record changed.
  commitOf(
    "2026-03-01T09:00:00Z",
    `posts/${MYSQL_GRANTS.post}/validation.json`,
  ),
  // The validator fixed the post, and committed the fix with its record.
  commitOf(
    "2026-02-10T15:30:00+00:00",
    readmeOf(TYPHA_HA),
    `posts/${TYPHA_HA.post}/validation.json`,
  ),
  commitOf("2026-01-08T10:00:00Z", readmeOf(MYSQL_GRANTS)),
  // A typo fixed the day the post went out.
  commitOf("2026-01-07T18:00:00Z", readmeOf(CALICO_BGP)),
  commitOf("2026-01-07T09:00:00Z", readmeOf(CALICO_BGP)),
  commitOf("2026-01-06T10:00:00Z", readmeOf(TYPHA_HA)),
  commitOf("2026-01-05T10:00:00Z", readmeOf(TYPHA_TLS)),
];

let server: http.Server;
let port: number = 0;

beforeAll(async () => {
  fs.writeFileSync(
    path.join(BlogRootPath, "Blogs.json"),
    JSON.stringify(POSTS, null, 2),
  );
  fs.writeFileSync(path.join(BlogRootPath, "Tags.md"), "# Tags\n");
  fs.writeFileSync(
    path.join(BlogRootPath, "Authors.json"),
    JSON.stringify({ someone: { authorName: "Some One" } }),
  );

  for (const entry of [TYPHA_TLS, TYPHA_HA, CALICO_BGP, MYSQL_GRANTS]) {
    fs.mkdirSync(path.join(BlogRootPath, "posts", entry.post), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(BlogRootPath, "posts", entry.post, "README.md"),
      README_OF(entry),
    );
  }

  mockGitHistory.commits = GIT_HISTORY;
  BlogPostUtil.clearAllCaches();
  await BlogPostUtil.warmContributors();

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
  contentType: string;
  body: string;
}

const get: (urlPath: string, accept?: string) => Promise<Answer> = (
  urlPath: string,
  accept?: string,
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
            headers: accept ? { accept: accept } : {},
            agent: false,
          },
          (response: http.IncomingMessage) => {
            let body: string = "";

            response.setEncoding("utf8");
            response.on("data", (chunk: string) => {
              body += chunk;
            });
            response.on("end", () => {
              resolve({
                status: response.statusCode || 0,
                contentType: String(response.headers["content-type"] || ""),
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

const pageOf: (entry: BlogsJsonEntry) => Promise<string> = async (
  entry: BlogsJsonEntry,
): Promise<string> => {
  const answer: Answer = await get(`/blog/post/${entry.post}/view`);

  expect(answer.status).toBe(200);
  expect(answer.contentType).toContain("text/html");

  return answer.body;
};

// The posts a page's related-posts list links, in its order.
const relatedPostsOn: (html: string) => Array<string> | null = (
  html: string,
): Array<string> | null => {
  const nav: string | undefined = html.match(
    /<nav[^>]*data-related-posts[\s\S]*?<\/nav>/,
  )?.[0];

  if (!nav) {
    return null;
  }

  return [...nav.matchAll(/href="\/blog\/post\/([^/"]+)\/view"/g)].map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
};

// The BlogPosting structured data's dates, and the article:*_time tags.
const datesOn: (html: string) => {
  published: string | undefined;
  modified: string | undefined;
  publishedTime: string | undefined;
  modifiedTime: string | undefined;
} = (
  html: string,
): {
  published: string | undefined;
  modified: string | undefined;
  publishedTime: string | undefined;
  modifiedTime: string | undefined;
} => {
  return {
    published: html.match(/"datePublished":\s*"([^"]+)"/)?.[1],
    modified: html.match(/"dateModified":\s*"([^"]+)"/)?.[1],
    publishedTime: html.match(
      /<meta property="article:published_time" content="([^"]+)">/,
    )?.[1],
    modifiedTime: html.match(
      /<meta property="article:modified_time" content="([^"]+)">/,
    )?.[1],
  };
};

describe("a post's related posts", () => {
  test("its page links the posts most like it, by their pages, never itself", async () => {
    const html: string = await pageOf(TYPHA_HA);

    // Typha (two posts carry it) outweighs Calico (three) and Kubernetes.
    expect(relatedPostsOn(html)).toEqual([TYPHA_TLS.post, CALICO_BGP.post]);
    expect(html).toContain(TYPHA_TLS.title);
    expect(html).toContain('aria-labelledby="related-posts-title"');
    expect(html).toContain(">Related posts</h2>");
  });

  test("they are listed after the post, inside its article", async () => {
    const html: string = await pageOf(TYPHA_HA);

    const related: number = html.indexOf("data-related-posts");
    expect(related).toBeGreaterThan(html.indexOf("blog-body"));
    expect(related).toBeLessThan(html.indexOf("</article>"));
  });

  test("a post that shares no tag with another lists none, and has no empty list", async () => {
    const html: string = await pageOf(MYSQL_GRANTS);

    expect(relatedPostsOn(html)).toBeNull();
    expect(html).not.toContain("Related posts");
  });

  test("the Markdown copy is the post alone, without them", async () => {
    const answer: Answer = await get(`/blog/post/${TYPHA_HA.post}/markdown`);

    expect(answer.status).toBe(200);
    expect(answer.body).not.toContain(TYPHA_TLS.title);
  });
});

describe("a post's updated date", () => {
  test("a post a later commit changed shows when, and declares it", async () => {
    const html: string = await pageOf(TYPHA_HA);

    expect(html).toMatch(
      /<span>Updated <time datetime="2026-02-10">[^<]+<\/time><\/span>/,
    );
    expect(datesOn(html)).toEqual({
      published: "2026-01-06T00:00:00.000Z",
      modified: "2026-02-10T00:00:00.000Z",
      publishedTime: "2026-01-06T00:00:00.000Z",
      modifiedTime: "2026-02-10T00:00:00.000Z",
    });
  });

  test("a post only its first commit wrote was modified when it was published", async () => {
    const html: string = await pageOf(TYPHA_TLS);

    expect(html).not.toContain("<span>Updated ");
    expect(datesOn(html)).toEqual({
      published: "2026-01-05T00:00:00.000Z",
      modified: "2026-01-05T00:00:00.000Z",
      publishedTime: "2026-01-05T00:00:00.000Z",
      modifiedTime: "2026-01-05T00:00:00.000Z",
    });
  });

  test("a new validation record, or a fix the day it went out, is no update", async () => {
    for (const entry of [MYSQL_GRANTS, CALICO_BGP]) {
      const html: string = await pageOf(entry);
      const day: string = entry.post.slice(0, 10);

      expect(html).not.toContain("<span>Updated ");
      expect(datesOn(html).modified).toBe(`${day}T00:00:00.000Z`);
    }
  });

  test("the Markdown copy says when, after the day it was published", async () => {
    const updated: Answer = await get(`/blog/post/${TYPHA_HA.post}/markdown`);

    expect(updated.body).toContain(
      "\n- Published: 2026-01-06\n- Updated: 2026-02-10\n",
    );

    // The page asked for Markdown says the same.
    const negotiated: Answer = await get(
      `/blog/post/${TYPHA_HA.post}/view`,
      "text/markdown, text/html, */*",
    );
    expect(negotiated.contentType).toContain("text/markdown");
    expect(negotiated.body).toBe(updated.body);

    const notUpdated: Answer = await get(
      `/blog/post/${TYPHA_TLS.post}/markdown`,
    );
    expect(notUpdated.body).toContain("- Published: 2026-01-05\n");
    expect(notUpdated.body).not.toContain("- Updated:");
  });

  test("the sitemap gives a post's updated date as its lastmod, and its publish date otherwise", async () => {
    const sitemap: string = await generateBlogSitemapXml(1);

    const lastmodOf: (entry: BlogsJsonEntry) => string | undefined = (
      entry: BlogsJsonEntry,
    ): string | undefined => {
      return sitemap.match(
        new RegExp(
          `<loc>${HOME_URL}/blog/post/${entry.post}/view</loc>\\s*<lastmod>([^<]+)</lastmod>`,
        ),
      )?.[1];
    };

    expect(lastmodOf(TYPHA_HA)).toBe("2026-02-10T00:00:00.000Z");
    expect(lastmodOf(TYPHA_TLS)).toBe("2026-01-05T00:00:00.000Z");
    expect(lastmodOf(MYSQL_GRANTS)).toBe("2026-01-08T00:00:00.000Z");

    // The blog sitemap last changed when its newest change was made.
    expect(await generateSitemapIndexXml()).toMatch(
      /<loc>https:\/\/oneuptime\.com\/sitemap-blog-1\.xml<\/loc>\s*<lastmod>2026-02-10T00:00:00\.000Z<\/lastmod>/,
    );
  });

  test("until the git history is read a post has no updated date; once it is, it has", async () => {
    BlogPostUtil.clearAllCaches();

    // The lookup starts the walk, and does not wait for it.
    expect(BlogPostUtil.getUpdatedDate(TYPHA_HA.post, "2026-01-06")).toBeNull();

    await BlogPostUtil.warmContributors();

    expect(BlogPostUtil.getUpdatedDate(TYPHA_HA.post, "2026-01-06")).toBe(
      "2026-02-10",
    );
  });

  test("when the git history cannot be read, every post keeps its publish date", async () => {
    mockGitHistory.failure = new Error("fatal: not a git repository");
    BlogPostUtil.clearAllCaches();
    await BlogPostUtil.warmContributors();

    try {
      const html: string = await pageOf(TYPHA_HA);

      expect(html).not.toContain("<span>Updated ");
      expect(datesOn(html).modified).toBe("2026-01-06T00:00:00.000Z");
      // Its related posts do not need the history.
      expect(relatedPostsOn(html)).toEqual([TYPHA_TLS.post, CALICO_BGP.post]);
    } finally {
      mockGitHistory.failure = null;
      BlogPostUtil.clearAllCaches();
      await BlogPostUtil.warmContributors();
    }
  });
});
