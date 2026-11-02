import { JSONObject } from "Common/Types/JSON";
import {
  SignInAttributionCookieName,
  SignInAttributionCookiePath,
} from "Common/Types/Marketing/Attribution";
import Cookie from "Common/UI/Utils/Cookie";
import UserUtil from "Common/UI/Utils/User";

// As long as the sign-in's own state cookie lasts (Identity/API/MicrosoftSignIn).
const COOKIE_MAX_AGE_IN_SECONDS: number = 10 * 60;

/*
 * A browser quietly drops a cookie over about 4 KB. That can only cost the
 * attribution, never the sign-in, whose state is in a cookie of its own - but
 * the click ID is what an ad platform can use, so it is what is kept last.
 */
const MAX_COOKIE_VALUE_LENGTH: number = 3800;

/*
 * The attribution this browser holds, as the sign-in attribution cookie's
 * value: as much of it as fits, most of it first. Null when it holds none,
 * which is also what it holds where measurement is not allowed: the page
 * stores nothing then (Common/Server/Views/Partials/AnalyticsConsent.ejs).
 */
export const getSignInAttributionCookieValue: () => string | null = ():
  | string
  | null => {
  const utm: JSONObject = UserUtil.getUtmParams();
  const clickIds: JSONObject | null = UserUtil.getAttributionClickIds();
  const firstTouch: JSONObject | null = UserUtil.getFirstTouchAttribution();

  if (Object.keys(utm).length === 0 && !clickIds && !firstTouch) {
    return null;
  }

  const candidates: Array<JSONObject> = [
    { utm, clickIds, firstTouch },
    { utm, clickIds },
    { clickIds },
  ];

  for (const candidate of candidates) {
    const value: string = encodeURIComponent(JSON.stringify(candidate));

    if (value.length <= MAX_COOKIE_VALUE_LENGTH) {
      return value;
    }
  }

  return null;
};

/*
 * Leaves the attribution where the sign-in's callback can read it. Never
 * throws: this runs as a button is pressed, and the sign-in matters more.
 */
export const rememberAttributionForSignIn: () => void = (): void => {
  try {
    const value: string | null = getSignInAttributionCookieValue();
    const secure: string = Cookie.isPageOnHttps() ? "; secure" : "";

    document.cookie =
      `${SignInAttributionCookieName}=${value || ""}` +
      `; path=${SignInAttributionCookiePath}` +
      `; max-age=${value ? COOKIE_MAX_AGE_IN_SECONDS : 0}` +
      `; samesite=lax${secure}`;
  } catch {
    // Attribution is best-effort.
  }
};
