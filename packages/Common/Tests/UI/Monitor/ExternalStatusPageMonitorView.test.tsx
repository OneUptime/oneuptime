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
  EXTERNAL_STATUS_PAGE_OUTSIDE_INCIDENTS_TEST_ID,
  EXTERNAL_STATUS_PAGE_OVERALL_STATUS_TEST_ID,
  EXTERNAL_STATUS_PAGE_UNMATCHED_TEST_ID,
  getWatchedComponentNames,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/ExternalStatusPageMonitorView";
import SummaryInfo from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryInfo";

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
    resources: { de: { translation: DE } },
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
    expect(within(overall).getByTestId("status-bubble-dot")).toBeInTheDocument();
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
