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
 * The admin API, the page chrome and the side menu are stand-ins. The
 * i18next instance reaches the page through I18nextProvider only.
 */

jest.setTimeout(60000);

const PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165001";

const mockGetItem: MockFunction = getJestMockFunction();

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

function onProject(values: {
  count?: number | undefined;
  limit?: number | undefined;
}): void {
  mockGetItem.mockImplementation(async (): Promise<Project> => {
    const project: Project = new Project();
    project._id = PROJECT_ID;
    project.name = "Acme Production";

    if (values.count !== undefined) {
      project.currentActiveMonitorsCount = values.count;
    }

    if (values.limit !== undefined) {
      project.activeMonitorsLimit = values.limit;
    }

    return project;
  });
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

describe("Admin > Project > Subscription > Active Monitors", () => {
  beforeEach(() => {
    window.history.pushState(
      {},
      "",
      `/admin/projects/${PROJECT_ID}/subscription`,
    );
    mockGetItem.mockReset();
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
});
