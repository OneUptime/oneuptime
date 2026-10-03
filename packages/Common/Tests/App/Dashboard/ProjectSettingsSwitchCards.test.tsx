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
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * Project Settings' one-switch settings save the moment they are flipped
 * (the shared ModelSwitchCard), and ask first where a flip can lock people
 * out or let someone in:
 *
 *   - Settings > Project: "Let OneUptime support access this project"
 *     (where OneUptime bills), asking - and saying what it grants - before
 *     it lets support in;
 *   - Settings > Feature Flags: "Monitor Groups", no dialog either way;
 *   - Settings > SSO: "Require SSO for Login", asking with a red button
 *     before it locks out everyone not signed in with SSO.
 *
 * The real cards, switches and dialogs are rendered; only the network, the
 * permission snapshot and the page's other cards are stubbed.
 */

let billingEnabledForTest: boolean = true;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  return mocked;
});

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

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

// The Project Details card above the switch is not what this is about.
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: { name: string }): ReactElement => {
      return <section data-testid={`card-model-detail-${props.name}`} />;
    },
  };
});

import CustomerSupportAccessCard, {
  getAllowCustomerSupportAccessConfirmation,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Project/CustomerSupportAccessCard";
import CustomerSupportAccessSwitchCopy, {
  CUSTOMER_SUPPORT_ACCESS_SWITCH_COLUMN,
  CUSTOMER_SUPPORT_ACCESS_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Project/CustomerSupportAccessSwitchCopy";
import RequireSsoForLoginCard, {
  getRequireSsoForLoginConfirmation,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Project/RequireSsoForLoginCard";
import RequireSsoForLoginSwitchCopy, {
  REQUIRE_SSO_FOR_LOGIN_SWITCH_COLUMN,
  REQUIRE_SSO_FOR_LOGIN_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Project/RequireSsoForLoginSwitchCopy";
import MonitorGroupsSwitchCopy, {
  MONITOR_GROUPS_SWITCH_COLUMN,
  MONITOR_GROUPS_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupsSwitchCopy";
import ProjectSettingsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/ProjectSettings";
import FeatureFlagsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/FeatureFlags";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import { subscribeToModelSwitchSaved } from "../../../UI/Components/ModelSwitch/ModelSwitchEvents";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

const PROJECT_ID: string = "9a9a9a9a-0000-4000-8000-0000000000bb";

let stored: Record<string, unknown> = {};

interface ItemCall {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
}

interface UpdateCall {
  modelType: unknown;
  id: ObjectID;
  data: Record<string, unknown>;
}

function updateCall(index: number = 0): UpdateCall {
  return updateByIdMock.mock.calls[index]![0] as UpdateCall;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

async function press(control: HTMLElement): Promise<void> {
  fireEvent.click(control);
  await flush();
}

function permit(permissions: Array<Permission>): void {
  getJestSpyOn(PermissionUtil, "getAllPermissions").mockReturnValue(
    permissions,
  );
}

beforeEach(() => {
  billingEnabledForTest = true;
  stored = {};

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const project: Project = new Project();
    project._id = PROJECT_ID;
    Object.assign(project, stored);
    return project;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(
    async (options: unknown): Promise<unknown> => {
      Object.assign(stored, (options as UpdateCall).data);
      return {};
    },
  );

  getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  // A project owner, unless a test says otherwise.
  permit([Permission.ProjectOwner]);

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockImplementation(
    (): ObjectID => {
      return new ObjectID(PROJECT_ID);
    },
  );
  getJestSpyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Customer Support Access", () => {
  async function renderCard(): Promise<HTMLElement> {
    render(<CustomerSupportAccessCard projectId={new ObjectID(PROJECT_ID)} />);
    await flush();
    return screen.getByTestId(CUSTOMER_SUPPORT_ACCESS_SWITCH_TEST_ID);
  }

  test("is one switch under the card's title and line, with no Edit button", async () => {
    const control: HTMLElement = await renderCard();

    expect(
      screen.getByText(CustomerSupportAccessSwitchCopy.cardTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(CustomerSupportAccessSwitchCopy.cardDescription),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", {
        name: CustomerSupportAccessSwitchCopy.switchTitle,
      }),
    ).toBe(control);
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
  });

  test("reads the project's column, which starts off", async () => {
    const control: HTMLElement = await renderCard();

    const call: ItemCall = getItemMock.mock.calls[0]![0] as ItemCall;

    expect(call.modelType).toBe(Project);
    expect(call.id.toString()).toBe(PROJECT_ID);
    expect(call.select).toEqual({ letCustomerSupportAccessProject: true });
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText(CustomerSupportAccessSwitchCopy.switchOffDescription),
    ).toBeInTheDocument();
  });

  test("letting support in asks first, says what it grants, and saves only when confirmed", async () => {
    const control: HTMLElement = await renderCard();

    await press(control);

    expect(updateByIdMock).not.toHaveBeenCalled();

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(dialog).toHaveAccessibleName(
      CustomerSupportAccessSwitchCopy.allowConfirmTitle,
    );
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(
      CustomerSupportAccessSwitchCopy.allowConfirmDescription,
    );
    expect(CustomerSupportAccessSwitchCopy.allowConfirmDescription).toContain(
      "see and change everything in it",
    );

    const confirm: HTMLElement = within(dialog).getByRole("button", {
      name: CustomerSupportAccessSwitchCopy.allowConfirmButton,
    });

    // A grant, not a lock-out: the primary button, not a red one.
    expect(confirm).not.toHaveClass("bg-red-600");

    fireEvent.click(confirm);
    await flush();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateCall().modelType).toBe(Project);
    expect(updateCall().id.toString()).toBe(PROJECT_ID);
    expect(updateCall().data).toEqual({
      letCustomerSupportAccessProject: true,
    });
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(CustomerSupportAccessSwitchCopy.switchOnDescription),
    ).toBeInTheDocument();
  });

  test("cancelling keeps support out", async () => {
    const control: HTMLElement = await renderCard();

    await press(control);

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    await flush();

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(control).toHaveAttribute("aria-checked", "false");
  });

  test("taking the access away saves at once", async () => {
    stored = { letCustomerSupportAccessProject: true };

    const control: HTMLElement = await renderCard();

    await press(control);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCall().data).toEqual({
      letCustomerSupportAccessProject: false,
    });
    expect(control).toHaveAttribute("aria-checked", "false");
  });

  test("is locked, with the reason, for someone the column does not let change it", async () => {
    // Edit Project may edit the project, but not who can support it.
    permit([Permission.EditProject]);

    const control: HTMLElement = await renderCard();

    expect(control).toHaveAttribute("aria-disabled", "true");

    // The switch says which permission is missing (its tooltip describes it).
    const reason: string = (control.getAttribute("aria-describedby") || "")
      .split(" ")
      .map((id: string): string => {
        return document.getElementById(id)?.textContent || "";
      })
      .join(" ");

    expect(reason).toContain("You do not have permission to update this");
    expect(reason).toContain("Project Owner");

    await press(control);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("the confirmation is only for letting support in", () => {
    expect(getAllowCustomerSupportAccessConfirmation(false)).toBeUndefined();
    expect(getAllowCustomerSupportAccessConfirmation(true)).toEqual({
      title: CustomerSupportAccessSwitchCopy.allowConfirmTitle,
      description: CustomerSupportAccessSwitchCopy.allowConfirmDescription,
      submitButtonText: CustomerSupportAccessSwitchCopy.allowConfirmButton,
    });
    expect(CUSTOMER_SUPPORT_ACCESS_SWITCH_COLUMN).toBe(
      "letCustomerSupportAccessProject",
    );
  });
});

describe("Settings > Project", () => {
  function renderPage(): void {
    render(
      <ProjectSettingsPage
        pageRoute={new Route("/dashboard")}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
  }

  test("where OneUptime bills, the support switch follows the Project Details card", async () => {
    renderPage();
    await flush();

    const details: HTMLElement = screen.getByTestId(
      "card-model-detail-Project Details",
    );
    const control: HTMLElement = screen.getByTestId(
      CUSTOMER_SUPPORT_ACCESS_SWITCH_TEST_ID,
    );

    expect(
      details.compareDocumentPosition(control) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect((getItemMock.mock.calls[0]![0] as ItemCall).id.toString()).toBe(
      PROJECT_ID,
    );
    // The old dialog card is gone.
    expect(
      screen.queryByTestId("card-model-detail-Enable Customer Support Access"),
    ).toBeNull();
  });

  test("a self-hosted install has no OneUptime support team to let in: no switch", async () => {
    billingEnabledForTest = false;

    renderPage();
    await flush();

    expect(
      screen.getByTestId("card-model-detail-Project Details"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(CUSTOMER_SUPPORT_ACCESS_SWITCH_TEST_ID),
    ).toBeNull();
    expect(getItemMock).not.toHaveBeenCalled();
  });
});

describe("Settings > Feature Flags: Monitor Groups", () => {
  async function renderPage(): Promise<HTMLElement> {
    render(
      <FeatureFlagsPage
        pageRoute={new Route("/dashboard")}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
    await flush();
    return screen.getByTestId(MONITOR_GROUPS_SWITCH_TEST_ID);
  }

  test("is the Feature Flags card's one switch, saying what monitor groups are", async () => {
    const control: HTMLElement = await renderPage();

    expect(
      screen.getByText(MonitorGroupsSwitchCopy.cardTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(MonitorGroupsSwitchCopy.cardDescription),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: MonitorGroupsSwitchCopy.switchTitle }),
    ).toBe(control);
    expect(control).toHaveAttribute("aria-checked", "false");

    const describedBy: string = control.getAttribute("aria-describedby") || "";
    const sentence: string =
      document.getElementById(describedBy.split(" ")[0] || "")?.textContent ||
      "";

    expect(sentence).toBe(
      `${MonitorGroupsSwitchCopy.switchOffDescription} ${MonitorGroupsSwitchCopy.note}`,
    );
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();

    const call: ItemCall = getItemMock.mock.calls[0]![0] as ItemCall;

    expect(call.id.toString()).toBe(PROJECT_ID);
    expect(call.select).toEqual({ isFeatureFlagMonitorGroupsEnabled: true });
  });

  test("turning it on saves at once, with no dialog, and tells the rest of the dashboard", async () => {
    const heard: Array<boolean> = [];

    const unsubscribe: () => void = subscribeToModelSwitchSaved({
      modelType: Project,
      modelId: new ObjectID(PROJECT_ID),
      column: MONITOR_GROUPS_SWITCH_COLUMN,
      onSaved: (value: boolean): void => {
        heard.push(value);
      },
    });

    const control: HTMLElement = await renderPage();

    await press(control);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCall().data).toEqual({
      isFeatureFlagMonitorGroupsEnabled: true,
    });
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(MonitorGroupsSwitchCopy.switchOnDescription, {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(heard).toEqual([true]);

    unsubscribe();
  });

  test("turning it off saves at once too: it deletes no group", async () => {
    stored = { isFeatureFlagMonitorGroupsEnabled: true };

    const control: HTMLElement = await renderPage();

    expect(control).toHaveAttribute("aria-checked", "true");

    await press(control);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCall().data).toEqual({
      isFeatureFlagMonitorGroupsEnabled: false,
    });
    expect(MonitorGroupsSwitchCopy.note).toContain(
      "Turning this off deletes no group.",
    );
  });
});

describe("Settings > SSO: Require SSO for Login", () => {
  async function renderCard(): Promise<HTMLElement> {
    render(<RequireSsoForLoginCard projectId={new ObjectID(PROJECT_ID)} />);
    await flush();
    return screen.getByTestId(REQUIRE_SSO_FOR_LOGIN_SWITCH_TEST_ID);
  }

  test("is one switch on the project's column, which starts off", async () => {
    const control: HTMLElement = await renderCard();

    expect(
      screen.getByText(RequireSsoForLoginSwitchCopy.cardTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(RequireSsoForLoginSwitchCopy.cardDescription),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", {
        name: RequireSsoForLoginSwitchCopy.switchTitle,
      }),
    ).toBe(control);
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText(RequireSsoForLoginSwitchCopy.switchOffDescription),
    ).toBeInTheDocument();

    const call: ItemCall = getItemMock.mock.calls[0]![0] as ItemCall;

    expect(call.select).toEqual({ requireSsoForLogin: true });
  });

  test("requiring SSO asks first with a red button, saying everyone - you included - is locked out until they sign in with SSO", async () => {
    const control: HTMLElement = await renderCard();

    await press(control);

    expect(updateByIdMock).not.toHaveBeenCalled();

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(dialog).toHaveAccessibleName(
      RequireSsoForLoginSwitchCopy.requireConfirmTitle,
    );
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(RequireSsoForLoginSwitchCopy.requireConfirmDescription);
    expect(RequireSsoForLoginSwitchCopy.requireConfirmDescription).toContain(
      "you included",
    );
    expect(RequireSsoForLoginSwitchCopy.requireConfirmDescription).toContain(
      "locked out",
    );

    const confirm: HTMLElement = within(dialog).getByRole("button", {
      name: RequireSsoForLoginSwitchCopy.requireConfirmButton,
    });

    expect(confirm).toHaveClass("bg-red-600");

    fireEvent.click(confirm);
    await flush();

    expect(updateCall().data).toEqual({ requireSsoForLogin: true });
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(RequireSsoForLoginSwitchCopy.switchOnDescription),
    ).toBeInTheDocument();
  });

  test("cancelling leaves SSO not required", async () => {
    const control: HTMLElement = await renderCard();

    await press(control);

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    await flush();

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(control).toHaveAttribute("aria-checked", "false");
  });

  test("no longer requiring SSO saves at once: it locks nobody out", async () => {
    stored = { requireSsoForLogin: true };

    const control: HTMLElement = await renderCard();

    await press(control);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCall().data).toEqual({ requireSsoForLogin: false });
  });

  test("a project admin may require SSO; a member may not", async () => {
    permit([Permission.ProjectAdmin]);

    const control: HTMLElement = await renderCard();

    expect(control).not.toHaveAttribute("aria-disabled");

    cleanup();
    permit([Permission.ProjectMember]);

    const locked: HTMLElement = await renderCard();

    expect(locked).toHaveAttribute("aria-disabled", "true");
  });

  test("the confirmation is only for requiring SSO, and it is a danger", () => {
    expect(getRequireSsoForLoginConfirmation(false)).toBeUndefined();
    expect(getRequireSsoForLoginConfirmation(true)).toEqual({
      title: RequireSsoForLoginSwitchCopy.requireConfirmTitle,
      description: RequireSsoForLoginSwitchCopy.requireConfirmDescription,
      submitButtonText: RequireSsoForLoginSwitchCopy.requireConfirmButton,
      submitButtonType: ButtonStyleType.DANGER,
    });
    expect(REQUIRE_SSO_FOR_LOGIN_SWITCH_COLUMN).toBe("requireSsoForLogin");
  });
});
