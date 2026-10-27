import "@testing-library/jest-dom";
import { act, cleanup, render, screen, within } from "@testing-library/react";
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
import { JSONObject } from "../../../Types/JSON";
import {
  OFFLINE_SCREEN_TEST_ID,
  OFFLINE_SCREEN_TITLE,
} from "../../../UI/Components/Offline/OfflineScreen";
import Navigation from "../../../UI/Utils/Navigation";
import { getJestSpyOn } from "../../Spy";

/*
 * A status page whose visitor's browser goes offline: the "You're offline"
 * card takes the page's place - its content and its footer - while the
 * page's header (its logo and links) and its tabs stay above it, as the
 * Dashboard's header and product bar do. The visitor still sees whose page
 * this is. Before, the card stood alone on an empty page.
 *
 * The real master page and its tabs; only the header, the footer, the
 * network and the status page's words are stubbed. Copy resolves against
 * the status page's real en.json.
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

    // A flat key, as the shared components look their words up.
    const flat: unknown = english[key];

    if (typeof flat === "string") {
      return flat;
    }

    return typeof options?.["defaultValue"] === "string"
      ? (options["defaultValue"] as string)
      : key;
  };

  return {
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

// The page's header: its name, as the logo shows it.
jest.mock(
  "../../../../App/FeatureSet/StatusPage/src/Components/Header/Header",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <header data-testid="status-page-header">Acme Cloud</header>;
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
        return <footer data-testid="status-page-footer">Powered by</footer>;
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
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

const PAGE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const setOnline: (isOnline: boolean) => void = (isOnline: boolean): void => {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: (): boolean => {
      return isOnline;
    },
  });
};

const goOffline: () => void = (): void => {
  setOnline(false);
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
};

const goOnline: () => void = (): void => {
  setOnline(true);
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
};

const openAt: (address: string) => void = (address: string): void => {
  window.history.replaceState({}, "", address);
  Navigation.setLocation({
    pathname: address,
    search: "",
    hash: "",
    state: null,
    key: "default",
  });
};

beforeEach(() => {
  setOnline(true);
  window.localStorage.clear();
  window.sessionStorage.clear();
  StatusPageUtil.setStatusPageId(null);
  openAt("/");

  getJestSpyOn(API, "post").mockImplementation(
    async (options: {
      url: { toString: () => string };
    }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const url: string = options.url.toString();

      if (url.endsWith("/domain")) {
        return new HTTPResponse<JSONObject>(200, { statusPageId: PAGE_ID }, {});
      }

      if (url.endsWith(`/master-page/${PAGE_ID}`)) {
        return new HTTPResponse<JSONObject>(
          200,
          {
            statusPage: {
              _id: PAGE_ID,
              pageTitle: "Acme Cloud",
              isPublicStatusPage: true,
              showIncidentsOnStatusPage: true,
            },
            headerLinks: [],
            footerLinks: [],
            allowStatusPageCustomizations: false,
          },
          {},
        );
      }

      return new HTTPErrorResponse(404, { message: "Not found" }, {});
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  setOnline(true);
  window.localStorage.clear();
  window.sessionStorage.clear();
  StatusPageUtil.setStatusPageId(null);
  openAt("/");
});

const renderStatusPage: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter>
        <StatusPageMasterPage
          isPreview={false}
          isPrivateStatusPage={false}
          enableEmailSubscribers={false}
          enableSMSSubscribers={false}
          onLoadComplete={() => {}}
        >
          <div data-testid="status-page-content">All systems operational</div>
        </StatusPageMasterPage>
      </MemoryRouter>,
    );
  });

  await screen.findByTestId("status-page-content");
};

describe("a status page whose visitor's browser goes offline", () => {
  test("the card takes the page's place, under the page's header and its tabs", async () => {
    await renderStatusPage();

    goOffline();

    const card: HTMLElement = screen.getByTestId(OFFLINE_SCREEN_TEST_ID);

    expect(card).toBeVisible();
    expect(
      within(card).getByTestId(`${OFFLINE_SCREEN_TEST_ID}-title`),
    ).toHaveTextContent(OFFLINE_SCREEN_TITLE);

    // Whose page this is, and its tabs, stay.
    const header: HTMLElement = screen.getByTestId("status-page-header");
    // The tabs, as the phone's and the wider layout both draw them.
    const overviewTabs: Array<HTMLElement> = screen.getAllByText("Overview");

    expect(overviewTabs.length).toBeGreaterThan(0);

    const tabs: HTMLElement = overviewTabs[0]!.closest("nav") as HTMLElement;

    expect(header).toBeVisible();
    expect(tabs).not.toBeNull();

    for (const tab of overviewTabs) {
      expect(tab).toBeVisible();
    }

    // Above the card, in reading order.
    expect(
      header.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      tabs.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The page's content and its footer are put away under it.
    expect(screen.getByTestId("status-page-content")).not.toBeVisible();
    expect(screen.getByTestId("status-page-footer")).not.toBeVisible();
  });

  test("back online, the page is there again as it was, and the card is gone", async () => {
    await renderStatusPage();

    const content: HTMLElement = screen.getByTestId("status-page-content");

    goOffline();
    goOnline();

    expect(screen.queryByTestId(OFFLINE_SCREEN_TEST_ID)).toBeNull();
    // The very same content, never drawn anew.
    expect(screen.getByTestId("status-page-content")).toBe(content);
    expect(content).toBeVisible();
    expect(screen.getByTestId("status-page-footer")).toBeVisible();
    expect(screen.getByTestId("status-page-header")).toBeVisible();
  });

  test("online, the page has no card, and its header and tabs come before its content", async () => {
    await renderStatusPage();

    expect(screen.queryByTestId(OFFLINE_SCREEN_TEST_ID)).toBeNull();

    const header: HTMLElement = screen.getByTestId("status-page-header");
    const content: HTMLElement = screen.getByTestId("status-page-content");

    expect(content).toBeVisible();
    expect(
      header.compareDocumentPosition(content) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The page's own landmark holds its content, once.
    expect(document.querySelectorAll("main#main-content")).toHaveLength(1);
    expect(document.querySelector("main#main-content")?.contains(content)).toBe(
      true,
    );
  });
});
