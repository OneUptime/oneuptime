import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import SubscriberUtil from "../../../UI/Utils/StatusPage";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * The parts of the status page app a visitor moves through - its master page,
 * its navigation and its Subscribe forms - on a tab of their own beside
 * another status page (issue #5277).
 *
 * Every tab open on OneUptime's host shares its localStorage, and the app
 * kept the id of its page there: open page B in a second tab, and page A's
 * links led to B's pages, its Subscribe forms subscribed the visitor to B,
 * and its logo led to /status-page/:statusPageId, a route's placeholder.
 * Here localStorage holds page B's id throughout, as such a tab leaves it,
 * and every part is held to page A, the page this tab shows.
 *
 * These render the real components and the real StatusPageUtil; only the
 * page chrome they sit in, the network and the status page's words are
 * stubbed. Copy resolves against the status page's real en.json.
 */

jest.mock("react-i18next", () => {
  const english: Record<string, unknown> = jest.requireActual(
    "../../../../App/FeatureSet/StatusPage/src/Locales/en.json",
  ) as Record<string, unknown>;

  const translate: (
    key: string,
    options?: Record<string, unknown>,
  ) => string = (key: string, options?: Record<string, unknown>): string => {
    let node: unknown = english;

    for (const part of key.split(".")) {
      node =
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined;
    }

    if (typeof node === "string") {
      return node;
    }

    // A flat key, as the shared form components look their words up.
    const flat: unknown = english[key];

    if (typeof flat === "string") {
      return flat;
    }

    return typeof options?.["defaultValue"] === "string"
      ? (options["defaultValue"] as string)
      : key;
  };

  return {
    // The master page loads the status page's i18n setup, which plugs this in.
    initReactI18next: {
      type: "3rdParty",
      init: () => {},
    },
    useTranslation: () => {
      return {
        t: translate,
        i18n: {
          resolvedLanguage: "en",
          language: "en",
          dir: (): string => {
            return "ltr";
          },
        },
      };
    },
  };
});

/*
 * The page chrome: its breadcrumbs as plain links, so the test can read
 * where they lead, and the side menu and content as they are.
 */
jest.mock(
  "../../../../App/FeatureSet/StatusPage/src/Components/Page/Page",
  () => {
    return {
      __esModule: true,
      default: (props: {
        children: ReactElement;
        sideMenu?: ReactElement;
        breadcrumbLinks?: Array<{ title: string; to: Route }>;
      }): ReactElement => {
        return (
          <div>
            <nav data-testid="breadcrumbs">
              {(props.breadcrumbLinks || []).map(
                (link: { title: string; to: Route }) => {
                  return (
                    <a key={link.title} href={link.to.toString()}>
                      {link.title}
                    </a>
                  );
                },
              )}
            </nav>
            {props.sideMenu}
            {props.children}
          </div>
        );
      },
    };
  },
);

// The master page's header: its logo as a button that does what the logo does.
jest.mock(
  "../../../../App/FeatureSet/StatusPage/src/Components/Header/Header",
  () => {
    return {
      __esModule: true,
      default: (props: { onLogoClicked: () => void }): ReactElement => {
        return (
          <button
            data-testid="status-page-logo-button"
            onClick={() => {
              props.onLogoClicked();
            }}
          >
            Logo
          </button>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/StatusPage/src/Components/Footer/Footer",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <footer />;
      },
    };
  },
);

const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
      getList: async (): Promise<{ data: Array<unknown>; count: number }> => {
        return { data: [], count: 0 };
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import API from "../../../../App/FeatureSet/StatusPage/src/Utils/API";
import StatusPageUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import StatusPageMasterPage from "../../../../App/FeatureSet/StatusPage/src/Components/MasterPage/MasterPage";
import StatusPageNavBar from "../../../../App/FeatureSet/StatusPage/src/Components/NavBar/NavBar";
import EmailSubscribe from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/EmailSubscribe";
import SmsSubscribe from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/SmsSubscribe";
import SlackSubscribe from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/SlackSubscribe";
import MicrosoftTeamsSubscribe from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/MicrosoftTeamsSubscribe";
import WebhookSubscribe from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/WebhookSubscribe";

const PAGE_A: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAGE_B: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// Where the tab is: the address bar, and the router's own idea of it.
const openAt: (address: string) => void = (address: string): void => {
  window.history.replaceState({}, "", address);
  Navigation.setLocation({
    pathname: address.split("?")[0] || "/",
    search: "",
    hash: "",
    state: null,
    key: "default",
  });
};

// Another tab on the same host, showing page B, as an earlier version did.
const anotherTabOpens: (pageId: string) => void = (pageId: string): void => {
  window.localStorage.setItem("statusPageId", pageId);
  window.localStorage.setItem(`isPrivateStatusPage-${pageId}`, "false");
  window.dispatchEvent(
    new StorageEvent("storage", { key: "statusPageId", newValue: pageId }),
  );
};

const hrefsIn: (container: Element) => Array<string> = (
  container: Element,
): Array<string> => {
  return Array.from(container.querySelectorAll("a[href]")).map(
    (link: Element): string => {
      return link.getAttribute("href") || "";
    },
  );
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  StatusPageUtil.setStatusPageId(null);
  openAt("/");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  StatusPageUtil.setStatusPageId(null);
  openAt("/");
});

describe("the master page of a tab", () => {
  let posted: Array<{ url: string; data: unknown }> = [];

  const masterPageAnswer: (pageId: string) => JSONObject = (
    pageId: string,
  ): JSONObject => {
    return {
      statusPage: {
        _id: pageId,
        pageTitle: pageId === PAGE_A ? "Page A" : "Page B",
        isPublicStatusPage: true,
        showSubscriberPageOnStatusPage: true,
      },
      headerLinks: [],
      footerLinks: [],
      allowStatusPageCustomizations: false,
    };
  };

  beforeEach(() => {
    posted = [];

    getJestSpyOn(API, "post").mockImplementation(
      async (options: {
        url: { toString: () => string };
        data?: unknown;
      }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        const url: string = options.url.toString();

        posted.push({ url, data: options.data });

        if (url.endsWith("/domain")) {
          return new HTTPResponse<JSONObject>(
            200,
            { statusPageId: PAGE_A },
            {},
          );
        }

        for (const pageId of [PAGE_A, PAGE_B]) {
          if (url.endsWith(`/master-page/${pageId}`)) {
            return new HTTPResponse<JSONObject>(
              200,
              masterPageAnswer(pageId),
              {},
            );
          }
        }

        return new HTTPErrorResponse(404, { message: "Not found" }, {});
      },
    );
  });

  const renderMasterPage: (
    isPreview: boolean,
  ) => Promise<RenderResult> = async (
    isPreview: boolean,
  ): Promise<RenderResult> => {
    let result: RenderResult | null = null;

    await act(async () => {
      result = render(
        <MemoryRouter>
          <StatusPageMasterPage
            isPreview={isPreview}
            isPrivateStatusPage={false}
            enableEmailSubscribers={true}
            enableSMSSubscribers={false}
            onLoadComplete={() => {}}
          >
            <div>Status page content</div>
          </StatusPageMasterPage>
        </MemoryRouter>,
      );
    });

    await screen.findByText("Status page content");

    return result!;
  };

  const masterPagesRead: () => Array<string> = (): Array<string> => {
    return posted
      .map((post: { url: string }): string => {
        return new globalThis.URL(post.url).pathname;
      })
      .filter((path: string): boolean => {
        return path.startsWith("/status-page-api/master-page/");
      });
  };

  test("loads the page its address names, whatever another tab keeps", async () => {
    anotherTabOpens(PAGE_B);
    openAt(`/status-page/${PAGE_A}`);

    await renderMasterPage(true);

    expect(masterPagesRead()).toEqual([
      `/status-page-api/master-page/${PAGE_A}`,
    ]);
    expect(StatusPageUtil.getStatusPageId()?.toString()).toBe(PAGE_A);
    expect(window.localStorage.getItem("statusPageId")).toBe(PAGE_B);
  });

  test("on a custom domain, loads the page the domain shows, whatever another tab keeps", async () => {
    anotherTabOpens(PAGE_B);
    openAt("/");

    await renderMasterPage(false);

    expect(masterPagesRead()).toEqual([
      `/status-page-api/master-page/${PAGE_A}`,
    ]);
    expect(StatusPageUtil.getStatusPageId()?.toString()).toBe(PAGE_A);
  });

  test("its logo leads to its own overview, its id filled in", async () => {
    openAt(`/status-page/${PAGE_A}/incidents`);
    await renderMasterPage(true);
    anotherTabOpens(PAGE_B);

    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});

    fireEvent.click(screen.getByTestId("status-page-logo-button"));

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]?.[0])).toBe(`/status-page/${PAGE_A}`);
  });

  test("on a custom domain, its logo leads to the domain's overview", async () => {
    openAt("/incidents");
    await renderMasterPage(false);

    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});

    fireEvent.click(screen.getByTestId("status-page-logo-button"));

    expect(String(navigate.mock.calls[0]?.[0])).toBe("/");
  });

  test("another page's address, reached inside the app, is opened in full", async () => {
    openAt(`/status-page/${PAGE_A}`);
    const result: RenderResult = await renderMasterPage(true);
    const reload: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "reload")
      .mockImplementation(() => {});

    // The router moves to page B's address without loading the page anew.
    openAt(`/status-page/${PAGE_B}/subscribe/email`);

    await act(async () => {
      result.rerender(
        <MemoryRouter>
          <StatusPageMasterPage
            isPreview={true}
            isPrivateStatusPage={false}
            enableEmailSubscribers={true}
            enableSMSSubscribers={false}
            onLoadComplete={() => {}}
          >
            <div>Status page content</div>
          </StatusPageMasterPage>
        </MemoryRouter>,
      );
    });

    // Nothing of page A is drawn over page B's address: it loads instead.
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Status page content")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });

  test("a move to another of its own page's addresses opens nothing anew", async () => {
    openAt(`/status-page/${PAGE_A}`);
    const result: RenderResult = await renderMasterPage(true);
    const reload: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "reload")
      .mockImplementation(() => {});

    openAt(`/status-page/${PAGE_A.toUpperCase()}/incidents`);

    await act(async () => {
      result.rerender(
        <MemoryRouter>
          <StatusPageMasterPage
            isPreview={true}
            isPrivateStatusPage={false}
            enableEmailSubscribers={true}
            enableSMSSubscribers={false}
            onLoadComplete={() => {}}
          >
            <div>Status page content</div>
          </StatusPageMasterPage>
        </MemoryRouter>,
      );
    });

    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText("Status page content")).toBeInTheDocument();
  });
});

