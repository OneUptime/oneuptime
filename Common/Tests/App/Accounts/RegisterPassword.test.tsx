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
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import User from "../../../Models/DatabaseModels/User";
import { JSONObject } from "../../../Types/JSON";
import * as UIConfig from "../../../UI/Config";
import UiAnalytics from "../../../UI/Utils/Analytics";
import LoginUtil from "../../../UI/Utils/Login";
import ModelAPI, {
  ModelAPIHttpResponse,
} from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";
import "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import RegisterPage from "../../../../App/FeatureSet/Accounts/src/Pages/Register";

jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual(
      "../../../UI/Config",
    ) as typeof import("../../../UI/Config")),
    __esModule: true,
    BILLING_ENABLED: false,
    CAPTCHA_ENABLED: false,
  };
});

const USER_JSON: JSONObject = {
  _id: "33333333-3333-4333-8333-333333333333",
  email: "ada@example.com",
  name: "Ada Lovelace",
};
const VALID_PASSWORD: string = "lantern river meadow";

async function renderPage(): Promise<void> {
  render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  );
  await screen.findByTestId("password");
  await waitFor(() => {
    expect(screen.getByTestId("email")).toHaveValue("ada@example.com");
  });
}

async function setField(name: string, value: string): Promise<void> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
    delay: null,
  });
  const input: HTMLElement = screen.getByTestId(name);
  await user.clear(input);
  if (value) {
    await user.paste(value);
  }
}

async function fillForm(
  password: string,
  confirmation: string = password,
): Promise<void> {
  await setField("name", "Ada Lovelace");
  if (UIConfig.BILLING_ENABLED) {
    await setField("companyName", "Analytical Engines");
    await setField("companyPhoneNumber", "+14155552671");
  }
  await setField("password", password);
  await setField("confirmPassword", confirmation);
  expect(screen.getByTestId("email")).toHaveValue("ada@example.com");
  expect(screen.getByTestId("name")).toHaveValue("Ada Lovelace");
  expect(screen.getByTestId("password")).toHaveValue(password);
  expect(screen.getByTestId("confirmPassword")).toHaveValue(confirmation);
}

async function submit(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Sign Up" }));
  });
}

function errorMessages(): Array<string> {
  return screen
    .queryAllByTestId("error-message")
    .map((element: HTMLElement) => {
      return element.textContent || "";
    });
}

/*
 * Exercise the actual Register -> ModelForm -> BasicForm validation and input
 * components, with external services mocked. A missing validator or a footer
 * that does not receive the current form value fails these regressions.
 * Use the supported email-link prefill flow: the shared Email input loses
 * synthetic paste events in jsdom. Browser tests cover entering an email on
 * the ordinary signup form; these tests keep the real email validation.
 */
