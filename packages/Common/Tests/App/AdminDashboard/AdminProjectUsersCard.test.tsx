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
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * ADMIN DASHBOARD > PROJECTS > (PROJECT) > SUBSCRIPTION > USERS, on the
 * real page, in the real locales (issue #6767: "I can set active monitor
 * limits on the admin dashboard, but I cannot set user limits").
 *
 * The card shows how many users the project has - the count the bill
 * reports, as the customer's Billing page shows it - beside its user limit
 * (Project.seatLimit), written the way the admin's language writes numbers,
 * and a project at or past its limit says so beside the count. An unset
 * limit, or 0, reads as "No limit", the rule the server holds people to.
 * Edit User Limit saves the limit alone, through the admin API, and the
 * card reads what it saved as the form closes.
 *
 * The admin API, the page chrome and the side menu are stand-ins. The API
 * holds the project as a server would: what a save writes, the next read
 * returns. The i18next instance reaches the page through I18nextProvider
 * only.
 */

jest.setTimeout(60000);

const PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165003";

// Generous: these drive the real form and card, on a CI box that may be busy.
const WAIT: { timeout: number } = { timeout: 20000 };

const mockGetItem: MockFunction = getJestMockFunction();
const mockCreateOrUpdate: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI",
  () => {
    return {
      __esModule: true,
      default: {
        getItem: (...args: Array<unknown>): unknown => {
          return mockGetItem(...args);
        },
        getList: async (): Promise<unknown> => {
          return { data: [], count: 0, skip: 0, limit: 0 };
        },
        updateById: async (): Promise<unknown> => {
          return {};
        },
        // What the card's edit form saves through (ModelForm).
        createOrUpdate: (...args: Array<unknown>): unknown => {
          return mockCreateOrUpdate(...args);
        },
      },
    };
  },
);

// The page is billing-only: it bails out before its cards otherwise.
jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return true;
    },
  });

  return mocked;
});

jest.mock("../../../UI/Components/Page/Page", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: { children?: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Projects/View/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import ProjectSubscription from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Projects/View/Subscription";
import Project from "../../../Models/DatabaseModels/Project";
import UserUtil from "../../../UI/Utils/User";

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
}

async function instanceFor(locale: string): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [locale]: { translation: readLocale(locale) },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

interface StoredProject {
  // How many users the bill counts (paymentProviderSubscriptionSeats).
  users?: number | undefined;
  // The user limit (seatLimit).
  limit?: number | undefined;
}

// The project as the server holds it.
let storedProject: StoredProject = {};

interface SaveRequest {
  model: Project;
}

function onProject(values: StoredProject): void {
  storedProject = { ...values };

  mockGetItem.mockImplementation(async (): Promise<Project> => {
    const project: Project = new Project();
    project._id = PROJECT_ID;
    project.name = "Acme Production";

    if (storedProject.users !== undefined) {
      project.paymentProviderSubscriptionSeats = storedProject.users;
    }

    if (storedProject.limit !== undefined) {
      project.seatLimit = storedProject.limit;
    }

    return project;
  });

  // A save writes the limit it carries; null is none.
  mockCreateOrUpdate.mockImplementation(
    async (request: SaveRequest): Promise<unknown> => {
      const sent: number | null | undefined = request.model.seatLimit as
        | number
        | null
        | undefined;

      if (sent !== undefined) {
        storedProject.limit = sent === null ? undefined : sent;
      }

      return { data: {} };
    },
  );
}

function savedRequest(index: number = 0): SaveRequest {
  return (mockCreateOrUpdate.mock.calls[index] as Array<SaveRequest>)[0]!;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

// The page, in a language; resolves with the Users card's count.
async function renderPage(locale: string = "en"): Promise<HTMLElement> {
  const instance: i18n = await instanceFor(locale);

  render(
    <I18nextProvider i18n={instance}>
      <ProjectSubscription />
    </I18nextProvider>,
  );

  await flush();

  let count: HTMLElement | null = null;

  await waitFor(() => {
    count = screen.getByTestId("project-users-count");
  });

  return count!;
}

// The Users card's fields.
function usersCard(): HTMLElement {
  return screen
    .getByTestId("project-users-count")
    .closest("#model-detail-project-users") as HTMLElement;
}

// The card's count, found again: a read redraws the fields.
function countField(): HTMLElement {
  return screen.getByTestId("project-users-count");
}

function shownLimit(): string | null {
  return (
    within(usersCard()).queryByTestId("project-user-limit")?.textContent ?? null
  );
}

function editDialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function limitInput(): HTMLElement {
  return within(editDialog()).getByPlaceholderText("No limit");
}

/*
 * What an admin does: opens Edit User Limit, waits for the form to hold the
 * limit that is stored, types a new one (or empties the box) and saves.
 */
async function saveLimit(value: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Edit User Limit" }));
  await flush();

  await waitFor(() => {
    expect(limitInput()).toHaveValue(
      storedProject.limit === undefined ? null : storedProject.limit,
    );
  }, WAIT);

  fireEvent.change(limitInput(), { target: { value: value } });

  fireEvent.click(
    within(editDialog()).getByTestId("modal-footer-submit-button"),
  );
  await flush();
}

async function formClosed(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
  }, WAIT);
}

