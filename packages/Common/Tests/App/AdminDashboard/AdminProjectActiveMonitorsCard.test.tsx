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
 * ADMIN DASHBOARD > PROJECTS > (PROJECT) > SUBSCRIPTION > ACTIVE MONITORS,
 * on the real page, in the real locales.
 *
 * The support report was found by reading a project's row in the database:
 * activeMonitorsLimit 500, currentActiveMonitorsCount 2881. Staff now see
 * the two numbers side by side, written the way their language writes
 * numbers (2,881, not 2881), and a project past its limit says by how many
 * at a glance - beside the count, before anyone does the sum. An unset
 * limit, or 0, reads as "No limit" (ActiveMonitorLimitUtil). The edit form
 * is titled after what it edits.
 *
 * And what the edit form saves is on the card as soon as the form closes
 * (issue #6766: "When I click on edit and save, the new changes do not
 * reflect" - the card kept the old limit until the page was reloaded).
 *
 * The admin API, the page chrome and the side menu are stand-ins. The API
 * holds the project as a server would: what a save writes, the next read
 * returns. The i18next instance reaches the page through I18nextProvider
 * only.
 */

jest.setTimeout(60000);

const PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165001";

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
  count?: number | undefined;
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

    if (storedProject.count !== undefined) {
      project.currentActiveMonitorsCount = storedProject.count;
    }

    if (storedProject.limit !== undefined) {
      project.activeMonitorsLimit = storedProject.limit;
    }

    return project;
  });

  // A save writes the limit it carries; null is none.
  mockCreateOrUpdate.mockImplementation(
    async (request: SaveRequest): Promise<unknown> => {
      const sent: number | null | undefined = request.model
        .activeMonitorsLimit as number | null | undefined;

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

// The page, in a language; resolves with the Active Monitors card's fields.
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
    count = screen.getByTestId("project-active-monitors-count");
  });

  return count!;
}

function limitField(): HTMLElement {
  return screen
    .getByTestId("project-active-monitors-count")
    .closest("#model-detail-project-active-monitors") as HTMLElement;
}

// The card's count, found again: a read redraws the fields.
function countField(): HTMLElement {
  return screen.getByTestId("project-active-monitors-count");
}

function shownLimit(): string | null {
  return (
    within(limitField()).queryByTestId("project-active-monitor-limit")
      ?.textContent ?? null
  );
}

function editDialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function limitInput(): HTMLElement {
  return within(editDialog()).getByPlaceholderText("No limit");
}

/*
 * What an admin does: opens Edit Monitor Limit, waits for the form to hold
 * the limit that is stored, types a new one (or empties the box) and saves.
 */