describe("Signup password requirements", () => {
  beforeEach(() => {
    Object.defineProperty(UIConfig, "BILLING_ENABLED", { value: false });
    jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
    jest.spyOn(UserUtil, "getUtmParams").mockReturnValue({});
    jest.spyOn(UserUtil, "getAttributionClickIds").mockReturnValue(null);
    jest.spyOn(UserUtil, "getFirstTouchAttribution").mockReturnValue(null);
    jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
    jest
      .spyOn(Navigation, "getQueryStringByName")
      .mockImplementation((key: string): string => {
        return key === "email" ? "ada@example.com" : "";
      });
    jest.spyOn(UiAnalytics, "userAuth").mockImplementation(() => {});
    jest.spyOn(UiAnalytics, "capture").mockImplementation(() => {});
    jest.spyOn(UiAnalytics, "captureRevenueEvent").mockImplementation(() => {});
    jest.spyOn(LoginUtil, "login").mockImplementation(() => {});
    jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockImplementation(async (): Promise<ModelAPIHttpResponse<User>> => {
        const response: ModelAPIHttpResponse<User> =
          new ModelAPIHttpResponse<User>(200, USER_JSON, {});
        response.miscData = { token: "signup-session" };
        return response;
      });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("starts with helpful guidance associated with the password input", async () => {
    await renderPage();
    const password: HTMLElement = screen.getByLabelText("Password");
    const requirements: HTMLElement = screen.getByRole("status");
    expect(requirements).toHaveTextContent("Use at least 15 characters.");
    expect(requirements).toHaveTextContent("Try a few unrelated words.");
    expect(requirements).toHaveAttribute("aria-live", "polite");
    expect(requirements).toHaveAttribute("aria-atomic", "true");
    expect(password).toHaveAttribute("aria-describedby", requirements.id);
    expect(password).toHaveAccessibleDescription(
      "Use at least 15 characters. Try a few unrelated words.",
    );
    expect(password).toHaveAttribute("type", "password");
    expect(password).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(ModelAPI.createOrUpdate).not.toHaveBeenCalled();
  });

  test("lets password managers generate a new password for both inputs", async () => {
    await renderPage();
    expect(screen.getByTestId("password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(screen.getByTestId("confirmPassword")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });

  test("updates feedback while typing and removes success when weakened or cleared", async () => {
    await renderPage();
    await setField("password", "river");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Use at least 15 characters.",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await setField("password", VALID_PASSWORD);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Password meets requirements",
    );
    expect(screen.getByRole("status")).toHaveClass("text-emerald-800");
    expect(screen.getByRole("status")).not.toHaveTextContent(VALID_PASSWORD);

    await setField("password", "river");
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "Password meets requirements",
    );
    await setField("password", "");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Use at least 15 characters.",
    );
    expect(screen.getByRole("status")).not.toHaveClass("text-emerald-800");
  });

  test.each([
    [
      "six characters previously accepted",
      "test12",
      "Password must be at least 15 characters.",
    ],
    [
      "one character below the minimum",
      "river lantern!",
      "Password must be at least 15 characters.",
    ],
    [
      "Unicode below the minimum",
      "🌲river lantern",
      "Password must be at least 15 characters.",
    ],
    [
      "a common password with digits",
      "password123456789",
      "Choose a less predictable password. Try a few unrelated words.",
    ],
    [
      "a repeated character",
      "aaaaaaaaaaaaaaa",
      "Choose a less predictable password. Try a few unrelated words.",
    ],
    ["only whitespace", "               ", "Password cannot be blank."],
    [
      "more than 100 characters",
      "orange violet lagoon lantern ".repeat(4).slice(0, 101),
      "Password cannot be more than 100 characters.",
    ],
  ])(
    "blocks %s before contacting the signup API",
    async (_label: string, password: string, message: string) => {
      await renderPage();
      await fillForm(password);
      await submit();
      await waitFor(() => {
        expect(errorMessages()).toContain(message);
      });
      expect(screen.getByTestId("password")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(ModelAPI.createOrUpdate).not.toHaveBeenCalled();
      expect(LoginUtil.login).not.toHaveBeenCalled();
      expect(UiAnalytics.captureRevenueEvent).not.toHaveBeenCalled();
    },
  );

  test("blocks a missing password even when confirmation is present", async () => {
    await renderPage();
    await fillForm("", VALID_PASSWORD);
    await submit();
    expect(errorMessages()).toContain("Password is required.");
    expect(ModelAPI.createOrUpdate).not.toHaveBeenCalled();
  });

  test("explains a predictable password as soon as it is entered", async () => {
    await renderPage();
    await setField("password", "password123456789");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Choose a less predictable password. Try a few unrelated words.",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "Password meets requirements",
    );
  });

  test("validates a weak password on blur", async () => {
    await renderPage();
    await setField("password", "test12");
    await act(async () => {
      fireEvent.blur(screen.getByTestId("password"));
    });
    expect(errorMessages()).toContain(
      "Password must be at least 15 characters.",
    );
    expect(ModelAPI.createOrUpdate).not.toHaveBeenCalled();
  });

  test("also blocks weak passwords submitted with Enter", async () => {
    await renderPage();
    await fillForm("test12");
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("confirmPassword"), {
        key: "Enter",
      });
    });
    expect(errorMessages()).toContain(
      "Password must be at least 15 characters.",
    );
    expect(ModelAPI.createOrUpdate).not.toHaveBeenCalled();
  });

  test.each([
    ["a lowercase password at the minimum", "lanternriverfox"],
    ["a passphrase with spaces", VALID_PASSWORD],
    ["Unicode at the minimum", "🌲 river lantern"],
    ["leading and trailing spaces", ` ${VALID_PASSWORD} `],
    ["100 characters", "orange violet lagoon lantern ".repeat(4).slice(0, 100)],
  ])(
    "accepts %s and preserves the exact password",
    async (_label: string, password: string) => {
      await renderPage();
      await fillForm(password);
      expect(screen.getByRole("status")).toHaveTextContent(
        "Password meets requirements",
      );
      await submit();
      expect(errorMessages()).toEqual([]);
      await waitFor(() => {
        expect(ModelAPI.createOrUpdate).toHaveBeenCalledTimes(1);
      });
      const request: Parameters<typeof ModelAPI.createOrUpdate>[0] =
        jest.mocked(ModelAPI.createOrUpdate).mock.calls[0]![0];
      expect((request.model as User).password?.toString()).toBe(password);
      expect(request.requestOptions?.overrideRequestUrl?.toString()).toContain(
        "/signup",
      );
      expect(LoginUtil.login).toHaveBeenCalledWith({
        user: expect.any(User),
        token: "signup-session",
      });
    },
  );

  test("accepts pasting a passphrase without modifying it", async () => {
    await renderPage();
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });
    await user.click(screen.getByTestId("password"));
    await user.paste(VALID_PASSWORD);
    expect(screen.getByTestId("password")).toHaveValue(VALID_PASSWORD);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Password meets requirements",
    );
  });

  test.each([
    ["a different password", "meadow lantern river"],
    ["an empty confirmation", ""],
    ["different leading spaces", ` ${VALID_PASSWORD}`],
    ["different trailing spaces", `${VALID_PASSWORD} `],
  ])(
    "rejects %s in confirmation",
    async (_label: string, confirmation: string) => {
      await renderPage();
      await fillForm(VALID_PASSWORD, confirmation);
      await submit();
      expect(errorMessages()).toContain(
        confirmation
          ? "Confirm Password should match Password"
          : "Confirm Password is required.",
      );
      expect(ModelAPI.createOrUpdate).not.toHaveBeenCalled();
    },
  );

  test("allows correcting a rejected password and completing signup", async () => {
    await renderPage();
    await fillForm("test12");
    await submit();
    expect(ModelAPI.createOrUpdate).not.toHaveBeenCalled();

    await setField("password", VALID_PASSWORD);
    await setField("confirmPassword", VALID_PASSWORD);
    await submit();
    expect(ModelAPI.createOrUpdate).toHaveBeenCalledTimes(1);
    expect(LoginUtil.login).toHaveBeenCalledTimes(1);
  });

  test("enforces the same requirements on hosted signup", async () => {
    Object.defineProperty(UIConfig, "BILLING_ENABLED", { value: true });
    await renderPage();
    await fillForm("test12");
    await submit();
    expect(errorMessages()).toContain(
      "Password must be at least 15 characters.",
    );
    expect(ModelAPI.createOrUpdate).not.toHaveBeenCalled();

    await setField("password", VALID_PASSWORD);
    await setField("confirmPassword", VALID_PASSWORD);
    await submit();
    expect(ModelAPI.createOrUpdate).toHaveBeenCalledTimes(1);
  });

  test("shows an API rejection and allows retrying without changing the password", async () => {
    jest
      .mocked(ModelAPI.createOrUpdate)
      .mockRejectedValueOnce(
        new Error(
          "Choose a less predictable password. Try a few unrelated words.",
        ),
      );
    await renderPage();
    await fillForm(VALID_PASSWORD);
    await submit();
    expect(
      await screen.findByText(
        "Choose a less predictable password. Try a few unrelated words.",
      ),
    ).toBeVisible();
    expect(ModelAPI.createOrUpdate).toHaveBeenCalledTimes(1);
    expect(LoginUtil.login).not.toHaveBeenCalled();
    expect(screen.getByTestId("password")).toHaveValue(VALID_PASSWORD);
    await submit();
    expect(errorMessages()).toEqual([]);
    await waitFor(() => {
      expect(LoginUtil.login).toHaveBeenCalledTimes(1);
    });
    expect(ModelAPI.createOrUpdate).toHaveBeenCalledTimes(2);
    expect(
      (
        jest.mocked(ModelAPI.createOrUpdate).mock.calls[1]![0].model as User
      ).password?.toString(),
    ).toBe(VALID_PASSWORD);
  });
});
