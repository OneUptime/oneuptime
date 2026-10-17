import PageMap from "../../FeatureSet/StatusPage/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../FeatureSet/StatusPage/src/Utils/RouteMap";
import {
  getManageLinkRequestPage,
  ManageLinkChannels,
} from "../../FeatureSet/StatusPage/src/Pages/Subscribe/ManageLinkRequestPage";
import StatusPageSubscriberUnsubscribe from "Common/Types/StatusPage/StatusPageSubscriberUnsubscribe";
import SensitiveUrlToken from "Common/UI/Utils/SensitiveUrlToken";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * How the subscriber's manage page (Update Subscription) is wired into the
 * status page app.
 *
 * Its link is {statusPageUrl}/update-subscription/{subscriberId}-{token}:
 * the same credential the unsubscribe link carries, which the page's routes
 * ask for. The credential leaves the address bar before any tag the page
 * loads can report it (SensitiveUrlToken), so both forms of the route reach
 * the page, live and in preview, and the page reads the credential from the
 * session - which is also how the unsubscribe page's "manage instead" link
 * hands it over, to the token-free route. Never from the route, and never
 * the subscriber id alone: that is no secret.
 */

const STATUS_PAGE_SRC: string = path.join(
  __dirname,
  "../../FeatureSet/StatusPage/src",
);

const SUBSCRIBER_ID: string = "22222222-2222-4222-8222-222222222222";
const TOKEN: string = "ab".repeat(32);

function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(STATUS_PAGE_SRC, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\}/g, "{}")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
}

describe("the manage page's route", () => {
  test("is the route the link builder produces, its last segment the credential", () => {
    expect(RouteMap[PageMap.UPDATE_SUBSCRIPTION]!.toString()).toBe(
      `/${StatusPageSubscriberUnsubscribe.MANAGE_PAGE_ROUTE_SEGMENT}/:token`,
    );
    expect(RouteMap[PageMap.PREVIEW_UPDATE_SUBSCRIPTION]!.toString()).toBe(
      `/status-page/:statusPageId/${StatusPageSubscriberUnsubscribe.MANAGE_PAGE_ROUTE_SEGMENT}/:token`,
    );

    const link: string =
      StatusPageSubscriberUnsubscribe.buildManageSubscriptionLink({
        statusPageUrl:
          "https://oneuptime.com/status-page/11111111-1111-4111-8111-111111111111",
        subscriberId: SUBSCRIBER_ID,
        unsubscribeToken: TOKEN,
      }).toString();

    expect(new URL(link).pathname).toBe(
      `/status-page/11111111-1111-4111-8111-111111111111/update-subscription/${SUBSCRIBER_ID}-${TOKEN}`,
    );
  });

  test("the token-free form is the route without its credential", () => {
    expect(
      RouteUtil.tokenFreeRoute(
        RouteMap[PageMap.UPDATE_SUBSCRIPTION]!.toString(),
      ),
    ).toBe("/update-subscription");
    expect(
      RouteUtil.tokenFreeRoute(
        RouteMap[PageMap.PREVIEW_UPDATE_SUBSCRIPTION]!.toString(),
      ),
    ).toBe("/status-page/:statusPageId/update-subscription");
    // A route with no credential is left as it is.
    expect(
      RouteUtil.tokenFreeRoute(RouteMap[PageMap.SUBSCRIBE_EMAIL]!.toString()),
    ).toBe("/subscribe/email");
  });

  test("the link's credential is what SensitiveUrlToken takes out of the address bar", () => {
    const credential: string = StatusPageSubscriberUnsubscribe.buildCredential({
      subscriberId: SUBSCRIBER_ID,
      unsubscribeToken: TOKEN,
    });

    expect(
      SensitiveUrlToken.readFromPath(`/update-subscription/${credential}`),
    ).toBe(credential);
    expect(
      SensitiveUrlToken.readFromPath(
        `/status-page/11111111-1111-4111-8111-111111111111/update-subscription/${credential}`,
      ),
    ).toBe(credential);
    expect(SensitiveUrlToken.readFromPath("/update-subscription")).toBe("");
  });

  test("both the credential and the token-free form reach the page, live and in preview", () => {
    const app: string = readCode("App.tsx");

    for (const page of ["UPDATE_SUBSCRIPTION", "PREVIEW_UPDATE_SUBSCRIPTION"]) {
      expect(app).toContain(
        `path={tokenFreeRoute( RouteMap[PageMap.${page}]?.toString() || "", )} element={ <UpdateSubscription`,
      );
    }

    expect(app).toContain(
      `path={RouteMap[PageMap.UPDATE_SUBSCRIPTION]?.toString() || ""} element={ <UpdateSubscription`,
    );
    expect(app).toContain(
      `path={ RouteMap[PageMap.PREVIEW_UPDATE_SUBSCRIPTION]?.toString() || "" } element={ <UpdateSubscription`,
    );

    // Four routes, one page.
    expect(app.split("<UpdateSubscription ").length - 1).toBe(4);
  });
});

