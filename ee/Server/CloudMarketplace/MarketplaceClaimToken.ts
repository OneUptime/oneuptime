import crypto from "crypto";
import { DashboardRoute } from "Common/ServiceRoute";
import OneUptimeDate from "Common/Types/Date";
import {
  MARKETPLACE_PURCHASE_PENDING_COOKIE_NAME,
  MARKETPLACE_PURCHASE_TTL_IN_HOURS,
} from "Common/Types/Marketplace/MarketplacePurchase";
import CookieUtil from "Common/Server/Utils/Cookie";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";

/*
 * The one-use token that lets the browser a marketplace purchase arrived in
 * link it to a project.
 *
 * WHY A COOKIE
 *
 * The marketplace's own token (Azure's purchase token, AWS's registration
 * token, Google's signed JWT) is resolved the moment it arrives; what the
 * buyer's browser carries on to the purchase page is this token instead. It
 * is a bearer secret - whoever holds it can attach the purchase to a project
 * of theirs - so it is never put in a URL, where every analytics tag on the
 * page would report it (see Partials/SensitiveUrlToken.ejs). It travels in an
 * HttpOnly cookie, scoped to the marketplace API, so:
 *
 *   - no script on any page can read it;
 *   - it is sent only to /api/marketplace, the only reader; and
 *   - signing in does not clear it: the identity endpoints that clear every
 *     cookie they receive on the way to the sign-in page never receive this
 *     one.
 *
 * SameSite=Lax keeps another site's form from spending it, and the server
 * stores only its SHA-256.
 */

const CLAIM_COOKIE_NAME: string = "oneuptime-marketplace-purchase";
const CLAIM_COOKIE_PATH: string = "/api/marketplace";
const TOKEN_BYTES: number = 32;
const TOKEN_PATTERN: RegExp = /^[a-f0-9]{64}$/;

export default class MarketplaceClaimToken {
  public static generate(): string {
    return crypto.randomBytes(TOKEN_BYTES).toString("hex");
  }

  public static hash(token: string): string {
    return crypto.createHash("sha256").update(token, "utf8").digest("hex");
  }

  public static isToken(value: unknown): value is string {
    return typeof value === "string" && TOKEN_PATTERN.test(value);
  }

  public static getExpiryDate(): Date {
    return OneUptimeDate.addRemoveHours(
      OneUptimeDate.getCurrentDate(),
      MARKETPLACE_PURCHASE_TTL_IN_HOURS,
    );
  }

  /*
   * The claim token for the API, and the marker the dashboard looks for
   * after a sign-in. Both last as long as the claim, and both are Secure
   * whenever the browser is on HTTPS (CookieUtil.setCookie decides).
   */
  public static setCookies(res: ExpressResponse, token: string): void {
    const maxAge: number = MARKETPLACE_PURCHASE_TTL_IN_HOURS * 60 * 60 * 1000;

    CookieUtil.setCookie(res, CLAIM_COOKIE_NAME, token, {
      path: CLAIM_COOKIE_PATH,
      maxAge: maxAge,
      httpOnly: true,
    });

    CookieUtil.setCookie(res, MARKETPLACE_PURCHASE_PENDING_COOKIE_NAME, "1", {
      path: DashboardRoute.toString(),
      maxAge: maxAge,
      httpOnly: false,
    });
  }

  public static clearCookies(res: ExpressResponse): void {
    CookieUtil.removeCookie(res, CLAIM_COOKIE_NAME, {
      path: CLAIM_COOKIE_PATH,
    });
    CookieUtil.removeCookie(res, MARKETPLACE_PURCHASE_PENDING_COOKIE_NAME, {
      path: DashboardRoute.toString(),
    });
  }

  // The claim token the browser holds, or null when it holds none (or anything else).
  public static readFromRequest(req: ExpressRequest): string | null {
    const value: unknown = CookieUtil.getCookieFromExpressRequest(
      req,
      CLAIM_COOKIE_NAME,
    );

    return MarketplaceClaimToken.isToken(value) ? value : null;
  }
}