describe("the navigation of a tab", () => {
  const renderNavBar: (isPreview: boolean) => Promise<RenderResult> = async (
    isPreview: boolean,
  ): Promise<RenderResult> => {
    let result: RenderResult | null = null;

    await act(async () => {
      result = render(
        <MemoryRouter>
          <StatusPageNavBar
            show={true}
            isPreview={isPreview}
            isPrivateStatusPage={true}
            enableEmailSubscribers={true}
            enableSMSSubscribers={true}
            showIncidentsOnStatusPage={true}
            showAnnouncementsOnStatusPage={true}
            showScheduledMaintenanceEventsOnStatusPage={true}
            showSubscriberPageOnStatusPage={true}
          />
        </MemoryRouter>,
      );
    });

    return result!;
  };

  test("leads only to the page this tab shows, whatever another tab opened", async () => {
    openAt(`/status-page/${PAGE_A}`);
    StatusPageUtil.setStatusPageId(new ObjectID(PAGE_A));
    anotherTabOpens(PAGE_B);

    const result: RenderResult = await renderNavBar(true);
    const hrefs: Array<string> = hrefsIn(result.container);

    expect(hrefs.length).toBeGreaterThanOrEqual(6);

    for (const href of hrefs) {
      expect(href.startsWith(`/status-page/${PAGE_A}`)).toBe(true);
      expect(href).not.toContain(PAGE_B);
      expect(href).not.toContain(":statusPageId");
    }

    expect(hrefs).toEqual(
      expect.arrayContaining([
        `/status-page/${PAGE_A}`,
        `/status-page/${PAGE_A}/incidents`,
        `/status-page/${PAGE_A}/announcements`,
        `/status-page/${PAGE_A}/scheduled-events`,
        `/status-page/${PAGE_A}/subscribe/email`,
        `/status-page/${PAGE_A}/logout`,
      ]),
    );
  });

  test("on a custom domain, leads to the domain's own pages", async () => {
    openAt("/");
    StatusPageUtil.setStatusPageId(new ObjectID(PAGE_A));
    anotherTabOpens(PAGE_B);

    const result: RenderResult = await renderNavBar(false);
    const hrefs: Array<string> = hrefsIn(result.container);

    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/",
        "/incidents",
        "/announcements",
        "/scheduled-events",
        "/subscribe/email",
        "/logout",
      ]),
    );

    for (const href of hrefs) {
      expect(href).not.toContain("/status-page/");
    }
  });
});

