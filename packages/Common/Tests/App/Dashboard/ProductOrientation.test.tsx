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
import GettingStarted, {
  HOW_ONEUPTIME_WORKS_LINE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/GettingStarted";
import { HOW_IT_WORKS_TITLE } from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HowOneUptimeWorks";
import {
  HOW_ONEUPTIME_WORKS_DESCRIPTION,
  HowOneUptimeWorksOpenedFrom,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HowOneUptimeWorksDialog";
import {
  HOW_IT_WORKS_LOOP,
  HowItWorksLoopStep,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HowOneUptimeWorksOverview";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import ProductKey from "../../../Types/Product/ProductKey";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import Help from "../../../../App/FeatureSet/Dashboard/src/Components/Header/Help";
import {
  WelcomeAudience,
  WelcomeStep,
} from "../../../Types/WelcomeChecklist/WelcomeChecklist";
import {
  WelcomeChecklistAnswer,
  getEmptyWelcomeChecklistAnswer,
} from "../../../Types/WelcomeChecklist/WelcomeChecklistAnswer";

/*
 * "OneUptime is vast and users get confused" — this suite pins the fixes that
 * orient a new user, by mounting the real components and reading them the
 * way a user would:
 *
 *  - the Products menu groups 42 products into small, named sections, with
 *    the core products first and in the order a problem flows through them,
 *    and opens on those core products alone: every other section is one
 *    line, opened with a click or found by searching;
 *  - Home opens How OneUptime works, which explains how the products fit
 *    together, from a line under the Welcome checklist's steps;
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

/*
 * The Welcome checklist is one server answer (issue #6803): it is answered
 * here, half done - the monitor reported, a second person joined.
 */
const welcomeFetchMock: MockFunction = getJestMockFunction();
const welcomePostMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/WelcomeChecklistApi",
  () => {
    return {
      __esModule: true,
      fetchWelcomeChecklist: (...args: Array<unknown>) => {
        return welcomeFetchMock(...args);
      },
      postWelcomeChecklist: (...args: Array<unknown>) => {
        return welcomePostMock(...args);
      },
      sendLegacyBrowserState: () => {
        return Promise.resolve(null);
      },
    };
  },
);

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

function welcomeAnswer(
  extra?: Partial<WelcomeChecklistAnswer>,
): WelcomeChecklistAnswer {
  return {
    ...getEmptyWelcomeChecklistAnswer(),
    audience: WelcomeAudience.SetUp,
    goals: [],
    canChooseGoals: true,
    steps: [
      {
        step: WelcomeStep.Monitor,
        isDone: true,
        needsPlan: null,
        isNext: false,
        gap: null,
      },
      {
        step: WelcomeStep.OnCall,
        isDone: false,
        needsPlan: null,
        isNext: true,
        gap: null,
      },
      {
        step: WelcomeStep.StatusPage,
        isDone: false,
        needsPlan: null,
        isNext: false,
        gap: null,
      },
      {
        step: WelcomeStep.Team,
        isDone: true,
        needsPlan: null,
        isNext: false,
        gap: null,
      },
    ],
    doneCount: 2,
    totalCount: 4,
    ...extra,
  };
}

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
  welcomeFetchMock.mockResolvedValue(welcomeAnswer());
  welcomePostMock.mockResolvedValue(welcomeAnswer({ isHiddenForMe: true }));
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  navigateMock.mockReset();
  countMock.mockReset();
  captureMock.mockReset();
  getCurrentProjectIdMock.mockReset();
  welcomeFetchMock.mockReset();
  welcomePostMock.mockReset();
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
      "Security",
      "AI",
      "Code",
      "Resources",
      "Infrastructure",
      "Cloud",
      "Dashboards & Automation",
      "Settings",
    ]);
  });

  /*
   * Issue #5550: Security Events and Data Security were filed under
   * Observability. Security is their own section, right below it.
   */
  test("Security holds Security Events and Data Security; Observability what you watch your systems with", () => {
    openProductsMenu();

    const sections: Array<MenuSection> = readMenuSections();
    expect(
      sections.find((section: MenuSection): boolean => {
        return section.heading === "Security";
      }),
    ).toEqual({
      heading: "Security",
      items: ["Security Events", "Data Security"],
    });
    expect(
      sections.find((section: MenuSection): boolean => {
        return section.heading === "Observability";
      }),
    ).toEqual({
      heading: "Observability",
      items: [
        "Logs",
        "Metrics",
        "Traces",
        "Profiles",
        "Exceptions",
        "AI / LLM",
        "Data Observability",
        "Topology",
      ],
    });
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
     * One item, Code: the repositories first, each repository's tasks
     * inside it - not Tasks plus Code Repositories.
     */
    expect(
      sections.find((section: MenuSection): boolean => {
        return section.heading === "Code";
      }),
    ).toEqual({ heading: "Code", items: ["Code"] });
  });

  test("the Code item says what it does, and that GitHub is connected there", () => {
    openProductsMenu();

    expect(optionFor("Code")).toHaveTextContent(
      "Ask AI to change your code and open pull requests. Connect GitHub here.",
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
     * Infrastructure lists one product per platform and was the longest
     * section: 13 since Storage Arrays joined Ceph there. App Platforms
     * would have made it 14, so what a cloud runs for you - Cloud, App
     * Platforms and Serverless - became a section of its own. Past 13,
     * split again rather than raising this.
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
        "On-Call",
        "Status Pages",
        "Scheduled Maintenance",
        "SLOs",
      ],
    });
  });

  test("Infrastructure lists what you run yourself, most common first", () => {
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
      "Proxmox",
      "OpenStack",
      "VMware",
      "Ceph",
      "Storage Arrays",
      "Network",
      "IoT",
    ]);
  });

  test("Cloud lists what a cloud runs for you: its accounts, the apps on its platforms, its functions", () => {
    openProductsMenu();

    const cloud: MenuSection = readMenuSections().find(
      (section: MenuSection): boolean => {
        return section.heading === "Cloud";
      },
    )!;

    expect(cloud.items).toEqual(["Cloud", "App Platforms", "Serverless"]);
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

  test("regrouping lost no product: all 47 are still listed exactly once", () => {
    openProductsMenu();

    const titles: Array<string> = readMenuSections().flatMap(
      (section: MenuSection): Array<string> => {
        return section.items;
      },
    );
    /*
     * 47: Code Repositories became a page of Tasks, Forms (which replaced
     * Incidents > Settings > Forms) became a product, Storage Arrays
     * joined Infrastructure, Data Security joined Observability, and App
     * Platforms took Cloud's environments. Moving Data Security and
     * Security Events to Security added none, Data Observability (#5647)
     * joined Observability as the 46th, and OpenStack (#5676) joined
     * Infrastructure as the 47th.
     */
    expect(titles).toHaveLength(47);
    expect(new Set(titles).size).toBe(47);
    expect(titles).toContain("App Platforms");
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
      "Security",
      "AI",
      "Code",
      "Resources",
      "Infrastructure",
      "Cloud",
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
      "On-Call",
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
      "12 products Hosts, Kubernetes, Docker, Docker Swarm, Podman, Proxmox, OpenStack, VMware, Ceph, Storage Arrays, Network, IoT",
    );
    expect(
      within(productsMenu()).getByRole("button", { name: "Cloud" }),
    ).toHaveAccessibleDescription(
      "3 products Cloud, App Platforms, Serverless",
    );
    expect(
      within(productsMenu()).getByRole("button", { name: "Code" }),
    ).toHaveAccessibleDescription("1 product Code");
    expect(
      within(productsMenu()).getByRole("button", { name: "Security" }),
    ).toHaveAccessibleDescription("2 products Security Events, Data Security");
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
    ["On-Call", "Who gets paged, and who is next if nobody answers."],
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
    expect(headings).toContain(lookupNested(DE, "navbar.categories.cloud"));
    expect(headings).toContain(lookupNested(DE, "navbar.categories.security"));
    expect(headings).not.toContain("navbar.categories.cloud");
    expect(headings).not.toContain("navbar.categories.infrastructure");
    expect(headings).not.toContain("navbar.categories.code");
    expect(headings).not.toContain("navbar.categories.security");
  });
});

