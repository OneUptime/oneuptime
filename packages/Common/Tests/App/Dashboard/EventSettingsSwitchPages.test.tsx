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
import React, { FunctionComponent, ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * The Settings pages of alerts, incident episodes, scheduled maintenance
 * events, runbooks and incidents: every card that was an Edit button whose
 * dialog held one switch is now that switch, saving the moment it is
 * flipped.
 *
 *   - Alert: "Who can see this alert" (Private Alert, asking first before
 *     it makes the alert private) and Reminders.
 *   - Episode: Status Pages (Visible on Status Page, a checkbox before).
 *   - Scheduled maintenance: Status Pages and Reminders.
 *   - Runbook: Execution ("Run this runbook").
 *   - Incident: Reminders. Its Incident Settings and Status Page Scope cards
 *     stay forms (several linked questions each); they are stubbed here and
 *     have suites of their own.
 *
 * The real pages, cards and switches are rendered; only the network, the
 * route's id and the permission gate are stubbed.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

// The incident page's two form cards, recorded rather than drawn.
const recordedCards: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedCards.push(props);
      return React.createElement("div", {
        "data-testid": `stub-card-${props["name"] as string}`,
      });
    },
  };
});

import AlertSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/Settings";
import EpisodeSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/Settings";
import IncidentSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/Settings";
import ScheduledMaintenanceSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/Settings";
import RunbookSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Settings";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { getMakeAlertPrivateConfirmation } from "../../../../App/FeatureSet/Dashboard/src/Components/Alert/AlertPrivacyCard";
import AlertPrivacySwitchCopy, {
  ALERT_PRIVACY_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Alert/AlertPrivacySwitchCopy";
import { REMINDERS_SWITCH_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Reminders/RemindersSwitchCopy";
import RunbookSwitchCopy, {
  RUNBOOK_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookSwitchCopy";
import StatusPageVisibilitySwitchCopy, {
  STATUS_PAGE_VISIBILITY_KIND_COPY,
  STATUS_PAGE_VISIBILITY_SWITCH_TEST_ID,
  StatusPageVisibilityKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPageVisibility/StatusPageVisibilitySwitchCopy";
import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const RECORD_ID: string = "2e2e2e2e-0000-4000-8000-0000000000aa";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: false,
};

// What the server holds, per table.
let stored: Map<unknown, Record<string, unknown>> = new Map();

function storedFor(modelType: unknown): Record<string, unknown> {
  if (!stored.has(modelType)) {
    stored.set(modelType, {});
  }

  return stored.get(modelType)!;
}

beforeEach(() => {
  stored = new Map();
  recordedCards.length = 0;

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (options: unknown): Promise<unknown> => {
    const modelType: { new (): BaseModel } = (
      options as { modelType: { new (): BaseModel } }
    ).modelType;
    const item: BaseModel = new modelType();
    item._id = RECORD_ID;
    Object.assign(item, storedFor(modelType));
    return item;
  });

  getListMock.mockReset();
  getListMock.mockImplementation(async (): Promise<unknown> => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(
    async (options: unknown): Promise<unknown> => {
      const call: { modelType: unknown; data: Record<string, unknown> } =
        options as { modelType: unknown; data: Record<string, unknown> };
      Object.assign(storedFor(call.modelType), call.data);
      return {};
    },
  );

  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockImplementation(
    (): ObjectID => {
      return new ObjectID(RECORD_ID);
    },
  );

  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );
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

async function renderPage(
  Page: FunctionComponent<PageComponentProps>,
): Promise<void> {
  render(
    <MemoryRouter>
      <Page {...PAGE_PROPS} />
    </MemoryRouter>,
  );
  await flush();
}

interface UpdateCall {
  modelType: unknown;
  id: ObjectID;
  data: Record<string, unknown>;
}

function updateCalls(): Array<UpdateCall> {
  return updateByIdMock.mock.calls.map((call: Array<unknown>) => {
    return call[0] as UpdateCall;
  });
}

function cardTitles(): Array<string> {
  return Array.from(
    document.querySelectorAll('[data-testid="card-details-heading"]'),
  ).map((heading: Element): string => {
    return heading.textContent?.trim() || "";
  });
}

// Every card on the page is a switch: no Edit button anywhere.
function expectNoEditButtons(): void {
  expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
}

describe("an alert's Settings", () => {
  test("is two switches: who can see the alert, then reminders", async () => {
    await renderPage(AlertSettings);

    expect(cardTitles()).toEqual([
      AlertPrivacySwitchCopy.cardTitle,
      "Reminders",
    ]);
    expect(
      screen.getByTestId(ALERT_PRIVACY_SWITCH_TEST_ID),
    ).toBeInTheDocument();
    expect(screen.getByTestId(REMINDERS_SWITCH_TEST_ID)).toBeInTheDocument();
    expectNoEditButtons();
    expect(
      screen.queryByText("Manage settings for this alert here."),
    ).toBeNull();
    expect(recordedCards).toEqual([]);
  });

  test("Private Alert starts off on a new alert, and says everyone who can see alerts sees it", async () => {
    await renderPage(AlertSettings);

    const control: HTMLElement = screen.getByRole("switch", {
      name: AlertPrivacySwitchCopy.switchTitle,
    });

    expect(control).toBe(screen.getByTestId(ALERT_PRIVACY_SWITCH_TEST_ID));
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText(AlertPrivacySwitchCopy.switchOffDescription),
    ).toBeInTheDocument();
  });

  test("making it private asks first, says who keeps access, and saves nothing until confirmed", async () => {
    await renderPage(AlertSettings);

    const control: HTMLElement = screen.getByTestId(
      ALERT_PRIVACY_SWITCH_TEST_ID,
    );

    fireEvent.click(control);
    await flush();

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName(
      AlertPrivacySwitchCopy.makePrivateConfirmTitle,
    );
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(AlertPrivacySwitchCopy.makePrivateConfirmDescription);
    expect(updateByIdMock).not.toHaveBeenCalled();
    // It shows where it is going, locked, while the dialog is open.
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(control).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: AlertPrivacySwitchCopy.makePrivateConfirmButton,
      }),
    );
    await flush();

    expect(updateCalls()).toEqual([
      expect.objectContaining({
        modelType: Alert,
        data: { isPrivate: true },
      }),
    ]);
    expect(updateCalls()[0]!.id.toString()).toBe(RECORD_ID);
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(AlertPrivacySwitchCopy.switchOnDescription),
    ).toBeInTheDocument();
  });

  test("cancelled, the alert stays visible and nothing is saved", async () => {
    await renderPage(AlertSettings);

    const control: HTMLElement = screen.getByTestId(
      ALERT_PRIVACY_SWITCH_TEST_ID,
    );

    fireEvent.click(control);
    await flush();

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    await flush();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(control).toHaveAttribute("aria-checked", "false");
  });

  test("making a private alert visible again saves at once, with no dialog", async () => {
    storedFor(Alert)["isPrivate"] = true;

    await renderPage(AlertSettings);

    const control: HTMLElement = screen.getByTestId(
      ALERT_PRIVACY_SWITCH_TEST_ID,
    );
    expect(control).toHaveAttribute("aria-checked", "true");

    fireEvent.click(control);
    await flush();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCalls()).toEqual([
      expect.objectContaining({
        modelType: Alert,
        data: { isPrivate: false },
      }),
    ]);
  });

  test("the alert's reminders switch saves on the alert", async () => {
    await renderPage(AlertSettings);

    fireEvent.click(screen.getByTestId(REMINDERS_SWITCH_TEST_ID));
    await flush();

    expect(updateCalls()).toEqual([
      expect.objectContaining({
        modelType: Alert,
        data: { enableReminders: false },
      }),
    ]);
  });

  test("the confirmation is for making it private only, and does not dress it up as a danger", () => {
    expect(getMakeAlertPrivateConfirmation(false)).toBeUndefined();
    expect(getMakeAlertPrivateConfirmation(true)).toEqual({
      title: AlertPrivacySwitchCopy.makePrivateConfirmTitle,
      description: AlertPrivacySwitchCopy.makePrivateConfirmDescription,
      submitButtonText: AlertPrivacySwitchCopy.makePrivateConfirmButton,
    });
  });
});

