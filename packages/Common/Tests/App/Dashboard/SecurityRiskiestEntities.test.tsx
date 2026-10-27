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
  RANKED_BAR_LABEL_HOVER_CLASS_NAME,
  RANKED_BAR_ROW_LINK_CLASS_NAME,
  RankedBarItem,
  getRankedBarFillPercent,
  getRankedBarTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/RankedBars";
import RiskiestEntities, {
  RISKIEST_ENTITY_VALUE_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/RiskiestEntities";
import {
  ENTITY_RISK_EMPTY_TITLE,
  ENTITY_RISK_TEST_IDS,
  RISKIEST_ENTITIES_OPEN_ENTITY_RISK,
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
  hasRiskyEntities,
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
import Route from "../../../Types/API/Route";

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
        (
          row: RiskiestEntityRow,
        ): [string, SecurityEntityType | null, number] => {
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

  /*
   * Whether the Overview has someone to rank: Entity Risk lists anyone now.
   * A month with no case and no detection still shows the riskiest, since a
   * rule that opens no case of its own adds risk all the same.
   */
  test("knows whether Entity Risk lists anyone: by its count, or by a row sent", () => {
    expect(hasRiskyEntities(RISKIEST)).toBe(true);
    expect(
      hasRiskyEntities({
        threshold: 100,
        total: 1,
        entities: [
          { value: "web-03", type: SecurityEntityType.Host, score: 10 },
        ],
      }),
    ).toBe(true);
    // A count past the rows sent (the card's eight) still counts.
    expect(hasRiskyEntities({ threshold: 100, total: 3, entities: [] })).toBe(
      true,
    );
    // A row sent with a count read before it was written still counts.
    expect(
      hasRiskyEntities({
        threshold: 100,
        total: 0,
        entities: [{ value: "fin-ws-112", type: null, score: 25 }],
      }),
    ).toBe(true);

    expect(hasRiskyEntities({ threshold: 100, total: 0, entities: [] })).toBe(
      false,
    );
    // Risk that could not be read is not risk: the card alone would say it failed.
    expect(hasRiskyEntities(null)).toBe(false);
    expect(hasRiskyEntities(undefined)).toBe(false);
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
  test("a ranked list: each entity, its kind, its score and level, its page", () => {
    renderRiskiest(RISKIEST);

    const list: HTMLElement = screen.getByTestId(
      RISKIEST_ENTITIES_TEST_IDS.list,
    );
    const rows: Array<HTMLElement> = within(list).getAllByRole("listitem");

    expect(rows).toHaveLength(RISKIEST.entities.length);
    expect(
      rows.map((row: HTMLElement): [string, string, string, string] => {
        return [
          within(row).getByRole("link").textContent || "",
          (row.querySelector(".text-\\[11px\\]") as HTMLElement).textContent ||
            "",
          within(row).getByTestId(ENTITY_RISK_TEST_IDS.levelPill).textContent ||
            "",
          (row.querySelector(".tabular-nums") as HTMLElement).textContent || "",
        ];
      }),
    ).toEqual([
      ["k.morgan@acme-commerce.example", "User", "Critical", "200"],
      ["203.0.113.47", "IP Address", "High", "125"],
      ["fin-ws-112", "Host", "High", "113"],
      ["198.51.100.23", "IP Address", "Medium", "75"],
      ["web-03", "Host", "Medium", "50"],
      ["j.wilson@acme-commerce.example", "User", "Low", "25"],
      ["dc-01", "Host", "Critical", "450"],
    ]);
    // The value is written as a value is: in the code font, on its own line.
    expect(
      within(rows[0]!).getByText("k.morgan@acme-commerce.example").className,
    ).toBe(RISKIEST_ENTITY_VALUE_CLASS_NAME);
    /*
     * As wide as the value, no wider than its line, cut at its own end: a
     * block would be as wide as the kind under it, and a short value
     * written left to right would sit off the start of a Persian line. Its
     * own box, so it is underlined with its row (an underline does not
     * reach into an inline-block).
     */
    expect(RISKIEST_ENTITY_VALUE_CLASS_NAME.split(" ").sort()).toEqual([
      "align-top",
      "font-mono",
      RANKED_BAR_LABEL_HOVER_CLASS_NAME,
      "inline-block",
      "max-w-full",
      "truncate",
    ]);
    expect(
      within(rows[1]!).getByRole("link", { name: "203.0.113.47" }),
    ).toHaveAttribute(
      "href",
      getEntityRiskRoute(
        "203.0.113.47",
        SecurityEntityType.IpAddress,
      ).toString(),
    );
  });

  /*
   * An entity's value is something someone's systems wrote. On a Persian
   * page (#5312) a plain span let the page's direction reorder it; in an
   * isolate that reads the way most of its letters do it reads as written,
   * and the isolate is what cuts it short - at its own end.
   */
  test("each value reads the way it is written, in an isolate that cuts it short at its own end", () => {
    renderRiskiest({
      threshold: 100,
      total: 3,
      entities: [
        {
          value: "k.morgan@acme-commerce.example",
          type: SecurityEntityType.User,
          score: 200,
        },
        // A host named in Persian letters reads right to left on any page.
        { value: "سرور-پرداخت-۲", type: SecurityEntityType.Host, score: 120 },
        // No letters at all: the isolate's own reading, never a forced one.
        {
          value: "203.0.113.47",
          type: SecurityEntityType.IpAddress,
          score: 80,
        },
      ],
    });

    const rows: Array<HTMLElement> = within(
      screen.getByTestId(RISKIEST_ENTITIES_TEST_IDS.list),
    ).getAllByRole("listitem");

    const values: Array<[string, string, string | null, string]> = rows.map(
      (row: HTMLElement): [string, string, string | null, string] => {
        const value: HTMLElement = within(row).getByRole("link")
          .firstElementChild!.firstElementChild as HTMLElement;

        return [
          value.textContent || "",
          value.tagName,
          value.getAttribute("dir"),
          value.className,
        ];
      },
    );

    expect(values).toEqual([
      [
        "k.morgan@acme-commerce.example",
        "BDI",
        "ltr",
        RISKIEST_ENTITY_VALUE_CLASS_NAME,
      ],
      ["سرور-پرداخت-۲", "BDI", "rtl", RISKIEST_ENTITY_VALUE_CLASS_NAME],
      ["203.0.113.47", "BDI", null, RISKIEST_ENTITY_VALUE_CLASS_NAME],
    ]);
  });

  test("a score past twice the threshold fills its bar and no more", () => {
    renderRiskiest(RISKIEST);

    const row: HTMLElement = within(
      screen.getByTestId(RISKIEST_ENTITIES_TEST_IDS.list),
    ).getAllByRole("listitem")[6]!;

    expect(row).toHaveTextContent("Host");
    expect(
      within(row).getByTestId(ENTITY_RISK_TEST_IDS.levelPill),
    ).toHaveTextContent("Critical");
    expect(row).toHaveTextContent("450");
    expect(within(row).getByTestId("ranked-bar-fill").style.width).toBe("100%");
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

  /*
   * Every card of a few rows offers the way on to its whole list. When the
   * card shows every entity Entity Risk lists, that is Entity Risk itself -
   * who found each and when, its filters and Look Up an Entity - in the
   * words an entity's page uses for it, never "View all 2 entities" over
   * the two already shown.
   */
  test("when the card shows every entity Entity Risk lists, the way on is Entity Risk itself", () => {
    renderRiskiest({ ...RISKIEST, total: RISKIEST.entities.length });

    const way: HTMLElement = screen.getByTestId(
      RISKIEST_ENTITIES_TEST_IDS.viewAll,
    );

    expect(RISKIEST_ENTITIES_OPEN_ENTITY_RISK).toBe("Open Entity Risk");
    expect(way).toHaveTextContent(/^Open Entity Risk$/);
    expect(way).toHaveAttribute(
      "href",
      routeFor(PageMap.SECURITY_EVENTS_ENTITY_RISK),
    );
    expect(way).not.toHaveTextContent("View all");
  });

  /*
   * The level is what the score reads as, so it is beside the score - its
   * pill, as Entity Risk's Risk column draws it - never beside the kind,
   * where Entity Risk puts how much an entity matters (its criticality):
   * "Host · High" read as a host of high criticality. The pill comes
   * before the score, so every row's score ends the line, as every other
   * list's count does, whatever its level's word.
   */
  test("the level is a pill before the score, never beside the kind, and the score ends the line", () => {
    renderRiskiest(RISKIEST);

    for (const row of within(
      screen.getByTestId(RISKIEST_ENTITIES_TEST_IDS.list),
    ).getAllByRole("listitem")) {
      const count: HTMLElement = within(row).getByTestId("ranked-bar-count");
      const pill: HTMLElement = within(row).getByTestId(
        ENTITY_RISK_TEST_IDS.levelPill,
      );

      expect(count.contains(pill)).toBe(true);
      expect(count.lastElementChild!.className).toContain("tabular-nums");
      expect(
        pill.compareDocumentPosition(count.lastElementChild!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // The kind's line names the kind alone.
      expect(
        (row.querySelector(".text-\\[11px\\]") as HTMLElement).textContent,
      ).not.toContain("·");
    }
  });

  test("a row whose kind is unknown has no kind's line, and still its level beside its score", () => {
    renderRiskiest({
      threshold: 100,
      total: 1,
      entities: [{ value: "odd-entity", type: null, score: 60 }],
    });

    const row: HTMLElement = within(
      screen.getByTestId(RISKIEST_ENTITIES_TEST_IDS.list),
    ).getByRole("listitem");

    expect(row.querySelector(".text-\\[11px\\]")).toBeNull();
    expect(
      within(row).getByTestId(ENTITY_RISK_TEST_IDS.levelPill),
    ).toHaveTextContent("Medium");
  });

  /*
   * A row opens its entity from anywhere on it - its value, its kind, its
   * score and its bar - and says the value whole under the pointer, for a
   * value cut short to its line.
   */
  test("the whole row opens the entity's page, and says its value whole under the pointer", () => {
    renderRiskiest(RISKIEST);

    const rows: Array<HTMLElement> = within(
      screen.getByTestId(RISKIEST_ENTITIES_TEST_IDS.list),
    ).getAllByRole("listitem");

    rows.forEach((row: HTMLElement, index: number): void => {
      const link: HTMLElement = within(row).getByRole("link");

      expect(row.className.split(" ")).toContain("relative");
      expect(link.className).toContain(RANKED_BAR_ROW_LINK_CLASS_NAME);
      expect(link).toHaveAttribute("title", RISKIEST.entities[index]!.value);
    });
  });

  test("nothing ranked: Entity Risk's own empty sentence, and no way to more", () => {
    renderRiskiest({ threshold: 100, total: 0, entities: [] });

    expect(screen.getByTestId("ranked-bars-empty")).toHaveTextContent(
      ENTITY_RISK_EMPTY_TITLE,
    );
    expect(screen.queryByTestId(RISKIEST_ENTITIES_TEST_IDS.list)).toBeNull();
    expect(screen.queryByTestId(RISKIEST_ENTITIES_TEST_IDS.viewAll)).toBeNull();
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

    expect(failed).toHaveTextContent(
      "We could not load the riskiest entities.",
    );
    expect(screen.queryByTestId("ranked-bars-empty")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId(RISKIEST_ENTITIES_TEST_IDS.tryAgain));
    });
    expect(tries).toBe(1);

    cleanup();
    renderRiskiest(null, { isReading: true });

    expect(
      screen.getByTestId(RISKIEST_ENTITIES_TEST_IDS.tryAgain),
    ).toBeDisabled();
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

  /*
   * A row that opens something opens it from anywhere on it: its link's
   * ::after is stretched over the row (the li its box), above the bar's
   * track - itself placed, so a box under it would take the click - and
   * a keyboard's focus rings the whole row. A row that opens nothing has
   * no link and no box for one.
   */
  test("a row that opens something opens from anywhere on it; a row that opens nothing is no link", () => {
    for (const token of [
      "after:absolute",
      "after:-inset-1.5",
      "after:z-10",
      "after:content-['']",
      "focus:outline-none",
      "focus-visible:after:ring-2",
      "hover:underline",
      "group/ranked-row",
    ]) {
      expect([token, RANKED_BAR_ROW_LINK_CLASS_NAME.split(" ")]).toEqual([
        token,
        expect.arrayContaining([token]),
      ]);
    }
    expect(RANKED_BAR_LABEL_HOVER_CLASS_NAME).toBe(
      "group-hover/ranked-row:underline",
    );

    render(
      <MemoryRouter>
        <RankedBars
          items={[
            item({
              key: "a",
              label: "Encoded PowerShell",
              count: 4,
              to: new Route(routeFor(PageMap.SECURITY_EVENTS_DETECTION_RULES)),
            }),
            item({ key: "b", label: "True Positive", count: 2 }),
          ]}
          emptyText="Nothing."
        />
      </MemoryRouter>,
    );

    const [linked, plain] = screen.getAllByRole("listitem") as [
      HTMLElement,
      HTMLElement,
    ];

    expect(linked.className.split(" ")).toContain("relative");
    expect(within(linked).getByRole("link").className).toBe(
      "cursor-pointer " + RANKED_BAR_ROW_LINK_CLASS_NAME,
    );
    expect(within(plain).queryByRole("link")).toBeNull();
    expect(plain.getAttribute("class")).toBeNull();
  });

  test("a label says itself whole under the pointer: its words, or the title an element's label gives", () => {
    expect(getRankedBarTitle(item({ label: "Okta password spray" }))).toBe(
      "Okta password spray",
    );
    expect(
      getRankedBarTitle(item({ label: <span>web-03</span>, title: "web-03" })),
    ).toBe("web-03");
    expect(getRankedBarTitle(item({ label: <span>web-03</span> }))).toBe(
      undefined,
    );
    expect(getRankedBarTitle(item({ label: "" }))).toBe(undefined);

    render(
      <MemoryRouter>
        <RankedBars
          items={[
            item({
              key: "a",
              label: "A rule with a name longer than its line",
              count: 4,
              to: new Route(routeFor(PageMap.SECURITY_EVENTS_DETECTION_RULES)),
            }),
            item({ key: "b", label: "Benign Positive", count: 2 }),
          ]}
          emptyText="Nothing."
        />
      </MemoryRouter>,
    );

    const [linked, plain] = screen.getAllByRole("listitem") as [
      HTMLElement,
      HTMLElement,
    ];

    // On a linked row the link says it: the stretched link is what the pointer is over.
    expect(within(linked).getByRole("link")).toHaveAttribute(
      "title",
      "A rule with a name longer than its line",
    );
    expect(within(plain).getByText("Benign Positive")).toHaveAttribute(
      "title",
      "Benign Positive",
    );
  });

  test("a badge comes before the count, in one group; without one the count stands alone", () => {
    render(
      <MemoryRouter>
        <RankedBars
          items={[
            item({
              key: "a",
              label: "a",
              count: 125,
              badge: <span data-testid="the-badge">High</span>,
            }),
            item({ key: "b", label: "b", count: 7 }),
          ]}
          emptyText="Nothing."
        />
      </MemoryRouter>,
    );

    const [badged, plain] = screen.getAllByRole("listitem") as [
      HTMLElement,
      HTMLElement,
    ];
    const group: HTMLElement = within(badged).getByTestId("ranked-bar-count");

    expect(
      Array.from(group.children).map((child: Element): string => {
        return child.textContent || "";
      }),
    ).toEqual(["High", "125"]);
    expect(within(plain).queryByTestId("ranked-bar-count")).toBeNull();
    expect(
      (plain.querySelector(".tabular-nums") as HTMLElement).textContent,
    ).toBe("7");
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
