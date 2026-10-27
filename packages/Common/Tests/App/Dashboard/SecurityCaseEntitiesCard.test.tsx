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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A case's Entities page: who and what the case is about, as a table -
 * each entity (opening Correlate), its type, how many security events
 * named it this past week, how many findings, the worst of their
 * severities and when it was last seen. On a narrow page (a phone, a
 * narrow window beside the side menu) the type and when go under the
 * value and their columns step out.
 * Each user, host and address carries its risk (Security Events > Entity
 * Risk), linked to its page: a column of its own where the table has room,
 * under the value where it has not.
 */

const getEntityActivityMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi",
  () => {
    return {
      __esModule: true,
      default: {
        getEntityActivity: (...args: Array<unknown>) => {
          return getEntityActivityMock(...args);
        },
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

import SecurityCaseEntitiesCard, {
  ENTITIES_TABLE_NARROW_ONLY_CLASS_NAME,
  ENTITIES_TABLE_RISK_COLUMN_CLASS_NAME,
  ENTITIES_TABLE_RISK_UNDER_VALUE_CLASS_NAME,
  ENTITIES_TABLE_WIDE_ONLY_CLASS_NAME,
  ENTITY_ACTIVITY_HOURS,
  SECURITY_CASE_ENTITIES_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseEntitiesCard";
import { ENTITY_RISK_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/EntityRisk/EntityRiskCopy";
import Includes from "../../../Types/BaseDatabase/Includes";
import ProjectUtil from "../../../UI/Utils/Project";
import ObjectID from "../../../Types/ObjectID";
import { SECURITY_ENTITY_CHIP_WRAPPED_VALUE_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityEntityChips";
import OneUptimeDate from "../../../Types/Date";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../Types/SecurityCase/SecurityEntity";

const NOW: Date = new Date("2026-10-14T12:00:00.000Z");
const IP_LAST_SEEN: Date = new Date("2026-10-14T11:51:00.000Z");
const USER_LAST_SEEN: Date = new Date("2026-10-14T11:19:00.000Z");

const ENTITIES: Array<SecurityEntity> = [
  { type: SecurityEntityType.IpAddress, value: "203.0.113.47" },
  { type: SecurityEntityType.User, value: "k.morgan@acme-commerce.example" },
  { type: SecurityEntityType.Domain, value: "acme-commerce.okta.example" },
];

function draw(entities: Array<SecurityEntity> = ENTITIES): void {
  render(
    <MemoryRouter>
      <SecurityCaseEntitiesCard entities={entities} />
    </MemoryRouter>,
  );
}

function rows(): Array<HTMLElement> {
  return screen.getAllByTestId(SECURITY_CASE_ENTITIES_TEST_IDS.row);
}

// What each cell of the wide table reads: without what only the narrow one draws.
function cellsOf(row: HTMLElement): Array<string> {
  return Array.from(row.querySelectorAll("td")).map(
    (cell: HTMLTableCellElement): string => {
      const copy: HTMLElement = cell.cloneNode(true) as HTMLElement;

      copy
        .querySelectorAll(
          `[class*="${ENTITIES_TABLE_NARROW_ONLY_CLASS_NAME}"], [class*="${ENTITIES_TABLE_RISK_UNDER_VALUE_CLASS_NAME}"]`,
        )
        .forEach((narrowOnly: Element): void => {
          narrowOnly.remove();
        });

      return (copy.textContent || "").trim();
    },
  );
}

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

// The project's risk threshold, as Settings > Risk Scoring keeps it.
let threshold: number = 100;

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  threshold = 100;
  getItemMock.mockReset();
  getItemMock.mockImplementation(async () => {
    return {
      securityRiskCaseThreshold: threshold,
      enableSecurityRiskCases: true,
    };
  });
  // The risk of the address and the user; the domain carries none.
  getListMock.mockReset();
  getListMock.mockImplementation(async () => {
    return {
      data: [
        { entityKey: "203.0.113.47", riskScore: 125 },
        { entityKey: "k.morgan@acme-commerce.example", riskScore: 200 },
      ],
      count: 2,
    };
  });
  getEntityActivityMock.mockReset();
  getEntityActivityMock.mockImplementation(async () => {
    return [
      {
        value: "203.0.113.47",
        eventCount: 475,
        findingCount: 36,
        maxSeverityId: 4,
        firstSeen: new Date("2026-10-08T00:00:00.000Z"),
        lastSeen: IP_LAST_SEEN,
      },
      {
        value: "K.Morgan@acme-commerce.example",
        eventCount: 1436,
        findingCount: 33,
        maxSeverityId: 5,
        firstSeen: new Date("2026-10-08T00:00:00.000Z"),
        lastSeen: USER_LAST_SEEN,
      },
    ];
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the case's entities", () => {
  test("asks for each entity's activity over the last week", async () => {
    draw();

    await waitFor(() => {
      expect(getEntityActivityMock).toHaveBeenCalledTimes(1);
    });
    expect(getEntityActivityMock.mock.calls[0]![0]).toEqual({
      values: [
        "203.0.113.47",
        "k.morgan@acme-commerce.example",
        "acme-commerce.okta.example",
      ],
      hours: ENTITY_ACTIVITY_HOURS,
    });
    expect(ENTITY_ACTIVITY_HOURS).toBe(24 * 7);
  });

  test("is a table of each entity: its kind, its week of activity and its risk", async () => {
    draw();

    const table: HTMLElement = screen.getByTestId(
      SECURITY_CASE_ENTITIES_TEST_IDS.table,
    );

    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header: HTMLElement): string => {
          return (header.textContent || "").trim();
        }),
    ).toEqual([
      "Entity",
      "Type",
      "Events",
      "Findings",
      "Worst Severity",
      "Last Seen",
      "Risk",
    ]);
    // What the count counts, on hover.
    expect(
      within(table).getByRole("columnheader", { name: "Events" }),
    ).toHaveAttribute("title", "Security events naming it in the last 7 days");
  });

  test("lists each entity with its activity, matched however its value is cased", async () => {
    draw();

    await waitFor(() => {
      expect(cellsOf(rows()[0]!)[2]).toBe("475");
    });

    await waitFor(() => {
      expect(cellsOf(rows()[0]!)[6]).toBe("125High");
    });
    expect(cellsOf(rows()[0]!).slice(1)).toEqual([
      "IP Address",
      "475",
      "36",
      "High",
      // Said as every "last seen" in the product says it.
      OneUptimeDate.fromNow(IP_LAST_SEEN),
      // Its risk, and the level it reads as against the threshold.
      "125High",
    ]);
    // The user, whose activity came back with other casing.
    expect(cellsOf(rows()[1]!).slice(1)).toEqual([
      "User",
      // Written the reader's way, as every count in the product is.
      "1,436",
      "33",
      "Critical",
      OneUptimeDate.fromNow(USER_LAST_SEEN),
      "200Critical",
    ]);
  });

  test("an entity no event named this week reads as none, without a severity", async () => {
    draw();

    await waitFor(() => {
      expect(cellsOf(rows()[0]!)[2]).toBe("475");
    });

    expect(cellsOf(rows()[2]!).slice(1)).toEqual([
      "Domain",
      "0",
      "0",
      "-",
      "-",
      // A domain carries no risk.
      "-",
    ]);
  });

  test("each entity opens in Correlate, seeded with it", async () => {
    draw();

    expect(
      within(rows()[0]!).getByRole("link", {
        name: "203.0.113.47",
      }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(
        "/security-events/correlate?observable=203.0.113.47",
      ),
    );
  });

  test("while the activity is read, its cells wait", () => {
    getEntityActivityMock.mockImplementation(() => {
      return new Promise((): void => {
        // Never answers.
      });
    });

    draw();

    const row: HTMLElement = rows()[0]!;

    expect(
      within(row)
        .getByTestId(SECURITY_CASE_ENTITIES_TEST_IDS.events)
        .querySelector(".animate-pulse"),
    ).not.toBeNull();
  });

  test("activity that cannot be read says why, and the entities are still listed", async () => {
    getEntityActivityMock.mockImplementation(async () => {
      throw new Error("ClickHouse is not reachable.");
    });

    draw();

    expect(
      await screen.findByTestId(SECURITY_CASE_ENTITIES_TEST_IDS.activityError),
    ).toHaveTextContent(
      "Activity is not available: ClickHouse is not reachable.",
    );
    expect(rows()).toHaveLength(3);
  });

  test("a case that names nobody says so, and asks for nothing", () => {
    draw([]);

    expect(
      screen.getByText("This case names no users, hosts or addresses"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(SECURITY_CASE_ENTITIES_TEST_IDS.table),
    ).toBeNull();
    expect(getEntityActivityMock).not.toHaveBeenCalled();
  });
});

describe("each entity's risk", () => {
  test("is read once, for the users, hosts and addresses only, by their keys", async () => {
    draw([
      ...ENTITIES,
      { type: SecurityEntityType.Host, value: " FIN-WS-112 " },
      { type: SecurityEntityType.Process, value: "procdump64.exe" },
    ]);

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });

    const request: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      limit: number;
    } = getListMock.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      limit: number;
    };

    expect(request.query["projectId"]).toEqual(new ObjectID(PROJECT_ID));
    expect(request.query["entityKey"]).toBeInstanceOf(Includes);
    // Case folded and trimmed, as the server keys them; no domain, no process.
    expect((request.query["entityKey"] as Includes).values).toEqual([
      "203.0.113.47",
      "k.morgan@acme-commerce.example",
      "fin-ws-112",
    ]);
    expect(request.select).toEqual({ entityKey: true, riskScore: true });
    expect(request.limit).toBe(3);
  });

  test("opens the entity's page, with its kind", async () => {
    draw();

    await waitFor(() => {
      expect(cellsOf(rows()[1]!)[6]).toBe("200Critical");
    });
    const column: HTMLElement = within(rows()[1]!).getByTestId(
      ENTITY_RISK_TEST_IDS.caseEntityRiskColumn,
    );
    const href: string =
      within(column).getByRole("link").getAttribute("href") || "";

    expect(href).toContain(
      `/dashboard/${PROJECT_ID}/security-events/entity-risk/entity?`,
    );
    const query: URLSearchParams = new URLSearchParams(href.split("?")[1]);
    expect(query.get("value")).toBe("k.morgan@acme-commerce.example");
    expect(query.get("type")).toBe("User");
  });

  test("reads its level against the project's own threshold", async () => {
    threshold = 50;
    draw();

    await waitFor(() => {
      expect(cellsOf(rows()[0]!)[6]).toBe("125Critical");
    });
    // At 50, 125 is past twice the threshold: Critical, not High.
    expect(cellsOf(rows()[1]!)[6]).toBe("200Critical");
  });

  test("a score of 0 is no risk, and a read that fails leaves the column empty", async () => {
    getListMock.mockImplementation(async () => {
      return {
        data: [
          { entityKey: "203.0.113.47", riskScore: 0 },
          { entityKey: "k.morgan@acme-commerce.example", riskScore: 200 },
        ],
        count: 2,
      };
    });
    draw();

    await waitFor(() => {
      expect(cellsOf(rows()[1]!)[6]).toBe("200Critical");
    });
    expect(cellsOf(rows()[0]!)[6]).toBe("-");

    cleanup();
    getListMock.mockImplementation(async () => {
      throw new Error("Postgres is not reachable.");
    });
    draw();

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(cellsOf(rows()[0]!)[2]).toBe("475");
    });
    expect(cellsOf(rows()[0]!)[6]).toBe("-");
    expect(cellsOf(rows()[1]!)[6]).toBe("-");
    // The activity is the card's: it still reads.
    expect(
      screen.queryByTestId(SECURITY_CASE_ENTITIES_TEST_IDS.activityError),
    ).toBeNull();
  });

  test("a case about no user, host or address asks for no risk", async () => {
    draw([{ type: SecurityEntityType.Domain, value: "acme-commerce.example" }]);

    await waitFor(() => {
      expect(getEntityActivityMock).toHaveBeenCalled();
    });
    expect(getListMock).not.toHaveBeenCalled();
    expect(cellsOf(rows()[0]!)[6]).toBe("-");
  });
});

