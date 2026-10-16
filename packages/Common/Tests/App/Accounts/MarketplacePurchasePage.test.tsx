import "@testing-library/jest-dom";
import type * as AccountsApiPaths from "../../../../App/FeatureSet/Accounts/src/Utils/ApiPaths";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { SpyInstance } from "jest-mock";
import React from "react";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { DASHBOARD_URL } from "../../../UI/Config";
import API from "../../../UI/Utils/API/API";
import MarketplacePendingPurchase from "../../../UI/Utils/MarketplacePendingPurchase";
import Navigation from "../../../UI/Utils/Navigation";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import {
  MARKETPLACE_PURCHASE_COMPLETE_API_URL,
  MARKETPLACE_PURCHASE_DETAILS_API_URL,
  MARKETPLACE_PURCHASE_DISMISS_API_URL,
} from "../../../../App/FeatureSet/Accounts/src/Utils/ApiPaths";
import MarketplacePurchasePage from "../../../../App/FeatureSet/Accounts/src/Pages/MarketplacePurchase";

/*
 * The page a buyer lands on after buying OneUptime on AWS, Microsoft or
 * Google Cloud Marketplace, rendered for real with the Accounts translations.
 * What is pinned from the outside:
 *
 *  - It never names the purchase in a request it makes: the claim travels in
 *    an HttpOnly cookie scoped to /api/marketplace, so every call it makes
 *    has to be under that path.
 *  - A visitor who is not signed in comes back to it after signing in.
 *  - It sends exactly the choice on screen - a new project with its name and
 *    plan, or one of the buyer's projects - and never offers a project the
 *    server refused.
 *  - It only follows a redirect onto the dashboard.
 *
 * Only the network (API.post) and the final navigation are recorded instead
 * of performed.
 */

const PRODUCTION_ID: string = "11111111-1111-4111-8111-111111111111";
const STAGING_ID: string = "22222222-2222-4222-8222-222222222222";
const RESOLD_ID: string = "33333333-3333-4333-8333-333333333333";

const PENDING_COOKIE: string = "oneuptime-marketplace-purchase-pending";

const GROWTH: JSONObject = {
  planId: "growth_monthly",
  name: "Growth",
  monthlyPricePerUserInUSD: 22,
  isCustomPricing: false,
};
const FREE: JSONObject = {
  planId: "free_monthly",
  name: "Free",
  monthlyPricePerUserInUSD: 0,
  isCustomPricing: false,
};

type DetailsFunction = (overrides?: JSONObject) => JSONObject;

const details: DetailsFunction = (overrides: JSONObject = {}): JSONObject => {
  return {
    marketplace: "Azure",
    marketplaceName: "Microsoft Marketplace",
    status: "Pending",
    buyerId: "t-contoso",
    buyerEmail: "buyer@contoso.com",
    marketplacePlan: "pay-as-you-go",
    isFreeTrial: false,
    linkedProjectId: null,
    signedInEmail: "ada@contoso.com",
    projects: [
      { id: PRODUCTION_ID, name: "Acme Production", isEligible: true },
      {
        id: RESOLD_ID,
        name: "Acme Resold",
        isEligible: false,
        refusal: "bought_from_reseller",
      },
    ] as unknown as JSONObject,
    plans: [FREE, GROWTH] as unknown as JSONObject,
    canCreateProject: true,
    ...overrides,
  };
};

type Answer = () => Promise<HTTPResponse<JSONObject>>;

const ok: (body: JSONObject) => Answer = (body: JSONObject): Answer => {
  return async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(200, body, {});
  };
};

const refused: (statusCode: number, message: string) => Answer = (
  statusCode: number,
  message: string,
): Answer => {
  return async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPErrorResponse(statusCode, { message }, {});
  };
};

interface PostedRequest {
  url: string;
  data: unknown;
}

let posted: Array<PostedRequest> = [];
let answers: { details: Answer; complete: Answer; dismiss: Answer };
let navigatedTo: Array<string> = [];
let consoleErrors: SpyInstance<typeof console.error>;

