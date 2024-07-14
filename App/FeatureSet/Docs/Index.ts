import { ContentPath, StaticPath, ViewsPath } from "./Utils/Config";
import DocsNav, { NavGroup, NavLink } from "./Utils/Nav";
import DocsRender from "./Utils/Render";
import FeatureSet from "CommonServer/Types/FeatureSet";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  ExpressStatic,
} from "CommonServer/Utils/Express";
import Response from "CommonServer/Utils/Response";
import LocalFile from "CommonServer/Utils/LocalFile";
import logger from "CommonServer/Utils/Logger";
import "ejs";

const DocsFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    const app: ExpressApplication = Express.getExpressApp();

    app.get("/docs", (_req: ExpressRequest, res: ExpressResponse) => {
      res.redirect("/docs/introduction/getting-started");
    });

    app.get(
      "/docs/as-markdown/:categorypath/:pagepath",
      async (req: ExpressRequest, res: ExpressResponse) => {
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
          res.status(500);
          return res.send("Internal Server Error");
        }
      },
    );

    app.get(
      "/docs/:categorypath/:pagepath",
      async (_req: ExpressRequest, res: ExpressResponse) => {
        try {
          const fullPath: string =
            `${_req.params["categorypath"]}/${_req.params["pagepath"]}`.toLowerCase();

          // read file from Content folder.
          let contentInMarkdown: string = await LocalFile.read(
            `${ContentPath}/${fullPath}.md`,
          );

          // remove first line from content because we dont want to show title in content. Title is already in nav.

          contentInMarkdown = contentInMarkdown.split("\n").slice(1).join("\n");

          const renderedContent: string =
            await DocsRender.render(contentInMarkdown);

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

          if (!currentCategory || !currrentNavLink) {
            // render not found.

            res.status(404);
            return res.render(`${ViewsPath}/NotFound`, {
              nav: DocsNav,
            });
          }

          res.render(`${ViewsPath}/Index`, {
            nav: DocsNav,
            content: renderedContent,
            category: currentCategory,
            link: currrentNavLink,
            githubPath: fullPath,
          });
        } catch (err) {
          logger.error(err);
          res.status(500);
          return res.render(`${ViewsPath}/ServerError`, {
            nav: DocsNav,
          });
        }
      },
    );

    app.use("/docs/static", ExpressStatic(StaticPath));
  },
};

export default DocsFeatureSet;
