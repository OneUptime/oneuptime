import PageMap from "../../FeatureSet/StatusPage/src/Utils/PageMap";
import RouteMap from "../../FeatureSet/StatusPage/src/Utils/RouteMap";
import StatusPageSubscriberUnsubscribe from "Common/Types/StatusPage/StatusPageSubscriberUnsubscribe";
import SensitiveUrlToken from "Common/UI/Utils/SensitiveUrlToken";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * How the unsubscribe page is wired into the status page app.
 *
 * Every notification links to {statusPageUrl}/unsubscribe/{id}-{token}. That
 * URL is a custom domain's /unsubscribe/... or the page's own
 * /status-page/{statusPageId}/unsubscribe/..., and by the time the router
 * runs SensitiveUrlToken has usually taken the credential out of the address
 * bar - so both forms of both routes must reach the page. And because the
 * page is for readers of private status pages who cannot sign in, it is not
 * an ordinary page: it is shown on its own (no navigation into the page's
 * content), never redirects to sign-in, and runs none of the page's custom
 * JavaScript.
 */

const STATUS_PAGE_SRC: string = path.join(
  __dirname,
  "../../FeatureSet/StatusPage/src",
);

function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(STATUS_PAGE_SRC, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\}/g, "{}")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
}

describe("the status page's unsubscribe route", () => {
  test("is the route the link builder produces, on a custom domain and on the page's own address", () => {
    expect(RouteMap[PageMap.UNSUBSCRIBE]!.toString()).toBe(
      `/${StatusPageSubscriberUnsubscribe.PAGE_ROUTE_SEGMENT}/:token`,
    );
    expect(RouteMap[PageMap.PREVIEW_UNSUBSCRIBE]!.toString()).toBe(
      `/status-page/:statusPageId/${StatusPageSubscriberUnsubscribe.PAGE_ROUTE_SEGMENT}/:token`,
    );

    const link: string = StatusPageSubscriberUnsubscribe.buildLink({
      statusPageUrl:
        "https://oneuptime.com/status-page/11111111-1111-4111-8111-111111111111",
      subscriberId: "22222222-2222-4222-8222-222222222222",
      unsubscribeToken: "ab".repeat(32),
    }).toString();

    expect(new URL(link).pathname).toMatch(
      /^\/status-page\/[^/]+\/unsubscribe\/[^/]+$/,
    );
  });

  test("the link's credential is what SensitiveUrlToken takes out of the address bar", () => {
    const credential: string = StatusPageSubscriberUnsubscribe.buildCredential({
      subscriberId: "22222222-2222-4222-8222-222222222222",
      unsubscribeToken: "ab".repeat(32),
    });

    expect(SensitiveUrlToken.readFromPath(`/unsubscribe/${credential}`)).toBe(
      credential,
    );
    expect(
      SensitiveUrlToken.readFromPath(
        `/status-page/11111111-1111-4111-8111-111111111111/unsubscribe/${credential}`,
      ),
    ).toBe(credential);
    // The cleaned form carries nothing.
    expect(SensitiveUrlToken.readFromPath("/unsubscribe")).toBe("");
  });

  test("both the credential and the token-free form reach the page, live and in preview", () => {
    const app: string = readCode("App.tsx");

    for (const page of ["UNSUBSCRIBE", "PREVIEW_UNSUBSCRIBE"]) {
      expect(app).toContain(
        `path={tokenFreeRoute( RouteMap[PageMap.${page}]?.toString() || "", )} element={ <Unsubscribe`,
      );
      expect(app).toContain(
        `path={RouteMap[PageMap.${page}]?.toString() || ""} element={ <Unsubscribe`,
      );
    }
  });

  test("runs none of the page's custom JavaScript", () => {
    const app: string = readCode("App.tsx");

    const unsubscribeElements: Array<string> = app
      .split("<Unsubscribe ")
      .slice(1)
      .map((rest: string): string => {
        return rest.slice(0, rest.indexOf("/>"));
      });

    expect(unsubscribeElements).toHaveLength(4);

    for (const element of unsubscribeElements) {
      expect(element).not.toContain("onLoadComplete");
    }
  });

  test("is shown on its own, like the sign-in pages", () => {
    const masterPage: string = readCode("Components/MasterPage/MasterPage.tsx");

    expect(masterPage).toContain(
      'Navigation.getCurrentRoute().toString().includes("/unsubscribe")',
    );
  });

  test("never sends the reader to sign in", () => {
    const page: string = readCode("Pages/Subscribe/Unsubscribe.tsx");

    expect(page).not.toContain("checkIfUserHasLoggedIn");
    expect(page).not.toContain("navigateToLoginPage");
    // It reads the credential from the handoff, not from the router.
    expect(page).toContain("SensitiveUrlToken.read()");
  });
});