const say: (key: string, values?: Record<string, string>) => string = (
  key: string,
  values?: Record<string, string>,
): string => {
  return i18n.t(`marketplacePurchase.${key}`, values || {});
};

const requestsTo: (url: { toString: () => string }) => Array<unknown> = (url: {
  toString: () => string;
}): Array<unknown> => {
  return posted
    .filter((request: PostedRequest): boolean => {
      return request.url === url.toString();
    })
    .map((request: PostedRequest): unknown => {
      return request.data;
    });
};

const renderPage: () => Promise<void> = async (): Promise<void> => {
  window.history.pushState({}, "", "/accounts/marketplace");

  await act(async () => {
    render(<MarketplacePurchasePage />);
  });
};

// Whether the dashboard would find a purchase waiting: only it can see the marker.
const isPurchaseRemembered: () => boolean = (): boolean => {
  const pagePath: string = window.location.pathname;
  window.history.pushState({}, "", "/dashboard");

  try {
    return document.cookie.includes(`${PENDING_COOKIE}=`);
  } finally {
    window.history.pushState({}, "", pagePath);
  }
};

const click: (testId: string) => Promise<void> = async (
  testId: string,
): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

const change: (testId: string, value: string) => Promise<void> = async (
  testId: string,
  value: string,
): Promise<void> => {
  await act(async () => {
    fireEvent.change(screen.getByTestId(testId), { target: { value } });
  });
};

const submitButton: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("marketplace-purchase-submit");
};

beforeEach(() => {
  posted = [];
  navigatedTo = [];
  answers = {
    details: ok(details()),
    complete: ok({
      projectId: PRODUCTION_ID,
      redirectUrl: `/dashboard/${PRODUCTION_ID}/settings/billing`,
    }),
    dismiss: ok({}),
  };

  MarketplacePendingPurchase.clear();
  consoleErrors = jest.spyOn(console, "error");

  jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((to: { toString: () => string }): void => {
      navigatedTo.push(to.toString());
    });

  jest
    .spyOn(API, "post")
    .mockImplementation(
      async (
        options: Parameters<typeof API.post>[0],
      ): Promise<HTTPResponse<JSONObject>> => {
        const url: string = options.url.toString();

        posted.push({ url, data: options.data });

        if (url === MARKETPLACE_PURCHASE_DETAILS_API_URL.toString()) {
          return answers.details();
        }

        if (url === MARKETPLACE_PURCHASE_COMPLETE_API_URL.toString()) {
          return answers.complete();
        }

        if (url === MARKETPLACE_PURCHASE_DISMISS_API_URL.toString()) {
          return answers.dismiss();
        }

        throw new Error(`Unexpected request to ${url}`);
      },
    );
});

afterEach(() => {
  cleanup();

  const reportedErrors: Array<string> = consoleErrors.mock.calls
    .map((call: Array<unknown>): string => {
      return call.map(String).join(" ");
    })
    .filter((message: string): boolean => {
      return !message.includes("`ReactDOMTestUtils.act` is deprecated");
    });

  jest.restoreAllMocks();
  MarketplacePendingPurchase.clear();
  window.history.pushState({}, "", "/");

  // React warnings (bad keys, nested labels, uncontrolled inputs) are failures here.
  expect(reportedErrors).toEqual([]);
});

