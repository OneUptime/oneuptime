import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import { Location } from "react-router-dom";
import Route from "../../../Types/API/Route";
import SideMenu, {
  SideMenuSectionProps,
} from "../../../UI/Components/SideMenu/SideMenu";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "../../../UI/Components/SideMenu/SideMenuSection";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * Which sections of a side menu are open when it is drawn.
 *
 * Advanced folds away by default in every menu ("Please always collapse the
 * advanced section by default ... for entire project"), so the menu must know
 * which section holds the page the user is on and keep that one open - for
 * a `sections` array AND for <SideMenuSection> elements written by hand,
 * which is how every resource's own menu (a workflow's, a monitor's, ...) is
 * written. Before this, only the array form knew, and a hand-written section
 * that started collapsed stayed shut on its own pages.
 *
 * The menus here are small and synthetic: one workflow, /w/1.
 */

const DESKTOP_WIDTH: number = 1280;
const PHONE_WIDTH: number = 375;

function goTo(path: string): void {
  window.history.pushState({}, "", path);
  Navigation.setLocation({
    pathname: path,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);
}

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

function sectionToggle(title: string): HTMLElement {
  const heading: HTMLElement | undefined = Array.from(
    document.querySelectorAll<HTMLElement>("h6"),
  ).find((candidate: HTMLElement): boolean => {
    return candidate.textContent?.trim() === title;
  });

  const toggle: HTMLElement | null | undefined = heading?.closest("button");

  if (!toggle) {
    throw new Error(`No collapsible section titled "${title}".`);
  }

  return toggle;
}

function isExpanded(title: string): boolean {
  return sectionToggle(title).getAttribute("aria-expanded") === "true";
}

function sectionBody(title: string): HTMLElement {
  return sectionToggle(title).nextElementSibling as HTMLElement;
}

function item(title: string, path: string): ReactElement {
  return <SideMenuItem link={{ title, to: new Route(path) }} />;
}

// A workflow's menu, written the way every resource menu is: by hand.
function workflowMenu(extra?: ReactElement): ReactElement {
  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        {item("Overview", "/w/1")}
        {item("Builder", "/w/1/builder")}
      </SideMenuSection>
      <SideMenuSection title="Advanced">
        {item("Settings", "/w/1/settings")}
        {item("Delete Workflow", "/w/1/delete")}
      </SideMenuSection>
      {extra || <></>}
    </SideMenu>
  );
}

// The same menu as a `sections` array.
const WORKFLOW_SECTIONS: Array<SideMenuSectionProps> = [
  {
    title: "Basic",
    items: [
      { link: { title: "Overview", to: new Route("/w/1") } },
      { link: { title: "Builder", to: new Route("/w/1/builder") } },
    ],
  },
  {
    title: "Advanced",
    items: [
      { link: { title: "Settings", to: new Route("/w/1/settings") } },
      { link: { title: "Delete Workflow", to: new Route("/w/1/delete") } },
    ],
  },
];

async function renderAt(
  path: string,
  menu: ReactElement,
): Promise<RenderResult> {
  goTo(path);

  let rendered: RenderResult | undefined;

  await act(async () => {
    rendered = render(menu);
  });

  return rendered!;
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
});

afterEach(() => {
  cleanup();
});

