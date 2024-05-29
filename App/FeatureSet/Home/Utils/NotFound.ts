import { ViewsPath } from './Config';
import { ExpressResponse } from 'CommonServer/Utils/Express';

export default class NotFoundUtil {
    public static renderNotFound(res: ExpressResponse): void {
        res.status(404);
        res.render(`${ViewsPath}/not-found.ejs`, {
            footerCards: false,
            support: false,
            cta: false,
            blackLogo: false,
            requestDemoCta: false,
        });
    }
}
