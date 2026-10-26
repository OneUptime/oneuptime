import { describe, expect, test } from "@jest/globals";
import {
  MarkdownLinkBehavior,
  getCurrentPageUrl,
  getMarkdownLinkBehavior,
} from "../../../UI/Components/Markdown.tsx/MarkdownLinkBehavior";

/*
 * Where a link in rendered Markdown opens (MarkdownLinkBehavior).
 *
 * A customer's feedback: a link in a note or a feed - another site, a file
 * somebody attached - took over the OneUptime tab they were working in. A
 * link that leaves the app now opens in a tab of its own; one to another
 * page of the same app stays in the tab, as do "#section" links and the
 * schemes the browser hands to another program (mailto:, tel:).
 */

const DASHBOARD_PAGE: string =
  "https://oneuptime.example/dashboard/5f1c0b5e-7a4e-4d8e-9f61-0c2f1b0a7d11/incidents/9a3c0f6e-2b1d-4c5e-8f7a-1d2e3f4a5b6c";
const ADMIN_PAGE: string = "https://oneuptime.example/admin/settings/whatsapp";
const ACCOUNTS_PAGE: string = "https://oneuptime.example/accounts/forms/abc";
const STATUS_PAGE: string =
  "https://oneuptime.example/status-page/2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d/incidents/1";
const PUBLIC_DASHBOARD_PAGE: string =
  "https://oneuptime.example/public-dashboard/2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
// A status page on a custom domain is served at the domain's root.
const CUSTOM_DOMAIN_STATUS_PAGE: string = "https://status.acme.example/";

const opensIn: (href: string | null | undefined, page: string) => string = (
  href: string | null | undefined,
  page: string,
): string => {
  return getMarkdownLinkBehavior(href, page).opensInNewTab
    ? "new tab"
    : "same tab";
};

describe("a link to another site opens in a new tab", () => {
  test.each([
    [
      "a Slack file saved with a note",
      "https://acme.slack.com/files/U1/F1/image.png",
    ],
    ["a web page", "https://www.example.com/runbook"],
    ["a plain http page", "http://intranet.example/wiki"],
    [
      "an address that only differs by port",
      "https://oneuptime.example:8443/dashboard/x",
    ],
    [
      "an address that only differs by scheme",
      "http://oneuptime.example/dashboard/x",
    ],
    [
      "a subdomain of the same site",
      "https://docs.oneuptime.example/dashboard/x",
    ],
    ["a protocol-relative address", "//evil.example/path"],
    ["an upper-case scheme", "HTTPS://www.example.com/"],
  ])("%s", (_name: string, href: string) => {
    for (const page of [
      DASHBOARD_PAGE,
      ADMIN_PAGE,
      ACCOUNTS_PAGE,
      STATUS_PAGE,
      PUBLIC_DASHBOARD_PAGE,
      CUSTOM_DOMAIN_STATUS_PAGE,
    ]) {
      expect(opensIn(href, page)).toBe("new tab");
    }
  });

  test("and says where it goes, made absolute", () => {
    expect(
      getMarkdownLinkBehavior("//evil.example/path", DASHBOARD_PAGE),
    ).toEqual({
      opensInNewTab: true,
      needsSignedInSession: false,
      absoluteUrl: "https://evil.example/path",
      inAppPath: null,
    });
  });

  test("with no page to compare with (a server render), an absolute link still opens in a new tab", () => {
    expect(opensIn("https://www.example.com/", "")).toBe("new tab");
  });
});