type SubscribePage = typeof EmailSubscribe;

interface SubscribeCase {
  name: string;
  Page: SubscribePage;
  path: string;
  fill: Array<[RegExp, string]>;
}

const SUBSCRIBE_CASES: Array<SubscribeCase> = [
  {
    name: "email",
    Page: EmailSubscribe,
    path: "subscribe/email",
    fill: [[/^Your Email/, "reader@example.com"]],
  },
  {
    name: "SMS",
    Page: SmsSubscribe,
    path: "subscribe/sms",
    fill: [[/^Your Phone Number/, "+15555550100"]],
  },
  {
    name: "Slack",
    Page: SlackSubscribe,
    path: "subscribe/slack",
    fill: [
      [/^Slack Workspace Name/, "Acme"],
      [/^Slack Incoming Webhook URL/, "https://hooks.slack.com/services/T/B/X"],
    ],
  },
  {
    name: "Microsoft Teams",
    Page: MicrosoftTeamsSubscribe,
    path: "subscribe/microsoft-teams",
    fill: [
      [/^Microsoft Teams Workspace Name/, "Acme"],
      [
        /^Microsoft Teams Incoming Webhook URL/,
        "https://acme.webhook.office.com/webhookb2/x",
      ],
    ],
  },
  {
    name: "webhook",
    Page: WebhookSubscribe,
    path: "subscribe/webhooks",
    fill: [[/^Webhook URL/, "https://example.com/oneuptime-updates"]],
  },
];

