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
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * "Who can see this status page", the card on a status page's Security ->
 * Access page: anyone with the link, only people who sign in, or anyone
 * with the password - one choice, where there were two switches behind two
 * Edit buttons and a "Set Master Password" button.
 *
 * - The checked choice is what the server enforces now: a private page
 *   whose password switch is on with no password set is a sign-in page.
 * - Picking another asks first; confirming writes only the columns that
 *   change (the public switch needs Growth to change, and a write carrying
 *   it is refused below Growth, changed or not). A move to the password asks
 *   for one in the same dialog when none is set, so the page never claims
 *   a password it does not have.
 * - Under "Only people who sign in": the sign-in methods set up, linking to
 *   their pages, and - while it is the choice - a warning when nobody can
 *   sign in yet. Under the password, while it is the choice: Change
 *   Password, which writes the password alone.
 * - A choice the plan does not include shows the plan and cannot be picked;
 *   someone who may not change it sees every choice locked, with why.
 *
 * Only the network, the permission gate and the plan are stubbed; the card,
 * the choices, the dialogs and the form are the real ones.
 */

/*
 * A refused request is an async function that throws, not
 * mockRejectedValue: the card's imports load zone.js, whose patched Promise
 * reports a rejected one as unhandled although the card catches it.
 */
const getItemMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      count: (...args: Array<unknown>): unknown => {
        return countMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

import StatusPageAccessCard from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageAccessCard";
import StatusPageAccessCopy, {
  ACCESS_CHOICE_COPY,
  ACCESS_CONFIRMATION_COPY,
  getAccessChoiceTestId,
  STATUS_PAGE_ACCESS_CARD_TEST_ID,
  STATUS_PAGE_ACCESS_CHANGE_PASSWORD_TEST_ID,
  STATUS_PAGE_ACCESS_NOBODY_CAN_SIGN_IN_TEST_ID,
  STATUS_PAGE_ACCESS_SIGN_IN_METHODS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageAccessCopy";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageOIDC from "../../../Models/DatabaseModels/StatusPageOidc";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import StatusPageSSO from "../../../Models/DatabaseModels/StatusPageSso";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { StatusPageAccess } from "../../../Types/StatusPage/StatusPageAccess";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "5a5a5a5a-0000-4000-8000-0000000000aa";
const STATUS_PAGE_ID: string = "5b5b5b5b-0000-4000-8000-0000000000bb";

interface StoredPage {
  isPublicStatusPage: boolean;
  enableMasterPassword: boolean;
  hasMasterPassword: boolean;
  requireSsoForLogin: boolean;
}

const PUBLIC_PAGE: StoredPage = {
  isPublicStatusPage: true,
  enableMasterPassword: false,
  hasMasterPassword: false,
  requireSsoForLogin: false,
};

const SIGN_IN_PAGE: StoredPage = {
  isPublicStatusPage: false,
  enableMasterPassword: false,
  hasMasterPassword: false,
  requireSsoForLogin: false,
};

const PASSWORD_PAGE: StoredPage = {
  isPublicStatusPage: false,
  enableMasterPassword: true,
  hasMasterPassword: true,
  requireSsoForLogin: false,
};

interface Counts {
  privateUsers: number | Error;
  sso: number | Error;
  oidc: number | Error;
}

let stored: StoredPage | null | Error = PUBLIC_PAGE;
let counts: Counts = { privateUsers: 3, sso: 1, oidc: 0 };
let gate: PermissionGateResult = { isAllowed: true };
let plan: PlanType | null = null;
let refusal: Error | null = null;

const PLAN_ORDER: Array<PlanType> = [
  PlanType.Free,
  PlanType.Growth,
  PlanType.Scale,
  PlanType.Enterprise,
];

beforeEach(() => {
  stored = { ...PUBLIC_PAGE };
  counts = { privateUsers: 3, sso: 1, oidc: 0 };
  gate = { isAllowed: true };
  plan = null;
  refusal = null;

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    if (stored instanceof Error) {
      throw stored;
    }

    if (!stored) {
      return null;
    }

    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID;
    page.isPublicStatusPage = stored.isPublicStatusPage;
    page.enableMasterPassword = stored.enableMasterPassword;
    page.requireSsoForLogin = stored.requireSsoForLogin;

    if (stored.hasMasterPassword) {
      page.masterPassword = new HashedString("stored-hash", true);
    }

    return page;
  });

  countMock.mockReset();
  countMock.mockImplementation(
    async (data: { modelType: { new (): unknown } }): Promise<unknown> => {
      const name: string =
        (new data.modelType() as { tableName?: string }).tableName || "";

      const answer: number | Error =
        name === new StatusPagePrivateUser().tableName
          ? counts.privateUsers
          : name === new StatusPageSSO().tableName
            ? counts.sso
            : counts.oidc;

      if (answer instanceof Error) {
        throw answer;
      }

      return answer;
    },
  );

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    if (refusal) {
      throw refusal;
    }

    return {};
  });

  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return gate;
    },
  );

  getJestSpyOn(ProjectUtil, "getCurrentPlan").mockImplementation(
    (): PlanType | null => {
      return plan;
    },
  );

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockImplementation(
    (): ObjectID => {
      return new ObjectID(PROJECT_ID);
    },
  );

  // The plans in order, as a billing install configures them.
  getJestSpyOn(
    SubscriptionPlan,
    "isFeatureAccessibleOnCurrentPlan",
  ).mockImplementation((needed: unknown, current: unknown): boolean => {
    return (
      PLAN_ORDER.indexOf(current as PlanType) >=
      PLAN_ORDER.indexOf(needed as PlanType)
    );
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

async function renderCard(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <StatusPageAccessCard statusPageId={new ObjectID(STATUS_PAGE_ID)} />,
    );
  });

  await flush();
}

