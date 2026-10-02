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
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  PROJECT_ID,
  goTo,
  linksIn,
  renderMenu,
  routeFor,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * Tasks and Code Repositories are two route trees (/ai/agents and
 * /code-repository) but one product: every task runs in a connected
 * repository, and a repository is only there so tasks have somewhere to open
 * pull requests. The Products menu therefore carries a single Tasks item in
 * its Code section. That only holds together if, wherever the user lands,
 *
 *  - the side menu shows both pages, and
 *  - the navbar still names Tasks as the product they are in.
 *
 * Both are rendered here from the real components and route table.
 */

const ORIGINAL_WIDTH: number = window.innerWidth;
const REPOSITORY_ID: string = "3c9d2f1e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

const translation: i18n = createInstance();

function findAnchor(title: string): HTMLAnchorElement {
  const anchor: HTMLAnchorElement | undefined = Array.from(
    document.querySelectorAll("a"),
  ).find((candidate: Element): boolean => {
    return (
      candidate.querySelector("span.truncate")?.textContent?.trim() === title
    );
  }) as HTMLAnchorElement | undefined;

  if (!anchor) {
    throw new Error(`No side-menu link titled "${title}" was rendered.`);
  }

  return anchor;
}

function isActive(title: string): boolean {
  return findAnchor(title).classList.contains("text-indigo-700");
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

describe("the Code side menu", () => {
  test("lists Tasks and Code Repositories under one Code section", async () => {
    goTo(`/dashboard/${PROJECT_ID}/ai/agents`);
    await renderMenu(<CodeSideMenu />);

    expect(sectionTitlesInOrder()).toEqual(["Code", "Developer"]);
    expect(
      linksIn("Developer").map((link: { title: string }): string => {
        return link.title;
      }),
    ).toEqual(["Terraform", "API", "AI Assistants"]);
    expect(linksIn("Code")).toEqual([
      { title: "Tasks", href: routeFor(PageMap.AI_AGENT_TASKS) },
      {
        title: "Code Repositories",
        href: routeFor(PageMap.CODE_REPOSITORY),
      },
    ]);
  });

  test("links into the current project", async () => {
    goTo(`/dashboard/${PROJECT_ID}/code-repository`);
    await renderMenu(<CodeSideMenu />);

    for (const link of linksIn("Code")) {
      expect(link.href).toContain(PROJECT_ID);
      expect(link.href).not.toContain(":projectId");
    }
  });

  test.each([
    ["the Tasks list", "ai/agents", "Tasks", "Code Repositories"],
    [
      "the Code Repositories list",
      "code-repository",
      "Code Repositories",
      "Tasks",
    ],
  ])(
    "highlights the page the user is on (%s)",
    async (
      _page: string,
      path: string,
      activeTitle: string,
      inactiveTitle: string,
    ) => {
      goTo(`/dashboard/${PROJECT_ID}/${path}`);
      await renderMenu(<CodeSideMenu />);

      expect(isActive(activeTitle)).toBe(true);
      expect(isActive(inactiveTitle)).toBe(false);
    },
  );
});

describe("the navbar names Tasks as the product on every Code page", () => {
  function renderNavbar(): void {
    render(
      <I18nextProvider i18n={translation}>
        <DashboardNavbar show={true} />
      </I18nextProvider>,
    );
  }

  test.each([
    ["the Tasks list", "ai/agents"],
    ["the Code Repositories list", "code-repository"],
    ["a repository's settings", `code-repository/${REPOSITORY_ID}/settings`],
  ])("%s", (_page: string, path: string) => {
    goTo(`/dashboard/${PROJECT_ID}/${path}`);
    renderNavbar();

    expect(screen.getByRole("button", { name: "Tasks" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Products" }),
    ).not.toBeInTheDocument();
  });

  test("on a phone, the Code Repositories page is still in Tasks", () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(`/dashboard/${PROJECT_ID}/code-repository`);
    renderNavbar();

    expect(screen.getByTestId("mobile-nav-toggle")).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
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
        screen.queryByRole("button", { name: "Tasks" }),
      ).not.toBeInTheDocument();
    },
  );
});
