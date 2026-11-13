import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * WAREHOUSE SPEND'S LISTS STAY INSIDE THEIR CARD (#6555's review).
 *
 * Warehouse Spend lists the spend By Team and its Costliest Tables, side by
 * side from a laptop and one under the other on a phone, each row a name
 * with its spend at the row's end. On a phone a table name with no place to
 * break - marketing.campaign_touchpoints_daily_rollup - set the width of the
 * lists' column, which had no limit (an auto grid column): the column ran
 * past the card, and every row's spend ran off the card's edge, cut. And a
 * name too long for its row put its spend on the next line at the row's
 * start, under the name, where no other row's spend is.
 *
 * Now the column is the card's width at most (grid-cols-1, minmax(0, 1fr)),
 * a table's name breaks where it must, and a spend that moves under its
 * name stays at the row's end. jsdom lays nothing out, so the classes that
 * do it are read; the review measured the page at 390px and 1280px, in
 * English and Arabic.
 */

const getSpendSummaryMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi",
  () => {
    return {
      __esModule: true,
      default: {
        getSpendSummary: (...args: Array<any>) => {
          return getSpendSummaryMock(...args);
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
      }): ReactElement => {
        return React.createElement(
          "a",
          { href: props.to?.toString(), className: props.className },
          props.children,
        );
      },
    };
  },
);

// The jobs' table below the card: not what this suite reads.
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return React.createElement("section", { "data-testid": "jobs" });
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return null;
      },
    },
  };
});

/*
 * The page comes last: requiring it runs the factories above.
 */
import SpendPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/Spend";
import Route from "../../../Types/API/Route";
import { DataObservabilitySpendSummary } from "../../../Types/DataObservability/DataObservabilityApiTypes";

const LONG_NAME: string = "marketing.campaign_touchpoints_daily_rollup";

const SUMMARY: DataObservabilitySpendSummary = {
  credits: 412,
  bytesBilled: 10.3 * 1000 ** 4,
  jobCount: 128,
  failingJobCount: 6,
  unusedJobCount: 1,
  unusedCredits: 41.2,
  unusedBytesBilled: 0,
  byTeam: [
    { team: "finance-analytics", credits: 211, bytesBilled: 0, jobCount: 40 },
    {
      team: "growth",
      credits: 120,
      bytesBilled: 2.3 * 1000 ** 4,
      jobCount: 52,
    },
    { team: "payments-data", credits: 81.77, bytesBilled: 0, jobCount: 36 },
  ],
  topTables: [
    {
      dataAssetId: "8b000000-0000-4000-8000-000000000002",
      table: "payments.ledger_entries",
      database: "Payments warehouse",
      credits: 96.4,
      bytesBilled: null,
      isUnused: false,
    },
    {
      dataAssetId: "8b000000-0000-4000-8000-000000000009",
      table: LONG_NAME,
      database: "analytics-snowflake",
      credits: 41.2,
      bytesBilled: null,
      isUnused: true,
    },
  ],
};

async function renderSpend(): Promise<void> {
  render(
    <SpendPage
      pageRoute={new Route("/dashboard/data-observability/spend")}
      currentProject={null}
      hasPaymentMethod={false}
    />,
  );
  await screen.findByText(LONG_NAME);
}

// A list's rows, by the heading over it.
function rowsUnder(heading: string): Array<HTMLElement> {
  const list: HTMLElement = screen
    .getByRole("heading", { level: 3, name: heading })
    .parentElement!.querySelector("ul") as HTMLElement;

  return within(list).getAllByRole("listitem");
}

beforeEach(() => {
  getSpendSummaryMock.mockReset();
  getSpendSummaryMock.mockResolvedValue(SUMMARY);
});

afterEach(() => {
  cleanup();
});

describe("the two lists", () => {
  test("are one column on a phone and two from a laptop, a column never wider than the card", async () => {
    await renderSpend();

    const byTeam: HTMLElement = screen.getByRole("heading", {
      level: 3,
      name: "By Team",
    }).parentElement!;
    const costliest: HTMLElement = screen.getByRole("heading", {
      level: 3,
      name: "Costliest Tables",
    }).parentElement!;
    const columns: HTMLElement = byTeam.parentElement!;

    expect(costliest.parentElement).toBe(columns);
    expect(columns.className.split(" ")).toEqual([
      "grid",
      "grid-cols-1",
      "gap-6",
      "lg:grid-cols-2",
    ]);
  });
});

describe("Costliest Tables", () => {
  test("a name too long for its row breaks where it must: the link may shrink, and its words break anywhere", async () => {
    await renderSpend();

    const link: HTMLElement = screen.getByText(LONG_NAME).closest("a")!;

    expect(link).toHaveClass("min-w-0", "[overflow-wrap:anywhere]");
    // Its box, with the Unused mark: shrinks with it, and puts the mark under it when there is no room beside it.
    expect(link.parentElement).toHaveClass("flex", "min-w-0", "flex-wrap");
    expect(within(link.parentElement!).getByText("Unused")).toBeInTheDocument();
  });

  test("a long name breaks after its dot first, never at the letter that fills the line, and reads as written", async () => {
    await renderSpend();

    const link: HTMLElement = screen.getByText(LONG_NAME).closest("a")!;
    const breaks: Array<Element> = Array.from(link.querySelectorAll("wbr"));

    // "marketing." / "campaign_touchpoints_daily_rollup": a name with a dot keeps its underscores whole.
    expect(breaks).toHaveLength(1);
    expect(breaks[0]!.previousSibling?.textContent).toBe("marketing.");
    expect(breaks[0]!.nextSibling?.textContent).toBe(
      "campaign_touchpoints_daily_rollup",
    );
    // A <wbr> adds no character: copied, searched or read aloud, the name is whole.
    expect(link.textContent).toBe(LONG_NAME);
  });

  test("each row's spend is at the row's end, on the name's line or, when the name takes the line, under it", async () => {
    await renderSpend();

    const rows: Array<HTMLElement> = rowsUnder("Costliest Tables");

    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(row).toHaveClass("flex", "flex-wrap", "justify-between");

      const spend: HTMLElement = row.lastElementChild as HTMLElement;

      expect(spend).toHaveClass("ms-auto");
    }

    expect(rows[0]!.lastElementChild).toHaveTextContent("96.40 credits");
    expect(rows[1]!.lastElementChild).toHaveTextContent("41.20 credits");
    expect(rows[1]!.firstElementChild).toHaveTextContent(LONG_NAME);
  });
});

describe("By Team", () => {
  test("each team's spend is at the row's end, kept apart from its name, its lines ending there too", async () => {
    await renderSpend();

    const rows: Array<HTMLElement> = rowsUnder("By Team");

    expect(rows).toHaveLength(3);

    for (const row of rows) {
      expect(row).toHaveClass("flex", "justify-between", "gap-x-4");
      expect(row.firstElementChild).toHaveClass("[overflow-wrap:anywhere]");
      expect(row.lastElementChild).toHaveClass("text-end");
    }

    expect(rows[1]!.lastElementChild).toHaveTextContent(
      "120 credits \u{00B7} 2.3 TB billed",
    );
  });
});
