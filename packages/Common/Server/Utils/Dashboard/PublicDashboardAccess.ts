import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import {
  DashboardAccessState,
  isDashboardLockedWithoutPassword,
  isDashboardMasterPasswordRequired,
  isDashboardPublic,
  isDashboardSignInRequired,
} from "../../../Types/Dashboard/DashboardAccess";
import { DASHBOARD_MASTER_PASSWORD_REQUIRED_MESSAGE } from "../../../Types/Dashboard/MasterPassword";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import MasterPasswordRequiredException from "../../../Types/Exception/MasterPasswordRequiredException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import IP from "../../../Types/IP/IP";
import Select from "../../Types/Database/Select";

/*
 * What a dashboard's public link answers one visitor. Every public dashboard
 * route decides this first, and only then reads what it sends, so nothing
 * about a dashboard reaches a visitor the link does not answer.
 *
 * It follows the one rule the Sharing page shows and writes
 * (Types/Dashboard/DashboardAccess), plus the two things the link adds to
 * it: an archived dashboard's link answers nobody, and the IP allowlist
 * (the ipWhitelist column) limits it to the addresses it names, password or
 * sign-in or not. A dashboard of a project a master admin blocked is handed
 * in as none at all (DashboardService.withoutBlockedProject). The checks
 * run in this order, and the first that applies decides:
 *
 *   no such dashboard, archived, or only people in the project  NotFound
 *   the IP allowlist does not name the visitor's address          Forbidden
 *   only people who sign in, and the visitor holds no live
 *     session of one of its private users (#10250)              SignInRequired
 *   a password the visitor has not entered (or, locked, none set) PasswordRequired
 *   otherwise                                                     Granted
 *
 * A dashboard that asks its visitors to sign in never takes the password
 * instead (isDashboardMasterPasswordRequired is false for it), so the last
 * two never both apply.
 */
export enum PublicDashboardAccess {
  /*
   * The link answers nobody. A dashboard shared only with its project, an
   * archived one and one that never existed all read the same, so trying
   * links tells a stranger nothing about which dashboards exist.
   */
  NotFound = "NotFound",
  // Public, but its IP allowlist does not name this visitor's address.
  Forbidden = "Forbidden",
  /*
   * Public for only the people who sign in (Dashboard.requireSignIn), and
   * this visitor holds no live session of one of its private users: the
   * public dashboard app shows its sign-in page.
   */
  SignInRequired = "SignInRequired",
  /*
   * Public behind a password this visitor has not entered. A locked
   * dashboard (the switch on, no password set) is here too, whatever the
   * visitor holds: nobody can get past its prompt.
   */
  PasswordRequired = "PasswordRequired",
  // The visitor may view the dashboard.
  Granted = "Granted",
}

/*
 * What the link knows about the visitor asking. The decision reads each fact
 * only when it needs it - the address only for a dashboard with an IP
 * allowlist, the unlock cookie only for one that asks for the password, the
 * session only for one that asks its visitors to sign in - so a request's
 * visitor can work them out lazily (DashboardService.getPublicDashboardVisitor).
 */
export interface PublicDashboardVisitor {
  /*
   * The address the IP allowlist is checked against (resolveClientIp), or
   * undefined when none can be established: an allowlist then refuses.
   */
  readonly clientIp: string | undefined;
  // Whether the visitor holds this dashboard's unlock cookie.
  readonly hasUnlockCookie: boolean;
  /*
   * Whether the visitor holds a live session of one of this dashboard's
   * private users, on this dashboard (DashboardPrivateUserSessionService.
   * findSignedInSessionOnRequest). Read by the service before the decision,
   * and only for a dashboard that asks its visitors to sign in.
   */
  readonly hasSignedInSession: boolean;
}

/*
 * A visitor nothing is known about: no unlock cookie, no session and no
 * address an allowlist could name. What the link answers them is what it
 * shows every visitor - for a page rendered once for whoever loads it (the
 * page head the public dashboard's own server fills in from the SEO answer).
 */
export const UNKNOWN_PUBLIC_DASHBOARD_VISITOR: PublicDashboardVisitor = {
  clientIp: undefined,
  hasUnlockCookie: false,
  hasSignedInSession: false,
};

