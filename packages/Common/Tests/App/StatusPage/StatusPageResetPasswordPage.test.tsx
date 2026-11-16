import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Route from "../../../Types/API/Route";
import { RESET_LINK_MESSAGES } from "../../../Types/Accounts/SignInMessages";
import ObjectID from "../../../Types/ObjectID";
import { PASSWORD_RULE_MESSAGES } from "../../../Types/Password";
import Navigation from "../../../UI/Utils/Navigation";
import SensitiveUrlToken from "../../../UI/Utils/SensitiveUrlToken";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import english from "../../../../App/FeatureSet/StatusPage/src/Locales/en.json";

/*
 * A status page's Reset Password page (#9123): the one password rule with its
 * checklist, where the form asked for six characters, and one button that
 * leads on wherever the reset ends, where it ended in "Your password has been
 * updated. Please log in." or the server's "Expired link. Please go to forgot
 * password page again", with nothing to click.
 */

jest.mock("react-i18next", () => {
  const locale: Record<string, unknown> = jest.requireActual(
    "../../../../App/FeatureSet/StatusPage/src/Locales/en.json",
  ) as Record<string, unknown>;

  const translate: (
    key: string,
    options?: Record<string, unknown>,
  ) => string = (key: string, options?: Record<string, unknown>): string => {
    let node: unknown = locale[key];

    if (typeof node !== "string") {
      node = locale;

      for (const part of key.split(".")) {
        node =
          node !== null && typeof node === "object"
            ? (node as Record<string, unknown>)[part]
            : undefined;
      }
    }

    if (typeof node !== "string") {
      return key;
    }

    return node.replace(/\{\{(\w+)\}\}/g, (match: string, name: string) => {
      return options?.[name] === undefined ? match : String(options[name]);
    });
  };

  return {
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

import StatusPageUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import UserUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/User";
import ResetPasswordPage from "../../../../App/FeatureSet/StatusPage/src/Pages/Accounts/ResetPassword";

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "57000000-0000-4000-8000-000000000100",
);
const LOGO_FILE_ID: ObjectID = new ObjectID(
  "57000000-0000-4000-8000-000000000200",
);
const RESET_TOKEN: string = "6f1c7e4a-2b3d-4c5e-8f90-a1b2c3d4e5f6";
const STRONG_PASSWORD: string = "violet river lantern";

const words: typeof english.accounts.resetPassword =
  english.accounts.resetPassword;

function navigatedTo(): Array<string> {
  return jest
    .mocked(Navigation.navigate)
    .mock.calls.map((call: Array<unknown>): string => {
      return (call[0] as Route).toString();
    });
}

const renderPage: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    render(
      <ResetPasswordPage
        statusPageName="Customer Status"
        logoFileId={LOGO_FILE_ID}
        forceSSO={false}
      />,
    );
  });

  await waitFor(() => {
    expect(document.querySelectorAll("input[type='password']")).toHaveLength(2);
  });
};

const typePasswords: (password: string) => void = (password: string): void => {
  const inputs: Array<HTMLInputElement> = Array.from(
    document.querySelectorAll<HTMLInputElement>("input[type='password']"),
  );

  for (const input of inputs) {
    fireEvent.change(input, { target: { value: password } });
  }
};

const submit: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: words.submit }));
  });

  await act(async () => {
    for (let tick: number = 0; tick < 20; tick++) {
      await Promise.resolve();
    }
  });
};

beforeEach(() => {
  createOrUpdateMock.mockReset();

  getJestSpyOn(StatusPageUtil, "getStatusPageId").mockReturnValue(
    STATUS_PAGE_ID,
  );
  getJestSpyOn(StatusPageUtil, "isPrivateStatusPage").mockReturnValue(true);
  getJestSpyOn(StatusPageUtil, "isPreviewPage").mockReturnValue(false);
  getJestSpyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
  getJestSpyOn(Navigation, "navigate").mockImplementation(() => {});
  getJestSpyOn(SensitiveUrlToken, "read").mockReturnValue(RESET_TOKEN);
  getJestSpyOn(SensitiveUrlToken, "clear").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the form asks the one password rule", () => {
  test("shows the checklist before anything is typed", async () => {
    await renderPage();

    expect(screen.getByTestId("password-requirements")).toHaveTextContent(
      "Use at least 15 characters.",
    );
  });

  test("the six characters it used to take are refused before anything is sent", async () => {
    await renderPage();

    typePasswords("abc123");
    await submit();

    expect(createOrUpdateMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("password-requirements")).toHaveTextContent(
      PASSWORD_RULE_MESSAGES.tooShort,
    );
  });
});

describe("the reset ends in one button that leads on", () => {
  test("a reset ends in Log In", async () => {
    createOrUpdateMock.mockResolvedValue({ data: {} } as never);

    await renderPage();
    typePasswords(STRONG_PASSWORD);
    await submit();

    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("reset-password-success")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      words.successTitle,
    );

    fireEvent.click(screen.getByTestId("reset-password-log-in"));

    expect(navigatedTo()).toEqual(["/login"]);
  });

  test.each([
    [RESET_LINK_MESSAGES.expired, words.linkExpiredTitle],
    [RESET_LINK_MESSAGES.invalid, words.linkInvalidTitle],
  ])(
    "a dead link (%s) ends in Request a New Link",
    async (refusal: string, title: string) => {
      createOrUpdateMock.mockRejectedValue(
        new HTTPErrorResponse(400, { message: refusal }, {}) as never,
      );

      await renderPage();
      typePasswords(STRONG_PASSWORD);
      await submit();

      expect(
        screen.getByTestId("reset-password-link-problem"),
      ).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        title,
      );

      fireEvent.click(screen.getByTestId("reset-password-request-new-link"));

      expect(navigatedTo()).toEqual(["/forgot-password"]);
      expect(SensitiveUrlToken.clear).not.toHaveBeenCalled();
    },
  );
});
