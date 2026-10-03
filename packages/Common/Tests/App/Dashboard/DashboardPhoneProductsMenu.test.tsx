import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import DashboardNavbar from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Route from "../../../Types/API/Route";
import { CATEGORY_FOLDS_STORAGE_KEY } from "../../../UI/Components/Navbar/NavBarMenuCatalog";
import Navigation from "../../../UI/Utils/Navigation";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  PROJECT_ID,
  goTo,
  routeFor,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * On a phone the Dashboard has no products dialog: the menu toggle lists
 * Home, the products and User Settings. It used to list all 42 products one
 * after another. It now folds them the way the desktop products menu does:
 * Essentials listed, every other section one line that opens on a tap, the
 * section of the current page open by itself, and the same remembered
 * choices as the desktop menu.
 */

const translation: i18n = createInstance();
const ORIGINAL_WIDTH: number = window.innerWidth;

const ESSENTIALS: Array<string> = [
  "Monitors",
  "Incidents",
  "Alerts",
  "On-Call Duty",
  "Status Pages",
  "Scheduled Maintenance",
  "SLOs",
];

const FOLDED: Array<string> = [
  "Observability",
  "AI",
  "Code",
  "Resources",
  "Infrastructure",
  "Dashboards & Automation",
  "Settings",
];

function navbar(): React.ReactElement {
  return (
    <I18nextProvider i18n={translation}>
      <DashboardNavbar show={true} />
    </I18nextProvider>
  );
}

function openPhoneMenu(): HTMLElement {
  fireEvent.click(screen.getByTestId("mobile-nav-toggle"));
  const menu: HTMLElement | null = screen
    .getByRole("link", { name: "Home" })
    .closest("nav");
  expect(menu).not.toBeNull();
  return menu!;
}

function linkTitles(menu: HTMLElement): Array<string> {
  return within(menu)
    .getAllByRole("link")
    .map((link: HTMLElement): string => {
      return link.textContent ?? "";
    });
}

function sectionToggles(menu: HTMLElement): Array<HTMLElement> {
  return within(menu)
    .queryAllByRole("button")
    .filter((button: HTMLElement): boolean => {
      return button.hasAttribute("aria-expanded");
    });
}

function folded(menu: HTMLElement): Array<string> {
  return sectionToggles(menu)
    .filter((button: HTMLElement): boolean => {
      return button.getAttribute("aria-expanded") === "false";
    })
    .map((button: HTMLElement): string => {
      return button.textContent ?? "";
    });
}

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: englishLocale } },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  window.localStorage.clear();
  setViewportWidth(MOBILE_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}/home`);
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  setViewportWidth(ORIGINAL_WIDTH);
});

describe("the phone menu folds the products like the desktop menu", () => {
  test("Home, the essentials, one line per other section, then User Settings", () => {
    render(navbar());
    const menu: HTMLElement = openPhoneMenu();

    expect(linkTitles(menu)).toEqual(["Home", ...ESSENTIALS, "User Settings"]);
    expect(folded(menu)).toEqual(FOLDED);
    expect(
      within(menu).getByRole("button", { name: "Essentials" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  test("a folded line names what is inside it", () => {
    render(navbar());
    const menu: HTMLElement = openPhoneMenu();

    expect(
      within(menu).getByRole("button", { name: "Resources" }),
    ).toHaveAccessibleDescription(
      "5 products Inventory, Services, Databases, Queues, Real User Monitoring",
    );
  });

  test("a tap opens a section in place, without closing the menu, and another folds it", () => {
    render(navbar());
    const menu: HTMLElement = openPhoneMenu();

    fireEvent.click(
      within(menu).getByRole("button", { name: "Infrastructure" }),
    );

    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(linkTitles(menu)).toEqual([
      "Home",
      ...ESSENTIALS,
      "Hosts",
      "Kubernetes",
      "Docker",
      "Docker Swarm",
      "Podman",
      "Serverless",
      "Cloud",
      "Proxmox",
      "VMware",
      "Ceph",
      "Network",
      "IoT",
      "User Settings",
    ]);
    expect(
      within(menu)
        .getByRole("link", { name: "Kubernetes" })
        .getAttribute("href"),
    ).toBe(routeFor(PageMap.KUBERNETES_CLUSTERS));

    fireEvent.click(
      within(menu).getByRole("button", { name: "Infrastructure" }),
    );

    expect(within(menu).queryByRole("link", { name: "Kubernetes" })).toBeNull();
  });

  test("tapping a product goes there and closes the menu", () => {
    render(navbar());
    const menu: HTMLElement = openPhoneMenu();
    fireEvent.click(within(menu).getByRole("button", { name: "Settings" }));

    fireEvent.click(within(menu).getByRole("link", { name: "Teams" }));

    expect(Navigation.navigate).toHaveBeenCalledWith(
      new Route(routeFor(PageMap.TEAMS)),
    );
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
  });

  test("the section of the page the user is on opens by itself", () => {
    goTo(`/dashboard/${PROJECT_ID}/kubernetes`);
    render(navbar());

    const menu: HTMLElement = openPhoneMenu();

    expect(
      within(menu).getByRole("button", { name: "Infrastructure" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getByRole("link", { name: "Kubernetes" })).toHaveClass(
      "bg-gray-100",
    );
    expect(folded(menu)).not.toContain("Infrastructure");
  });

  test("a section opened on a phone is open in the desktop products menu too", () => {
    const { unmount } = render(navbar());
    const menu: HTMLElement = openPhoneMenu();
    fireEvent.click(within(menu).getByRole("button", { name: "Code" }));
    unmount();

    expect(
      JSON.parse(window.localStorage.getItem(CATEGORY_FOLDS_STORAGE_KEY)!),
    ).toEqual({ Code: true });

    setViewportWidth(DESKTOP_WIDTH);
    render(navbar());
    fireEvent.click(screen.getByRole("button", { name: "Products" }));

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Products menu",
    });
    expect(
      within(dialog).getByRole("button", { name: "Code" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByRole("option", { name: /Tasks/ })).toBeVisible();
  });

  test("a section folded in the desktop menu is folded on the phone", () => {
    setViewportWidth(DESKTOP_WIDTH);
    const { unmount } = render(navbar());
    fireEvent.click(screen.getByRole("button", { name: "Products" }));
    fireEvent.click(screen.getByRole("button", { name: "Essentials" }));
    unmount();

    setViewportWidth(MOBILE_WIDTH);
    render(navbar());
    const menu: HTMLElement = openPhoneMenu();

    expect(folded(menu)).toEqual(["Essentials", ...FOLDED]);
    expect(linkTitles(menu)).toEqual(["Home", "User Settings"]);
  });
});
