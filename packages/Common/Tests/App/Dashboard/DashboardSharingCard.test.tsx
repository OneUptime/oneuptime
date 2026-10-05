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
 * "Who can view this dashboard", the card on a dashboard's Sharing page:
 * only people in this project, anyone with the link, or anyone with the
 * link and a password - one choice, where there were two switches behind
 * two Edit buttons, a "Set Master Password" button and a separate card for
 * the public link.
 *
 * - The checked choice is what the server enforces now: a public dashboard
 *   with the password switch on is the password choice, set or not - and
 *   without a password it says nobody can open the link, with Set Password.
 * - Picking another asks first; confirming writes only the columns that
 *   change (the public switch needs Growth to change, and a write carrying
 *   it is refused below Growth, changed or not). A move to the password
 *   asks for one in the same dialog when none is set, so the page never
 *   locks the link by itself.
 * - Under the public choice in force: the public link, opening in a new
 *   tab, and a button that copies it. Under the password, while it is the
 *   choice: Change Password, which writes the password alone.
 * - A choice the plan does not include shows the plan and cannot be picked;
 *   someone who may not change it sees every choice locked, with why - and
 *   can still copy the link.
 *
 * Only the network, the clipboard, the permission gate and the plan are
 * stubbed; the card, the choices, the dialogs and the form are the real
 * ones.
 */

/*
 * A refused request is an async function that throws, not
 * mockRejectedValue: the card's imports load zone.js, whose patched Promise
 * reports a rejected one as unhandled although the card catches it.
 */
const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const copyMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Clipboard", () => {
  return {
    __esModule: true,
    default: {
      copyToClipboard: (...args: Array<unknown>): unknown => {
        return copyMock(...args);
      },
    },
  };
});

import DashboardSharingCard from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Sharing/DashboardSharingCard";
import DashboardSharingCopy, {
  DASHBOARD_ACCESS_CHOICE_COPY,
  DASHBOARD_ACCESS_CONFIRMATION_COPY,
  DASHBOARD_PUBLIC_LINK_TEST_ID,
  DASHBOARD_SHARING_CARD_TEST_ID,
  DASHBOARD_SHARING_CHANGE_PASSWORD_TEST_ID,
  DASHBOARD_SHARING_LOCKED_TEST_ID,
  DASHBOARD_SHARING_SET_PASSWORD_TEST_ID,
  getDashboardAccessChoiceTestId,
  REMOVE_PASSWORD_CONFIRMATION_COPY,
  SHARE_WITH_PASSWORD_CONFIRMATION_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Sharing/DashboardSharingCopy";
import { getPublicDashboardUrl } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Sharing/PublicDashboardUrl";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import {
  DASHBOARD_ACCESS_CHOICES,
  DashboardAccess,
} from "../../../Types/Dashboard/DashboardAccess";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { PUBLIC_DASHBOARD_URL } from "../../../UI/Config";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "6a6a6a6a-0000-4000-8000-0000000000aa";
const DASHBOARD_ID: string = "6b6b6b6b-0000-4000-8000-0000000000bb";

interface StoredDashboard {
  isPublicDashboard: boolean;
  enableMasterPassword: boolean;
  hasMasterPassword: boolean;
}

const PRIVATE_DASHBOARD: StoredDashboard = {
  isPublicDashboard: false,
  enableMasterPassword: false,
  hasMasterPassword: false,
};

const PUBLIC_DASHBOARD: StoredDashboard = {
  isPublicDashboard: true,
  enableMasterPassword: false,
  hasMasterPassword: false,
};

const PASSWORD_DASHBOARD: StoredDashboard = {
  isPublicDashboard: true,
  enableMasterPassword: true,
  hasMasterPassword: true,
};

// The switch on and no password: the server lets nobody in.
const LOCKED_DASHBOARD: StoredDashboard = {
  isPublicDashboard: true,
  enableMasterPassword: true,
  hasMasterPassword: false,
};

