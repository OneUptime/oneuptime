import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageAccessRulesUtil, {
  STATUS_PAGE_ACCESS_RULES_SELECT,
  STATUS_PAGE_IMAGE_MAX_AGE_SECONDS,
  StatusPageAccessRules,
} from "../../../../Server/Utils/StatusPage/StatusPageAccessRules";
import { describe, expect, test } from "@jest/globals";

/*
 * Which status pages a cache that serves other people - a CDN, a proxy, a
 * mail client's image proxy - may keep anything of: only a page that is for
 * everyone. Every way a page limits who sees it - signing in, a master
 * password, single sign-on, an IP allow list, being archived - makes it
 * private, and its images are sent with Cache-Control: private.
 */

const OPEN: StatusPageAccessRules = {
  isArchived: false,
  isPublicStatusPage: true,
  ipWhitelist: "",
  enableMasterPassword: false,
  hasMasterPassword: false,
  requireSsoForLogin: false,
  privateUserSessionLengthInHours: undefined,
};

const LIMITED: Array<[string, Partial<StatusPageAccessRules>]> = [
  ["a page its readers sign in to", { isPublicStatusPage: false }],
  [
    "a page behind a master password",
    {
      isPublicStatusPage: false,
      enableMasterPassword: true,
      hasMasterPassword: true,
    },
  ],
  [
    "a private page with the password switched on but none set",
    { isPublicStatusPage: false, enableMasterPassword: true },
  ],
  [
    "a public page with a master password set and switched on",
    { enableMasterPassword: true, hasMasterPassword: true },
  ],
  [
    "a page that requires single sign-on",
    { isPublicStatusPage: false, requireSsoForLogin: true },
  ],
  ["a public page that requires single sign-on", { requireSsoForLogin: true }],
  ["a public page with an IP allow list", { ipWhitelist: "203.0.113.0/24" }],
  [
    "a public page with an allow list of several lines",
    { ipWhitelist: "\n203.0.113.7\n" },
  ],
  ["an archived page", { isArchived: true }],
];

describe("StatusPageAccessRulesUtil.isOpenToEveryone", () => {
  test("a public page with nothing that limits who sees it is for everyone", () => {
    expect(StatusPageAccessRulesUtil.isOpenToEveryone(OPEN)).toBe(true);
  });

  test("an allow list of only blank lines limits no one", () => {
    expect(
      StatusPageAccessRulesUtil.isOpenToEveryone({
        ...OPEN,
        ipWhitelist: " \n \n",
      }),
    ).toBe(true);
  });

  test("a password switched on but never set on a public page limits no one", () => {
    expect(
      StatusPageAccessRulesUtil.isOpenToEveryone({
        ...OPEN,
        enableMasterPassword: true,
      }),
    ).toBe(true);
  });

  test.each(LIMITED)(
    "%s is not",
    (_name: string, rules: Partial<StatusPageAccessRules>) => {
      expect(
        StatusPageAccessRulesUtil.isOpenToEveryone({ ...OPEN, ...rules }),
      ).toBe(false);
    },
  );

  test("a page that cannot be read is not", () => {
    expect(StatusPageAccessRulesUtil.isOpenToEveryone(null)).toBe(false);
    expect(StatusPageAccessRulesUtil.isOpenToEveryone(undefined)).toBe(false);
  });
});

describe("StatusPageAccessRulesUtil.getImageCacheControl", () => {
  test("any cache may keep a page for everyone's images, for STATUS_PAGE_IMAGE_MAX_AGE_SECONDS", () => {
    expect(StatusPageAccessRulesUtil.getImageCacheControl(OPEN)).toBe(
      `public, max-age=${STATUS_PAGE_IMAGE_MAX_AGE_SECONDS}`,
    );
  });

  test.each(LIMITED)(
    "%s: only the visitor's own browser - never public",
    (_name: string, rules: Partial<StatusPageAccessRules>) => {
      const cacheControl: string =
        StatusPageAccessRulesUtil.getImageCacheControl({ ...OPEN, ...rules });

      expect(cacheControl).toBe(
        `private, max-age=${STATUS_PAGE_IMAGE_MAX_AGE_SECONDS}`,
      );
      expect(cacheControl).not.toContain("public");
    },
  );

  test("a page that cannot be read is sent private", () => {
    expect(StatusPageAccessRulesUtil.getImageCacheControl(null)).toBe(
      `private, max-age=${STATUS_PAGE_IMAGE_MAX_AGE_SECONDS}`,
    );
  });

  test("a browser keeps an image for minutes, not longer", () => {
    expect(STATUS_PAGE_IMAGE_MAX_AGE_SECONDS).toBeLessThanOrEqual(300);
  });
});

describe("StatusPageAccessRulesUtil.fromStatusPage", () => {
  test("keeps whether a master password is set, never its hash", () => {
    const page: StatusPage = new StatusPage();
    page.isPublicStatusPage = false;
    page.enableMasterPassword = true;
    page.masterPassword = "scrypt$a-hash" as never;
    page.requireSsoForLogin = true;
    page.privateUserSessionLengthInHours = 12;
    page.ipWhitelist = "203.0.113.7";
    page.isArchived = false;

    const rules: StatusPageAccessRules =
      StatusPageAccessRulesUtil.fromStatusPage(page);

    expect(rules).toEqual({
      isArchived: false,
      isPublicStatusPage: false,
      ipWhitelist: "203.0.113.7",
      enableMasterPassword: true,
      hasMasterPassword: true,
      requireSsoForLogin: true,
      privateUserSessionLengthInHours: 12,
    });
    expect(JSON.stringify(rules)).not.toContain("a-hash");
  });

  test("reads an empty column as nothing set", () => {
    const page: StatusPage = new StatusPage();
    (page as unknown as Record<string, unknown>)[
      "privateUserSessionLengthInHours"
    ] = null;

    expect(StatusPageAccessRulesUtil.fromStatusPage(page)).toEqual({
      isArchived: false,
      isPublicStatusPage: false,
      ipWhitelist: "",
      enableMasterPassword: false,
      hasMasterPassword: false,
      requireSsoForLogin: false,
      privateUserSessionLengthInHours: undefined,
    });
  });

  test("is read from every column the read check goes by", () => {
    expect(Object.keys(STATUS_PAGE_ACCESS_RULES_SELECT).sort()).toEqual([
      "_id",
      "enableMasterPassword",
      "ipWhitelist",
      "isArchived",
      "isPublicStatusPage",
      "masterPassword",
      "privateUserSessionLengthInHours",
      "requireSsoForLogin",
    ]);
  });
});