describe("a link into the app the reader is in stays in the tab", () => {
  test.each([
    [
      "an incident a feed entry names, written absolute",
      "https://oneuptime.example/dashboard/5f1c0b5e-7a4e-4d8e-9f61-0c2f1b0a7d11/incidents/1",
    ],
    ["a path from the root", "/dashboard/5f1c0b5e/monitors"],
    ["a path relative to the page", "../monitors"],
    ["a path relative to the page, bare", "monitors"],
    ["a query on this page", "?tab=feed"],
    ["a section of this page", "#root-cause"],
    ["the page itself", DASHBOARD_PAGE],
  ])("%s", (_name: string, href: string) => {
    expect(opensIn(href, DASHBOARD_PAGE)).toBe("same tab");
  });

  test("on every app, a link under its own route", () => {
    expect(opensIn("/admin/users", ADMIN_PAGE)).toBe("same tab");
    expect(opensIn("/accounts/login", ACCOUNTS_PAGE)).toBe("same tab");
    expect(
      opensIn(
        "/status-page/2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d/announcements",
        STATUS_PAGE,
      ),
    ).toBe("same tab");
    expect(
      opensIn("/public-dashboard/another-dashboard", PUBLIC_DASHBOARD_PAGE),
    ).toBe("same tab");
  });

  test("a status page on its own domain: every page of the domain is its own", () => {
    expect(opensIn("/incidents/42", CUSTOM_DOMAIN_STATUS_PAGE)).toBe(
      "same tab",
    );
    expect(opensIn("/scheduled-events", CUSTOM_DOMAIN_STATUS_PAGE)).toBe(
      "same tab",
    );
    expect(
      opensIn(
        "https://status.acme.example/announcements/1",
        CUSTOM_DOMAIN_STATUS_PAGE,
      ),
    ).toBe("same tab");
  });

  test("a relative link with no page to read it against stays", () => {
    expect(opensIn("/dashboard/x", "")).toBe("same tab");
    expect(opensIn("#top", "")).toBe("same tab");
  });

  test("and keeps its absolute address, to open inside the app", () => {
    expect(getMarkdownLinkBehavior("../monitors", DASHBOARD_PAGE)).toEqual({
      opensInNewTab: false,
      needsSignedInSession: false,
      absoluteUrl:
        "https://oneuptime.example/dashboard/5f1c0b5e-7a4e-4d8e-9f61-0c2f1b0a7d11/monitors",
      inAppPath: "/dashboard/5f1c0b5e-7a4e-4d8e-9f61-0c2f1b0a7d11/monitors",
    });
  });
});

/*
 * A link that stays in the tab and goes to another page of the same app
 * opens inside the app (inAppPath) instead of loading the whole app again;
 * another project, status page or public dashboard is loaded in full, and a
 * section of the page it is on is left to the browser.
 */
const inAppPathOf: (href: string, page: string) => string | null = (
  href: string,
  page: string,
): string | null => {
  return getMarkdownLinkBehavior(href, page).inAppPath;
};

describe("a link to another page of the same app opens inside the app", () => {
  const PROJECT: string = "5f1c0b5e-7a4e-4d8e-9f61-0c2f1b0a7d11";

  test.each([
    [
      "an incident of the same project, written absolute",
      "https://oneuptime.example/dashboard/" + PROJECT + "/incidents/1",
      "/dashboard/" + PROJECT + "/incidents/1",
    ],
    [
      "a path from the root",
      "/dashboard/" + PROJECT + "/monitors?page=2#top",
      "/dashboard/" + PROJECT + "/monitors?page=2#top",
    ],
    [
      "a path relative to the page",
      "../monitors",
      "/dashboard/" + PROJECT + "/monitors",
    ],
    [
      "a query on this page",
      "?tab=feed",
      "/dashboard/" +
        PROJECT +
        "/incidents/9a3c0f6e-2b1d-4c5e-8f7a-1d2e3f4a5b6c?tab=feed",
    ],
    [
      "the project's id in another case",
      "/dashboard/" + PROJECT.toUpperCase() + "/alerts",
      "/dashboard/" + PROJECT.toUpperCase() + "/alerts",
    ],
  ])("%s", (_name: string, href: string, path: string) => {
    expect(inAppPathOf(href, DASHBOARD_PAGE)).toBe(path);
  });

  test.each([
    [
      "another project: loaded in full, as switching projects is",
      "/dashboard/0b0b0b0b-0000-4000-8000-000000000000/incidents/1",
    ],
    ["a page of the Dashboard outside a project", "/dashboard/welcome"],
    ["a section of this page: the browser scrolls to it", "#root-cause"],
    ["the page itself", DASHBOARD_PAGE],
    ["the page itself, with a section", DASHBOARD_PAGE + "#notes"],
    ["an email address", "mailto:oncall@example.com"],
    ["another site", "https://example.com/dashboard/" + PROJECT],
    ["the docs", "/docs/incidents"],
    ["an attachment", "/api/incident-internal-note/attachment/a/b/c"],
  ])("never %s", (_name: string, href: string) => {
    expect(inAppPathOf(href, DASHBOARD_PAGE)).toBeNull();
  });

  test("a status page: its own pages, never another status page's", () => {
    expect(
      inAppPathOf(
        "/status-page/2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d/announcements",
        STATUS_PAGE,
      ),
    ).toBe("/status-page/2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d/announcements");
    expect(
      inAppPathOf(
        "/status-page/7e7e7e7e-0000-4000-8000-000000000000/announcements",
        STATUS_PAGE,
      ),
    ).toBeNull();
  });

  test("a status page on its own domain: any page of the domain", () => {
    expect(inAppPathOf("/incidents/42", CUSTOM_DOMAIN_STATUS_PAGE)).toBe(
      "/incidents/42",
    );
    expect(
      inAppPathOf(
        "https://status.acme.example/announcements/1",
        CUSTOM_DOMAIN_STATUS_PAGE,
      ),
    ).toBe("/announcements/1");
  });

  test("a public dashboard: its own pages, never another dashboard's", () => {
    expect(
      inAppPathOf(PUBLIC_DASHBOARD_PAGE + "?time=24h", PUBLIC_DASHBOARD_PAGE),
    ).toBe("/public-dashboard/2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d?time=24h");
    expect(
      inAppPathOf("/public-dashboard/another-dashboard", PUBLIC_DASHBOARD_PAGE),
    ).toBeNull();
  });

  test("the Admin Dashboard and Accounts: any of their pages", () => {
    expect(inAppPathOf("/admin/users", ADMIN_PAGE)).toBe("/admin/users");
    expect(inAppPathOf("/accounts/login", ACCOUNTS_PAGE)).toBe(
      "/accounts/login",
    );
  });

  test("no page to read it against: the browser loads it", () => {
    expect(inAppPathOf("/dashboard/" + PROJECT + "/monitors", "")).toBeNull();
  });
});