describe("the purchase page's API addresses", () => {
  test("are under /api/marketplace, the only path the claim cookie is sent to", () => {
    // Loaded as on a real server: the test environment has no HOST of its own.
    const originalHost: string | undefined = process.env["HOST"];
    const originalProtocol: string | undefined = process.env["HTTP_PROTOCOL"];

    process.env["HOST"] = "oneuptime.example.com";
    process.env["HTTP_PROTOCOL"] = "https";

    try {
      jest.isolateModules(() => {
        const paths: typeof AccountsApiPaths = jest.requireActual(
          "../../../../App/FeatureSet/Accounts/src/Utils/ApiPaths",
        ) as typeof AccountsApiPaths;

        for (const [url, path] of [
          [
            paths.MARKETPLACE_PURCHASE_DETAILS_API_URL,
            "/api/marketplace/purchase/details",
          ],
          [
            paths.MARKETPLACE_PURCHASE_COMPLETE_API_URL,
            "/api/marketplace/purchase/complete",
          ],
          [
            paths.MARKETPLACE_PURCHASE_DISMISS_API_URL,
            "/api/marketplace/purchase/dismiss",
          ],
        ] as Array<[{ toString: () => string }, string]>) {
          const parsed: globalThis.URL = new globalThis.URL(url.toString());

          expect(parsed.origin).toBe("https://oneuptime.example.com");
          expect(parsed.pathname).toBe(path);
          expect(parsed.search).toBe("");
        }
      });
    } finally {
      if (originalHost === undefined) {
        delete process.env["HOST"];
      } else {
        process.env["HOST"] = originalHost;
      }

      if (originalProtocol === undefined) {
        delete process.env["HTTP_PROTOCOL"];
      } else {
        process.env["HTTP_PROTOCOL"] = originalProtocol;
      }
    }
  });

  test("the wording really is loaded", () => {
    expect(say("title")).not.toBe("marketplacePurchase.title");
    expect(say("subtitle", { marketplace: "AWS Marketplace" })).toContain(
      "AWS Marketplace",
    );
  });
});

describe("arriving", () => {
  test("asks the server about the purchase without naming it, and shows what it says", async () => {
    await renderPage();

    expect(requestsTo(MARKETPLACE_PURCHASE_DETAILS_API_URL)).toEqual([{}]);

    expect(
      screen.getByTestId("marketplace-purchase-subtitle"),
    ).toHaveTextContent(
      say("subtitle", { marketplace: "Microsoft Marketplace" }),
    );

    const summary: HTMLElement = screen.getByTestId(
      "marketplace-purchase-summary",
    );
    expect(summary).toHaveTextContent("Microsoft Marketplace");
    expect(summary).toHaveTextContent("buyer@contoso.com");
    expect(summary).toHaveTextContent("pay-as-you-go");
    expect(
      screen.getByTestId("marketplace-purchase-signed-in-as"),
    ).toHaveTextContent(say("signedInAs", { email: "ada@contoso.com" }));

    // Loaded for a signed-in buyer: nothing is left for the dashboard to resume.
    expect(isPurchaseRemembered()).toBe(false);
  });

  test("leaves a marker for the dashboard when the visitor has to sign in first", async () => {
    answers.details = refused(401, "Please sign in.");

    await renderPage();

    expect(isPurchaseRemembered()).toBe(true);
    expect(screen.queryByTestId("marketplace-purchase-message")).toBeNull();
  });

  test("shows the server's reason when the purchase cannot be set up here", async () => {
    answers.details = refused(
      400,
      "This purchase link has expired. Open OneUptime from the marketplace again.",
    );

    await renderPage();

    const message: HTMLElement = screen.getByTestId(
      "marketplace-purchase-message",
    );
    expect(message).toHaveTextContent(say("errorTitle"));
    expect(message).toHaveTextContent("This purchase link has expired");
    expect(isPurchaseRemembered()).toBe(false);

    await click("marketplace-purchase-go-to-dashboard");
    expect(navigatedTo).toEqual([DASHBOARD_URL.toString()]);
  });

  test("says so when the answer is not one it can read", async () => {
    answers.details = ok({ marketplace: "SomewhereElse" });

    await renderPage();

    expect(
      screen.getByTestId("marketplace-purchase-message"),
    ).toHaveTextContent(say("errorHelp"));
  });
});