describe("the manage page", () => {
  const page: string = readCode("Pages/Subscribe/UpdateSubscription.tsx");

  test("reads the link's credential from the session, never from the route", () => {
    expect(page).toContain("SensitiveUrlToken.read()");
    expect(page).toContain("StatusPageSubscriberUnsubscribe.parseCredential(");
    expect(page).not.toContain("getLastParamAsObjectID");
    expect(page).not.toContain("Navigation.getParams");
  });

  test("loads and saves the subscription only through the routes that take the token", () => {
    // ".../{statusPageId}/{subscriberId}/{token}", built from the credential.
    expect(page).toContain(
      "`/${statusPageId.toString()}/${credential.subscriberId}/${credential.token}`",
    );
    expect(page).toContain("`/update-subscription${credentialRoute}`");
    expect(page).toContain("`/get-subscription${credentialRoute}`");
    expect(page).toContain(
      "`/${StatusPageSubscriberUnsubscribe.PAGE_ROUTE_SEGMENT}${credentialRoute}`",
    );
  });

  test("still sends a private page's reader to sign in", () => {
    expect(page).toContain("StatusPageUtil.checkIfUserHasLoggedIn();");
  });

  test("the unsubscribe page hands the credential over through the token-free route", () => {
    const unsubscribe: string = readCode("Pages/Subscribe/Unsubscribe.tsx");

    expect(unsubscribe).toContain("RouteUtil.tokenFreeRoute(");
    // Never a manage link that names the subscriber.
    expect(unsubscribe).not.toContain("new ObjectID(credential.subscriberId)");
  });
});

/*
 * The manage page works with the subscription's credential, so - like the
 * unsubscribe and sign-in pages - none of the status page's custom code runs
 * beside it: custom JavaScript runs only from the pages that call their
 * onLoadComplete, and custom header and footer HTML (which can run script)
 * is not shown on it. Leaving it for a page that runs custom code lets go of
 * the credential first. (StatusPageCustomizations.test.ts holds the rules
 * themselves.)
 */
describe("none of the status page's custom code runs beside the manage page's credential", () => {
  test("the manage page never asks for the page's custom JavaScript", () => {
    const page: string = readCode("Pages/Subscribe/UpdateSubscription.tsx");

    expect(page).not.toContain("onLoadComplete(");
    expect(page).not.toContain("executeStatusPageCustomJavaScript");
  });

  test("the master page shows custom header and footer HTML only where the rule allows, and lets go of the credential first", () => {
    const masterPage: string = readCode("Components/MasterPage/MasterPage.tsx");

    expect(masterPage).toContain(
      "const canRenderCustomHtml: boolean = canRenderStatusPageCustomHtml({",
    );
    expect(masterPage).toContain(
      "pathname: Navigation.getCurrentRoute().toString(),",
    );
    expect(masterPage).toContain("{!canRenderCustomHtml || !headerHtml ? (");
    expect(masterPage).toContain("{!canRenderCustomHtml || !footerHtml ? (");
    expect(masterPage).not.toContain(
      "{!canRenderCustomizations || !headerHtml ? (",
    );
    expect(masterPage).not.toContain(
      "{!canRenderCustomizations || !footerHtml ? (",
    );

    // Before the HTML can run anything: a layout effect, in the render's own task.
    expect(masterPage).toContain(
      "useLayoutEffect(() => { if (showsCustomHtml) { releaseCredentialsBeforeCustomCode(); } }, [showsCustomHtml]);",
    );
    expect(masterPage).toContain(
      "const showsCustomHtml: boolean = !isShownOnItsOwn && canRenderCustomHtml && Boolean(headerHtml || footerHtml);",
    );
  });

  test("the custom JavaScript runs only through the executor that lets go of the credential first", () => {
    const app: string = readCode("App.tsx");
    const customizations: string = readCode(
      "Utils/StatusPageCustomizations.ts",
    );

    expect(app).toContain("executeStatusPageCustomJavaScript(javascript,");
    expect(customizations).toContain(
      "releaseCredentialsBeforeCustomCode(); new Function(permittedJavaScript)();",
    );
  });

  test("both forms of the manage page's route are credential routes, on a custom domain and on the page's own address", () => {
    for (const route of [
      RouteMap[PageMap.UPDATE_SUBSCRIPTION]!.toString(),
      RouteUtil.tokenFreeRoute(
        RouteMap[PageMap.UPDATE_SUBSCRIPTION]!.toString(),
      ),
      `/update-subscription/${SUBSCRIBER_ID}-${TOKEN}`,
      `/status-page/11111111-1111-4111-8111-111111111111/update-subscription/${SUBSCRIBER_ID}-${TOKEN}`,
      "/status-page/11111111-1111-4111-8111-111111111111/update-subscription",
    ]) {
      expect([route, SensitiveUrlToken.isTokenRoute(route)]).toEqual([
        route,
        true,
      ]);
    }
  });
});

