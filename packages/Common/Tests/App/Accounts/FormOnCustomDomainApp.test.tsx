import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  DARK_COLOR_SCHEME_MEDIA_QUERY,
  THEME_STORAGE_KEY,
  ThemePreference,
} from "../../../Types/Theme/ThemePreference";
import {
  FORM_CUSTOM_DOMAIN_PAGE_META_CONTENT,
  FORM_CUSTOM_DOMAIN_PAGE_META_NAME,
} from "../../../Types/Form/FormCustomDomain";
import RememberedChoice from "../../../UI/Utils/RememberedChoice";
import ThemeUtil from "../../../UI/Utils/Theme";

/*
 * The sign-in app on a form's own domain (Accounts App.tsx with the page the
 * server marks, Utils/FormDomainPage): the form, and nothing else, whatever
 * the address - no sign-in page, no other route - drawn as the form on its
 * domain (isOnCustomDomain), light whoever opens it, with a footer that
 * carries only the language picker. Without the mark - the same app on
 * OneUptime's own domain - every page is where it was.
 *
 * The app and its routes are the real ones; each page is a stand-in that
 * records what it was handed.
 */

const mockPageProps: Array<{ page: string; props: Record<string, unknown> }> =
  [];

const PAGE_MODULES: Array<string> = [
  "Forbidden",
  "ForgotPassword",
  "Login",
  "MobilePasskey",
  "LoginWithSSO",
  "NotFound",
  "Register",
  "ResetPassword",
  "VerifyEmail",
  "Form",
  "McpAuthorize",
  "MarketplacePurchase",
];

for (const pageModule of PAGE_MODULES) {
  jest.doMock(
    `../../../../App/FeatureSet/Accounts/src/Pages/${pageModule}`,
    () => {
      return {
        __esModule: true,
        default: (props: Record<string, unknown>): React.ReactElement => {
          mockPageProps.push({ page: pageModule, props: props });
          return <div data-testid={`page-${pageModule}`} />;
        },
      };
    },
  );
}

import App from "../../../../App/FeatureSet/Accounts/src/App";
import AccountsTheme from "../../../../App/FeatureSet/Accounts/src/Utils/AccountsTheme";
import {
  getFormDomainPageOrigin,
  isFormDomainPage,
} from "../../../../App/FeatureSet/Accounts/src/Utils/FormDomainPage";

const SHARE_KEY: string = "0f8fad5b-d9cb-469f-a165-70867728950e";

const device: { prefersDark: boolean } = { prefersDark: false };

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: (query: string): MediaQueryList => {
    return {
      media: query,
      get matches(): boolean {
        return query === DARK_COLOR_SCHEME_MEDIA_QUERY && device.prefersDark;
      },
      addEventListener: (): void => {},
      removeEventListener: (): void => {},
    } as unknown as MediaQueryList;
  },
});

// The mark the server writes into a form domain's page, as it writes it.
function markAsFormDomainPage(content: string = "true"): void {
  const meta: HTMLMetaElement = document.createElement("meta");
  meta.setAttribute("name", FORM_CUSTOM_DOMAIN_PAGE_META_NAME);
  meta.setAttribute("content", content);
  document.head.appendChild(meta);
}

function removeMarks(): void {
  for (const meta of Array.from(
    document.head.querySelectorAll(
      `meta[name="${FORM_CUSTOM_DOMAIN_PAGE_META_NAME}"]`,
    ),
  )) {
    meta.remove();
  }
}