describe("another part of OneUptime on the same host opens in a new tab", () => {
  test.each([
    [
      "the docs, from a setup guide",
      "/docs/telemetry/host-otel-collector",
      DASHBOARD_PAGE,
    ],
    ["the API reference", "/reference/incident", DASHBOARD_PAGE],
    ["a public status page", "/status-page/2a1b3c4d/incidents", DASHBOARD_PAGE],
    ["the Accounts pages", "/accounts/login", DASHBOARD_PAGE],
    ["the Admin Dashboard", "/admin/settings", DASHBOARD_PAGE],
    [
      "the Dashboard, from a status page",
      "/dashboard/x/incidents/1",
      STATUS_PAGE,
    ],
    [
      "the docs, from the Admin Dashboard",
      "/docs/self-hosted/whatsapp",
      ADMIN_PAGE,
    ],
    ["a short link", "/l/abc123", DASHBOARD_PAGE],
    ["the site's home page", "/", DASHBOARD_PAGE],
  ])("%s", (_name: string, href: string, page: string) => {
    expect(opensIn(href, page)).toBe("new tab");
  });

  test("a route is read by its whole first segment, not as a prefix", () => {
    // "/status-page-api" is not "/status-page", nor "/dashboards" "/dashboard".
    expect(opensIn("/status-page-api/x", STATUS_PAGE)).toBe("new tab");
    expect(opensIn("/dashboards/x", DASHBOARD_PAGE)).toBe("new tab");
    expect(opensIn("/Dashboard/x", DASHBOARD_PAGE)).toBe("new tab");
  });
});

