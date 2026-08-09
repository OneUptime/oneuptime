import { act, render } from "@testing-library/react";
import { ReactElement } from "react";
import { Location } from "react-router-dom";
import Route from "../../../Types/API/Route";
import Navigation from "../../../UI/Utils/Navigation";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";

/*
 * Shared scaffolding for the product side-menu suites (alerts, incidents,
 * scheduled maintenance). All three menus are the same component fed different
 * sections, so the interesting assertions are about which pages sit in which
 * section — not about how to dig a link out of the DOM. That digging lives
 * here.
 *
 * Note what is deliberately *not* here: the expected sections themselves. Each
 * suite spells out its own menu in full, because a helper that generated the
 * expectation from the component would pass no matter what the component said.
 */

/*
 * Project ids are UUIDs; ProjectUtil rejects anything else, leaving the menu's
 * hrefs stuck on the literal ":projectId" placeholder.
 */
export const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

export const DESKTOP_WIDTH: number = 1280;
export const MOBILE_WIDTH: number = 375;

export interface MenuLink {
  title: string;
  href: string;
}

// The href the menu must produce for a page, from the app's own route table.
export function routeFor(pageMapKey: string): string {
  return RouteUtil.populateRouteParams(
    RouteMap[pageMapKey] as Route,
  ).toString();
}

/*
 * Two sources of truth to keep in step: the menu items read window.location
 * (through RouteUtil/ProjectUtil) while active-item detection reads the
 * react-router Location that the app normally pushes into Navigation.
 */
export function goTo(path: string): void {
  window.history.pushState({}, "", path);
  Navigation.setLocation({
    pathname: path,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);
}

export function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

function headings(): Array<HTMLElement> {
  return Array.from(document.querySelectorAll("h6"));
}

export function sectionTitlesInOrder(): Array<string> {
  return headings().map((heading: HTMLElement): string => {
    return heading.textContent?.trim() ?? "";
  });
}

export function sectionRoot(title: string): HTMLElement {
  const heading: HTMLElement | undefined = headings().find(
    (candidate: HTMLElement): boolean => {
      return candidate.textContent?.trim() === title;
    },
  );

  if (!heading) {
    throw new Error(
      `No side-menu section titled "${title}". Sections rendered: ${sectionTitlesInOrder().join(", ")}`,
    );
  }

  const root: HTMLElement | null = heading.closest("div.mb-2");

  if (!root) {
    throw new Error(`Section "${title}" is not wrapped in a section element.`);
  }

  return root;
}

export function sectionToggle(title: string): HTMLElement {
  const toggle: HTMLElement | null = sectionRoot(title).querySelector("button");

  if (!toggle) {
    throw new Error(`Section "${title}" has no collapse toggle.`);
  }

  return toggle;
}

// The element SideMenuSection collapses — it stays mounted, so "hidden" is a class.
export function sectionBody(title: string): HTMLElement {
  const body: Element | null = sectionToggle(title).nextElementSibling;

  if (!body) {
    throw new Error(`Section "${title}" has no content element.`);
  }

  return body as HTMLElement;
}

export function isExpanded(title: string): boolean {
  return sectionToggle(title).getAttribute("aria-expanded") === "true";
}

export function linksIn(title: string): Array<MenuLink> {
  return Array.from(sectionRoot(title).querySelectorAll("a")).map(
    (anchor: HTMLAnchorElement): MenuLink => {
      return {
        title: (
          anchor.querySelector("span.truncate")?.textContent ??
          anchor.textContent ??
          ""
        ).trim(),
        href: anchor.getAttribute("href") ?? "",
      };
    },
  );
}

export function allLinks(): Array<MenuLink> {
  return sectionTitlesInOrder().flatMap((title: string): Array<MenuLink> => {
    return linksIn(title);
  });
}

export function hrefsInMenu(): Array<string> {
  return allLinks().map((link: MenuLink): string => {
    return link.href;
  });
}

export function titlesInMenu(): Array<string> {
  return allLinks().map((link: MenuLink): string => {
    return link.title;
  });
}

// Every anchor in a section carries an icon, rendered as an inline <svg>.
export function iconCountIn(title: string): number {
  return Array.from(sectionRoot(title).querySelectorAll("a")).filter(
    (anchor: HTMLAnchorElement): boolean => {
      return anchor.querySelector("svg") !== null;
    },
  ).length;
}

/*
 * On a phone the whole menu collapses to one button naming where you are as
 * "<section> / <page>" — the one place the section names are spelled out to
 * the user in prose.
 */
export function mobileSummaryText(): string {
  return (
    document.querySelector('[data-testid="mobile-sidemenu-toggle"]')
      ?.textContent ?? ""
  );
}

/*
 * Awaited so the badge counts settle inside act() — CountModelSideMenuItem
 * sets state when its (stubbed) count resolves, and an unawaited render
 * leaves that update outside the test.
 */
export async function renderMenu(menu: ReactElement): Promise<void> {
  await act(async () => {
    render(menu);
  });
}
