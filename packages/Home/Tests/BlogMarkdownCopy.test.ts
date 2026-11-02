import BlogPostUtil, { BlogPost } from "../Utils/BlogPost";
import "../API/BlogAPI";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import http from "http";
import { AddressInfo } from "net";
import path from "path";

/*
 * A blog post as Markdown, for AI agents: its Markdown copy at
 * /blog/post/<post>/markdown, and its page when a request asks for Markdown
 * before HTML.
 *
 * Search engines took the Markdown copy for a page of its own, and AI search
 * answers cited it - bare text - in place of the post: both answers now name
 * the post's page as canonical in a Link header. And an agent that asks for
 * Markdown at the post's address, as coding agents do, got about 330 KB of
 * HTML of which the post was 2%; it now gets the post as Markdown there.
 *
 * BlogAPI's routes run on a real Express app and are asked over HTTP, since
 * which answer a request gets is Express's content negotiation
 * (req.accepts). The blog's content is stubbed out, and the view engine is a
 * stand-in that records which template a page renders.
 */

jest.mock("Common/Server/Utils/Express", () => {
  const actual: { createExpressApp: () => unknown } = jest.requireActual(
    "Common/Server/Utils/Express",
  );
  const app: unknown = actual.createExpressApp();

  return {
    __esModule: true,
    default: {
      getExpressApp: (): unknown => {
        return app;
      },
    },
  };
});

// Views from this checkout rather than the image's path, so Express finds them.
jest.mock("../Utils/Config", () => {
  const nodePath: typeof path = jest.requireActual("path");
  const homeFolder: string = nodePath.join(__dirname, "..");

  return {
    ...jest.requireActual("../Utils/Config"),
    __esModule: true,
    ViewsPath: nodePath.join(homeFolder, "Views"),
    BlogRootPath: nodePath.join(homeFolder, "no-blog-checkout"),
  };
});

jest.mock("../Utils/BlogPost", () => {
  return {
    __esModule: true,
    default: {
      getBlogPost: jest.fn(),
      getBlogPostList: jest.fn().mockResolvedValue([]),
      getTags: jest.fn().mockResolvedValue([]),
      getTagBySlug: jest.fn().mockResolvedValue(null),
      getValidationSummaryHtml: jest.fn().mockResolvedValue(null),
      getHomeUrl: jest.fn().mockResolvedValue({
        toString: (): string => {
          return "https://oneuptime.com/";
        },
      }),
    },
  };
});

// BlogAPI serves files and HTML through it; none of that is asked for here.
jest.mock("Common/Server/Utils/Response", () => {
  return { __esModule: true, default: {} };
});

const VIEWS_FOLDER: string = path.join(__dirname, "..", "Views");
const POST_FILE: string = "2026-09-29-train-shadow-incident-commander";
const POST_URL: string = `https://oneuptime.com/blog/post/${POST_FILE}/view`;

const blogPost: BlogPost = {
  title: "How to Train a Shadow Incident Commander",
  description: "Develop incident commanders through drills and handoffs.",
  formattedPostDate: "September 29, 2026",
  fileName: POST_FILE,
  tags: ["Incident Response", "SRE"],
  postDate: "2026-09-29",
  blogUrl: POST_URL,
  contributors: [],
  htmlBody: "<h2>Define the role</h2>\n<p>Write down what command means.</p>",
  markdownBody: "## Define the role\n\nWrite down what command means.",
  socialMediaImageUrl: `https://oneuptime.com/blog/post/${POST_FILE}/social-media.png`,
  author: {
    username: "someone",
    githubUrl: "https://github.com/someone",
    profileImageUrl: "https://avatars.githubusercontent.com/someone",
    name: "Some One",
  },
  validationStatus: null,
  validationDate: null,
};

// The post as Markdown, exactly as both addresses send it.
const POST_MARKDOWN: string = [
  "# How to Train a Shadow Incident Commander",
  "",
  "Develop incident commanders through drills and handoffs.",
  "",
  "- Published: 2026-09-29",
  "- Author: [Some One](https://github.com/someone)",
  "- Tags: Incident Response, SRE",
  `- Canonical: ${POST_URL}`,
  "",
  "---",
  "",
  "## Define the role",
  "",
  "Write down what command means.",
].join("\n");

const CANONICAL_LINK: string = `<${POST_URL}>; rel="canonical"`;

// A post whose address is not ASCII, as a tag in another script would make it.
const UNICODE_FILE: string = "2026-09-29-日本語";

// Accept headers that ask for Markdown before HTML, as coding agents send.
const MARKDOWN_FIRST: Array<string> = [
  "text/markdown, text/html, */*",
  "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1",
];

// Requests that get the page as HTML, as they always did.
const HTML_FIRST: Array<[string, string | undefined]> = [
  [
    "a browser",
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  ],
  ["a request that accepts any type", "*/*"],
  ["a request with no Accept header", undefined],
  ["a request that lists HTML before Markdown", "text/html, text/markdown"],
  ["a request that refuses Markdown", "text/markdown;q=0, text/html"],
  ["a request for neither", "application/json"],
];

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const renders: Array<string> = [];
let server: http.Server;
let port: number = 0;

