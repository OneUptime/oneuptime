import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Scheduling maintenance takes two short steps and a review, with sensible
 * times and notifications already set.
 *
 * "The idea is to reduce decision / choice paralysis as much as possible:
 * show people as few options as possible (and hide those other 'advanced'
 * options), and have sane defaults." - the maintainer.
 *
 * Create Scheduled Maintenance Event used to walk seven steps with both
 * times empty and required. The real page is drawn here, through the real
 * ModelForm and BasicForm, with only the network, the clock and the
 * signed-in user stubbed:
 *
 *   - two steps (Event, Resources Affected) and the review, the shape of
 *     Declare Incident;
 *   - Starts At is the next full hour, Ends At an hour later, so typing a
 *     title is all it asks for - Next walks the rest, and Create is on the
 *     review, the last step;
 *   - moving the start moves the end with it, and the end must come after
 *     the start;
 *   - Owners and Labels wait under Advanced on Event; Resources Affected
 *     asks for the monitors apart from the other resources, with Change
 *     Monitor Status to right under them once one is picked (covered in
 *     ScheduledMaintenanceMonitorsApart.test.tsx);
 *   - the three subscriber switches and the reminders are folded to the one
 *     line that says what happens, that line follows the switches, and the
 *     review step shows it;
 *   - first in that section, when the event is published on its status
 *     pages (#5249): right away, or at a date and time picked there - which
 *     must come before the event starts - and the line says when;
 *   - an event made from a template that keeps subscribers quiet opens that
 *     section by itself, so nothing set away from the default is hidden.
 */

jest.mock("../../../UI/Utils/Permission", () => {
  const actualPermission: Record<string, unknown> = jest.requireActual(
    "../../../Types/Permission",
  ) as Record<string, unknown>;
  const PermissionEnum: Record<string, string> = actualPermission[
    "default"
  ] as Record<string, string>;
  const granted: Array<string> = [
    PermissionEnum["ProjectOwner"]!,
    PermissionEnum["User"]!,
    PermissionEnum["Public"]!,
  ];

  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return granted;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: granted };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      createOrUpdate: (...args: Array<unknown>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

import ScheduledMaintenanceCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Create";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { getSubscriberNotificationSummary } from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceForm";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { setChips } from "../../UI/Components/FoldedSection/FoldedSectionQueries";

const NOW: Date = new Date("2026-10-03T09:20:00.000Z");
const TEMPLATE_ID: string = "11111111-1111-4111-8111-111111111111";
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";

const ALL_ON_SUMMARY: string =
  "Subscribers of the event's status pages are notified when it is scheduled, when it starts and when it ends.";

// The section's first sentence: when the event shows on its status pages.
const RIGHT_AWAY_SUMMARY: string =
  "Shown on its status pages as soon as it is saved.";

const SECTION_LINE: string = `${RIGHT_AWAY_SUMMARY} ${ALL_ON_SUMMARY}`;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(
    "/dashboard/project/scheduled-maintenance-events/create",
  ),
  currentProject: null,
  hasPaymentMethod: true,
};

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const german: i18n = createInstance();

let templateIdInUrl: string | null = null;

// The language the page is drawn in; labels are looked up in it.
let pageLanguage: i18n | null = null;

function inPageLanguage(english: string): string {
  return pageLanguage ? pageLanguage.t(english) : english;
}

function listOf<T extends BaseModel>(
  items: Array<T>,
): {
  data: Array<T>;
  count: number;
  skip: number;
  limit: number;
} {
  return { data: items, count: items.length, skip: 0, limit: 100 };
}

function makeStatusPage(): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = STATUS_PAGE_ID;
  statusPage.name = "Acme Public Status";
  return statusPage;
}

function makeLabel(): Label {
  const label: Label = new Label();
  label._id = "33333333-3333-4333-8333-333333333333";
  label.name = "Database";
  return label;
}

function makeMonitorStatus(): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status._id = "44444444-4444-4444-8444-444444444444";
  status.name = "Under Maintenance";
  return status;
}

