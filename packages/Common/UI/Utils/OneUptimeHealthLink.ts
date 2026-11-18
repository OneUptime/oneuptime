import { ADMIN_DASHBOARD_URL } from "../Config";
import URL from "../../Types/API/URL";

/*
 * Admin > OneUptime Health, where a self-hosted server's master admin is
 * sent when the server fails (ErrorExplanation, ErrorWhereToLook): the
 * findings `npm run doctor` prints, in the browser.
 */
export const ONEUPTIME_HEALTH_ROUTE: string = "/health";

export const getOneUptimeHealthUrl: () => URL = (): URL => {
  return URL.fromString(ADMIN_DASHBOARD_URL.toString()).addRoute(
    ONEUPTIME_HEALTH_ROUTE,
  );
};

/*
 * Whether the page is OneUptime Health already, or one of its pages: a
 * failure there is not sent to the page it is on - "Open OneUptime Health"
 * on OneUptime Health would only reload it.
 */
export const isOnOneUptimeHealth: () => boolean = (): boolean => {
  try {
    if (typeof window === "undefined" || !window.location) {
      return false;
    }

    const health: string = new globalThis.URL(
      getOneUptimeHealthUrl().toString(),
    ).pathname.replace(/\/+$/, "");
    const here: string = window.location.pathname.replace(/\/+$/, "");

    return (
      Boolean(health) && (here === health || here.startsWith(`${health}/`))
    );
  } catch {
    return false;
  }
};
