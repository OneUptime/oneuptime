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
import userEvent from "@testing-library/user-event";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Creating an announcement takes two steps, and from a status page that
 * page is already picked.
 *
 * "Make software as simple as possible to use and reduce decision
 * paralysis." - the maintainer.
 *
 * Create Announcement walked four steps and a review, and from a status
 * page's own Announcements tab it opened the project-wide form: the page
 * you had been standing on had to be picked again, and Create left you on
 * the project's list. The real page is drawn here, through the real
 * ModelForm and BasicForm, with only the network, the clock and the
 * signed-in user stubbed:
 *
 *   - two steps (Announcement, Status Pages) and the review;
 *   - the title and the description are asked for first - the server
 *     refuses an announcement without a description, so the form does too;
 *     attachments wait under Advanced;
 *   - the start, the end and the notify switch are folded to the one line
 *     that says what happens, the line follows them, and the review step
 *     shows it;
 *   - opened from a status page, that page is picked, Create is the main
 *     button from the first step, and it goes back to the page's tab;
 *   - a template's pages are kept beside that page, and its notify choice
 *     shows in the line.
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

import AnnouncementCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/AnnouncementCreate";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  ANNOUNCEMENT_ENDS_BEFORE_IT_STARTS_ERROR,
  ANNOUNCEMENT_ENDS_IN_THE_PAST_ERROR,
  ANNOUNCEMENT_SCHEDULE_SUMMARIES,
  ANNOUNCEMENT_SUBSCRIBERS_NOTIFIED_SUMMARY,
  ANNOUNCEMENT_SUBSCRIBERS_NOT_NOTIFIED_SUMMARY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Announcement/AnnouncementForm";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageAnnouncementTemplate from "../../../Models/DatabaseModels/StatusPageAnnouncementTemplate";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { setChips } from "../../UI/Components/FoldedSection/FoldedSectionQueries";

const NOW: Date = new Date("2026-10-03T09:20:00.000Z");
const PROJECT_ID: string = "00000000-0000-4000-8000-000000000001";
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";
const OTHER_STATUS_PAGE_ID: string = "33333333-3333-4333-8333-333333333333";
const TEMPLATE_ID: string = "11111111-1111-4111-8111-111111111111";
const MONITOR_ID: string = "44444444-4444-4444-8444-444444444444";

const DEFAULT_LINE: string = `${ANNOUNCEMENT_SCHEDULE_SUMMARIES.nowUntilEnded} ${ANNOUNCEMENT_SUBSCRIBERS_NOTIFIED_SUMMARY}`;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/project/status-pages/announcements/create"),
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

// The address the page is opened with.
let queryInUrl: Record<string, string> = {};

/*
 * What the server answers for STATUS_PAGE_ID: the page, an empty record (the
 * API's answer for a page that is gone or in another project), or a refusal.
 */
let statusPageOnServer: StatusPage | Error = new StatusPage();

// What the server answers for TEMPLATE_ID.
let templateOnServer: StatusPageAnnouncementTemplate | Error =
  new StatusPageAnnouncementTemplate();

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

function makeStatusPage(id: string, name: string): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = id;
  statusPage.name = name;
  return statusPage;
}

function makeMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID;
  monitor.name = "Checkout API";
  return monitor;
}

function makeTemplate(): StatusPageAnnouncementTemplate {
  const template: StatusPageAnnouncementTemplate =
    new StatusPageAnnouncementTemplate();
  template._id = TEMPLATE_ID;
  template.title = "Planned database upgrade";
  template.description = "The database is upgraded on Sunday.";
  template.statusPages = [
    makeStatusPage(OTHER_STATUS_PAGE_ID, "Internal Status"),
  ];
  template.monitors = [];
  template.shouldStatusPageSubscribersBeNotified = false;
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
      <AnnouncementCreate {...PAGE_PROPS} />
    </MemoryRouter>,
    { wrapper: Wrapper },
  );

  await screen.findByRole("navigation", { name: inPageLanguage("Progress") });
  await waitFor(() => {
    expect(labelText("Title")).not.toBe("");
  });
  /*
   * The form starts from its defaults in an effect after the fields are
   * drawn, which React runs in a task of its own: typing before it has run
   * would keep it from running at all (a person cannot type that fast).
   */
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