describe("an episode's Settings", () => {
  test("is one switch, Visible on Status Page, off on a new episode, with no Edit button", async () => {
    await renderPage(EpisodeSettings);

    expect(cardTitles()).toEqual([StatusPageVisibilitySwitchCopy.cardTitle]);
    expect(
      screen.getByText(
        STATUS_PAGE_VISIBILITY_KIND_COPY[
          StatusPageVisibilityKind.IncidentEpisode
        ].cardDescription,
      ),
    ).toBeInTheDocument();

    const control: HTMLElement = screen.getByRole("switch", {
      name: StatusPageVisibilitySwitchCopy.switchTitle,
    });

    expect(control).toBe(
      screen.getByTestId(STATUS_PAGE_VISIBILITY_SWITCH_TEST_ID),
    );
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(
      screen.getByText(
        STATUS_PAGE_VISIBILITY_KIND_COPY[
          StatusPageVisibilityKind.IncidentEpisode
        ].switchOffDescription,
      ),
    ).toBeInTheDocument();
    expectNoEditButtons();
    expect(
      screen.queryByText("Manage settings for this episode here."),
    ).toBeNull();
  });

  test("showing it on status pages saves that column of the episode at once", async () => {
    await renderPage(EpisodeSettings);

    const control: HTMLElement = screen.getByTestId(
      STATUS_PAGE_VISIBILITY_SWITCH_TEST_ID,
    );

    fireEvent.click(control);
    await flush();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCalls()).toEqual([
      expect.objectContaining({
        modelType: IncidentEpisode,
        data: { isVisibleOnStatusPage: true },
      }),
    ]);
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(
        STATUS_PAGE_VISIBILITY_KIND_COPY[
          StatusPageVisibilityKind.IncidentEpisode
        ].switchOnDescription,
      ),
    ).toBeInTheDocument();
  });
});