describe("a new project", () => {
  test("starts on a new project, on the first paid plan, and needs a name", async () => {
    await renderPage();

    expect(screen.getByTestId("marketplace-purchase-choice-new")).toBeChecked();
    expect(
      (screen.getByTestId("marketplace-purchase-plan") as HTMLSelectElement)
        .value,
    ).toBe("growth_monthly");
    expect(
      Array.from(
        (screen.getByTestId("marketplace-purchase-plan") as HTMLSelectElement)
          .options,
      ).map((option: HTMLOptionElement): string => {
        return option.textContent || "";
      }),
    ).toEqual([
      say("planOptionFree", { name: "Free" }),
      say("planOption", { name: "Growth", price: "$22" }),
    ]);

    expect(submitButton()).toBeDisabled();

    await change("marketplace-purchase-project-name", "   ");
    expect(submitButton()).toBeDisabled();

    await change("marketplace-purchase-project-name", "Acme Cloud");
    expect(submitButton()).toBeEnabled();
  });

  test("sends the name and plan on screen, then goes where the server says", async () => {
    await renderPage();

    await change("marketplace-purchase-project-name", "Acme Cloud");
    await change("marketplace-purchase-plan", "free_monthly");
    await click("marketplace-purchase-submit");

    expect(requestsTo(MARKETPLACE_PURCHASE_COMPLETE_API_URL)).toEqual([
      { projectName: "Acme Cloud", planId: "free_monthly" },
    ]);
    expect(navigatedTo).toEqual([
      `http://localhost/dashboard/${PRODUCTION_ID}/settings/billing`,
    ]);
    expect(
      screen.getByTestId("marketplace-purchase-redirecting"),
    ).toHaveTextContent(say("redirecting"));
  });

  test.each([
    ["another site", "https://evil.example.com/dashboard/"],
    ["a protocol-relative address", "//evil.example.com/dashboard/x"],
    ["a page outside the dashboard", "/accounts/logout"],
    ["nothing", null],
  ])(
    "goes to the dashboard instead of following a redirect to %s",
    async (_label: string, redirectUrl: string | null) => {
      answers.complete = ok({ projectId: PRODUCTION_ID, redirectUrl });

      await renderPage();
      await change("marketplace-purchase-project-name", "Acme Cloud");
      await click("marketplace-purchase-submit");

      expect(navigatedTo).toEqual([DASHBOARD_URL.toString()]);
    },
  );

  test("shows the server's refusal and lets the buyer try again", async () => {
    answers.complete = refused(
      400,
      "This subscription has been cancelled. Buy OneUptime again on Microsoft Marketplace to continue.",
    );

    await renderPage();
    await change("marketplace-purchase-project-name", "Acme Cloud");
    await click("marketplace-purchase-submit");

    expect(
      screen.getByTestId("marketplace-purchase-submit-error"),
    ).toHaveTextContent("This subscription has been cancelled.");
    expect(navigatedTo).toEqual([]);
    expect(submitButton()).toBeEnabled();
  });

  test("comes back to the page after a sign-in if the session ran out meanwhile", async () => {
    answers.complete = refused(401, "Please sign in.");

    await renderPage();
    await change("marketplace-purchase-project-name", "Acme Cloud");
    await click("marketplace-purchase-submit");

    expect(isPurchaseRemembered()).toBe(true);
  });
});

