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
import * as React from "react";

/*
 * The dashboard's own English strings, so the search below runs over the
 * titles and descriptions a person actually sees rather than over i18n keys.
 */
jest.mock("react-i18next", () => {
  const fileSystem: typeof import("fs") = jest.requireActual("fs");
  const filePath: typeof import("path") = jest.requireActual("path");

  const english: Record<string, unknown> = JSON.parse(
    fileSystem.readFileSync(
      filePath.join(
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
        "en.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;

  // "navbar.items.runbooksTitle" is nested; plain UI strings are flat keys.
  const lookUp: (key: string) => unknown = (key: string): unknown => {
    if (typeof english[key] === "string") {
      return english[key];
    }

    return key.split(".").reduce((node: unknown, part: string): unknown => {
      return node && typeof node === "object"
        ? (node as Record<string, unknown>)[part]
        : undefined;
    }, english);
  };

  return {
    useTranslation: () => {
      return {
        t: (key: string, fallback?: unknown): string => {
          const found: unknown = lookUp(key);

          if (typeof found === "string") {
            return found;
          }

          return typeof fallback === "string" ? fallback : key;
        },
      };
    },
  };
});

import { useDashboardNavigationItems } from "../../../../App/FeatureSet/Dashboard/src/Utils/NavigationItems";
import { MoreMenuItem } from "../../../UI/Components/Navbar/NavBar";
import NavBarMenuModal from "../../../UI/Components/Navbar/NavBarMenuModal";
import Navigation from "../../../UI/Utils/Navigation";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * Runners used to be a Project Settings page; they are now part of Runbooks.
 * Somebody who only uses a Runner for AI code fixes has no reason to think of
 * runbooks, so the products menu (and the command palette, which searches the
 * same catalog) has to answer "runner" with the product they live in.
 *
 * This renders the real products menu over the dashboard's real catalog and
 * types into it.
 */

const RUNBOOKS: string = `/dashboard/${PROJECT_ID}/runbooks`;

const ProductsMenu: React.FunctionComponent = (): React.ReactElement => {
  const { moreMenuItems } = useDashboardNavigationItems();

  return <NavBarMenuModal items={moreMenuItems} onClose={() => {}} />;
};

let catalog: Array<MoreMenuItem> = [];

const CatalogProbe: React.FunctionComponent = (): React.ReactElement => {
  catalog = useDashboardNavigationItems().moreMenuItems;

  return <></>;
};

function queryFor(value: string): void {
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value },
  });
}

function resultTitles(): Array<string> {
  return screen.queryAllByRole("option").map((option: HTMLElement): string => {
    return option.querySelector("span.truncate")?.textContent ?? "";
  });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

beforeEach(() => {
  window.localStorage.clear();
  goTo(`/dashboard/${PROJECT_ID}`);
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe("the products menu's own search, over the real catalog", () => {
  test.each([
    ["playbooks", "Runbooks"],
    ["billing", "Project Settings"],
  ])("%j still finds %s", (query: string, title: string) => {
    render(<ProductsMenu />);

    queryFor(query);

    expect(resultTitles()).toEqual([title]);
  });
});

describe("searching the products menu for a Runner", () => {
  test.each(["runner", "Runners", "  runners  ", "RUNNER"])(
    "%j offers Runbooks, where Runners are set up",
    (query: string) => {
      render(<ProductsMenu />);

      queryFor(query);

      expect(resultTitles()).toEqual(["Runbooks"]);
      expect(
        within(screen.getByRole("option")).getByRole("link"),
      ).toHaveAttribute("href", RUNBOOKS);
    },
  );

  test("it does not offer Project Settings, where they used to be", () => {
    render(<ProductsMenu />);

    queryFor("runner");

    expect(resultTitles()).not.toContain("Project Settings");
  });

  test("the match is the Runbooks entry's keyword, so the command palette finds it too", () => {
    // The palette builds its commands from the same catalog entries.
    render(<CatalogProbe />);

    const runbooks: MoreMenuItem | undefined = catalog.find(
      (item: MoreMenuItem): boolean => {
        return item.route.toString() === RUNBOOKS;
      },
    );

    expect(runbooks?.title).toBe("Runbooks");
    expect(runbooks?.keywords).toContain("runners");
    expect(
      catalog.filter((item: MoreMenuItem): boolean => {
        return (item.keywords || []).includes("runners");
      }),
    ).toHaveLength(1);
  });
});
