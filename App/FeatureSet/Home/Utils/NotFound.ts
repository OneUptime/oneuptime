import { ExpressResponse } from "CommonServer/Utils/Express";
import { ViewsPath } from "./Config";

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