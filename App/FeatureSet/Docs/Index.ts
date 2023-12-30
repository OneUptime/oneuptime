import 'ejs';
import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
    ExpressApplication,
} from 'CommonServer/Utils/Express';
import { StaticPath, ViewsPath } from './Utils/Config';

const app: ExpressApplication = Express.getExpressApp();

app.get('/docs', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render(`${ViewsPath}/index`, {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.use('/docs/static', ExpressStatic(StaticPath));
