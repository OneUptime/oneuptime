import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import IconProp from "../../../Types/Icon/IconProp";
import Permission from "../../../Types/Permission";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import { goTo, PROJECT_ID, routeFor } from "./SideMenuHarness";
import DashboardCommandPalette from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPalette";
import {
  buildPageSearchCommandDescriptors,
  PageSearchCommandDescriptor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPaletteHelpers";
import {
  getPageSearchAreas,
  PageSearchArea,
  PageSearchPage,
  PageSearchSection,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { RouteUtil } from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";

/*
 * SEARCH SAYS WHERE ROLES IS NOW: TEAMS › SETTINGS.
 *
 * Roles moved from the Teams menu's Teams section into its Settings section
 * (the maintainer: "Move the roles page to the settings side menu"). Search
 * (Cmd/Ctrl+K) names each page with the menu and section it sits in, so a
 * search for roles must now read "Roles — Teams › Settings", where it used
 * to read "Roles — Teams". These hold the page index to the menu, and the
 * real palette, in English, to what it lists.
 */

jest.mock("react-i18next", () => {
  const nodeFs: typeof import("fs") = jest.requireActual(
    "fs",
  ) as typeof import("fs");
  const nodePath: typeof import("path") = jest.requireActual(
    "path",
  ) as typeof import("path");

  const english: Record<string, unknown> = JSON.parse(
    nodeFs.readFileSync(
      nodePath.join(
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

  const translate: (key: string, defaultValue?: unknown) => string = (
    key: string,
    defaultValue?: unknown,
  ): string => {
    if (typeof english[key] === "string") {
      return english[key] as string;
    }

    let value: unknown = english;

    for (const part of key.split(".")) {
      if (typeof value !== "object" || value === null) {
        value = undefined;
        break;
      }

      value = (value as Record<string, unknown>)[part];
    }

    if (typeof value === "string") {
      return value;
    }

    return typeof defaultValue === "string" ? defaultValue : key;
  };

  return {
    useTranslation: () => {
      return { t: translate };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 10 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner];
      },
      getProjectPermissions: (): null => {
        return null;
      },
    },
  };
});

function teamsArea(): PageSearchArea {
  const area: PageSearchArea | undefined = getPageSearchAreas().find(
    (candidate: PageSearchArea): boolean => {
      return candidate.id === "teams";
    },
  );

  if (!area) {
    throw new Error("The page index has no Teams area");
  }

  return area;
}

function titlesOf(section: PageSearchSection): Array<string> {
  return section.pages.map((page: PageSearchPage): string => {
    return page.title;
  });
}

// The rows Search builds, from the real index and the real route table.
function descriptors(): Array<PageSearchCommandDescriptor> {
  return buildPageSearchCommandDescriptors({
    areas: getPageSearchAreas(),
    availability: {
      isBillingEnabled: true,
      isMonitorGroupsEnabled: true,
      canDeleteProject: true,
    },
    getRouteTemplate: (key: string): string => {
      return RouteUtil.getRouteString(key);
    },
    getRoutePath: (key: string): string => {
      return routeFor(key);
    },
    getProductTitle: (): string | undefined => {
      return undefined;
    },
    translate: (text: string): string => {
      return text;
    },
    catalog: [],
  });
}

function descriptorFor(pageMapKey: string): PageSearchCommandDescriptor {
  const routePath: string = routeFor(pageMapKey);
  const found: PageSearchCommandDescriptor | undefined = descriptors().find(
    (descriptor: PageSearchCommandDescriptor): boolean => {
      return !descriptor.isAction && descriptor.routePath === routePath;
    },
  );

  if (!found) {
    throw new Error(`Search has no row for ${pageMapKey}`);
  }

  return found;
}

const openPalette: () => void = (): void => {
  render(<DashboardCommandPalette />);
  act((): void => {
    GlobalEvents.dispatchEvent(EventName.COMMAND_PALETTE_TOGGLE);
  });
};

// The rows a query lists, in order: "<title> — <breadcrumb>".
const rows: (query: string) => Array<string> = (
  query: string,
): Array<string> => {
  fireEvent.change(screen.getByTestId("command-palette-input"), {
    target: { value: query },
  });

  return screen.queryAllByRole("option").map((option: HTMLElement): string => {
    const title: string =
      option.querySelector("p.font-medium")?.textContent || "";
    const breadcrumb: HTMLElement | null = option.querySelector(
      '[data-testid$="-breadcrumb"]',
    );

    if (!breadcrumb) {
      return title;
    }

    const crumbs: string = Array.from(breadcrumb.childNodes)
      .filter((node: ChildNode): boolean => {
        return !(
          node instanceof HTMLElement && node.classList.contains("sr-only")
        );
      })
      .map((node: ChildNode): string => {
        return node.textContent || "";
      })
      .join("")
      .split("›")
      .map((crumb: string): string => {
        return crumb.trim();
      })
      .join(" › ");

    return `${title} — ${crumbs}`;
  });
};

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  goTo(`/dashboard/${PROJECT_ID}/home`);
});

describe("the page index places Roles as the Teams menu does", () => {
  test("Teams lists All Teams alone, and Settings lists Roles, then Custom Fields", () => {
    const sections: Array<PageSearchSection> = teamsArea().sections;

    // In the menu's order; the Developer pages are generated, as the menu's are.
    expect(
      sections.map((section: PageSearchSection): string => {
        return section.title || "";
      }),
    ).toEqual(["Teams", "Settings", "Developer"]);
    expect(titlesOf(sections[0]!)).toEqual(["All Teams"]);
    expect(titlesOf(sections[1]!)).toEqual(["Roles", "Custom Fields"]);
  });

  test("Roles keeps its page, its ID card icon and the words people search it by", () => {
    const roles: PageSearchPage | undefined = teamsArea()
      .sections.flatMap((section: PageSearchSection): Array<PageSearchPage> => {
        return section.pages;
      })
      .find((page: PageSearchPage): boolean => {
        return page.title === "Roles";
      });

    expect(roles).toBeDefined();
    expect(roles?.page).toBe(PageMap.TEAM_ROLES);
    expect(roles?.icon).toBe(IconProp.Identification);
    expect(roles?.keywords).toEqual(
      expect.arrayContaining(["custom roles", "rbac", "built-in roles"]),
    );
  });

  test("Roles is indexed once, under Settings only", () => {
    const placed: Array<string> = getPageSearchAreas().flatMap(
      (area: PageSearchArea): Array<string> => {
        return area.sections.flatMap(
          (section: PageSearchSection): Array<string> => {
            return section.pages
              .filter((page: PageSearchPage): boolean => {
                return page.page === PageMap.TEAM_ROLES;
              })
              .map((): string => {
                return `${area.title} > ${section.title || ""}`;
              });
          },
        );
      },
    );

    expect(placed).toEqual(["Teams > Settings"]);
  });

  test("its row is placed under Teams › Settings and opens the Roles page", () => {
    const row: PageSearchCommandDescriptor = descriptorFor(PageMap.TEAM_ROLES);

    expect(row.title).toBe("Roles");
    expect(row.breadcrumb).toEqual(["Teams", "Settings"]);
    expect(row.breadcrumbKeywords).toEqual(["Teams", "Settings"]);
    expect(row.icon).toBe(IconProp.Identification);
    expect(row.routePath).toBe(routeFor(PageMap.TEAM_ROLES));
  });

  test("Custom Fields keeps its place beside it, and All Teams its own", () => {
    expect(descriptorFor(PageMap.TEAM_CUSTOM_FIELDS).breadcrumb).toEqual([
      "Teams",
      "Settings",
    ]);
    // The section repeats the product's name, so it is left out.
    expect(descriptorFor(PageMap.TEAMS).breadcrumb).toEqual(["Teams"]);
  });
});

describe("the palette lists Roles under Teams › Settings", () => {
  test.each([["roles"], ["Roles"], ["custom roles"], ["custom role"], ["rbac"]])(
    "'%s' puts Roles first, under Teams › Settings",
    (query: string) => {
      openPalette();

      expect(rows(query)[0]).toBe("Roles — Teams › Settings");
    },
  );

  test("no row places Roles under Teams alone any more", () => {
    openPalette();

    const listed: Array<string> = rows("roles");

    expect(listed).toContain("Roles — Teams › Settings");
    expect(listed).not.toContain("Roles — Teams");
  });

  test("'team custom fields' finds Custom Fields beside it", () => {
    openPalette();

    expect(rows("team custom fields")).toContain(
      "Custom Fields — Teams › Settings",
    );
  });
});