function choice(access: StatusPageAccess): HTMLInputElement {
  return screen.getByTestId(getAccessChoiceTestId(access)) as HTMLInputElement;
}

function row(access: StatusPageAccess): HTMLElement {
  return screen.getByTestId(`${getAccessChoiceTestId(access)}-row`);
}

function checkedChoices(): Array<string> {
  return [
    StatusPageAccess.Anyone,
    StatusPageAccess.SignIn,
    StatusPageAccess.Password,
  ].filter((access: StatusPageAccess): boolean => {
    return choice(access).checked;
  });
}

async function pick(access: StatusPageAccess): Promise<void> {
  await act(async () => {
    fireEvent.click(choice(access));
  });
  await flush();
}

async function submitDialog(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
  });
  await flush();
}

async function cancelDialog(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));
  });
  await flush();
}

function passwordInput(): HTMLInputElement {
  const input: HTMLInputElement | null = within(
    screen.getByTestId("modal"),
  ).getByPlaceholderText(StatusPageAccessCopy.passwordPlaceholder) as
    | HTMLInputElement
    | null;

  if (!input) {
    throw new Error("No password box in the dialog.");
  }

  return input;
}

async function typePassword(value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(passwordInput(), { target: { value } });
  });
  await flush();
}

// What was sent, as plain JSON.
function sent(): Array<JSONObject> {
  return updateByIdMock.mock.calls.map((call: Array<unknown>): JSONObject => {
    const request: { id: ObjectID; data: JSONObject; modelType: unknown } =
      call[0] as { id: ObjectID; data: JSONObject; modelType: unknown };

    expect(request.id.toString()).toBe(STATUS_PAGE_ID);
    expect(request.modelType).toBe(StatusPage);

    return request.data;
  });
}

