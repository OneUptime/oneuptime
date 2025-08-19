import BlogPostUtil, { BlogPost, BlogPostHeader } from "../Utils/BlogPost";
import { BlogRootPath, ViewsPath } from "../Utils/Config";
import NotFoundUtil from "../Utils/NotFound";
import ServerErrorUtil from "../Utils/ServerError";
import Text from "Common/Types/Text";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import Route from "Common/Types/API/Route";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";

const app: ExpressApplication = Express.getExpressApp();

// create redirect for old blog post urls. This is to handle old blog post urls that are indexed by search engines.

app.get(
  "/blog/post/:file",
  async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const fileName: string = req.params["file"] as string;

      return Response.redirect(
        req,
        res,
        new Route(`/blog/post/${fileName}/view`),
      );
    } catch (e) {
      logger.error(e);
      return ServerErrorUtil.renderServerError(res);
    }
  },
);

app.get(
  "/blog/post/:file/view",
  async (req: ExpressRequest, res: ExpressResponse) => {
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
        enableGoogleTagManager: IsBillingEnabled,
      });
    } catch (e) {
      logger.error(e);
      return ServerErrorUtil.renderServerError(res);
    }
  },
);

app.get(
  "/blog/post/:postName/:fileName",
  async (req: ExpressRequest, res: ExpressResponse) => {
    // return static files for blog post images
    // the static files are stored in the /usr/src/blog/post/:file/:imageName

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
      return ServerErrorUtil.renderServerError(res);
    }
  },
);

// List all blog posts with tag

app.get(
  "/blog/tag/:tagName",
  async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const tagName: string = req.params["tagName"] as string;
      const tagSlug: string = tagName; // original slug

      // Pagination params
      const pageParam: string | undefined = req.query["page"] as
        | string
        | undefined;
      const pageSizeParam: string | undefined = req.query["pageSize"] as
        | string
        | undefined;
      let page: number = pageParam ? parseInt(pageParam, 10) : 1;
      let pageSize: number = pageSizeParam ? parseInt(pageSizeParam, 10) : 24;
      if (isNaN(page) || page < 1) {
        page = 1;
      }
      if (isNaN(pageSize) || pageSize < 1) {
        pageSize = 24;
      }
      if (pageSize > 100) {
        pageSize = 100;
      }

      const allPosts: Array<BlogPostHeader> =
        await BlogPostUtil.getBlogPostList(tagName);
      const totalPosts: number = allPosts.length;
      const totalPages: number = Math.ceil(totalPosts / pageSize) || 1;
      if (page > totalPages) {
        page = totalPages;
      }
      const start: number = (page - 1) * pageSize;
      const paginatedPosts: Array<BlogPostHeader> = allPosts.slice(
        start,
        start + pageSize,
      );
      const allTags: Array<string> = await BlogPostUtil.getTags();

      res.render(`${ViewsPath}/Blog/ListByTag`, {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
        blogPosts: paginatedPosts,
        tagName: Text.fromDashesToPascalCase(tagName),
        tagSlug: tagSlug,
        allTags: allTags,
        page: page,
        pageSize: pageSize,
        totalPages: totalPages,
        totalPosts: totalPosts,
        basePath: `/blog/tag/${tagSlug}`,
        enableGoogleTagManager: IsBillingEnabled,
      });
    } catch (e) {
      logger.error(e);
      return ServerErrorUtil.renderServerError(res);
    }
  },
);

// main blog page
app.get("/blog", async (_req: ExpressRequest, res: ExpressResponse) => {
  try {
    const req: ExpressRequest = _req; // alias for clarity
    const pageParam: string | undefined = req.query["page"] as
      | string
      | undefined;
    const pageSizeParam: string | undefined = req.query["pageSize"] as
      | string
      | undefined;
    let page: number = pageParam ? parseInt(pageParam, 10) : 1;
    let pageSize: number = pageSizeParam ? parseInt(pageSizeParam, 10) : 24;
    if (isNaN(page) || page < 1) {
      page = 1;
    }
    if (isNaN(pageSize) || pageSize < 1) {
      pageSize = 24;
    }
    if (pageSize > 100) {
      pageSize = 100;
    }

    const allPosts: Array<BlogPostHeader> =
      await BlogPostUtil.getBlogPostList();
    const totalPosts: number = allPosts.length;
    const totalPages: number = Math.ceil(totalPosts / pageSize) || 1;
    if (page > totalPages) {
      page = totalPages;
    }
    const start: number = (page - 1) * pageSize;
    const paginatedPosts: Array<BlogPostHeader> = allPosts.slice(
      start,
      start + pageSize,
    );
    const allTags: Array<string> = await BlogPostUtil.getTags();

    res.render(`${ViewsPath}/Blog/List`, {
      support: false,
      footerCards: true,
      cta: true,
      blackLogo: false,
      requestDemoCta: false,
      blogPosts: paginatedPosts,
      page: page,
      pageSize: pageSize,
      totalPages: totalPages,
      totalPosts: totalPosts,
      basePath: `/blog`,
      allTags: allTags,
      enableGoogleTagManager: IsBillingEnabled,
    });
  } catch (e) {
    logger.error(e);
    return ServerErrorUtil.renderServerError(res);
  }
});