function makeTemplate(): ScheduledMaintenanceTemplate {
  const template: ScheduledMaintenanceTemplate =
    new ScheduledMaintenanceTemplate();
  template._id = TEMPLATE_ID;
  template.title = "Weekly database patching";
  template.description = "Patch the primary and the replicas.";
  template.shouldStatusPageSubscribersBeNotifiedOnEventCreated = false;
  template.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing =
    true;
  template.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded = true;
  return template;
}

async function renderPage(language?: i18n): Promise<void> {
  pageLanguage = language || null;

  const Wrapper: (props: { children?: ReactNode }) => ReactElement = (props: {
    children?: ReactNode;
  }): ReactElement => {
    return language ? (
      <I18nextProvider i18n={language}>{props.children}</I18nextProvider>
    ) : (
      <>{props.children}</>
    );
  };

  render(
    <MemoryRouter>
      <ScheduledMaintenanceCreate {...PAGE_PROPS} />
    </MemoryRouter>,
    { wrapper: Wrapper },
  );

  await screen.findByRole("navigation", { name: inPageLanguage("Progress") });
  // The defaults land once the form has its fields.
  await waitFor(() => {
    expect(startsAtInput().value).not.toBe("");
  });
}

function form(): HTMLElement {
  return document.getElementById("create-scheduledMaintenance-form")!;
}