let stored: StoredDashboard | null | Error = PRIVATE_DASHBOARD;
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
  stored = { ...PRIVATE_DASHBOARD };
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

    const dashboard: Dashboard = new Dashboard();
    dashboard._id = DASHBOARD_ID;
    dashboard.isPublicDashboard = stored.isPublicDashboard;
    dashboard.enableMasterPassword = stored.enableMasterPassword;

    if (stored.hasMasterPassword) {
      dashboard.masterPassword = new HashedString("stored-hash", true);
    }

    return dashboard;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    if (refusal) {
      throw refusal;
    }

    return {};
  });

  copyMock.mockReset();
  copyMock.mockImplementation(async (): Promise<boolean> => {
    return true;
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
    render(<DashboardSharingCard dashboardId={new ObjectID(DASHBOARD_ID)} />);
  });

  await flush();
}

function choice(access: DashboardAccess): HTMLInputElement {
  return screen.getByTestId(
    getDashboardAccessChoiceTestId(access),
  ) as HTMLInputElement;
}

function row(access: DashboardAccess): HTMLElement {
  return screen.getByTestId(`${getDashboardAccessChoiceTestId(access)}-row`);
}

function checkedChoices(): Array<string> {
  return DASHBOARD_ACCESS_CHOICES.filter((access: DashboardAccess): boolean => {
    return choice(access).checked;
  });
}

async function pick(access: DashboardAccess): Promise<void> {
  await act(async () => {
    fireEvent.click(choice(access));
  });
  await flush();
}

async function press(testId: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
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
  return within(screen.getByTestId("modal")).getByPlaceholderText(
    DashboardSharingCopy.passwordPlaceholder,
  ) as HTMLInputElement;
}

async function typePassword(value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(passwordInput(), { target: { value } });
  });
  await flush();
}

function dialogTitle(): string {
  return screen.getByTestId("modal-title").textContent || "";
}

// What was sent, as plain JSON.
function sent(): Array<JSONObject> {
  return updateByIdMock.mock.calls.map((call: Array<unknown>): JSONObject => {
    const request: { id: ObjectID; data: JSONObject; modelType: unknown } =
      call[0] as { id: ObjectID; data: JSONObject; modelType: unknown };

    expect(request.id.toString()).toBe(DASHBOARD_ID);
    expect(request.modelType).toBe(Dashboard);

    return request.data;
  });
}

const PUBLIC_LINK: string = `${PUBLIC_DASHBOARD_URL.toString()}/${DASHBOARD_ID}`;

