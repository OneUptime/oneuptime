import "@testing-library/jest-dom";
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
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { getJestSpyOn } from "../../Spy";
import UserAuthentication from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Users/View/Authentication";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  CLEAR_LOCAL_SIGN_IN_ACTION,
  CLEAR_MASTER_ADMIN_SIGN_IN_NOT_CONFIRMED_MESSAGE,
} from "../../../Types/SSO/LocalSignInClearing";
import { SsoManagedBy } from "../../../Types/SSO/SsoManagedSignIn";
import TwoFactorAuthStatus from "../../../Types/TwoFactorAuthStatus";
import UserAuthenticationStatus from "../../../Types/UserAuthenticationStatus";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";
import { ADMIN_DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * A PERSON'S SIGN-IN SETTINGS, ON THEIR AUTHENTICATION PAGE (#9762).
 *
 * - While single sign-on manages the person's sign-in - the server requires
 *   SSO, or every project they are in manages sign-in with it - Set Password
 *   and Send Password Reset Link say a password will not sign them in (or
 *   open their projects). Nothing is said for anybody else, master admins
 *   included.
 * - Clear Sign-In Settings, last on the page, deletes their password,
 *   passkeys, security keys, authenticator apps and backup codes after a
 *   dialog that says it cannot be undone. For a master admin the dialog
 *   asks them to confirm that first, and only then sends
 *   isMasterAdminConfirmed. Their own account cannot be cleared here.
 */

jest.setTimeout(60000);

jest.mock("../../../UI/Components/Page/ModelPage", () => {
  return {
    __esModule: true,
    default: (props: { children?: ReactNode }): ReactElement => {
      return <div data-testid="model-page">{props.children}</div>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Users/View/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <nav />;
      },
    };
  },
);

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
}

// The page's own words, in a language.
function pageWords(locale: string): Record<string, string> {
  return (readLocale(locale)["pages"] as Record<string, unknown>)[
    "userAuthentication"
  ] as Record<string, string>;
}

async function instanceFor(locale: string): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [locale]: { translation: readLocale(locale) },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

const PERSON_ID: string = "9762a000-0000-4000-8000-000000000001";
const ADMIN_ID: string = "9762a000-0000-4000-8000-000000000002";

const STATUS: UserAuthenticationStatus = {
  hasPassword: true,
  isEmailVerified: true,
  isTwoFactorAuthEnabled: true,
  twoFactorAuthStatus: TwoFactorAuthStatus.EnabledConfigured,
  verifiedTwoFactorAuthMethodCount: 2,
  unusedTwoFactorBackupCodeCount: 8,
  hasPendingPasswordResetLink: false,
  isMasterAdmin: false,
  signInManagedBy: null,
};

interface Asked {
  method: HTTPMethod;
  url: string;
  data: JSONObject | undefined;
}

let asked: Array<Asked> = [];
let status: UserAuthenticationStatus = STATUS;
let clearAnswer: HTTPResponse<JSONObject> | HTTPErrorResponse;