function stepTitles(): Array<string> {
  return within(
    screen.getByRole("navigation", { name: inPageLanguage("Progress") }),
  )
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

function currentStepTitle(): string {
  const current: Element | null = screen
    .getByRole("navigation", { name: inPageLanguage("Progress") })
    .querySelector("[aria-current='step']");

  return (current?.textContent || "").trim();
}

function inputById(selector: string): HTMLInputElement {
  return form().querySelector(selector) as HTMLInputElement;
}

function labelledInput(labelText: string): HTMLInputElement {
  const label: HTMLElement | undefined = Array.from(
    form().querySelectorAll("label"),
  ).find((candidate: HTMLLabelElement): boolean => {
    return (candidate.textContent || "")
      .trim()
      .startsWith(inPageLanguage(labelText));
  }) as HTMLElement | undefined;

  expect(label).toBeDefined();

  const inputId: string | null = label!.getAttribute("for");

  return inputById(`[id="${inputId}"]`);
}

function startsAtInput(): HTMLInputElement {
  return labelledInput("Starts At");
}

function endsAtInput(): HTMLInputElement {
  return labelledInput("Ends At");
}

function titleInput(): HTMLInputElement {
  return labelledInput("Title");
}

function createButton(): HTMLElement {
  return screen.getByRole("button", {
    name: inPageLanguage("Create Scheduled Maintenance Event"),
  });
}

function nextButton(): HTMLElement {
  return screen.getByRole("button", { name: inPageLanguage("Next") });
}

function queryCreateButton(): HTMLElement | null {
  return screen.queryByRole("button", {
    name: inPageLanguage("Create Scheduled Maintenance Event"),
  });
}

/*
 * Create Scheduled Maintenance Event is on the last step - the review -
 * only: walks there with Next, then presses it.
 */
async function createFromTheReview(): Promise<void> {
  for (let step: number = 0; step < 5 && !queryCreateButton(); step++) {
    fireEvent.click(nextButton());
    await act(async () => {});
  }

  await waitFor(() => {
    expect(currentStepTitle()).toBe(inPageLanguage("Summary"));
  });

  fireEvent.click(createButton());
}

async function typeTitle(title: string): Promise<void> {
  fireEvent.change(titleInput(), { target: { value: title } });
  await act(async () => {});
}

async function goToNextStep(expectedTitle: string): Promise<void> {
  fireEvent.click(nextButton());

  await waitFor(() => {
    expect(currentStepTitle()).toBe(expectedTitle);
  });
}

function sectionHeader(title: string): HTMLElement {
  return screen.getByRole("button", { name: title });
}

// What a folded section holds: the body its header controls.
function sectionBody(header: HTMLElement): HTMLElement {
  return document.getElementById(header.getAttribute("aria-controls")!)!;
}

// The fields in an element, by the labels they are drawn with.
function fieldLabelsIn(element: HTMLElement): Array<string> {
  return Array.from(element.querySelectorAll("label"))
    .map((label: HTMLLabelElement): string => {
      return (label.textContent || "").replace("(Optional)", "").trim();
    })
    .filter((text: string, index: number, all: Array<string>): boolean => {
      return Boolean(text) && all.indexOf(text) === index;
    });
}

function createdModel(): ScheduledMaintenance {
  expect(createOrUpdateMock).toHaveBeenCalledTimes(1);

  const call: Array<unknown> = createOrUpdateMock.mock
    .calls[0] as Array<unknown>;

  return (call[0] as { model: ScheduledMaintenance }).model;
}

function isoOf(value: unknown): string {
  return OneUptimeDate.fromString(value as string).toISOString();
}

beforeAll(async () => {
  await german.init({
    lng: "de",
    fallbackLng: "de",
    resources: {
      de: {
        translation: JSON.parse(
          fs.readFileSync(path.join(LOCALES_DIR, "de.json"), "utf8"),
        ) as Record<string, string>,
      },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  templateIdInUrl = null;
  getListMock.mockReset();
  getItemMock.mockReset();
  createOrUpdateMock.mockReset();
  PermissionGate.clearPermissionPropsCache();

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  OneUptimeDate.setUserTimezone(Timezone.UTC);

  jest
    .spyOn(Navigation, "getQueryStringByName")
    .mockImplementation((name: string): string | null => {
      return name === "scheduledMaintenanceTemplateId" ? templateIdInUrl : null;
    });
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});

  getListMock.mockImplementation(
    async (args: unknown): Promise<ReturnType<typeof listOf>> => {
      const modelType: DatabaseBaseModelType = (
        args as { modelType: DatabaseBaseModelType }
      ).modelType;

      if (modelType === StatusPage) {
        return listOf([makeStatusPage()]);
      }

      if (modelType === Label) {
        return listOf([makeLabel()]);
      }

      if (modelType === MonitorStatus) {
        return listOf([makeMonitorStatus()]);
      }

      return listOf([]);
    },
  );

  getItemMock.mockImplementation(async (): Promise<BaseModel | null> => {
    return makeTemplate();
  });

  createOrUpdateMock.mockImplementation(
    async (data: unknown): Promise<{ data: Record<string, unknown> }> => {
      return {
        data: {
          ...BaseModel.toJSON(
            (data as { model: ScheduledMaintenance }).model,
            ScheduledMaintenance,
          ),
          _id: "55555555-5555-4555-8555-555555555555",
        },
      };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
  pageLanguage = null;
});

describe("Create Scheduled Maintenance Event", () => {
  test("walks two steps and the review", async () => {
    await renderPage();

    expect(stepTitles()).toEqual(["Event", "Resources Affected", "Summary"]);
    expect(currentStepTitle()).toBe("Event");
  });

  test("starts at the next full hour and ends an hour later", async () => {
    await renderPage();

    // 09:20 UTC: the next full hour is 10:00.
    expect(startsAtInput().value).toMatch(/^2026-10-03T10:00/);
    expect(endsAtInput().value).toMatch(/^2026-10-03T11:00/);
  });

  test("works the next full hour out on the reader's clock", async () => {
    // 04:50 UTC is 10:20 in Kolkata (UTC+5:30): the next full hour is 11:00 there.
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date("2026-10-03T04:50:00.000Z"));
    OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

    await renderPage();

    expect(startsAtInput().value).toMatch(/^2026-10-03T11:00/);
    expect(endsAtInput().value).toMatch(/^2026-10-03T12:00/);

    await typeTitle("Database upgrade");
    await createFromTheReview();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(isoOf(createdModel().startsAt)).toBe("2026-10-03T05:30:00.000Z");
    expect(isoOf(createdModel().endsAt)).toBe("2026-10-03T06:30:00.000Z");
  });

  test("asks for nothing but a title, and creates from the review, the last step", async () => {
    await renderPage();

    // Nothing else is required, and still Create waits for the last step.
    expect(queryCreateButton()).toBeNull();
    expect(nextButton()).toBeInTheDocument();

    await typeTitle("Database upgrade");
    await createFromTheReview();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: ScheduledMaintenance = createdModel();

    expect(model.title).toBe("Database upgrade");
    expect(isoOf(model.startsAt)).toBe("2026-10-03T10:00:00.000Z");
    expect(isoOf(model.endsAt)).toBe("2026-10-03T11:00:00.000Z");
    // The model's defaults, sent as the form showed them.
    expect(model.shouldStatusPageSubscribersBeNotifiedOnEventCreated).toBe(
      true,
    );
    expect(
      model.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing,
    ).toBe(true);
    expect(
      model.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded,
    ).toBe(true);
    // Nothing is published that was not picked.
    expect(model.statusPages || []).toEqual([]);
    await waitFor(() => {
      expect(Navigation.navigate).toHaveBeenCalled();
    });
  });

  test("still asks for the title when Next is pressed without one", async () => {
    await renderPage();

    fireEvent.click(nextButton());

    expect(await screen.findByText("Title is required.")).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("moves the end with the start, keeping the window's length", async () => {
    await renderPage();

    fireEvent.change(startsAtInput(), {
      target: { value: "2026-10-05T14:00" },
    });

    await waitFor(() => {
      expect(endsAtInput().value).toMatch(/^2026-10-05T15:00/);
    });

    // A longer window stays as long when the start moves again.
    fireEvent.change(endsAtInput(), { target: { value: "2026-10-05T18:30" } });
    await act(async () => {});
    fireEvent.change(startsAtInput(), {
      target: { value: "2026-10-06T08:00" },
    });

    await waitFor(() => {
      expect(endsAtInput().value).toMatch(/^2026-10-06T12:30/);
    });

    await typeTitle("Database upgrade");
    await createFromTheReview();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(isoOf(createdModel().startsAt)).toBe("2026-10-06T08:00:00.000Z");
    expect(isoOf(createdModel().endsAt)).toBe("2026-10-06T12:30:00.000Z");
  });

  test("will not create an event that ends before it starts", async () => {
    await renderPage();
    await typeTitle("Database upgrade");

    fireEvent.change(endsAtInput(), { target: { value: "2026-10-03T09:00" } });
    await act(async () => {});
    fireEvent.click(nextButton());

    expect(
      await screen.findByText("Ends At must be after Starts At."),
    ).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
    expect(currentStepTitle()).toBe("Event");
  });

  test("Event folds Owners and Labels under Advanced, at the end of the step", async () => {
    await renderPage();

    const advanced: HTMLElement = sectionHeader("More fields");

    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(setChips()).toEqual([]);
    expect(fieldLabelsIn(sectionBody(advanced))).toEqual(["Owners", "Labels"]);

    const labelsLabel: HTMLElement = within(sectionBody(advanced)).getByText(
      "Labels",
      { exact: false, selector: "label *, label" },
    );

    expect(labelsLabel).not.toBeVisible();

    fireEvent.click(advanced);

    expect(advanced).toHaveAttribute("aria-expanded", "true");
    expect(labelsLabel).toBeVisible();
  });

  test("Resources Affected shows the monitors, the other resources, the status pages and one line about subscribers", async () => {
    await renderPage();
    await typeTitle("Database upgrade");
    await goToNextStep("Resources Affected");

    expect(
      screen.getByText("Show event on these status pages", { exact: false }),
    ).toBeVisible();

    const notifications: HTMLElement = sectionHeader(
      "Subscriber Notifications",
    );

    expect(notifications).toHaveAttribute("aria-expanded", "false");
    expect(notifications).toHaveAccessibleDescription(SECTION_LINE);
    expect(screen.getByTestId("collapsible-section-summary")).toBeVisible();
    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      SECTION_LINE,
    );
    // Folded, the switches are out of sight and out of the tab order.
    expect(
      screen.getByRole("checkbox", {
        name: "When the event is scheduled",
        hidden: true,
      }),
    ).not.toBeVisible();
    expect(fieldLabelsIn(sectionBody(notifications))).toEqual([
      "Publish on Status Pages",
      "Right away",
      "At a date and time",
      "When the event is scheduled",
      "When the event starts",
      "When the event ends",
      "Reminders before the event",
    ]);

    /*
     * The step's fields, in order. Change Monitor Status to is not among
     * them until a monitor is picked, and nothing is folded under More
     * fields here any more.
     */
    expect(fieldLabelsIn(form())).toEqual([
      "Monitors",
      "Other Affected Resources",
      "Show event on these status pages",
      "Publish on Status Pages",
      "Right away",
      "At a date and time",
      "When the event is scheduled",
      "When the event starts",
      "When the event ends",
      "Reminders before the event",
    ]);
    expect(
      screen.queryByText("Change Monitor Status to", { exact: false }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "More fields" })).toBeNull();
    expect(setChips()).toEqual([]);

    // Nothing on the step is required; Create is still on the review only.
    expect(queryCreateButton()).toBeNull();
    expect(nextButton()).toBeInTheDocument();
  });

  test("the subscriber line follows the switches, and the event is saved as they say", async () => {
    await renderPage();
    await typeTitle("Database upgrade");
    await goToNextStep("Resources Affected");

    const notifications: HTMLElement = sectionHeader(
      "Subscriber Notifications",
    );

    fireEvent.click(notifications);

    const scheduled: HTMLElement = screen.getByRole("checkbox", {
      name: "When the event is scheduled",
    });
    const starts: HTMLElement = screen.getByRole("checkbox", {
      name: "When the event starts",
    });
    const ends: HTMLElement = screen.getByRole("checkbox", {
      name: "When the event ends",
    });

    expect(scheduled).toBeChecked();
    expect(starts).toBeChecked();
    expect(ends).toBeChecked();
    expect(screen.getByText("Reminders before the event")).toBeVisible();

    fireEvent.click(starts);
    await act(async () => {});
    fireEvent.click(notifications);

    expect(notifications).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      "Subscribers of the event's status pages are notified when it is scheduled and when it ends.",
    );
    // The line says what is set; no "Configured" badge repeats it.
    expect(setChips()).toEqual([]);

    await createFromTheReview();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: ScheduledMaintenance = createdModel();

    expect(model.shouldStatusPageSubscribersBeNotifiedOnEventCreated).toBe(
      true,
    );
    expect(
      model.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing,
    ).toBe(false);
    expect(
      model.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded,
    ).toBe(true);
  });

  test("the review step says who will be told, in the section's line", async () => {
    await renderPage();
    await typeTitle("Database upgrade");
    await goToNextStep("Resources Affected");
    await goToNextStep("Summary");

    for (const heading of ["Event", "Resources Affected"]) {
      expect(
        within(form()).getByRole("heading", { level: 2, name: heading }),
      ).toBeInTheDocument();
    }

    expect(within(form()).getByText("Database upgrade")).toBeInTheDocument();
    expect(
      within(form()).getByText("Subscriber Notifications"),
    ).toBeInTheDocument();
    expect(
      within(form()).getByTestId("form-summary-section-summary"),
    ).toHaveTextContent(SECTION_LINE);
    // The switches are reviewed by that line, not one row each.
    expect(
      within(form()).queryByText("When the event is scheduled"),
    ).toBeNull();
    // Advanced options nobody touched are left out of the review.
    expect(within(form()).queryByText("Labels", { exact: false })).toBeNull();
    expect(
      within(form()).queryByText("Change Monitor Status to", {
        exact: false,
      }),
    ).toBeNull();
  });

  test("an event from a template that keeps subscribers quiet opens that section by itself", async () => {
    templateIdInUrl = TEMPLATE_ID;

    await renderPage();

    expect(getItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelType: ScheduledMaintenanceTemplate }),
    );
    expect(titleInput().value).toBe("Weekly database patching");
    // A template holds no window of its own: the event still starts at the next full hour.
    expect(startsAtInput().value).toMatch(/^2026-10-03T10:00/);

    await goToNextStep("Resources Affected");

    const notifications: HTMLElement = sectionHeader(
      "Subscriber Notifications",
    );

    await waitFor(() => {
      expect(notifications).toHaveAttribute("aria-expanded", "true");
    });
    expect(
      screen.getByRole("checkbox", { name: "When the event is scheduled" }),
    ).not.toBeChecked();

    fireEvent.click(notifications);

    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      "Subscribers of the event's status pages are notified when it starts and when it ends.",
    );
  });

  /*
   * Nobody can pick an archived label or monitor status for a new event
   * (Common/Utils/ArchivableValues), and the server refuses a create that
   * names one: a template that still has one starts the event without it,
   * instead of a form that cannot be saved. The template keeps it.
   */
  test("a template's archived label and monitor status stay with the template: the event starts with the rest", async () => {
    templateIdInUrl = TEMPLATE_ID;

    const liveLabel: Label = makeLabel();
    liveLabel.isArchived = false;

    const archivedLabel: Label = new Label();
    archivedLabel._id = "66666666-6666-4666-8666-666666666666";
    archivedLabel.name = "legacy-db";
    archivedLabel.isArchived = true;

    const archivedStatus: MonitorStatus = makeMonitorStatus();
    archivedStatus.isArchived = true;

    getItemMock.mockImplementation(async (): Promise<BaseModel | null> => {
      const template: ScheduledMaintenanceTemplate = makeTemplate();
      template.labels = [liveLabel, archivedLabel];
      template.changeMonitorStatusTo = archivedStatus;
      template.changeMonitorStatusToId = new ObjectID(archivedStatus._id!);
      return template;
    });

    await renderPage();

    // Read with the archive switch, to tell the archived ones apart.
    expect(getItemMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: ScheduledMaintenanceTemplate,
        select: expect.objectContaining({
          labels: { _id: true, isArchived: true },
          changeMonitorStatusTo: { _id: true, isArchived: true },
        }),
      }),
    );

    await createFromTheReview();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: ScheduledMaintenance = createdModel();

    expect(
      (model.labels || []).map((label: Label): string => {
        return label._id?.toString() || "";
      }),
    ).toEqual([liveLabel._id]);
    expect(model.changeMonitorStatusTo).toBeFalsy();
    expect(model.changeMonitorStatusToId).toBeFalsy();
  });

  test("reads in the reader's language", async () => {
    await renderPage(german);

    const german_: (key: string) => string = (key: string): string => {
      return german.t(key);
    };

    expect(stepTitles()).toEqual([
      german_("Event"),
      german_("Resources Affected"),
      german_("Summary"),
    ]);
    expect(german_("Resources Affected")).not.toBe("Resources Affected");

    await typeTitle("Datenbank-Upgrade");
    fireEvent.click(nextButton());
    await waitFor(() => {
      expect(currentStepTitle()).toBe(german_("Resources Affected"));
    });

    const summary: string = getSubscriberNotificationSummary({})
      .map((sentence: string): string => {
        return german_(sentence);
      })
      .join(" ");

    expect(summary).not.toContain("Subscribers");
    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      summary,
    );
    expect(
      screen.getByRole("button", {
        name: german_("Subscriber Notifications"),
      }),
    ).toBeInTheDocument();
  });
});