describe("subscribing from a tab", () => {
  beforeEach(() => {
    createOrUpdateMock.mockReset();
    createOrUpdateMock.mockResolvedValue({ data: {} });

    getJestSpyOn(
      SubscriberUtil,
      "getCategoryCheckboxPropsBasedOnResources",
    ).mockResolvedValue({ categories: [], options: [] } as never);
  });

  const renderSubscribePage: (
    Page: SubscribePage,
  ) => Promise<RenderResult> = async (
    Page: SubscribePage,
  ): Promise<RenderResult> => {
    let result: RenderResult | null = null;

    await act(async () => {
      result = render(
        <MemoryRouter>
          <Page
            pageRoute={new Route("/subscribe/email")}
            onLoadComplete={(): void => {}}
            enableEmailSubscribers={true}
            enableSMSSubscribers={true}
            enableSlackSubscribers={true}
            enableMicrosoftTeamsSubscribers={true}
            enableWebhookSubscribers={true}
            allowSubscribersToChooseResources={false}
            allowSubscribersToChooseEventTypes={false}
          />
        </MemoryRouter>,
      );
    });

    return result!;
  };

  interface SentSubscription {
    url: string;
    statusPageId: string;
    header: string;
  }

  const subscribe: (row: SubscribeCase) => Promise<SentSubscription> = async (
    row: SubscribeCase,
  ): Promise<SentSubscription> => {
    for (const [name, value] of row.fill) {
      const field: HTMLElement = await screen.findByRole("textbox", { name });

      await act(async () => {
        fireEvent.change(field, { target: { value } });
      });
    }

    const button: HTMLElement = await screen.findByRole("button", {
      name: "Subscribe",
    });

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const call: {
      model: { statusPageId?: ObjectID };
      requestOptions?: {
        overrideRequestUrl?: URL;
        requestHeaders?: Record<string, string>;
      };
    } = (
      createOrUpdateMock.mock.calls[0] as Array<{
        model: { statusPageId?: ObjectID };
        requestOptions?: {
          overrideRequestUrl?: URL;
          requestHeaders?: Record<string, string>;
        };
      }>
    )[0]!;

    return {
      url: new globalThis.URL(
        call.requestOptions?.overrideRequestUrl?.toString() || "",
      ).pathname,
      statusPageId: call.model.statusPageId?.toString() || "",
      header: call.requestOptions?.requestHeaders?.["status-page-id"] || "",
    };
  };

  test.each(SUBSCRIBE_CASES)(
    "by $name: to the page this tab shows, in the address and in what it sends",
    async (row: SubscribeCase) => {
      openAt(`/status-page/${PAGE_A}/${row.path}`);
      anotherTabOpens(PAGE_B);

      const result: RenderResult = await renderSubscribePage(row.Page);

      // Another tab opens page B while the form is open.
      anotherTabOpens(PAGE_B);

      const sent: SentSubscription = await subscribe(row);

      expect(sent).toEqual({
        url: `/status-page-api/subscribe/${PAGE_A}`,
        statusPageId: PAGE_A,
        header: PAGE_A,
      });

      // And its breadcrumbs and channel menu lead to the same page.
      const hrefs: Array<string> = hrefsIn(result.container);

      expect(hrefs).toContain(`/status-page/${PAGE_A}`);
      expect(hrefs).toContain(`/status-page/${PAGE_A}/${row.path}`);

      for (const href of hrefs) {
        expect(
          href === `/status-page/${PAGE_A}` ||
            href.startsWith(`/status-page/${PAGE_A}/`),
        ).toBe(true);
      }
    },
  );

  test("on a custom domain, to the page the domain shows", async () => {
    openAt("/subscribe/email");
    StatusPageUtil.setStatusPageId(new ObjectID(PAGE_A));
    anotherTabOpens(PAGE_B);

    await renderSubscribePage(EmailSubscribe);

    const sent: SentSubscription = await subscribe(SUBSCRIBE_CASES[0]!);

    expect(sent).toEqual({
      url: `/status-page-api/subscribe/${PAGE_A}`,
      statusPageId: PAGE_A,
      header: PAGE_A,
    });
  });
});
