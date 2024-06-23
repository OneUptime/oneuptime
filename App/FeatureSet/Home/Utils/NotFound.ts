import { ViewsPath } from ./Config;
import { ExpressResponse } from CommonServer/Utils/Express;

export default class NotFoundUtil {
  public static renderNotFound(res: ExpressResponse): void {
    this.setStatus(res, 404);
    this.renderView(res);
  }

  private static setStatus(res: ExpressResponse, status: number): void {
    res.status(status);
  }

  private static renderView(res: ExpressResponse): void {
    res.render(, {
      footerCards: false,
      support: false,
      cta: false,
      blackLogo: false,
      requestDemoCta: false,
    });
  }
}

