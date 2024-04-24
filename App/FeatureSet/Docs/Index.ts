import 'ejs';
import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
    ExpressApplication,
} from 'CommonServer/Utils/Express';
import { ContentPath, StaticPath, ViewsPath } from './Utils/Config';
import DocsNav, { NavGroup, NavLink } from './Utils/Nav';
import LocalFile from 'CommonServer/Utils/LocalFile';
import DocsRender from './Utils/Render';
import logger from 'CommonServer/Utils/Logger';

const init: VoidFunction = (): void => {
    const app: ExpressApplication = Express.getExpressApp();

    app.get('/docs', (_req: ExpressRequest, res: ExpressResponse) => {
        res.redirect('/docs/introduction/getting-started');
    });

    app.get(
        '/docs/:categorypath/:pagepath',
        async (_req: ExpressRequest, res: ExpressResponse) => {
            try {
                const fullPath: string =
                    `${_req.params['categorypath']}/${_req.params['pagepath']}`.toLowerCase();

                // read file from Content folder.
                let contentInMarkdown: string = await LocalFile.read(
                    `${ContentPath}/${fullPath}.md`
                );

                // remove first line from content because we dont want to show title in content. Title is already in nav.

                contentInMarkdown = contentInMarkdown
                    .split('\n')
                    .slice(1)
                    .join('\n');

                const renderedContent: string = await DocsRender.render(
                    contentInMarkdown
                );

                const currentCategory: NavGroup | undefined = DocsNav.find(
                    (category: NavGroup) => {
                        return category.links.find((link: NavLink) => {
                            return link.url
                                .toLocaleLowerCase()
                                .includes(fullPath);
                        });
                    }
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
        }
    );

    app.use('/docs/static', ExpressStatic(StaticPath));
};

export default { init };