beforeEach(() => {
  asked = [];
  status = { ...STATUS };
  clearAnswer = new HTTPResponse<JSONObject>(
    200,
    {
      cleared: {
        hasPassword: true,
        isTwoFactorAuthEnabled: true,
        authenticatorAppCount: 1,
        passkeyAndSecurityKeyCount: 1,
        backupCodeCount: 8,
      },
      sessionsEnded: 1,
    },
    {},
  );

  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(
    new ObjectID(PERSON_ID),
  );
  getJestSpyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(ADMIN_ID));

  getJestSpyOn(API, "fetch").mockImplementation(
    async (options: unknown): Promise<unknown> => {
      const request: { method: HTTPMethod; url: URL; data?: JSONObject } =
        options as { method: HTTPMethod; url: URL; data?: JSONObject };
      const url: string = String(request.url);

      asked.push({ method: request.method, url, data: request.data });

      if (url.endsWith(`/user/${PERSON_ID}/${CLEAR_LOCAL_SIGN_IN_ACTION}`)) {
        return clearAnswer;
      }

      if (url.endsWith(`/user/${PERSON_ID}/authentication-status`)) {
        return new HTTPResponse<JSONObject>(
          200,
          status as unknown as JSONObject,
          {},
        );
      }

      return new HTTPErrorResponse(500, { message: "Not in this test." }, {});
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

async function renderIn(locale: string = "en"): Promise<void> {
  const instance: i18n = await instanceFor(locale);

  render(
    <I18nextProvider i18n={instance}>
      <UserAuthentication />
    </I18nextProvider>,
  );

  await flush();
}

function clears(): Array<Asked> {
  return asked.filter((call: Asked): boolean => {
    return (
      call.method === HTTPMethod.POST &&
      call.url.endsWith(`/${CLEAR_LOCAL_SIGN_IN_ACTION}`)
    );
  });
}

function statusReads(): number {
  return asked.filter((call: Asked): boolean => {
    return call.url.endsWith("/authentication-status");
  }).length;
}

function clearButton(): HTMLElement {
  return screen.getByRole("button", { name: "Clear Sign-In Settings" });
}

const EN: Record<string, string> = pageWords("en");

describe("what a password does for somebody SSO manages", () => {
  test("while the server requires SSO, Set Password and the reset link say it will not sign them in", async () => {
    status = { ...STATUS, signInManagedBy: SsoManagedBy.Server };

    await renderIn();

    expect(
      screen.getByTestId("set-password-sso-managed-warning"),
    ).toHaveTextContent(EN["ssoManagedByServerWarning"]!);
    expect(
      screen.getByTestId("reset-link-sso-managed-warning"),
    ).toHaveTextContent(EN["ssoManagedByServerWarning"]!);
  });

  test("while every project of theirs manages sign-in, the cards say a password opens none of them", async () => {
    status = { ...STATUS, signInManagedBy: SsoManagedBy.Projects };

    await renderIn();

    expect(
      screen.getByTestId("set-password-sso-managed-warning"),
    ).toHaveTextContent(EN["ssoManagedByProjectsWarning"]!);
    expect(
      screen.getByTestId("reset-link-sso-managed-warning"),
    ).toHaveTextContent(EN["ssoManagedByProjectsWarning"]!);
  });

  test("nothing is said for somebody SSO does not manage, a master admin included", async () => {
    status = { ...STATUS, isMasterAdmin: true, signInManagedBy: null };

    await renderIn();

    expect(
      screen.queryByTestId("set-password-sso-managed-warning"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("reset-link-sso-managed-warning"),
    ).not.toBeInTheDocument();
  });

  test("the warnings are sentences that name SSO", () => {
    for (const key of [
      "ssoManagedByServerWarning",
      "ssoManagedByProjectsWarning",
    ]) {
      expect(EN[key]).toMatch(/^[A-Z].*\.$/);
      expect(EN[key]).toContain("SSO");
    }
  });
});

describe("Clear Sign-In Settings", () => {
  test("is a card of its own, last, saying what it deletes", async () => {
    await renderIn();

    const heading: HTMLElement = screen.getByRole("heading", {
      name: EN["clearSignInCardTitle"]!,
    });

    expect(
      screen.getByText(EN["clearSignInCardDescription"]!),
    ).toBeInTheDocument();
    expect(clearButton()).toBeEnabled();

    // The last card on the page: danger comes last.
    const headings: Array<HTMLElement> = screen.getAllByRole("heading", {
      level: 2,
    });

    expect(headings[headings.length - 1]).toBe(heading);
  });

  test("asks first, saying it cannot be undone, and clears nothing until asked", async () => {
    await renderIn();

    fireEvent.click(clearButton());
    await flush();

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(dialog).toHaveTextContent(EN["clearSignInModalDescription"]!);
    expect(EN["clearSignInModalDescription"]).toContain(
      "This cannot be undone.",
    );
    expect(EN["clearSignInModalDescription"]!.length).toBeLessThanOrEqual(150);
    expect(
      within(dialog).queryByTestId("clear-sign-in-master-admin-confirmation"),
    ).not.toBeInTheDocument();
    expect(clears()).toHaveLength(0);
  });

  test("going ahead clears them, saying so, and reads the status again", async () => {
    await renderIn();

    const readsBefore: number = statusReads();

    fireEvent.click(clearButton());
    await flush();

    fireEvent.click(
      within(screen.getByRole("dialog")).getByTestId(
        "modal-footer-submit-button",
      ),
    );
    await flush();

    expect(clears()).toHaveLength(1);
    expect(clears()[0]!.data).toEqual({ isMasterAdminConfirmed: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(EN["clearSignInSuccess"]!)).toBeInTheDocument();
    expect(statusReads()).toBe(readsBefore + 1);
  });

  test("a refusal stays in the dialog, saying why", async () => {
    clearAnswer = new HTTPErrorResponse(
      400,
      { message: "Something the server refused." },
      {},
    );

    await renderIn();

    fireEvent.click(clearButton());
    await flush();

    fireEvent.click(
      within(screen.getByRole("dialog")).getByTestId(
        "modal-footer-submit-button",
      ),
    );
    await flush();

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Something the server refused.",
    );
    expect(
      screen.queryByText(EN["clearSignInSuccess"]!),
    ).not.toBeInTheDocument();
  });

  test("a master admin's are cleared only once the dialog's box says they are one", async () => {
    status = { ...STATUS, isMasterAdmin: true };

    await renderIn();

    fireEvent.click(clearButton());
    await flush();

    const dialog: HTMLElement = screen.getByRole("dialog");
    const submit: HTMLElement = within(dialog).getByTestId(
      "modal-footer-submit-button",
    );

    expect(dialog).toHaveTextContent(EN["clearSignInMasterAdminConfirmation"]!);
    expect(submit).toBeDisabled();

    fireEvent.click(submit);
    await flush();

    expect(clears()).toHaveLength(0);

    const box: HTMLElement = within(dialog).getByTestId(
      "clear-sign-in-master-admin-confirmation",
    );

    expect(box).toHaveAttribute("type", "checkbox");
    expect(box).not.toBeChecked();

    fireEvent.click(box);
    await flush();

    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    await flush();

    expect(clears()).toHaveLength(1);
    expect(clears()[0]!.data).toEqual({ isMasterAdminConfirmed: true });
  });

  test("closing the dialog forgets the box, so a master admin is asked again", async () => {
    status = { ...STATUS, isMasterAdmin: true };

    await renderIn();

    fireEvent.click(clearButton());
    await flush();

    fireEvent.click(
      screen.getByTestId("clear-sign-in-master-admin-confirmation"),
    );
    await flush();

    fireEvent.click(
      within(screen.getByRole("dialog")).getByTestId(
        "modal-footer-close-button",
      ),
    );
    await flush();

    fireEvent.click(clearButton());
    await flush();

    expect(
      within(screen.getByRole("dialog")).getByTestId(
        "modal-footer-submit-button",
      ),
    ).toBeDisabled();
  });

  test("the server's own refusal for an unconfirmed master admin is a sentence", () => {
    expect(CLEAR_MASTER_ADMIN_SIGN_IN_NOT_CONFIRMED_MESSAGE).toMatch(
      /^[A-Z].*\.$/,
    );
  });

  test("your own account cannot be cleared here, and says where yours are", async () => {
    getJestSpyOn(UserUtil, "getUserId").mockReturnValue(
      new ObjectID(PERSON_ID),
    );

    await renderIn();

    expect(clearButton()).toBeDisabled();

    fireEvent.click(clearButton());
    await flush();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(EN["clearSignInOwnAccountTooltip"]).toContain("User Profile");
  });
});

describe("in every language", () => {
  test.each([...ADMIN_DASHBOARD_LANGUAGES])(
    "%s draws the warning, the card and the dialog in that language",
    async (locale: string) => {
      status = {
        ...STATUS,
        isMasterAdmin: true,
        signInManagedBy: SsoManagedBy.Server,
      };
      const words: Record<string, string> = pageWords(locale);

      for (const key of [
        "ssoManagedByServerWarning",
        "ssoManagedByProjectsWarning",
        "clearSignInCardTitle",
        "clearSignInCardDescription",
        "clearSignInButton",
        "clearSignInOwnAccountTooltip",
        "clearSignInModalTitle",
        "clearSignInModalDescription",
        "clearSignInMasterAdminConfirmation",
        "clearSignInModalSubmit",
        "clearSignInSuccess",
      ]) {
        expect([key, typeof words[key]]).toEqual([key, "string"]);
        expect([key, words[key]]).not.toEqual([key, EN[key]]);
      }

      await renderIn(locale);

      expect(
        screen.getByTestId("set-password-sso-managed-warning"),
      ).toHaveTextContent(words["ssoManagedByServerWarning"]!);

      fireEvent.click(
        screen.getByRole("button", { name: words["clearSignInButton"]! }),
      );
      await flush();

      const dialog: HTMLElement = screen.getByRole("dialog");

      expect(dialog).toHaveTextContent(words["clearSignInModalDescription"]!);
      expect(dialog).toHaveTextContent(
        words["clearSignInMasterAdminConfirmation"]!,
      );
    },
  );
});