async function openAt(address: string): Promise<void> {
  window.history.replaceState({}, "", address);

  await act(async () => {
    render(
      <MemoryRouter initialEntries={[address]}>
        <App />
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  mockPageProps.length = 0;
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
  device.prefersDark = false;
  document.documentElement.removeAttribute("class");
  removeMarks();
});

afterEach(() => {
  cleanup();
  removeMarks();
  ThemeUtil.initialize();
});

describe("the mark (Utils/FormDomainPage)", () => {
  test("is read from the page the server wrote", () => {
    expect(isFormDomainPage()).toBe(false);

    markAsFormDomainPage();

    expect(isFormDomainPage()).toBe(true);
    expect(FORM_CUSTOM_DOMAIN_PAGE_META_CONTENT).toBe("true");
  });

  test.each([["false"], [""], ["TRUE"], ["yes"]])(
    "a mark that says %j is no mark",
    (content: string) => {
      markAsFormDomainPage(content);

      expect(isFormDomainPage()).toBe(false);
    },
  );

  test("reads the document it is given", () => {
    const other: Document = document.implementation.createHTMLDocument("x");
    const meta: HTMLMetaElement = other.createElement("meta");
    meta.setAttribute("name", FORM_CUSTOM_DOMAIN_PAGE_META_NAME);
    meta.setAttribute("content", "true");
    other.head.appendChild(meta);

    expect(isFormDomainPage(other)).toBe(true);
    expect(isFormDomainPage()).toBe(false);
  });

  test("the page's origin is where its requests go", () => {
    expect(getFormDomainPageOrigin()).toBe(window.location.origin);
  });
});

describe("on a form's own domain", () => {
  test.each([
    ["/"],
    ["/accounts"],
    ["/accounts/login"],
    ["/accounts/register"],
    [`/accounts/form/${SHARE_KEY}`],
    ["/anything"],
  ])("draws the form at %s, and no other page", async (address: string) => {
    markAsFormDomainPage();

    await openAt(address);

    expect(await screen.findByTestId("page-Form")).toBeInTheDocument();
    expect(screen.queryByTestId("page-Login")).not.toBeInTheDocument();
    expect(screen.queryByTestId("page-NotFound")).not.toBeInTheDocument();
    expect(screen.queryByTestId("page-Register")).not.toBeInTheDocument();

    const formProps: Array<Record<string, unknown>> = mockPageProps
      .filter((entry: { page: string }) => {
        return entry.page === "Form";
      })
      .map((entry: { props: Record<string, unknown> }) => {
        return entry.props;
      });

    expect(formProps.length).toBeGreaterThan(0);
    expect(formProps[formProps.length - 1]).toEqual({
      isOnCustomDomain: true,
    });
  });

  test("its footer carries the language picker and nothing of OneUptime's", async () => {
    markAsFormDomainPage();

    await openAt("/");
    await screen.findByTestId("page-Form");

    const footer: HTMLElement = document.querySelector("footer")!;

    expect(footer).not.toBeNull();
    expect(footer.querySelectorAll("a")).toHaveLength(0);
    expect(footer).not.toHaveTextContent("©");
    expect(footer.querySelector("select, button")).not.toBeNull();
  });

  test("is light whatever the visitor picked, and whatever the device does", async () => {
    markAsFormDomainPage();
    window.localStorage.setItem(THEME_STORAGE_KEY, ThemePreference.Dark);
    device.prefersDark = true;
    window.history.replaceState({}, "", "/");
    AccountsTheme.initialize();

    await openAt("/");
    await screen.findByTestId("page-Form");

    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("on OneUptime's own domain, without the mark", () => {
  test("the sign-in page is the sign-in page", async () => {
    await openAt("/accounts/login");

    expect(await screen.findByTestId("page-Login")).toBeInTheDocument();
    expect(screen.queryByTestId("page-Form")).not.toBeInTheDocument();
  });

  test("a form's link draws the form, as its link, with its key", async () => {
    await openAt(`/accounts/form/${SHARE_KEY}`);

    expect(await screen.findByTestId("page-Form")).toBeInTheDocument();

    const formProps: Record<string, unknown> | undefined = mockPageProps
      .filter((entry: { page: string }) => {
        return entry.page === "Form";
      })
      .pop()?.props;

    expect(formProps?.["isOnCustomDomain"]).toBeUndefined();
  });

  test("its footer keeps OneUptime's links", async () => {
    await openAt("/accounts/login");
    await screen.findByTestId("page-Login");

    expect(
      document.querySelector("footer")!.querySelectorAll("a").length,
    ).toBeGreaterThan(0);
  });

  test("a sign-in page is drawn in the visitor's theme", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, ThemePreference.Dark);
    window.history.replaceState({}, "", "/accounts/login");
    AccountsTheme.initialize();

    await openAt("/accounts/login");
    await screen.findByTestId("page-Login");

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