describe("a scheduled maintenance event's Settings", () => {
  test("is two switches: whether it shows on its status pages, then reminders", async () => {
    await renderPage(ScheduledMaintenanceSettings);

    expect(cardTitles()).toEqual([
      StatusPageVisibilitySwitchCopy.cardTitle,
      "Reminders",
    ]);
    expectNoEditButtons();
    expect(
      screen.queryByText(
        "Manage your scheduled maintenance event settings here.",
      ),
    ).toBeNull();
  });

  test("an event shows on its status pages by default; hiding it saves at once and says subscribers hear nothing", async () => {
    await renderPage(ScheduledMaintenanceSettings);

    const control: HTMLElement = screen.getByTestId(
      STATUS_PAGE_VISIBILITY_SWITCH_TEST_ID,
    );
    expect(control).toHaveAttribute("aria-checked", "true");

    fireEvent.click(control);
    await flush();

    expect(updateCalls()).toEqual([
      expect.objectContaining({
        modelType: ScheduledMaintenance,
        data: { isVisibleOnStatusPage: false },
      }),
    ]);
    expect(
      screen.getByText(
        STATUS_PAGE_VISIBILITY_KIND_COPY[
          StatusPageVisibilityKind.ScheduledMaintenance
        ].switchOffDescription,
      ),
    ).toBeInTheDocument();
  });

  test("its reminders switch saves on the event", async () => {
    await renderPage(ScheduledMaintenanceSettings);

    fireEvent.click(screen.getByTestId(REMINDERS_SWITCH_TEST_ID));
    await flush();

    expect(updateCalls()).toEqual([
      expect.objectContaining({
        modelType: ScheduledMaintenance,
        data: { enableReminders: false },
      }),
    ]);
  });
});

