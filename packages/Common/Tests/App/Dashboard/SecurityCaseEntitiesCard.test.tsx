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
 * A case's Entities page: who and what the case is about, as a table the
 * way Security Events > Entities lists its riskiest entities - each entity
 * (opening Correlate), its type, how many security events named it this
 * past week, how many findings, the worst of their severities and when it
 * was last seen. On a narrow page (a phone, a narrow window beside the side
 * menu) the type and when go under the value and their columns step out.
 */

const getEntityActivityMock: MockFunction = getJestMockFunction();

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

import SecurityCaseEntitiesCard, {
  ENTITIES_TABLE_NARROW_ONLY_CLASS_NAME,
  ENTITIES_TABLE_WIDE_ONLY_CLASS_NAME,
  ENTITY_ACTIVITY_HOURS,
  SECURITY_CASE_ENTITIES_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseEntitiesCard";
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
        .querySelectorAll(`[class*="${ENTITIES_TABLE_NARROW_ONLY_CLASS_NAME}"]`)
        .forEach((narrowOnly: Element): void => {
          narrowOnly.remove();
        });

      return (copy.textContent || "").trim();
    },
  );
}

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
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

  test("is a table with the columns Security Events > Entities has where they mean the same", async () => {
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

    expect(cellsOf(rows()[0]!).slice(1)).toEqual([
      "IP Address",
      "475",
      "36",
      "High",
      // Said as every "last seen" in the product says it.
      OneUptimeDate.fromNow(IP_LAST_SEEN),
    ]);
    // The user, whose activity came back with other casing.
    expect(cellsOf(rows()[1]!).slice(1)).toEqual([
      "User",
      // Written the reader's way, as every count in the product is.
      "1,436",
      "33",
      "Critical",
      OneUptimeDate.fromNow(USER_LAST_SEEN),
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
          return !header.className.includes(
            ENTITIES_TABLE_WIDE_ONLY_CLASS_NAME,
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
