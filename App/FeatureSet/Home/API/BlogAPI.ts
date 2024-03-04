import Express, {
    ExpressApplication,
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import BlogPostUtil, { BlogPost, BlogPostHeader } from '../Utils/BlogPost';
import { ViewsPath } from '../Utils/Config';
import logger from 'CommonServer/Utils/Logger';
import ServerErrorUtil from '../Utils/ServerError';
import NotFoundUtil from '../Utils/NotFound';

const app: ExpressApplication = Express.getExpressApp();

app.get(
    '/blog/post/:file',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const fileName: string = req.params['file'] as string;

            const blogPost: BlogPost | null = await BlogPostUtil.getBlogPost(
                fileName
            );

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
            });
        } catch (e) {
            logger.error(e);
            return ServerErrorUtil.rednerServerError(res);
        }
    }
);

// List all blog posts with tag

app.get(
    '/blog/tag/:tagName',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const fileName: string = req.params['file'] as string;

            const blogPost: BlogPost | null = await BlogPostUtil.getBlogPost(
                fileName
            );

            res.render(`${ViewsPath}/Blog/ListByTag`, {
                support: false,
                footerCards: true,
                cta: true,
                blackLogo: false,
                requestDemoCta: false,
                blogPost: blogPost,
            });
        } catch (e) {
            logger.error(e);
            return res.redirect('/server-error');
        }
    }
);

// main blog page
app.get('/blog', async (_req: ExpressRequest, res: ExpressResponse) => {
    try {
        const blogPosts: Array<BlogPostHeader> =
            await BlogPostUtil.getBlogPostList();

        res.render(`${ViewsPath}/Blog/List`, {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
            blogPost: blogPosts,
        });
    } catch (e) {
        logger.error(e);
        return res.redirect('/server-error');
    }
});
