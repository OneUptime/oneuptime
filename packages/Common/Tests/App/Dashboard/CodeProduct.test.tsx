import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import CodeSideMenu from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeSideMenu";
import DashboardNavbar from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import CodeRepositorySideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Repository/SideMenu";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getRepositorySettingsRoute } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodePaths";
import { CodeRepositorySetting } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositorySettingsCopy";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import { Location } from "react-router-dom";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  linksIn,
  renderMenu,
  routeFor,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * Code is one product: the request box and every task first (/code), the
 * connected repositories (/code/repositories), a repository's page holding
 * its own box and tasks (/code/repositories/:id), and a task's page its
 * conversation (/code/tasks/:id). That only holds together if, wherever
 * someone lands,
 *
 *  - the side menu shows where they are - Tasks, Repositories, or the
 *    repository's own pages - and links into the open project, and
 *  - the navbar still names Code as the product they are in, a task's
 *    conversation (which has no side menu) included.
 *
 * Both are rendered here from the real components and route table.
 */

const ORIGINAL_WIDTH: number = window.innerWidth;
const REPOSITORY_ID: string = "3c9d2f1e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const TASK_ID: string = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const translation: i18n = createInstance();

function repositoryRoute(pageMap: PageMap): string {
  return RouteUtil.populateRouteParams(RouteMap[pageMap] as Route, {
    modelId: new ObjectID(REPOSITORY_ID),
  }).toString();
}

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  window.localStorage.clear();
  setViewportWidth(DESKTOP_WIDTH);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  setViewportWidth(ORIGINAL_WIDTH);
});

describe("Code's side menu", () => {
  test("Tasks first - where AI is asked - then Repositories, with the Developer pages", async () => {
    goTo(`/dashboard/${PROJECT_ID}/code`);
    await renderMenu(<CodeSideMenu />);

    expect(sectionTitlesInOrder()).toEqual(["Code", "Developer"]);
    expect(linksIn("Code")).toEqual([
      { title: "Tasks", href: routeFor(PageMap.CODE) },
      { title: "Repositories", href: routeFor(PageMap.CODE_REPOSITORIES) },
    ]);
    expect(
      linksIn("Developer").map((link: { title: string }): string => {
        return link.title;
      }),
    ).toEqual(["Terraform", "API", "AI Assistants"]);
  });

  test("links into the current project, and marks Tasks on Code's first page", async () => {
    goTo(`/dashboard/${PROJECT_ID}/code`);
    await renderMenu(<CodeSideMenu />);

    expect(
      linksIn("Code").map((link: { href: string }): string => {
        return link.href;
      }),
    ).toEqual([
      `/dashboard/${PROJECT_ID}/code`,
      `/dashboard/${PROJECT_ID}/code/repositories`,
    ]);
    for (const link of linksIn("Code")) {
      expect(link.href).not.toContain(":projectId");
    }
    expect(activeLinkTitles()).toEqual(["Tasks"]);
  });

  test("marks Repositories - and only it - on the Repositories page", async () => {
    goTo(`/dashboard/${PROJECT_ID}/code/repositories`);
    await renderMenu(<CodeSideMenu />);

    expect(activeLinkTitles()).toEqual(["Repositories"]);
  });
});