describe("where a visitor asks for a new manage link", () => {
  const NONE: ManageLinkChannels = {
    enableEmailSubscribers: false,
    enableSMSSubscribers: false,
    enableSlackSubscribers: false,
    enableMicrosoftTeamsSubscribers: false,
  };

  test.each([
    [
      "every channel",
      {
        enableEmailSubscribers: true,
        enableSMSSubscribers: true,
        enableSlackSubscribers: true,
        enableMicrosoftTeamsSubscribers: true,
      },
      PageMap.SUBSCRIBE_EMAIL,
      PageMap.PREVIEW_SUBSCRIBE_EMAIL,
    ],
    [
      "SMS and Slack",
      { ...NONE, enableSMSSubscribers: true, enableSlackSubscribers: true },
      PageMap.SUBSCRIBE_SMS,
      PageMap.PREVIEW_SUBSCRIBE_SMS,
    ],
    [
      "Slack alone",
      { ...NONE, enableSlackSubscribers: true },
      PageMap.SUBSCRIBE_SLACK,
      PageMap.PREVIEW_SUBSCRIBE_SLACK,
    ],
    [
      "Microsoft Teams alone",
      { ...NONE, enableMicrosoftTeamsSubscribers: true },
      PageMap.SUBSCRIBE_MICROSOFT_TEAMS,
      PageMap.PREVIEW_SUBSCRIBE_MICROSOFT_TEAMS,
    ],
  ])(
    "a page that offers %s: the first such channel's Subscribe page, live and in preview",
    (
      _label: string,
      channels: ManageLinkChannels,
      live: PageMap,
      preview: PageMap,
    ) => {
      expect(
        getManageLinkRequestPage({ channels: channels, isPreview: false }),
      ).toBe(live);
      expect(
        getManageLinkRequestPage({ channels: channels, isPreview: true }),
      ).toBe(preview);
    },
  );

  test("a page that offers no channel with a Manage Existing Subscription tab has none", () => {
    expect(
      getManageLinkRequestPage({ channels: NONE, isPreview: false }),
    ).toBeNull();
  });

  test("each page it names has the Manage Existing Subscription tab that sends the link", () => {
    for (const file of [
      "EmailSubscribe.tsx",
      "SmsSubscribe.tsx",
      "SlackSubscribe.tsx",
      "MicrosoftTeamsSubscribe.tsx",
    ]) {
      const source: string = readCode(`Pages/Subscribe/${file}`);

      expect([file, source.includes("/manage-subscription/")]).toEqual([
        file,
        true,
      ]);
      expect([file, source.includes('t("subscribe.manageExisting")')]).toEqual([
        file,
        true,
      ]);
    }

    // Webhooks have no such tab: no page sends a visitor there for a link.
    expect(
      readCode("Pages/Subscribe/WebhookSubscribe.tsx").includes(
        "/manage-subscription/",
      ),
    ).toBe(false);
  });
});
