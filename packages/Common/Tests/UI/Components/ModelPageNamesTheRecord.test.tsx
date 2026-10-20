import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A record's pages said "Project > Monitors > View Monitor > Criteria" above
 * the page, and "OneUptime | Project - Monitors - View Monitor - Criteria" in
 * the browser tab, whichever monitor it was. With a few monitors open in a
 * few tabs, nothing told them apart, and the trail named a kind of page
 * rather than the place. ModelPage reads the record's name for its heading
 * already; it now hands it to the crumb that stands for the record, so the
 * trail and the tab say "Website: acme.com".
 *
 * The real ModelPage, Page and Breadcrumbs against a fake API. The product
 * analytics' page view keeps the page's own name: a record's name - a
 * customer's data - never goes there.
 */

const getItemMock: MockFunction = getJestMockFunction();
const captureMock: MockFunction = getJestMockFunction();

// Interface words in German, when a test asks for German.
const GERMAN: Record<string, string> = {
  Project: "Projekt",
  Monitors: "Monitore",
  "View Monitor": "Monitor ansehen",
  Criteria: "Kriterien",
  Monitor: "Monitor",
};

let isGerman: boolean = false;

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          if (isGerman && GERMAN[key]) {
            return GERMAN[key]!;
          }
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
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

import ModelPage from "../../../UI/Components/Page/ModelPage";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: string = "65f00000-0000-4000-8000-00000000aaaa";
const MONITOR_ID: string = "65f00000-0000-4000-8000-00000000bbbb";

const MONITOR_PAGE: string = `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}`;
const CRITERIA_PAGE: string = `${MONITOR_PAGE}/criteria`;

// The trail the Dashboard builds for a monitor's Criteria page.
function criteriaTrail(): Array<Link> {
  return [
    { title: "Project", to: new Route(`/dashboard/${PROJECT_ID}`) },
    { title: "Monitors", to: new Route(`/dashboard/${PROJECT_ID}/monitors`) },
    { title: "View Monitor", to: new Route(MONITOR_PAGE) },
    { title: "Criteria", to: new Route(CRITERIA_PAGE) },
  ];
}

// And for the monitor's own page.
function monitorTrail(): Array<Link> {
  return criteriaTrail().slice(0, 3);
}

function monitorNamed(name: string): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = new ObjectID(MONITOR_ID);
  monitor.name = name;
  monitor.labels = [];
  return monitor;
}

async function renderPageAt(
  pathname: string,
  trail: Array<Link>,
): Promise<void> {
  // The address bar, which tells the trail its current page.
  window.history.replaceState(null, "", pathname);

  await act(async () => {
    render(
      <ModelPage<Monitor>
        title="Monitor"
        modelType={Monitor}
        modelId={new ObjectID(MONITOR_ID)}
        modelNameField="name"
        breadcrumbLinks={trail}
      >
        <div data-testid="page-body">Body</div>
      </ModelPage>,
    );
  });
}

