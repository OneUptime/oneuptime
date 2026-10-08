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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import ObjectID from "../../../Types/ObjectID";
import URL from "../../../Types/API/URL";
import { DOCS_URL } from "../../../UI/Config";
import DashboardNavbar from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import GettingStarted from "../../../../App/FeatureSet/Dashboard/src/Components/Home/GettingStarted";
import HowOneUptimeWorks, {
  HOW_IT_WORKS_FOOTNOTE,
  HOW_IT_WORKS_STEPS,
  HOW_IT_WORKS_TITLE,
  HowItWorksStep,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HowOneUptimeWorks";
import Help from "../../../../App/FeatureSet/Dashboard/src/Components/Header/Help";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";

/*
 * "OneUptime is vast and users get confused" — this suite pins the fixes that
 * orient a new user, by mounting the real components and reading them the
 * way a user would:
 *
 *  - the Products menu groups 42 products into small, named sections, with
 *    the core products first and in the order a problem flows through them,
 *    and opens on those core products alone: every other section is one
 *    line, opened with a click or found by searching;
 *  - Home explains how the core products fit together;
 *  - Help links to the documentation.
 *
 * react-i18next is answered from the REAL locale files, so the copy asserted
 * here is the copy users see (and a missing key shows up as a raw key).
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type LocaleData = Record<string, unknown>;

function readLocale(code: string): LocaleData {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as LocaleData;
}

const EN: LocaleData = readLocale("en");
const DE: LocaleData = readLocale("de");

let activeLocale: LocaleData = EN;

function lookupNested(data: LocaleData, key: string): string | undefined {
  let cursor: unknown = data;
  for (const part of key.split(".")) {
    if (!cursor || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

const navigateMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const captureMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

/*
 * Mirrors i18next's two lookup styles the dashboard uses: t("a.b.c", default)
 * for nested keys, and t(text, { keySeparator: false, defaultValue }) for the
 * flat English-text keys behind useTranslateValue. Lazily dereferenced, because
 * jest.mock factories are hoisted above the consts they read.
 */
jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          if (
            options &&
            typeof options === "object" &&
            (options as { keySeparator?: unknown }).keySeparator === false
          ) {
            const flat: unknown = activeLocale[key];
            return typeof flat === "string"
              ? flat
              : (options as { defaultValue?: string }).defaultValue ?? key;
          }
          return (
            lookupNested(activeLocale, key) ??
            (typeof options === "string" ? options : key)
          );
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      isOnThisPage: () => {
        return false;
      },
      isStartWith: () => {
        return false;
      },
      navigate: (...args: Array<unknown>) => {
        return navigateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: (...args: Array<unknown>) => {
        return captureMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<unknown>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

const PROJECT_ID: string = "65f00000000000000000aaaa";

type CountFor = (modelName: string) => number;

function answerCounts(countFor: CountFor): void {
  countMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: { name: string } } = args[0] as {
      modelType: { name: string };
    };
    return Promise.resolve(countFor(request.modelType.name));
  });
}

// Monitor + team done, status page + on-call still to do.
const HALF_DONE: CountFor = (modelName: string): number => {
  if (modelName === "Monitor") {
    return 3;
  }
  if (modelName === "TeamMember") {
    return 2;
  }
  return 0;
};

async function renderGettingStarted(): Promise<void> {
  await act(async () => {
    render(<GettingStarted projectId={new ObjectID(PROJECT_ID)} />);
  });
}

function productsMenu(): HTMLElement {
  // The dialog's name is translated like everything else in it.
  return screen.getByRole("dialog", {
    name: String(activeLocale["Products menu"] ?? "Products menu"),
  });
}

// The heading rows that open and fold a section of the menu.
function sectionToggles(): Array<HTMLElement> {
  return within(productsMenu())
    .queryAllByRole("button")
    .filter((button: HTMLElement): boolean => {
      return button.hasAttribute("aria-expanded");
    });
}

function foldedSectionNames(): Array<string> {
  return sectionToggles()
    .filter((button: HTMLElement): boolean => {
      return button.getAttribute("aria-expanded") === "false";
    })
    .map((button: HTMLElement): string => {
      return button.textContent || "";
    });
}

/*
 * The menu opens with Essentials open and every other section folded to
 * one row. Open each folded one, as a user would, to read the whole catalog.
 */
