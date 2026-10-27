import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import UserService from "Common/Server/Services/UserService";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";

/*
 * A SELF-HOSTED SERVER WAITING FOR ITS FIRST ACCOUNT.
 *
 * A new install has no account, and its sign-in page asked for an email and
 * a password nobody had: the first visitor had to find "Register" themselves
 * (#5229's follow-ups). While a self-hosted server has no user and no
 * project - the state in which the next signup becomes its admin
 * (UserService.isAwaitingFirstAccount) - and lets people sign up:
 *
 *   - opening the sign-in page (/accounts, /accounts/login) sends the browser
 *     to /accounts/register (sendToRegisterBeforeFirstAccount), before any of
 *     the sign-in page is drawn;
 *   - POST /identity/first-account answers { isAwaitingFirstAccount: true },
 *     and the register page says the account it creates becomes the admin.
 *
 * OneUptime Cloud (billing on) is never waiting: there every visitor gets the
 * usual pages, and the database is never asked.
 *
 * Once the server has an account it never waits again (an account is not
 * deleted while it belongs to a project, and a server whose users were taken
 * out of the database by hand has projects), so this process stops asking.
 * While it waits, it asks on each sign-in page load: two counts of empty
 * tables.
 */

export interface FirstAccountSources {
  isBillingEnabled: boolean;
  isAwaitingFirstAccount: () => Promise<boolean>;
  isSignupDisabled: () => Promise<boolean>;
}

export const FIRST_ACCOUNT_SOURCES: FirstAccountSources = {
  isBillingEnabled: IsBillingEnabled,
  isAwaitingFirstAccount: (): Promise<boolean> => {
    return UserService.isAwaitingFirstAccount();
  },
  isSignupDisabled: (): Promise<boolean> => {
    return DatabaseConfig.shouldDisableSignup();
  },
};

// Where the sign-in page sends a visitor while the server has no account.
export const REGISTER_PAGE_PATH: string = "/accounts/register";

// The paths the Accounts app draws its sign-in page at (Accounts/src/App.tsx).
export const SIGN_IN_PAGE_PATHS: ReadonlyArray<string> = [
  "/accounts",
  "/accounts/login",
];

let hasHadAnAccount: boolean = false;

// For tests: forget that this process has seen an account.
export const forgetFirstAccountForTests: () => void = (): void => {
  hasHadAnAccount = false;
};

/*
 * Whether this server waits for its first account and lets it sign up.
 * Never throws: a read that fails says no, and the usual pages are drawn.
 */
export const isWaitingForFirstAccount: (
  sources?: FirstAccountSources,
) => Promise<boolean> = async (
  sources: FirstAccountSources = FIRST_ACCOUNT_SOURCES,
): Promise<boolean> => {
  if (sources.isBillingEnabled || hasHadAnAccount) {
    return false;
  }

  try {
    if (!(await sources.isAwaitingFirstAccount())) {
      hasHadAnAccount = true;
      return false;
    }

    // A server that does not let people sign up has no register page to send anyone to.
    return !(await sources.isSignupDisabled());
  } catch (err) {
    logger.warn(
      "Could not tell whether this server has an account yet; showing the usual sign-in page.",
    );
    logger.warn(err);
    return false;
  }
};

// A path without its trailing slashes ("/accounts/login/" is "/accounts/login").
const withoutTrailingSlashes: (path: string) => string = (
  path: string,
): string => {
  let end: number = path.length;

  while (end > 1 && path[end - 1] === "/") {
    end--;
  }

  return path.slice(0, end);
};

export const isSignInPagePath: (path: string) => boolean = (
  path: string,
): boolean => {
  return SIGN_IN_PAGE_PATHS.includes(withoutTrailingSlashes(path));
};

/*
 * The Accounts app's index page hook (Frontend/Index.ts): on the sign-in
 * page of a server waiting for its first account, a redirect to the register
 * page, with the query the visitor came with. Never stored, so the sign-in
 * page comes back once the account exists.
 */
export const sendToRegisterBeforeFirstAccount: (
  req: ExpressRequest,
  res: ExpressResponse,
  sources?: FirstAccountSources,
) => Promise<JSONObject> = async (
  req: ExpressRequest,
  res: ExpressResponse,
  sources: FirstAccountSources = FIRST_ACCOUNT_SOURCES,
): Promise<JSONObject> => {
  if (
    !isSignInPagePath(req.path) ||
    !(await isWaitingForFirstAccount(sources))
  ) {
    return {};
  }

  const queryAt: number = req.originalUrl.indexOf("?");
  const query: string = queryAt === -1 ? "" : req.originalUrl.slice(queryAt);

  res.setHeader("Cache-Control", "no-store");
  res.redirect(302, `${REGISTER_PAGE_PATH}${query}`);

  return {};
};