describe("a runbook's Settings", () => {
  test("is one switch, Run this runbook, on for a new runbook, with no Edit button or Status pill", async () => {
    await renderPage(RunbookSettings);

    expect(cardTitles()).toEqual([RunbookSwitchCopy.cardTitle]);
    expect(
      screen.getByText(RunbookSwitchCopy.cardDescription),
    ).toBeInTheDocument();

    const control: HTMLElement = screen.getByRole("switch", {
      name: RunbookSwitchCopy.switchTitle,
    });

    expect(control).toBe(screen.getByTestId(RUNBOOK_SWITCH_TEST_ID));
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(RunbookSwitchCopy.switchOnDescription),
    ).toBeInTheDocument();
    expectNoEditButtons();
    expect(screen.queryByText("Enable / Disable Runbook")).toBeNull();
    expect(screen.queryByText("Disabled")).toBeNull();
  });

  test("turning it off saves at once, and says what off means", async () => {
    await renderPage(RunbookSettings);

    const control: HTMLElement = screen.getByTestId(RUNBOOK_SWITCH_TEST_ID);

    fireEvent.click(control);
    await flush();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCalls()).toEqual([
      expect.objectContaining({
        modelType: Runbook,
        data: { isEnabled: false },
      }),
    ]);
    expect(updateCalls()[0]!.id.toString()).toBe(RECORD_ID);
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText(RunbookSwitchCopy.switchOffDescription),
    ).toBeInTheDocument();
  });

  test("a runbook that is off reads off, and turning it on saves true", async () => {
    storedFor(Runbook)["isEnabled"] = false;

    await renderPage(RunbookSettings);

    const control: HTMLElement = screen.getByTestId(RUNBOOK_SWITCH_TEST_ID);
    expect(control).toHaveAttribute("aria-checked", "false");

    fireEvent.click(control);
    await flush();

    expect(updateCalls()[0]!.data).toEqual({ isEnabled: true });
  });

  test("someone who may not edit runbooks sees it locked, with why", async () => {
    getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
      (): PermissionGateResult => {
        return {
          isAllowed: false,
          disabledReason:
            "You need one of these permissions to update this runbook: Edit Runbook.",
        };
      },
    );

    await renderPage(RunbookSettings);

    const control: HTMLElement = screen.getByTestId(RUNBOOK_SWITCH_TEST_ID);

    expect(control).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(control);
    await flush();

    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});

describe("an incident's Settings", () => {
  test("keeps its two forms, and its reminders are one switch after them", async () => {
    await renderPage(IncidentSettings);

    const names: Array<string> = recordedCards.map(
      (props: Record<string, unknown>): string => {
        return props["name"] as string;
      },
    );

    expect(Array.from(new Set(names))).toEqual([
      "Incident Settings",
      "Status Page Scope",
    ]);
    expect(names).not.toContain("Reminders");

    const reminders: HTMLElement = screen.getByTestId(REMINDERS_SWITCH_TEST_ID);
    expect(reminders).toHaveAttribute("role", "switch");

    // After the stubbed forms, on the page.
    const scopeCard: HTMLElement = screen.getAllByTestId(
      "stub-card-Status Page Scope",
    )[0]!;
    expect(
      scopeCard.compareDocumentPosition(reminders) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("Incident Settings says what it is for, not 'Manage settings for this incident here.'", async () => {
    await renderPage(IncidentSettings);

    const settings: Record<string, unknown> | undefined = recordedCards.find(
      (props: Record<string, unknown>): boolean => {
        return props["name"] === "Incident Settings";
      },
    );

    expect(
      (settings?.["cardProps"] as { description: string }).description,
    ).toBe(
      "Whether this incident shows on status pages, and who in the project can see it.",
    );
  });

  test("the reminders switch saves on the incident", async () => {
    await renderPage(IncidentSettings);

    fireEvent.click(screen.getByTestId(REMINDERS_SWITCH_TEST_ID));
    await flush();

    expect(updateCalls()).toEqual([
      expect.objectContaining({
        modelType: Incident,
        data: { enableReminders: false },
      }),
    ]);
  });
});
