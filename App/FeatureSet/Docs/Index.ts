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
import LocalFile from "CommonServer/Utils/LocalFile";
import logger from "CommonServer/Utils/Logger";
import "ejs";

const DocsFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    const app: ExpressApplication = Express.getExpressApp();

    // Redirect all requests to /docs to /docs/introduction/getting-started
    app.get("/docs", (_req: ExpressRequest, res: ExpressResponse) => {
      res.redirect("/docs/introduction/getting-started");
    });

    app.get(
      "/docs/:categorypath/:pagepath",
      async (_req: ExpressRequest, res: ExpressResponse) => {
        try {
          const fullPath: string =
            `${_req.params["categorypath"]}/${_req.params["pagepath"]}`.toLowerCase();

          // Read file from Content folder
          let contentInMarkdown: string = await LocalFile.read(
            `${ContentPath}/${fullPath}.md`,
          );

          // Remove first line from content because we don't want to show title in content
          // Title is already shown in the navigation
          contentInMarkdown = contentInMarkdown.split("\n").slice(1).join("\n");

          // Render the content
          const renderedContent: string =
            await DocsRender.render(contentInMarkdown);

          // Find the current category and link in the navigation
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

          if (!currentCategory ||!currrentNavLink) {
            // Render not found page
          }
        } catch (error) {
          logger.error(error);
        }
      },
    );
  },
};

Here is the code with improved comments:

    res.status(404);
    // Return a 404 error with a custom not found view
    return res.render(`${ViewsPath}/NotFound`, {
      nav: DocsNav,
    });

    // Render the index view with navigation, content, category, link, and github path
    res.render(`${ViewsPath}/Index`, {
      nav: DocsNav,
      content: renderedContent,
      category: currentCategory,
      link: currrentNavLink,
      githubPath: fullPath,
    });

  } catch (err) {
    // Log the error
    logger.error(err);
    // Return a 500 error with a custom server error view
    res.status(500);
    return res.render(`${ViewsPath}/ServerError`, {
      nav: DocsNav,
    });
  }
},

// Set up a route for serving static files
app.use("/docs/static", ExpressStatic(StaticPath));
},
);

--all-good--