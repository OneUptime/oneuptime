import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Security Events > Entity Risk, an entity's page and Settings > Risk
 * Scoring, rendered with the data boundary stubbed: ModelTable records what
 * each page hands it (the page's contract with the table), ModelAPI answers
 * the project's risk settings and an entity's risk row, and the entity's
 * activity comes from SecurityCaseApi. The arithmetic itself is pinned in
 * Common/Tests/Utils/SecurityCase/SecurityEntityRiskScore.test.ts; this
 * suite pins what each page says about it, and what it asks for.
 */

const recordedTables: Array<Record<string, unknown>> = [];
const recordedSwitches: Array<Record<string, unknown>> = [];
const recordedDetails: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedTables.push(props);
      return React.createElement("div", {
        "data-testid": `model-table-${String(props["id"])}`,
      });
    },
  };
});

jest.mock("../../../UI/Components/ModelSwitch/ModelSwitchCard", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedSwitches.push(props);
      return React.createElement("div", {
        "data-testid": String(props["dataTestId"]),
      });
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedDetails.push(props);
      return React.createElement("div", { "data-testid": "card-detail" });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/ProjectColumnEditGate",
  () => {
    return {
      __esModule: true,
      getProjectColumnsEditGate: (): Record<string, unknown> => {
        return { isEditable: true, lockedButtons: [] };
      },
    };
  },
);

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return React.createElement("div", {}, props.text);
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();
const getEntityActivityMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      deleteItem: (...args: Array<unknown>): unknown => {
        return deleteItemMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi",
  () => {
    return {
      __esModule: true,
      default: {
        getEntityActivity: (...args: Array<unknown>): unknown => {
          return getEntityActivityMock(...args);
        },
      },
    };
  },
);

// Whether the reader may delete security data, and why not.
let resetGate: { isAllowed: boolean; disabledReason?: string | undefined } = {
  isAllowed: true,
};

jest.mock("../../../UI/Utils/PermissionGate", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Utils/PermissionGate",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      check: (): {
        isAllowed: boolean;
        disabledReason?: string | undefined;
      } => {
        return resetGate;
      },
    },
  };
});

import SecurityEntityRiskPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/EntityRisk";
import SecurityEntityRiskViewPage, {
  getEntityEventsRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/EntityRiskView";
import SecurityRiskScoringPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Settings/RiskScoring";
import {
  ENTITY_RISK_TEST_IDS,
  RISK_CASES_OFF_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/EntityRisk/EntityRiskCopy";
import {
  ENTITY_RISK_HISTORY_DAYS,
  getEntityRiskBreakdown,
  getEntityRiskHistoryDays,
  getEntityRiskLevelColor,
  getEntityRiskMeterPercent,
  getEntityRiskRoute,
  readEntityCriticality,
  readEntityTypeFromQuery,
  readEntityValueFromQuery,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/EntityRisk/EntityRiskModel";
import { getEntityRiskGuide } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/EntityRiskGuide";
import {
  SecurityEventsGuide,
  guideToMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/SecurityEventsGuide";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityEntityCriticality from "../../../Models/DatabaseModels/SecurityEntityCriticality";
import SecurityEntityRisk from "../../../Models/DatabaseModels/SecurityEntityRisk";
import Route from "../../../Types/API/Route";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { Blue, Gray500, Orange, Red, Yellow } from "../../../Types/BrandColors";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  ENTITY_RISK_POINTS_BY_SEVERITY,
  SecurityEntityCriticality as Criticality,
  SecurityEntityRiskContribution,
  SecurityEntityRiskLevel,
} from "../../../Types/SecurityCase/SecurityEntityRisk";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import { getEntityRiskLevel } from "../../../Utils/SecurityCase/SecurityEntityRiskScore";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const NOW: Date = new Date("2026-10-14T12:00:00.000Z");
const PRODUCT: string = `/dashboard/${PROJECT_ID}/security-events`;
const ROW_ID: string = "2d000000-0000-4000-8000-000000000001";

const minutesAgo: (minutes: number) => string = (minutes: number): string => {
  return new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
};

function source(
  data: Partial<SecurityEntityRiskContribution>,
): SecurityEntityRiskContribution {
  return {
    sourceKey: "rule:1",
    source: SecurityDetectionSource.DetectionRule,
    sourceName: "Password spraying",
    severity: OcsfSeverity.High,
    points: 50,
    hits: 1,
    firstSeenAt: minutesAgo(60),
    lastSeenAt: minutesAgo(9),
    mitreTactics: [],
    mitreTechniques: [],
    ...data,
  };
}

const SPRAY_SOURCES: Array<SecurityEntityRiskContribution> = [
  source({
    sourceKey: "intel:2",
    source: SecurityDetectionSource.ThreatIntel,
    sourceName: "Corporate MISP",
    severity: OcsfSeverity.Medium,
    points: 25,
    hits: 31,
    lastSeenAt: minutesAgo(12),
  }),
  source({
    sourceKey: "rule:2",
    sourceName: "Password spraying",
    hits: 14,
    lastSeenAt: minutesAgo(9),
    mitreTactics: ["TA0006"],
    mitreTechniques: ["T1110.003"],
  }),
  source({
    sourceKey: "rule:30",
    sourceName: "Spray, then a success",
    hits: 1,
    lastSeenAt: minutesAgo(41),
  }),
];

// A risk row as the API reads it; a test names only the columns it changes.
function riskRow(data: Record<string, unknown>): SecurityEntityRisk {
  return Object.assign(new SecurityEntityRisk(), {
    _id: ROW_ID,
    entityType: SecurityEntityType.IpAddress,
    entityValue: "203.0.113.47",
    entityKey: "203.0.113.47",
    riskScore: 125,
    contributions: SPRAY_SOURCES,
    firstRiskAt: new Date(minutesAgo(2 * 24 * 60)),
    lastRiskAt: new Date(minutesAgo(9)),
    riskExpiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    riskCaseAt: new Date(minutesAgo(41)),
    riskHistory: [
      { day: "2026-10-12", score: 25 },
      { day: "2026-10-13", score: 25 },
      { day: "2026-10-14", score: 125 },
    ],
    ...data,
  });
}

let settings: Record<string, unknown> = {};
let rows: Array<SecurityEntityRisk> = [];

function pageProps(): PageComponentProps {
  return {} as PageComponentProps;
}

function goTo(path: string): void {
  window.history.pushState({}, "", path);
}

function tableById(id: string): Record<string, unknown> {
  const table: Record<string, unknown> | undefined = [...recordedTables]
    .reverse()
    .find((props: Record<string, unknown>): boolean => {
      return props["id"] === id;
    });

  expect(table).toBeDefined();

  return table!;
}

function columnTitles(table: Record<string, unknown>): Array<string> {
  return (table["columns"] as Array<{ title: string }>).map(
    (column: { title: string }): string => {
      return column.title;
    },
  );
}

beforeEach(() => {
  recordedTables.length = 0;
  recordedSwitches.length = 0;
  recordedDetails.length = 0;
  resetGate = { isAllowed: true };
  settings = { securityRiskCaseThreshold: 100, enableSecurityRiskCases: true };
  rows = [riskRow({})];
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  getItemMock.mockReset();
  getItemMock.mockImplementation(async () => {
    return settings;
  });
  getListMock.mockReset();
  getListMock.mockImplementation(async () => {
    return { data: rows, count: rows.length };
  });
  deleteItemMock.mockReset();
  deleteItemMock.mockImplementation(async () => {
    rows = [];
  });
  getEntityActivityMock.mockReset();
  getEntityActivityMock.mockImplementation(async () => {
    return [
      {
        value: "203.0.113.47",
        eventCount: 475,
        findingCount: 36,
        maxSeverityId: 4,
        firstSeen: new Date(minutesAgo(6 * 24 * 60)),
        lastSeen: new Date(minutesAgo(9)),
      },
    ];
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

/*
 * ---------------------------------------------------------------------------
 * What the pages draw from a risk row
 * ---------------------------------------------------------------------------
 */

describe("an entity's risk, as the pages draw it", () => {
  test("its page's address carries the value, and its kind when it is one", () => {
    const withType: string = getEntityRiskRoute(
      " 203.0.113.47 ",
      SecurityEntityType.IpAddress,
    ).toString();

    expect(withType.split("?")[0]).toBe(`${PRODUCT}/entity-risk/entity`);
    const query: URLSearchParams = new URLSearchParams(withType.split("?")[1]);
    expect(query.get("value")).toBe("203.0.113.47");
    expect(query.get("type")).toBe("IP Address");

    // A value that needs escaping arrives whole; an unknown kind is left out.
    const odd: string = getEntityRiskRoute(
      "svc 100%&admin=1",
      "Spaceship",
    ).toString();
    const oddQuery: URLSearchParams = new URLSearchParams(odd.split("?")[1]);
    expect(oddQuery.get("value")).toBe("svc 100%&admin=1");
    expect(oddQuery.get("type")).toBeNull();
    expect(oddQuery.get("admin")).toBeNull();
  });

  test("reads the page's query as the browser decoded it, once", () => {
    expect(readEntityValueFromQuery("  k.morgan@acme-commerce.example ")).toBe(
      "k.morgan@acme-commerce.example",
    );
    // Not decoded twice: a value with a % stays as it was written.
    expect(readEntityValueFromQuery("100%25")).toBe("100%25");
    expect(readEntityValueFromQuery(null)).toBe("");
    expect(readEntityTypeFromQuery("Host")).toBe(SecurityEntityType.Host);
    expect(readEntityTypeFromQuery("host")).toBeNull();
    expect(readEntityTypeFromQuery(undefined)).toBeNull();
  });

  test("the meter fills against twice the threshold, the threshold halfway", () => {
    expect(getEntityRiskMeterPercent(0, 100)).toBe(0);
    expect(getEntityRiskMeterPercent(Number.NaN, 100)).toBe(0);
    expect(getEntityRiskMeterPercent(100, 100)).toBe(50);
    expect(getEntityRiskMeterPercent(125, 100)).toBe(62.5);
    expect(getEntityRiskMeterPercent(500, 100)).toBe(100);
    expect(getEntityRiskMeterPercent(50, 50)).toBe(50);
  });

  test("each level in the colour the Events table gives a severity", () => {
    expect(getEntityRiskLevelColor(SecurityEntityRiskLevel.Critical)).toBe(Red);
    expect(getEntityRiskLevelColor(SecurityEntityRiskLevel.High)).toBe(Orange);
    expect(getEntityRiskLevelColor(SecurityEntityRiskLevel.Medium)).toBe(
      Yellow,
    );
    expect(getEntityRiskLevelColor(SecurityEntityRiskLevel.Low)).toBe(Blue);
    expect(getEntityRiskLevelColor(SecurityEntityRiskLevel.None)).toBe(Gray500);
  });

  test("the breakdown: the sources the most first, what they add up to and the weight that makes the score", () => {
    const breakdown: ReturnType<typeof getEntityRiskBreakdown> =
      getEntityRiskBreakdown({
        riskScore: 250,
        criticality: Criticality.Extreme,
        contributions: SPRAY_SOURCES,
        threshold: 100,
      });

    expect(
      breakdown.sources.map((item: SecurityEntityRiskContribution) => {
        return item.sourceName;
      }),
    ).toEqual(["Password spraying", "Spray, then a success", "Corporate MISP"]);
    expect(breakdown.baseScore).toBe(125);
    expect(breakdown.weight).toBe(2);
    expect(breakdown.criticality).toBe(Criticality.Extreme);
    expect(breakdown.level).toBe(SecurityEntityRiskLevel.Critical);

    // Whatever a row holds: an unknown criticality weighs nothing, junk is no source.
    const junk: ReturnType<typeof getEntityRiskBreakdown> =
      getEntityRiskBreakdown({
        riskScore: undefined,
        criticality: "Galactic",
        contributions: "not a list",
        threshold: 5,
      });
    expect(junk).toEqual(
      expect.objectContaining({
        score: 0,
        baseScore: 0,
        criticality: null,
        weight: 1,
        sources: [],
        // The threshold as stored: never below 10.
        threshold: 10,
        level: SecurityEntityRiskLevel.None,
      }),
    );
    expect(readEntityCriticality("High")).toBe(Criticality.High);
    expect(readEntityCriticality("high")).toBeNull();
  });

  test("the month, a bar a day in its level's colour, carried over days without a point", () => {
    const days: ReturnType<typeof getEntityRiskHistoryDays> =
      getEntityRiskHistoryDays({
        history: [
          { day: "2026-10-10", score: 30 },
          { day: "2026-10-13", score: 120 },
        ],
        threshold: 100,
        now: NOW,
      });

    expect(days).toHaveLength(ENTITY_RISK_HISTORY_DAYS);
    expect(days[days.length - 1]!.day).toBe("2026-10-14");
    const byDay: Map<string, (typeof days)[number]> = new Map(
      days.map((day: (typeof days)[number]) => {
        return [day.day, day];
      }),
    );
    expect(byDay.get("2026-10-09")!.total).toBe(0);
    expect(byDay.get("2026-10-10")!.byKey).toEqual({
      Low: 30,
      Medium: 0,
      High: 0,
      Critical: 0,
    });
    // Carried: nothing changed on the 11th and 12th.
    expect(byDay.get("2026-10-12")!.total).toBe(30);
    expect(byDay.get("2026-10-13")!.byKey["High"]).toBe(120);
    expect(byDay.get("2026-10-14")!.total).toBe(120);
    expect(
      getEntityRiskHistoryDays({ history: "junk", threshold: 100, now: NOW }),
    ).toHaveLength(ENTITY_RISK_HISTORY_DAYS);
  });
});

/*
 * ---------------------------------------------------------------------------
 * How entity risk works
 * ---------------------------------------------------------------------------
 */

describe("the Entity Risk guide", () => {
  function levelLabels(guide: SecurityEventsGuide): Array<[string, string]> {
    return (guide.levels?.items || []).map(
      (item: { label: string; severity: string }): [string, string] => {
        return [item.label, item.severity];
      },
    );
  }

  test("says the points, the week, the weights and the project's threshold", () => {
    const guide: SecurityEventsGuide = getEntityRiskGuide(100);

    expect(guide.id).toBe("entity-risk");
    expect(guide.documentationPath).toBe("/telemetry/security-entity-risk");
    expect(
      guide.steps.map((step: { title: string }): string => {
        return step.title;
      }),
    ).toEqual([
      "Findings add points",
      "Each source counts once",
      "What matters more counts more",
      "At the threshold, a case opens",
    ]);
    expect(guide.steps[0]!.description).toBe(
      `Each finding adds points to the user, host or address it is about: ${ENTITY_RISK_POINTS_BY_SEVERITY[OcsfSeverity.Low]} for Low, ${ENTITY_RISK_POINTS_BY_SEVERITY[OcsfSeverity.Medium]} for Medium, ${ENTITY_RISK_POINTS_BY_SEVERITY[OcsfSeverity.High]} for High and ${ENTITY_RISK_POINTS_BY_SEVERITY[OcsfSeverity.Critical]} for Critical, or the rule's own Risk Points.`,
    );
    expect(guide.steps[1]!.description).toContain("counts once in 7 days");
    expect(guide.steps[2]!.description).toBe(
      "Entity Criticality weighs the score: Low counts it ×0.5, High ×1.5, Extreme ×2.",
    );
    expect(guide.steps[3]!.description).toContain("reaches 100, a case opens");
    expect(levelLabels(guide)).toEqual([
      ["1 to 49", OcsfSeverity.Low],
      ["50 to 99", OcsfSeverity.Medium],
      ["100 to 199", OcsfSeverity.High],
      ["200 or more", OcsfSeverity.Critical],
    ]);
    expect(
      guide.sections.map((section: { id: string }): string => {
        return section.id;
      }),
    ).toEqual(["overview", "points", "levels", "criticality"]);
  });

  test.each([10, 15, 50, 99, 100, 1000])(
    "at a threshold of %s, each level's range reads as that level",
    (threshold: number) => {
      const guide: SecurityEventsGuide = getEntityRiskGuide(threshold);
      const expected: Array<SecurityEntityRiskLevel> = [
        SecurityEntityRiskLevel.Low,
        SecurityEntityRiskLevel.Medium,
        SecurityEntityRiskLevel.High,
        SecurityEntityRiskLevel.Critical,
      ];

      (guide.levels?.items || []).forEach(
        (item: { label: string }, index: number) => {
          const numbers: Array<number> = (item.label.match(/\d+/g) || []).map(
            Number,
          );

          for (const score of numbers) {
            expect([item.label, getEntityRiskLevel(score, threshold)]).toEqual([
              item.label,
              expected[index],
            ]);
          }
        },
      );
      // The ranges meet: each starts where the one before it ended.
      const bounds: Array<Array<number>> = (guide.levels?.items || []).map(
        (item: { label: string }) => {
          return (item.label.match(/\d+/g) || []).map(Number);
        },
      );
      for (let index: number = 1; index < bounds.length; index++) {
        expect(bounds[index]![0]).toBe(
          bounds[index - 1]![bounds[index - 1]!.length - 1]! + 1,
        );
      }
      expect(guide.steps[3]!.description).toContain(`reaches ${threshold},`);
    },
  );

  test("a threshold the project could not have is read as one it could", () => {
    expect(getEntityRiskGuide(5).steps[3]!.description).toContain(
      "reaches 10,",
    );
    expect(getEntityRiskGuide(Number.NaN).steps[3]!.description).toContain(
      "reaches 100,",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Security Events > Entity Risk
 * ---------------------------------------------------------------------------
 */

describe("Security Events > Entity Risk", () => {
  function drawList(): void {
    render(
      <MemoryRouter>
        <SecurityEntityRiskPage {...pageProps()} />
      </MemoryRouter>,
    );
  }

  test("lists the entities with risk, the riskiest first, five columns and ATT&CK in Customize Columns", async () => {
    drawList();

    await screen.findByText("How entity risk works");
    const table: Record<string, unknown> = tableById(
      "security-entity-risk-table",
    );
    const query: Record<string, unknown> = table["query"] as Record<
      string,
      unknown
    >;

    expect(query["riskScore"]).toBeInstanceOf(GreaterThan);
    expect((query["riskScore"] as GreaterThan<number>).value).toBe(0);
    expect(query["projectId"]).toEqual(new ObjectID(PROJECT_ID));
    expect(table["sortBy"]).toBe("riskScore");
    expect(table["sortOrder"]).toBe(SortOrder.Descending);
    expect(table["isDeleteable"]).toBe(false);
    expect(table["isCreateable"]).toBe(false);
    expect(table["isEditable"]).toBe(false);
    expect(table["viewButtonText"]).toBe("View");
    expect(columnTitles(table)).toEqual([
      "Entity",
      "Risk",
      "Found By",
      "ATT&CK Tactics",
      "Last Risk",
    ]);
    expect(
      (
        table["columns"] as Array<{
          title: string;
          isHiddenByDefault?: boolean;
        }>
      )
        .filter((column: { isHiddenByDefault?: boolean }): boolean => {
          return Boolean(column.isHiddenByDefault);
        })
        .map((column: { title: string }): string => {
          return column.title;
        }),
    ).toEqual(["ATT&CK Tactics"]);
    expect(
      (table["filters"] as Array<{ title: string }>).map(
        (filter: { title: string }): string => {
          return filter.title;
        },
      ),
    ).toEqual(["Entity", "Type", "Criticality", "Last Risk"]);
    // The criticality filter names each with its weight.
    const criticalityFilter: {
      filterDropdownOptions: Array<{ label: string; value: string }>;
    } = (
      table["filters"] as Array<{
        title: string;
        filterDropdownOptions: Array<{ label: string; value: string }>;
      }>
    ).find((filter: { title: string }): boolean => {
      return filter.title === "Criticality";
    })!;
    // The most that matters first.
    expect(criticalityFilter.filterDropdownOptions).toEqual([
      { label: "Extreme (×2)", value: "Extreme" },
      { label: "High (×1.5)", value: "High" },
      { label: "Low (×0.5)", value: "Low" },
    ]);
    // The table's help is the guide the card shows.
    expect((table["helpContent"] as { markdown: string }).markdown).toBe(
      guideToMarkdown(getEntityRiskGuide(100)),
    );
  });

  test("a row opens its entity's page, with its kind", async () => {
    drawList();
    await screen.findByText("How entity risk works");

    const onViewPage: (item: SecurityEntityRisk) => Promise<Route> = tableById(
      "security-entity-risk-table",
    )["onViewPage"] as (item: SecurityEntityRisk) => Promise<Route>;
    const route: string = (
      await onViewPage(
        riskRow({
          entityValue: "fin-ws-112",
          entityType: SecurityEntityType.Host,
        }),
      )
    ).toString();
    const query: URLSearchParams = new URLSearchParams(route.split("?")[1]);

    expect(route.split("?")[0]).toBe(`${PRODUCT}/entity-risk/entity`);
    expect(query.get("value")).toBe("fin-ws-112");
    expect(query.get("type")).toBe("Host");
  });

  test("a row reads its entity, its kind and how much it matters, and what found it", async () => {
    drawList();
    await screen.findByText("How entity risk works");
    const columns: Array<{
      title: string;
      getElement: (item: SecurityEntityRisk) => ReactElement;
    }> = tableById("security-entity-risk-table")["columns"] as Array<{
      title: string;
      getElement: (item: SecurityEntityRisk) => ReactElement;
    }>;
    const cell: (title: string, item: SecurityEntityRisk) => HTMLElement = (
      title: string,
      item: SecurityEntityRisk,
    ): HTMLElement => {
      const column: {
        getElement: (row: SecurityEntityRisk) => ReactElement;
      } = columns.find((each: { title: string }): boolean => {
        return each.title === title;
      })!;

      return render(<MemoryRouter>{column.getElement(item)}</MemoryRouter>)
        .container;
    };

    const cfo: SecurityEntityRisk = riskRow({
      entityType: SecurityEntityType.User,
      entityValue: "k.morgan@acme-commerce.example",
      criticality: Criticality.Extreme,
      riskScore: 200,
    });
    expect(cell("Entity", cfo)).toHaveTextContent(
      "k.morgan@acme-commerce.exampleUserExtreme (×2)",
    );
    expect(cell("Entity", riskRow({}))).toHaveTextContent(
      /^203\.0\.113\.47IP Address$/,
    );
    expect(cell("Risk", cfo)).toHaveTextContent("200Critical");
    expect(cell("Found By", riskRow({}))).toHaveTextContent(
      "3 sourcesPassword spraying and 2 more",
    );
    expect(
      cell("Found By", riskRow({ contributions: [SPRAY_SOURCES[0]!] })),
    ).toHaveTextContent(/^1 sourceCorporate MISP$/);
    expect(cell("Found By", riskRow({ contributions: [] }))).toHaveTextContent(
      "-",
    );
    // Said as every "last seen" in the product says it.
    expect(cell("Last Risk", riskRow({}))).toHaveTextContent(
      OneUptimeDate.fromNow(new Date(minutesAgo(9))),
    );
  });

  test("the levels and the guide are the project's own threshold's", async () => {
    settings = { securityRiskCaseThreshold: 50, enableSecurityRiskCases: true };
    drawList();

    await screen.findByText("How entity risk works");
    for (const range of ["1 to 24", "25 to 49", "50 to 99", "100 or more"]) {
      expect(screen.getByText(range)).toBeInTheDocument();
    }
    expect(
      (
        tableById("security-entity-risk-table")["helpContent"] as {
          markdown: string;
        }
      ).markdown,
    ).toBe(guideToMarkdown(getEntityRiskGuide(50)));
    expect(getItemMock.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        select: {
          securityRiskCaseThreshold: true,
          enableSecurityRiskCases: true,
        },
      }),
    );
  });

  test("a project whose risk opens no case says so, with the way to Risk Scoring", async () => {
    settings = {
      securityRiskCaseThreshold: 100,
      enableSecurityRiskCases: false,
    };
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});
    drawList();

    const note: HTMLElement = await screen.findByTestId(RISK_CASES_OFF_TEST_ID);
    expect(note).toHaveTextContent(
      "Entities that reach the threshold open no case",
    );
    fireEvent.click(within(note).getByRole("button", { name: /Risk Scoring/ }));
    expect(String(navigate.mock.calls[0]![0])).toBe(
      `${PRODUCT}/settings/risk-scoring`,
    );
  });

  test("settings it cannot read leave a new project's levels, and say nothing about cases", async () => {
    getItemMock.mockImplementation(async () => {
      throw new Error("Not reachable.");
    });
    drawList();

    await screen.findByText("How entity risk works");
    expect(screen.getByText("100 to 199")).toBeInTheDocument();
    expect(screen.queryByTestId(RISK_CASES_OFF_TEST_ID)).toBeNull();
  });
});

/*
 * ---------------------------------------------------------------------------
 * An entity's page
 * ---------------------------------------------------------------------------
 */

describe("an entity's page", () => {
  function drawEntity(query: string): void {
    goTo(`${PRODUCT}/entity-risk/entity${query}`);
    render(
      <MemoryRouter>
        <SecurityEntityRiskViewPage {...pageProps()} />
      </MemoryRouter>,
    );
  }

  function header(): HTMLElement {
    return screen.getByTestId(ENTITY_RISK_TEST_IDS.entityHeader);
  }

  test("reads its risk by its key, and its week of activity", async () => {
    drawEntity("?value=%20203.0.113.47%20&type=IP+Address");

    await waitFor(() => {
      expect(header()).toHaveTextContent("125High");
    });
    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(getListMock.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        modelType: SecurityEntityRisk,
        query: {
          projectId: new ObjectID(PROJECT_ID),
          entityKey: "203.0.113.47",
        },
        limit: 1,
      }),
    );
    expect(getEntityActivityMock.mock.calls[0]![0]).toEqual({
      values: ["203.0.113.47"],
      hours: 7 * 24,
    });
  });

  test("says how risky it is and why: the score, the sources, when it counts from and falls, the case it opened", async () => {
    drawEntity("?value=203.0.113.47&type=IP+Address");

    await waitFor(() => {
      expect(header()).toHaveTextContent("125High");
    });
    expect(header()).toHaveTextContent("IP Address");
    expect(header()).toHaveTextContent("A case opens at 100");
    expect(header()).toHaveTextContent("3 sources");
    const row: SecurityEntityRisk = rows[0]!;
    expect(header()).toHaveTextContent(
      `Counting since ${OneUptimeDate.fromNow(row.firstRiskAt!)}, last finding ${OneUptimeDate.fromNow(row.lastRiskAt!)}`,
    );
    expect(header()).toHaveTextContent(
      `Falls ${OneUptimeDate.fromNow(row.riskExpiresAt!)}, as its oldest source stops counting`,
    );
    expect(header()).toHaveTextContent(
      `Its risk last opened or joined a case ${OneUptimeDate.fromNow(row.riskCaseAt!)}`,
    );
    // Not weighed: no criticality, no sum.
    expect(header()).not.toHaveTextContent("from its sources ×");
    expect(within(header()).getByRole("meter")).toHaveAttribute(
      "aria-valuenow",
      "125",
    );

    const sources: HTMLElement = screen.getByTestId(
      ENTITY_RISK_TEST_IDS.sources,
    );
    const sourceRows: Array<string> = within(sources)
      .getAllByRole("row")
      .slice(1)
      .map((row: HTMLElement): string => {
        return row.textContent || "";
      });
    expect(sourceRows[0]).toContain("Password spraying");
    expect(sourceRows[1]).toContain("Spray, then a success");
    expect(sourceRows[2]).toContain("Corporate MISP");
    expect(
      screen.getByTestId(ENTITY_RISK_TEST_IDS.history),
    ).toBeInTheDocument();
    expect(screen.getByTestId(ENTITY_RISK_TEST_IDS.activity)).toHaveTextContent(
      "475",
    );

    // The cases about it: the ones grouped on it.
    const cases: Record<string, unknown> = tableById("entity-risk-cases-table");
    expect(cases["modelType"]).toBe(SecurityCase);
    expect(cases["query"]).toEqual({
      projectId: new ObjectID(PROJECT_ID),
      groupingKey: "entity:203.0.113.47",
    });
    expect(cases["sortBy"]).toBe("lastDetectedAt");
  });

  test("its criticality weighs the sum of its sources into its score", async () => {
    rows = [
      riskRow({
        entityType: SecurityEntityType.User,
        entityValue: "k.morgan@acme-commerce.example",
        criticality: Criticality.Extreme,
        riskScore: 250,
      }),
    ];
    drawEntity("?value=k.morgan%40acme-commerce.example");

    await waitFor(() => {
      expect(header()).toHaveTextContent("250Critical");
    });
    expect(header()).toHaveTextContent("125 from its sources × 2 = 250");
    expect(
      within(header()).getByTestId(ENTITY_RISK_TEST_IDS.criticalityPill),
    ).toHaveTextContent("Extreme (×2)");
    // The row's kind, over what the value looks like.
    expect(header()).toHaveTextContent("User");
  });

  test("Reset Risk asks first, deletes the row and reads again", async () => {
    drawEntity("?value=203.0.113.47&type=IP+Address");
    await waitFor(() => {
      expect(header()).toHaveTextContent("125High");
    });

    fireEvent.click(screen.getByTestId(ENTITY_RISK_TEST_IDS.reset));
    expect(screen.getByText("Reset this entity's risk?")).toBeInTheDocument();
    expect(deleteItemMock).not.toHaveBeenCalled();

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Reset Risk",
      }),
    );

    await waitFor(() => {
      expect(header()).toHaveTextContent(
        "Nothing found about it counts toward risk in the last 7 days.",
      );
    });
    expect(deleteItemMock).toHaveBeenCalledTimes(1);
    expect(deleteItemMock.mock.calls[0]![0]).toEqual({
      modelType: SecurityEntityRisk,
      id: new ObjectID(ROW_ID),
    });
    expect(getListMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId(ENTITY_RISK_TEST_IDS.reset)).toBeNull();
    expect(screen.queryByTestId(ENTITY_RISK_TEST_IDS.sources)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a reset the server refuses says why in the dialog, and keeps the risk", async () => {
    deleteItemMock.mockImplementation(async () => {
      throw new Error("You do not have permission to delete Entity Risk.");
    });
    drawEntity("?value=203.0.113.47&type=IP+Address");
    await waitFor(() => {
      expect(header()).toHaveTextContent("125High");
    });

    fireEvent.click(screen.getByTestId(ENTITY_RISK_TEST_IDS.reset));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Reset Risk",
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "You do not have permission to delete Entity Risk.",
      );
    });
    expect(header()).toHaveTextContent("125High");
  });

  test("Reset Risk is locked, with why, for whoever may not delete security data; left out while permissions load", async () => {
    resetGate = {
      isAllowed: false,
      disabledReason: "You need the Delete Security Detection permission.",
    };
    drawEntity("?value=203.0.113.47&type=IP+Address");
    await waitFor(() => {
      expect(header()).toHaveTextContent("125High");
    });

    expect(screen.getByTestId(ENTITY_RISK_TEST_IDS.reset)).toBeDisabled();
    expect(
      screen.getByTestId(`${ENTITY_RISK_TEST_IDS.reset}-disabled-wrapper`),
    ).toBeInTheDocument();

    cleanup();
    resetGate = { isAllowed: false };
    drawEntity("?value=203.0.113.47&type=IP+Address");
    await waitFor(() => {
      expect(header()).toHaveTextContent("125High");
    });
    expect(screen.queryByTestId(ENTITY_RISK_TEST_IDS.reset)).toBeNull();
  });

  test("a risk that cannot be read says so, and Try again reads it", async () => {
    getListMock.mockImplementationOnce(async () => {
      throw new Error("Postgres is not reachable.");
    });
    drawEntity("?value=203.0.113.47");

    await waitFor(() => {
      expect(header()).toHaveTextContent("Postgres is not reachable.");
    });
    fireEvent.click(
      within(header()).getByRole("button", { name: /Try again|Refresh/i }),
    );
    await waitFor(() => {
      expect(header()).toHaveTextContent("125High");
    });
    expect(getListMock).toHaveBeenCalledTimes(2);
  });

  test("an entity whose sources went quiet keeps its month; one nothing scored says so, by the kind its link names", async () => {
    rows = [
      riskRow({
        entityType: SecurityEntityType.Host,
        entityValue: "old-laptop-9",
        riskScore: 0,
        contributions: [],
        riskHistory: [{ day: "2026-10-10", score: 25 }],
        riskExpiresAt: undefined,
        riskCaseAt: undefined,
      }),
    ];
    drawEntity("?value=old-laptop-9");

    await waitFor(() => {
      expect(header()).toHaveTextContent(
        "Nothing found about it counts toward risk in the last 7 days.",
      );
    });
    expect(
      screen.getByTestId(ENTITY_RISK_TEST_IDS.history),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(ENTITY_RISK_TEST_IDS.sources)).toBeNull();
    expect(screen.queryByTestId(ENTITY_RISK_TEST_IDS.reset)).toBeNull();

    cleanup();
    rows = [];
    drawEntity("?value=build-runner-07&type=Host");
    await waitFor(() => {
      expect(header()).toHaveTextContent(
        "Nothing found about it counts toward risk in the last 7 days.",
      );
    });
    expect(header()).toHaveTextContent("Host");
    expect(screen.queryByTestId(ENTITY_RISK_TEST_IDS.history)).toBeNull();
    // Its cases still: the ones grouped on it.
    expect(tableById("entity-risk-cases-table")["query"]).toEqual({
      projectId: new ObjectID(PROJECT_ID),
      groupingKey: "entity:build-runner-07",
    });
  });

  test("with no entity named, it asks which, and reads nothing", () => {
    drawEntity("");

    expect(screen.getByTestId(ENTITY_RISK_TEST_IDS.notNamed)).toHaveTextContent(
      "Which entity? This page opens on a user, a host or an address",
    );
    expect(getListMock).not.toHaveBeenCalled();
    expect(getEntityActivityMock).not.toHaveBeenCalled();
  });

  test("Search Its Events opens the Events explorer on its week", () => {
    const route: string = getEntityEventsRoute(
      "k.morgan@acme-commerce.example",
      NOW,
    ).toString();
    const query: URLSearchParams = new URLSearchParams(route.split("?")[1]);

    expect(route.split("?")[0]).toBe(PRODUCT);
    expect(query.get("search")).toBe(
      "observable:k.morgan@acme-commerce.example",
    );
    expect(query.get("range")).toBe("Custom");
    expect(query.get("end")).toBe(NOW.toISOString());
    expect(query.get("start")).toBe(
      new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Settings > Risk Scoring
 * ---------------------------------------------------------------------------
 */

describe("Settings > Risk Scoring", () => {
  function drawSettings(): void {
    render(
      <MemoryRouter>
        <SecurityRiskScoringPage {...pageProps()} />
      </MemoryRouter>,
    );
  }

  test("one switch, saved as it flips: whether risk opens cases", () => {
    drawSettings();

    const toggle: Record<string, unknown> = recordedSwitches[0]!;
    expect(toggle["column"]).toBe("enableSecurityRiskCases");
    expect(toggle["dataTestId"]).toBe(ENTITY_RISK_TEST_IDS.riskCasesSwitch);
    expect(String(toggle["modelId"])).toBe(PROJECT_ID);
    const describeIt: (isOn: boolean) => string = toggle["getDescription"] as (
      isOn: boolean,
    ) => string;
    expect(describeIt(true)).toBe(
      "An entity that reaches the threshold opens a case, at High, or Critical from twice the threshold.",
    );
    expect(describeIt(false)).toBe(
      "Risk is still scored and listed under Entity Risk. No case opens from it.",
    );
  });

  test("the threshold: a whole number from 10 to 10000, said in the product's words", () => {
    drawSettings();

    const detail: Record<string, unknown> = recordedDetails[0]!;
    const field: {
      title: string;
      validation: { minValue: number; maxValue: number };
      customValidation: (values: Record<string, unknown>) => string | null;
    } = (
      detail["formFields"] as Array<{
        title: string;
        validation: { minValue: number; maxValue: number };
        customValidation: (values: Record<string, unknown>) => string | null;
      }>
    )[0]!;

    expect(field.title).toBe("Open a Case At");
    expect(field.validation).toEqual({ minValue: 10, maxValue: 10000 });
    for (const bad of [5, 12.5, 10001, "abc", ""]) {
      expect([
        bad,
        field.customValidation({ securityRiskCaseThreshold: bad }),
      ]).toEqual([
        bad,
        "The risk threshold is a whole number from 10 to 10000.",
      ]);
    }
    for (const good of [10, 150, "150", 10000]) {
      expect([
        good,
        field.customValidation({ securityRiskCaseThreshold: good }),
      ]).toEqual([good, null]);
    }
  });

  test("Entity Criticality: each value or pattern, how much it matters and for which kind", () => {
    drawSettings();

    const table: Record<string, unknown> = tableById(
      ENTITY_RISK_TEST_IDS.criticalityTable,
    );
    expect(table["modelType"]).toBe(SecurityEntityCriticality);
    expect(table["singularName"]).toBe("Entity");
    expect(table["pluralName"]).toBe("Entities");
    expect(table["createVerb"]).toBe("Add");
    expect(table["sortBy"]).toBe("value");
    expect(table["sortOrder"]).toBe(SortOrder.Ascending);
    expect(table["createInitialValues"]).toEqual({ criticality: "High" });
    expect(columnTitles(table)).toEqual([
      "Value",
      "Criticality",
      "Type",
      "Description",
    ]);
    const fields: Array<{
      title: string;
      required: boolean;
      dropdownOptions?: Array<{ label: string; value: string }>;
    }> = table["formFields"] as Array<{
      title: string;
      required: boolean;
      dropdownOptions?: Array<{ label: string; value: string }>;
    }>;
    expect(
      fields.map((each: { title: string; required: boolean }) => {
        return [each.title, each.required];
      }),
    ).toEqual([
      ["Value", true],
      ["Criticality", true],
      ["Type", false],
      ["Description", false],
    ]);
    expect(fields[1]!.dropdownOptions).toEqual([
      { label: "Extreme (×2)", value: "Extreme" },
      { label: "High (×1.5)", value: "High" },
      { label: "Low (×0.5)", value: "Low" },
    ]);
    // Only the kinds risk is kept for.
    expect(
      fields[2]!.dropdownOptions!.map((option: { value: string }) => {
        return option.value;
      }),
    ).toEqual([
      SecurityEntityType.User,
      SecurityEntityType.Host,
      SecurityEntityType.IpAddress,
    ]);
  });
});
