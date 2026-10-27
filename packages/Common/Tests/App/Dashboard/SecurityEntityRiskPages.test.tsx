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
  act,
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
// Where OneUptime knows the entity: its page's Connected Signals card.
const getConnectionsMock: MockFunction = getJestMockFunction();

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
        getConnections: (...args: Array<unknown>): unknown => {
          return getConnectionsMock(...args);
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
import {
  ENTITY_RISK_HEADER_BUTTONS_CLASS_NAME,
  ENTITY_RISK_HEADER_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/EntityRisk/EntityRiskHeader";
import {
  SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME,
  SECURITY_CASE_HEADER_CHIPS_CLASS_NAME,
  SECURITY_CASE_HEADER_CLASS_NAME,
  SECURITY_CASE_HEADER_TOP_ROW_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseHeaderLayout";
import SecurityEntityRiskViewPage, {
  getEntityEventsRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/EntityRiskView";
import SecurityRiskScoringPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Settings/RiskScoring";
import {
  ENTITY_LOOKUP_HOURS,
  ENTITY_LOOKUP_TEST_IDS,
  ENTITY_RISK_TEST_IDS,
  RISK_CASES_OFF_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/EntityRisk/EntityRiskCopy";
import {
  ENTITY_LOOKUP_RESULT_CLASS_NAME,
  isEntityActivitySeen,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/EntityRisk/EntityLookupCard";
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
import { MORE_FIELDS_SECTION_TITLE } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import {
  TableCardContext,
  TableCellContext,
} from "../../../UI/Components/Table/TableCellContext";

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
  // The guide remembers a reader's Show or Hide in this browser: each test starts unchosen.
  window.localStorage.clear();
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
  getConnectionsMock.mockReset();
  getConnectionsMock.mockImplementation(async () => {
    return {
      windowStart: "",
      windowEnd: "",
      resources: [],
      hasMoreResources: false,
      unmatched: [
        { type: SecurityEntityType.IpAddress, value: "203.0.113.47" },
      ],
      unreadableKinds: [],
      failedKinds: [],
    };
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

  // The list's first read, as ModelTable reports it: how many entities have risk.
  async function listRead(total: number): Promise<void> {
    const onFetchSuccess: (
      items: Array<SecurityEntityRisk>,
      count: number,
    ) => void = tableById("security-entity-risk-table")["onFetchSuccess"] as (
      items: Array<SecurityEntityRisk>,
      count: number,
    ) => void;

    await act(async () => {
      onFetchSuccess([], total);
    });
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
    // A row is an entity: "Showing 1-9 of 9 entities", never "entity risks".
    expect(table["singularName"]).toBe("Entity");
    expect(table["pluralName"]).toBe("Entities");
    expect(columnTitles(table)).toEqual([
      "Entity",
      "Risk",
      "Found By",
      "ATT&CK Tactics",
      "Last Finding",
    ]);
    // A phone's card: the entity untitled, its risk under it, no Risk field.
    const columns: Array<{
      title: string;
      hideOnMobile?: boolean;
      hideTitleOnMobile?: boolean;
    }> = table["columns"] as Array<{
      title: string;
      hideOnMobile?: boolean;
      hideTitleOnMobile?: boolean;
    }>;
    expect(columns[0]!.hideTitleOnMobile).toBe(true);
    expect(columns[0]!.hideOnMobile).toBeFalsy();
    expect(
      columns
        .filter((column: { hideOnMobile?: boolean }): boolean => {
          return Boolean(column.hideOnMobile);
        })
        .map((column: { title: string }): string => {
          return column.title;
        }),
    ).toEqual(["Risk", "Found By", "ATT&CK Tactics", "Last Finding"]);
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
    ).toEqual(["Entity", "Type", "Criticality", "Last Finding"]);
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
    /*
     * The entity as Security Events draws one everywhere (the chip of
     * Entities and a case's Entities): its value whole on hover, and no link
     * of its own - the row opens the entity's page.
     */
    const chip: HTMLElement = within(cell("Entity", cfo)).getByTitle(
      "k.morgan@acme-commerce.example",
    );
    expect(chip).toHaveClass("truncate", "font-mono");
    expect(chip.closest("a")).toBeNull();
    expect(cell("Risk", cfo)).toHaveTextContent("200Critical");
    expect(cell("Found By", riskRow({}))).toHaveTextContent(
      "3 sourcesPassword spraying and 2 more",
    );
    expect(
      cell("Found By", riskRow({ contributions: [SPRAY_SOURCES[0]!] })),
    ).toHaveTextContent(/^1 sourceCorporate MISP$/);
    /*
     * A source's name alone is someone's words: an isolate that reads the
     * way it is written and is cut at its own end on a Persian page too -
     * the value, like the chip's, never "...do Tracker botnet C2 servers".
     */
    const oneSource: HTMLElement = within(
      cell("Found By", riskRow({ contributions: [SPRAY_SOURCES[0]!] })),
    ).getByText("Corporate MISP");
    expect(oneSource.tagName).toBe("BDI");
    expect(oneSource).toHaveAttribute("dir", "ltr");
    expect(oneSource).toHaveClass("block", "truncate");
    expect(oneSource).toHaveAttribute("title", "Corporate MISP");
    // The chip's value is one too.
    expect(chip.tagName).toBe("BDI");
    expect(chip).toHaveAttribute("dir", "ltr");
    expect(cell("Found By", riskRow({ contributions: [] }))).toHaveTextContent(
      "-",
    );
    // Said as every "last seen" in the product says it.
    expect(cell("Last Finding", riskRow({}))).toHaveTextContent(
      OneUptimeDate.fromNow(new Date(minutesAgo(9))),
    );

    // A phone's card has no Risk field: the entity's own cell says its risk.
    const entityColumn: {
      getElement: (row: SecurityEntityRisk) => ReactElement;
    } = columns.find((each: { title: string }): boolean => {
      return each.title === "Entity";
    })!;
    const card: HTMLElement = render(
      <MemoryRouter>
        <TableCellContext.Provider value={true}>
          <TableCardContext.Provider value={true}>
            {entityColumn.getElement(cfo)}
          </TableCardContext.Provider>
        </TableCellContext.Provider>
      </MemoryRouter>,
    ).container;
    expect(card).toHaveTextContent(
      "k.morgan@acme-commerce.exampleUserExtreme (×2)200Critical",
    );
    expect(within(card).getByRole("meter")).toHaveAttribute(
      "aria-valuenow",
      "200",
    );
    // A card's value runs onto a second line rather than ending in "...".
    expect(
      within(card).getByTitle("k.morgan@acme-commerce.example"),
    ).not.toHaveClass("truncate");
    // In a row of the table, the Risk column says it: not twice.
    expect(within(cell("Entity", cfo)).queryByRole("meter")).toBeNull();
  });

  test("the guide waits folded over a list with rows, opens over an empty one, and the reader's choice wins", async () => {
    drawList();
    await screen.findByText("How entity risk works");
    // Folded while the list is read, and still when it has rows.
    expect(screen.queryByText("Findings add points")).toBeNull();
    await listRead(9);
    expect(screen.queryByText("Findings add points")).toBeNull();
    expect(screen.getByRole("button", { name: /Show/ })).toBeInTheDocument();

    // Shown by the reader, and remembered for the next visit.
    fireEvent.click(screen.getByRole("button", { name: /Show/ }));
    expect(screen.getByText("Findings add points")).toBeInTheDocument();
    cleanup();
    drawList();
    await screen.findByText("How entity risk works");
    await listRead(9);
    expect(screen.getByText("Findings add points")).toBeInTheDocument();

    // A new project's empty list: how it works, open by itself.
    cleanup();
    window.localStorage.clear();
    drawList();
    await screen.findByText("How entity risk works");
    await listRead(0);
    expect(screen.getByText("Findings add points")).toBeInTheDocument();

    // The first read decides: a search that finds nothing does not open it.
    cleanup();
    drawList();
    await screen.findByText("How entity risk works");
    await listRead(9);
    await listRead(0);
    expect(screen.queryByText("Findings add points")).toBeNull();
  });

  test("the levels and the guide are the project's own threshold's", async () => {
    settings = { securityRiskCaseThreshold: 50, enableSecurityRiskCases: true };
    drawList();

    await screen.findByText("How entity risk works");
    // Over an empty list the guide is open.
    await listRead(0);
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
    await listRead(0);
    expect(screen.getByText("100 to 199")).toBeInTheDocument();
    expect(screen.queryByTestId(RISK_CASES_OFF_TEST_ID)).toBeNull();
  });

  /*
   * Look Up an Entity came from Security Events > Entities, which folded
   * into Entity Risk: its ranking of values by how many findings named them
   * was a second "riskiest" beside these scores. The lookup is the part of
   * it that was its own - any value, of any kind, across 30 days of events.
   */
  test("Look Up an Entity sits under the list: any value, of any kind, across 30 days of events", async () => {
    drawList();

    const lookup: HTMLElement = await screen.findByTestId(
      ENTITY_LOOKUP_TEST_IDS.card,
    );
    const list: HTMLElement = screen.getByTestId(
      "model-table-security-entity-risk-table",
    );

    // After the list in the page's order: the riskiest lead, the lookup follows.
    expect(
      list.compareDocumentPosition(lookup) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("Look Up an Entity")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Any user, host, IP address, domain or file hash: how often it appears in your security events over the last 30 days, and in how many findings.",
      ),
    ).toBeInTheDocument();
    // Named for a screen reader as its card is: a placeholder is no name.
    expect(screen.getByRole("textbox", { name: "Look Up an Entity" })).toBe(
      screen.getByTestId(ENTITY_LOOKUP_TEST_IDS.input),
    );
    expect(
      screen
        .getByTestId(ENTITY_LOOKUP_TEST_IDS.input)
        .getAttribute("placeholder"),
    ).toBe("e.g. alice@example.com, web-01 or 203.0.113.7");
    // Nothing to look up yet: Look Up waits for a value.
    expect(screen.getByRole("button", { name: "Look Up" })).toBeDisabled();
    expect(getEntityActivityMock).not.toHaveBeenCalled();
  });

  test("a lookup says how busy the value has been, in 30 days of events, and opens it in Correlate", async () => {
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});
    getEntityActivityMock.mockImplementation(async () => {
      return [
        {
          value: "update-sync.bad-cdn.example",
          eventCount: 412,
          findingCount: 3,
          maxSeverityId: 4,
          firstSeen: new Date(minutesAgo(3 * 60)),
          // "5 minutes ago" reads off the real clock, not the suite's NOW.
          lastSeen: new Date(Date.now() - 5 * 60 * 1000),
        },
      ];
    });
    drawList();

    fireEvent.change(await screen.findByTestId(ENTITY_LOOKUP_TEST_IDS.input), {
      target: { value: "  update-sync.bad-cdn.example " },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Look Up" }));
    });

    // The value as typed, without its spaces, over 30 days.
    expect(getEntityActivityMock).toHaveBeenCalledWith({
      values: ["update-sync.bad-cdn.example"],
      hours: ENTITY_LOOKUP_HOURS,
    });
    expect(ENTITY_LOOKUP_HOURS).toBe(720);

    const result: HTMLElement = screen.getByTestId(
      ENTITY_LOOKUP_TEST_IDS.result,
    );
    expect(result).toHaveTextContent("update-sync.bad-cdn.example");
    expect(result).toHaveTextContent("412 events");
    expect(result).toHaveTextContent("3 findings");
    expect(result).toHaveTextContent("Last seen 5 minutes ago");

    await act(async () => {
      fireEvent.click(
        within(result).getByRole("button", { name: "Open in Correlate" }),
      );
    });

    const route: string = String(navigate.mock.calls[0]![0]);
    expect(route.split("?")[0]).toBe(`${PRODUCT}/correlate`);
    expect(new URLSearchParams(route.split("?")[1]).get("observable")).toBe(
      "update-sync.bad-cdn.example",
    );
    /*
     * Over the 30 days the lookup read: Correlate's own day showed nothing
     * for a value last seen a week ago that the lookup had just counted.
     */
    expect(new URLSearchParams(route.split("?")[1]).get("hours")).toBe(
      String(ENTITY_LOOKUP_HOURS),
    );
  });

  /*
   * The value, with what was found about it on the line under it, and Open
   * in Correlate at the result's end from sm - placed by the room the page
   * has, never by where a wrap falls: it wrapped under the counts, a
   * dialog footer's margin (md:ml-3) setting it in from the value. The
   * value is not a second way to Correlate (its chip opened Correlate's
   * own day); the button is the one.
   */
  test("a lookup's result: the value, its counts on the line under it, and Open in Correlate at the line's end", async () => {
    getEntityActivityMock.mockImplementation(async () => {
      return [
        {
          value: "fin-ws-112",
          eventCount: 1,
          findingCount: 1,
          maxSeverityId: 4,
          firstSeen: new Date(minutesAgo(3 * 60)),
          lastSeen: new Date(Date.now() - 5 * 60 * 1000),
        },
      ];
    });
    drawList();

    fireEvent.change(await screen.findByTestId(ENTITY_LOOKUP_TEST_IDS.input), {
      target: { value: "fin-ws-112" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Look Up" }));
    });

    const result: HTMLElement = screen.getByTestId(
      ENTITY_LOOKUP_TEST_IDS.result,
    );

    expect(result.className).toBe(ENTITY_LOOKUP_RESULT_CLASS_NAME);
    expect(ENTITY_LOOKUP_RESULT_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining([
        "flex-col",
        "sm:flex-row",
        "sm:items-center",
        "sm:justify-between",
      ]),
    );
    expect(ENTITY_LOOKUP_RESULT_CLASS_NAME).not.toContain("flex-wrap");

    // One of each, in the reader's words, each a whole on its line.
    expect(
      Array.from(
        within(result).getByTestId(ENTITY_LOOKUP_TEST_IDS.facts).children,
      ).map((fact: Element): string => {
        return fact.textContent || "";
      }),
    ).toEqual(["1 event", "1 finding", "Last seen 5 minutes ago"]);

    // The value is no link: Open in Correlate is the one way on.
    expect(within(result).getByText("fin-ws-112").closest("a")).toBeNull();
    const button: HTMLElement = within(result).getByRole("button", {
      name: "Open in Correlate",
    });
    expect(button.className.split(" ")).toEqual(
      expect.arrayContaining(["!ml-0", "sm:!w-auto"]),
    );
    // At the result's end: after what was found, the last of it.
    expect(result.lastElementChild).toBe(button);
    expect(
      within(result)
        .getByTestId(ENTITY_LOOKUP_TEST_IDS.facts)
        .compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Look Up keeps no dialog footer's margin either.
    expect(
      screen.getByRole("button", { name: "Look Up" }).className.split(" "),
    ).toEqual(expect.arrayContaining(["!ml-0", "sm:!w-auto"]));
  });

  test("Enter looks up too, and a value no event names says it was not seen", async () => {
    getEntityActivityMock.mockImplementation(async () => {
      return [];
    });
    drawList();

    const input: HTMLElement = await screen.findByTestId(
      ENTITY_LOOKUP_TEST_IDS.input,
    );
    fireEvent.change(input, { target: { value: "never-seen-01" } });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    });

    const result: HTMLElement = await screen.findByTestId(
      ENTITY_LOOKUP_TEST_IDS.result,
    );
    expect(result).toHaveTextContent("never-seen-01");
    expect(
      within(result).getByTestId(ENTITY_LOOKUP_TEST_IDS.facts),
    ).toHaveTextContent(/^Not seen in the last 30 days\.$/);
    // No counts of nothing, and nothing to correlate.
    expect(result).not.toHaveTextContent("0 events");
    expect(result).not.toHaveTextContent("0 findings");
    expect(
      within(result).queryByRole("button", { name: "Open in Correlate" }),
    ).toBeNull();
  });

  /*
   * A lookup's answer - what it found, or why it could not look - is said
   * to a screen reader as it arrives: the live region is on the page
   * before anything is in it. And a new lookup's answer replaces the last
   * one's: a failed lookup of one value left the last value's counts
   * under its error.
   */
  test("a lookup's answer is said in a live region that is there before it, and a new lookup replaces the last answer", async () => {
    getEntityActivityMock.mockImplementationOnce(async () => {
      return [
        {
          value: "fin-ws-112",
          eventCount: 3,
          findingCount: 1,
          maxSeverityId: 4,
          firstSeen: new Date(minutesAgo(3 * 60)),
          lastSeen: new Date(Date.now() - 5 * 60 * 1000),
        },
      ];
    });
    getEntityActivityMock.mockImplementationOnce(async () => {
      throw Object.assign(
        new Error(
          "Reading security events takes a Security role, or Project Owner or Project Admin.",
        ),
        { statusCode: 403 },
      );
    });
    drawList();

    const answer: HTMLElement = await screen.findByTestId(
      ENTITY_LOOKUP_TEST_IDS.answer,
    );
    expect(answer).toHaveAttribute("aria-live", "polite");
    expect(answer).toBeEmptyDOMElement();

    const input: HTMLElement = screen.getByTestId(ENTITY_LOOKUP_TEST_IDS.input);
    fireEvent.change(input, { target: { value: "fin-ws-112" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Look Up" }));
    });

    expect(
      within(answer).getByTestId(ENTITY_LOOKUP_TEST_IDS.result),
    ).toHaveTextContent("fin-ws-112");

    fireEvent.change(input, { target: { value: "web-01" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Look Up" }));
    });

    expect(answer).toHaveTextContent(
      "Reading security events takes a Security role, or Project Owner or Project Admin.",
    );
    expect(screen.queryByTestId(ENTITY_LOOKUP_TEST_IDS.result)).toBeNull();
    expect(answer).not.toHaveTextContent("fin-ws-112");
  });

  test("a value is seen when an event named it in the days read: by a count, or by when it was last seen", () => {
    const nothing: {
      value: string;
      eventCount: number;
      findingCount: number;
      maxSeverityId: number;
      firstSeen: Date | null;
      lastSeen: Date | null;
    } = {
      value: "web-01",
      eventCount: 0,
      findingCount: 0,
      maxSeverityId: 0,
      firstSeen: null,
      lastSeen: null,
    };

    expect(isEntityActivitySeen(nothing)).toBe(false);
    expect(isEntityActivitySeen({ ...nothing, eventCount: 1 })).toBe(true);
    expect(
      isEntityActivitySeen({ ...nothing, lastSeen: new Date(minutesAgo(5)) }),
    ).toBe(true);
  });

  test.each([
    [
      "a failure on OneUptime's side, in the product's words",
      Object.assign(new Error("socket hang up"), { statusCode: 502 }),
      "Something went wrong. Try again in a moment.",
      "socket hang up",
    ],
    [
      "a role that may not read events, as the server words it",
      Object.assign(
        new Error(
          "Reading security events takes a Security role, or Project Owner or Project Admin.",
        ),
        { statusCode: 403 },
      ),
      "Reading security events takes a Security role, or Project Owner or Project Admin.",
      null,
    ],
  ])(
    "a lookup that fails says why: %s",
    async (
      _what: string,
      failure: Error,
      said: string,
      neverSaid: string | null,
    ) => {
      getEntityActivityMock.mockImplementation(async () => {
        throw failure;
      });
      drawList();

      fireEvent.change(
        await screen.findByTestId(ENTITY_LOOKUP_TEST_IDS.input),
        { target: { value: "web-01" } },
      );

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Look Up" }));
      });

      expect(screen.getByText(said)).toBeInTheDocument();
      expect(screen.queryByTestId(ENTITY_LOOKUP_TEST_IDS.result)).toBeNull();

      if (neverSaid) {
        expect(document.body).not.toHaveTextContent(neverSaid);
      }
    },
  );

  /*
   * The box's own margins (mt-2 mb-1) stretched Look Up 12px taller than
   * the box beside it, the box sitting high. jsdom lays nothing out: the
   * offline browser suite measures the two; this holds the classes.
   */
  test("the lookup's box keeps no margins of its own, and shares a line with Look Up", async () => {
    drawList();

    const box: HTMLElement = await screen.findByTestId(
      ENTITY_LOOKUP_TEST_IDS.input,
    );
    const boxWrapper: HTMLElement = box.parentElement as HTMLElement;

    expect(boxWrapper.className.split(" ")).not.toContain("mt-2");
    expect(boxWrapper.className.split(" ")).not.toContain("mb-1");
    expect(
      (
        screen
          .getByRole("button", { name: "Look Up" })
          .closest(".sm\\:flex-row") as HTMLElement
      ).className.split(" "),
    ).toEqual(expect.arrayContaining(["sm:flex-row", "sm:items-center"]));
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

  // The header's ⋯, where Reset Risk waits; the menu it opens.
  async function openMore(): Promise<HTMLElement> {
    await act(async () => {
      fireEvent.click(screen.getByTestId(ENTITY_RISK_HEADER_TEST_IDS.more));
    });

    return screen.getByRole("menu");
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

  test("says where OneUptime knows it, around its last event, once its activity is in", async () => {
    drawEntity("?value=203.0.113.47&type=IP+Address");

    await waitFor(() => {
      expect(getConnectionsMock).toHaveBeenCalledTimes(1);
    });
    expect(getConnectionsMock.mock.calls[0]![0]).toEqual({
      entities: [{ type: SecurityEntityType.IpAddress, value: "203.0.113.47" }],
      time: new Date(minutesAgo(9)),
      // An entity's page also reads the logs behind its events.
      readLogResources: true,
    });
    expect(
      await screen.findByTestId("security-connected-not-found"),
    ).toHaveTextContent("203.0.113.47");
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

    /*
     * Laid out as a case's header is: its kind first, the entity as the
     * page's one heading, and the ways into investigating it named as a
     * group, after the heading as they are read.
     */
    expect(header()).toHaveClass(...SECURITY_CASE_HEADER_CLASS_NAME.split(" "));
    expect(
      within(header()).getByTestId(ENTITY_RISK_HEADER_TEST_IDS.kind),
    ).toHaveTextContent("IP Address");
    expect(
      within(header()).getByTestId(ENTITY_RISK_HEADER_TEST_IDS.kind)
        .parentElement,
    ).toHaveClass(...SECURITY_CASE_HEADER_CHIPS_CLASS_NAME.split(" "));
    expect(
      within(header()).getByRole("heading", { level: 1 }),
    ).toHaveTextContent(/^203\.0\.113\.47$/);
    const actions: HTMLElement = within(header()).getByRole("group", {
      name: "Entity actions",
    });
    expect(actions).toHaveClass(
      ...SECURITY_CASE_HEADER_ACTIONS_CLASS_NAME.split(" "),
    );
    expect(actions.parentElement).toHaveClass(
      ...SECURITY_CASE_HEADER_TOP_ROW_CLASS_NAME.split(" "),
    );
    expect(
      within(actions)
        .getAllByRole("button")
        .map((button: HTMLElement): string => {
          return (
            button.getAttribute("aria-label") ||
            button.textContent ||
            ""
          ).trim();
        }),
    ).toEqual([
      "Open in Correlate",
      "Search Its Events",
      "More entity actions",
    ]);
    expect(
      within(actions).getByTestId(ENTITY_RISK_HEADER_TEST_IDS.openInCorrelate)
        .parentElement,
    ).toHaveClass(ENTITY_RISK_HEADER_BUTTONS_CLASS_NAME);
    // Reset Risk is not a button of the header: it waits under the ⋯.
    expect(screen.queryByTestId(ENTITY_RISK_TEST_IDS.reset)).toBeNull();

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
    // Its week: the counts say so, and its last event says when - no "first seen".
    const activity: HTMLElement = screen.getByTestId(
      ENTITY_RISK_TEST_IDS.activity,
    );
    expect(activity).toHaveTextContent("475");
    expect(activity).toHaveTextContent("36");
    expect(within(activity).getAllByText("In the last 7 days")).toHaveLength(2);
    expect(activity).toHaveTextContent("Last Seen");
    expect(activity).not.toHaveTextContent("First Seen");
    // How often each source fired, as a case's Detections say it.
    expect(sourceRows[0]).toContain("14 times");
    expect(sourceRows[1]).toContain("1 time");
    expect(
      within(sources)
        .getAllByRole("columnheader")
        .map((cell: HTMLElement): string => {
          return (cell.textContent || "").trim();
        }),
    ).toEqual(
      expect.arrayContaining(["Source", "Severity", "Points", "Fired"]),
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

    const menu: HTMLElement = await openMore();
    const item: HTMLElement = within(menu).getByRole("menuitem", {
      name: "Reset Risk",
    });
    expect(item).toHaveAttribute("data-testid", ENTITY_RISK_TEST_IDS.reset);
    expect(item).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(item);
    expect(screen.getByText("Reset this entity's risk?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Its score and its sources are cleared, and what is found next counts from zero. Use it after a planned test, for instance. Its cases are not changed.",
      ),
    ).toBeInTheDocument();
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
    // No risk left to reset: no ⋯ either.
    expect(screen.queryByTestId(ENTITY_RISK_TEST_IDS.reset)).toBeNull();
    expect(screen.queryByTestId(ENTITY_RISK_HEADER_TEST_IDS.more)).toBeNull();
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

    fireEvent.click(
      within(await openMore()).getByRole("menuitem", { name: "Reset Risk" }),
    );
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

    // Locked where it waits, saying why, and pressing it opens nothing.
    const item: HTMLElement = within(await openMore()).getByRole("menuitem", {
      name: "Reset Risk",
    });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAccessibleDescription(
      "You need the Delete Security Detection permission.",
    );
    fireEvent.click(item);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteItemMock).not.toHaveBeenCalled();

    // While the permissions are still being read: no ⋯ at all.
    cleanup();
    resetGate = { isAllowed: false };
    drawEntity("?value=203.0.113.47&type=IP+Address");
    await waitFor(() => {
      expect(header()).toHaveTextContent("125High");
    });
    expect(screen.queryByTestId(ENTITY_RISK_HEADER_TEST_IDS.more)).toBeNull();
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
    // Nothing to reset, so no ⋯; the ways into its events stay.
    expect(screen.queryByTestId(ENTITY_RISK_HEADER_TEST_IDS.more)).toBeNull();
    expect(
      screen.getByTestId(ENTITY_RISK_HEADER_TEST_IDS.searchItsEvents),
    ).toBeInTheDocument();

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

  test("with no entity named, it asks which, reads nothing, and opens Entity Risk", () => {
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});
    drawEntity("");

    const notNamed: HTMLElement = screen.getByTestId(
      ENTITY_RISK_TEST_IDS.notNamed,
    );
    expect(notNamed).toHaveTextContent(
      "Which entity? This page opens on a user, a host or an address",
    );
    expect(getListMock).not.toHaveBeenCalled();
    expect(getEntityActivityMock).not.toHaveBeenCalled();

    // The one way on: the list of every entity with risk.
    fireEvent.click(
      within(notNamed).getByRole("button", { name: "Open Entity Risk" }),
    );
    expect(String(navigate.mock.calls[0]![0])).toBe(`${PRODUCT}/entity-risk`);
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
    // The optional kind and description wait under More fields.
    expect(
      (
        table["formFields"] as Array<{
          title: string;
          collapsibleSection?: { title: string };
        }>
      ).map(
        (each: { title: string; collapsibleSection?: { title: string } }) => {
          return [each.title, each.collapsibleSection?.title || null];
        },
      ),
    ).toEqual([
      ["Value", null],
      ["Criticality", null],
      ["Type", MORE_FIELDS_SECTION_TITLE],
      ["Description", MORE_FIELDS_SECTION_TITLE],
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
