import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, screen } from "@testing-library/react";
import * as React from "react";
import ExceptionViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Exceptions/View/SideMenu";
import ObjectID from "../../../Types/ObjectID";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  MenuLink,
  PROJECT_ID,
  goTo,
  hrefsInMenu,
  iconCountIn,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  sectionTitlesInOrder,
  setViewportWidth,
  titlesInMenu,
} from "./SideMenuHarness";

const EXCEPTION_ID: string = "0193c0de-3333-4aaa-8bbb-000000000003";
const EXCEPTION_PATH: string = `/dashboard/${PROJECT_ID}/exceptions/${EXCEPTION_ID}`;

interface DetailPage {
  title: string;
  section: string;
  path: string;
}

const DETAIL_PAGES: ReadonlyArray<DetailPage> = [
  { title: "Overview", section: "Investigate", path: EXCEPTION_PATH },
  {
    title: "Stack Trace",
    section: "Investigate",
    path: `${EXCEPTION_PATH}/stack-trace`,
  },
  {
    title: "Occurrences",
    section: "Investigate",
    path: `${EXCEPTION_PATH}/occurrences`,
  },
  {
    title: "Context",
    section: "Investigate",
    path: `${EXCEPTION_PATH}/context`,
  },
  {
    title: "AI Assistance",
    section: "Resolve",
    path: `${EXCEPTION_PATH}/ai-assistance`,
  },
  {
    title: "Settings",
    section: "Manage",
    path: `${EXCEPTION_PATH}/settings`,
  },
];

async function renderExceptionMenu(): Promise<void> {
  await renderMenu(
    <ExceptionViewSideMenu modelId={new ObjectID(EXCEPTION_ID)} />,
  );
}

describe("exception detail side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    goTo(EXCEPTION_PATH);
  });

  afterEach(() => {
    cleanup();
  });

  test("renders the investigation, resolution, and management sections in order", async () => {
    await renderExceptionMenu();

    expect(sectionTitlesInOrder()).toEqual([
      "Investigate",
      "Resolve",
      "Manage",
    ]);
  });

  test("places each detail destination in its intended section", async () => {
    await renderExceptionMenu();

    expect(linksIn("Investigate")).toEqual([
      { title: "Overview", href: EXCEPTION_PATH },
      { title: "Stack Trace", href: `${EXCEPTION_PATH}/stack-trace` },
      { title: "Occurrences", href: `${EXCEPTION_PATH}/occurrences` },
      { title: "Context", href: `${EXCEPTION_PATH}/context` },
    ]);
    expect(linksIn("Resolve")).toEqual([
      {
        title: "AI Assistance",
        href: `${EXCEPTION_PATH}/ai-assistance`,
      },
    ]);
    expect(linksIn("Manage")).toEqual([
      { title: "Settings", href: `${EXCEPTION_PATH}/settings` },
    ]);
  });

  test("lists six unique, fully populated destinations", async () => {
    await renderExceptionMenu();

    const hrefs: Array<string> = hrefsInMenu();
    const titles: Array<string> = titlesInMenu();

    expect(hrefs).toHaveLength(DETAIL_PAGES.length);
    expect(hrefs).toEqual(Array.from(new Set(hrefs)));
    expect(titles).toEqual(Array.from(new Set(titles)));

    hrefs.forEach((href: string) => {
      expect(href).toContain(EXCEPTION_PATH);
      expect(href).not.toContain(":projectId");
      expect(href).not.toContain(":modelId");
      expect(href).not.toContain(":id");
    });
  });

  test.each(DETAIL_PAGES)(
    "marks $title active on desktop",
    async (page: DetailPage) => {
      goTo(page.path);
      await renderExceptionMenu();

      const activeLink: HTMLElement = screen.getByRole("link", {
        name: page.title,
      });

      expect(activeLink).toHaveAttribute("href", page.path);
      expect(activeLink).toHaveClass(
        "bg-indigo-50",
        "text-indigo-700",
        "font-semibold",
      );
      expect(isExpanded(page.section)).toBe(true);
      expect(document.querySelectorAll("a.bg-indigo-50")).toHaveLength(1);
    },
  );

  test.each(DETAIL_PAGES)(
    "the mobile summary identifies $section / $title",
    async (page: DetailPage) => {
      setViewportWidth(MOBILE_WIDTH);
      goTo(page.path);
      await renderExceptionMenu();

      expect(mobileSummaryText()).toContain(`${page.section} / ${page.title}`);
    },
  );

  test("every destination keeps a visible label and icon", async () => {
    await renderExceptionMenu();

    sectionTitlesInOrder().forEach((sectionTitle: string) => {
      const links: Array<MenuLink> = linksIn(sectionTitle);

      expect(iconCountIn(sectionTitle)).toBe(links.length);
      links.forEach((link: MenuLink) => {
        expect(link.title.trim()).not.toBe("");
      });
    });
  });
});