describe("what the card shows", () => {
  test("reads the page's access columns and nothing more", async () => {
    await renderCard();

    expect(getItemMock).toHaveBeenCalledTimes(1);

    const request: { select: JSONObject; id: ObjectID } = getItemMock.mock
      .calls[0]![0] as { select: JSONObject; id: ObjectID };

    expect(request.id.toString()).toBe(STATUS_PAGE_ID);
    expect(request.select).toEqual({
      isPublicStatusPage: true,
      enableMasterPassword: true,
      masterPassword: true,
      requireSsoForLogin: true,
    });
  });

  test("the card's title and its three choices, in order", async () => {
    await renderCard();

    expect(screen.getByText(StatusPageAccessCopy.cardTitle)).toBeInTheDocument();

    const group: HTMLElement = screen.getByRole("radiogroup", {
      name: StatusPageAccessCopy.cardTitle,
    });

    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio: HTMLElement): string | null => {
          return radio.getAttribute("value");
        }),
    ).toEqual([
      StatusPageAccess.Anyone,
      StatusPageAccess.SignIn,
      StatusPageAccess.Password,
    ]);

    for (const access of [
      StatusPageAccess.Anyone,
      StatusPageAccess.SignIn,
      StatusPageAccess.Password,
    ]) {
      expect(
        screen.getByRole("radio", { name: ACCESS_CHOICE_COPY[access].title }),
      ).toHaveAccessibleDescription(ACCESS_CHOICE_COPY[access].description);
    }
  });

  test.each([
    ["a public page", PUBLIC_PAGE, StatusPageAccess.Anyone],
    [
      "a public page with a password switched on and set (it never asked)",
      { ...PASSWORD_PAGE, isPublicStatusPage: true },
      StatusPageAccess.Anyone,
    ],
    ["a private page", SIGN_IN_PAGE, StatusPageAccess.SignIn],
    [
      "a private page whose switch is on with no password set",
      { ...SIGN_IN_PAGE, enableMasterPassword: true },
      StatusPageAccess.SignIn,
    ],
    [
      "a private page with a password set but switched off",
      { ...SIGN_IN_PAGE, hasMasterPassword: true },
      StatusPageAccess.SignIn,
    ],
    ["a password page", PASSWORD_PAGE, StatusPageAccess.Password],
  ])(
    "%s reads as the choice the server enforces",
    async (_label: string, page: StoredPage, access: StatusPageAccess) => {
      stored = page;

      await renderCard();

      expect(checkedChoices()).toEqual([access]);
    },
  );

  test("a page that is not there says so", async () => {
    stored = null;

    await renderCard();

    expect(screen.getByText(StatusPageAccessCopy.notFound)).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  test("a failed read says why, and can be tried again", async () => {
    stored = new Error("The server is down");

    await renderCard();

    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();

    stored = { ...SIGN_IN_PAGE };

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Refresh|Try again/ }));
    });
    await flush();

    expect(checkedChoices()).toEqual([StatusPageAccess.SignIn]);
  });
});

