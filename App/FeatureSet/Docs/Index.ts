import { ContentPath, StaticPath, ViewsPath } from "./Utils/Config";
import DocsNav, { NavGroup, NavLink } from "./Utils/Nav";
import DocsRender from "./Utils/Render";
import FeatureSet from "Common/Server/Types/FeatureSet";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  ExpressStatic,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import LocalFile from "Common/Server/Utils/LocalFile";
import logger from "Common/Server/Utils/Logger";
import "ejs";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";

const DocsFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    const app: ExpressApplication = Express.getExpressApp();

    app.get("/docs", (_req: ExpressRequest, res: ExpressResponse) => {
      res.redirect("/docs/introduction/getting-started");
    });

    // Handle requests to specific documentation pages
    app.get(
      "/docs/as-markdown/:categorypath/:pagepath",
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const fullPath: string =
            `${req.params["categorypath"]}/${req.params["pagepath"]}`.toLowerCase();

          // read file from Content folder.
          const contentInMarkdown: string = await LocalFile.read(
            `${ContentPath}/${fullPath}.md`,
          );

          return Response.sendMarkdownResponse(req, res, contentInMarkdown);
        } catch (err) {
          logger.error(err);
          return next(err);
        }
      },
    );

    app.get(
      "/docs/:categorypath/:pagepath",
      async (
        _req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ) => {
        try {
          const fullPath: string =
            `${_req.params["categorypath"]}/${_req.params["pagepath"]}`.toLowerCase();

          // cehck if the file exists.
          const fileExists: boolean = await LocalFile.doesFileExist(
            `${ContentPath}/${fullPath}.md`,
          );

          if (!fileExists) {
            // return 404.
            res.status(404);
            return res.render(`${ViewsPath}/NotFound`, {
              nav: DocsNav,
              enableGoogleTagManager: IsBillingEnabled,
              link: "",
            });
          }

          // Read Markdown file from content folder
          let contentInMarkdown: string = await LocalFile.read(
            `${ContentPath}/${fullPath}.md`,
          );

          // Remove first line (title) from content as it is already present in the navigation
          contentInMarkdown = contentInMarkdown.split("\n").slice(1).join("\n");

          // Render Markdown content to HTML
          const renderedContent: string =
            await DocsRender.render(contentInMarkdown);

          // Find the current category and link from DocsNav
          const currentCategory: NavGroup | undefined = DocsNav.find(
            (category: NavGroup) => {
              return category.links.find((link: NavLink) => {
                return link.url.toLocaleLowerCase().includes(fullPath);
              });
            },
          );

          const currrentNavLink: NavLink | undefined =
            currentCategory?.links.find((link: NavLink) => {
              return link.url.toLocaleLowerCase().includes(fullPath);
            });

          // If no category or nav link matches the path, render 'not found'
          if (!currentCategory || !currrentNavLink) {
            // render not found.

            res.status(404);
            return res.render(`${ViewsPath}/NotFound`, {
              nav: DocsNav,
              enableGoogleTagManager: IsBillingEnabled,
              link: "",
            });
          }

          res.render(`${ViewsPath}/Index`, {
            nav: DocsNav,
            content: renderedContent,
            category: currentCategory,
            link: currrentNavLink,
            githubPath: fullPath,
            enableGoogleTagManager: IsBillingEnabled,
          });
        } catch (err) {
          logger.error(err);
          return next(err);
        }
      },
    );

    app.use("/docs/static", ExpressStatic(StaticPath));
  },
};

export default DocsFeatureSet;