function form(): HTMLElement {
  return document.getElementById("create-announcement-form")!;
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

function findLabel(labelStart: string): HTMLLabelElement | undefined {
  return Array.from(form().querySelectorAll("label")).find(
    (candidate: HTMLLabelElement): boolean => {
      return (candidate.textContent || "")
        .trim()
        .startsWith(inPageLanguage(labelStart));
    },
  );
}

function labelText(labelStart: string): string {
  return (findLabel(labelStart)?.textContent || "").trim();
}

function labelledInput(labelStart: string): HTMLInputElement {
  const label: HTMLLabelElement | undefined = findLabel(labelStart);

  expect(`${labelStart}: ${Boolean(label)}`).toBe(`${labelStart}: true`);

  return form().querySelector(
    `[id="${label!.getAttribute("for")}"]`,
  ) as HTMLInputElement;
}

function startsAtInput(): HTMLInputElement {
  return labelledInput("Start Showing Announcement At");
}

function endsAtInput(): HTMLInputElement {
  return labelledInput("End Showing Announcement At");
}

function createButton(): HTMLElement {
  return screen.getByRole("button", {
    name: inPageLanguage("Create Announcement"),
  });
}

function queryCreateButton(): HTMLElement | null {
  return screen.queryByRole("button", {
    name: inPageLanguage("Create Announcement"),
  });
}

function nextButton(): HTMLElement {
  return screen.getByRole("button", { name: inPageLanguage("Next") });
}

async function typeTitle(title: string): Promise<void> {
  fireEvent.change(labelledInput("Title"), { target: { value: title } });
  await act(async () => {});
}

/*
 * The description, written in its editor's Markdown source: the editor
 * opens in its visual mode, and its Markdown button shows the source as a
 * textarea - the step's only one.
 */
async function typeDescription(text: string): Promise<void> {
  const toolbar: HTMLElement = within(form()).getByTestId(
    "markdown-editor-toolbar",
  );

  fireEvent.click(
    within(toolbar).getByRole("button", { name: inPageLanguage("Markdown") }),
  );

  const sources: Array<HTMLTextAreaElement> = Array.from(
    form().querySelectorAll<HTMLTextAreaElement>("textarea"),
  );

  expect(sources).toHaveLength(1);

  fireEvent.change(sources[0]!, { target: { value: text } });
  await act(async () => {});
}

async function writeAnnouncement(): Promise<void> {
  await typeTitle("Planned database upgrade");
  await typeDescription("The database is upgraded on Sunday at 02:00 UTC.");
}

async function goToNextStep(expectedTitle: string): Promise<void> {
  fireEvent.click(nextButton());

  await waitFor(() => {
    expect(currentStepTitle()).toBe(inPageLanguage(expectedTitle));
  });
}

function sectionHeader(title: string): HTMLElement {
  return screen.getByRole("button", { name: inPageLanguage(title) });
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

function sectionLine(): string {
  return (
    screen.getByTestId("collapsible-section-summary").textContent || ""
  ).trim();
}

/*
 * The line is drawn while the section is folded: fold it, read the line,
 * and open it again to go on answering.
 */
function lineOfOpenSection(header: HTMLElement): string {
  fireEvent.click(header);
  expect(header).toHaveAttribute("aria-expanded", "false");

  const line: string = sectionLine();

  fireEvent.click(header);
  expect(header).toHaveAttribute("aria-expanded", "true");

  return line;
}

function createdModel(): StatusPageAnnouncement {
  expect(createOrUpdateMock).toHaveBeenCalledTimes(1);

  const call: Array<unknown> = createOrUpdateMock.mock
    .calls[0] as Array<unknown>;

  return (call[0] as { model: StatusPageAnnouncement }).model;
}

function idsOf(items: unknown): Array<string> {
  return ((items as Array<{ _id?: string; id?: unknown }>) || []).map(
    (item: { _id?: string; id?: unknown }): string => {
      return (item._id || item.id || "").toString();
    },
  );
}

function isoOf(value: unknown): string {
  return OneUptimeDate.fromString(value as string).toISOString();
}

function navigatedTo(): string {
  const navigate: MockFunction = Navigation.navigate as unknown as MockFunction;

  expect(navigate).toHaveBeenCalledTimes(1);

  return (navigate.mock.calls[0]![0] as Route).toString();
}

function breadcrumbs(): Array<{ title: string; href: string | null }> {
  return Array.from(
    screen
      .getByRole("navigation", { name: inPageLanguage("Breadcrumb") })
      .querySelectorAll("li"),
  ).map((item: HTMLLIElement) => {
    return {
      title: (item.textContent || "").trim(),
      href: item.querySelector("a")?.getAttribute("href") || null,
    };
  });
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
  queryInUrl = {};
  statusPageOnServer = makeStatusPage(STATUS_PAGE_ID, "Acme Public Status");
  templateOnServer = makeTemplate();
  getListMock.mockReset();
  getItemMock.mockReset();
  createOrUpdateMock.mockReset();
  PermissionGate.clearPermissionPropsCache();

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  OneUptimeDate.setUserTimezone(Timezone.UTC);

  jest
    .spyOn(Navigation, "getQueryStringByName")
    .mockImplementation((name: string): string | null => {
      return queryInUrl[name] || null;
    });
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});

  getListMock.mockImplementation(
    async (args: unknown): Promise<ReturnType<typeof listOf>> => {
      const modelType: DatabaseBaseModelType = (
        args as { modelType: DatabaseBaseModelType }
      ).modelType;

      if (modelType === StatusPage) {
        return listOf([
          makeStatusPage(STATUS_PAGE_ID, "Acme Public Status"),
          makeStatusPage(OTHER_STATUS_PAGE_ID, "Internal Status"),
        ]);
      }

      if (modelType === Monitor) {
        return listOf([makeMonitor()]);
      }

      return listOf([]);
    },
  );

  getItemMock.mockImplementation(
    async (args: unknown): Promise<BaseModel | null> => {
      const modelType: DatabaseBaseModelType = (
        args as { modelType: DatabaseBaseModelType }
      ).modelType;

      if (modelType === StatusPage) {
        if (statusPageOnServer instanceof Error) {
          throw statusPageOnServer;
        }

        return statusPageOnServer;
      }

      if (modelType === StatusPageAnnouncementTemplate) {
        if (templateOnServer instanceof Error) {
          throw templateOnServer;
        }

        return templateOnServer;
      }

      return null;
    },
  );

  createOrUpdateMock.mockImplementation(
    async (data: unknown): Promise<{ data: Record<string, unknown> }> => {
      return {
        data: {
          ...BaseModel.toJSON(
            (data as { model: StatusPageAnnouncement }).model,
            StatusPageAnnouncement,
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

describe("Create Announcement, from the project's Announcements list", () => {
  test("walks two steps and the review", async () => {
    await renderPage();

    expect(stepTitles()).toEqual(["Announcement", "Status Pages", "Summary"]);
    expect(currentStepTitle()).toBe("Announcement");
    // Nothing is picked: no status page is asked for.
    expect(getItemMock).not.toHaveBeenCalled();
  });

  test("asks for the title and the description, with attachments under Advanced", async () => {
    await renderPage();

    // Both required: the server refuses an announcement without a description.
    expect(labelText("Title")).not.toContain("(Optional)");
    expect(labelText("Description")).not.toContain("(Optional)");

    const advanced: HTMLElement = sectionHeader("More fields");
    // The picker inside draws a label of its own ("Upload files").
    const folded: Array<string> = fieldLabelsIn(sectionBody(advanced));

    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(folded).toContain("Attachments");
    expect(folded).not.toContain("Title");
    expect(folded).not.toContain("Description");
    expect(setChips()).toEqual([]);
  });

  test("will not walk on without a title and a description", async () => {
    await renderPage();

    // The status pages are still to be picked, so Next is the only way on.
    expect(queryCreateButton()).toBeNull();

    fireEvent.click(nextButton());

    expect(await screen.findByText("Title is required.")).toBeInTheDocument();
    expect(screen.getByText("Description is required.")).toBeInTheDocument();
    expect(currentStepTitle()).toBe("Announcement");
  });

  test("Status Pages shows the pages, the monitors and one line about the schedule and the notifications", async () => {
    await renderPage();
    await writeAnnouncement();
    await goToNextStep("Status Pages");

    expect(labelText("Show announcement on these status pages")).not.toContain(
      "(Optional)",
    );
    // "(Optional)" once: the label says it, the title does not repeat it.
    expect(labelText("Monitors Affected")).toBe("Monitors Affected (Optional)");

    const schedule: HTMLElement = sectionHeader("Schedule & Notifications");

    expect(schedule).toHaveAttribute("aria-expanded", "false");
    expect(schedule).toHaveAccessibleDescription(DEFAULT_LINE);
    expect(sectionLine()).toBe(DEFAULT_LINE);
    expect(fieldLabelsIn(sectionBody(schedule))).toEqual([
      "Start Showing Announcement At",
      "End Showing Announcement At",
      "Notify Status Page Subscribers",
    ]);
    // Folded, the switch is out of sight; the line says what it does.
    expect(
      screen.getByRole("checkbox", {
        name: "Notify Status Page Subscribers",
        hidden: true,
      }),
    ).not.toBeVisible();
    expect(setChips()).toEqual([]);
  });

  test("starts now, with no end, telling the subscribers", async () => {
    await renderPage();
    await writeAnnouncement();
    await goToNextStep("Status Pages");

    fireEvent.click(sectionHeader("Schedule & Notifications"));

    expect(startsAtInput().value).toMatch(/^2026-10-03T09:20/);
    expect(endsAtInput().value).toBe("");
    expect(
      screen.getByRole("checkbox", { name: "Notify Status Page Subscribers" }),
    ).toBeChecked();
  });

  test("the line follows the answers", async () => {
    await renderPage();
    await writeAnnouncement();
    await goToNextStep("Status Pages");

    const schedule: HTMLElement = sectionHeader("Schedule & Notifications");

    fireEvent.click(schedule);

    // An end: it stays until then.
    fireEvent.change(endsAtInput(), { target: { value: "2026-10-05T14:00" } });
    await act(async () => {});

    const endsAt: string =
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        new Date("2026-10-05T14:00:00.000Z"),
      );

    expect(lineOfOpenSection(schedule)).toBe(
      `Shows now and stays until ${endsAt}. ${ANNOUNCEMENT_SUBSCRIBERS_NOTIFIED_SUMMARY}`,
    );

    // A later start: it shows from then.
    fireEvent.change(startsAtInput(), {
      target: { value: "2026-10-04T08:00" },
    });
    await act(async () => {});

    const startsAt: string =
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        new Date("2026-10-04T08:00:00.000Z"),
      );

    expect(lineOfOpenSection(schedule)).toBe(
      `Shows from ${startsAt} until ${endsAt}. ${ANNOUNCEMENT_SUBSCRIBERS_NOTIFIED_SUMMARY}`,
    );

    // No end again, and nobody told.
    fireEvent.change(endsAtInput(), { target: { value: "" } });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Notify Status Page Subscribers" }),
    );
    await act(async () => {});

    // Folded, the line says it in place of a "Configured" badge.
    fireEvent.click(schedule);

    expect(schedule).toHaveAttribute("aria-expanded", "false");
    expect(sectionLine()).toBe(
      `Shows from ${startsAt} and stays until you end it. ${ANNOUNCEMENT_SUBSCRIBERS_NOT_NOTIFIED_SUMMARY}`,
    );
    expect(setChips()).toEqual([]);
  });

  test("creates it on the pages picked, with the defaults, and goes back to the project's list", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await renderPage();
    await writeAnnouncement();
    await goToNextStep("Status Pages");

    await user.click(
      screen.getByRole("combobox", {
        name: /Show announcement on these status pages/,
      }),
    );
    await user.click(
      await screen.findByRole("option", { name: /Acme Public Status/ }),
    );

    fireEvent.click(createButton());

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: StatusPageAnnouncement = createdModel();

    expect(model.title).toBe("Planned database upgrade");
    expect(model.description).toBe(
      "The database is upgraded on Sunday at 02:00 UTC.",
    );
    expect(idsOf(model.statusPages)).toEqual([STATUS_PAGE_ID]);
    expect(isoOf(model.showAnnouncementAt)).toBe(NOW.toISOString());
    expect(model.endAnnouncementAt || null).toBeNull();
    expect(model.shouldStatusPageSubscribersBeNotified).toBe(true);

    await waitFor(() => {
      expect(Navigation.navigate).toHaveBeenCalled();
    });
    expect(navigatedTo()).toMatch(/\/status-pages\/announcements$/);
  });

  test("the review step reviews the schedule and the notifications by their line", async () => {
    await renderPage();
    await writeAnnouncement();
    await goToNextStep("Status Pages");

    // Picked on the way, so the step lets the review open.
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await user.click(
      screen.getByRole("combobox", {
        name: /Show announcement on these status pages/,
      }),
    );
    await user.click(
      await screen.findByRole("option", { name: /Acme Public Status/ }),
    );

    await goToNextStep("Summary");

    for (const heading of ["Announcement", "Status Pages"]) {
      expect(
        within(form()).getByRole("heading", { level: 2, name: heading }),
      ).toBeInTheDocument();
    }

    expect(
      within(form()).getByText("Planned database upgrade"),
    ).toBeInTheDocument();
    expect(
      within(form()).getByText("Schedule & Notifications"),
    ).toBeInTheDocument();
    expect(
      within(form()).getByTestId("form-summary-section-summary"),
    ).toHaveTextContent(DEFAULT_LINE);
    // The folded fields are reviewed by that line, not one row each.
    expect(
      within(form()).queryByText("Notify Status Page Subscribers"),
    ).toBeNull();
    // Advanced options nobody touched are left out of the review.
    expect(within(form()).queryByText("Attachments")).toBeNull();
  });

  test("the breadcrumbs go back through the project's Announcements list", async () => {
    await renderPage();

    expect(
      breadcrumbs().map((link: { title: string }): string => {
        return link.title;
      }),
    ).toEqual(["Status Pages", "Announcements", "Create Announcement"]);
    expect(breadcrumbs()[1]!.href).toMatch(/\/status-pages\/announcements$/);
  });
});

describe("Create Announcement, from a status page's Announcements tab", () => {
  beforeEach(() => {
    queryInUrl = { statusPageId: STATUS_PAGE_ID };
  });

  test("picks that page, so the title and the description are all it takes", async () => {
    await renderPage();

    expect(getItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelType: StatusPage }),
    );
    expect(
      (
        getItemMock.mock.calls[0]![0] as { id: { toString: () => string } }
      ).id.toString(),
    ).toBe(STATUS_PAGE_ID);

    // Every step after this one holds valid answers: Create is the main button.
    expect(createButton()).toBeInTheDocument();
    expect(nextButton()).toBeInTheDocument();

    await writeAnnouncement();
    fireEvent.click(createButton());

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: StatusPageAnnouncement = createdModel();

    expect(model.title).toBe("Planned database upgrade");
    expect(idsOf(model.statusPages)).toEqual([STATUS_PAGE_ID]);
    expect(isoOf(model.showAnnouncementAt)).toBe(NOW.toISOString());
    expect(model.shouldStatusPageSubscribersBeNotified).toBe(true);
  });

  test("goes back to that page's Announcements tab", async () => {
    await renderPage();
    await writeAnnouncement();
    fireEvent.click(createButton());

    await waitFor(() => {
      expect(Navigation.navigate).toHaveBeenCalled();
    });
    expect(navigatedTo()).toMatch(
      new RegExp(`/status-pages/${STATUS_PAGE_ID}/announcements$`),
    );
  });

  test("shows the page as picked on its step", async () => {
    await renderPage();
    await writeAnnouncement();
    await goToNextStep("Status Pages");

    // The picker's menu is closed: the only "Acme Public Status" is its pick.
    await waitFor(() => {
      expect(within(form()).getByText("Acme Public Status")).toBeVisible();
    });
    expect(within(form()).queryByText("Internal Status")).toBeNull();
  });

  test("the breadcrumbs go back through the status page", async () => {
    await renderPage();

    const links: Array<{ title: string; href: string | null }> = breadcrumbs();

    expect(
      links.map((link: { title: string }): string => {
        return link.title;
      }),
    ).toEqual([
      "Status Pages",
      "View Status Page",
      "Announcements",
      "Create Announcement",
    ]);
    expect(links[1]!.href).toMatch(
      new RegExp(`/status-pages/${STATUS_PAGE_ID}$`),
    );
    expect(links[2]!.href).toMatch(
      new RegExp(`/status-pages/${STATUS_PAGE_ID}/announcements$`),
    );
  });

  test("will not create an announcement that ends before it starts, and opens the section to say so", async () => {
    await renderPage();
    await writeAnnouncement();
    await goToNextStep("Status Pages");

    const schedule: HTMLElement = sectionHeader("Schedule & Notifications");

    fireEvent.click(schedule);
    fireEvent.change(endsAtInput(), { target: { value: "2026-10-03T08:00" } });
    await act(async () => {});
    // Folded again before pressing Create.
    fireEvent.click(schedule);
    expect(schedule).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(createButton());

    expect(
      await screen.findByText(ANNOUNCEMENT_ENDS_BEFORE_IT_STARTS_ERROR),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(schedule).toHaveAttribute("aria-expanded", "true");
    });
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("a template keeps its own pages beside this one, and its notify choice shows in the line", async () => {
    queryInUrl = {
      statusPageId: STATUS_PAGE_ID,
      announcementTemplateId: TEMPLATE_ID,
    };

    await renderPage();

    expect(getItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelType: StatusPageAnnouncementTemplate }),
    );
    expect((labelledInput("Title") as HTMLInputElement).value).toBe(
      "Planned database upgrade",
    );

    await goToNextStep("Status Pages");

    expect(sectionLine()).toBe(
      `${ANNOUNCEMENT_SCHEDULE_SUMMARIES.nowUntilEnded} ${ANNOUNCEMENT_SUBSCRIBERS_NOT_NOTIFIED_SUMMARY}`,
    );
    // Folded all the same: the line says the subscribers are not told.
    expect(sectionHeader("Schedule & Notifications")).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    fireEvent.click(createButton());

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: StatusPageAnnouncement = createdModel();

    expect(idsOf(model.statusPages)).toEqual([
      STATUS_PAGE_ID,
      OTHER_STATUS_PAGE_ID,
    ]);
    expect(model.description).toBe("The database is upgraded on Sunday.");
    expect(model.shouldStatusPageSubscribersBeNotified).toBe(false);
    // A template holds no time of its own: the announcement shows now.
    expect(isoOf(model.showAnnouncementAt)).toBe(NOW.toISOString());

    await waitFor(() => {
      expect(Navigation.navigate).toHaveBeenCalled();
    });
    expect(navigatedTo()).toMatch(
      new RegExp(`/status-pages/${STATUS_PAGE_ID}/announcements$`),
    );
  });

  test("a page that is not there is not picked: the pages are asked for, and the trail goes through the project's list", async () => {
    // The API answers an empty record for a page it cannot find.
    statusPageOnServer = new StatusPage();

    await renderPage();

    // The pages are still to be picked.
    expect(queryCreateButton()).toBeNull();
    expect(
      breadcrumbs().map((link: { title: string }): string => {
        return link.title;
      }),
    ).toEqual(["Status Pages", "Announcements", "Create Announcement"]);

    await writeAnnouncement();
    await goToNextStep("Status Pages");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(
      await screen.findByText(
        "Show announcement on these status pages is required.",
      ),
    ).toBeInTheDocument();
  });

  test("a page that cannot be read leaves the form as the project's list opens it, without an error", async () => {
    statusPageOnServer = new Error("You do not have permission to read this.");

    await renderPage();

    expect(
      screen.queryByText("You do not have permission to read this."),
    ).toBeNull();
    expect(queryCreateButton()).toBeNull();
    expect(
      breadcrumbs().map((link: { title: string }): string => {
        return link.title;
      }),
    ).toEqual(["Status Pages", "Announcements", "Create Announcement"]);
  });

  test("a template that cannot be read says so above the form, which still opens with the page picked", async () => {
    queryInUrl = {
      statusPageId: STATUS_PAGE_ID,
      announcementTemplateId: TEMPLATE_ID,
    };
    templateOnServer = new Error("This template was deleted.");

    await renderPage();

    expect(screen.getByText("This template was deleted.")).toBeInTheDocument();
    // Nothing of the template, but the page it was opened from is picked.
    expect(labelledInput("Title").value).toBe("");
    expect(createButton()).toBeInTheDocument();

    await writeAnnouncement();
    fireEvent.click(createButton());

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(idsOf(createdModel().statusPages)).toEqual([STATUS_PAGE_ID]);
  });

  test("an end that has already passed is refused: the announcement would never show", async () => {
    await renderPage();
    await writeAnnouncement();
    await goToNextStep("Status Pages");

    const schedule: HTMLElement = sectionHeader("Schedule & Notifications");

    fireEvent.click(schedule);
    fireEvent.change(startsAtInput(), {
      target: { value: "2026-10-01T08:00" },
    });
    fireEvent.change(endsAtInput(), { target: { value: "2026-10-02T08:00" } });
    await act(async () => {});
    fireEvent.click(schedule);

    fireEvent.click(createButton());

    expect(
      await screen.findByText(ANNOUNCEMENT_ENDS_IN_THE_PAST_ERROR),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(schedule).toHaveAttribute("aria-expanded", "true");
    });
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("with that page unpicked on the way, Create goes to the project's list, which shows the announcement", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await renderPage();
    await writeAnnouncement();
    await goToNextStep("Status Pages");

    // Another page instead of the one it was opened from.
    await user.click(
      screen.getByRole("combobox", {
        name: /Show announcement on these status pages/,
      }),
    );
    await user.click(
      await screen.findByRole("option", { name: /Internal Status/ }),
    );
    await user.click(
      screen.getByRole("button", { name: /Remove Acme Public Status/ }),
    );

    fireEvent.click(createButton());

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(idsOf(createdModel().statusPages)).toEqual([OTHER_STATUS_PAGE_ID]);

    await waitFor(() => {
      expect(Navigation.navigate).toHaveBeenCalled();
    });
    expect(navigatedTo()).toMatch(/\/status-pages\/announcements$/);
  });

  test("the last crumb is this page, drawn as text, so the address keeps what it was opened with", async () => {
    window.history.replaceState(
      null,
      "",
      `/dashboard/${PROJECT_ID}/status-pages/announcements/create?statusPageId=${STATUS_PAGE_ID}`,
    );

    try {
      await renderPage();

      const links: Array<{ title: string; href: string | null }> =
        breadcrumbs();

      expect(links[links.length - 1]).toEqual({
        title: "Create Announcement",
        href: null,
      });
      expect(links[2]!.href).toBe(
        `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/announcements`,
      );
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  test("an address that names no real page asks the server for nothing", async () => {
    queryInUrl = { statusPageId: "not-a-status-page" };

    await renderPage();

    expect(getItemMock).not.toHaveBeenCalled();
    expect(queryCreateButton()).toBeNull();
  });
});

describe("Create Announcement, in the reader's language", () => {
  test("reads in German", async () => {
    queryInUrl = { statusPageId: STATUS_PAGE_ID };

    await renderPage(german);

    const germanText: (key: string) => string = (key: string): string => {
      return german.t(key);
    };

    expect(stepTitles()).toEqual([
      germanText("Announcement"),
      germanText("Status Pages"),
      germanText("Summary"),
    ]);
    expect(germanText("Status Pages")).not.toBe("Status Pages");

    await writeAnnouncement();
    await goToNextStep("Status Pages");

    const line: string = [
      ANNOUNCEMENT_SCHEDULE_SUMMARIES.nowUntilEnded,
      ANNOUNCEMENT_SUBSCRIBERS_NOTIFIED_SUMMARY,
    ]
      .map((sentence: string): string => {
        return germanText(sentence);
      })
      .join(" ");

    expect(line).not.toContain("Subscribers");
    expect(sectionLine()).toBe(line);
    expect(
      screen.getByRole("button", {
        name: germanText("Schedule & Notifications"),
      }),
    ).toBeInTheDocument();
    expect(germanText("Schedule & Notifications")).not.toBe(
      "Schedule & Notifications",
    );
  });
});
