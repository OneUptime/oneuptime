import BlogPostUtil, { BlogPost, BlogPostHeader } from '../Utils/BlogPost';
import { ViewsPath } from '../Utils/Config';
import NotFoundUtil from '../Utils/NotFound';
import ServerErrorUtil from '../Utils/ServerError';
import Text from 'Common/Types/Text';
import Express, {
    ExpressApplication,
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';

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
            return ServerErrorUtil.renderServerError(res);
        }
    }
);

// List all blog posts with tag

app.get(
    '/blog/tag/:tagName',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const tagName: string = req.params['tagName'] as string;

            const blogPosts: Array<BlogPostHeader> =
                await BlogPostUtil.getBlogPostList(tagName);

            res.render(`${ViewsPath}/Blog/ListByTag`, {
                support: false,
                footerCards: true,
                cta: true,
                blackLogo: false,
                requestDemoCta: false,
                blogPosts: blogPosts,
                tagName: Text.fromDashesToPascalCase(tagName),
            });
        } catch (e) {
            logger.error(e);
            return ServerErrorUtil.renderServerError(res);
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
            blogPosts: blogPosts,
        });
    } catch (e) {
        logger.error(e);
        return ServerErrorUtil.renderServerError(res);
    }
});