async function saveLimit(value: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Edit Monitor Limit" }));
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

describe("Admin > Project > Subscription > Active Monitors", () => {
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

  // The support report's project.
  test("past its limit: the count as people read it, and by how many it is over", async () => {
    onProject({ count: 2881, limit: 500 });

    const count: HTMLElement = await renderPage();

    expect(count).toHaveTextContent("2,881");
    expect(within(count).getByTestId("pill")).toHaveTextContent(
      "2,381 over the limit",
    );
    expect(
      within(limitField()).getByTestId("project-active-monitor-limit"),
    ).toHaveTextContent("500");
  });

  test("at its limit: says so", async () => {
    onProject({ count: 500, limit: 500 });

    const count: HTMLElement = await renderPage();

    expect(count).toHaveTextContent("500");
    expect(within(count).getByTestId("pill")).toHaveTextContent("At the limit");
  });

  test("under its limit: the count alone", async () => {
    onProject({ count: 499, limit: 500 });

    const count: HTMLElement = await renderPage();

    expect(count).toHaveTextContent("499");
    expect(within(count).queryByTestId("pill")).toBeNull();
  });

  test("no limit, or 0, reads as No limit, and nothing is over it", async () => {
    for (const limit of [undefined, 0]) {
      onProject({ count: 12000, limit: limit });

      const count: HTMLElement = await renderPage();

      expect(count).toHaveTextContent("12,000");
      expect(within(count).queryByTestId("pill")).toBeNull();
      expect(
        within(limitField()).getByTestId("placeholder-text"),
      ).toHaveTextContent("No limit");
      expect(
        within(limitField()).queryByTestId("project-active-monitor-limit"),
      ).toBeNull();

      cleanup();
    }
  });

  test("a count never computed reads as 0", async () => {
    onProject({ limit: 500 });

    const count: HTMLElement = await renderPage();

    expect(count).toHaveTextContent("0");
    expect(within(count).queryByTestId("pill")).toBeNull();
  });

  test("German writes the numbers and the badge its own way", async () => {
    onProject({ count: 2881, limit: 1000 });

    const count: HTMLElement = await renderPage("de");

    expect(count).toHaveTextContent("2.881");
    expect(within(count).getByTestId("pill")).toHaveTextContent(
      "1.881 über dem Limit",
    );
    expect(
      within(limitField()).getByTestId("project-active-monitor-limit"),
    ).toHaveTextContent("1.000");
  });

  test("the card says what counts, and that the Free plan has a limit of its own", async () => {
    onProject({ count: 2881, limit: 500 });

    await renderPage();

    expect(
      screen.getByText(
        "All but Manual monitors count, on or off. At the limit no more can be added; existing ones keep running. A reseller's next tier change overwrites it. Free plan projects are also held to the Free plan's limit.",
      ),
    ).toBeInTheDocument();
  });

  test("its edit form is titled after what it edits", async () => {
    onProject({ count: 2881, limit: 500 });

    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Edit Monitor Limit" }));
    await flush();

    await waitFor(() => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        "Edit Monitor Limit",
      );
    });
    expect(screen.getByTestId("modal-title")).not.toHaveTextContent(
      "Edit Project",
    );
  });

  /*
   * Issue #6766: "When I click on edit and save, the new changes do not
   * reflect." The page handed the card its refresher twice - on the card and
   * in modelDetailProps - and CardModelDetail let the second replace its own,
   * so the save's "read it again" never reached the card's fields.
   */
  describe("what the edit form saves is on the card as the form closes (issue #6766)", () => {
    test("the issue's project: a limit of 5 raised to 10 reads 10, with no reload", async () => {
      onProject({ count: 0, limit: 5 });

      await renderPage();
      expect(shownLimit()).toBe("5");

      await saveLimit("10");
      await formClosed();

      await waitFor(() => {
        expect(shownLimit()).toBe("10");
      }, WAIT);
      expect(countField()).toHaveTextContent("0");

      // Written to the project on screen, through the admin API: the limit only.
      expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
      expect(savedRequest().model.activeMonitorsLimit).toBe(10);
      expect(savedRequest().model.id?.toString()).toBe(PROJECT_ID);
      expect(savedRequest().model.currentActiveMonitorsCount).toBeUndefined();
    });

    test("raised past the count: the over-the-limit badge goes at once", async () => {
      onProject({ count: 12, limit: 5 });

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
      onProject({ count: 8, limit: 20 });

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
      onProject({ count: 2881, limit: 5000 });

      await renderPage();
      expect(within(countField()).queryByTestId("pill")).toBeNull();

      await saveLimit("500");
      await formClosed();

      await waitFor(() => {
        expect(shownLimit()).toBe("500");
      }, WAIT);
      expect(within(countField()).getByTestId("pill")).toHaveTextContent(
        "2,381 over the limit",
      );
    });

    test("emptied: no limit is saved, and the card reads No limit at once", async () => {
      onProject({ count: 3, limit: 5 });

      await renderPage();
      expect(shownLimit()).toBe("5");

      await saveLimit("");
      await formClosed();

      await waitFor(() => {
        expect(shownLimit()).toBeNull();
      }, WAIT);
      expect(
        within(limitField()).getByTestId("placeholder-text"),
      ).toHaveTextContent("No limit");
      expect(savedRequest().model.activeMonitorsLimit).toBeNull();
    });

    test("set where there was none: the new limit reads at once", async () => {
      onProject({ count: 3 });

      await renderPage();
      expect(shownLimit()).toBeNull();

      await saveLimit("50");
      await formClosed();

      await waitFor(() => {
        expect(shownLimit()).toBe("50");
      }, WAIT);
      expect(within(limitField()).queryByTestId("placeholder-text")).toBeNull();
    });

    test("a second save shows too", async () => {
      onProject({ count: 0, limit: 5 });

      await renderPage();

      await saveLimit("10");
      await formClosed();
      await waitFor(() => {
        expect(shownLimit()).toBe("10");
      }, WAIT);

      await saveLimit("15");
      await formClosed();
      await waitFor(() => {
        expect(shownLimit()).toBe("15");
      }, WAIT);

      expect(mockCreateOrUpdate).toHaveBeenCalledTimes(2);
      expect(savedRequest(1).model.activeMonitorsLimit).toBe(15);
    });

    test("a refused save keeps the stored limit on the card, and the form says why", async () => {
      onProject({ count: 0, limit: 5 });
      mockCreateOrUpdate.mockRejectedValue(
        new Error("Only a master admin can change a project's monitor limit."),
      );

      await renderPage();

      await saveLimit("10");

      await waitFor(() => {
        expect(
          within(editDialog()).getByText(
            "Only a master admin can change a project's monitor limit.",
          ),
        ).toBeInTheDocument();
      }, WAIT);
      expect(shownLimit()).toBe("5");
    });
  });
});
