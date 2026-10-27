import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import RankedBars, {
  RankedBarItem,
  getRankedBarFillPercent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/RankedBars";
import RiskiestEntities from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/RiskiestEntities";
import {
  ENTITY_RISK_EMPTY_TITLE,
  RISKIEST_ENTITIES_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/EntityRisk/EntityRiskCopy";
import {
  getEntityRiskLevelColor,
  getEntityRiskMeterPercent,
  getEntityRiskRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/EntityRisk/EntityRiskModel";
import {
  RiskiestEntityRow,
  getMoreRiskyEntityCount,
  getRiskiestEntityRows,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/EntityRisk/RiskiestEntitiesModel";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  SECURITY_OVERVIEW_RISKIEST_ENTITY_LIMIT,
  SecurityEntityRiskLevel,
  SecurityRiskiestEntities,
} from "../../../Types/SecurityCase/SecurityEntityRisk";
import {
  getEntityRiskLevel,
  readRiskCaseThreshold,
} from "../../../Utils/SecurityCase/SecurityEntityRiskScore";
import { routeFor } from "./SideMenuHarness";

/*
 * The Overview's Riskiest Entities, on their own: the rows worked out from
 * what the overview sends (each level against the project's threshold,
 * each bar filled as Entity Risk's meter is), the card's body drawing them
 * - a ranked list with the threshold marked, each entity opening its page,
 * the way to the rest of Entity Risk's list - and its empty and failed
 * states. And the shared ranked bars they are drawn with: a share of the
 * list, or a fill an item says itself.
 */

const RISKIEST: SecurityRiskiestEntities = {
  threshold: 100,
  total: 12,
  entities: [
    {
      value: "k.morgan@acme-commerce.example",
      type: SecurityEntityType.User,
      score: 200,
    },
    { value: "203.0.113.47", type: SecurityEntityType.IpAddress, score: 125 },
    { value: "fin-ws-112", type: SecurityEntityType.Host, score: 113 },
    { value: "198.51.100.23", type: SecurityEntityType.IpAddress, score: 75 },
    { value: "web-03", type: SecurityEntityType.Host, score: 50 },
    {
      value: "j.wilson@acme-commerce.example",
      type: SecurityEntityType.User,
      score: 25,
    },
    // Past twice the threshold: still Critical, its bar full, never more.
    { value: "dc-01", type: SecurityEntityType.Host, score: 450 },
  ],
};

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the rows, worked out from the overview's answer", () => {
  test("each entity's level is read against the project's threshold, as everywhere else", () => {
    expect(
      getRiskiestEntityRows(RISKIEST).map(
        (row: RiskiestEntityRow): [string, SecurityEntityRiskLevel] => {
          return [row.value, row.level];
        },
      ),
    ).toEqual([
      ["k.morgan@acme-commerce.example", SecurityEntityRiskLevel.Critical],
      ["203.0.113.47", SecurityEntityRiskLevel.High],
      ["fin-ws-112", SecurityEntityRiskLevel.High],
      ["198.51.100.23", SecurityEntityRiskLevel.Medium],
      ["web-03", SecurityEntityRiskLevel.Medium],
      ["j.wilson@acme-commerce.example", SecurityEntityRiskLevel.Low],
      ["dc-01", SecurityEntityRiskLevel.Critical],
    ]);

    for (const threshold of [10, 50, 100, 250, 10000, 3, Number.NaN]) {
      for (const row of getRiskiestEntityRows({ ...RISKIEST, threshold })) {
        expect([threshold, row.value, row.level]).toEqual([
          threshold,
          row.value,
          getEntityRiskLevel(row.score, readRiskCaseThreshold(threshold)),
        ]);
      }
    }
  });

  test("each bar is filled as Entity Risk's meter is, in its level's colour", () => {
    for (const row of getRiskiestEntityRows(RISKIEST)) {
      expect([row.value, row.fillPercent, row.color]).toEqual([
        row.value,
        getEntityRiskMeterPercent(row.score, RISKIEST.threshold),
        getEntityRiskLevelColor(row.level).toString(),
      ]);
    }

    expect(
      getRiskiestEntityRows(RISKIEST).map((row: RiskiestEntityRow): number => {
        return row.fillPercent;
      }),
    ).toEqual([100, 62.5, 56.5, 37.5, 25, 12.5, 100]);
  });

  test("keeps each entity's value, kind and score as sent, in the order sent", () => {
    expect(
      getRiskiestEntityRows(RISKIEST).map(
        (row: RiskiestEntityRow): [string, SecurityEntityType | null, number] => {
          return [row.value, row.type, row.score];
        },
      ),
    ).toEqual(
      RISKIEST.entities.map(
        (entity: {
          value: string;
          type: SecurityEntityType | null;
          score: number;
        }): [string, SecurityEntityType | null, number] => {
          return [entity.value, entity.type, entity.score];
        },
      ),
    );
    expect(
      getRiskiestEntityRows({ threshold: 100, total: 0, entities: [] }),
    ).toEqual([]);
  });

  test("counts how many more Entity Risk lists than the card shows", () => {
    expect(getMoreRiskyEntityCount(RISKIEST)).toBe(5);
    expect(
      getMoreRiskyEntityCount({ ...RISKIEST, total: RISKIEST.entities.length }),
    ).toBe(0);
    // A total the list outgrew (a read between two writes) is never below none.
    expect(getMoreRiskyEntityCount({ ...RISKIEST, total: 2 })).toBe(0);
    expect(SECURITY_OVERVIEW_RISKIEST_ENTITY_LIMIT).toBe(8);
  });
});

function renderRiskiest(
  riskiest: SecurityRiskiestEntities | null,
  options: { isReading?: boolean; onTryAgain?: () => void } = {},
): void {
  render(
    <MemoryRouter>
      <RiskiestEntities
        riskiest={riskiest}
        isReading={Boolean(options.isReading)}
        onTryAgain={options.onTryAgain || ((): void => {})}
      />
    </MemoryRouter>,
  );
}

describe("the card's body", () => {
  test("a ranked list: each entity, its kind and level, its score, its page", () => {
    renderRiskiest(RISKIEST);

    const list: HTMLElement = screen.getByTestId(
      RISKIEST_ENTITIES_TEST_IDS.list,
    );
    const rows: Array<HTMLElement> = within(list).getAllByRole("listitem");

    expect(rows).toHaveLength(RISKIEST.entities.length);
    expect(rows[0]).toHaveTextContent("k.morgan@acme-commerce.example");
    expect(rows[0]).toHaveTextContent("User · Critical");
    expect(rows[0]).toHaveTextContent("200");
    expect(rows[3]).toHaveTextContent("IP Address · Medium");
    expect(rows[5]).toHaveTextContent("User · Low");
    // The value is written as a value is: in the code font, whole on hover.
    expect(
      within(rows[0]!).getByText("k.morgan@acme-commerce.example").className,
    ).toBe("font-mono");
    expect(
      within(rows[1]!).getByRole("link", { name: "203.0.113.47" }),
    ).toHaveAttribute(
      "href",
      getEntityRiskRoute("203.0.113.47", SecurityEntityType.IpAddress).toString(),
    );
  });

  test("a score past twice the threshold fills its bar and no more", () => {
    renderRiskiest(RISKIEST);

    const row: HTMLElement = within(
      screen.getByTestId(RISKIEST_ENTITIES_TEST_IDS.list),
    ).getAllByRole("listitem")[6]!;

    expect(row).toHaveTextContent("Host · Critical");
    expect(row).toHaveTextContent("450");
    expect(within(row).getByTestId("ranked-bar-fill").style.width).toBe(
      "100%",
    );
  });

  test("the way to the rest of Entity Risk's list, in the reader's count", () => {
    renderRiskiest(RISKIEST);

    const all: HTMLElement = screen.getByTestId(
      RISKIEST_ENTITIES_TEST_IDS.viewAll,
    );

    expect(all).toHaveTextContent("View all 12 entities");
    expect(all).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_EVENTS_ENTITY_RISK),
    );
  });

  test("nothing ranked: Entity Risk's own empty sentence, and no way to more", () => {
    renderRiskiest({ threshold: 100, total: 0, entities: [] });

    expect(screen.getByTestId("ranked-bars-empty")).toHaveTextContent(
      ENTITY_RISK_EMPTY_TITLE,
    );
    expect(screen.queryByTestId(RISKIEST_ENTITIES_TEST_IDS.list)).toBeNull();
    expect(
      screen.queryByTestId(RISKIEST_ENTITIES_TEST_IDS.viewAll),
    ).toBeNull();
  });

  test("risk that could not be read: the words, and Try again - which waits while a read is in flight", async () => {
    let tries: number = 0;

    renderRiskiest(null, {
      onTryAgain: (): void => {
        tries++;
      },
    });

    const failed: HTMLElement = screen.getByTestId(
      RISKIEST_ENTITIES_TEST_IDS.error,
    );

    expect(failed).toHaveTextContent("We could not load the riskiest entities.");
    expect(screen.queryByTestId("ranked-bars-empty")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId(RISKIEST_ENTITIES_TEST_IDS.tryAgain));
    });
    expect(tries).toBe(1);

    cleanup();
    renderRiskiest(null, { isReading: true });

    expect(screen.getByTestId(RISKIEST_ENTITIES_TEST_IDS.tryAgain)).toBeDisabled();
  });
});

