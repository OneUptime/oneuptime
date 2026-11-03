import {
  getStatusPageMagicLinkRefusal,
  isStatusPageMagicLinkAvailable,
  STATUS_PAGE_MAGIC_LINK_EXPIRY_MINUTES,
  STATUS_PAGE_MAGIC_LINK_LOGIN_ROUTE,
  STATUS_PAGE_MAGIC_LINK_NOT_AVAILABLE_MESSAGE,
  STATUS_PAGE_MAGIC_LINK_ROUTE,
  STATUS_PAGE_MAGIC_LINK_SSO_REQUIRED_MESSAGE,
  STATUS_PAGE_MAGIC_LINK_TURNED_OFF_MESSAGE,
  StatusPageMagicLinkState,
} from "../../../Types/StatusPage/StatusPageMagicLink";
import { describe, expect, test } from "@jest/globals";

/*
 * When a private status page takes sign-in links (#5600): the one rule both
 * routes ask - when a link is asked for and when one is used - and the
 * status page app's master-page answer reports.
 */

const SIGN_IN_PAGE: StatusPageMagicLinkState = {
  isPublicStatusPage: false,
  enableMasterPassword: false,
  hasMasterPassword: false,
  requireSsoForLogin: false,
  enableMagicLinkLogin: true,
};

describe("getStatusPageMagicLinkRefusal", () => {
  test("a page visitors sign in to, that does not require SSO, with the switch on, takes links", () => {
    expect(getStatusPageMagicLinkRefusal(SIGN_IN_PAGE)).toBeNull();
    expect(isStatusPageMagicLinkAvailable(SIGN_IN_PAGE)).toBe(true);
  });

  test.each([
    [
      "a public page: nobody signs in to it",
      { isPublicStatusPage: true },
      STATUS_PAGE_MAGIC_LINK_NOT_AVAILABLE_MESSAGE,
    ],
    [
      "a page read without its public switch, which is public by default",
      { isPublicStatusPage: undefined },
      STATUS_PAGE_MAGIC_LINK_NOT_AVAILABLE_MESSAGE,
    ],
    [
      "a page behind the master password: private users do not sign in there",
      { enableMasterPassword: true, hasMasterPassword: true },
      STATUS_PAGE_MAGIC_LINK_NOT_AVAILABLE_MESSAGE,
    ],
    [
      "a page that requires SSO",
      { requireSsoForLogin: true },
      STATUS_PAGE_MAGIC_LINK_SSO_REQUIRED_MESSAGE,
    ],
    [
      "a page whose team turned links off",
      { enableMagicLinkLogin: false },
      STATUS_PAGE_MAGIC_LINK_TURNED_OFF_MESSAGE,
    ],
    [
      "a page read without the switch: only a page that says they are on takes them",
      { enableMagicLinkLogin: undefined },
      STATUS_PAGE_MAGIC_LINK_TURNED_OFF_MESSAGE,
    ],
    [
      "a page whose switch is null",
      { enableMagicLinkLogin: null },
      STATUS_PAGE_MAGIC_LINK_TURNED_OFF_MESSAGE,
    ],
  ])(
    "%s takes none",
    (
      _name: string,
      change: Partial<StatusPageMagicLinkState>,
      message: string,
    ) => {
      const state: StatusPageMagicLinkState = { ...SIGN_IN_PAGE, ...change };

      expect(getStatusPageMagicLinkRefusal(state)).toBe(message);
      expect(isStatusPageMagicLinkAvailable(state)).toBe(false);
    },
  );

  test("a private page with the master password switch on but no password set is a sign-in page, and takes links", () => {
    expect(
      getStatusPageMagicLinkRefusal({
        ...SIGN_IN_PAGE,
        enableMasterPassword: true,
        hasMasterPassword: false,
      }),
    ).toBeNull();
  });

  test("a page that is not a sign-in page says so before anything about SSO or the switch", () => {
    expect(
      getStatusPageMagicLinkRefusal({
        ...SIGN_IN_PAGE,
        isPublicStatusPage: true,
        requireSsoForLogin: true,
        enableMagicLinkLogin: false,
      }),
    ).toBe(STATUS_PAGE_MAGIC_LINK_NOT_AVAILABLE_MESSAGE);
  });

  test("a page that requires SSO says so even with links turned off", () => {
    expect(
      getStatusPageMagicLinkRefusal({
        ...SIGN_IN_PAGE,
        requireSsoForLogin: true,
        enableMagicLinkLogin: false,
      }),
    ).toBe(STATUS_PAGE_MAGIC_LINK_SSO_REQUIRED_MESSAGE);
  });

  test("the SSO refusal reads like the password routes' own", () => {
    // StatusPageSsoEnforcement.test.ts matches every surface on this.
    expect(STATUS_PAGE_MAGIC_LINK_SSO_REQUIRED_MESSAGE).toContain(
      "Status Page supports authentication by SSO",
    );
  });
});

describe("the link itself", () => {
  test("works for fifteen minutes", () => {
    expect(STATUS_PAGE_MAGIC_LINK_EXPIRY_MINUTES).toBe(15);
  });

  test("opens <page>/magic-link-login/<token>, asked for on <page>/magic-link", () => {
    expect(STATUS_PAGE_MAGIC_LINK_LOGIN_ROUTE).toBe("magic-link-login");
    expect(STATUS_PAGE_MAGIC_LINK_ROUTE).toBe("magic-link");
  });
});
