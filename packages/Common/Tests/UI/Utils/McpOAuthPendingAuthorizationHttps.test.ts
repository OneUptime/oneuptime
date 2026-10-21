/**
 * @jest-environment-options {"url": "https://oneuptime.example.com/accounts/mcp-authorize"}
 */
import McpOAuthPendingAuthorization from "../../../UI/Utils/McpOAuthPendingAuthorization";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The https half of McpOAuthPendingAuthorization.test.ts.
 *
 * Whether the pending-request cookie is marked Secure depends on the page's
 * own scheme, and jsdom fixes a document's origin for the life of a test file
 * - `window.location` cannot be redefined - so the assertions that need an
 * https page live here, in a file whose environment is given an https URL by
 * the pragma above. Everything else about the cookie is covered next door.
 */

const COOKIE_NAME: string = "oneuptime-mcp-oauth-pending-request";

const CONSENT_PAGE: string = "/accounts/mcp-authorize";
const DASHBOARD_PAGE: string = "/dashboard/project/home";

const SECURE_ATTRIBUTE_PATTERN: RegExp = /;\s*Secure/i;
const SAME_SITE_LAX_PATTERN: RegExp = /;\s*SameSite=Lax/i;
const DASHBOARD_PATH_PATTERN: RegExp = /;\s*Path=\/dashboard(;|$)/i;

const TICKET: string = `v1.${"a".repeat(120)}.${"B".repeat(43)}`;

const cookieDescriptor: PropertyDescriptor = Object.getOwnPropertyDescriptor(
  Document.prototype,
  "cookie",
) as PropertyDescriptor;

let cookieWrites: Array<string> = [];

beforeEach((): void => {
  window.history.replaceState({}, "", CONSENT_PAGE);
  cookieWrites = [];

  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: (): string => {
      return cookieDescriptor.get!.call(document) as string;
    },
    set: (value: string): void => {
      cookieWrites.push(value);
      cookieDescriptor.set!.call(document, value);
    },
  });
});

afterEach((): void => {
  delete (document as unknown as { cookie?: string }).cookie;
  document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/dashboard`;
  window.history.replaceState({}, "", CONSENT_PAGE);
});

describe("McpOAuthPendingAuthorization on an https instance", () => {
  test("the test page really is https (the pragma took effect)", () => {
    expect(window.location.protocol).toBe("https:");
    expect(window.location.origin).toBe("https://oneuptime.example.com");
    expect(window.location.pathname).toBe(CONSENT_PAGE);
  });

  test("the cookie is marked Secure, so it is never sent over plain http", () => {
    expect(McpOAuthPendingAuthorization.remember(TICKET)).toBe(true);

    expect(cookieWrites).toHaveLength(1);
    expect(cookieWrites[0]).toMatch(SECURE_ATTRIBUTE_PATTERN);
    expect(cookieWrites[0]).toMatch(SAME_SITE_LAX_PATTERN);
    expect(cookieWrites[0]).toMatch(DASHBOARD_PATH_PATTERN);
  });

  test("a Secure cookie written by the consent screen is read back, once, by the https dashboard", () => {
    McpOAuthPendingAuthorization.remember(TICKET);

    // Not visible where it was written...
    expect(document.cookie).not.toContain(COOKIE_NAME);
    expect(McpOAuthPendingAuthorization.consumeRoute()).toBeNull();

    // ...and waiting where it will be read.
    window.history.replaceState({}, "", DASHBOARD_PAGE);

    expect(McpOAuthPendingAuthorization.consumeRoute()?.toString()).toBe(
      `/accounts/mcp-authorize?request=${TICKET}`,
    );
    expect(McpOAuthPendingAuthorization.consumeRoute()).toBeNull();
  });
});