describe("a hand-written menu", () => {
  test("starts with Advanced collapsed and Basic open", async () => {
    await renderAt("/w/1", workflowMenu());

    expect(isExpanded("Basic")).toBe(true);
    expect(isExpanded("Advanced")).toBe(false);
    expect(sectionBody("Advanced")).toHaveClass(
      "max-h-0",
      "opacity-0",
      "invisible",
    );
  });

  test.each(["/w/1/settings", "/w/1/delete"])(
    "opens Advanced on %s, a page inside it",
    async (path: string) => {
      await renderAt(path, workflowMenu());

      expect(isExpanded("Advanced")).toBe(true);
      expect(sectionBody("Advanced")).not.toHaveClass("invisible");
    },
  );

  /*
   * A page the menu does not list belongs under the entry whose route is
   * its deepest ancestor: one API key under API Keys, a settings history
   * under Settings.
   */
  test("opens Advanced on a page under one of its entries", async () => {
    await renderAt("/w/1/settings/history", workflowMenu());

    expect(isExpanded("Advanced")).toBe(true);
  });

  test("keeps Advanced collapsed on a page under the Overview", async () => {
    await renderAt("/w/1/runs/42", workflowMenu());

    expect(isExpanded("Advanced")).toBe(false);
  });

  test("ignores a page that is not under any entry", async () => {
    await renderAt("/somewhere/else", workflowMenu());

    expect(isExpanded("Basic")).toBe(true);
    expect(isExpanded("Advanced")).toBe(false);
  });

  /*
   * A section shown only in some editions is written
   * `{cond ? <SideMenuSection/> : <></>}`; one wrapped in a fragment is
   * found as well.
   */
  test("finds a section wrapped in a fragment", async () => {
    const menu: ReactElement = (
      <SideMenu>
        <SideMenuSection title="Basic">
          {item("Overview", "/w/1")}
        </SideMenuSection>
        <>
          <SideMenuSection title="Advanced">
            {item("Settings", "/w/1/settings")}
          </SideMenuSection>
        </>
      </SideMenu>
    );

    await renderAt("/w/1/settings", menu);
    expect(isExpanded("Advanced")).toBe(true);

    cleanup();

    await renderAt("/w/1", menu);
    expect(isExpanded("Advanced")).toBe(false);
  });

  // The On-Call menu draws "Timeline" under "Execution Logs" on that page.
  test("opens Advanced when the current page is a sub-item of one of its entries", async () => {
    const menu: ReactElement = (
      <SideMenu>
        <SideMenuSection title="Policies">
          {item("On-Call Policies", "/on-call/policies")}
        </SideMenuSection>
        <SideMenuSection title="Advanced">
          <SideMenuItem
            link={{ title: "Execution Logs", to: new Route("/on-call/logs") }}
            subItemLink={{
              title: "Timeline",
              to: new Route("/on-call/logs/timeline/7"),
            }}
          />
        </SideMenuSection>
      </SideMenu>
    );

    await renderAt("/on-call/logs/timeline/7", menu);

    expect(isExpanded("Advanced")).toBe(true);
  });

  test("an entry's activeRoute counts as its page", async () => {
    const menu: ReactElement = (
      <SideMenu>
        <SideMenuSection title="Basic">
          {item("Overview", "/w/1")}
        </SideMenuSection>
        <SideMenuSection title="Advanced">
          <SideMenuItem
            link={{ title: "Settings", to: new Route("/w/1/settings?tab=x") }}
            activeRoute={new Route("/w/1/settings")}
          />
        </SideMenuSection>
      </SideMenu>
    );

    await renderAt("/w/1/settings", menu);

    expect(isExpanded("Advanced")).toBe(true);
  });

  test("a section given isActive keeps what it was given", async () => {
    const menu: ReactElement = (
      <SideMenu>
        <SideMenuSection title="Basic">
          {item("Overview", "/w/1")}
        </SideMenuSection>
        <SideMenuSection title="Advanced" isActive={true}>
          {item("Settings", "/w/1/settings")}
        </SideMenuSection>
      </SideMenu>
    );

    await renderAt("/w/1", menu);

    expect(isExpanded("Advanced")).toBe(true);
  });

  test("leaves entries outside any section, and empty fragments, as they are", async () => {
    await renderAt(
      "/w/1",
      workflowMenu(item("Documentation", "/w/1/documentation")),
    );

    expect(
      screen.getByRole("link", { name: "Documentation" }),
    ).toBeInTheDocument();
    expect(isExpanded("Advanced")).toBe(false);
  });

  test("the user can open it, and its rows are then shown", async () => {
    await renderAt("/w/1", workflowMenu());

    fireEvent.click(sectionToggle("Advanced"));

    expect(isExpanded("Advanced")).toBe(true);
    expect(sectionBody("Advanced")).not.toHaveClass("invisible");
    expect(
      screen.getByRole("link", { name: "Delete Workflow" }),
    ).toBeInTheDocument();
  });

  /*
   * A menu in a layout stays mounted from page to page. Reaching a page
   * inside Advanced some other way (a link on the page itself) opens it.
   */
  test("opens Advanced when the user moves to a page inside it", async () => {
    const rendered: RenderResult = await renderAt("/w/1", workflowMenu());

    expect(isExpanded("Advanced")).toBe(false);

    goTo("/w/1/settings");
    await act(async () => {
      rendered.rerender(workflowMenu());
    });

    expect(isExpanded("Advanced")).toBe(true);
  });

  test("does not fold Advanced away under the user when they leave it", async () => {
    const rendered: RenderResult = await renderAt(
      "/w/1/settings",
      workflowMenu(),
    );

    goTo("/w/1/builder");
    await act(async () => {
      rendered.rerender(workflowMenu());
    });

    expect(isExpanded("Advanced")).toBe(true);
  });
});