function openEverySection(): void {
  for (const toggle of sectionToggles()) {
    if (toggle.getAttribute("aria-expanded") === "false") {
      fireEvent.click(toggle);
    }
  }
}

function openProductsMenu(): void {
  render(<DashboardNavbar show={true} />);
  // The button label is itself translated.
  fireEvent.click(screen.getByText(String(activeLocale["Products"])));
  act(() => {
    jest.runOnlyPendingTimers();
  });
}

interface MenuSection {
  heading: string;
  items: Array<string>;
}

/*
 * Reads the menu top to bottom, the way a user scans it, with every folded
 * section opened.
 */
function readMenuSections(): Array<MenuSection> {
  openEverySection();
  const listbox: HTMLElement = within(productsMenu()).getByRole("listbox");
  return Array.from(listbox.querySelectorAll("h3")).map(
    (heading: HTMLHeadingElement): MenuSection => {
      const section: HTMLElement = heading.closest(
        '[role="group"]',
      ) as HTMLElement;
      const items: Array<string> = within(section)
        .getAllByRole("option")
        .map((option: HTMLElement): string => {
          return option.querySelector(".font-medium, .text-sm")!.textContent!;
        });
      return { heading: heading.textContent || "", items };
    },
  );
}

function optionFor(title: string): HTMLElement {
  openEverySection();
  return within(productsMenu())
    .getAllByRole("option")
    .find((option: HTMLElement): boolean => {
      return (option.textContent || "").startsWith(title);
    })!;
}

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
  activeLocale = EN;
  getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
  answerCounts(HALF_DONE);
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  navigateMock.mockReset();
  countMock.mockReset();
  captureMock.mockReset();
  getCurrentProjectIdMock.mockReset();
});

describe("Products menu sections", () => {
  test("sections appear in a deliberate order with plain names", () => {
    openProductsMenu();

    expect(
      readMenuSections().map((section: MenuSection): string => {
        return section.heading;
      }),
    ).toEqual([
      "Essentials",
      "Observability",
      "AI",
      "Code",
      "Resources",
      "Infrastructure",
      "Dashboards & Automation",
      "Settings",
    ]);
  });

  test("AI is what you ask and read; Code is the work AI does in your code", () => {
    openProductsMenu();

    const sections: Array<MenuSection> = readMenuSections();
    expect(
      sections.find((section: MenuSection): boolean => {
        return section.heading === "AI";
      }),
    ).toEqual({ heading: "AI", items: ["Chat", "Insights"] });
    /*
     * One item, not Tasks plus Code Repositories: repositories are where
     * tasks open pull requests, so they are a page in the Tasks side menu.
     */
    expect(
      sections.find((section: MenuSection): boolean => {
        return section.heading === "Code";
      }),
    ).toEqual({ heading: "Code", items: ["Tasks"] });
  });

  test("the Tasks item says repositories are connected there", () => {
    openProductsMenu();

    expect(optionFor("Tasks")).toHaveTextContent(
      "AI opens pull requests that fix your code. Connect GitHub here.",
    );
  });

  test("no section is a catch-all called 'More' inside the products menu", () => {
    openProductsMenu();

    for (const section of readMenuSections()) {
      expect(section.heading).not.toBe("More");
    }
  });

  test("no section is so long that it stops being scannable", () => {
    openProductsMenu();

    /*
     * Infrastructure lists one product per platform and is the longest
     * section: 13 since Storage Arrays joined Ceph there. Past that, split
     * it rather than raising this again.
     */
    for (const section of readMenuSections()) {
      expect(section.items.length).toBeLessThanOrEqual(13);
    }
  });

  test("Essentials follow a problem from detection to customer update", () => {
    openProductsMenu();

    expect(readMenuSections()[0]).toEqual({
      heading: "Essentials",
      items: [
        "Monitors",
        "Incidents",
        "Alerts",
        "On-Call Duty",
        "Status Pages",
        "Scheduled Maintenance",
        "SLOs",
      ],
    });
  });

  test("every per-platform product is under Infrastructure, most common first", () => {
    openProductsMenu();

    const infrastructure: MenuSection = readMenuSections().find(
      (section: MenuSection): boolean => {
        return section.heading === "Infrastructure";
      },
    )!;

    expect(infrastructure.items).toEqual([
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
      "Storage Arrays",
      "Network",
      "IoT",
    ]);
  });

  test("Resources keeps only the catalogs that span every platform", () => {
    openProductsMenu();

    const resources: MenuSection = readMenuSections().find(
      (section: MenuSection): boolean => {
        return section.heading === "Resources";
      },
    )!;

    expect(resources.items).toEqual([
      "Inventory",
      "Services",
      "Databases",
      "Queues",
      "Real User Monitoring",
    ]);
  });

  test("regrouping lost no product: all 43 are still listed exactly once", () => {
    openProductsMenu();

    const titles: Array<string> = readMenuSections().flatMap(
      (section: MenuSection): Array<string> => {
        return section.items;
      },
    );
    /*
     * 43: Code Repositories became a page of Tasks, Forms (which replaced
     * Incidents > Settings > Forms) became a product, and Storage Arrays
     * joined Infrastructure.
     */
    expect(titles).toHaveLength(43);
    expect(new Set(titles).size).toBe(43);
    expect(titles).not.toContain("Code Repositories");
    expect(titles).toContain("Forms");
  });
});