describe("How OneUptime works (Home)", () => {
  /*
   * The checklist used to draw a strip of its own - four numbered products,
   * what fed them and a footnote - beside a dialog that tells the story at
   * length, so a newcomer met two shapes of it. Now one line under the
   * steps opens the dialog (#8995).
   */
  const line: () => HTMLElement = (): HTMLElement => {
    return screen.getByTestId(HOW_ONEUPTIME_WORKS_LINE_TEST_ID);
  };

  // Each time the dialog was asked to open, and from where.
  const opened: MockFunction = getJestMockFunction();
  const listener: (event: CustomEvent) => void = (event: CustomEvent): void => {
    opened(event.detail);
  };

  beforeEach(() => {
    opened.mockReset();
    GlobalEvents.addEventListener(EventName.HOW_ONEUPTIME_WORKS_OPEN, listener);
  });

  afterEach(() => {
    GlobalEvents.removeEventListener(
      EventName.HOW_ONEUPTIME_WORKS_OPEN,
      listener,
    );
  });

  test("the Getting Started card offers How OneUptime works in one line, under its steps", async () => {
    await renderGettingStarted();

    expect(line()).toHaveAccessibleName(HOW_IT_WORKS_TITLE);
    expect(line()).toHaveAccessibleDescription(HOW_ONEUPTIME_WORKS_DESCRIPTION);
    expect(line()).toHaveAttribute("aria-haspopup", "dialog");
    // Under the steps, and not one of them.
    const steps: HTMLElement = screen.getByTestId("getting-started-steps");
    expect(steps).not.toContainElement(line());
    expect(
      steps.compareDocumentPosition(line()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("the line opens the dialog, and the card tells no story of its own", async () => {
    await renderGettingStarted();

    const card: HTMLElement = screen.getByTestId("getting-started");
    // The strip's products and footnote were the older shape of the story.
    expect(within(card).queryByTestId("how-oneuptime-works")).toBeNull();
    expect(
      card.querySelector('[data-testid^="how-it-works-step-"]'),
    ).toBeNull();
    expect(card).not.toHaveTextContent("That is the core.");
    expect(card).not.toHaveTextContent("feed the loop");

    fireEvent.click(line());

    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledWith({
      from: HowOneUptimeWorksOpenedFrom.WelcomeChecklist,
    });
    // The dialog, not a product's page.
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("the products menu and How OneUptime works tell the core products in the same order", () => {
    /*
     * The Products menu's Essentials and the dialog's four steps tell the
     * same story; if someone reorders one, this makes them look at the
     * other.
     */
    jest.useRealTimers();
    jest.useFakeTimers();
    openProductsMenu();
    const essentials: Array<string> = readMenuSections()[0]!.items;

    const inTheMenu: Array<number> = [
      "Monitors",
      "Incidents",
      "On-Call",
      "Status Pages",
    ].map((title: string): number => {
      return essentials.indexOf(title);
    });
    const loop: Array<ProductKey> = HOW_IT_WORKS_LOOP.flatMap(
      (step: HowItWorksLoopStep): Array<ProductKey> => {
        return [...step.products];
      },
    );
    const inTheSteps: Array<number> = [
      ProductKey.Monitors,
      ProductKey.Incidents,
      ProductKey.OnCall,
      ProductKey.StatusPages,
    ].map((key: ProductKey): number => {
      return loop.indexOf(key);
    });

    for (const order of [inTheMenu, inTheSteps]) {
      expect(
        order.every((index: number) => {
          return index >= 0;
        }),
      ).toBe(true);
      expect(
        [...order].sort((a: number, b: number) => {
          return a - b;
        }),
      ).toEqual(order);
    }
  });

  test("hiding the checklist keeps How OneUptime works one click away (#6803)", async () => {
    await renderGettingStarted();
    expect(line()).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("getting-started-dismiss"));
    });

    expect(screen.queryByTestId("getting-started")).toBeNull();
    expect(screen.queryByTestId(HOW_ONEUPTIME_WORKS_LINE_TEST_ID)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("welcome-checklist-how-it-works"));
    });

    expect(opened).toHaveBeenCalledWith({
      from: HowOneUptimeWorksOpenedFrom.WelcomeChecklist,
    });
  });

  test("a fully set-up project does not see the line", async () => {
    welcomeFetchMock.mockResolvedValue(
      welcomeAnswer({ isFinished: true, steps: [] }),
    );
    await renderGettingStarted();

    expect(screen.queryByTestId(HOW_ONEUPTIME_WORKS_LINE_TEST_ID)).toBeNull();
    expect(screen.queryByTestId("getting-started")).toBeNull();
  });

  test("the line and the checklist are translated (German)", async () => {
    activeLocale = DE;
    await renderGettingStarted();

    const card: HTMLElement = screen.getByTestId("getting-started");
    for (const english of [
      HOW_IT_WORKS_TITLE,
      HOW_ONEUPTIME_WORKS_DESCRIPTION,
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
    expect(line()).toHaveAccessibleName(DE[HOW_IT_WORKS_TITLE] as string);
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

  test("the ways to learn come first, Documentation last among them", () => {
    openHelp();

    // In document order: the four ways to learn, then the ways to ask.
    const order: Array<string> = [
      "Quickstart",
      "How OneUptime works",
      "Glossary",
      "Documentation",
      "Keyboard shortcuts",
    ];
    const entries: Array<HTMLElement> = order.map((text: string) => {
      return screen.getByText(text).closest("a")!;
    });

    for (let i: number = 1; i < entries.length; i++) {
      expect(
        entries[i - 1]!.compareDocumentPosition(entries[i]!) &
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