describe("Admin > Project > Subscription > Users", () => {
  beforeEach(() => {
    window.history.pushState(
      {},
      "",
      `/admin/projects/${PROJECT_ID}/subscription`,
    );
    mockGetItem.mockReset();
    mockCreateOrUpdate.mockReset();
    getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("past its limit: the count as people read it, and by how many it is over", async () => {
    onProject({ users: 1250, limit: 1000 });

    const count: HTMLElement = await renderPage();

    expect(count).toHaveTextContent("1,250");
    expect(within(count).getByTestId("pill")).toHaveTextContent(
      "250 over the limit",
    );
    expect(
      within(usersCard()).getByTestId("project-user-limit"),
    ).toHaveTextContent("1,000");
  });

  test("at its limit: says so", async () => {
    onProject({ users: 10, limit: 10 });

    const count: HTMLElement = await renderPage();

    expect(count).toHaveTextContent("10");
    expect(within(count).getByTestId("pill")).toHaveTextContent("At the limit");
  });

  test("under its limit: the count alone", async () => {
    onProject({ users: 9, limit: 10 });

    const count: HTMLElement = await renderPage();

    expect(count).toHaveTextContent("9");
    expect(within(count).queryByTestId("pill")).toBeNull();
  });

  test("no limit, or 0, reads as No limit, and nothing is over it", async () => {
    for (const limit of [undefined, 0]) {
      onProject({ users: 4200, limit: limit });

      const count: HTMLElement = await renderPage();

      expect(count).toHaveTextContent("4,200");
      expect(within(count).queryByTestId("pill")).toBeNull();
      expect(
        within(usersCard()).getByTestId("placeholder-text"),
      ).toHaveTextContent("No limit");
      expect(
        within(usersCard()).queryByTestId("project-user-limit"),
      ).toBeNull();

      cleanup();
    }
  });

  test("a count the bill has not reported reads as 0", async () => {
    onProject({ limit: 5 });

    const count: HTMLElement = await renderPage();

    expect(count).toHaveTextContent("0");
    expect(within(count).queryByTestId("pill")).toBeNull();
  });

  test("German writes the numbers and the badge its own way", async () => {
    onProject({ users: 2500, limit: 1000 });

    const count: HTMLElement = await renderPage("de");

    expect(count).toHaveTextContent("2.500");
    expect(within(count).getByTestId("pill")).toHaveTextContent(
      "1.500 über dem Limit",
    );
    expect(
      within(usersCard()).getByTestId("project-user-limit"),
    ).toHaveTextContent("1.000");
  });

  test("the card says who counts, what the limit stops, and that the Free plan has a limit of its own", async () => {
    onProject({ users: 3, limit: 5 });

    await renderPage();

    expect(screen.getByText("Users", { selector: "h2" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Everyone in the project counts, pending invitations too. At the limit no one new can join; those already in stay. A reseller's next tier change overwrites it. Free plan projects are also limited to one person.",
      ),
    ).toBeInTheDocument();
  });

  test("its edit form is titled after what it edits, and asks for the limit alone", async () => {
    onProject({ users: 3, limit: 5 });

    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Edit User Limit" }));
    await flush();

    await waitFor(() => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        "Edit User Limit",
      );
    });
    expect(screen.getByTestId("modal-title")).not.toHaveTextContent(
      "Edit Project",
    );

    await waitFor(() => {
      expect(limitInput()).toHaveValue(5);
    }, WAIT);
    expect(
      within(editDialog()).getByText(
        "The most users this project may have, pending invitations included. Leave it empty for no limit.",
      ),
    ).toBeInTheDocument();
    expect(within(editDialog()).getAllByRole("spinbutton")).toHaveLength(1);
  });

  // What the edit form saves is on the card as soon as the form closes.
  describe("what the edit form saves is on the card as the form closes", () => {
    test("a limit of 5 raised to 10 reads 10, with no reload", async () => {
      onProject({ users: 3, limit: 5 });

      await renderPage();
      expect(shownLimit()).toBe("5");

      await saveLimit("10");
      await formClosed();

      await waitFor(() => {
        expect(shownLimit()).toBe("10");
      }, WAIT);
      expect(countField()).toHaveTextContent("3");

      // Written to the project on screen, through the admin API: the limit only.
      expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
      expect(savedRequest().model.seatLimit).toBe(10);
      expect(savedRequest().model.id?.toString()).toBe(PROJECT_ID);
      expect(
        savedRequest().model.paymentProviderSubscriptionSeats,
      ).toBeUndefined();
      expect(savedRequest().model.activeMonitorsLimit).toBeUndefined();
    });

    test("raised past the count: the over-the-limit badge goes at once", async () => {
      onProject({ users: 12, limit: 5 });

      await renderPage();
      expect(within(countField()).getByTestId("pill")).toHaveTextContent(
        "7 over the limit",
      );

      await saveLimit("20");
      await formClosed();

      await waitFor(() => {
        expect(shownLimit()).toBe("20");
      }, WAIT);
      expect(within(countField()).queryByTestId("pill")).toBeNull();
    });

    test("lowered to the count: it says At the limit at once", async () => {
      onProject({ users: 8, limit: 20 });

      await renderPage();
      expect(within(countField()).queryByTestId("pill")).toBeNull();

      await saveLimit("8");
      await formClosed();

      await waitFor(() => {
        expect(shownLimit()).toBe("8");
      }, WAIT);
      expect(within(countField()).getByTestId("pill")).toHaveTextContent(
        "At the limit",
      );
    });

    test("lowered below the count: it says by how many at once", async () => {
      onProject({ users: 30, limit: 50 });

      await renderPage();

      await saveLimit("25");
      await formClosed();

      await waitFor(() => {
        expect(shownLimit()).toBe("25");
      }, WAIT);
      expect(within(countField()).getByTestId("pill")).toHaveTextContent(
        "5 over the limit",
      );
    });

    test("emptied: no limit is saved, and the card reads No limit at once", async () => {
      onProject({ users: 3, limit: 5 });

      await renderPage();
      expect(shownLimit()).toBe("5");

      await saveLimit("");
      await formClosed();

      await waitFor(() => {
        expect(shownLimit()).toBeNull();
      }, WAIT);
      expect(
        within(usersCard()).getByTestId("placeholder-text"),
      ).toHaveTextContent("No limit");
      expect(savedRequest().model.seatLimit).toBeNull();
    });

    test("set where there was none: the new limit reads at once", async () => {
      onProject({ users: 3 });

      await renderPage();
      expect(shownLimit()).toBeNull();

      await saveLimit("50");
      await formClosed();

      await waitFor(() => {
        expect(shownLimit()).toBe("50");
      }, WAIT);
      expect(within(usersCard()).queryByTestId("placeholder-text")).toBeNull();
    });

    test("a limit below one is refused in the form, and nothing is saved", async () => {
      onProject({ users: 3, limit: 5 });

      await renderPage();

      await saveLimit("0");

      await waitFor(() => {
        expect(within(editDialog()).getByRole("spinbutton")).toHaveValue(0);
      }, WAIT);
      await flush();

      expect(screen.queryByRole("dialog")).not.toBeNull();
      expect(mockCreateOrUpdate).not.toHaveBeenCalled();
      expect(shownLimit()).toBe("5");
    });

    test("a refused save keeps the stored limit on the card, and the form says why", async () => {
      onProject({ users: 3, limit: 5 });
      mockCreateOrUpdate.mockRejectedValue(
        new Error("Only a master admin can change a project's user limit."),
      );

      await renderPage();

      await saveLimit("10");

      await waitFor(() => {
        expect(
          within(editDialog()).getByText(
            "Only a master admin can change a project's user limit.",
          ),
        ).toBeInTheDocument();
      }, WAIT);
      expect(shownLimit()).toBe("5");
    });
  });

  test("the Active Monitors card above it keeps its own limit", async () => {
    onProject({ users: 3, limit: 5 });

    await renderPage();

    // The project has no monitor limit: the monitor card says so, apart from this one.
    const monitorsCard: HTMLElement = screen
      .getByTestId("project-active-monitors-count")
      .closest("#model-detail-project-active-monitors") as HTMLElement;

    expect(
      within(monitorsCard).getByTestId("placeholder-text"),
    ).toHaveTextContent("No limit");
    expect(shownLimit()).toBe("5");
  });
});