describe("the Products menu opens on the essentials", () => {
  test("only Essentials' products are listed; every other section is one folded line", () => {
    openProductsMenu();

    expect(
      sectionToggles()
        .filter((toggle: HTMLElement): boolean => {
          return toggle.getAttribute("aria-expanded") === "true";
        })
        .map((toggle: HTMLElement): string => {
          return toggle.textContent || "";
        }),
    ).toEqual(["Essentials"]);
    expect(foldedSectionNames()).toEqual([
      "Observability",
      "AI",
      "Code",
      "Resources",
      "Infrastructure",
      "Dashboards & Automation",
      "Settings",
    ]);
    expect(
      within(productsMenu())
        .getAllByRole("option")
        .map((option: HTMLElement): string => {
          return option.querySelector(".font-medium, .text-sm")!.textContent!;
        }),
    ).toEqual([
      "Monitors",
      "Incidents",
      "Alerts",
      "On-Call Duty",
      "Status Pages",
      "Scheduled Maintenance",
      "SLOs",
    ]);
  });

  test("a folded line says how many products it holds and what they are", () => {
    openProductsMenu();

    const infrastructure: HTMLElement = within(productsMenu()).getByRole(
      "button",
      { name: "Infrastructure" },
    );

    expect(infrastructure).toHaveAttribute("aria-expanded", "false");
    expect(infrastructure).toHaveAccessibleDescription(
      "13 products Hosts, Kubernetes, Docker, Docker Swarm, Podman, Serverless, Cloud, Proxmox, VMware, Ceph, Storage Arrays, Network, IoT",
    );
    expect(
      within(productsMenu()).getByRole("button", { name: "Code" }),
    ).toHaveAccessibleDescription("1 product Tasks");
  });

  test("opening a folded line lists its products, one click away", () => {
    openProductsMenu();

    fireEvent.click(
      within(productsMenu()).getByRole("button", { name: "Settings" }),
    );

    expect(optionFor("Project Settings")).toBeInTheDocument();
    expect(
      within(productsMenu()).getByRole("button", { name: "Settings" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  test("a search finds a product in a folded section", () => {
    openProductsMenu();

    fireEvent.change(within(productsMenu()).getByRole("combobox"), {
      target: { value: "proxmox" },
    });

    expect(within(productsMenu()).getAllByRole("option")).toHaveLength(1);
    expect(within(productsMenu()).getByRole("option")).toHaveTextContent(
      "Proxmox",
    );
  });

  test("the folded lines are named in German too", () => {
    activeLocale = DE;
    openProductsMenu();

    expect(foldedSectionNames()).toContain(
      lookupNested(DE, "navbar.categories.infrastructure"),
    );
    expect(foldedSectionNames()).not.toContain(
      lookupNested(DE, "navbar.categories.essentials"),
    );
    // Essentials are the open row of the same list, named in German too.
    expect(
      within(productsMenu()).getByRole("button", {
        name: lookupNested(DE, "navbar.categories.essentials")!,
      }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(sectionToggles()[0]).toHaveTextContent(
      lookupNested(DE, "navbar.categories.essentials")!,
    );
  });
});

describe("Products menu descriptions say what each product is for", () => {
  test.each([
    ["Alerts", "Problems for your team to look into before users notice."],
    ["Incidents", "Problems that affect your users — respond and resolve."],
    ["Monitors", "Check websites, APIs and servers, and know when they fail."],
    ["On-Call Duty", "Who gets paged, and who is next if nobody answers."],
    ["Status Pages", "Show your customers what is up and what is down."],
  ])("%s", (title: string, description: string) => {
    openProductsMenu();

    expect(optionFor(title)).toHaveTextContent(description);
  });

  test.each([
    ["Alerts", "Notification management."],
    ["Monitors", "Monitor any resource."],
    ["Incidents", "Detect and resolve fast."],
    ["Status Pages", "Real-time status updates."],
    ["Project Settings", "Configure your project."],
  ])(
    "%s no longer uses the vague description %p",
    (title: string, oldDescription: string) => {
      openProductsMenu();

      expect(optionFor(title)).not.toHaveTextContent(oldDescription);
    },
  );

  test("Alerts and Incidents are told apart by who is affected", () => {
    openProductsMenu();

    expect(optionFor("Incidents")).toHaveTextContent("affect your users");
    expect(optionFor("Alerts")).toHaveTextContent("before users notice");
  });

  test("the grouping is localised too (German)", () => {
    activeLocale = DE;
    openProductsMenu();

    const headings: Array<string> = readMenuSections().map(
      (section: MenuSection): string => {
        return section.heading;
      },
    );
    expect(headings).toContain(
      lookupNested(DE, "navbar.categories.infrastructure"),
    );
    expect(headings).toContain(
      lookupNested(DE, "navbar.categories.analyticsAutomation"),
    );
    expect(headings).toContain(lookupNested(DE, "navbar.categories.code"));
    expect(headings).not.toContain("navbar.categories.infrastructure");
    expect(headings).not.toContain("navbar.categories.code");
  });
});

describe("How OneUptime works (Home)", () => {
  test("the Getting Started card explains how the core products connect", async () => {
    await renderGettingStarted();

    const strip: HTMLElement = screen.getByTestId("how-oneuptime-works");
    expect(strip).toHaveTextContent(HOW_IT_WORKS_TITLE);
    expect(strip).toHaveTextContent(HOW_IT_WORKS_FOOTNOTE);
    expect(
      within(strip)
        .getAllByRole("button")
        .map((button: HTMLElement): string => {
          return button.getAttribute("data-testid") || "";
        }),
    ).toEqual([
      "how-it-works-step-monitor",
      "how-it-works-step-incident",
      "how-it-works-step-on-call",
      "how-it-works-step-status-page",
    ]);
  });

  test("steps are numbered in flow order and read as a sentence", async () => {
    await renderGettingStarted();

    const steps: Array<HTMLElement> = within(
      screen.getByTestId("how-oneuptime-works"),
    ).getAllByRole("listitem");

    expect(steps).toHaveLength(4);
    HOW_IT_WORKS_STEPS.forEach((step: HowItWorksStep, index: number) => {
      expect(steps[index]).toHaveTextContent(`${index + 1}.${step.title}`);
      expect(steps[index]).toHaveTextContent(step.description);
    });
  });

  test("the strip tells the user the rest of the product is optional", async () => {
    await renderGettingStarted();

    expect(
      screen.getByTestId("how-oneuptime-works-footnote"),
    ).toHaveTextContent("optional");
    expect(
      screen.getByTestId("how-oneuptime-works-footnote"),
    ).toHaveTextContent("Products");
  });

  test.each([
    ["monitor", PageMap.MONITORS],
    ["incident", PageMap.INCIDENTS],
    ["on-call", PageMap.ON_CALL_DUTY],
    ["status-page", PageMap.STATUS_PAGES],
  ])(
    "clicking the %s step opens that product in the current project",
    async (key: string, pageMap: PageMap) => {
      await renderGettingStarted();

      fireEvent.click(screen.getByTestId(`how-it-works-step-${key}`));

      expect(navigateMock).toHaveBeenCalledTimes(1);
      const route: string = String(navigateMock.mock.calls[0]![0]);
      expect(route).toContain(PROJECT_ID);
      expect(route).not.toContain(":projectId");
      expect(route).toBe(
        RouteMap[pageMap]!.toString().replace(":projectId", PROJECT_ID),
      );
      expect(captureMock).toHaveBeenCalledWith(
        "dashboard/home/how-it-works-step",
        { projectId: PROJECT_ID, step: key },
      );
    },
  );

  test("the steps are the Essentials products, in the menu's order", () => {
    /*
     * Home and the Products menu tell the same story; if someone reorders
     * one, this makes them look at the other.
     */
    jest.useRealTimers();
    jest.useFakeTimers();
    openProductsMenu();
    const essentials: Array<string> = readMenuSections()[0]!.items;

    const flow: Array<number> = [
      "Monitors",
      "Incidents",
      "On-Call Duty",
      "Status Pages",
    ].map((title: string): number => {
      return essentials.indexOf(title);
    });
    expect(
      flow.every((index: number) => {
        return index >= 0;
      }),
    ).toBe(true);
    expect(
      [...flow].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(flow);
    expect(
      HOW_IT_WORKS_STEPS.map((step: HowItWorksStep) => {
        return step.pageMap;
      }),
    ).toEqual([
      PageMap.MONITORS,
      PageMap.INCIDENTS,
      PageMap.ON_CALL_DUTY,
      PageMap.STATUS_PAGES,
    ]);
  });

  test("dismissing Getting Started also removes the explainer", async () => {
    await renderGettingStarted();
    expect(screen.getByTestId("how-oneuptime-works")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("getting-started-dismiss"));

    expect(screen.queryByTestId("how-oneuptime-works")).toBeNull();
  });

  test("a fully set-up project does not see the explainer", async () => {
    answerCounts((): number => {
      return 5;
    });
    await renderGettingStarted();

    expect(screen.queryByTestId("how-oneuptime-works")).toBeNull();
    expect(screen.queryByTestId("getting-started")).toBeNull();
  });

  test("the explainer and the checklist are translated (German)", async () => {
    activeLocale = DE;
    await renderGettingStarted();

    const card: HTMLElement = screen.getByTestId("getting-started");
    for (const english of [
      HOW_IT_WORKS_TITLE,
      HOW_IT_WORKS_FOOTNOTE,
      "Create your first monitor",
      "Publish a status page",
      "steps completed",
    ]) {
      const german: unknown = DE[english];
      expect(typeof german).toBe("string");
      expect(german).not.toBe(english);
      expect(card).toHaveTextContent(german as string);
      expect(card).not.toHaveTextContent(english);
    }
  });

  test("the strip also renders on its own, outside the checklist", () => {
    render(<HowOneUptimeWorks projectId={PROJECT_ID} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(
      HOW_IT_WORKS_STEPS.length,
    );
  });
});

describe("Help menu", () => {
  function openHelp(): Array<HTMLAnchorElement | HTMLElement> {
    render(<Help />);
    fireEvent.click(screen.getByRole("button"));
    return screen.getAllByRole("link").concat(
      screen.queryAllByRole("button").filter((element: HTMLElement) => {
        return element.tagName !== "BUTTON";
      }),
    );
  }

  test("links to the documentation of this OneUptime instance", () => {
    openHelp();

    const docs: HTMLElement = screen.getByText("Documentation").closest("a")!;
    expect(docs).toHaveAttribute(
      "href",
      URL.fromString(DOCS_URL.toString()).toString(),
    );
    expect(docs.getAttribute("href")).toContain(DOCS_URL.toString());
    expect(docs).toHaveAttribute("target", "_blank");
  });

  test("Documentation is the first entry", () => {
    const entries: Array<HTMLElement> = openHelp();

    const texts: Array<string> = entries.map((entry: HTMLElement) => {
      return entry.textContent || "";
    });
    const docsIndex: number = texts.findIndex((text: string) => {
      return text.includes("Documentation");
    });
    const firstEntry: HTMLElement = screen
      .getByText("Documentation")
      .closest("a")!;
    expect(docsIndex).toBeGreaterThanOrEqual(0);
    // Nothing precedes it in document order.
    for (const entry of entries) {
      if (entry === firstEntry) {
        continue;
      }
      expect(
        firstEntry.compareDocumentPosition(entry) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  test("the entry closes the menu when used", () => {
    openHelp();

    fireEvent.click(screen.getByText("Documentation"));

    expect(screen.queryByText("Documentation")).toBeNull();
  });

  test("the label is translated (German)", () => {
    activeLocale = DE;
    render(<Help />);
    fireEvent.click(screen.getByRole("button"));

    const german: string = lookupNested(DE, "help.documentation")!;
    expect(german).toBeTruthy();
    expect(screen.getByText(german)).toBeInTheDocument();
  });
});