describe("what the card shows", () => {
  test("reads the dashboard's access columns and nothing more", async () => {
    await renderCard();

    expect(getItemMock).toHaveBeenCalledTimes(1);

    const request: { select: JSONObject; id: ObjectID; modelType: unknown } =
      getItemMock.mock.calls[0]![0] as {
        select: JSONObject;
        id: ObjectID;
        modelType: unknown;
      };

    expect(request.id.toString()).toBe(DASHBOARD_ID);
    expect(request.modelType).toBe(Dashboard);
    expect(request.select).toEqual({
      isPublicDashboard: true,
      enableMasterPassword: true,
      masterPassword: true,
    });
  });

  test("the card's title and its three choices, in order, each described", async () => {
    await renderCard();

    expect(
      screen.getByText(DashboardSharingCopy.cardTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(DashboardSharingCopy.cardDescription),
    ).toBeInTheDocument();

    const group: HTMLElement = screen.getByRole("radiogroup", {
      name: DashboardSharingCopy.cardTitle,
    });

    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio: HTMLElement): string | null => {
          return radio.getAttribute("value");
        }),
    ).toEqual([
      DashboardAccess.ProjectOnly,
      DashboardAccess.AnyoneWithLink,
      DashboardAccess.AnyoneWithPassword,
    ]);

    for (const access of DASHBOARD_ACCESS_CHOICES) {
      expect(
        screen.getByRole("radio", {
          name: DASHBOARD_ACCESS_CHOICE_COPY[access].title,
        }),
      ).toHaveAccessibleDescription(
        DASHBOARD_ACCESS_CHOICE_COPY[access].description,
      );
    }
  });

  test.each([
    [
      "a new, private dashboard",
      PRIVATE_DASHBOARD,
      DashboardAccess.ProjectOnly,
    ],
    [
      "a private dashboard whose password switch was left on (it never asked)",
      { ...PASSWORD_DASHBOARD, isPublicDashboard: false },
      DashboardAccess.ProjectOnly,
    ],
    ["a public dashboard", PUBLIC_DASHBOARD, DashboardAccess.AnyoneWithLink],
    [
      "a public dashboard with a password set but switched off",
      { ...PUBLIC_DASHBOARD, hasMasterPassword: true },
      DashboardAccess.AnyoneWithLink,
    ],
    [
      "a password-protected dashboard",
      PASSWORD_DASHBOARD,
      DashboardAccess.AnyoneWithPassword,
    ],
    [
      "a locked dashboard (the switch on, no password)",
      LOCKED_DASHBOARD,
      DashboardAccess.AnyoneWithPassword,
    ],
  ])(
    "%s reads as the choice the server enforces",
    async (
      _label: string,
      dashboard: StoredDashboard,
      access: DashboardAccess,
    ) => {
      stored = dashboard;

      await renderCard();

      expect(checkedChoices()).toEqual([access]);
    },
  );

  test("a dashboard that is not there says so", async () => {
    stored = null;

    await renderCard();

    expect(screen.getByText(DashboardSharingCopy.notFound)).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  test("a failed read says why, and can be tried again", async () => {
    stored = new Error("The server is down");

    await renderCard();

    expect(screen.getByText("The server is down")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();

    stored = { ...PUBLIC_DASHBOARD };

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Refresh|Try again/ }),
      );
    });
    await flush();

    expect(checkedChoices()).toEqual([DashboardAccess.AnyoneWithLink]);
  });

  test("the card body carries its test id", async () => {
    await renderCard();

    expect(
      screen.getByTestId(DASHBOARD_SHARING_CARD_TEST_ID),
    ).toBeInTheDocument();
  });
});

