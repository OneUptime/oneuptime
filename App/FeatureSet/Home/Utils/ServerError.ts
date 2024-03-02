import { ExpressResponse } from "CommonServer/Utils/Express";
import { ViewsPath } from "./Config";

export default class ServerErrorUtil {
    public static rednerServerError(res: ExpressResponse): void {
        res.status(500);
        res.render(`${ViewsPath}/server-error.ejs`, {
            footerCards: false,
            support: false,
            cta: false,
            blackLogo: false,
            requestDemoCta: false,
        });
    }
}