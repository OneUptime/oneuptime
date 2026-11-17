import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import english from "../../../../App/FeatureSet/StatusPage/src/Locales/en.json";

/*
 * A PRIVATE STATUS PAGE'S FORGOT PASSWORD SAYS THE SAME TO EVERY ADDRESS
 * (#9274).
 *
 * POST /status-page/forgot-password answers every address with success, and
 * emails a reset link only to a private user of the page. So the page, once
 * it is answered, must not claim a link went out - for an address that may
 * not sign in, none did - nor say anything that tells the reader whether
 * the address has access. It says a link went out IF the address can sign
 * in to the page, in every status page language.
 *
 * The real page; only the network, the page's form API and the words are
 * stubbed. Copy resolves against the status page's real en.json.
 */

jest.mock("react-i18next", () => {
  const locale: Record<string, unknown> = jest.requireActual(
    "../../../../App/FeatureSet/StatusPage/src/Locales/en.json",
  ) as Record<string, unknown>;

  const translate: (
    key: string,
    options?: Record<string, unknown>,
  ) => string = (key: string, options?: Record<string, unknown>): string => {
    let node: unknown = locale;

    for (const part of key.split(".")) {
      node =
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined;
    }

    if (typeof node !== "string") {
      // A flat key, as the shared form components look their words up.
      const flat: unknown = locale[key];
      return typeof flat === "string" ? flat : key;
    }

    return node.replace(/\{\{(\w+)\}\}/g, (_match: string, name: string) => {
      return String(options?.[name] ?? "");
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
import ForgotPasswordPage from "../../../../App/FeatureSet/StatusPage/src/Pages/Accounts/ForgotPassword";

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "57000000-0000-4000-8000-000000000140",
);
const LOGO_FILE_ID: ObjectID = new ObjectID(
  "57000000-0000-4000-8000-000000000240",
);
const PAGE_NAME: string = "Customer Status";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/StatusPage/src/Locales",
);

const ENGLISH_ANSWER: string =
  "If this email address can sign in to {{statusPageName}}, we have emailed it a password reset link. Please do not forget to check spam.";

beforeEach(() => {
  createOrUpdateMock.mockReset();
  createOrUpdateMock.mockResolvedValue({ data: {} });

  getJestSpyOn(StatusPageUtil, "getStatusPageId").mockReturnValue(
    STATUS_PAGE_ID,
  );
  getJestSpyOn(StatusPageUtil, "isPrivateStatusPage").mockReturnValue(true);
  getJestSpyOn(StatusPageUtil, "isPreviewPage").mockReturnValue(false);
  getJestSpyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
  getJestSpyOn(Navigation, "navigate").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function askFor(email: string, statusPageName: string): Promise<void> {
  await act(async () => {
    render(
      <ForgotPasswordPage
        statusPageName={statusPageName}
        logoFileId={LOGO_FILE_ID}
        forceSSO={false}
      />,
    );
  });

  await act(async () => {
    fireEvent.change(screen.getByLabelText(english.accounts.shared.email), {
      target: { value: email },
    });
  });

  await act(async () => {
    fireEvent.click(
      screen.getByTestId(english.accounts.forgotPassword.sendLink),
    );
  });

  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
  });
}

describe("a private status page's Forgot password, once answered", () => {
  test.each([
    ["a private user of the page", "reader@example.com"],
    ["a private user with no password yet", "invited@example.com"],
    ["an address that may not sign in", "stranger@example.com"],
  ])(
    "%s: says a link went out if the address can sign in to the page",
    async (_kind: string, email: string) => {
      await askFor(email, PAGE_NAME);

      expect(
        await screen.findByText(
          ENGLISH_ANSWER.replace("{{statusPageName}}", PAGE_NAME),
        ),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("forgot-password-card")).toBeNull();
      // Never the address itself, nor whether it may sign in.
      expect(document.body.textContent).not.toContain(email);
      expect(document.body.textContent).not.toMatch(
        /no user|not registered|emailed you the password reset link/i,
      );
    },
  );

  test("asks this page's identity API, for this page", async () => {
    await askFor("reader@example.com", PAGE_NAME);

    const call: {
      model: { email?: { toString: () => string }; statusPageId?: ObjectID };
      requestOptions?: { overrideRequestUrl?: URL };
    } = (
      createOrUpdateMock.mock.calls[0] as Array<{
        model: {
          email?: { toString: () => string };
          statusPageId?: ObjectID;
        };
        requestOptions?: { overrideRequestUrl?: URL };
      }>
    )[0]!;

    expect(call.model.email?.toString()).toBe("reader@example.com");
    expect(call.model.statusPageId?.toString()).toBe(STATUS_PAGE_ID.toString());
    expect(
      new globalThis.URL(call.requestOptions!.overrideRequestUrl!.toString())
        .pathname,
    ).toMatch(/\/forgot-password$/);
  });

  test("a page with no name yet is called a status page", async () => {
    await askFor("reader@example.com", "");

    expect(
      await screen.findByText(
        ENGLISH_ANSWER.replace("{{statusPageName}}", english.common.statusPage),
      ),
    ).toBeInTheDocument();
  });
});

describe("the answer, in every status page language", () => {
  const locales: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    });

  test("the English is the one the page draws", () => {
    expect(english.accounts.forgotPassword.success).toBe(ENGLISH_ANSWER);
  });

  test("there are languages to check", () => {
    expect(locales.length).toBeGreaterThanOrEqual(17);
  });

  test.each(locales)(
    "%s says it in its own words, naming the page",
    (file: string) => {
      const words: {
        accounts?: { forgotPassword?: { success?: string } };
      } = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"));
      const answer: string | undefined =
        words.accounts?.forgotPassword?.success;

      expect(answer).toBeTruthy();
      expect(answer).not.toBe(ENGLISH_ANSWER);
      expect(answer).toContain("{{statusPageName}}");
    },
  );
});