describe("a repository's side menu", () => {
  test("puts its tasks first, then its pull requests' production reviews, its settings, its Developer pages and, apart, deleting it", async () => {
    goTo(`/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}`);
    await renderMenu(
      <CodeRepositorySideMenu modelId={new ObjectID(REPOSITORY_ID)} />,
    );

    expect(sectionTitlesInOrder()).toEqual([
      "Repository",
      "Developer",
      "Advanced",
    ]);
    expect(linksIn("Repository")).toEqual([
      { title: "Tasks", href: repositoryRoute(PageMap.CODE_REPOSITORY_VIEW) },
      {
        title: "Production Reviews",
        href: repositoryRoute(PageMap.CODE_REPOSITORY_VIEW_PRODUCTION_REVIEWS),
      },
      {
        title: "Settings",
        href: repositoryRoute(PageMap.CODE_REPOSITORY_VIEW_SETTINGS),
      },
    ]);
    expect(linksIn("Advanced")).toEqual([
      {
        title: "Delete Repository",
        href: repositoryRoute(PageMap.CODE_REPOSITORY_VIEW_DELETE),
      },
    ]);
  });

  test("its pages live under /code/repositories/:id", () => {
    expect(repositoryRoute(PageMap.CODE_REPOSITORY_VIEW)).toBe(
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}`,
    );
    expect(repositoryRoute(PageMap.CODE_REPOSITORY_VIEW_SETTINGS)).toBe(
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/settings`,
    );
    expect(
      repositoryRoute(PageMap.CODE_REPOSITORY_VIEW_PRODUCTION_REVIEWS),
    ).toBe(
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/production-reviews`,
    );
    expect(repositoryRoute(PageMap.CODE_REPOSITORY_VIEW_DELETE)).toBe(
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/delete`,
    );
  });

  /*
   * A link to one of the repository's settings lands on it, More settings
   * open there: "Pick a Runner" opens ".../settings#runner", Production
   * Reviews' Settings link ".../settings#production-review".
   */
  test("a link to one of its settings is its Settings page with that setting after the '#'", () => {
    const settings: string = `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/settings`;

    expect(getRepositorySettingsRoute(REPOSITORY_ID).toString()).toBe(settings);
    expect(
      getRepositorySettingsRoute(
        new ObjectID(REPOSITORY_ID),
        CodeRepositorySetting.Runner,
      ).toString(),
    ).toBe(`${settings}#runner`);

    for (const setting of Object.values(CodeRepositorySetting)) {
      expect(
        getRepositorySettingsRoute(REPOSITORY_ID, setting).toString(),
      ).toBe(`${settings}#${setting}`);
    }
  });

  test("opened at one of its settings, the menu still marks Settings", async () => {
    const settings: string = `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/settings`;

    window.history.pushState({}, "", `${settings}#runner`);
    Navigation.setLocation({
      pathname: settings,
      search: "",
      hash: "#runner",
      state: null,
      key: "test",
    } as Location);

    await renderMenu(
      <CodeRepositorySideMenu modelId={new ObjectID(REPOSITORY_ID)} />,
    );

    expect(activeLinkTitles()).toEqual(["Settings"]);
    window.history.pushState({}, "", settings);
  });

  test.each([
    ["its tasks", "", "Tasks"],
    [
      "its pull requests' production reviews",
      "/production-reviews",
      "Production Reviews",
    ],
    ["its settings", "/settings", "Settings"],
  ])(
    "marks the page you are on (%s)",
    async (_page: string, suffix: string, active: string) => {
      goTo(
        `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}${suffix}`,
      );
      await renderMenu(
        <CodeRepositorySideMenu modelId={new ObjectID(REPOSITORY_ID)} />,
      );

      expect(activeLinkTitles()).toEqual([active]);
    },
  );
});

describe("the navbar names Code as the product on every Code page", () => {
  function renderNavbar(): void {
    render(
      <I18nextProvider i18n={translation}>
        <DashboardNavbar show={true} />
      </I18nextProvider>,
    );
  }

  test.each([
    ["the request box and every task", "code"],
    ["the repositories", "code/repositories"],
    ["a repository's tasks", `code/repositories/${REPOSITORY_ID}`],
    ["a repository's settings", `code/repositories/${REPOSITORY_ID}/settings`],
    [
      "a repository's production reviews",
      `code/repositories/${REPOSITORY_ID}/production-reviews`,
    ],
    ["a task's conversation", `code/tasks/${TASK_ID}`],
    ["a task's log", `code/tasks/${TASK_ID}/log`],
  ])("%s", (_page: string, path: string) => {
    goTo(`/dashboard/${PROJECT_ID}/${path}`);
    renderNavbar();

    expect(screen.getByRole("button", { name: "Code" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Products" }),
    ).not.toBeInTheDocument();
  });

  test("on a phone, a task's conversation is still in Code", () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(`/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}`);
    renderNavbar();

    expect(screen.getByTestId("mobile-nav-toggle")).toBeInTheDocument();
    expect(screen.getByText("Code")).toBeInTheDocument();
    expect(screen.queryByText("Home")).not.toBeInTheDocument();
  });

  test.each([
    ["AI Chat", "ai/chat", "Chat"],
    ["AI Insights", "ai/insights", "Insights"],
  ])(
    "while the AI pages keep their own item (%s)",
    (_page: string, path: string, product: string) => {
      goTo(`/dashboard/${PROJECT_ID}/${path}`);
      renderNavbar();

      expect(screen.getByRole("button", { name: product })).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Code" }),
      ).not.toBeInTheDocument();
    },
  );
});