/*
 * The answer a public route gives where the link answers nobody (NotFound),
 * word for word for a missing, an archived and a private dashboard alike:
 * a route that sends the dashboard itself says it is not found, and the
 * read-checked routes say it is not available.
 */
export const PUBLIC_DASHBOARD_NOT_FOUND_MESSAGE: string = "Dashboard not found";

export const PUBLIC_DASHBOARD_NOT_AVAILABLE_MESSAGE: string =
  "This dashboard is not available.";

export const PUBLIC_DASHBOARD_ADDRESS_UNKNOWN_MESSAGE: string =
  "Unable to verify IP address for dashboard access.";

/*
 * What every public route answers a visitor of a dashboard that asks its
 * visitors to sign in, while they hold no live session there: the same
 * words whatever they sent - no session, one of another dashboard, one that
 * ran out or was ended.
 */
export const PUBLIC_DASHBOARD_SIGN_IN_REQUIRED_MESSAGE: string =
  "Sign in to view this dashboard.";

/*
 * The page head a public dashboard page has before it knows anything about
 * the dashboard, and keeps when it may show nothing of it.
 */
export const PUBLIC_DASHBOARD_DEFAULT_TITLE: string = "Dashboard";

export const PUBLIC_DASHBOARD_DEFAULT_DESCRIPTION: string =
  "View dashboard metrics and insights.";

export const getPublicDashboardAddressBlockedMessage: (
  clientIp: string,
) => string = (clientIp: string): string => {
  return `Your IP address ${clientIp} is blocked from accessing this dashboard.`;
};

/*
 * The columns the decision reads, and nothing it does not - and the project,
 * which DashboardService reads to answer a dashboard of a blocked project as
 * one that does not exist (withoutBlockedProject). None of them is ever sent.
 */
export const PUBLIC_DASHBOARD_ACCESS_SELECT: Select<Dashboard> = {
  _id: true,
  projectId: true,
  isPublicDashboard: true,
  ipWhitelist: true,
  enableMasterPassword: true,
  // Only to tell whether one is set; it never leaves the server.
  masterPassword: true,
  isArchived: true,
  requireSignIn: true,
  // Whether a session a password signed in still counts (addSignInRule).
  requireSsoForLogin: true,
};

/*
 * The decision, with what goes with it. isMasterPasswordRequired is whether
 * the link asks its visitors for the password, by the Sharing rule
 * (isDashboardMasterPasswordRequired), and isSignInRequired whether it asks
 * them to sign in (isDashboardSignInRequired) - both still true once this
 * visitor is past them. A refusal carries what the read-checked routes
 * answer (DashboardService.hasReadAccess): 401 for NotFound, SignInRequired
 * and PasswordRequired, 403 for Forbidden.
 */
export type PublicDashboardAccessResult =
  | {
      access: PublicDashboardAccess.Granted;
      isMasterPasswordRequired: boolean;
      isSignInRequired: boolean;
    }
  | {
      access: PublicDashboardAccess.NotFound;
      isMasterPasswordRequired: false;
      isSignInRequired: false;
      error: NotAuthenticatedException;
    }
  | {
      access: PublicDashboardAccess.Forbidden;
      isMasterPasswordRequired: boolean;
      isSignInRequired: boolean;
      error: ForbiddenException;
    }
  | {
      access: PublicDashboardAccess.SignInRequired;
      isMasterPasswordRequired: false;
      isSignInRequired: true;
      error: NotAuthenticatedException;
    }
  | {
      access: PublicDashboardAccess.PasswordRequired;
      isMasterPasswordRequired: true;
      isSignInRequired: false;
      error: MasterPasswordRequiredException;
    };

