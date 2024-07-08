import { ContentPath, StaticPath, ViewsPath } from ./Utils/Config;
import DocsNav, { NavGroup, NavLink } from ./Utils/Nav;
import DocsRender from ./Utils/Render;
import FeatureSet from CommonServer/Types/FeatureSet;
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  ExpressStatic,
} from CommonServer/Utils/Express;
import LocalFile from CommonServer/Utils/LocalFile;
import logger from CommonServer/Utils/Logger;
import ejs;

const DocsFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    const app: ExpressApplication = Express.getExpressApp();

    // Redirect all requests to /docs to /docs/introduction/getting-started
    app.get(/docs, (_req: ExpressRequest, res: ExpressResponse) => {
      res.redirect(/docs/introduction/getting-started);
    });

    // Handle requests to /docs/:categorypath/:pagepath
    app.get(
      /docs/:categorypath/:pagepath,
      async (_req: ExpressRequest, res: ExpressResponse) => {
        try {
          const fullPath: string =
            .toLowerCase();

          // Read the content file from the Content folder
          let contentInMarkdown: string = await LocalFile.read(
            ,
          );

          // Remove the first line from the content because it's the title, which is already shown in the nav
          contentInMarkdown = contentInMarkdown.split(n).slice(1).join(n);

          // Render the content using the DocsRender
          const renderedContent: string =
            await DocsRender.render(contentInMarkdown);

          // Find the current category and nav link
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

          // If the category or nav link is not found, render a 404 page
          if (!currentCategory ||!currrentNavLink) {
            res.status(404);
            return res.render(, {
              nav: DocsNav,
            });
          }

          // Render the Index page with the rendered content, category, nav link, and github path
          res.render(, {
            nav: DocsNav,
            content: renderedContent,
            category: currentCategory,
            link: currrentNavLink,
            githubPath: fullPath,
          });
        } catch (err) {
          // Log the error and render a 500 error page
          logger.error(err);
          res.status(500);
          return res.render(, {
            nav: DocsNav,
          });
        }
      },
    );

    // Serve static files from the Static folder
    app.use(/docs/static, ExpressStatic(StaticPath));
  },
};

export default DocsFeatureSet;

