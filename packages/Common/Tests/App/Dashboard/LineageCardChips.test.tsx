import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { act, ReactElement, ReactNode } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE CHIPS UNDER A LINEAGE CARD'S NAME (#6851).
 *
 * A card shows at most two chips in one row under its name: what the card
 * is to the drawing (This alert, This table), its part in an alert's ways
 * (Cause, Consequence), then its open alerts, or that it was dropped, then
 * how fresh it is - or a pipeline's last run. The card is as wide as the
 * layout places it, so two chips can be wider than it: "Deze waarschuwing"
 * and "1 open waarschuwing" are. The first chip keeps its width; the second
 * gives way, its words ending in "..." - whole under the pointer and in the
 * card's name read aloud - rather than being cut off at the card's edge in
 * the middle of a word.
 *
 * A second chip left too little room to say anything - "С..." of
 * "Свежая" after "Открытых оповещений: 1" (#6957) - moves to the row's
 * second line, which the row, one small pill high, does not show: its
 * words stay in the card's name, and the row says both chips' words under
 * the pointer, joined as the reader's language lists facts on a line.
 * jsdom lays nothing out, so where a chip is drawn is set per test
 * (getBoundingClientRect), as the browser would draw it; the Event
 * Overview's E2E suite reads the real drawing in every language.
 *
 * And on an alert's own card the one open alert its table counts is, while
 * the alert is open, the alert itself, which This alert says already: the
 * card leaves that count out, so the chip after This alert says how fresh
 * the table is. The alert's lineage says whether it was open when it was
 * read (DataAlertLineageAnswer.isAlertOpen); a count of more than one, a
 * resolved alert's card, and a drawing that does not say, show the count.
 *
 * The API is mocked; React Flow is the stand-in of LineageFlowStandIn,
 * which draws each card with the component's own card.
 */

const getTableLineageMock: MockFunction = getJestMockFunction();
const getPipelineLineageMock: MockFunction = getJestMockFunction();
const getAlertLineageMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi",
  () => {
    return {
      __esModule: true,
      default: {
        getTableLineage: (...args: Array<any>) => {
          return getTableLineageMock(...args);
        },
        getPipelineLineage: (...args: Array<any>) => {
          return getPipelineLineageMock(...args);
        },
        getAlertLineage: (...args: Array<any>) => {
          return getAlertLineageMock(...args);
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
        dataTestId?: string;
      }): ReactElement => {
        return React.createElement(
          "a",
          {
            href: props.to?.toString(),
            className: props.className,
            "data-testid": props.dataTestId,
          },
          props.children,
        );
      },
    };
  },
);

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("11111111-1111-4111-8111-111111111111");
      },
    },
  };
});

jest.mock("reactflow", () => {
  return jest.requireActual("./LineageFlowStandIn");
});

/*
 * The components come last: requiring them runs the factories above, which
 * use ObjectID.
 */
