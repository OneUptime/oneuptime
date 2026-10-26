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
import DashboardThemeUtil from "../../../../App/FeatureSet/PublicDashboard/src/Utils/DashboardTheme";
import PublicDashboardUtil from "../../../../App/FeatureSet/PublicDashboard/src/Utils/PublicDashboard";
import MasterPasswordPage from "../../../../App/FeatureSet/PublicDashboard/src/Pages/MasterPassword/MasterPassword";
import {
  MASTER_PASSWORD_COPY,
  MASTER_PASSWORD_PROMPT_TEST_ID,
  MASTER_PASSWORD_TITLE_TEST_ID,
} from "../../../../App/FeatureSet/PublicDashboard/src/Pages/MasterPassword/MasterPasswordCopy";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * What a public dashboard's password prompt says (issue #5079's follow-up,
 * #5106): the dashboard's name as its title, then what to do, once - under
 * it, "Enter the password to view this dashboard." - then the field, named
 * Password, and Unlock Dashboard.
 *
 * It used to say the same thing three times: "Enter <name> Password" as the
 * title, "Please enter the password to view this dashboard." under it, and
 * "Enter the password to unlock this dashboard." under the field - with
 * "Enter password" in the field too.
 */

const DASHBOARD_ID: string = "ab000000-0000-4000-8000-0000000000c2";

// "enter the password", "Enter password", in any case: the instruction.
const ENTER_PASSWORD: RegExp = /enter (the )?password/i;

// The words a button that opens the dashboard would say.
const CALL_TO_ACTION: RegExp = /unlock|view|open/i;

const renderPrompt: (dashboardName: string) => Promise<void> = async (
  dashboardName: string,
): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter>
        <MasterPasswordPage dashboardName={dashboardName} />
      </MemoryRouter>,
    );
  });
};

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(
    null,
    "",
    `/public-dashboard/${DASHBOARD_ID}/master-password`,
  );
  (
    DashboardThemeUtil as unknown as { linkTheme: string | null | undefined }
  ).linkTheme = undefined;
  PublicDashboardUtil.setDashboardId(new ObjectID(DASHBOARD_ID));
  PublicDashboardUtil.setRequiresMasterPassword(true);
  PublicDashboardUtil.setMasterPasswordValidated(false);
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("a public dashboard's password prompt", () => {
  test("its title is the dashboard it opens", async () => {
    await renderPrompt("Checkout Health");

    const title: HTMLElement = screen.getByTestId(
      MASTER_PASSWORD_TITLE_TEST_ID,
    );

    expect(title).toHaveTextContent(/^Checkout Health$/);
    expect(title.tagName).toBe("H2");
    expect(screen.queryByText("Enter Checkout Health Password")).toBeNull();
  });

  test("it says what to do once, under the title", async () => {
    await renderPrompt("Checkout Health");

    expect(
      screen.getByTestId(MASTER_PASSWORD_PROMPT_TEST_ID),
    ).toHaveTextContent(/^Enter the password to view this dashboard\.$/);

    const said: Array<HTMLElement> = screen.getAllByText(ENTER_PASSWORD);

    expect(said).toEqual([screen.getByTestId(MASTER_PASSWORD_PROMPT_TEST_ID)]);
  });

  test("the field is named Password, with no description and nothing typed in it", async () => {
    await renderPrompt("Checkout Health");

    const field: HTMLElement = screen.getByLabelText(
      MASTER_PASSWORD_COPY.passwordLabel,
    );

    expect(field).toHaveAttribute("type", "password");
    expect(field.getAttribute("placeholder") || "").toBe("");
    expect(
      screen.queryByText("Enter the password to unlock this dashboard."),
    ).toBeNull();
    expect(screen.queryByPlaceholderText("Enter password")).toBeNull();
  });

  test("Unlock Dashboard is the one action, under the field", async () => {
    await renderPrompt("Checkout Health");

    const submit: HTMLElement = screen.getByRole("button", {
      name: MASTER_PASSWORD_COPY.submit,
    });
    const field: HTMLElement = screen.getByLabelText(
      MASTER_PASSWORD_COPY.passwordLabel,
    );

    expect(
      field.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Nothing else on the prompt is a call to action.
    expect(
      screen.getAllByRole("button").filter((button: HTMLElement): boolean => {
        return CALL_TO_ACTION.test(button.textContent || "");
      }),
    ).toEqual([submit]);
  });

  test("a long name wraps rather than running off a phone's screen", async () => {
    await renderPrompt("A".repeat(200));

    expect(screen.getByTestId(MASTER_PASSWORD_TITLE_TEST_ID)).toHaveClass(
      "break-words",
    );
  });

  test("the words are these, and the old ones are gone", () => {
    expect(MASTER_PASSWORD_COPY).toEqual({
      fallbackTitle: "Dashboard",
      prompt: "Enter the password to view this dashboard.",
      passwordLabel: "Password",
      submit: "Unlock Dashboard",
      passwordRequired: "Password is required.",
    });
  });
});
