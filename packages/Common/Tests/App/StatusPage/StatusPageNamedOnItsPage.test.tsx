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
import File from "../../../Models/DatabaseModels/File";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import MimeType from "../../../Types/File/MimeType";
import { JSONObject } from "../../../Types/JSON";
import Navigation from "../../../UI/Utils/Navigation";
import { getJestSpyOn } from "../../Spy";

/*
 * A NEW STATUS PAGE SAYS WHOSE IT IS (#7467).
 *
 * A page made by Create Status Page or the guided setup has a name and no
 * Page Title, and its public page read the Page Title alone: its browser
 * tab read "Status Page", and its header - a logo and links, of which a
 * new page has neither - was empty. A visitor saw "All Resources are
 * Operational" and could not tell whose status it was, while the guided
 * setup's preview of the same page showed its name.
 *
 * The server sends the page's public name as its pageTitle (its Page
 * Title, else its name: StatusPageAPI.readMasterPage). The header of a page
 * with no logo draws that name, a link to its Overview as the logo is; a
 * page with a logo is named by the logo. And every page of it names the
 * browser tab after it, never OneUptime: "Walk Co Status | Overview -
 * Incidents", and the Overview "Walk Co Status".
 *
 * The real master page, header and page chrome; only the network, the
 * footer and the status page's words are stubbed.
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

import API from "../../../../App/FeatureSet/StatusPage/src/Utils/API";
import StatusPageUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import StatusPageMasterPage from "../../../../App/FeatureSet/StatusPage/src/Components/MasterPage/MasterPage";
import StatusPageHeader, {
  STATUS_PAGE_NAME_CLASS_NAME,
  STATUS_PAGE_NAME_TEST_ID,
} from "../../../../App/FeatureSet/StatusPage/src/Components/Header/Header";
import StatusPagePage from "../../../../App/FeatureSet/StatusPage/src/Components/Page/Page";
import PageMap from "../../../../App/FeatureSet/StatusPage/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/StatusPage/src/Utils/RouteMap";

const PAGE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa7467";

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

// The page's settings, as /master-page answers them.
const masterPageAnswer: (statusPage: JSONObject) => JSONObject = (
  statusPage: JSONObject,
): JSONObject => {
  return {
    statusPage: {
      _id: PAGE_ID,
      isPublicStatusPage: true,
      showIncidentsOnStatusPage: true,
      ...statusPage,
    },
    headerLinks: [],
    footerLinks: [],
    allowStatusPageCustomizations: false,
  };
};

const answerWith: (statusPage: JSONObject) => void = (
  statusPage: JSONObject,
): void => {
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
          masterPageAnswer(statusPage),
          {},
        );
      }

      return new HTTPErrorResponse(404, { message: "Not found" }, {});
    },
  );
};

const renderMasterPage: (children: ReactElement) => Promise<void> = async (
  children: ReactElement,
): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter>
        <StatusPageMasterPage
          isPreview={true}
          isPrivateStatusPage={false}
          enableEmailSubscribers={true}
          enableSMSSubscribers={false}
          onLoadComplete={() => {}}
        >
          {children}
        </StatusPageMasterPage>
      </MemoryRouter>,
    );
  });

  await screen.findByTestId("content");
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  StatusPageUtil.setStatusPageId(null);
  StatusPageUtil.setStatusPageName("");
  document.title = "Status Page";
  openAt(`/status-page/${PAGE_ID}`);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  StatusPageUtil.setStatusPageId(null);
  StatusPageUtil.setStatusPageName("");
  openAt("/");
});

describe("a new status page, with a name and no Page Title or logo", () => {
  test("names itself in its header: a link to its Overview, as a logo is", async () => {
    // What the server sends a page made by Create Status Page.
    answerWith({ pageTitle: "Walk Co Status" });

    await renderMasterPage(<div data-testid="content" />);

    const name: HTMLElement = screen.getByTestId(STATUS_PAGE_NAME_TEST_ID);

    expect(name).toHaveTextContent(/^Walk Co Status$/);
    expect(name.tagName).toBe("A");
    expect(name).toHaveAttribute(
      "href",
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.PREVIEW_OVERVIEW]!,
      ).toString(),
    );
    expect(name.getAttribute("href")).toContain(PAGE_ID);
    expect(name).toHaveClass(...STATUS_PAGE_NAME_CLASS_NAME.split(" "));
  });

  test("names the browser tab after itself on every page, never OneUptime", async () => {
    answerWith({ pageTitle: "Walk Co Status" });

    await renderMasterPage(
      <div data-testid="content">
        <StatusPagePage
          title="Incidents"
          isTitleTranslated={true}
          breadcrumbLinks={[
            {
              title: "Overview",
              isTitleTranslated: true,
              to: new Route(`/status-page/${PAGE_ID}`),
            },
            {
              title: "Incidents",
              isTitleTranslated: true,
              to: new Route(`/status-page/${PAGE_ID}/incidents`),
            },
          ]}
        >
          <p>Incidents</p>
        </StatusPagePage>
      </div>,
    );

    expect(StatusPageUtil.getStatusPageName()).toBe("Walk Co Status");
    expect(document.title).toBe("Walk Co Status | Overview - Incidents");
    expect(document.title).not.toContain("OneUptime");
  });

  test("its Overview, a page with no title of its own, names the tab by the page alone", async () => {
    answerWith({ pageTitle: "Walk Co Status" });
    // Left by the page visited before, as a move within the app leaves it.
    document.title = "Walk Co Status | Overview - Incidents";

    await renderMasterPage(
      <div data-testid="content">
        <StatusPagePage>
          <p>Overview</p>
        </StatusPagePage>
      </div>,
    );

    expect(document.title).toBe("Walk Co Status");
  });

  test("a page whose name is in Arabic reads it the way it is written, on any page", async () => {
    answerWith({ pageTitle: "حالة أكمي" });

    await renderMasterPage(<div data-testid="content" />);

    const name: HTMLElement = screen.getByTestId(STATUS_PAGE_NAME_TEST_ID);
    const words: HTMLElement = within(name).getByText("حالة أكمي");

    expect(words.tagName).toBe("BDI");
    expect(words).toHaveAttribute("dir", "rtl");
  });
});

describe("the header", () => {
  const imageFile: () => File = (): File => {
    const file: File = new File();
    file.file = new Uint8Array([
      60, 115, 118, 103, 47, 62,
    ]) as unknown as Buffer;
    file.fileType = MimeType.svg;
    return file;
  };

  beforeEach(() => {
    // jsdom has no object URLs; the header draws the logo from one.
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: (): string => {
        return "blob:logo";
      },
    });
    Object.defineProperty(globalThis.URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: (): string => {
        return "blob:logo";
      },
    });
  });

  test("of a page with a logo is named by the logo, and its alt text: its name is not drawn beside it", () => {
    render(
      <StatusPageHeader
        links={[]}
        logo={imageFile()}
        logoAltText="Walk Co Status"
        name="Walk Co Status"
        overviewRoute={new Route("/")}
        onLogoClicked={() => {}}
      />,
    );

    expect(screen.queryByTestId(STATUS_PAGE_NAME_TEST_ID)).toBeNull();
    expect(
      document.getElementById("status-page-logo")!.querySelector("img"),
    ).toHaveAttribute("alt", "Walk Co Status");
  });

  test("of a page with no logo, no links and no name draws nothing", () => {
    const { container } = render(
      <StatusPageHeader links={[]} name="   " onLogoClicked={() => {}} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("draws the name beside the header's links, which stay as they were", () => {
    render(
      <StatusPageHeader
        links={[
          {
            title: "Support",
            to: URL.fromString("https://walk.example.com/support"),
            openInNewTab: true,
          },
        ]}
        name="Walk Co Status"
        overviewRoute={new Route("/")}
        onLogoClicked={() => {}}
      />,
    );

    expect(screen.getByTestId(STATUS_PAGE_NAME_TEST_ID)).toHaveTextContent(
      "Walk Co Status",
    );
    expect(screen.getAllByText("Support").length).toBeGreaterThan(0);
  });

  test("the name, given no Overview to lead to, does what the logo does", () => {
    const onLogoClicked: () => void = jest.fn((): void => {});

    render(
      <StatusPageHeader
        links={[]}
        name="Walk Co Status"
        onLogoClicked={onLogoClicked}
      />,
    );

    act(() => {
      screen.getByTestId(STATUS_PAGE_NAME_TEST_ID).click();
    });

    expect(onLogoClicked).toHaveBeenCalledTimes(1);
  });

  test("the name is large, wraps rather than pushing the links away, and has a focus ring", () => {
    for (const token of [
      "text-xl",
      "sm:text-2xl",
      "font-semibold",
      "text-gray-900",
      "break-words",
      "focus-visible:outline",
    ]) {
      expect(STATUS_PAGE_NAME_CLASS_NAME.split(" ")).toContain(token);
    }
  });
});