import ObjectID from "../../../Types/ObjectID";
import { DataAssetFreshness } from "../../../Types/DataObservability/DataAssetFreshness";
import DataAssetKind from "../../../Types/DataObservability/DataAssetKind";
import DataAssetLineageSource from "../../../Types/DataObservability/DataAssetLineageSource";
import {
  DataAlertLineageAnswer,
  DataLineageEdgeKind,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  getLineageEdgeId,
} from "../../../Types/DataObservability/DataTableLineage";
import TableLineageDiagram from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/TableLineageDiagram";
import PipelineLineageDiagram from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/PipelineLineageDiagram";
import AlertLineageDiagram from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/AlertLineageDiagram";
import { LineagePlace } from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/LineageGraphModel";
import {
  LINEAGE_CHIP_LEAST,
  LINEAGE_CHIP_ROW_CLASS_NAME,
  LINEAGE_FIRST_CHIP_CLASS_NAME,
  LINEAGE_SECOND_CHIP_CLASS_NAME,
  getLineageCardOpenAlerts,
  isLineageChipOutOfView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/LineageGraph";
import { PILL_CLASS_NAME, PillSize } from "../../../UI/Components/Pill/Pill";
import {
  DOT_ZERO_INLINE_SEPARATOR,
  INLINE_SEPARATOR,
} from "../../../Types/Translator";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { resetFlowStandIn } from "./LineageFlowStandIn";

const ALERT: string = "55555555-5555-4555-8555-000000000001";
const LEDGER: string = "22222222-2222-4222-8222-000000000001";
const CALLBACKS: string = "22222222-2222-4222-8222-000000000002";
const MART: string = "22222222-2222-4222-8222-000000000003";
const OLD: string = "22222222-2222-4222-8222-000000000004";
const ETL: string = "33333333-3333-4333-8333-000000000001";
const ETL_NODE: string = `pipeline:${ETL}`;

function table(
  id: string,
  side: DataLineageSide,
  depth: number,
  fields: Partial<DataTableLineageNode> = {},
): DataTableLineageNode {
  return {
    id: `table:${id}`,
    kind: DataLineageNodeKind.Table,
    side,
    depth,
    name: `public.${id.slice(-4)}`,
    dataAssetId: id,
    database: "Warehouse",
    assetKind: DataAssetKind.Table,
    freshness: DataAssetFreshness.Fresh,
    lateBySeconds: 0,
    isDropped: false,
    openAlertCount: 0,
    hiddenUpstreamCount: 0,
    hiddenDownstreamCount: 0,
    ...fields,
  };
}

function feeds(source: string, target: string): DataTableLineageEdge {
  return {
    id: getLineageEdgeId({
      kind: DataLineageEdgeKind.Feeds,
      source: `table:${source}`,
      target: `table:${target}`,
    }),
    source: `table:${source}`,
    target: `table:${target}`,
    kind: DataLineageEdgeKind.Feeds,
    seenIn: [DataAssetLineageSource.Pipeline],
    pipelines: [],
    lastSeenAt: null,
  };
}

/*
 * The Event Overview's data alert: payments.ledger_entries, the alert's
 * table, with an open alert, built from payments.provider_callbacks, which
 * has one too; ledger_entries builds mart.revenue (late, one open alert)
 * and the dropped legacy.ledger. Both alerts' tables are fresh.
 */
function aLineage(
  ownOpenAlerts: number = 1,
  fields: Partial<DataTableLineage> = {},
): DataTableLineage {
  return {
    focusNodeId: `table:${LEDGER}`,
    depth: 3,
    nodes: [
      table(LEDGER, DataLineageSide.Focus, 0, {
        name: "payments.ledger_entries",
        openAlertCount: ownOpenAlerts,
      }),
      table(CALLBACKS, DataLineageSide.Upstream, -1, {
        name: "payments.provider_callbacks",
        openAlertCount: 1,
      }),
      table(MART, DataLineageSide.Downstream, 1, {
        name: "mart.revenue",
        freshness: DataAssetFreshness.Late,
        lateBySeconds: 2 * 3600,
        openAlertCount: 1,
      }),
      table(OLD, DataLineageSide.Downstream, 1, {
        name: "legacy.ledger",
        isDropped: true,
        openAlertCount: 3,
      }),
    ],
    edges: [feeds(CALLBACKS, LEDGER), feeds(LEDGER, MART), feeds(LEDGER, OLD)],
    hiddenDashboardCount: 0,
    isTruncated: false,
    ...fields,
  };
}

function anAnswer(
  fields: Partial<DataAlertLineageAnswer> = {},
  ownOpenAlerts: number = 1,
): DataAlertLineageAnswer {
  return {
    lineage: aLineage(ownOpenAlerts),
    hasCause: false,
    isCauseDrawn: false,
    consequenceCount: 0,
    drawnConsequenceCount: 0,
    column: null,
    ...fields,
  };
}

// The chips' row on a card, and what each chip in it says, in order.
function chipRow(nodeId: string): HTMLElement {
  return within(screen.getByTestId(`flow-node-${nodeId}`)).getByTestId(
    "lineage-card-chips",
  );
}

function chipWrappers(nodeId: string): Array<HTMLElement> {
  return Array.from(chipRow(nodeId).children) as Array<HTMLElement>;
}

function chips(nodeId: string): Array<string> {
  return chipWrappers(nodeId).map((wrapper: HTMLElement): string => {
    return wrapper.textContent || "";
  });
}

async function renderAlert(answer: DataAlertLineageAnswer): Promise<void> {
  getAlertLineageMock.mockResolvedValue(answer);
  render(<AlertLineageDiagram alertId={new ObjectID(ALERT)} />);
  await screen.findByTestId("mock-react-flow");
}

/*
 * Where the browser drew an element, top to bottom in the page's pixels:
 * jsdom draws nothing, so each test says it.
 */
function drawAt(element: Element, top: number, bottom: number): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: (): DOMRect => {
      return {
        x: 0,
        y: top,
        top,
        bottom,
        left: 0,
        right: 120,
        width: 120,
        height: bottom - top,
        toJSON: (): Record<string, never> => {
          return {};
        },
      } as DOMRect;
    },
  });
}

