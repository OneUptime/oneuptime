import BlogPostUtil, {
  BlogPost,
  BlogPostHeader,
  BlogTagSummary,
} from "../Utils/BlogPost";
import BlogPagination, { BlogPageRequest } from "../Utils/BlogPagination";
import BlogTag from "../Utils/BlogTag";
import { BlogRootPath, ViewsPath } from "../Utils/Config";
import NotFoundUtil from "../Utils/NotFound";
import { generateTagRssFeed } from "../Utils/RssFeed";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import Route from "Common/Types/API/Route";
import { GoogleTagManagerEnabled } from "Common/Server/EnvironmentConfig";

const app: ExpressApplication = Express.getExpressApp();

/*
 * Routes.ts imports this module before it registers the middleware that gives
 * every other page its `seo` (and with it the canonical URL), so these routes
 * never get one from there. Each page the blog renders passes its own.
 */

// create redirect for old blog post urls. This is to handle old blog post urls that are indexed by search engines.

app.get(
  "/blog/post/:file",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const fileName: string = req.params["file"] as string;

      return Response.redirect(
        req,
        res,
        new Route(`/blog/post/${fileName}/view`),
      );
    } catch (e) {
      logger.error(e);
      return next(e);
    }
  },
);

app.get(
  "/blog/post/:file/view",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const fileName: string = req.params["file"] as string;

      const blogPost: BlogPost | null =
        await BlogPostUtil.getBlogPost(fileName);

      if (!blogPost) {
        return NotFoundUtil.renderNotFound(res);
      }

      res.render(`${ViewsPath}/Blog/Post`, {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
        blogPost: blogPost,
        blogTagPath: BlogTag.getPagePathOfTag,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        seo: {
          fullCanonicalUrl: blogPost.blogUrl,
        },
      });
    } catch (e) {
      logger.error(e);
      return next(e);
    }
  },
);

/*
 * Lazily serve the rendered validation-summary.md for a post (loaded on demand
 * when the reader clicks the "Validated" badge). Registered before the static
 * file route below so "validation-summary" is not treated as a file name.
 */
app.get(
  "/blog/post/:file/validation-summary",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const fileName: string = req.params["file"] as string;

      const summaryHtml: string | null =
        await BlogPostUtil.getValidationSummaryHtml(fileName);

      if (!summaryHtml) {
        return NotFoundUtil.renderNotFound(res);
      }

      return Response.sendHtmlResponse(req, res, summaryHtml);
    } catch (e) {
      logger.error(e);
      return next(e);
    }
  },
);

/*
 * Raw markdown version of a post for LLMs / AI agents (linked from llms.txt
 * and the post page). Registered before the static file route below so
 * "markdown" is not treated as an asset file name.
 */
app.get(
  "/blog/post/:file/markdown",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const fileName: string = req.params["file"] as string;

      const blogPost: BlogPost | null =
        await BlogPostUtil.getBlogPost(fileName);

      if (!blogPost) {
        res.status(404);
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        return res.send("Blog post not found.");
      }

      const lines: Array<string> = [
        `# ${blogPost.title}`,
        "",
        blogPost.description.trim(),
        "",
        `- Published: ${blogPost.postDate}`,
      ];

      if (blogPost.author) {
        lines.push(
          `- Author: [${blogPost.author.name}](${blogPost.author.githubUrl})`,
        );
      }

      if (blogPost.tags.length > 0) {
        lines.push(`- Tags: ${blogPost.tags.join(", ")}`);
      }

      lines.push(`- Canonical: ${blogPost.blogUrl}`, "", "---", "");
      lines.push(blogPost.markdownBody);

      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=600");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.send(lines.join("\n"));
    } catch (e) {
      logger.error(e);
      return next(e);
    }
  },
);

app.get(
  "/blog/post/:postName/:fileName",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    /*
     * return static files for blog post images
     * the static files are stored in the /usr/src/blog/post/:file/:imageName
     */

    try {
      const fileName: string = req.params["fileName"] as string;
      const postName: string = req.params["postName"] as string;

      return Response.sendFileByPath(
        req,
        res,
        `${BlogRootPath}/posts/${postName}/${fileName}`,
      );
    } catch (e) {
      logger.error(e);
      return next(e);
    }
  },
);

/*
 * The blog's post lists - /blog and each tag's page - and the tags' feeds.
 *
 * How a list is paged (one page size, a canonical URL of its own for every
 * page, a 404 past the last) is Utils/BlogPagination.ts. How a tag is
 * addressed (its slug, and the paths of its page and feed) is
 * Utils/BlogTag.ts; every tag link the templates draw goes through it too,
 * handed to them as `blogTagPath`.
 */