describe("a menu built from a sections array", () => {
  test("starts with Advanced collapsed", async () => {
    await renderAt("/w/1", <SideMenu sections={WORKFLOW_SECTIONS} />);

    expect(isExpanded("Basic")).toBe(true);
    expect(isExpanded("Advanced")).toBe(false);
  });

  test("opens Advanced on a page inside it, or under one of its entries", async () => {
    await renderAt("/w/1/delete", <SideMenu sections={WORKFLOW_SECTIONS} />);
    expect(isExpanded("Advanced")).toBe(true);

    cleanup();

    await renderAt(
      "/w/1/settings/history",
      <SideMenu sections={WORKFLOW_SECTIONS} />,
    );
    expect(isExpanded("Advanced")).toBe(true);
  });

  test("a menu can keep its Advanced section open with defaultCollapsed: false", async () => {
    await renderAt(
      "/w/1",
      <SideMenu
        sections={WORKFLOW_SECTIONS.map(
          (section: SideMenuSectionProps): SideMenuSectionProps => {
            return section.title === "Advanced"
              ? { ...section, defaultCollapsed: false }
              : section;
          },
        )}
      />,
    );

    expect(isExpanded("Advanced")).toBe(true);
  });

  // The Settings sections of the product list menus work the same way.
  test("a Settings section with defaultCollapsed opens under one of its entries", async () => {
    const sections: Array<SideMenuSectionProps> = [
      {
        title: "Basic",
        items: [{ link: { title: "Project", to: new Route("/settings") } }],
      },
      {
        title: "Keys",
        defaultCollapsed: true,
        items: [
          { link: { title: "API Keys", to: new Route("/settings/api-keys") } },
        ],
      },
    ];

    await renderAt("/settings", <SideMenu sections={sections} />);
    expect(isExpanded("Keys")).toBe(false);

    cleanup();

    // One key's page: /settings is an ancestor too, but API Keys is deeper.
    await renderAt("/settings/api-keys/42", <SideMenu sections={sections} />);
    expect(isExpanded("Keys")).toBe(true);
    expect(isExpanded("Basic")).toBe(true);
  });
});

describe("on a phone", () => {
  beforeEach(() => {
    setViewportWidth(PHONE_WIDTH);
  });

  async function openPhoneMenu(path: string): Promise<void> {
    await renderAt(path, workflowMenu());

    fireEvent.click(screen.getByTestId("mobile-sidemenu-toggle"));
  }

  test("the opened menu shows Advanced collapsed", async () => {
    await openPhoneMenu("/w/1");

    expect(isExpanded("Advanced")).toBe(false);
    expect(sectionBody("Advanced")).toHaveClass("invisible");
  });

  test("on a page inside Advanced, the opened menu shows it open, and the button names it", async () => {
    await openPhoneMenu("/w/1/settings");

    expect(isExpanded("Advanced")).toBe(true);
    expect(screen.getByTestId("mobile-sidemenu-toggle").textContent).toContain(
      "Advanced / Settings",
    );
  });

  /*
   * The phone menu closes when a page is picked. A tap on a section's header
   * used to close it too (the handler sits on the whole <nav>), so a folded
   * section could never be opened on a phone.
   */
  test("tapping a folded section's header opens it and keeps the menu open", async () => {
    await openPhoneMenu("/w/1");

    fireEvent.click(sectionToggle("Advanced"));

    expect(screen.getByTestId("mobile-sidemenu-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(isExpanded("Advanced")).toBe(true);
    expect(
      screen.getByRole("link", { name: "Delete Workflow" }),
    ).toBeInTheDocument();
  });

  test("tapping a page in the menu still closes it", async () => {
    await openPhoneMenu("/w/1");

    fireEvent.click(sectionToggle("Advanced"));
    fireEvent.click(screen.getByText("Settings"));

    expect(screen.getByTestId("mobile-sidemenu-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });
});