describe("an attachment or another file opens in a new tab", () => {
  test.each([
    [
      "a note's attachment, as the feed links it",
      "/api/incident-internal-note/attachment/5f1c0b5e/9a3c0f6e/0c2f1b0a",
    ],
    [
      "an attachment written absolute",
      "https://oneuptime.example/api/alert-internal-note/attachment/p/n/f",
    ],
    ["a file", "/file/2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"],
    [
      "a status page's attachment",
      "/status-page-api/incident-public-note/attachment/s/i/n/f",
    ],
    ["a public dashboard's data", "/public-dashboard-api/x"],
  ])("%s", (_name: string, href: string) => {
    for (const page of [
      DASHBOARD_PAGE,
      ADMIN_PAGE,
      STATUS_PAGE,
      CUSTOM_DOMAIN_STATUS_PAGE,
    ]) {
      expect(opensIn(href, page)).toBe("new tab");
    }
  });

  test("an App API route opened from the Dashboard or the Admin Dashboard refreshes the session first", () => {
    const attachment: string =
      "/api/incident-internal-note/attachment/5f1c0b5e/9a3c0f6e/0c2f1b0a";

    expect(getMarkdownLinkBehavior(attachment, DASHBOARD_PAGE)).toEqual({
      opensInNewTab: true,
      needsSignedInSession: true,
      absoluteUrl: `https://oneuptime.example${attachment}`,
      inAppPath: null,
    });
    expect(
      getMarkdownLinkBehavior(attachment, ADMIN_PAGE).needsSignedInSession,
    ).toBe(true);
  });

  test("anywhere else - a status page, Accounts - it opens as it is: their session is not the Dashboard's", () => {
    const attachment: string = "/api/incident-internal-note/attachment/p/n/f";

    for (const page of [
      STATUS_PAGE,
      CUSTOM_DOMAIN_STATUS_PAGE,
      ACCOUNTS_PAGE,
      PUBLIC_DASHBOARD_PAGE,
    ]) {
      expect(getMarkdownLinkBehavior(attachment, page)).toEqual({
        opensInNewTab: true,
        needsSignedInSession: false,
        absoluteUrl: new URL(attachment, page).href,
        inAppPath: null,
      });
    }
  });

  test("only the App API needs the session: a file, another API or another site does not", () => {
    for (const href of [
      "/file/x",
      "/status-page-api/x",
      "https://elsewhere.example/api/x",
    ]) {
      expect(
        getMarkdownLinkBehavior(href, DASHBOARD_PAGE).needsSignedInSession,
      ).toBe(false);
    }
  });
});

describe("what a browser hands to another program stays as it is", () => {
  test.each([
    ["an email address", "mailto:oncall@acme.example"],
    ["a phone number", "tel:+15551234567"],
    ["a chat address", "xmpp:ops@acme.example"],
    ["an IRC channel", "irc://irc.libera.chat/oneuptime"],
    ["a secure IRC channel", "ircs://irc.libera.chat/oneuptime"],
  ])("%s", (_name: string, href: string) => {
    expect(getMarkdownLinkBehavior(href, DASHBOARD_PAGE)).toEqual({
      opensInNewTab: false,
      needsSignedInSession: false,
      absoluteUrl: null,
      inAppPath: null,
    });
  });
});

describe("nothing to open", () => {
  test.each([
    ["no address", undefined],
    ["a null address", null],
    // What the viewer's URL check leaves of an address it refuses (javascript:).
    ["an empty address", ""],
    ["blank", "   "],
  ])(
    "%s stays in the tab, with no target",
    (_name: string, href: string | null | undefined) => {
      expect(getMarkdownLinkBehavior(href, DASHBOARD_PAGE)).toEqual({
        opensInNewTab: false,
        needsSignedInSession: false,
        absoluteUrl: null,
        inAppPath: null,
      });
    },
  );

  test("an address that runs script is never sent to a new tab", () => {
    expect(opensIn("javascript:alert(1)", DASHBOARD_PAGE)).toBe("same tab");
    expect(opensIn("data:text/html,<b>x</b>", DASHBOARD_PAGE)).toBe("same tab");
    expect(opensIn("vbscript:x", DASHBOARD_PAGE)).toBe("same tab");
  });

  test("an address no browser can read stays", () => {
    expect(opensIn("https://", DASHBOARD_PAGE)).toBe("same tab");
    expect(opensIn("http://[::1", DASHBOARD_PAGE)).toBe("same tab");
  });

  test("an unreadable page address is read as no page", () => {
    expect(opensIn("https://www.example.com/", "not a url")).toBe("new tab");
    expect(opensIn("/dashboard/x", "not a url")).toBe("same tab");
  });
});

describe("the page the viewer is drawn on", () => {
  test("is the window's address", () => {
    window.history.pushState({}, "", "/dashboard/project/incidents/1");

    expect(getCurrentPageUrl()).toBe(
      `${window.location.origin}/dashboard/project/incidents/1`,
    );

    window.history.pushState({}, "", "/");
  });

  test("reads in time that grows with the address, on a hundred thousand characters", () => {
    const href: string = `https://example.com/${"a/".repeat(100000)}?q=${"%".repeat(100000)}`;
    const started: number = Date.now();
    const behavior: MarkdownLinkBehavior = getMarkdownLinkBehavior(
      href,
      DASHBOARD_PAGE,
    );

    expect(behavior.opensInNewTab).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