describe("the public link", () => {
  test("is the public viewer's address for this dashboard", () => {
    expect(getPublicDashboardUrl(new ObjectID(DASHBOARD_ID)).toString()).toBe(
      PUBLIC_LINK,
    );
    expect(getPublicDashboardUrl(DASHBOARD_ID).toString()).toBe(PUBLIC_LINK);
    expect(PUBLIC_LINK).toMatch(/\/public-dashboard\/6b6b6b6b-/);
  });

  test("a private dashboard has none", async () => {
    await renderCard();

    expect(
      screen.queryByTestId(DASHBOARD_PUBLIC_LINK_TEST_ID),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(PUBLIC_LINK)).not.toBeInTheDocument();
  });

  test.each([
    ["anyone with the link", PUBLIC_DASHBOARD, DashboardAccess.AnyoneWithLink],
    [
      "anyone with the link and a password",
      PASSWORD_DASHBOARD,
      DashboardAccess.AnyoneWithPassword,
    ],
    [
      "a locked dashboard, whose link asks for a password it does not have",
      LOCKED_DASHBOARD,
      DashboardAccess.AnyoneWithPassword,
    ],
  ])(
    "sits under the choice in force, %s, opening in a new tab",
    async (
      _label: string,
      dashboard: StoredDashboard,
      access: DashboardAccess,
    ) => {
      stored = dashboard;

      await renderCard();

      const link: HTMLElement = within(row(access)).getByTestId(
        DASHBOARD_PUBLIC_LINK_TEST_ID,
      );

      expect(link).toHaveTextContent(DashboardSharingCopy.publicLinkTitle);

      const anchor: HTMLElement = within(link).getByRole("link", {
        name: PUBLIC_LINK,
      });

      expect(anchor).toHaveAttribute("href", PUBLIC_LINK);
      expect(anchor).toHaveAttribute("target", "_blank");

      // Once: never under the other choices.
      expect(screen.getAllByTestId(DASHBOARD_PUBLIC_LINK_TEST_ID)).toHaveLength(
        1,
      );
    },
  );

  test("Copy link copies it, and says so", async () => {
    stored = { ...PUBLIC_DASHBOARD };

    await renderCard();

    const button: HTMLElement = within(
      screen.getByTestId(DASHBOARD_PUBLIC_LINK_TEST_ID),
    ).getByRole("button", { name: DashboardSharingCopy.copyLinkTitle });

    expect(button).toHaveTextContent(DashboardSharingCopy.copyLink);

    await act(async () => {
      fireEvent.click(button);
    });
    await flush();

    expect(copyMock).toHaveBeenCalledWith(PUBLIC_LINK);
    expect(button).toHaveTextContent(DashboardSharingCopy.copied);
  });

  test("appears once the dashboard is shared, and goes once it is not", async () => {
    await renderCard();
    await pick(DashboardAccess.AnyoneWithLink);
    await submitDialog();

    expect(
      within(row(DashboardAccess.AnyoneWithLink)).getByTestId(
        DASHBOARD_PUBLIC_LINK_TEST_ID,
      ),
    ).toBeInTheDocument();

    await pick(DashboardAccess.ProjectOnly);
    await submitDialog();

    expect(
      screen.queryByTestId(DASHBOARD_PUBLIC_LINK_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("moving to another choice", () => {
  test("to anyone with the link, from a private dashboard: asks, then writes the public switch alone", async () => {
    await renderCard();

    await pick(DashboardAccess.AnyoneWithLink);

    const dialog: HTMLElement = screen.getByTestId("modal");
    const copy: {
      title: string;
      description: string;
      submitButtonText: string;
    } = DASHBOARD_ACCESS_CONFIRMATION_COPY[DashboardAccess.AnyoneWithLink];

    expect(dialogTitle()).toBe(copy.title);
    expect(dialog).toHaveTextContent(copy.description);
    // While it asks, the choice shows where it is going, locked.
    expect(checkedChoices()).toEqual([DashboardAccess.AnyoneWithLink]);
    expect(choice(DashboardAccess.ProjectOnly)).toBeDisabled();
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      copy.submitButtonText,
    );

    await submitDialog();

    expect(sent()).toEqual([{ isPublicDashboard: true }]);
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(checkedChoices()).toEqual([DashboardAccess.AnyoneWithLink]);
    expect(choice(DashboardAccess.ProjectOnly)).toBeEnabled();
    expect(
      screen.getByTestId(
        `${getDashboardAccessChoiceTestId(DashboardAccess.AnyoneWithLink)}-status`,
      ),
    ).toHaveTextContent("Saved");
  });

  test("cancelling writes nothing and puts the choice back", async () => {
    await renderCard();

    await pick(DashboardAccess.AnyoneWithLink);
    await cancelDialog();

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(checkedChoices()).toEqual([DashboardAccess.ProjectOnly]);
    expect(choice(DashboardAccess.AnyoneWithLink)).toBeEnabled();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  test("to anyone with the link, from a private dashboard whose password switch was left on: turns it off with the share", async () => {
    stored = { ...PASSWORD_DASHBOARD, isPublicDashboard: false };

    await renderCard();
    await pick(DashboardAccess.AnyoneWithLink);
    await submitDialog();

    expect(sent()).toEqual([
      { isPublicDashboard: true, enableMasterPassword: false },
    ]);
    expect(checkedChoices()).toEqual([DashboardAccess.AnyoneWithLink]);
  });

  test.each([
    ["anyone with the link", PUBLIC_DASHBOARD, { isPublicDashboard: false }],
    [
      "anyone with the link and a password",
      PASSWORD_DASHBOARD,
      { isPublicDashboard: false, enableMasterPassword: false },
    ],
    [
      "a locked dashboard",
      LOCKED_DASHBOARD,
      { isPublicDashboard: false, enableMasterPassword: false },
    ],
  ])(
    "back to only the project, from %s: asks to stop sharing",
    async (_label: string, dashboard: StoredDashboard, written: JSONObject) => {
      stored = dashboard;

      await renderCard();
      await pick(DashboardAccess.ProjectOnly);

      const copy: {
        title: string;
        description: string;
        submitButtonText: string;
      } = DASHBOARD_ACCESS_CONFIRMATION_COPY[DashboardAccess.ProjectOnly];

      expect(dialogTitle()).toBe(copy.title);
      expect(screen.getByTestId("modal")).toHaveTextContent(copy.description);
      expect(
        screen.getByTestId("modal-footer-submit-button"),
      ).toHaveTextContent(copy.submitButtonText);

      await submitDialog();

      expect(sent()).toEqual([written]);
      expect(checkedChoices()).toEqual([DashboardAccess.ProjectOnly]);
      expect(
        screen.queryByTestId(DASHBOARD_SHARING_CHANGE_PASSWORD_TEST_ID),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(DASHBOARD_SHARING_LOCKED_TEST_ID),
      ).not.toBeInTheDocument();
    },
  );

  test("to anyone with the link, from the password: asks to stop asking for it, then turns the switch off alone", async () => {
    stored = { ...PASSWORD_DASHBOARD };

    await renderCard();
    await pick(DashboardAccess.AnyoneWithLink);

    expect(dialogTitle()).toBe(REMOVE_PASSWORD_CONFIRMATION_COPY.title);
    expect(screen.getByTestId("modal")).toHaveTextContent(
      REMOVE_PASSWORD_CONFIRMATION_COPY.description,
    );
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      REMOVE_PASSWORD_CONFIRMATION_COPY.submitButtonText,
    );

    await submitDialog();

    // Never the public switch: moving between public choices needs no plan.
    expect(sent()).toEqual([{ enableMasterPassword: false }]);
    expect(checkedChoices()).toEqual([DashboardAccess.AnyoneWithLink]);
    expect(
      screen.queryByTestId(DASHBOARD_SHARING_CHANGE_PASSWORD_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("to the password, from anyone with the link and none set: the password is asked for, and required", async () => {
    stored = { ...PUBLIC_DASHBOARD };

    await renderCard();
    await pick(DashboardAccess.AnyoneWithPassword);

    const dialog: HTMLElement = screen.getByTestId("modal");
    const copy: {
      title: string;
      description: string;
      submitButtonText: string;
    } = DASHBOARD_ACCESS_CONFIRMATION_COPY[DashboardAccess.AnyoneWithPassword];

    expect(dialogTitle()).toBe(copy.title);
    expect(dialog).toHaveTextContent(copy.description);
    expect(dialog).toHaveTextContent(DashboardSharingCopy.passwordFieldTitle);
    expect(dialog).not.toHaveTextContent(
      DashboardSharingCopy.keepPasswordDescription,
    );
    expect(passwordInput()).toHaveAttribute("type", "password");
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      copy.submitButtonText,
    );

    // Nothing typed: nothing is sent, and the link is never locked.
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
        enableMasterPassword: true,
        masterPassword: { _type: "HashedString", value: "open sesame" },
      },
    ]);
    expect(checkedChoices()).toEqual([DashboardAccess.AnyoneWithPassword]);
    expect(
      within(row(DashboardAccess.AnyoneWithPassword)).getByTestId(
        DASHBOARD_SHARING_CHANGE_PASSWORD_TEST_ID,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(DASHBOARD_SHARING_LOCKED_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("to the password, from a private dashboard with none set: a first share, with the password required", async () => {
    await renderCard();
    await pick(DashboardAccess.AnyoneWithPassword);

    expect(dialogTitle()).toBe(SHARE_WITH_PASSWORD_CONFIRMATION_COPY.title);
    expect(screen.getByTestId("modal")).toHaveTextContent(
      SHARE_WITH_PASSWORD_CONFIRMATION_COPY.description,
    );
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      SHARE_WITH_PASSWORD_CONFIRMATION_COPY.submitButtonText,
    );

    await submitDialog();

    expect(updateByIdMock).not.toHaveBeenCalled();

    await typePassword("open sesame");
    await submitDialog();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(sent()).toEqual([
      {
        isPublicDashboard: true,
        enableMasterPassword: true,
        masterPassword: { _type: "HashedString", value: "open sesame" },
      },
    ]);
    expect(checkedChoices()).toEqual([DashboardAccess.AnyoneWithPassword]);
  });

  test("to the password, with a password set before: it may be kept, and only the switch is written", async () => {
    stored = { ...PUBLIC_DASHBOARD, hasMasterPassword: true };

    await renderCard();
    await pick(DashboardAccess.AnyoneWithPassword);

    const dialog: HTMLElement = screen.getByTestId("modal");

    expect(dialog).toHaveTextContent(
      DashboardSharingCopy.newPasswordFieldTitle,
    );
    expect(dialog).toHaveTextContent(
      DashboardSharingCopy.keepPasswordDescription,
    );

    await submitDialog();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(sent()).toEqual([{ enableMasterPassword: true }]);
    expect(checkedChoices()).toEqual([DashboardAccess.AnyoneWithPassword]);
  });

  test("to the password, with a password set before: a new one typed replaces it", async () => {
    stored = { ...PUBLIC_DASHBOARD, hasMasterPassword: true };

    await renderCard();
    await pick(DashboardAccess.AnyoneWithPassword);
    await typePassword("a new one");
    await submitDialog();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(sent()).toEqual([
      {
        enableMasterPassword: true,
        masterPassword: { _type: "HashedString", value: "a new one" },
      },
    ]);
  });

  test("to the password, from a private dashboard whose switch was left on with no password: the public switch and the password", async () => {
    stored = { ...LOCKED_DASHBOARD, isPublicDashboard: false };

    await renderCard();

    expect(checkedChoices()).toEqual([DashboardAccess.ProjectOnly]);

    await pick(DashboardAccess.AnyoneWithPassword);
    await submitDialog();

    // Required: no password, no write.
    expect(updateByIdMock).not.toHaveBeenCalled();

    await typePassword("open sesame");
    await submitDialog();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(sent()).toEqual([
      {
        isPublicDashboard: true,
        masterPassword: { _type: "HashedString", value: "open sesame" },
      },
    ]);
    expect(checkedChoices()).toEqual([DashboardAccess.AnyoneWithPassword]);
  });

  test("a refused save keeps the dialog open with the server's reason, and saves nothing", async () => {
    refusal = new Error(
      "Please upgrade your plan to Growth to access this feature",
    );

    await renderCard();
    await pick(DashboardAccess.AnyoneWithLink);
    await submitDialog();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("modal")).toHaveTextContent(
      "Please upgrade your plan to Growth to access this feature",
    );
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();

    await cancelDialog();

    expect(checkedChoices()).toEqual([DashboardAccess.ProjectOnly]);
    expect(
      screen.queryByTestId(DASHBOARD_PUBLIC_LINK_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a refused password move keeps the dashboard as it was", async () => {
    refusal = new Error("You do not have permission to update this dashboard.");
    stored = { ...PUBLIC_DASHBOARD };

    await renderCard();
    await pick(DashboardAccess.AnyoneWithPassword);
    await typePassword("open sesame");
    await submitDialog();

    await waitFor(() => {
      expect(screen.getByTestId("modal")).toHaveTextContent(
        "You do not have permission to update this dashboard.",
      );
    });

    await cancelDialog();

    expect(checkedChoices()).toEqual([DashboardAccess.AnyoneWithLink]);
    expect(
      screen.queryByTestId(DASHBOARD_SHARING_CHANGE_PASSWORD_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("a dashboard that asks for a password it does not have", () => {
  test("says nobody can open the link yet, and offers Set Password instead of Change Password", async () => {
    stored = { ...LOCKED_DASHBOARD };

    await renderCard();

    const locked: HTMLElement = within(
      row(DashboardAccess.AnyoneWithPassword),
    ).getByTestId(DASHBOARD_SHARING_LOCKED_TEST_ID);

    expect(locked).toHaveTextContent(
      DashboardSharingCopy.lockedWithoutPassword,
    );
    expect(
      within(row(DashboardAccess.AnyoneWithPassword)).getByTestId(
        DASHBOARD_SHARING_SET_PASSWORD_TEST_ID,
      ),
    ).toHaveTextContent(DashboardSharingCopy.setPassword);
    expect(
      screen.queryByTestId(DASHBOARD_SHARING_CHANGE_PASSWORD_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("Set Password asks for one, requires it, and writes the password alone", async () => {
    stored = { ...LOCKED_DASHBOARD };

    await renderCard();
    await press(DASHBOARD_SHARING_SET_PASSWORD_TEST_ID);

    const dialog: HTMLElement = screen.getByTestId("modal");

    expect(dialogTitle()).toBe(DashboardSharingCopy.setPassword);
    expect(dialog).toHaveTextContent(
      DashboardSharingCopy.setPasswordDescription,
    );
    expect(dialog).toHaveTextContent(DashboardSharingCopy.passwordFieldTitle);
    // While it asks, nothing else can be picked.
    expect(choice(DashboardAccess.ProjectOnly)).toBeDisabled();

    await submitDialog();

    expect(updateByIdMock).not.toHaveBeenCalled();

    await typePassword("open sesame");
    await submitDialog();

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(sent()).toEqual([
      { masterPassword: { _type: "HashedString", value: "open sesame" } },
    ]);
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(checkedChoices()).toEqual([DashboardAccess.AnyoneWithPassword]);
    expect(
      screen.queryByTestId(DASHBOARD_SHARING_LOCKED_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(DASHBOARD_SHARING_CHANGE_PASSWORD_TEST_ID),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        `${getDashboardAccessChoiceTestId(DashboardAccess.AnyoneWithPassword)}-status`,
      ),
    ).toHaveTextContent("Saved");
  });

  test("cancelling Set Password leaves it locked, and writes nothing", async () => {
    stored = { ...LOCKED_DASHBOARD };

    await renderCard();
    await press(DASHBOARD_SHARING_SET_PASSWORD_TEST_ID);
    await cancelDialog();

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(
      screen.getByTestId(DASHBOARD_SHARING_LOCKED_TEST_ID),
    ).toBeInTheDocument();
    expect(choice(DashboardAccess.ProjectOnly)).toBeEnabled();
  });
});

describe("Change Password", () => {
  test("is offered only while the password is the choice, and set", async () => {
    for (const dashboard of [
      PRIVATE_DASHBOARD,
      PUBLIC_DASHBOARD,
      LOCKED_DASHBOARD,
    ]) {
      stored = { ...dashboard };
      await renderCard();

      expect(
        screen.queryByTestId(DASHBOARD_SHARING_CHANGE_PASSWORD_TEST_ID),
      ).not.toBeInTheDocument();

      cleanup();
    }

    stored = { ...PASSWORD_DASHBOARD };
    await renderCard();

    expect(
      within(row(DashboardAccess.AnyoneWithPassword)).getByTestId(
        DASHBOARD_SHARING_CHANGE_PASSWORD_TEST_ID,
      ),
    ).toHaveTextContent(DashboardSharingCopy.changePassword);
  });

  test("asks for the new password, then writes it alone", async () => {
    stored = { ...PASSWORD_DASHBOARD };

    await renderCard();
    await press(DASHBOARD_SHARING_CHANGE_PASSWORD_TEST_ID);

    const dialog: HTMLElement = screen.getByTestId("modal");

    expect(dialogTitle()).toBe(DashboardSharingCopy.changePassword);
    expect(dialog).toHaveTextContent(
      DashboardSharingCopy.changePasswordDescription,
    );
    expect(dialog).toHaveTextContent(
      DashboardSharingCopy.newPasswordFieldTitle,
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
    expect(checkedChoices()).toEqual([DashboardAccess.AnyoneWithPassword]);
    expect(
      screen.getByTestId(
        `${getDashboardAccessChoiceTestId(DashboardAccess.AnyoneWithPassword)}-status`,
      ),
    ).toHaveTextContent("Saved");
  });

  test("a refused change keeps the dialog open with why", async () => {
    stored = { ...PASSWORD_DASHBOARD };
    refusal = new Error("The password could not be saved.");

    await renderCard();
    await press(DASHBOARD_SHARING_CHANGE_PASSWORD_TEST_ID);
    await typePassword("a better one");
    await submitDialog();

    await waitFor(() => {
      expect(screen.getByTestId("modal")).toHaveTextContent(
        "The password could not be saved.",
      );
    });
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });
});

describe("plans (OneUptime Cloud)", () => {
  test("on Free, a private dashboard's public choices need Growth, and cannot be picked", async () => {
    plan = PlanType.Free;

    await renderCard();

    for (const access of [
      DashboardAccess.AnyoneWithLink,
      DashboardAccess.AnyoneWithPassword,
    ]) {
      expect(within(row(access)).getByText("Growth Plan")).toBeInTheDocument();
      expect(choice(access)).toBeDisabled();
      // The plan is read with the choice.
      expect(choice(access)).toHaveAccessibleDescription(
        `${DASHBOARD_ACCESS_CHOICE_COPY[access].description} Growth Plan`,
      );
    }

    expect(
      within(row(DashboardAccess.ProjectOnly)).queryByText("Growth Plan"),
    ).not.toBeInTheDocument();

    await pick(DashboardAccess.AnyoneWithLink);

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("on Free, a public dashboard moves between the public choices, and only stopping the share needs Growth", async () => {
    plan = PlanType.Free;
    stored = { ...PUBLIC_DASHBOARD, hasMasterPassword: true };

    await renderCard();

    expect(
      within(row(DashboardAccess.ProjectOnly)).getByText("Growth Plan"),
    ).toBeInTheDocument();
    expect(choice(DashboardAccess.ProjectOnly)).toBeDisabled();
    expect(
      within(row(DashboardAccess.AnyoneWithPassword)).queryByText(
        "Growth Plan",
      ),
    ).not.toBeInTheDocument();
    expect(choice(DashboardAccess.AnyoneWithPassword)).toBeEnabled();

    await pick(DashboardAccess.AnyoneWithPassword);
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
        DashboardAccess.AnyoneWithLink,
        DashboardAccess.AnyoneWithPassword,
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
  test("someone who may not change it sees every choice locked, with why - and can still copy the link", async () => {
    stored = { ...PASSWORD_DASHBOARD };
    gate = {
      isAllowed: false,
      disabledReason: "You need the Edit Dashboard permission.",
    };

    await renderCard();

    for (const access of DASHBOARD_ACCESS_CHOICES) {
      expect(choice(access)).toBeDisabled();
    }

    expect(checkedChoices()).toEqual([DashboardAccess.AnyoneWithPassword]);
    expect(
      screen.getByTestId(
        `${DASHBOARD_SHARING_CARD_TEST_ID}-choices-locked-reason`,
      ),
    ).toHaveTextContent("You need the Edit Dashboard permission.");
    expect(
      screen.getByTestId(DASHBOARD_SHARING_CHANGE_PASSWORD_TEST_ID),
    ).toBeDisabled();

    await pick(DashboardAccess.ProjectOnly);

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId(DASHBOARD_PUBLIC_LINK_TEST_ID)).getByRole(
          "button",
          { name: DashboardSharingCopy.copyLinkTitle },
        ),
      );
    });
    await flush();

    expect(copyMock).toHaveBeenCalledWith(PUBLIC_LINK);
  });

  test("Set Password is locked too, for someone who may not change it", async () => {
    stored = { ...LOCKED_DASHBOARD };
    gate = {
      isAllowed: false,
      disabledReason: "You need the Edit Dashboard permission.",
    };

    await renderCard();

    expect(
      screen.getByTestId(DASHBOARD_SHARING_SET_PASSWORD_TEST_ID),
    ).toBeDisabled();
  });

  test("the gate is asked about every column a choice writes", async () => {
    await renderCard();

    const columns: Array<string> = (
      PermissionGate.checkColumnUpdate as unknown as jest.Mock
    ).mock.calls.map((call: Array<unknown>): string => {
      return call[1] as string;
    });

    expect(new Set(columns)).toEqual(
      new Set(["isPublicDashboard", "enableMasterPassword", "masterPassword"]),
    );
  });
});