const request: (url: string, accept?: string | undefined) => Promise<Answer> = (
  url: string,
  accept?: string | undefined,
): Promise<Answer> => {
  return new Promise<Answer>(
    (resolve: (answer: Answer) => void, reject: (error: Error) => void) => {
      const outgoing: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          method: "GET",
          path: url,
          headers: accept === undefined ? {} : { accept: accept },
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
              headers: response.headers,
              body: body,
            });
          });
        },
      );

      outgoing.on("error", reject);
      outgoing.end();
    },
  );
};

// The header names an answer varies on, lowercased.
const varyOf: (answer: Answer) => Array<string> = (
  answer: Answer,
): Array<string> => {
  return String(answer.headers["vary"] || "")
    .toLowerCase()
    .split(/\s*,\s*/)
    .filter(Boolean);
};

// The templates rendered while `ask` ran.
const templatesRenderedBy: (
  ask: () => Promise<Answer>,
) => Promise<{ answer: Answer; templates: Array<string> }> = async (
  ask: () => Promise<Answer>,
): Promise<{ answer: Answer; templates: Array<string> }> => {
  const before: number = renders.length;
  const answer: Answer = await ask();

  return { answer: answer, templates: renders.slice(before) };
};

beforeAll(async () => {
  const app: ExpressApplication = Express.getExpressApp();

  app.set("view engine", "ejs");
  app.engine(
    "ejs",
    (
      filePath: string,
      _options: unknown,
      callback: (error: Error | null, html?: string) => void,
    ): void => {
      renders.push(path.relative(VIEWS_FOLDER, filePath));
      callback(null, `<html>${path.basename(filePath)}</html>`);
    },
  );

  server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();

  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  jest
    .mocked(BlogPostUtil.getBlogPost)
    .mockImplementation(async (fileName: string): Promise<BlogPost | null> => {
      if (fileName === POST_FILE) {
        return blogPost;
      }

      if (fileName === UNICODE_FILE) {
        return {
          ...blogPost,
          fileName: UNICODE_FILE,
          blogUrl: `https://oneuptime.com/blog/post/${UNICODE_FILE}/view`,
        };
      }

      return null;
    });
});

describe("a post's Markdown copy", () => {
  test("is the post as Markdown, naming the post's page as canonical", async () => {
    const answer: Answer = await request(`/blog/post/${POST_FILE}/markdown`);

    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe("text/markdown; charset=utf-8");
    expect(answer.headers["link"]).toBe(CANONICAL_LINK);
    expect(answer.headers["cache-control"]).toBe("public, max-age=600");
    expect(answer.headers["access-control-allow-origin"]).toBe("*");
    expect(answer.body).toBe(POST_MARKDOWN);
  });

  test("percent-encodes an address that is not ASCII in its Link header", async () => {
    const answer: Answer = await request(
      `/blog/post/${encodeURIComponent(UNICODE_FILE)}/markdown`,
    );

    expect(answer.status).toBe(200);
    expect(answer.headers["link"]).toBe(
      '<https://oneuptime.com/blog/post/2026-09-29-%E6%97%A5%E6%9C%AC%E8%AA%9E/view>; rel="canonical"',
    );
  });

  test("of a post that does not exist is a 404, with no canonical", async () => {
    const answer: Answer = await request(
      "/blog/post/2026-01-01-no-such-post/markdown",
    );

    expect(answer.status).toBe(404);
    expect(answer.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(answer.headers["link"]).toBeUndefined();
    expect(answer.body).toBe("Blog post not found.");
  });
});

describe("a post's page, asked for Markdown first", () => {
  test.each(MARKDOWN_FIRST)(
    "answers %p with the post as Markdown, the same as its copy",
    async (accept: string) => {
      const { answer, templates } = await templatesRenderedBy(() => {
        return request(`/blog/post/${POST_FILE}/view`, accept);
      });

      expect(answer.status).toBe(200);
      expect(answer.headers["content-type"]).toBe(
        "text/markdown; charset=utf-8",
      );
      expect(answer.body).toBe(POST_MARKDOWN);
      expect(answer.headers["link"]).toBe(CANONICAL_LINK);
      expect(varyOf(answer)).toContain("accept");
      // Not for a shared cache, which could hand it to a browser.
      expect(answer.headers["cache-control"]).toBe("private, max-age=600");
      expect(templates).toEqual([]);
    },
  );

  test("of a post that does not exist is the not-found page", async () => {
    const { answer, templates } = await templatesRenderedBy(() => {
      return request(
        "/blog/post/2026-01-01-no-such-post/view",
        MARKDOWN_FIRST[0],
      );
    });

    expect(answer.status).toBe(404);
    expect(templates).toEqual(["not-found.ejs"]);
  });
});

describe("a post's page, asked for HTML", () => {
  test.each(HTML_FIRST)(
    "%s gets the page, as before",
    async (_who: string, accept: string | undefined) => {
      const { answer, templates } = await templatesRenderedBy(() => {
        return request(`/blog/post/${POST_FILE}/view`, accept);
      });

      expect(answer.status).toBe(200);
      expect(answer.headers["content-type"]).toContain("text/html");
      expect(templates).toEqual([path.join("Blog", "Post.ejs")]);
      // The same address answers Markdown to a request that asks for it first.
      expect(varyOf(answer)).toContain("accept");
      // The page names its canonical URL in its head (BlogCanonical.test.ts).
      expect(answer.headers["link"]).toBeUndefined();
    },
  );
});
