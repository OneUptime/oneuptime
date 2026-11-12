import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { CheckOn } from "../../../Types/Monitor/CriteriaFilter";
import ExternalStatusPageMonitorResponse, {
  ExternalStatusPageComponentStatus,
} from "../../../Types/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorResponse";
import ExternalStatusPageProviderType from "../../../Types/Monitor/ExternalStatusPageProviderType";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import ExternalStatusPageMonitorView, {
  EXTERNAL_STATUS_PAGE_ERROR_TEST_ID,
  EXTERNAL_STATUS_PAGE_OUTSIDE_INCIDENTS_TEST_ID,
  EXTERNAL_STATUS_PAGE_OVERALL_STATUS_TEST_ID,
  EXTERNAL_STATUS_PAGE_UNMATCHED_TEST_ID,
  getComponentDescription,
  getActiveIncidentsText,
  getFailureCause,
  getWatchedComponentNames,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/ExternalStatusPageMonitorView";
import SummaryInfo from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryInfo";
import {
  EXTERNAL_STATUS_PAGE_ONEUPTIME_IP_NOT_ALLOWED_MESSAGE,
  EXTERNAL_STATUS_PAGE_ONEUPTIME_NOT_MONITORED,
  EXTERNAL_STATUS_PAGE_ONEUPTIME_PRIVATE_MESSAGE,
  EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN,
  EXTERNAL_STATUS_PAGE_ONEUPTIME_UNDER_MAINTENANCE_OF,
} from "../../../Utils/Monitor/ExternalStatusPageReading";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * What one check of an external status page found, as the monitor's
 * Summary, Test Monitor's result and Monitoring Logs draw it
 * (SummaryView/ExternalStatusPageMonitorView): the check's facts, why it
 * failed when it did, what the page said, and each component in scope -
 * its status in the words of the Component Status criteria's Value
 * dropdown, never the raw value ("under_maintenance") the criteria compare.
 *
 * Issue #5176's OneUptime status page provider is the case it is drawn
 * for: a resource under maintenance, groups nested as "Core / Databases",
 * a status the page hides, and a page that went private. The layout a
 * browser draws - two facts to a row, four in a wide dialog - is checked
 * in packages/E2E/MonitorOverview/ExternalStatusPageMonitor.spec.ts; here,
 * that the classes asking for it are there.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const DE: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "de.json"), "utf8"),
) as Record<string, string>;

const MONITORED_AT: Date = new Date("2026-10-20T09:30:00.000Z");

const PRIVATE_PAGE_MESSAGE: string =
  "This status page is private: only people who sign in to it, or who know its password, can read it. Only a public status page can be watched.";

const DROPDOWN: Array<DropdownOption> =
  CriteriaFilterUtil.getDropdownOptionsByCheckOn({
    checkOn: CheckOn.ExternalStatusPageComponentStatus,
  });

const CORE_COMPONENTS: Array<ExternalStatusPageComponentStatus> = [
  {
    name: "Checkout API",
    status: "operational",
    description: "Operational",
    groupName: "Core / APIs",
  },
  {
    name: "Orders database",
    status: "under_maintenance",
    description: "Under maintenance: Database upgrade",
    groupName: "Core / Databases",
  },
];

function pageResponse(
  overrides: Partial<ExternalStatusPageMonitorResponse> = {},
): ExternalStatusPageMonitorResponse {
  return {
    isOnline: true,
    overallStatus: "under_maintenance",
    componentStatuses: CORE_COMPONENTS,
    activeIncidentCount: 0,
    responseTimeInMs: 411.6,
    failureCause: "",
    provider: ExternalStatusPageProviderType.OneUptime,
    componentGroupName: "Core",
    ...overrides,
  };
}

function probeResponse(
  response: ExternalStatusPageMonitorResponse,
): ProbeMonitorResponse {
  return {
    projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    monitorId: new ObjectID("22222222-2222-4222-8222-222222222222"),
    monitorStepId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    probeId: new ObjectID("44444444-4444-4444-8444-444444444444"),
    isOnline: response.isOnline,
    responseTimeInMs: response.responseTimeInMs,
    failureCause: response.failureCause,
    monitoredAt: MONITORED_AT,
    externalStatusPageResponse: response,
  } as ProbeMonitorResponse;
}

function renderView(
  response: ExternalStatusPageMonitorResponse = pageResponse(),
): void {
  render(
    <ExternalStatusPageMonitorView
      probeMonitorResponse={probeResponse(response)}
      probeName="Frankfurt (eu-central-1)"
    />,
  );
}

// The titles of a facts grid's cards, in order.
function factTitles(testId: string): Array<string> {
  return Array.from(screen.getByTestId(testId).children).map(
    (card: Element): string => {
      return (card.firstElementChild?.textContent || "").trim();
    },
  );
}

// A fact's value: the card's last child.
function factValue(testId: string, index: number): HTMLElement {
  return screen.getByTestId(testId).children[index]!
    .lastElementChild as HTMLElement;
}