const BLOG_PATH: string = "/blog";
const FEED_SUFFIX: string = "/rss.xml";

const getHomeUrl: () => Promise<string> = async (): Promise<string> => {
  return (await BlogPostUtil.getHomeUrl()).toString().replace(/\/$/, "");
};

/*
 * The tag a request names, and whether it named the tag by its address. A
 * tag is addressed by its slug; anything else that reads as one of the
 * blog's tags - "Kubernetes", "CI/CD", the old c++ and ci/cd - names that tag
 * too, and is sent to its address. Null when no post carries the tag.
 */
const findTag: (
  text: string,
) => Promise<{ tag: BlogTagSummary; isItsAddress: boolean } | null> = async (
  text: string,
): Promise<{ tag: BlogTagSummary; isItsAddress: boolean } | null> => {
  const tag: BlogTagSummary | null = await BlogPostUtil.getTagBySlug(text);

  if (tag) {
    return { tag: tag, isItsAddress: true };
  }

  const slug: string = BlogTag.getSlug(text);

  if (!slug || slug === text) {
    return null;
  }

  const tagOfSlug: BlogTagSummary | null =
    await BlogPostUtil.getTagBySlug(slug);

  return tagOfSlug ? { tag: tagOfSlug, isItsAddress: false } : null;
};

/*
 * Answers a request for a page of the list at basePath that does not exist
 * (404) or is not asked for by its own URL (301), and otherwise returns the
 * page to render. `mustRedirect` sends the request to the page's URL even
 * when it asked for the page as that URL does: it reached the list by an
 * address that is not the list's own.
 */
const getPageToRender: (
  req: ExpressRequest,
  res: ExpressResponse,
  list: {
    basePath: string;
    totalPosts: number;
    hasPageWhenEmpty: boolean;
    mustRedirect: boolean;
  },
) => { page: number; totalPages: number } | null = (
  req: ExpressRequest,
  res: ExpressResponse,
  list: {
    basePath: string;
    totalPosts: number;
    hasPageWhenEmpty: boolean;
    mustRedirect: boolean;
  },
): { page: number; totalPages: number } | null => {
  const request: BlogPageRequest = BlogPagination.resolve({
    query: req.query,
    totalPosts: list.totalPosts,
    hasPageWhenEmpty: list.hasPageWhenEmpty,
  });

  if (request.kind === "not-found") {
    NotFoundUtil.renderNotFound(res);
    return null;
  }

  if (request.kind === "redirect" || list.mustRedirect) {
    res.redirect(
      301,
      BlogPagination.getRedirectPath(
        list.basePath,
        request.page,
        req.originalUrl,
      ),
    );
    return null;
  }

  return { page: request.page, totalPages: request.totalPages };
};

// A tag's page, for a request that names the tag as `text`.
const sendTagPage: (
  req: ExpressRequest,
  res: ExpressResponse,
  text: string,
) => Promise<void> = async (
  req: ExpressRequest,
  res: ExpressResponse,
  text: string,
): Promise<void> => {
  const found: { tag: BlogTagSummary; isItsAddress: boolean } | null =
    await findTag(text);

  if (!found) {
    return NotFoundUtil.renderNotFound(res);
  }

  const basePath: string = BlogTag.getPagePath(found.tag.slug);
  const allPosts: Array<BlogPostHeader> = await BlogPostUtil.getBlogPostList(
    found.tag.slug,
    { includeContributors: true },
  );

  const shown: { page: number; totalPages: number } | null = getPageToRender(
    req,
    res,
    {
      basePath: basePath,
      totalPosts: allPosts.length,
      hasPageWhenEmpty: false,
      mustRedirect: !found.isItsAddress,
    },
  );

  if (!shown) {
    return;
  }

  const homeUrl: string = await getHomeUrl();
  const allTags: Array<string> = await BlogPostUtil.getTags();

  res.render(`${ViewsPath}/Blog/ListByTag`, {
    support: false,
    footerCards: true,
    cta: true,
    blackLogo: false,
    requestDemoCta: false,
    blogPosts: BlogPagination.getPagePosts(allPosts, shown.page),
    tagName: found.tag.name,
    tagFeedPath: BlogTag.getFeedPath(found.tag.slug),
    allTags: allTags,
    page: shown.page,
    pageSize: BlogPagination.PAGE_SIZE,
    totalPages: shown.totalPages,
    totalPosts: allPosts.length,
    pagePath: (page: number): string => {
      return BlogPagination.getPagePath(basePath, page);
    },
    blogTagPath: BlogTag.getPagePathOfTag,
    enableGoogleTagManager: GoogleTagManagerEnabled,
    // Each page of a tag is its own canonical; its first page is the tag's path.
    seo: {
      fullCanonicalUrl: `${homeUrl}${BlogPagination.getPagePath(basePath, shown.page)}`,
    },
  });
};

