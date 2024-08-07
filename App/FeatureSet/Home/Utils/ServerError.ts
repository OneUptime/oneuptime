import { ViewsPath } from "./Config";
import { ExpressResponse } from "Common/Server/Utils/Express";

export default class ServerErrorUtil {
  public static renderServerError(res: ExpressResponse): void {
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
