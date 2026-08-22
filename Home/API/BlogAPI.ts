import "./AcquisitionAttributionAPI";
import BlogPostUtil, { BlogPost, BlogPostHeader } from "../Utils/BlogPost";
import { BlogRootPath, ViewsPath } from "../Utils/Config";
import NotFoundUtil from "../Utils/NotFound";
import Text from "Common/Types/Text";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import Route from "Common/Types/API/Route";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";

const app: ExpressApplication = Express.getExpressApp();

app.get(
  "/blog/post/:file",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const fileName: string = req.params["file"] as string;
      return Response.redirect(req, res, new Route(`/blog/post/${fileName}/view`));
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
      const blogPost: BlogPost | null = await BlogPostUtil.getBlogPost(fileName);
      if (!blogPost) return NotFoundUtil.renderNotFound(res);
      res.render(`${ViewsPath}/Blog/Post`, {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
        blogPost,
        enableGoogleTagManager: IsBillingEnabled,
      });
    } catch (e) {
      logger.error(e);
      return next(e);
    }
  },
);

app.get(
  "/blog/post/:file/validation-summary",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const summaryHtml: string | null = await BlogPostUtil.getValidationSummaryHtml(req.params["file"] as string);
      if (!summaryHtml) return NotFoundUtil.renderNotFound(res);
      return Response.sendHtmlResponse(req, res, summaryHtml);
    } catch (e) {
      logger.error(e);
      return next(e);
    }
  },
);

app.get(
  "/blog/post/:file/markdown",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const blogPost: BlogPost | null = await BlogPostUtil.getBlogPost(req.params["file"] as string);
      if (!blogPost) {
        res.status(404);
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        return res.send("Blog post not found.");
      }
      const lines: Array<string> = [
        `# ${blogPost.title}`, "", blogPost.description.trim(), "", `- Published: ${blogPost.postDate}`,
      ];
      if (blogPost.author) lines.push(`- Author: [${blogPost.author.name}](${blogPost.author.githubUrl})`);
      if (blogPost.tags.length > 0) lines.push(`- Tags: ${blogPost.tags.join(", ")}`);
      lines.push(`- Canonical: ${blogPost.blogUrl}`, "", "---", "", blogPost.markdownBody);
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
    try {
      return Response.sendFileByPath(req, res, `${BlogRootPath}/posts/${req.params["postName"] as string}/${req.params["fileName"] as string}`);
    } catch (e) {
      logger.error(e);
      return next(e);
    }
  },
);

app.get(
  "/blog/tag/:tagName",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const tagName: string = req.params["tagName"] as string;
      let page: number = req.query["page"] ? parseInt(req.query["page"] as string, 10) : 1;
      let pageSize: number = req.query["pageSize"] ? parseInt(req.query["pageSize"] as string, 10) : 25;
      if (isNaN(page) || page < 1) page = 1;
      if (isNaN(pageSize) || pageSize < 1) pageSize = 25;
      if (pageSize > 100) pageSize = 100;
      const allPosts: Array<BlogPostHeader> = await BlogPostUtil.getBlogPostList(tagName, { includeContributors: true });
      const totalPosts: number = allPosts.length;
      const totalPages: number = Math.ceil(totalPosts / pageSize) || 1;
      if (page > totalPages) page = totalPages;
      const blogPosts: Array<BlogPostHeader> = allPosts.slice((page - 1) * pageSize, page * pageSize);
      res.render(`${ViewsPath}/Blog/ListByTag`, {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
        blogPosts,
        tagName: Text.fromDashesToPascalCase(tagName),
        tagSlug: tagName,
        allTags: await BlogPostUtil.getTags(),
        page,
        pageSize,
        totalPages,
        totalPosts,
        basePath: `/blog/tag/${tagName}`,
        enableGoogleTagManager: IsBillingEnabled,
      });
    } catch (e) {
      logger.error(e);
      return next(e);
    }
  },
);

app.get(
  "/blog",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      let page: number = req.query["page"] ? parseInt(req.query["page"] as string, 10) : 1;
      let pageSize: number = req.query["pageSize"] ? parseInt(req.query["pageSize"] as string, 10) : 25;
      if (isNaN(page) || page < 1) page = 1;
      if (isNaN(pageSize) || pageSize < 1) pageSize = 25;
      if (pageSize > 100) pageSize = 100;
      const allPosts: Array<BlogPostHeader> = await BlogPostUtil.getBlogPostList(undefined, { includeContributors: true });
      const totalPosts: number = allPosts.length;
      const totalPages: number = Math.ceil(totalPosts / pageSize) || 1;
      if (page > totalPages) page = totalPages;
      res.render(`${ViewsPath}/Blog/List`, {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
        blogPosts: allPosts.slice((page - 1) * pageSize, page * pageSize),
        page,
        pageSize,
        totalPages,
        totalPosts,
        basePath: "/blog",
        allTags: await BlogPostUtil.getTags(),
        enableGoogleTagManager: IsBillingEnabled,
        seo: { fullCanonicalUrl: "https://oneuptime.com/blog" },
      });
    } catch (e) {
      logger.error(e);
      return next(e);
    }
  },
);