describe("moving to another choice", () => {
  test("to sign-in from a public page: asks, then writes the public switch alone", async () => {
    await renderCard();

    await pick(StatusPageAccess.SignIn);

    const dialog: HTMLElement = screen.getByTestId("modal");

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      ACCESS_CONFIRMATION_COPY[StatusPageAccess.SignIn].title,
    );
    expect(dialog).toHaveTextContent(
      ACCESS_CONFIRMATION_COPY[StatusPageAccess.SignIn].description,
    );
    // While it asks, the choice shows where it is going, locked.
    expect(checkedChoices()).toEqual([StatusPageAccess.SignIn]);
    expect(choice(StatusPageAccess.Anyone)).toBeDisabled();
    expect(updateByIdMock).not.toHaveBeenCalled();

    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      ACCESS_CONFIRMATION_COPY[StatusPageAccess.SignIn].submitButtonText,
    );

    await submitDialog();

    expect(sent()).toEqual([{ isPublicStatusPage: false }]);
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(checkedChoices()).toEqual([StatusPageAccess.SignIn]);
    expect(choice(StatusPageAccess.Anyone)).toBeEnabled();
    expect(
      screen.getByTestId(`${getAccessChoiceTestId(StatusPageAccess.SignIn)}-status`),
    ).toHaveTextContent("Saved");
  });

  test("cancelling writes nothing and puts the choice back", async () => {
    await renderCard();

    await pick(StatusPageAccess.SignIn);
    await cancelDialog();

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(checkedChoices()).toEqual([StatusPageAccess.Anyone]);
    expect(choice(StatusPageAccess.SignIn)).toBeEnabled();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  test("to anyone from a password page: asks, then turns the password switch off with it", async () => {
    stored = { ...PASSWORD_PAGE };

    await renderCard();
    await pick(StatusPageAccess.Anyone);

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      ACCESS_CONFIRMATION_COPY[StatusPageAccess.Anyone].title,
    );
    expect(screen.getByTestId("modal")).toHaveTextContent(
      ACCESS_CONFIRMATION_COPY[StatusPageAccess.Anyone].description,
    );

    await submitDialog();

    expect(sent()).toEqual([
      { isPublicStatusPage: true, enableMasterPassword: false },
    ]);
    expect(checkedChoices()).toEqual([StatusPageAccess.Anyone]);
    // Change Password belongs to the password choice only.
    expect(
      screen.queryByTestId(STATUS_PAGE_ACCESS_CHANGE_PASSWORD_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("to sign-in from a password page: the password switch alone", async () => {
    stored = { ...PASSWORD_PAGE };

    await renderCard();
    await pick(StatusPageAccess.SignIn);
    await submitDialog();

    expect(sent()).toEqual([{ enableMasterPassword: false }]);
    expect(checkedChoices()).toEqual([StatusPageAccess.SignIn]);
  });

  test("to the password from a public page with none set: the password is asked for, and required", async () => {
    await renderCard();
    await pick(StatusPageAccess.Password);

    const dialog: HTMLElement = screen.getByTestId("modal");

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      ACCESS_CONFIRMATION_COPY[StatusPageAccess.Password].title,
    );
    expect(dialog).toHaveTextContent(
      StatusPageAccessCopy.passwordFieldTitle,
    );
    expect(dialog).not.toHaveTextContent(
      StatusPageAccessCopy.keepPasswordDescription,
    );
    expect(passwordInput()).toHaveAttribute("type", "password");

    // Nothing typed: nothing is sent.
    await submitDialog();

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal")).toBeInTheDocument();

    await typePassword("open sesame");
    await submitDialog();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(sent()).toEqual([
      {
        isPublicStatusPage: false,
        enableMasterPassword: true,
        masterPassword: { _type: "HashedString", value: "open sesame" },
      },
    ]);
    expect(checkedChoices()).toEqual([StatusPageAccess.Password]);
    expect(
      screen.getByTestId(STATUS_PAGE_ACCESS_CHANGE_PASSWORD_TEST_ID),
    ).toBeInTheDocument();
  });

  test("to the password from sign-in, with a password set before: it may be kept", async () => {
    stored = { ...SIGN_IN_PAGE, hasMasterPassword: true };

    await renderCard();
    await pick(StatusPageAccess.Password);

    const dialog: HTMLElement = screen.getByTestId("modal");

    expect(dialog).toHaveTextContent(StatusPageAccessCopy.newPasswordFieldTitle);
    expect(dialog).toHaveTextContent(
      StatusPageAccessCopy.keepPasswordDescription,
    );
    // Moving from sign-in: private users use the password too.
    expect(dialog).toHaveTextContent(
      StatusPageAccessCopy.confirmPrivateUsersUsePassword,
    );

    await submitDialog();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    // The switch alone: the public switch and the password are left be.
    expect(sent()).toEqual([{ enableMasterPassword: true }]);
    expect(checkedChoices()).toEqual([StatusPageAccess.Password]);
  });

  test("to the password from a page whose switch was left on with no password: the password alone", async () => {
    stored = { ...SIGN_IN_PAGE, enableMasterPassword: true };

    await renderCard();

    expect(checkedChoices()).toEqual([StatusPageAccess.SignIn]);

    await pick(StatusPageAccess.Password);
    await submitDialog();

    // Required: no password, no write.
    expect(updateByIdMock).not.toHaveBeenCalled();

    await typePassword("open sesame");
    await submitDialog();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(sent()).toEqual([
      { masterPassword: { _type: "HashedString", value: "open sesame" } },
    ]);
    expect(checkedChoices()).toEqual([StatusPageAccess.Password]);
  });

  test("a refused save keeps the dialog open with the server's reason, and saves nothing", async () => {
    refusal = new Error("Please upgrade your plan to Growth to access this feature");

    await renderCard();
    await pick(StatusPageAccess.SignIn);
    await submitDialog();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("modal")).toHaveTextContent(
      "Please upgrade your plan to Growth to access this feature",
    );
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();

    await cancelDialog();

    expect(checkedChoices()).toEqual([StatusPageAccess.Anyone]);
  });

  test("a refused password move keeps the page as it was", async () => {
    refusal = new Error("You do not have permission to update this status page.");

    await renderCard();
    await pick(StatusPageAccess.Password);
    await typePassword("open sesame");
    await submitDialog();

    await waitFor(() => {
      expect(screen.getByTestId("modal")).toHaveTextContent(
        "You do not have permission to update this status page.",
      );
    });

    await cancelDialog();

    expect(checkedChoices()).toEqual([StatusPageAccess.Anyone]);
    expect(
      screen.queryByTestId(STATUS_PAGE_ACCESS_CHANGE_PASSWORD_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("Change Password", () => {
  test("is offered only while the password is the choice", async () => {
    for (const page of [PUBLIC_PAGE, SIGN_IN_PAGE]) {
      stored = { ...page };
      await renderCard();

      expect(
        screen.queryByTestId(STATUS_PAGE_ACCESS_CHANGE_PASSWORD_TEST_ID),
      ).not.toBeInTheDocument();

      cleanup();
    }

    stored = { ...PASSWORD_PAGE };
    await renderCard();

    expect(
      within(row(StatusPageAccess.Password)).getByTestId(
        STATUS_PAGE_ACCESS_CHANGE_PASSWORD_TEST_ID,
      ),
    ).toHaveTextContent(StatusPageAccessCopy.changePassword);
  });

  test("asks for the new password, then writes it alone", async () => {
    stored = { ...PASSWORD_PAGE };

    await renderCard();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(STATUS_PAGE_ACCESS_CHANGE_PASSWORD_TEST_ID),
      );
    });
    await flush();

    const dialog: HTMLElement = screen.getByTestId("modal");

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      StatusPageAccessCopy.changePassword,
    );
    expect(dialog).toHaveTextContent(
      StatusPageAccessCopy.changePasswordDescription,
    );

    // Required.
    await submitDialog();
    expect(updateByIdMock).not.toHaveBeenCalled();

    await typePassword("a better one");
    await submitDialog();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(sent()).toEqual([
      { masterPassword: { _type: "HashedString", value: "a better one" } },
    ]);
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(checkedChoices()).toEqual([StatusPageAccess.Password]);
    expect(
      screen.getByTestId(
        `${getAccessChoiceTestId(StatusPageAccess.Password)}-status`,
      ),
    ).toHaveTextContent("Saved");
  });
});

describe("plans (OneUptime Cloud)", () => {
  test("on Free, a public page's private choices need Growth, and cannot be picked", async () => {
    plan = PlanType.Free;

    await renderCard();

    for (const access of [StatusPageAccess.SignIn, StatusPageAccess.Password]) {
      expect(within(row(access)).getByText("Growth Plan")).toBeInTheDocument();
      expect(choice(access)).toBeDisabled();
    }

    expect(
      within(row(StatusPageAccess.Anyone)).queryByText("Growth Plan"),
    ).not.toBeInTheDocument();

    await pick(StatusPageAccess.SignIn);

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("on Free, a private page moves between the private choices, and only going public needs Growth", async () => {
    plan = PlanType.Free;
    stored = { ...SIGN_IN_PAGE, hasMasterPassword: true };

    await renderCard();

    expect(
      within(row(StatusPageAccess.Anyone)).getByText("Growth Plan"),
    ).toBeInTheDocument();
    expect(choice(StatusPageAccess.Anyone)).toBeDisabled();
    expect(
      within(row(StatusPageAccess.Password)).queryByText("Growth Plan"),
    ).not.toBeInTheDocument();
    expect(choice(StatusPageAccess.Password)).toBeEnabled();

    await pick(StatusPageAccess.Password);
    await submitDialog();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    // No public switch in the write, so Free may make it.
    expect(sent()).toEqual([{ enableMasterPassword: true }]);
  });

  test.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
    "on %s, nothing needs a plan",
    async (current: PlanType) => {
      plan = current;

      await renderCard();

      expect(screen.queryByText(/ Plan$/)).not.toBeInTheDocument();

      for (const access of [
        StatusPageAccess.SignIn,
        StatusPageAccess.Password,
      ]) {
        expect(choice(access)).toBeEnabled();
      }
    },
  );

  test("with billing off (no plan), nothing needs a plan", async () => {
    plan = null;

    await renderCard();

    expect(screen.queryByText(/ Plan$/)).not.toBeInTheDocument();
  });
});

describe("permissions", () => {
  test("someone who may not change it sees every choice locked, with why", async () => {
    stored = { ...PASSWORD_PAGE };
    gate = {
      isAllowed: false,
      disabledReason: "You need the Edit Status Page permission.",
    };

    await renderCard();

    for (const access of [
      StatusPageAccess.Anyone,
      StatusPageAccess.SignIn,
      StatusPageAccess.Password,
    ]) {
      expect(choice(access)).toBeDisabled();
    }

    expect(checkedChoices()).toEqual([StatusPageAccess.Password]);
    expect(
      screen.getByTestId(`${STATUS_PAGE_ACCESS_CARD_TEST_ID}-choices-locked-reason`),
    ).toHaveTextContent("You need the Edit Status Page permission.");
    expect(
      screen.getByTestId(STATUS_PAGE_ACCESS_CHANGE_PASSWORD_TEST_ID),
    ).toBeDisabled();

    await pick(StatusPageAccess.Anyone);

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  test("the gate is asked about every column a choice writes", async () => {
    await renderCard();

    const columns: Array<string> = (
      PermissionGate.checkColumnUpdate as unknown as jest.Mock
    ).mock.calls.map((call: Array<unknown>): string => {
      return call[1] as string;
    });

    expect(new Set(columns)).toEqual(
      new Set(["isPublicStatusPage", "enableMasterPassword", "masterPassword"]),
    );
  });
});

describe("under Only people who sign in", () => {
  function methodsLine(): HTMLElement {
    return within(row(StatusPageAccess.SignIn)).getByTestId(
      STATUS_PAGE_ACCESS_SIGN_IN_METHODS_TEST_ID,
    );
  }

  // The line's entries, as their links read.
  function methods(): Array<string> {
    return within(methodsLine())
      .getAllByRole("link")
      .map((link: HTMLElement): string => {
        return link.textContent || "";
      });
  }

  test("the sign-in methods set up, each a link to its page", async () => {
    await renderCard();

    const line: HTMLElement = methodsLine();

    expect(methods()).toEqual(["3 private users", "SSO on", "OIDC off"]);

    const links: Array<HTMLElement> = within(line).getAllByRole("link");

    expect(
      links.map((link: HTMLElement): string | null => {
        return link.getAttribute("href");
      }),
    ).toEqual([
      `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/private-users`,
      `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/sso`,
      `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/oidc`,
    ]);
  });

  test("counts this page's private users and its providers that are on", async () => {
    await renderCard();

    const queries: Array<[string, JSONObject]> = countMock.mock.calls.map(
      (call: Array<unknown>): [string, JSONObject] => {
        const request: { modelType: { new (): { tableName?: string } }; query: JSONObject } =
          call[0] as {
            modelType: { new (): { tableName?: string } };
            query: JSONObject;
          };

        return [
          new request.modelType().tableName || "",
          {
            ...request.query,
            statusPageId: String(request.query["statusPageId"]),
          },
        ];
      },
    );

    expect(queries).toEqual([
      [new StatusPagePrivateUser().tableName!, { statusPageId: STATUS_PAGE_ID }],
      [
        new StatusPageSSO().tableName!,
        { statusPageId: STATUS_PAGE_ID, isEnabled: true },
      ],
      [
        new StatusPageOIDC().tableName!,
        { statusPageId: STATUS_PAGE_ID, isEnabled: true },
      ],
    ]);
  });

  test("one private user reads as one", async () => {
    counts = { privateUsers: 1, sso: 0, oidc: 2 };

    await renderCard();

    expect(methods()).toEqual(["1 private user", "SSO off", "OIDC on"]);
  });

  test("required SSO is named, with a link to the SSO page", async () => {
    stored = { ...SIGN_IN_PAGE, requireSsoForLogin: true };

    await renderCard();

    expect(methods()).toEqual([
      "3 private users",
      "SSO on",
      "OIDC off",
      "SSO required",
    ]);
    expect(
      within(methodsLine())
        .getByRole("link", { name: "SSO required" })
        .getAttribute("href"),
    ).toBe(`/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/sso`);
  });

  test("below Scale, SSO and OIDC are not offered: not asked for, not listed", async () => {
    plan = PlanType.Growth;

    await renderCard();

    expect(methods()).toEqual(["3 private users"]);
    expect(countMock).toHaveBeenCalledTimes(1);
  });

  test("on Free, private users cannot be read either: no line at all", async () => {
    plan = PlanType.Free;

    await renderCard();

    expect(
      screen.queryByTestId(STATUS_PAGE_ACCESS_SIGN_IN_METHODS_TEST_ID),
    ).not.toBeInTheDocument();
    expect(countMock).not.toHaveBeenCalled();
  });

  test("a method that could not be read is left out, never counted as none", async () => {
    stored = { ...SIGN_IN_PAGE };
    counts = { privateUsers: new Error("Permission denied"), sso: 0, oidc: 0 };

    await renderCard();

    expect(methods()).toEqual(["SSO off", "OIDC off"]);
    expect(
      screen.queryByTestId(STATUS_PAGE_ACCESS_NOBODY_CAN_SIGN_IN_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("while it is the choice and nobody can sign in, it says so, with the way to add private users", async () => {
    stored = { ...SIGN_IN_PAGE };
    counts = { privateUsers: 0, sso: 0, oidc: 0 };

    await renderCard();

    const warning: HTMLElement = within(row(StatusPageAccess.SignIn)).getByTestId(
      STATUS_PAGE_ACCESS_NOBODY_CAN_SIGN_IN_TEST_ID,
    );

    expect(warning).toHaveTextContent(
      `Nobody can sign in yet. ${StatusPageAccessCopy.addPrivateUsers}`,
    );
    expect(
      within(warning).getByRole("link", {
        name: StatusPageAccessCopy.addPrivateUsers,
      }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/private-users`,
    );
  });

  test("required SSO with no provider on: nobody can sign in, with the way to set up SSO", async () => {
    stored = { ...SIGN_IN_PAGE, requireSsoForLogin: true };
    counts = { privateUsers: 5, sso: 0, oidc: 0 };

    await renderCard();

    const warning: HTMLElement = screen.getByTestId(
      STATUS_PAGE_ACCESS_NOBODY_CAN_SIGN_IN_TEST_ID,
    );

    expect(warning).toHaveTextContent(
      "Nobody can sign in: SSO is required, and no SSO or OIDC provider is on.",
    );
    expect(
      within(warning).getByRole("link", { name: StatusPageAccessCopy.setUpSso }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/sso`,
    );
  });

  test("no warning while somebody can sign in, or while it is not the choice", async () => {
    stored = { ...SIGN_IN_PAGE };
    counts = { privateUsers: 0, sso: 1, oidc: 0 };

    await renderCard();

    expect(
      screen.queryByTestId(STATUS_PAGE_ACCESS_NOBODY_CAN_SIGN_IN_TEST_ID),
    ).not.toBeInTheDocument();

    cleanup();

    stored = { ...PUBLIC_PAGE };
    counts = { privateUsers: 0, sso: 0, oidc: 0 };

    await renderCard();

    expect(
      screen.queryByTestId(STATUS_PAGE_ACCESS_NOBODY_CAN_SIGN_IN_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("moving to sign-in when nobody can sign in says so in the dialog", async () => {
    counts = { privateUsers: 0, sso: 0, oidc: 0 };

    await renderCard();
    await pick(StatusPageAccess.SignIn);

    expect(
      screen.getByTestId(`${STATUS_PAGE_ACCESS_NOBODY_CAN_SIGN_IN_TEST_ID}-confirm`),
    ).toHaveTextContent(StatusPageAccessCopy.confirmNobodyCanSignIn);

    cleanup();

    counts = { privateUsers: 2, sso: 0, oidc: 0 };

    await renderCard();
    await pick(StatusPageAccess.SignIn);

    expect(
      screen.queryByTestId(`${STATUS_PAGE_ACCESS_NOBODY_CAN_SIGN_IN_TEST_ID}-confirm`),
    ).not.toBeInTheDocument();
  });
});