describe("on a narrow page", () => {
  test("two columns are left: the type and when go under the value, the worst severity under the count", async () => {
    draw();

    await waitFor(() => {
      expect(cellsOf(rows()[0]!)[2]).toBe("475");
    });

    const table: HTMLElement = screen.getByTestId(
      SECURITY_CASE_ENTITIES_TEST_IDS.table,
    );
    const headers: Array<HTMLElement> =
      within(table).getAllByRole("columnheader");
    const wideOnly: Array<string> = headers
      .filter((header: HTMLElement): boolean => {
        return header.className.includes(ENTITIES_TABLE_WIDE_ONLY_CLASS_NAME);
      })
      .map((header: HTMLElement): string => {
        return (header.textContent || "").trim();
      });

    expect(wideOnly).toEqual([
      "Type",
      "Findings",
      "Worst Severity",
      "Last Seen",
    ]);
    // What a phone keeps: the entity and its count.
    expect(
      headers
        .filter((header: HTMLElement): boolean => {
          return (
            !header.className.includes(ENTITIES_TABLE_WIDE_ONLY_CLASS_NAME) &&
            !header.className.includes(ENTITIES_TABLE_RISK_COLUMN_CLASS_NAME)
          );
        })
        .map((header: HTMLElement): string => {
          return (header.textContent || "").trim();
        }),
    ).toEqual(["Entity", "Events"]);

    const underTheValue: Element | null = rows()[0]!.querySelector(
      `td:first-child div[class*="${ENTITIES_TABLE_NARROW_ONLY_CLASS_NAME}"]`,
    );

    expect(underTheValue?.textContent).toBe(
      `IP Address · last seen ${OneUptimeDate.fromNow(IP_LAST_SEEN)}`,
    );
    expect(underTheValue).toBe(
      within(rows()[0]!).getByTestId(
        SECURITY_CASE_ENTITIES_TEST_IDS.typeUnderValue,
      ),
    );
    // On a phone it wraps without leaving one word alone on its last line.
    expect(underTheValue).toHaveClass("text-pretty");

    // The worst severity under the count, the column's own cell left out.
    const underTheCount: HTMLElement = within(rows()[0]!).getByTestId(
      SECURITY_CASE_ENTITIES_TEST_IDS.severityUnderCount,
    );

    expect(underTheCount).toHaveTextContent("High");
    expect(underTheCount.className).toContain(
      ENTITIES_TABLE_NARROW_ONLY_CLASS_NAME,
    );
    expect(underTheCount.closest("td")).toBe(
      within(rows()[0]!)
        .getByTestId(SECURITY_CASE_ENTITIES_TEST_IDS.events)
        .closest("td"),
    );
    expect(
      within(rows()[0]!).getByTestId(SECURITY_CASE_ENTITIES_TEST_IDS.severity)
        .className,
    ).toContain(ENTITIES_TABLE_WIDE_ONLY_CLASS_NAME);
    // An entity with no finding has no severity to put there.
    expect(
      within(rows()[2]!).queryByTestId(
        SECURITY_CASE_ENTITIES_TEST_IDS.severityUnderCount,
      ),
    ).toBeNull();
  });

  test("a long value wraps rather than cut short, so the count keeps its room", () => {
    draw();

    const value: HTMLElement = within(rows()[1]!).getByText(
      "k.morgan@acme-commerce.example",
    );

    expect(value.className).toBe(SECURITY_ENTITY_CHIP_WRAPPED_VALUE_CLASS_NAME);
    expect(value.className).not.toContain("truncate");
  });

  test("the risk takes a column only where the table has room: below, it goes under the value, named", async () => {
    draw();

    await waitFor(() => {
      expect(cellsOf(rows()[0]!)[6]).toBe("125High");
    });
    const column: HTMLElement = within(rows()[0]!).getByTestId(
      ENTITY_RISK_TEST_IDS.caseEntityRiskColumn,
    );
    const under: HTMLElement = within(rows()[0]!).getByTestId(
      ENTITY_RISK_TEST_IDS.caseEntityRiskUnderValue,
    );

    expect(column).toHaveClass(ENTITIES_TABLE_RISK_COLUMN_CLASS_NAME);
    expect(
      within(
        screen.getByTestId(SECURITY_CASE_ENTITIES_TEST_IDS.table),
      ).getByRole("columnheader", { name: "Risk" }),
    ).toHaveClass(ENTITIES_TABLE_RISK_COLUMN_CLASS_NAME);
    // Under the value, inside the entity's cell, named where no header names it.
    expect(under).toHaveClass(ENTITIES_TABLE_RISK_UNDER_VALUE_CLASS_NAME);
    expect(under.closest("td")).toBe(rows()[0]!.querySelector("td"));
    expect(under).toHaveTextContent("Risk125High");
    expect(column).toHaveTextContent(/^125High$/);
    // Wider than the type's and the severity's own breakpoint: five columns keep their line first.
    expect(ENTITIES_TABLE_RISK_COLUMN_CLASS_NAME).toBe(
      "[@container(max-width:51.99rem)]:hidden",
    );
    expect(ENTITIES_TABLE_RISK_UNDER_VALUE_CLASS_NAME).toBe(
      "[@container(min-width:52rem)]:hidden",
    );
    // An entity with no risk has nothing under its value.
    expect(
      within(rows()[2]!).queryByTestId(
        ENTITY_RISK_TEST_IDS.caseEntityRiskUnderValue,
      ),
    ).toBeNull();
  });

  test("the table is a size container keyed to its own width, not the window's", () => {
    draw();

    const container: HTMLElement | null = screen
      .getByTestId(SECURITY_CASE_ENTITIES_TEST_IDS.table)
      .closest("[class*='[container-type:inline-size]']");

    expect(container).not.toBeNull();
    // Shown by default and hidden below the width: never a bare `hidden`.
    expect(ENTITIES_TABLE_WIDE_ONLY_CLASS_NAME).toBe(
      "[@container(max-width:39.99rem)]:hidden",
    );
    expect(ENTITIES_TABLE_NARROW_ONLY_CLASS_NAME).toBe(
      "[@container(min-width:40rem)]:hidden",
    );
  });
});
