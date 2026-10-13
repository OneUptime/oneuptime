import BlogPostUtil, { BlogPost } from "../Utils/BlogPost";
import BlogTag from "../Utils/BlogTag";
import { BlogRootPath } from "../Utils/Config";
import ejs from "ejs";
import { JSDOM } from "jsdom";
import path from "path";

/*
 * A post's title, description and tags, read off the head of its README.md:
 *
 *   # <title>
 *   Author: [<username>](<GitHub URL>)
 *   Tags: <tag>, <tag>
 *   Description: <text>
 *
 * The title kept the space after its "#" and the description the space after
 * its "Description:", so the post's <title>, meta description, Open Graph and
 * Twitter tags and structured data all began with a space (and a README saved
 * with CRLF line ends added a "\r" at the end of each). They are trimmed where
 * they are read, and these hold every place they go to that.
 *
 * The post is read by the real BlogPostUtil from files stood in for here, and
 * rendered by the real template with the locals BlogAPI hands it.
 */

const mockFiles: Map<string, string> = new Map();

jest.mock("Common/Server/Utils/LocalFile", () => {
  return {
    __esModule: true,
    default: {
      read: async (filePath: string): Promise<string> => {
        const content: string | undefined = mockFiles.get(filePath);

        if (content === undefined) {
          throw new Error(`No such file: ${filePath}`);
        }

        return content;
      },
      doesFileExist: async (filePath: string): Promise<boolean> => {
        return mockFiles.has(filePath);
      },
    },
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

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");

// Rendering the whole post page, head to footer, takes a while on a busy machine.
jest.setTimeout(60000);

const README_LINES: Array<string> = [
  "# How to Install Google Chrome on Ubuntu",
  "",
  "Author: [someone](https://github.com/someone)",
  "",
  "Tags: Ubuntu, Linux",
  "",
  "Description: Installing Chrome from the Debian package Google publishes.",
  "",
  "Download the package and install it.",
];

describe("reading a README's head", () => {
  test("the title is the first '#' line, without its '#' or the space after it", () => {
    expect(BlogPostUtil.getTitleFromFileContent(README_LINES.join("\n"))).toBe(
      "How to Install Google Chrome on Ubuntu",
    );
  });

  test.each([
    ["#    Spaced Out   ", "Spaced Out"],
    ["#Tight", "Tight"],
    ["## A Second-Level Title", "A Second-Level Title"],
    ["# A Title\r", "A Title"],
    ["#\tTabbed\t", "Tabbed"],
    ["# C# in Ten Minutes", "C# in Ten Minutes"],
  ])("%j reads as %j", (titleLine: string, title: string) => {
    expect(
      BlogPostUtil.getTitleFromFileContent(`${titleLine}\n\nThe body.`),
    ).toBe(title);
  });

  test("a README with no title, or an empty one, is titled for the blog", () => {
    expect(BlogPostUtil.getTitleFromFileContent("No heading here.")).toBe(
      "OneUptime Blog",
    );
    expect(BlogPostUtil.getTitleFromFileContent("#   \nThe body.")).toBe(
      "OneUptime Blog",
    );
  });

  test("the description is the 'Description:' line, without its label or the space around it", () => {
    expect(
      BlogPostUtil.getDescriptionFromFileContent(README_LINES.join("\n")),
    ).toBe("Installing Chrome from the Debian package Google publishes.");
    expect(
      BlogPostUtil.getDescriptionFromFileContent(
        "Description:    Spaced out.   \r\n",
      ),
    ).toBe("Spaced out.");
    expect(BlogPostUtil.getDescriptionFromFileContent("# Title only")).toBe("");
  });

  test("the tags are the 'Tags:' line's, trimmed, with no empty tag", () => {
    expect(
      BlogPostUtil.getTagsFromFileContent("Tags:  CI/CD ,Pub/Sub,  Kafka  \r"),
    ).toEqual(["CI/CD", "Pub/Sub", "Kafka"]);
    expect(BlogPostUtil.getTagsFromFileContent("Tags: Kafka,")).toEqual([
      "Kafka",
    ]);
    expect(BlogPostUtil.getTagsFromFileContent("Tags: , ,")).toEqual([]);
    expect(BlogPostUtil.getTagsFromFileContent("# No tags line")).toEqual([]);
  });
});

describe("a post's title and description, on its page", () => {
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
    heading: string;
  }

  const POST_FILE: string = "2026-10-13-install-chrome";

  // Reads the post the way BlogAPI does, and renders it with BlogAPI's locals.
  const renderPost: (readme: string) => Promise<{
    post: BlogPost;
    html: string;
  }> = async (readme: string): Promise<{ post: BlogPost; html: string }> => {
    mockFiles.clear();
    mockFiles.set(`${BlogRootPath}/Blogs.json`, "[]");
    mockFiles.set(`${BlogRootPath}/Authors.json`, "{}");
    mockFiles.set(`${BlogRootPath}/posts/${POST_FILE}/README.md`, readme);
    BlogPostUtil.clearAllCaches();

    const post: BlogPost | null = await BlogPostUtil.getBlogPost(POST_FILE);

    expect(post).not.toBeNull();

    const html: string = (await ejs.renderFile(
      path.join(VIEWS_ROOT, "Blog", "Post.ejs"),
      {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
        blogPost: post,
        blogTagPath: BlogTag.getPagePathOfTag,
        enableGoogleTagManager: false,
        seo: { fullCanonicalUrl: (post as BlogPost).blogUrl },
      },
      { views: [VIEWS_ROOT] },
    )) as string;

    return { post: post as BlogPost, html: html };
  };

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
      // The element's own text: document.title would trim it.
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
      heading: (document.querySelector("h1")?.textContent || "").trim(),
    };
  };

  const expectedHead: (title: string, description: string) => PostHead = (
    title: string,
    description: string,
  ): PostHead => {
    return {
      title: title,
      description: description,
      ogTitle: title,
      ogDescription: description,
      twitterTitle: title,
      twitterDescription: description,
      headline: title,
      structuredDescription: description,
      breadcrumb: title,
      heading: title,
    };
  };

  test("reach the <title>, the meta description, Open Graph, Twitter and the structured data without a leading space", async () => {
    const { post, html } = await renderPost(README_LINES.join("\n"));

    expect(post.title).toBe("How to Install Google Chrome on Ubuntu");
    expect(post.description).toBe(
      "Installing Chrome from the Debian package Google publishes.",
    );
    expect(headOf(html)).toEqual(
      expectedHead(
        "How to Install Google Chrome on Ubuntu",
        "Installing Chrome from the Debian package Google publishes.",
      ),
    );
  });

  test("from a README saved with CRLF line ends and extra space, read the same", async () => {
    const { html } = await renderPost(
      [
        "#    A Title With Space Around It   ",
        "",
        "Author: [someone](https://github.com/someone)",
        "",
        "Tags: Kafka,",
        "",
        "Description:    A description with space around it.   ",
        "",
        "The body.",
      ].join("\r\n"),
    );

    expect(headOf(html)).toEqual(
      expectedHead(
        "A Title With Space Around It",
        "A description with space around it.",
      ),
    );
  });

  test("the <title> element holds the title alone, on one line", async () => {
    const { html } = await renderPost(README_LINES.join("\n"));

    expect(html).toContain(
      "<title>How to Install Google Chrome on Ubuntu</title>",
    );
  });
});