/*
 * Publishing an event at a chosen time (#5249): planned work known long
 * before customers should hear of it stays off its status pages - and its
 * subscribers are told nothing - until a time picked first in Subscriber
 * Notifications. Right away stays what every event does.
 */
describe("Create Scheduled Maintenance Event: when it is published", () => {
  // The event starts at 10:00 UTC (the next full hour after 09:20).
  const BEFORE_THE_START: string = "2026-10-03T09:45";
  const AFTER_THE_START: string = "2026-10-03T10:30";

  async function openSubscriberNotifications(): Promise<HTMLElement> {
    await renderPage();
    await typeTitle("Database upgrade");
    await goToNextStep("Resources Affected");

    const notifications: HTMLElement = sectionHeader(
      "Subscriber Notifications",
    );

    fireEvent.click(notifications);
    await act(async () => {});

    return notifications;
  }

  function queryPublishAtInput(): HTMLInputElement | null {
    const label: HTMLElement | undefined = Array.from(
      form().querySelectorAll("label"),
    ).find((candidate: HTMLLabelElement): boolean => {
      return (candidate.textContent || "").trim().startsWith("Publish At");
    }) as HTMLElement | undefined;

    if (!label) {
      return null;
    }

    return inputById(`[id="${label.getAttribute("for")}"]`);
  }

  async function pickAtADateAndTime(): Promise<HTMLInputElement> {
    fireEvent.click(screen.getByRole("radio", { name: "At a date and time" }));
    await act(async () => {});

    const input: HTMLInputElement | null = queryPublishAtInput();

    expect(input).not.toBeNull();

    return input!;
  }

  async function setPublishAt(value: string): Promise<void> {
    fireEvent.change(queryPublishAtInput()!, { target: { value } });
    await act(async () => {});
  }

  test("asks first in Subscriber Notifications, with Right away picked and no time to fill in", async () => {
    await openSubscriberNotifications();

    const question: HTMLElement = screen.getByRole("radiogroup", {
      name: "Publish on Status Pages",
    });

    expect(
      within(question).getByRole("radio", { name: "Right away" }),
    ).toBeChecked();
    expect(
      within(question).getByRole("radio", { name: "At a date and time" }),
    ).not.toBeChecked();
    // Each answer says what it means.
    expect(
      screen.getByText("It shows on its status pages as soon as it is saved."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "It stays off its status pages until then, and their subscribers hear nothing about it.",
      ),
    ).toBeInTheDocument();
    expect(queryPublishAtInput()).toBeNull();
  });

  test("When the event is scheduled says it is sent when the event shows; the start and end boxes need no more words", async () => {
    await openSubscriberNotifications();

    expect(
      screen.getByText("Sent when the event shows on its status pages."),
    ).toBeVisible();
    /*
     * The columns' own help - "about this event creation?", "this event
     * event is changed to ongoing?" - is drawn under none of the three.
     */
    expect(form()).not.toHaveTextContent("Should subscribers be notified");
  });

  test("published right away by default: the event is created with no publish time", async () => {
    await renderPage();
    await typeTitle("Database upgrade");
    await createFromTheReview();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(createdModel().publishOnStatusPageAt ?? null).toBeNull();
  });

  test("At a date and time asks for the time; the event is created with it, and the line says from when", async () => {
    const notifications: HTMLElement = await openSubscriberNotifications();

    await pickAtADateAndTime();
    await setPublishAt(BEFORE_THE_START);

    // The time is in the reader's timezone, and the field says which.
    expect(
      screen.getByText("This is in your timezone", { exact: false }),
    ).toBeInTheDocument();

    fireEvent.click(notifications);
    await act(async () => {});

    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      `Shown on its status pages from ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(new Date("2026-10-03T09:45:00.000Z"))}.`,
    );
    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      ALL_ON_SUMMARY,
    );

    await createFromTheReview();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(isoOf(createdModel().publishOnStatusPageAt)).toBe(
      "2026-10-03T09:45:00.000Z",
    );
    // Its subscribers are still told it is scheduled - at that time.
    expect(
      createdModel().shouldStatusPageSubscribersBeNotifiedOnEventCreated,
    ).toBe(true);
  });

  test("the review step says when it is published, in the section's line", async () => {
    await openSubscriberNotifications();
    await pickAtADateAndTime();
    await setPublishAt(BEFORE_THE_START);
    await goToNextStep("Summary");

    expect(
      within(form()).getByTestId("form-summary-section-summary"),
    ).toHaveTextContent(
      `Shown on its status pages from ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(new Date("2026-10-03T09:45:00.000Z"))}.`,
    );
  });

  test("At a date and time with no time picked asks for one", async () => {
    await openSubscriberNotifications();
    await pickAtADateAndTime();

    fireEvent.click(nextButton());

    expect(
      await screen.findByText("Publish At is required."),
    ).toBeInTheDocument();
    expect(currentStepTitle()).toBe("Resources Affected");
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("a time at or after the start is refused: it is published before the work", async () => {
    await openSubscriberNotifications();
    await pickAtADateAndTime();
    await setPublishAt(AFTER_THE_START);

    fireEvent.click(nextButton());

    expect(
      await screen.findByText("Publish At must be before Starts At."),
    ).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();

    await setPublishAt("2026-10-03T10:00");
    fireEvent.click(nextButton());

    expect(
      await screen.findByText("Publish At must be before Starts At."),
    ).toBeInTheDocument();
  });

  test("back to Right away: the time is cleared, and the event is published as soon as it is created", async () => {
    const notifications: HTMLElement = await openSubscriberNotifications();
    await pickAtADateAndTime();
    await setPublishAt(BEFORE_THE_START);

    fireEvent.click(screen.getByRole("radio", { name: "Right away" }));
    await act(async () => {});

    expect(queryPublishAtInput()).toBeNull();

    // Folded, the line says so again.
    fireEvent.click(notifications);
    await act(async () => {});

    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      RIGHT_AWAY_SUMMARY,
    );

    await createFromTheReview();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(createdModel().publishOnStatusPageAt ?? null).toBeNull();
  });

  test("a time picked in another timezone is the instant the reader meant", async () => {
    // 04:50 UTC is 10:20 in Kolkata: the event starts at 11:00 there, 05:30 UTC.
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date("2026-10-03T04:50:00.000Z"));
    OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

    await openSubscriberNotifications();
    await pickAtADateAndTime();
    // 10:45 in Kolkata, before its 11:00 start.
    await setPublishAt("2026-10-03T10:45");

    await createFromTheReview();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(isoOf(createdModel().publishOnStatusPageAt)).toBe(
      "2026-10-03T05:15:00.000Z",
    );
  });

  test("reads in the reader's language", async () => {
    await renderPage(german);

    const german_: (key: string) => string = (key: string): string => {
      return german.t(key);
    };

    await typeTitle("Datenbank-Upgrade");
    fireEvent.click(nextButton());
    await waitFor(() => {
      expect(currentStepTitle()).toBe(german_("Resources Affected"));
    });

    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      german_(RIGHT_AWAY_SUMMARY),
    );
    expect(german_(RIGHT_AWAY_SUMMARY)).not.toBe(RIGHT_AWAY_SUMMARY);

    fireEvent.click(
      screen.getByRole("button", {
        name: german_("Subscriber Notifications"),
      }),
    );
    await act(async () => {});

    const question: HTMLElement = screen.getByRole("radiogroup", {
      name: german_("Publish on Status Pages"),
    });

    expect(
      within(question).getByRole("radio", { name: german_("Right away") }),
    ).toBeChecked();
    expect(
      within(question).getByRole("radio", {
        name: german_("At a date and time"),
      }),
    ).not.toBeChecked();
  });
});
