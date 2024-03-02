import Express, { ExpressApplication, ExpressRequest, ExpressResponse } from "CommonServer/Utils/Express";
import BlogPost from "../Utils/BlogPost";
import BlogPostUtil from "../Utils/BlogPost";
import { ViewsPath } from "../Utils/Config";
import logger from 'CommonServer/Utils/Logger';

const app: ExpressApplication = Express.getExpressApp();

app.get('/blog/post/:file', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const fileName: string = req.params['file'] as string;

        const blogPost: BlogPost = await BlogPostUtil.getBlogPost(fileName);

        res.render(`${ViewsPath}/blog`, {
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
});

// List all blog posts with tag

app.get('/blog/tag/:tagName', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const fileName: string = req.params['file'] as string;

        const blogPost: BlogPost = await BlogPostUtil.getBlogPost(fileName);

        res.render(`${ViewsPath}/blog`, {
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
});

// main blog page
app.get('/blog', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const fileName: string = req.params['file'] as string;

        const blogPost: BlogPost = await BlogPostUtil.getBlogPost(fileName);

        res.render(`${ViewsPath}/blog`, {
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
});