describe("the ranked bars", () => {
  function item(overrides: Partial<RankedBarItem>): RankedBarItem {
    return { key: "a", label: "a", count: 1, ...overrides };
  }

  test("a bar is its share of the list, never thinner than a sliver, and never past its track", () => {
    expect(getRankedBarFillPercent(item({ count: 5 }), 10)).toBe(50);
    expect(getRankedBarFillPercent(item({ count: 1 }), 1000)).toBe(2);
    expect(getRankedBarFillPercent(item({ count: 20 }), 10)).toBe(100);
    expect(getRankedBarFillPercent(item({ count: 0 }), 10)).toBe(0);
    expect(getRankedBarFillPercent(item({ count: -3 }), 10)).toBe(0);
  });

  test("an item that says how full it is is drawn so, from nothing to its whole track", () => {
    expect(getRankedBarFillPercent(item({ fillPercent: 62.5 }), 1)).toBe(62.5);
    // Its count says nothing of its bar then: a score of 25 can fill a tenth.
    expect(
      getRankedBarFillPercent(item({ count: 25, fillPercent: 12.5 }), 25),
    ).toBe(12.5);
    expect(getRankedBarFillPercent(item({ fillPercent: 140 }), 1)).toBe(100);
    expect(getRankedBarFillPercent(item({ fillPercent: -5 }), 1)).toBe(0);
    expect(getRankedBarFillPercent(item({ fillPercent: Number.NaN }), 1)).toBe(
      0,
    );
  });

  test("draws each bar's fill, a track alone for nothing, and the threshold mark only where asked", () => {
    render(
      <MemoryRouter>
        <RankedBars
          items={[
            item({ key: "a", label: "a", count: 4 }),
            item({ key: "b", label: "b", count: 2 }),
            item({ key: "c", label: "c", count: 0 }),
          ]}
          emptyText="Nothing."
        />
      </MemoryRouter>,
    );

    expect(
      screen.getAllByTestId("ranked-bar-fill").map((fill: HTMLElement) => {
        return fill.style.width;
      }),
    ).toEqual(["100%", "50%"]);
    expect(screen.queryAllByTestId("ranked-bar-threshold")).toHaveLength(0);

    cleanup();

    render(
      <MemoryRouter>
        <RankedBars
          items={[item({ key: "a", label: "a", count: 4, fillPercent: 30 })]}
          emptyText="Nothing."
          hasThresholdMark={true}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("ranked-bar-fill").style.width).toBe("30%");
    expect(screen.getAllByTestId("ranked-bar-threshold")).toHaveLength(1);
    // The mark sits on the track, which is the box it is placed in.
    expect(
      (
        screen.getByTestId("ranked-bar-threshold").parentElement as HTMLElement
      ).className.split(" "),
    ).toContain("relative");
  });
});