function trailText(): Array<string> {
  const nav: HTMLElement = screen.getByRole("navigation", {
    name: "Breadcrumb",
  });
  return within(nav)
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

function pageViews(): Array<string> {
  return captureMock.mock.calls
    .map((call: Array<unknown>): string => {
      return String(call[0]);
    })
    .filter((event: string): boolean => {
      return event.startsWith("Page View:");
    });
}

beforeEach(() => {
  isGerman = false;
  document.title = "OneUptime";
});

afterEach(() => {
  cleanup();
  getItemMock.mockReset();
  captureMock.mockReset();
  window.history.replaceState(null, "", "/");
});

describe("once the record is read, the trail names it", () => {
  test("on a page below the record: Project > Monitors > its name > Criteria", async () => {
    getItemMock.mockResolvedValue(monitorNamed("Website: acme.com"));
    await renderPageAt(CRITERIA_PAGE, criteriaTrail());

    expect(trailText()).toEqual([
      "Project",
      "Monitors",
      "Website: acme.com",
      "Criteria",
    ]);
    expect(screen.queryByText("View Monitor")).toBeNull();
  });

  test("the named crumb still opens the record's own page", async () => {
    getItemMock.mockResolvedValue(monitorNamed("Website: acme.com"));
    await renderPageAt(CRITERIA_PAGE, criteriaTrail());

    const crumb: HTMLElement = screen
      .getByTestId("breadcrumb-record-name")
      .closest("a") as HTMLElement;
    expect(crumb).toHaveAttribute("href", MONITOR_PAGE);
  });

  test("on the record's own page, the last crumb is its name, and not a link", async () => {
    getItemMock.mockResolvedValue(monitorNamed("Website: acme.com"));
    await renderPageAt(MONITOR_PAGE, monitorTrail());

    expect(trailText()).toEqual(["Project", "Monitors", "Website: acme.com"]);
    // The page the reader is on is text, not a link to itself.
    expect(
      screen.getByTestId("breadcrumb-record-name").closest("a"),
    ).toBeNull();
  });

  test("the heading still reads Monitor - its name", async () => {
    getItemMock.mockResolvedValue(monitorNamed("Website: acme.com"));
    await renderPageAt(CRITERIA_PAGE, criteriaTrail());

    expect(
      screen.getByRole("heading", { name: "Monitor - Website: acme.com" }),
    ).toBeInTheDocument();
  });

  test("a long name is cut short to a line, with the whole of it on hover", async () => {
    const longName: string =
      "Checkout API in eu-west-1 behind the payment gateway, timing out for some customers on mobile";
    getItemMock.mockResolvedValue(monitorNamed(longName));
    await renderPageAt(CRITERIA_PAGE, criteriaTrail());

    const name: HTMLElement = screen.getByTestId("breadcrumb-record-name");
    expect(name).toHaveTextContent(longName);
    expect(name).toHaveAttribute("title", longName);
    expect(name).toHaveClass("truncate", "max-w-xs");
  });
});

describe("the browser tab says which record it is", () => {
  test("its title carries the name where the trail does", async () => {
    getItemMock.mockResolvedValue(monitorNamed("Website: acme.com"));
    await renderPageAt(CRITERIA_PAGE, criteriaTrail());

    expect(document.title).toBe(
      "OneUptime | Project - Monitors - Website: acme.com - Criteria",
    );
  });

  test("two monitors' tabs no longer read the same", async () => {
    getItemMock.mockResolvedValue(monitorNamed("Website: acme.com"));
    await renderPageAt(MONITOR_PAGE, monitorTrail());
    const first: string = document.title;
    cleanup();

    getItemMock.mockResolvedValue(monitorNamed("API: payments"));
    await renderPageAt(MONITOR_PAGE, monitorTrail());

    expect(first).toBe("OneUptime | Project - Monitors - Website: acme.com");
    expect(document.title).toBe(
      "OneUptime | Project - Monitors - API: payments",
    );
  });
});

describe("the product analytics keep the page's own name", () => {
  test("the page view says View Monitor, never the record's name", async () => {
    getItemMock.mockResolvedValue(monitorNamed("Website: acme.com"));
    await renderPageAt(CRITERIA_PAGE, criteriaTrail());

    expect(pageViews().length).toBeGreaterThan(0);
    for (const event of pageViews()) {
      expect(event).toBe(
        "Page View: Project > Monitors > View Monitor > Criteria",
      );
      expect(event).not.toContain("acme");
    }
  });
});

describe("a record's name is drawn as typed", () => {
  test("in German, the interface words are German and the name is not translated", async () => {
    isGerman = true;
    // A monitor named like an interface word.
    getItemMock.mockResolvedValue(monitorNamed("Monitors"));
    await renderPageAt(CRITERIA_PAGE, criteriaTrail());

    expect(trailText()).toEqual([
      "Projekt",
      "Monitore",
      "Monitors",
      "Kriterien",
    ]);
    expect(document.title).toBe(
      "OneUptime | Projekt - Monitore - Monitors - Kriterien",
    );
  });
});

describe("until the name is known, the trail says what it always said", () => {
  test("while the record is being read", async () => {
    getItemMock.mockReturnValue(new Promise<Monitor>(() => {}));
    await renderPageAt(CRITERIA_PAGE, criteriaTrail());

    expect(trailText()).toEqual([
      "Project",
      "Monitors",
      "View Monitor",
      "Criteria",
    ]);
    expect(screen.queryByTestId("breadcrumb-record-name")).toBeNull();
  });

  test("when the record could not be read, the tab names no record", async () => {
    getItemMock.mockResolvedValue(null);
    await renderPageAt(CRITERIA_PAGE, criteriaTrail());

    expect(document.title).toBe(
      "OneUptime | Project - Monitors - View Monitor - Criteria",
    );
  });

  test("a trail whose crumbs do not lead to the record is left alone", async () => {
    getItemMock.mockResolvedValue(monitorNamed("Website: acme.com"));
    await renderPageAt(CRITERIA_PAGE, [
      { title: "Project", to: new Route(`/dashboard/${PROJECT_ID}`) },
      { title: "Monitors", to: new Route(`/dashboard/${PROJECT_ID}/monitors`) },
      { title: "Criteria", to: new Route(CRITERIA_PAGE) },
    ]);

    expect(trailText()).toEqual(["Project", "Monitors", "Criteria"]);
    expect(screen.queryByTestId("breadcrumb-record-name")).toBeNull();
  });
});