export default class PublicDashboardAccessPolicy {
  public static decide(data: {
    dashboard: Dashboard | null;
    visitor: PublicDashboardVisitor;
  }): PublicDashboardAccessResult {
    const dashboard: Dashboard | null = data.dashboard;

    // Who can view it, by the one rule the Sharing page shows and writes.
    const accessState: DashboardAccessState = {
      isPublicDashboard: dashboard?.isPublicDashboard,
      enableMasterPassword: dashboard?.enableMasterPassword,
      hasMasterPassword: Boolean(dashboard?.masterPassword),
      requireSignIn: dashboard?.requireSignIn,
    };

    /*
     * An archived dashboard is not public either, whatever its setting
     * says: the setting is kept so unarchiving puts the public link back
     * exactly as it was.
     */
    if (!dashboard || dashboard.isArchived || !isDashboardPublic(accessState)) {
      return {
        access: PublicDashboardAccess.NotFound,
        isMasterPasswordRequired: false,
        isSignInRequired: false,
        error: new NotAuthenticatedException(
          PUBLIC_DASHBOARD_NOT_AVAILABLE_MESSAGE,
        ),
      };
    }

    const isMasterPasswordRequired: boolean =
      isDashboardMasterPasswordRequired(accessState);

    const isSignInRequired: boolean = isDashboardSignInRequired(accessState);

    // The visitor's address is asked for only when there is a list to check.
    const addressRefusal: ForbiddenException | null = dashboard.ipWhitelist
      ? PublicDashboardAccessPolicy.getAddressRefusal({
          ipWhitelist: dashboard.ipWhitelist,
          clientIp: data.visitor.clientIp,
        })
      : null;

    if (addressRefusal) {
      return {
        access: PublicDashboardAccess.Forbidden,
        isMasterPasswordRequired,
        isSignInRequired,
        error: addressRefusal,
      };
    }

    /*
     * Only the dashboard's private users, signed in on this dashboard. The
     * session was read for this visitor only because the dashboard asks for
     * it; a dashboard that does never takes the password instead.
     */
    if (isSignInRequired) {
      if (!data.visitor.hasSignedInSession) {
        return {
          access: PublicDashboardAccess.SignInRequired,
          isMasterPasswordRequired: false,
          isSignInRequired: true,
          error: new NotAuthenticatedException(
            PUBLIC_DASHBOARD_SIGN_IN_REQUIRED_MESSAGE,
          ),
        };
      }

      return {
        access: PublicDashboardAccess.Granted,
        isMasterPasswordRequired: false,
        isSignInRequired: true,
      };
    }

    if (!isMasterPasswordRequired) {
      return {
        access: PublicDashboardAccess.Granted,
        isMasterPasswordRequired,
        isSignInRequired: false,
      };
    }

    /*
     * Fail closed if protection was turned on before a password was set.
     * The Sharing page never writes this state (picking the password asks
     * for one), but the API can. Only then is the unlock cookie asked for.
     */
    if (
      isDashboardLockedWithoutPassword(accessState) ||
      !data.visitor.hasUnlockCookie
    ) {
      return {
        access: PublicDashboardAccess.PasswordRequired,
        isMasterPasswordRequired: true,
        isSignInRequired: false,
        error: new MasterPasswordRequiredException(
          DASHBOARD_MASTER_PASSWORD_REQUIRED_MESSAGE,
        ),
      };
    }

    return {
      access: PublicDashboardAccess.Granted,
      isMasterPasswordRequired,
      isSignInRequired: false,
    };
  }

  /*
   * The refusal for a visitor the IP allowlist does not name, or null when
   * the dashboard has no allowlist or names them. An address that cannot be
   * established is refused: there is no safe default address.
   */
  public static getAddressRefusal(data: {
    ipWhitelist: string | null | undefined;
    clientIp: string | undefined;
  }): ForbiddenException | null {
    if (!data.ipWhitelist || data.ipWhitelist.length === 0) {
      return null;
    }

    if (!data.clientIp) {
      return new ForbiddenException(PUBLIC_DASHBOARD_ADDRESS_UNKNOWN_MESSAGE);
    }

    const isAllowed: boolean = IP.isInWhitelist({
      ip: data.clientIp,
      whitelist: data.ipWhitelist.split("\n"),
    });

    if (!isAllowed) {
      return new ForbiddenException(
        getPublicDashboardAddressBlockedMessage(data.clientIp),
      );
    }

    return null;
  }
}
