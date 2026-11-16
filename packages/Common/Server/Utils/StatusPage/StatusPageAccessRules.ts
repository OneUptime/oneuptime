import StatusPage from "../../../Models/DatabaseModels/StatusPage";

/*
 * WHAT DECIDES WHO MAY READ A STATUS PAGE, AND WHAT A CACHE MAY KEEP OF IT.
 *
 * The columns of a page that its read check (StatusPageService.hasReadAccess)
 * goes by, read once and kept for a few seconds per process
 * (StatusPageReadCache, keepOnlyWhileShared) instead of on every request of
 * every view. The decision is still made on every request, from them and the
 * request: the visitor's address against the allow list, their sign-in
 * session (read live, never kept) and their master password cookie.
 *
 * The master password's hash is never kept: only whether there is one.
 */
export interface StatusPageAccessRules {
  isArchived: boolean;
  isPublicStatusPage: boolean;
  // The allow list as stored, one address or range a line; "" for none.
  ipWhitelist: string;
  enableMasterPassword: boolean;
  hasMasterPassword: boolean;
  requireSsoForLogin: boolean;
  privateUserSessionLengthInHours: number | undefined;
}

// How long a visitor's browser may keep a page's image before it asks again.
export const STATUS_PAGE_IMAGE_MAX_AGE_SECONDS: number = 300;

// The columns the rules are read from.
export const STATUS_PAGE_ACCESS_RULES_SELECT: {
  _id: true;
  isPublicStatusPage: true;
  ipWhitelist: true;
  enableMasterPassword: true;
  masterPassword: true;
  isArchived: true;
  requireSsoForLogin: true;
  privateUserSessionLengthInHours: true;
} = {
  _id: true,
  isPublicStatusPage: true,
  ipWhitelist: true,
  enableMasterPassword: true,
  masterPassword: true,
  isArchived: true,
  requireSsoForLogin: true,
  privateUserSessionLengthInHours: true,
};

export default class StatusPageAccessRulesUtil {
  // The rules of a page read with STATUS_PAGE_ACCESS_RULES_SELECT.
  public static fromStatusPage(statusPage: StatusPage): StatusPageAccessRules {
    return {
      isArchived: statusPage.isArchived === true,
      isPublicStatusPage: statusPage.isPublicStatusPage === true,
      ipWhitelist: (statusPage.ipWhitelist || "").toString(),
      enableMasterPassword: statusPage.enableMasterPassword === true,
      hasMasterPassword: Boolean(statusPage.masterPassword),
      requireSsoForLogin: statusPage.requireSsoForLogin === true,
      // A column the database left empty reads as null: as not set.
      privateUserSessionLengthInHours:
        statusPage.privateUserSessionLengthInHours ?? undefined,
    };
  }

  /*
   * Whether the page is for everyone: public, live, with no allow list, no
   * single sign-on required and no master password set - anything that
   * limits who sees a page, however it is set, makes it not. Only such a
   * page's responses may be kept by a cache that serves other people (a CDN,
   * a proxy, a mail client's image proxy). A page that cannot be read is
   * not.
   */
  public static isOpenToEveryone(
    rules: StatusPageAccessRules | null | undefined,
  ): boolean {
    if (!rules) {
      return false;
    }

    return (
      !rules.isArchived &&
      rules.isPublicStatusPage &&
      rules.ipWhitelist.trim().length === 0 &&
      !rules.requireSsoForLogin &&
      !(rules.enableMasterPassword && rules.hasMasterPassword)
    );
  }

  /*
   * The Cache-Control a page's images are sent with: kept for
   * STATUS_PAGE_IMAGE_MAX_AGE_SECONDS, by any cache for a page that is for
   * everyone, and only by the visitor's own browser for any other - a shared
   * cache must never keep anything of a private page. Either way the browser
   * asks again with the image's ETag after that, and gets 304 when it has
   * not changed.
   */
  public static getImageCacheControl(
    rules: StatusPageAccessRules | null | undefined,
  ): string {
    return `${
      this.isOpenToEveryone(rules) ? "public" : "private"
    }, max-age=${STATUS_PAGE_IMAGE_MAX_AGE_SECONDS}`;
  }
}