function statusTexts(): Array<string> {
  return screen
    .getAllByTestId("external-status-page-component-status")
    .map((status: HTMLElement): string => {
      return (status.textContent || "").trim();
    });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      ar: { translation: readDashboardLocale("ar") },
      fa: { translation: readDashboardLocale("fa") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("a component's status", () => {
  test("reads as the Component Status criteria's Value dropdown words it, each value its own", () => {
    renderView(
      pageResponse({
        componentStatuses: DROPDOWN.map(
          (
            option: DropdownOption,
            index: number,
          ): ExternalStatusPageComponentStatus => {
            return {
              name: `Resource ${index + 1}`,
              status: option.value.toString(),
            };
          },
        ),
      }),
    );

    expect(statusTexts()).toEqual(
      DROPDOWN.map((option: DropdownOption): string => {
        return option.label;
      }),
    );
    expect(
      screen
        .getAllByTestId("external-status-page-component-status")
        .map((status: HTMLElement): string | null => {
          return status.getAttribute("data-status");
        }),
    ).toEqual(
      DROPDOWN.map((option: DropdownOption): string => {
        return option.value.toString();
      }),
    );
    // The list never shows a value the way the criteria store it.
    expect(
      within(screen.getByTestId("external-status-page-components")).queryByText(
        "under_maintenance",
        { exact: false },
      ),
    ).not.toBeInTheDocument();
  });

  test("a status the page hides reads Unknown; any other word a provider uses reads as a word", () => {
    renderView(
      pageResponse({
        componentStatuses: [
          { name: "Internal admin", status: "unknown" },
          { name: "Feed item", status: "incident" },
          { name: "Odd one", status: "on_fire_again" },
          { name: "Blank", status: "" },
        ],
      }),
    );

    expect(statusTexts()).toEqual([
      "Unknown",
      "Incident",
      "On fire again",
      "Unknown",
    ]);
  });

  test("each status is announced as a status", () => {
    renderView();

    const list: HTMLElement = screen.getByTestId(
      "external-status-page-components",
    );

    expect(
      within(list).getByRole("status", { name: "Status: Under Maintenance" }),
    ).toBeInTheDocument();
    expect(
      within(list).getByRole("status", { name: "Status: Operational" }),
    ).toBeInTheDocument();
    // The page's overall status is announced the same way, once.
    expect(
      screen.getAllByRole("status", { name: "Status: Under Maintenance" }),
    ).toHaveLength(2);
  });
});

describe("the components in scope", () => {
  test("keep the page's order, in a list named by its heading", () => {
    renderView();

    const list: HTMLElement = screen.getByRole("list", {
      name: "Component Statuses",
    });

    expect(
      within(list)
        .getAllByTestId("external-status-page-component-name")
        .map((name: HTMLElement): string => {
          return name.textContent || "";
        }),
    ).toEqual(["Checkout API", "Orders database"]);
    expect(statusTexts()).toEqual(["Operational", "Under Maintenance"]);
  });

  test("say their group and what the page says, unless that only repeats the status", () => {
    renderView(
      pageResponse({
        componentStatuses: [
          ...CORE_COMPONENTS,
          // The page's own word for an outage says something: it stays.
          {
            name: "Payments webhooks",
            status: "major_outage",
            description: "Offline",
          },
          // Only the status again, in other casing: said once.
          {
            name: "Search",
            status: "degraded_performance",
            description: "degraded performance",
          },
          // Nothing to add at all.
          { name: "Email delivery", status: "operational" },
        ],
      }),
    );

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "external-status-page-component",
    );

    expect(
      rows.map((row: HTMLElement): string | null => {
        return (
          within(row).queryByTestId("external-status-page-component-detail")
            ?.textContent || null
        );
      }),
    ).toEqual([
      "Core / APIs",
      "Core / Databases · Under maintenance: Database upgrade",
      "Offline",
      null,
      null,
    ]);
  });

  test("put each status at the row's end from sm up, and under the name on a phone", () => {
    renderView();

    const row: HTMLElement = screen.getAllByTestId(
      "external-status-page-component",
    )[0]!;

    expect(row).toHaveClass(
      "flex",
      "flex-col",
      "sm:flex-row",
      "sm:justify-between",
    );
    expect(
      within(row).getByTestId("external-status-page-component-name"),
    ).toHaveClass("break-words");
  });

  test("a page that reports none draws no list", () => {
    renderView(pageResponse({ componentStatuses: [] }));

    expect(
      screen.queryByTestId("external-status-page-components"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Component Statuses")).not.toBeInTheDocument();
  });
});

describe("the facts", () => {
  test("first the check, then what the page said", () => {
    renderView();

    expect(factTitles("external-status-page-check-facts")).toEqual([
      "Probe",
      "Status",
      "Response Time",
      "Monitored At",
    ]);
    expect(factTitles("external-status-page-page-facts")).toEqual([
      "Provider",
      "Overall Status",
      "Active Incidents",
      "Scope",
    ]);

    expect(factValue("external-status-page-check-facts", 0)).toHaveTextContent(
      "Frankfurt (eu-central-1)",
    );
    expect(factValue("external-status-page-check-facts", 1)).toHaveTextContent(
      "Online",
    );
    expect(factValue("external-status-page-check-facts", 2)).toHaveTextContent(
      "412 ms",
    );
    expect(factValue("external-status-page-page-facts", 0)).toHaveTextContent(
      "OneUptime Status Page",
    );
    expect(factValue("external-status-page-page-facts", 2)).toHaveTextContent(
      "0",
    );
    expect(factValue("external-status-page-page-facts", 3)).toHaveTextContent(
      "Group: Core",
    );
  });

  /*
   * The overall status reads like the components' statuses under it (#5281):
   * it was the value the probe reports - "under_maintenance" - above a
   * component that read "Under Maintenance". The value the criteria compare
   * stays on the element (data-status), as on each component's.
   */
  test("the overall status reads in the components' words and colour, never the value a check reports", () => {
    renderView(pageResponse({ overallStatus: "degraded_performance" }));

    const value: HTMLElement = factValue("external-status-page-page-facts", 1);
    const overall: HTMLElement = within(value).getByTestId(
      EXTERNAL_STATUS_PAGE_OVERALL_STATUS_TEST_ID,
    );

    expect(value).toHaveTextContent("Degraded Performance");
    expect(value.textContent).not.toContain("_");
    expect(overall).toHaveAttribute("data-status", "degraded_performance");
    expect(within(overall).getByRole("status")).toHaveAttribute(
      "aria-label",
      "Status: Degraded Performance",
    );
    expect(
      within(overall).getByTestId("status-bubble-dot"),
    ).toBeInTheDocument();
  });

  test("the overall status and a component with the same status read alike", () => {
    renderView();

    const value: HTMLElement = factValue("external-status-page-page-facts", 1);
    const maintenance: HTMLElement = screen
      .getAllByTestId("external-status-page-component-status")
      .find((element: HTMLElement): boolean => {
        return element.getAttribute("data-status") === "under_maintenance";
      })!;

    expect(value).toHaveTextContent("Under Maintenance");
    expect(maintenance).toHaveTextContent("Under Maintenance");
    // The same dot colour: the overall status is a status bubble too.
    const dotColor: (element: HTMLElement) => string = (
      element: HTMLElement,
    ): string => {
      return (
        within(element)
          .getByTestId("status-bubble-dot")
          .querySelector("span") as HTMLElement
      ).style.backgroundColor;
    };
    expect(dotColor(value)).toBe(dotColor(maintenance));
    expect(dotColor(value)).not.toBe("");
  });

  test("an overall status in a page's own words, such as a Statuspage's, reads as written", () => {
    renderView(
      pageResponse({
        overallStatus: "All Systems Operational",
        provider: ExternalStatusPageProviderType.AtlassianStatuspage,
      }),
    );

    const value: HTMLElement = factValue("external-status-page-page-facts", 1);

    expect(value).toHaveTextContent("All Systems Operational");
    expect(
      within(value).getByTestId(EXTERNAL_STATUS_PAGE_OVERALL_STATUS_TEST_ID),
    ).toHaveAttribute("data-status", "All Systems Operational");
  });

  test("the reachability check's answer reads Reachable, and no overall status reads a dash", () => {
    renderView(pageResponse({ overallStatus: "reachable" }));

    expect(factValue("external-status-page-page-facts", 1)).toHaveTextContent(
      "Reachable",
    );

    cleanup();
    renderView(pageResponse({ overallStatus: "" }));

    const empty: HTMLElement = factValue("external-status-page-page-facts", 1);
    expect(empty.textContent).toBe("-");
    expect(
      within(empty).queryByTestId(EXTERNAL_STATUS_PAGE_OVERALL_STATUS_TEST_ID),
    ).toBeNull();
  });

  test.each([
    // A check by a probe that has not been upgraded: its one filter.
    [
      { componentGroupName: "Core", componentName: "Checkout" },
      "Core › Checkout",
    ],
    [{ componentGroupName: "Core" }, "Group: Core"],
    [{ componentName: "Checkout" }, "Component: Checkout"],
    [{}, "All components"],
    // Issue #5156: the components the monitor chose.
    [{ componentNames: [] }, "All components"],
    [{ componentGroupName: "Core", componentNames: [] }, "Group: Core"],
    [{ componentNames: ["Checkout API"] }, "Component: Checkout API"],
    [
      { componentGroupName: "Core", componentNames: ["Checkout API"] },
      "Core › Checkout API",
    ],
    [
      { componentNames: ["Checkout API", "Orders database", "Payments"] },
      "3 chosen components",
    ],
    [
      {
        componentGroupName: "Core",
        componentNames: ["Checkout API", "Orders database"],
      },
      "Core › 2 chosen components",
    ],
    // The list wins over the one name an older probe would read.
    [
      { componentNames: ["*Checkout*"], componentName: "Checkout" },
      "Component: *Checkout*",
    ],
  ])(
    "the scope of %p reads %p",
    (
      scope: {
        componentGroupName?: string;
        componentName?: string;
        componentNames?: Array<string>;
      },
      expected: string,
    ) => {
      renderView(
        pageResponse({
          componentGroupName: scope.componentGroupName,
          componentName: scope.componentName,
          componentNames: scope.componentNames,
        }),
      );

      expect(factValue("external-status-page-page-facts", 3)).toHaveTextContent(
        expected,
      );
    },
  );

  /*
   * The page's names are its own words, each drawn in its own direction: on
   * a Persian page an English group name took the count after it into its
   * run ("2 › Core", then the sentence). The count and the sentence stay
   * outside them.
   */
  test("draws the group's and the components' names each in its own direction, the count outside them", () => {
    renderView(
      pageResponse({
        componentGroupName: "Core",
        componentNames: ["Checkout API", "Orders database"],
      }),
    );

    const value: HTMLElement = factValue("external-status-page-page-facts", 3);
    const isolated: Array<string> = Array.from(
      value.querySelectorAll("bdi"),
    ).map((element: Element): string => {
      return element.textContent || "";
    });

    expect(isolated).toEqual(["Core"]);
    expect(value).toHaveTextContent("Core › 2 chosen components");

    cleanup();
    renderView(
      pageResponse({
        componentGroupName: "Core",
        componentNames: ["Checkout API"],
      }),
    );

    expect(
      Array.from(
        factValue("external-status-page-page-facts", 3).querySelectorAll("bdi"),
      ).map((element: Element): string => {
        return element.textContent || "";
      }),
    ).toEqual(["Core", "Checkout API"]);

    cleanup();
    renderView(
      pageResponse({
        componentGroupName: undefined,
        componentNames: ["Checkout API"],
      }),
    );

    const component: HTMLElement = factValue(
      "external-status-page-page-facts",
      3,
    );

    expect(component).toHaveTextContent("Component: Checkout API");
    expect(component.querySelector("bdi")).toHaveTextContent("Checkout API");
  });

  test("what a check watched: its chosen components, else its one filter, else the whole page", () => {
    expect(
      getWatchedComponentNames(
        pageResponse({ componentNames: ["A", "B"], componentName: "A" }),
      ),
    ).toEqual(["A", "B"]);
    expect(
      getWatchedComponentNames(pageResponse({ componentName: "Checkout" })),
    ).toEqual(["Checkout"]);
    expect(getWatchedComponentNames(pageResponse())).toEqual([]);
    expect(getWatchedComponentNames(undefined)).toEqual([]);
  });

  /*
   * One a row on a phone, two to a row from 22rem, four once the view
   * itself is 64rem wide: it is drawn in the overview's Summary card and in
   * wide dialogs at one screen width, so its own width decides. Values get
   * a smaller size below 32rem.
   */
  test("sit one a row on a phone, two to a row, four in a wide view, by the view's own width", () => {
    renderView();

    expect(screen.getByTestId("external-status-page-summary")).toHaveClass(
      "[container-type:inline-size]",
    );

    for (const testId of [
      "external-status-page-check-facts",
      "external-status-page-page-facts",
    ]) {
      expect(screen.getByTestId(testId)).toHaveClass(
        "flex",
        "flex-wrap",
        "gap-3",
      );
      expect(screen.getByTestId(testId)).not.toHaveClass("lg:grid-cols-4");

      for (const fact of Array.from(
        screen.getByTestId(testId).children,
      ) as Array<HTMLElement>) {
        expect(fact).toHaveClass(
          "grow",
          "basis-full",
          "[@container(min-width:22rem)]:basis-[calc(50%-0.75rem)]",
          "[@container(min-width:64rem)]:basis-[calc(25%-0.75rem)]",
        );
      }
    }

    expect(factValue("external-status-page-page-facts", 1)).toHaveClass(
      "text-sm",
      "break-words",
      "[@container(min-width:32rem)]:text-base",
    );
  });
});

/*
 * Issue #5156: a monitor that watches some components of a page counts
 * only their incidents. The summary says how many more the page has, so a
 * quiet monitor during an outage elsewhere reads as one that left it out,
 * and names the chosen components the page does not list.
 */
describe("what the scope leaves out", () => {
  test("the incidents on the page it did not count, under the count", () => {
    renderView(
      pageResponse({
        componentNames: ["Checkout API"],
        activeIncidentCount: 1,
        incidentsOutsideScopeCount: 2,
      }),
    );

    const value: HTMLElement = factValue("external-status-page-page-facts", 2);

    expect(value.textContent?.startsWith("1")).toBe(true);
    expect(
      within(value).getByTestId(EXTERNAL_STATUS_PAGE_OUTSIDE_INCIDENTS_TEST_ID),
    ).toHaveTextContent("2 more on the page, not counted");
  });

  test("none left out: the count alone", () => {
    renderView(pageResponse({ activeIncidentCount: 3 }));

    expect(
      screen.queryByTestId(EXTERNAL_STATUS_PAGE_OUTSIDE_INCIDENTS_TEST_ID),
    ).toBeNull();
    expect(factValue("external-status-page-page-facts", 2).textContent).toBe(
      "3",
    );
  });

  test("the chosen components the page does not list are named, after the page's facts", () => {
    renderView(
      pageResponse({
        componentNames: ["Checkout API", "Payments", "*Kubernetes*"],
        unmatchedComponentNames: ["Payments", "*Kubernetes*"],
      }),
    );

    const warning: HTMLElement = screen.getByTestId(
      EXTERNAL_STATUS_PAGE_UNMATCHED_TEST_ID,
    );

    // The monitor watches the Core group: the names are missing from it.
    expect(warning).toHaveTextContent(
      "Not in Core, so not watched: Payments, *Kubernetes*",
    );
    expect(
      screen
        .getByTestId("external-status-page-page-facts")
        .compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  /*
   * Icon draws a div: inside a paragraph it is markup a browser may not
   * keep, and React warned "validateDOMNesting" on every Summary, Test
   * Monitor result and View Summary that named a missing component.
   */
  test("the warning is no paragraph holding a div, and React warns of no nesting", () => {
    const consoleError: Mock<(...args: Array<unknown>) => void> =
      jest.fn<(...args: Array<unknown>) => void>();

    jest.spyOn(console, "error").mockImplementation(consoleError);

    try {
      renderView(
        pageResponse({
          componentNames: ["Checkout API", "Payments"],
          unmatchedComponentNames: ["Payments"],
        }),
      );

      const warning: HTMLElement = screen.getByTestId(
        EXTERNAL_STATUS_PAGE_UNMATCHED_TEST_ID,
      );

      expect(warning.tagName).toBe("DIV");
      expect(
        screen
          .getByTestId("external-status-page-summary")
          .querySelectorAll("p div"),
      ).toHaveLength(0);
      expect(
        consoleError.mock.calls.filter((args: Array<unknown>): boolean => {
          return args.some((arg: unknown): boolean => {
            return String(arg).includes("validateDOMNesting");
          });
        }),
      ).toEqual([]);
    } finally {
      jest.restoreAllMocks();
    }
  });

  /*
   * A name the page lists in another group is on the page all the same:
   * with a group set, the warning says the names are missing from the
   * group; with none, from the page. The group's and the names' words are
   * the page's, each isolated (a bdi), so a right-to-left sentence keeps
   * them whole.
   */
  test("says where the names are missing from: the group with one set, else the page", () => {
    renderView(
      pageResponse({
        componentGroupName: "Europe (Frankfurt)",
        componentNames: ["Checkout API", "Payments API"],
        unmatchedComponentNames: ["Payments API"],
      }),
    );

    const inGroup: HTMLElement = screen.getByTestId(
      EXTERNAL_STATUS_PAGE_UNMATCHED_TEST_ID,
    );

    expect(inGroup).toHaveTextContent(
      "Not in Europe (Frankfurt), so not watched: Payments API",
    );
    expect(
      Array.from(inGroup.querySelectorAll("bdi")).map(
        (bdi: Element): string => {
          return bdi.textContent || "";
        },
      ),
    ).toEqual(["Europe (Frankfurt)", "Payments API"]);

    cleanup();

    renderView(
      pageResponse({
        componentGroupName: undefined,
        componentNames: ["Checkout API", "Payments API", "Webhook"],
        unmatchedComponentNames: ["Payments API", "Webhook"],
      }),
    );

    const onPage: HTMLElement = screen.getByTestId(
      EXTERNAL_STATUS_PAGE_UNMATCHED_TEST_ID,
    );

    expect(onPage).toHaveTextContent(
      "Not on this page, so not watched: Payments API, Webhook",
    );
    expect(
      Array.from(onPage.querySelectorAll("bdi")).map((bdi: Element): string => {
        return bdi.textContent || "";
      }),
    ).toEqual(["Payments API, Webhook"]);
  });

  test("every chosen component on the page: no warning", () => {
    renderView(
      pageResponse({
        componentNames: ["Checkout API"],
        unmatchedComponentNames: [],
      }),
    );

    expect(
      screen.queryByTestId(EXTERNAL_STATUS_PAGE_UNMATCHED_TEST_ID),
    ).toBeNull();
  });
});

describe("a check that failed", () => {
  test("says why between the check's facts and the page's, and lists nothing", () => {
    renderView(
      pageResponse({
        isOnline: false,
        overallStatus: "unknown",
        componentStatuses: [],
        failureCause: PRIVATE_PAGE_MESSAGE,
        provider: undefined,
      }),
    );

    const summary: HTMLElement = screen.getByTestId(
      "external-status-page-summary",
    );
    const error: HTMLElement = screen.getByText(PRIVATE_PAGE_MESSAGE);
    const checkFacts: HTMLElement = screen.getByTestId(
      "external-status-page-check-facts",
    );
    const pageFacts: HTMLElement = screen.getByTestId(
      "external-status-page-page-facts",
    );
    const children: Array<Element> = Array.from(summary.children);
    const errorCard: Element = children.find((child: Element): boolean => {
      return child.contains(error);
    })!;

    expect(children.indexOf(checkFacts)).toBe(0);
    expect(children.indexOf(errorCard)).toBe(1);
    expect(children.indexOf(pageFacts)).toBe(2);
    expect(factValue("external-status-page-check-facts", 1)).toHaveTextContent(
      "Offline",
    );
    expect(
      screen.queryByTestId("external-status-page-components"),
    ).not.toBeInTheDocument();
  });
});

describe("the summary every page draws", () => {
  test("SummaryInfo draws this view for an External Status Page monitor, with the probe's name", () => {
    render(
      <SummaryInfo
        monitorType={MonitorType.ExternalStatusPage}
        probeMonitorResponses={[probeResponse(pageResponse())]}
        probeName="Singapore (ap-southeast-1)"
      />,
    );

    expect(
      screen.getByTestId("external-status-page-summary"),
    ).toBeInTheDocument();
    expect(factValue("external-status-page-check-facts", 0)).toHaveTextContent(
      "Singapore (ap-southeast-1)",
    );
    expect(statusTexts()).toEqual(["Operational", "Under Maintenance"]);
  });
});

describe("in German", () => {
  beforeAll(async () => {
    await i18next.changeLanguage("de");
  });

  afterAll(async () => {
    await i18next.changeLanguage("en");
  });

  test("the statuses, the scope and the list's heading read in German", () => {
    renderView();

    expect(statusTexts()).toEqual([DE["Operational"], DE["Under Maintenance"]]);
    expect(statusTexts()).toEqual(["Betriebsbereit", "In Wartung"]);
    expect(factValue("external-status-page-page-facts", 3)).toHaveTextContent(
      DE["Group: {{group}}"]!.replace("{{group}}", "Core"),
    );
    expect(
      screen.getByRole("list", { name: DE["Component Statuses"]! }),
    ).toBeInTheDocument();
  });

  test("names missing from the group: the German sentence, the group and the names isolated in it", () => {
    renderView(
      pageResponse({
        componentNames: ["Checkout API", "Payments API"],
        unmatchedComponentNames: ["Payments API"],
      }),
    );

    expect(
      screen.getByTestId(EXTERNAL_STATUS_PAGE_UNMATCHED_TEST_ID),
    ).toHaveTextContent(
      DE["Not in {{group}}, so not watched: {{names}}"]!.replace(
        "{{group}}",
        "Core",
      ).replace("{{names}}", "Payments API"),
    );
    expect(DE["Not in {{group}}, so not watched: {{names}}"]).toBe(
      "Nicht in {{group}}, daher nicht überwacht: {{names}}",
    );
  });

  test("chosen components of a group: the German sentence, with the group's name isolated in it", () => {
    renderView(
      pageResponse({
        componentGroupName: "Core",
        componentNames: ["Checkout API", "Orders database"],
      }),
    );

    const value: HTMLElement = factValue("external-status-page-page-facts", 3);

    expect(value).toHaveTextContent(
      DE["{{group}} › {{count}} chosen components"]!.replace(
        "{{group}}",
        "Core",
      ).replace("{{count}}", "2"),
    );
    expect(value).toHaveTextContent("Core › 2 ausgewählte Komponenten");
    expect(value.querySelector("bdi")).toHaveTextContent("Core");
  });

  test("the page's overall status reads in German too, never the value a check reports", () => {
    renderView();

    const value: HTMLElement = factValue("external-status-page-page-facts", 1);

    expect(value).toHaveTextContent(DE["Under Maintenance"]!);
    expect(value).toHaveTextContent("In Wartung");
    expect(value.textContent).not.toContain("under_maintenance");

    cleanup();
    renderView(pageResponse({ overallStatus: "reachable" }));

    expect(factValue("external-status-page-page-facts", 1)).toHaveTextContent(
      DE["Reachable"]!,
    );
    expect(DE["Reachable"]).toBe("Erreichbar");
  });

  test("a whole page in scope says so in German", () => {
    renderView(pageResponse({ componentGroupName: undefined }));

    expect(factValue("external-status-page-page-facts", 3)).toHaveTextContent(
      DE["All components"]!,
    );
  });

  /*
   * Two cards to a row on a phone leave a long German title, in capitals
   * spaced wide, no room on one line: GELTUNGSBEREICH ran past its card.
   * The facts say which language they are in, so the browser hyphenates
   * the title by that language's rules (GELTUNGS-BEREICH); where it cannot,
   * the title still breaks inside the word rather than run out.
   */
  test("the facts name their language, so a long title hyphenates instead of running out of its card", () => {
    renderView();

    for (const testId of [
      "external-status-page-check-facts",
      "external-status-page-page-facts",
    ]) {
      const grid: HTMLElement = screen.getByTestId(testId);

      expect(grid).toHaveAttribute("lang", "de");

      for (const card of Array.from(grid.children)) {
        expect(card).toHaveClass(
          "[&_label]:hyphens-auto",
          "[&_label]:[overflow-wrap:anywhere]",
        );
      }
    }
  });
});

describe("in English", () => {
  test("the facts say they are in English", () => {
    renderView();

    expect(
      screen.getByTestId("external-status-page-page-facts"),
    ).toHaveAttribute("lang", "en");
  });
});

/*
 * ONEUPTIME'S OWN NOTES ON A COMPONENT, IN THE READER'S LANGUAGE (#6990).
 *
 * A OneUptime status page gives a resource it shows no status for no
 * words of its own, so the probe writes a note as the component's
 * description: the page does not show its status, it is not monitored, or
 * it is under maintenance for the page's events. The summary drew the
 * note as the probe wrote it, in English on every page. It now draws it in
 * the reader's language, the events' titles - the page's words - as
 * written; a description another page wrote stays as it wrote it, even
 * one that reads like OneUptime's note.
 */

// Components of a OneUptime page with no status of their own.
const NOTED_COMPONENTS: Array<ExternalStatusPageComponentStatus> = [
  {
    name: "Search",
    status: "unknown",
    description: EXTERNAL_STATUS_PAGE_ONEUPTIME_NOT_MONITORED,
    groupName: "Core / APIs",
  },
  {
    name: "Storefront",
    status: "unknown",
    description: EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN,
  },
  {
    name: "Orders database",
    status: "under_maintenance",
    description: "Under maintenance: Database upgrade",
    groupName: "Core / Databases",
  },
];

// The line under each component's name, as a reader sees it.
function details(): Array<string | null> {
  return screen
    .getAllByTestId("external-status-page-component")
    .map((row: HTMLElement): string | null => {
      const detail: HTMLElement | null = within(row).queryByTestId(
        "external-status-page-component-detail",
      );

      return detail ? withoutIsolateMarks(detail.textContent || "") : null;
    });
}

function renderNoted(
  provider: ExternalStatusPageProviderType = ExternalStatusPageProviderType.OneUptime,
): void {
  renderView(
    pageResponse({
      provider: provider,
      overallStatus: "under_maintenance",
      componentStatuses: NOTED_COMPONENTS,
    }),
  );
}

describe("OneUptime's own notes on a component", () => {
  test("in English, each note reads as the probe wrote it", () => {
    renderNoted();

    expect(details()).toEqual([
      "Core / APIs · The status page shows this resource as not monitored.",
      "The status page does not show this resource's status.",
      "Core / Databases · Under maintenance: Database upgrade",
    ]);
  });

  test("in English, the line holds no isolate marks", () => {
    renderNoted();

    for (const detail of screen.getAllByTestId(
      "external-status-page-component-detail",
    )) {
      expect(withoutIsolateMarks(detail.textContent || "")).toBe(
        detail.textContent,
      );
    }
  });

  test("each part of the line is in its own direction", () => {
    renderNoted();

    const first: HTMLElement = screen.getAllByTestId(
      "external-status-page-component-detail",
    )[0]!;
    const parts: Array<string> = Array.from(first.querySelectorAll("bdi")).map(
      (part: Element): string => {
        return part.textContent || "";
      },
    );

    expect(parts).toEqual([
      "Core / APIs",
      "The status page shows this resource as not monitored.",
    ]);
    // The separator sits between the parts, outside both.
    expect(first.textContent).toBe(parts.join(" · "));
  });

  describe("in German", () => {
    beforeAll(async () => {
      await i18next.changeLanguage("de");
    });

    afterAll(async () => {
      await i18next.changeLanguage("en");
    });

    test("each note reads German, the group and the event's title as the page wrote them", () => {
      renderNoted();

      expect(details()).toEqual([
        "Core / APIs · Die Statusseite zeigt diese Ressource als nicht überwacht an.",
        "Die Statusseite zeigt den Status dieser Ressource nicht an.",
        "Core / Databases · In Wartung: Database upgrade",
      ]);
    });

    test("the German is the locale file's", () => {
      renderNoted();

      expect(details()).toEqual([
        `Core / APIs · ${DE[EXTERNAL_STATUS_PAGE_ONEUPTIME_NOT_MONITORED]}`,
        DE[EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN],
        `Core / Databases · ${DE[
          EXTERNAL_STATUS_PAGE_ONEUPTIME_UNDER_MAINTENANCE_OF
        ]!.replace("{{events}}", "Database upgrade")}`,
      ]);
    });

    test("another page's description stays as that page wrote it, even when it reads like a note", () => {
      for (const provider of [
        ExternalStatusPageProviderType.AtlassianStatuspage,
        ExternalStatusPageProviderType.IncidentIo,
      ]) {
        renderNoted(provider);

        expect(details()).toEqual([
          "Core / APIs · The status page shows this resource as not monitored.",
          "The status page does not show this resource's status.",
          "Core / Databases · Under maintenance: Database upgrade",
        ]);

        cleanup();
      }
    });

    test("a check that names no provider leaves every description as written", () => {
      renderView(
        pageResponse({
          provider: undefined,
          componentStatuses: NOTED_COMPONENTS,
        }),
      );

      expect(details()[1]).toBe(
        "The status page does not show this resource's status.",
      );
    });

    test("a OneUptime resource's own status name stays as the page wrote it", () => {
      renderView(
        pageResponse({
          componentStatuses: [
            {
              name: "Payments webhooks",
              status: "major_outage",
              description: "Offline",
            },
          ],
        }),
      );

      expect(details()).toEqual(["Offline"]);
    });
  });

  describe.each(["ar", "fa"])("in %s", (language: string) => {
    const locale: Record<string, string> = readDashboardLocale(language);

    beforeAll(async () => {
      await i18next.changeLanguage(language);
    });

    afterAll(async () => {
      await i18next.changeLanguage("en");
    });

    test("each note reads in the language, the page's words as written", () => {
      renderNoted();

      const separator: string = language === "fa" ? " • " : " · ";

      expect(details()).toEqual([
        `Core / APIs${separator}${locale[EXTERNAL_STATUS_PAGE_ONEUPTIME_NOT_MONITORED]}`,
        locale[EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN],
        `Core / Databases${separator}${locale[
          EXTERNAL_STATUS_PAGE_ONEUPTIME_UNDER_MAINTENANCE_OF
        ]!.replace("{{events}}", "Database upgrade")}`,
      ]);
    });

    test("the page's English group and the note are each drawn in their own direction", () => {
      renderNoted();

      const last: HTMLElement = screen.getAllByTestId(
        "external-status-page-component-detail",
      )[2]!;
      const parts: Array<HTMLElement> = Array.from(
        last.querySelectorAll("bdi"),
      );

      expect(parts).toHaveLength(2);
      expect(parts[0]).toHaveTextContent("Core / Databases");
      expect(withoutIsolateMarks(parts[1]!.textContent || "")).toBe(
        locale[EXTERNAL_STATUS_PAGE_ONEUPTIME_UNDER_MAINTENANCE_OF]!.replace(
          "{{events}}",
          "Database upgrade",
        ),
      );
      // The event's English title is set apart inside the sentence.
      expect(parts[1]!.textContent).not.toBe(
        withoutIsolateMarks(parts[1]!.textContent || ""),
      );
    });
  });
});

describe("what the page says of a component (getComponentDescription)", () => {
  const german: Translator = dashboardTranslator("de");

  test("a OneUptime page's note in the reader's language", () => {
    expect(
      getComponentDescription({
        translator: german,
        description: EXTERNAL_STATUS_PAGE_ONEUPTIME_NOT_MONITORED,
        isOneUptimePage: true,
      }),
    ).toBe("Die Statusseite zeigt diese Ressource als nicht überwacht an.");
  });

  test("the same words from another page, as written", () => {
    expect(
      getComponentDescription({
        translator: german,
        description: EXTERNAL_STATUS_PAGE_ONEUPTIME_NOT_MONITORED,
        isOneUptimePage: false,
      }),
    ).toBe(EXTERNAL_STATUS_PAGE_ONEUPTIME_NOT_MONITORED);
  });

  test("a description of the page's own, trimmed, as written", () => {
    expect(
      getComponentDescription({
        translator: german,
        description: "  Partial outage in eu-west  ",
        isOneUptimePage: true,
      }),
    ).toBe("Partial outage in eu-west");
  });

  test("negative control: a language that left a note in English draws the English", () => {
    const words: Record<string, string> = {
      ...readDashboardLocale("de"),
      [EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN]:
        EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN,
    };
    const untranslated: Translator = createTranslator(
      (text: string): string | undefined => {
        return words[text];
      },
      "de",
    );

    expect(
      getComponentDescription({
        translator: untranslated,
        description: EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN,
        isOneUptimePage: true,
      }),
    ).toBe(EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN);
    expect(
      isWordedInDashboardLocale(
        "The status page does not show this resource's status (made up).",
        "de",
      ),
    ).toBe(false);
  });
});

describe("OneUptime's notes in every Dashboard language", () => {
  const NOTES: Array<string> = [
    EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN,
    EXTERNAL_STATUS_PAGE_ONEUPTIME_NOT_MONITORED,
    EXTERNAL_STATUS_PAGE_ONEUPTIME_UNDER_MAINTENANCE_OF,
  ];

  test("English holds each note under its own words", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const note of NOTES) {
      expect(english[note]).toBe(note);
    }
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words each note, with the English placeholders",
    (language: string) => {
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const note of NOTES) {
        expect({
          note,
          worded: isWordedInDashboardLocale(note, language),
        }).toEqual({ note, worded: true });
        expect(placeholdersOf(locale[note]!)).toEqual(placeholdersOf(note));
      }
    },
  );
});

/*
 * WHY A ONEUPTIME PAGE TURNED THE PROBE AWAY, IN THE READER'S LANGUAGE (#7222).
 *
 * With the OneUptime Status Page provider chosen, a private page (sign-in
 * or password) or one whose IP allowlist leaves the probe out fails the
 * check, and the probe stores why in English: monitor criteria and logs
 * compare those words, so they never change. The summary's Error drew
 * them in English on every page. Each is a translation key now
 * (ExternalStatusPageReading), and the Error draws it in the reader's
 * language - only for a check of a OneUptime page, and only when the cause
 * is exactly those words. Any other cause, or the same words from another
 * provider, is drawn as written.
 */
const REFUSALS: Array<string> = [
  EXTERNAL_STATUS_PAGE_ONEUPTIME_PRIVATE_MESSAGE,
  EXTERNAL_STATUS_PAGE_ONEUPTIME_IP_NOT_ALLOWED_MESSAGE,
];

const IP_NOT_ALLOWED_MESSAGE: string =
  "This status page lets in only the IP addresses on its allowlist, and this probe's address is not one of them. Add the probe's address to the allowlist, or watch the page from a probe inside that network.";

const LATIN_LETTER: RegExp = /[A-Za-z]/;
const IP_WORD: RegExp = /\bIP\b/g;

// A check the page turned away, as the probe reports it.
function refusedResponse(
  failureCause: string,
  provider:
    | ExternalStatusPageProviderType
    | undefined = ExternalStatusPageProviderType.OneUptime,
): ExternalStatusPageMonitorResponse {
  return pageResponse({
    isOnline: false,
    overallStatus: "unknown",
    componentStatuses: [],
    failureCause: failureCause,
    provider: provider,
  });
}

// The Error as a reader sees it: its words, and the direction it reads in.
function drawnError(): { text: string; dir: string | null } {
  const error: HTMLElement = screen.getByTestId(
    EXTERNAL_STATUS_PAGE_ERROR_TEST_ID,
  );

  return {
    text: withoutIsolateMarks(error.textContent || ""),
    dir: error.getAttribute("dir"),
  };
}

describe("why a OneUptime page turned the probe away (getFailureCause)", () => {
  test("the probe stores the English it always stored, which monitor criteria compare", () => {
    expect(EXTERNAL_STATUS_PAGE_ONEUPTIME_PRIVATE_MESSAGE).toBe(
      PRIVATE_PAGE_MESSAGE,
    );
    expect(EXTERNAL_STATUS_PAGE_ONEUPTIME_IP_NOT_ALLOWED_MESSAGE).toBe(
      IP_NOT_ALLOWED_MESSAGE,
    );
  });

  test("in German, each reads in German", () => {
    const german: Translator = dashboardTranslator("de");

    expect(
      getFailureCause({
        translator: german,
        failureCause: PRIVATE_PAGE_MESSAGE,
        provider: ExternalStatusPageProviderType.OneUptime,
      }),
    ).toBe(
      "Diese Statusseite ist privat: Nur Personen, die sich dort anmelden oder ihr Passwort kennen, können sie lesen. Nur eine öffentliche Statusseite kann überwacht werden.",
    );
    expect(
      getFailureCause({
        translator: german,
        failureCause: IP_NOT_ALLOWED_MESSAGE,
        provider: ExternalStatusPageProviderType.OneUptime,
      }),
    ).toBe(
      "Diese Statusseite lässt nur die IP-Adressen auf ihrer Zulassungsliste zu, und die Adresse dieser Sonde gehört nicht dazu. Fügen Sie die Adresse der Sonde zur Zulassungsliste hinzu oder überwachen Sie die Seite von einer Sonde innerhalb dieses Netzwerks.",
    );
  });

  test.each(["de", "ar", "fa"])(
    "in %s, each reads as the language's file words it, never the English",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const refusal of REFUSALS) {
        const drawn: string = getFailureCause({
          translator: translator,
          failureCause: refusal,
          provider: ExternalStatusPageProviderType.OneUptime,
        });

        expect(drawn).toBe(locale[refusal]);
        expect(drawn).not.toBe(refusal);
      }
    },
  );

  test.each(["ar", "fa"])(
    "in %s the words are the language's own, but for the name IP",
    (language: string) => {
      for (const refusal of REFUSALS) {
        const drawn: string = getFailureCause({
          translator: dashboardTranslator(language),
          failureCause: refusal,
          provider: ExternalStatusPageProviderType.OneUptime,
        });

        expect(drawn.replace(IP_WORD, "")).not.toMatch(LATIN_LETTER);
      }
    },
  );

  test("a check stored before the probe named its provider reads in the language too", () => {
    const german: Translator = dashboardTranslator("de");

    for (const provider of [undefined, "", "  "]) {
      expect(
        getFailureCause({
          translator: german,
          failureCause: PRIVATE_PAGE_MESSAGE,
          provider: provider,
        }),
      ).toBe(readDashboardLocale("de")[PRIVATE_PAGE_MESSAGE]);
    }
  });

  test("the probe's words with space round them still read in the language", () => {
    expect(
      getFailureCause({
        translator: dashboardTranslator("de"),
        failureCause: `  ${IP_NOT_ALLOWED_MESSAGE}\n`,
        provider: ExternalStatusPageProviderType.OneUptime,
      }),
    ).toBe(readDashboardLocale("de")[IP_NOT_ALLOWED_MESSAGE]);
  });

  test.each([
    ExternalStatusPageProviderType.AtlassianStatuspage,
    ExternalStatusPageProviderType.IncidentIo,
    ExternalStatusPageProviderType.RSS,
    ExternalStatusPageProviderType.Atom,
    ExternalStatusPageProviderType.Auto,
  ])(
    "the same words from %s are drawn as written",
    (provider: ExternalStatusPageProviderType) => {
      for (const refusal of REFUSALS) {
        expect(
          getFailureCause({
            translator: dashboardTranslator("de"),
            failureCause: refusal,
            provider: provider,
          }),
        ).toBe(refusal);
      }
    },
  );

  test("any other cause is drawn as written: the network's, a timeout's, a page's status", () => {
    for (const cause of [
      "HTTP status 503",
      "Request timed out after 10000 ms",
      "getaddrinfo ENOTFOUND status.example.com",
      "Unexpected token < in JSON at position 0",
    ]) {
      expect(
        getFailureCause({
          translator: dashboardTranslator("ar"),
          failureCause: `${cause} `,
          provider: ExternalStatusPageProviderType.OneUptime,
        }),
      ).toBe(cause);
    }
  });

  test("words close to the probe's, but not the same, are drawn as written", () => {
    for (const cause of [
      PRIVATE_PAGE_MESSAGE.slice(0, -1),
      `${PRIVATE_PAGE_MESSAGE} (HTTP 401)`,
      PRIVATE_PAGE_MESSAGE.toLowerCase(),
      `Error: ${IP_NOT_ALLOWED_MESSAGE}`,
    ]) {
      expect(
        getFailureCause({
          translator: dashboardTranslator("de"),
          failureCause: cause,
          provider: ExternalStatusPageProviderType.OneUptime,
        }),
      ).toBe(cause);
    }
  });

  test("in English, exactly the probe's words", () => {
    for (const refusal of REFUSALS) {
      expect(
        getFailureCause({
          translator: dashboardTranslator("en"),
          failureCause: refusal,
          provider: ExternalStatusPageProviderType.OneUptime,
        }),
      ).toBe(refusal);
    }
  });

  test("negative control: a language that left a refusal in English draws the English", () => {
    const words: Record<string, string> = {
      ...readDashboardLocale("de"),
      [PRIVATE_PAGE_MESSAGE]: PRIVATE_PAGE_MESSAGE,
    };
    const untranslated: Translator = createTranslator(
      (text: string): string | undefined => {
        return words[text];
      },
      "de",
    );

    expect(
      getFailureCause({
        translator: untranslated,
        failureCause: PRIVATE_PAGE_MESSAGE,
        provider: ExternalStatusPageProviderType.OneUptime,
      }),
    ).toBe(PRIVATE_PAGE_MESSAGE);
  });
});

describe.each(["de", "ar", "fa"])(
  "a refused check's summary in %s",
  (language: string) => {
    const locale: Record<string, string> = readDashboardLocale(language);
    const isRightToLeft: boolean = language === "ar" || language === "fa";

    beforeAll(async () => {
      await i18next.changeLanguage(language);
    });

    afterAll(async () => {
      await i18next.changeLanguage("en");
    });

    test.each([
      ["a private page", PRIVATE_PAGE_MESSAGE],
      [
        "a page whose IP allowlist leaves the probe out",
        IP_NOT_ALLOWED_MESSAGE,
      ],
    ])(
      "%s: the Error reads in the language, the page's way",
      (_name: string, refusal: string) => {
        renderView(refusedResponse(refusal));

        expect(drawnError()).toEqual({ text: locale[refusal], dir: null });
        expect(
          screen.queryByText(refusal, { exact: false }),
        ).not.toBeInTheDocument();
      },
    );

    test("a check stored before the probe named its provider: the Error reads in the language", () => {
      renderView(refusedResponse(PRIVATE_PAGE_MESSAGE, undefined));

      expect(drawnError().text).toBe(locale[PRIVATE_PAGE_MESSAGE]);
    });

    test("the same words from an Atlassian Statuspage stay in English, read left to right", () => {
      renderView(
        refusedResponse(
          PRIVATE_PAGE_MESSAGE,
          ExternalStatusPageProviderType.AtlassianStatuspage,
        ),
      );

      expect(drawnError()).toEqual({
        text: PRIVATE_PAGE_MESSAGE,
        dir: isRightToLeft ? "ltr" : null,
      });
    });

    test("a network error stays as written, read left to right", () => {
      renderView(refusedResponse("connect ECONNREFUSED 203.0.113.7:443"));

      expect(drawnError()).toEqual({
        text: "connect ECONNREFUSED 203.0.113.7:443",
        dir: isRightToLeft ? "ltr" : null,
      });
    });
  },
);

describe("a refused check's summary in English", () => {
  test("the Error reads the probe's words, exactly", () => {
    renderView(refusedResponse(IP_NOT_ALLOWED_MESSAGE));

    expect(drawnError()).toEqual({ text: IP_NOT_ALLOWED_MESSAGE, dir: null });
  });

  test("a check that did not fail draws no Error", () => {
    renderView();

    expect(
      screen.queryByTestId(EXTERNAL_STATUS_PAGE_ERROR_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

/*
 * THE RESPONSE TIME IN THE READER'S LANGUAGE (#7224): Persian digits and a
 * Persian unit in Persian, an Arabic unit in Arabic - never "ms 412" - and
 * "412 ms" in English as before.
 */
describe.each([
  ["en", "412 ms"],
  ["de", "412 ms"],
  ["ar", "412 ملي ث"],
  ["fa", "۴۱۲ میلی\u{200C}ثانیه"],
])("the Response Time in %s", (language: string, expected: string) => {
  beforeAll(async () => {
    await i18next.changeLanguage(language);
  });

  afterAll(async () => {
    await i18next.changeLanguage("en");
  });

  test(`reads "${expected}"`, () => {
    renderView();

    expect(
      withoutIsolateMarks(
        factValue("external-status-page-check-facts", 2).textContent || "",
      ),
    ).toBe(expected);
  });
});

describe("the refusals in every Dashboard language", () => {
  test("English holds each under its own words", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const refusal of REFUSALS) {
      expect(english[refusal]).toBe(refusal);
    }
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words each refusal",
    (language: string) => {
      for (const refusal of REFUSALS) {
        expect({
          refusal,
          worded: isWordedInDashboardLocale(refusal, language),
        }).toEqual({ refusal, worded: true });
      }
    },
  );

  test("negative control: words no file holds are not worded", () => {
    expect(
      isWordedInDashboardLocale(`${PRIVATE_PAGE_MESSAGE} (made up)`, "de"),
    ).toBe(false);
  });
});

/*
 * THE PAGE'S ACTIVE INCIDENTS. A check that could not read the page - a
 * private page, one whose IP allowlist leaves the probe out, a timeout, a
 * network error - counted no incidents: its Active Incidents reads "-", as
 * its Overall Status does, never a 0 that reads as a quiet page. A page
 * the probe read gives its count in the reader's digits ("۳" in Persian).
 */
describe("the page's active incidents (getActiveIncidentsText)", () => {
  const english: Translator = dashboardTranslator("en");

  test("a page the probe read: its count, 0 when it has none", () => {
    expect(
      getActiveIncidentsText({
        translator: english,
        activeIncidentCount: 3,
        isPageRead: true,
      }),
    ).toBe("3");
    expect(
      getActiveIncidentsText({
        translator: english,
        activeIncidentCount: 0,
        isPageRead: true,
      }),
    ).toBe("0");
    expect(
      getActiveIncidentsText({
        translator: english,
        activeIncidentCount: undefined,
        isPageRead: true,
      }),
    ).toBe("0");
    expect(
      getActiveIncidentsText({
        translator: english,
        activeIncidentCount: 1250,
        isPageRead: true,
      }),
    ).toBe("1,250");
  });

  test("a page the probe could not read: a dash, whatever count the check carries", () => {
    for (const count of [0, 3, undefined]) {
      expect(
        getActiveIncidentsText({
          translator: english,
          activeIncidentCount: count,
          isPageRead: false,
        }),
      ).toBe("-");
    }
  });

  test("in Persian, the count in Persian digits", () => {
    const persian: Translator = dashboardTranslator("fa");

    expect(
      getActiveIncidentsText({
        translator: persian,
        activeIncidentCount: 3,
        isPageRead: true,
      }),
    ).toBe("\u{06F3}");
    expect(
      getActiveIncidentsText({
        translator: persian,
        activeIncidentCount: 0,
        isPageRead: true,
      }),
    ).toBe("\u{06F0}");
  });
});

describe("the Active Incidents fact", () => {
  // The Active Incidents card's value: the page facts' third card.
  function activeIncidents(): string {
    return withoutIsolateMarks(
      factValue("external-status-page-page-facts", 2).textContent || "",
    ).trim();
  }

  // The Overall Status card's value: the page facts' second card.
  function overallStatus(): string {
    return withoutIsolateMarks(
      factValue("external-status-page-page-facts", 1).textContent || "",
    ).trim();
  }

  test.each([
    ["a private page", PRIVATE_PAGE_MESSAGE],
    ["a page whose IP allowlist leaves the probe out", IP_NOT_ALLOWED_MESSAGE],
    ["a network error", "connect ECONNREFUSED 203.0.113.7:443"],
  ])(
    "%s: a dash, as the Overall Status, not a 0",
    (_name: string, cause: string) => {
      renderView({ ...refusedResponse(cause), overallStatus: "" });

      expect(activeIncidents()).toBe("-");
      expect(overallStatus()).toBe("-");
    },
  );

  test("a timeout, its status Unknown: a dash", () => {
    renderView(
      refusedResponse("Request was tried 3 times and it timed out.", undefined),
    );

    expect(activeIncidents()).toBe("-");
  });

  test("a page that answered with none: 0", () => {
    renderView(pageResponse({ activeIncidentCount: 0 }));

    expect(activeIncidents()).toBe("0");
  });

  test("a page that answered with two: 2", () => {
    renderView(pageResponse({ activeIncidentCount: 2 }));

    expect(activeIncidents()).toBe("2");
  });

  test("the incidents the scope left out still read under the count", () => {
    renderView(
      pageResponse({ activeIncidentCount: 1, incidentsOutsideScopeCount: 2 }),
    );

    expect(
      screen.getByTestId(EXTERNAL_STATUS_PAGE_OUTSIDE_INCIDENTS_TEST_ID),
    ).toHaveTextContent("2 more on the page, not counted");
    expect(activeIncidents()).toBe("12 more on the page, not counted");
  });

  describe("in Persian", () => {
    beforeAll(async () => {
      await i18next.changeLanguage("fa");
    });

    afterAll(async () => {
      await i18next.changeLanguage("en");
    });

    test("the count in Persian digits, never a Latin one", () => {
      renderView(pageResponse({ activeIncidentCount: 3 }));

      expect(activeIncidents()).toBe("\u{06F3}");
    });

    test("a refused page: a dash", () => {
      renderView(refusedResponse(PRIVATE_PAGE_MESSAGE));

      expect(activeIncidents()).toBe("-");
    });
  });
});