describe("one of the buyer's projects", () => {
  test("offers every project, but only lets the eligible ones be chosen", async () => {
    await renderPage();
    await click("marketplace-purchase-choice-existing");

    const options: Array<HTMLOptionElement> = Array.from(
      (screen.getByTestId("marketplace-purchase-project") as HTMLSelectElement)
        .options,
    );

    expect(
      options.map((option: HTMLOptionElement) => {
        return [option.value, option.textContent, option.disabled];
      }),
    ).toEqual([
      ["", say("projectPlaceholder"), false],
      [PRODUCTION_ID, "Acme Production", false],
      [
        RESOLD_ID,
        say("projectRefusal.bought_from_reseller", { name: "Acme Resold" }),
        true,
      ],
    ]);
  });

  test("preselects the only eligible project and sends it", async () => {
    await renderPage();
    await click("marketplace-purchase-choice-existing");

    expect(
      (screen.getByTestId("marketplace-purchase-project") as HTMLSelectElement)
        .value,
    ).toBe(PRODUCTION_ID);

    await click("marketplace-purchase-submit");

    expect(requestsTo(MARKETPLACE_PURCHASE_COMPLETE_API_URL)).toEqual([
      { projectId: PRODUCTION_ID },
    ]);
  });

  test("makes the buyer choose when several projects are eligible", async () => {
    answers.details = ok(
      details({
        canCreateProject: false,
        projects: [
          { id: PRODUCTION_ID, name: "Acme Production", isEligible: true },
          { id: STAGING_ID, name: "Acme Staging", isEligible: true },
        ] as unknown as JSONObject,
      }),
    );

    await renderPage();

    // No new project on this server: it starts on the buyer's projects.
    expect(screen.queryByTestId("marketplace-purchase-choice-new")).toBeNull();
    expect(
      screen.getByTestId("marketplace-purchase-choice-existing"),
    ).toBeChecked();
    expect(submitButton()).toBeDisabled();

    await change("marketplace-purchase-project", STAGING_ID);
    await click("marketplace-purchase-submit");

    expect(requestsTo(MARKETPLACE_PURCHASE_COMPLETE_API_URL)).toEqual([
      { projectId: STAGING_ID },
    ]);
  });

  test("starts on the buyer's projects when there is no plan to create one on", async () => {
    answers.details = ok(details({ plans: [] as unknown as JSONObject }));

    await renderPage();

    expect(screen.queryByTestId("marketplace-purchase-choice-new")).toBeNull();
    expect(
      screen.getByTestId("marketplace-purchase-choice-existing"),
    ).toBeChecked();
    expect(submitButton()).toBeEnabled();
  });
});

describe("other states", () => {
  test("a purchase already set up offers to open its project", async () => {
    answers.details = ok(details({ linkedProjectId: PRODUCTION_ID }));

    await renderPage();

    expect(
      screen.getByTestId("marketplace-purchase-subtitle"),
    ).toHaveTextContent(
      say("alreadySetUp", { marketplace: "Microsoft Marketplace" }),
    );

    await click("marketplace-purchase-open-project");

    expect(navigatedTo).toEqual([
      `http://localhost/dashboard/${PRODUCTION_ID}/settings/billing`,
    ]);
    expect(screen.queryByTestId("marketplace-purchase-submit")).toBeNull();
  });

  test("a cancelled purchase cannot be set up", async () => {
    answers.details = ok(details({ status: "Cancelled" }));

    await renderPage();

    expect(
      screen.getByTestId("marketplace-purchase-cancelled"),
    ).toHaveTextContent(
      say("cancelled", { marketplace: "Microsoft Marketplace" }),
    );
    expect(screen.queryByTestId("marketplace-purchase-submit")).toBeNull();
  });

  test("says what to do when there is nothing the buyer can choose", async () => {
    answers.details = ok(
      details({
        canCreateProject: false,
        projects: [
          {
            id: RESOLD_ID,
            name: "Acme Resold",
            isEligible: false,
            refusal: "bought_from_reseller",
          },
        ] as unknown as JSONObject,
      }),
    );

    await renderPage();

    expect(
      screen.getByTestId("marketplace-purchase-nothing-to-choose"),
    ).toHaveTextContent(say("nothingToChoose"));
    expect(submitButton()).toBeDisabled();
  });

  test("tells a buyer in a free trial so", async () => {
    answers.details = ok(details({ isFreeTrial: true }));

    await renderPage();

    expect(
      screen.getByTestId("marketplace-purchase-free-trial"),
    ).toHaveTextContent(
      say("freeTrial", { marketplace: "Microsoft Marketplace" }),
    );
  });

  test("Not now forgets the purchase in this browser and goes to the dashboard", async () => {
    await renderPage();
    MarketplacePendingPurchase.remember();

    await click("marketplace-purchase-not-now");

    expect(requestsTo(MARKETPLACE_PURCHASE_DISMISS_API_URL)).toEqual([{}]);
    expect(isPurchaseRemembered()).toBe(false);
    expect(navigatedTo).toEqual([DASHBOARD_URL.toString()]);
  });
});