/*
 * A tag's RSS feed, for a request that names the tag as `text`. Feeds of
 * tags are for feed readers, not search results: Search Console had them
 * among the 16,116 blog URLs "Crawled - currently not indexed", so they say
 * so with X-Robots-Tag: noindex. A robots.txt rule would stop the crawl
 * before Google could read that, and keep any it has indexed. The main feed,
 * /blog/rss.xml, is left as it is.
 */
const sendTagFeed: (
  req: ExpressRequest,
  res: ExpressResponse,
  text: string,
) => Promise<void> = async (
  req: ExpressRequest,
  res: ExpressResponse,
  text: string,
): Promise<void> => {
  const found: { tag: BlogTagSummary; isItsAddress: boolean } | null =
    await findTag(text);

  if (!found) {
    res.status(404);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send("Blog tag not found.");
    return;
  }

  if (!found.isItsAddress) {
    const feedPath: string = BlogTag.getFeedPath(found.tag.slug);
    const queryStart: number = req.originalUrl.indexOf("?");

    res.redirect(
      301,
      queryStart === -1
        ? feedPath
        : `${feedPath}${req.originalUrl.slice(queryStart)}`,
    );
    return;
  }

  const xml: string = await generateTagRssFeed(found.tag);

  res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=600"); // 10 minutes
  res.setHeader("X-Robots-Tag", "noindex");
  res.send(xml);
};

// RSS feed of a tag
app.get(
  "/blog/tag/:tagSlug/rss.xml",
  async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      return await sendTagFeed(req, res, req.params["tagSlug"] as string);
    } catch (e) {
      logger.error(e);
      return res.status(500).send("Error generating RSS feed");
    }
  },
);

// List all blog posts with tag
app.get(
  "/blog/tag/:tagSlug",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      return await sendTagPage(req, res, req.params["tagSlug"] as string);
    } catch (e) {
      logger.error(e);
      return next(e);
    }
  },
);

/*
 * Addresses of more than one path segment under /blog/tag/: the old links of
 * a tag with a slash in it. Its page built its pagination and feed links from
 * the decoded tag, so "CI/CD" linked to /blog/tag/ci/cd?page=2&pageSize=25
 * and /blog/tag/ci/cd/rss.xml, which the one-segment routes above never
 * matched. Each is now the tag it names, sent to the tag's address - or a
 * 404 when it names none. Registered after the routes above, so a tag's own
 * feed is never read as one of these.
 */
app.get(
  "/blog/tag/*",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const path: string = req.params["0"] || "";

      if (path.endsWith(FEED_SUFFIX)) {
        return await sendTagFeed(
          req,
          res,
          path.slice(0, path.length - FEED_SUFFIX.length),
        );
      }

      return await sendTagPage(req, res, path);
    } catch (e) {
      logger.error(e);
      return next(e);
    }
  },
);

// main blog page
app.get(
  BLOG_PATH,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const allPosts: Array<BlogPostHeader> =
        await BlogPostUtil.getBlogPostList(undefined, {
          includeContributors: true,
        });

      const shown: { page: number; totalPages: number } | null =
        getPageToRender(req, res, {
          basePath: BLOG_PATH,
          totalPosts: allPosts.length,
          hasPageWhenEmpty: true,
          mustRedirect: false,
        });

      if (!shown) {
        return;
      }

      const homeUrl: string = await getHomeUrl();
      const allTags: Array<string> = await BlogPostUtil.getTags();

      res.render(`${ViewsPath}/Blog/List`, {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
        blogPosts: BlogPagination.getPagePosts(allPosts, shown.page),
        page: shown.page,
        pageSize: BlogPagination.PAGE_SIZE,
        totalPages: shown.totalPages,
        totalPosts: allPosts.length,
        pagePath: (page: number): string => {
          return BlogPagination.getPagePath(BLOG_PATH, page);
        },
        allTags: allTags,
        blogTagPath: BlogTag.getPagePathOfTag,
        enableGoogleTagManager: GoogleTagManagerEnabled,
        // Each page is its own canonical; the first page is /blog.
        seo: {
          fullCanonicalUrl: `${homeUrl}${BlogPagination.getPagePath(BLOG_PATH, shown.page)}`,
        },
      });
    } catch (e) {
      logger.error(e);
      return next(e);
    }
  },
);