/*
 * A card's chips as a browser lays them out: the row one small pill high
 * (17.5px), the first chip on its line and the second either beside it or
 * on the line below, 4px down (gap-1), out of the row's view.
 */
const ROW_HEIGHT_PX: number = 17.5;

function drawChips(nodeId: string, isSecondBelow: boolean): HTMLElement {
  const row: HTMLElement = chipRow(nodeId);
  const [first, second] = chipWrappers(nodeId);

  drawAt(row, 0, ROW_HEIGHT_PX);
  drawAt(first!, 0, ROW_HEIGHT_PX);

  if (second) {
    if (isSecondBelow) {
      drawAt(second, ROW_HEIGHT_PX + 4, 2 * ROW_HEIGHT_PX + 4);
    } else {
      drawAt(second, 0, ROW_HEIGHT_PX);
    }
  }

  return row;
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  // English unless a test reads the page in another language: with no English file, each word is its own.
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      ["ru", "fa", "de"].map((language: string) => {
        return [language, { translation: readDashboardLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(async () => {
  getTableLineageMock.mockReset();
  getPipelineLineageMock.mockReset();
  getAlertLineageMock.mockReset();
  resetFlowStandIn();
  await inLanguage("en");
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await inLanguage("en");
});

describe("how many open alerts a card's chip counts", () => {
  const own: DataTableLineageNode = table(LEDGER, DataLineageSide.Focus, 0, {
    openAlertCount: 1,
  });

  test("on an alert's own card, while the alert is open, one open alert is the alert itself: none is counted", () => {
    expect(
      getLineageCardOpenAlerts({
        node: own,
        isFocus: true,
        place: LineagePlace.Alert,
        isAlertOpen: true,
      }),
    ).toBe(0);
  });

  test("a resolved alert's card, or one whose drawing does not say, counts the open alert: it is another", () => {
    expect(
      getLineageCardOpenAlerts({
        node: own,
        isFocus: true,
        place: LineagePlace.Alert,
        isAlertOpen: false,
      }),
    ).toBe(1);
    expect(
      getLineageCardOpenAlerts({
        node: own,
        isFocus: true,
        place: LineagePlace.Alert,
      }),
    ).toBe(1);
  });

  test("more than one open alert is counted whole, the alert itself among them", () => {
    expect(
      getLineageCardOpenAlerts({
        node: { ...own, openAlertCount: 2 },
        isFocus: true,
        place: LineagePlace.Alert,
        isAlertOpen: true,
      }),
    ).toBe(2);
  });

  test("any other card counts its open alerts: one beside the alert's own, and a table's or a pipeline's own card", () => {
    expect(
      getLineageCardOpenAlerts({
        node: own,
        isFocus: false,
        place: LineagePlace.Alert,
        isAlertOpen: true,
      }),
    ).toBe(1);
    expect(
      getLineageCardOpenAlerts({
        node: own,
        isFocus: true,
        place: LineagePlace.Table,
        isAlertOpen: true,
      }),
    ).toBe(1);
    expect(
      getLineageCardOpenAlerts({
        node: own,
        isFocus: true,
        place: LineagePlace.Pipeline,
        isAlertOpen: true,
      }),
    ).toBe(1);
  });

  test("a count that is not there, or below none, is none", () => {
    expect(
      getLineageCardOpenAlerts({
        node: { ...own, openAlertCount: undefined },
        isFocus: false,
        place: LineagePlace.Table,
      }),
    ).toBe(0);
    expect(
      getLineageCardOpenAlerts({
        node: { ...own, openAlertCount: -2 },
        isFocus: false,
        place: LineagePlace.Table,
      }),
    ).toBe(0);
  });
});

describe("an alert's own card", () => {
  test("while the alert is open: This alert, then how fresh its table is - not the one open alert that is the alert itself", async () => {
    await renderAlert(anAnswer({ isAlertOpen: true }));

    expect(chips(`table:${LEDGER}`)).toEqual(["This alert", "Fresh"]);
    // Its top edge still says a problem: the alert is open on it.
    expect(
      within(screen.getByTestId(`flow-node-table:${LEDGER}`)).queryByText(
        "1 open alert",
      ),
    ).not.toBeInTheDocument();
  });

  test("the card beside it still counts its own open alert", async () => {
    await renderAlert(anAnswer({ isAlertOpen: true }));

    expect(chips(`table:${CALLBACKS}`)).toEqual(["1 open alert", "Fresh"]);
    expect(chips(`table:${MART}`)).toEqual(["1 open alert", "Late by 2 hours"]);
    // A dropped table says so, whatever it counted.
    expect(chips(`table:${OLD}`)).toEqual(["Dropped"]);
  });

  test("a resolved alert's card counts the one open alert: it is another alert", async () => {
    await renderAlert(anAnswer({ isAlertOpen: false }));

    expect(chips(`table:${LEDGER}`)).toEqual(["This alert", "1 open alert"]);
  });

  test("a drawing that does not say whether the alert is open shows the count as it is", async () => {
    await renderAlert(anAnswer());

    expect(chips(`table:${LEDGER}`)).toEqual(["This alert", "1 open alert"]);
  });

  test("more than one open alert is counted, the alert itself among them", async () => {
    await renderAlert(anAnswer({ isAlertOpen: true }, 2));

    expect(chips(`table:${LEDGER}`)).toEqual(["This alert", "2 open alerts"]);
  });

  test("on a table's own Lineage tab, its one open alert is counted: no alert is this page's", async () => {
    getTableLineageMock.mockResolvedValue(aLineage(1));
    render(<TableLineageDiagram dataAssetId={new ObjectID(LEDGER)} />);
    await screen.findByTestId("mock-react-flow");

    expect(chips(`table:${LEDGER}`)).toEqual(["This table", "1 open alert"]);
  });
});

describe("two chips wider than the card", () => {
  test("the row is one small pill high and shows one line of chips, clipping the rest; the first chip keeps its width, the second gives way down to a few letters", async () => {
    await renderAlert(anAnswer());

    const row: HTMLElement = chipRow(`table:${LEDGER}`);
    const [first, second] = chipWrappers(`table:${LEDGER}`);

    expect(LINEAGE_CHIP_ROW_CLASS_NAME.split(" ")).toEqual([
      "mt-1.5",
      "flex",
      "h-[1.75em]",
      "flex-wrap",
      "items-center",
      "gap-1",
      "overflow-hidden",
    ]);
    expect(row.className).toBe(LINEAGE_CHIP_ROW_CLASS_NAME);
    // Its ems are a small pill's, so its height and the second chip's least room scale with the pills.
    expect(row.style.fontSize).toBe(PillSize.Small);
    expect(PillSize.Small).toBe("10px");
    within(row)
      .getAllByTestId("pill")
      .forEach((pill: HTMLElement): void => {
        expect(pill.style.fontSize).toBe(PillSize.Small);
      });
    /*
     * One pill high: a pill is its line (leading 1.35) and its padding above
     * and below (0.2em each), 1.75em. A pill that changes either must change
     * the row too, or the row cuts its pills or shows its second line.
     */
    expect(PILL_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["py-[0.2em]", "leading-[1.35]"]),
    );
    expect(1.35 + 2 * 0.2).toBeCloseTo(1.75, 10);

    expect(LINEAGE_FIRST_CHIP_CLASS_NAME.split(" ")).toEqual([
      "flex",
      "max-w-full",
      "shrink-0",
    ]);
    expect(LINEAGE_CHIP_LEAST).toBe("4.8em");
    expect(LINEAGE_SECOND_CHIP_CLASS_NAME.split(" ")).toEqual([
      "flex",
      "min-w-0",
      "max-w-max",
      "grow",
      `basis-[${LINEAGE_CHIP_LEAST}]`,
    ]);
    expect(first!.className).toBe(LINEAGE_FIRST_CHIP_CLASS_NAME);
    expect(second!.className).toBe(LINEAGE_SECOND_CHIP_CLASS_NAME);
    // The second chip's pill: no wider than what it is given, its words cut with "...".
    expect(within(second!).getByTestId("pill")).toHaveClass("max-w-full");
    expect(within(second!).getByTestId("pill-text")).toHaveClass(
      "min-w-0",
      "truncate",
    );
  });

  test("every card's chips are wrapped so, at most two of them, each named for what it says", async () => {
    await renderAlert(anAnswer({ isAlertOpen: true }));

    for (const id of [LEDGER, CALLBACKS, MART, OLD]) {
      const wrappers: Array<HTMLElement> = chipWrappers(`table:${id}`);

      expect(wrappers.length).toBeGreaterThan(0);
      expect(wrappers.length).toBeLessThanOrEqual(2);
      wrappers.forEach((wrapper: HTMLElement, index: number): void => {
        expect(wrapper.className).toBe(
          index === 0
            ? LINEAGE_FIRST_CHIP_CLASS_NAME
            : LINEAGE_SECOND_CHIP_CLASS_NAME,
        );
      });
    }

    expect(
      chipWrappers(`table:${LEDGER}`).map((wrapper: HTMLElement) => {
        return wrapper.getAttribute("data-lineage-chip");
      }),
    ).toEqual(["focus", "fresh"]);
    expect(
      chipWrappers(`table:${MART}`).map((wrapper: HTMLElement) => {
        return wrapper.getAttribute("data-lineage-chip");
      }),
    ).toEqual(["alerts", "late"]);
  });

  test("a chip cut short says all of itself under the pointer, and all of it is in the card's name", async () => {
    await renderAlert(anAnswer());

    const second: HTMLElement = chipWrappers(`table:${LEDGER}`)[1]!;
    const words: HTMLElement = within(second).getByTestId("pill-text");

    // The browser cut its words to fit: wider than the room it shows them in.
    Object.defineProperty(words, "scrollWidth", {
      configurable: true,
      value: 140,
    });
    Object.defineProperty(words, "clientWidth", {
      configurable: true,
      value: 52,
    });
    fireEvent.mouseEnter(words);

    expect(words).toHaveAttribute("title", "1 open alert");
    // Cut only on screen: its words are whole in the page, which the card's link is named from.
    expect(words).toHaveTextContent("1 open alert");

    const link: HTMLElement = within(
      screen.getByTestId(`flow-node-table:${LEDGER}`),
    ).getByTestId("lineage-card");

    expect(link.tagName).toBe("A");
    expect(link).toHaveTextContent("This alert");
    expect(link).toHaveTextContent("1 open alert");
    // Cut but in view: the chip says itself, and the row has nothing to add.
    fireEvent.mouseEnter(drawChips(`table:${LEDGER}`, false));
    expect(chipRow(`table:${LEDGER}`)).not.toHaveAttribute("title");
  });

  test("a chip that fits says nothing more under the pointer", async () => {
    await renderAlert(anAnswer());

    const words: HTMLElement = within(
      chipWrappers(`table:${LEDGER}`)[0]!,
    ).getByTestId("pill-text");

    Object.defineProperty(words, "scrollWidth", {
      configurable: true,
      value: 52,
    });
    Object.defineProperty(words, "clientWidth", {
      configurable: true,
      value: 52,
    });
    fireEvent.mouseEnter(words);

    expect(words).not.toHaveAttribute("title");
  });

  test("a pipeline's card: This pipeline, then its last run, each wrapped as any chip is", async () => {
    getPipelineLineageMock.mockResolvedValue({
      focusNodeId: ETL_NODE,
      depth: 1,
      nodes: [
        {
          id: ETL_NODE,
          kind: DataLineageNodeKind.Pipeline,
          side: DataLineageSide.Focus,
          depth: 0,
          name: "orders_etl",
          dataPipelineId: ETL,
          jobNamespace: "airflow",
          lastRunState: "FAIL",
          lastRunStartedAt: null,
          lastErrorMessage: null,
          hiddenUpstreamCount: 0,
          hiddenDownstreamCount: 0,
        },
        table(LEDGER, DataLineageSide.Downstream, 1),
      ],
      edges: [
        {
          id: getLineageEdgeId({
            kind: DataLineageEdgeKind.Writes,
            source: ETL_NODE,
            target: `table:${LEDGER}`,
          }),
          source: ETL_NODE,
          target: `table:${LEDGER}`,
          kind: DataLineageEdgeKind.Writes,
          seenIn: [DataAssetLineageSource.Pipeline],
          pipelines: [],
          lastSeenAt: null,
        },
      ],
      hiddenDashboardCount: 0,
      isTruncated: false,
    } as DataTableLineage);
    render(<PipelineLineageDiagram dataPipelineId={new ObjectID(ETL)} />);
    await screen.findByTestId("mock-react-flow");

    const wrappers: Array<HTMLElement> = chipWrappers(ETL_NODE);

    expect(chips(ETL_NODE)).toEqual(["This pipeline", "Failed"]);
    expect(wrappers[0]!.className).toBe(LINEAGE_FIRST_CHIP_CLASS_NAME);
    expect(wrappers[1]!.className).toBe(LINEAGE_SECOND_CHIP_CLASS_NAME);
    expect(wrappers[1]!.getAttribute("data-lineage-chip")).toBe("run");
    // The run's pill sits straight in its wrapper, which gives it the room.
    expect(wrappers[1]!.firstElementChild).toBe(
      within(wrappers[1]!).getByTestId("pill"),
    );
  });
});

/*
 * A SECOND CHIP LEFT TOO LITTLE ROOM (#6957). In Russian the cause's card
 * says "Открытых оповещений: 1", which leaves "Свежая" room for "С..." -
 * a chip that says nothing. It moves to the row's second line, which the
 * row does not show; its words stay in the card's name, and the row says
 * both chips under the pointer.
 */
describe("a second chip left too little room (#6957)", () => {
  // payments.provider_callbacks: its open alert, then how fresh it is.
  const CALLBACKS_CARD: string = `table:${CALLBACKS}`;

  test("moves to the row's second line, out of view, and the row says both chips' words under the pointer, the first chip's first", async () => {
    await renderAlert(anAnswer());

    expect(chips(CALLBACKS_CARD)).toEqual(["1 open alert", "Fresh"]);

    const row: HTMLElement = drawChips(CALLBACKS_CARD, true);
    const [first, second] = chipWrappers(CALLBACKS_CARD);

    expect(isLineageChipOutOfView(first!, row)).toBe(false);
    expect(isLineageChipOutOfView(second!, row)).toBe(true);
    expect(row).not.toHaveAttribute("title");

    fireEvent.mouseEnter(row);

    expect(INLINE_SEPARATOR).toBe(" \u{00B7} ");
    expect(row).toHaveAttribute("title", "1 open alert \u{00B7} Fresh");
    // The chip moved, it was not taken out: both are still the card's.
    expect(chips(CALLBACKS_CARD)).toEqual(["1 open alert", "Fresh"]);
  });

  test("its words stay in the card's name read aloud: hidden from sight only, never from a screen reader", async () => {
    await renderAlert(anAnswer());

    drawChips(CALLBACKS_CARD, true);

    const second: HTMLElement = chipWrappers(CALLBACKS_CARD)[1]!;
    const link: HTMLElement = within(
      screen.getByTestId(`flow-node-${CALLBACKS_CARD}`),
    ).getByTestId("lineage-card");

    expect(link).toHaveAccessibleName(/1 open alert/);
    expect(link).toHaveAccessibleName(/Fresh/);
    expect(second).not.toHaveAttribute("aria-hidden");
    expect(second).not.toHaveClass("hidden");
    expect(second).not.toHaveClass("sr-only");
    expect(second.style.display).toBe("");
  });

  test("a row whose chips all show says nothing more under the pointer", async () => {
    await renderAlert(anAnswer());

    const row: HTMLElement = drawChips(CALLBACKS_CARD, false);

    fireEvent.mouseEnter(row);

    expect(row).not.toHaveAttribute("title");
  });

  test("the row's words go once its chips all show again, as when the drawing is read again with shorter words", async () => {
    await renderAlert(anAnswer());

    const row: HTMLElement = drawChips(CALLBACKS_CARD, true);

    fireEvent.mouseEnter(row);
    expect(row).toHaveAttribute("title", "1 open alert \u{00B7} Fresh");

    fireEvent.mouseLeave(row);
    drawChips(CALLBACKS_CARD, false);
    fireEvent.mouseEnter(row);

    expect(row).not.toHaveAttribute("title");
  });

  test("the pointer on a chip's words says the row's words too: entering a chip enters its row", async () => {
    await renderAlert(anAnswer());

    const row: HTMLElement = drawChips(CALLBACKS_CARD, true);
    const words: HTMLElement = within(
      chipWrappers(CALLBACKS_CARD)[0]!,
    ).getByTestId("pill-text");

    fireEvent.mouseEnter(words);

    expect(row).toHaveAttribute("title", "1 open alert \u{00B7} Fresh");
    // The first chip shows whole, so it adds no words of its own: the row's show.
    expect(words).not.toHaveAttribute("title");
  });

  test("a card of one chip has no second line, and nothing more to say under the pointer", async () => {
    await renderAlert(anAnswer({ isAlertOpen: true }));

    expect(chips(`table:${OLD}`)).toEqual(["Dropped"]);

    const row: HTMLElement = drawChips(`table:${OLD}`, false);

    fireEvent.mouseEnter(row);

    expect(row).not.toHaveAttribute("title");
  });

  test("a page that cannot say where its chips are drawn - no layout - has every chip in view", async () => {
    await renderAlert(anAnswer());

    const row: HTMLElement = chipRow(CALLBACKS_CARD);

    for (const wrapper of chipWrappers(CALLBACKS_CARD)) {
      expect(isLineageChipOutOfView(wrapper, row)).toBe(false);
    }

    fireEvent.mouseEnter(row);

    expect(row).not.toHaveAttribute("title");
  });

  test("a chip is out of view below the row's foot, past half a pixel of a browser's rounding, at any zoom", () => {
    const row: HTMLSpanElement = document.createElement("span");
    const chip: HTMLSpanElement = document.createElement("span");

    // A row 17.5px high, 10px down the page.
    drawAt(row, 10, 27.5);

    drawAt(chip, 10, 27.5);
    expect(isLineageChipOutOfView(chip, row)).toBe(false);

    // Drawn a fraction lower than its row: the same line, rounded.
    drawAt(chip, 10.4, 27.9);
    expect(isLineageChipOutOfView(chip, row)).toBe(false);

    // The second line: 4px under the first.
    drawAt(chip, 31.5, 49);
    expect(isLineageChipOutOfView(chip, row)).toBe(true);

    // In a drawing zoomed out to 0.89, the row is 15.6px high and the gap 3.6px.
    drawAt(row, 100, 115.6);
    drawAt(chip, 100, 115.6);
    expect(isLineageChipOutOfView(chip, row)).toBe(false);
    drawAt(chip, 119.2, 134.8);
    expect(isLineageChipOutOfView(chip, row)).toBe(true);
  });

  test("in Russian: Свежая moves out of view after Открытых оповещений: 1, and the row says both as Russian lists facts on a line", async () => {
    await inLanguage("ru");
    await renderAlert(anAnswer());

    expect(chips(CALLBACKS_CARD).map(withoutIsolateMarks)).toEqual([
      "Открытых оповещений: 1",
      "Свежая",
    ]);

    const row: HTMLElement = drawChips(CALLBACKS_CARD, true);

    fireEvent.mouseEnter(row);

    expect(withoutIsolateMarks(row.getAttribute("title") || "")).toBe(
      "Открытых оповещений: 1 \u{00B7} Свежая",
    );
    expect(
      within(screen.getByTestId(`flow-node-${CALLBACKS_CARD}`)).getByTestId(
        "lineage-card",
      ),
    ).toHaveAccessibleName(/Свежая/);
  });

  test("in Persian: the row's words joined with the bullet Persian lists facts with, the count in Persian digits", async () => {
    await inLanguage("fa");
    await renderAlert(anAnswer());

    expect(chips(CALLBACKS_CARD).map(withoutIsolateMarks)).toEqual([
      "\u{06F1} هشدار باز",
      "تازه",
    ]);

    const row: HTMLElement = drawChips(CALLBACKS_CARD, true);

    fireEvent.mouseEnter(row);

    expect(DOT_ZERO_INLINE_SEPARATOR).toBe(" \u{2022} ");
    expect(withoutIsolateMarks(row.getAttribute("title") || "")).toBe(
      "\u{06F1} هشدار باز \u{2022} تازه",
    );
  });

  test("in German: the own card's second chip is cut but in view - it says itself under the pointer, and the row adds nothing", async () => {
    await inLanguage("de");
    await renderAlert(anAnswer());

    expect(chips(`table:${LEDGER}`).map(withoutIsolateMarks)).toEqual([
      "Diese Warnung",
      "1 offener Alarm",
    ]);

    const row: HTMLElement = drawChips(`table:${LEDGER}`, false);
    const words: HTMLElement = within(
      chipWrappers(`table:${LEDGER}`)[1]!,
    ).getByTestId("pill-text");

    Object.defineProperty(words, "scrollWidth", {
      configurable: true,
      value: 77,
    });
    Object.defineProperty(words, "clientWidth", {
      configurable: true,
      value: 61,
    });
    fireEvent.mouseEnter(words);

    expect(withoutIsolateMarks(words.getAttribute("title") || "")).toBe(
      "1 offener Alarm",
    );
    expect(row).not.toHaveAttribute("title");
  });
});
