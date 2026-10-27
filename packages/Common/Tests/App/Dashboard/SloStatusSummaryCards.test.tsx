import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React from "react";
import { Mock } from "jest-mock";
import SloStatusSummaryCards, {
  hasAnySlo,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloStatusSummaryCards";
import {
  getSloSummaryHadSlosKey,
  rememberProjectHasSlos,
  SLO_ENABLED_FACET_KEY,
  SLO_STATUS_FACET_KEY,
  SLO_STATUS_SUMMARY_TILES,
  SloEnabledFacetValue,
  SloStatusSummaryTile,
  SloStatusSummaryTileKey,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloStatusSummaryTiles";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";

/*
 * The strip above the SLO list. Its counting rules are pinned without a
 * renderer in App/Tests/Dashboard/SloStatusSummaryTiles.test.ts; what is left
 * here is behaviour only a render shows: one COUNT per tile scoped to the
 * project, inert tiles until the numbers land, the pressed state following the
 * chips, hiding on failure, and a slow old count never overwriting a fresh one.
 *
 * And no skeletons where there is nothing to count: while the counts load,
 * the strip holds its place with skeleton tiles only on a project this
 * browser last saw with an SLO. On a new project they flashed six grey boxes
 * over the empty list for the moment the counts took, then vanished.
 */

interface CountArgs {
  modelType: unknown;
  query: Record<string, unknown>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const countMock: Mock<(args: CountArgs) => Promise<number>> =
  jest.fn<(args: CountArgs) => Promise<number>>();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (args: CountArgs): Promise<number> => {
        return countMock(args);
      },
    },
  };
});

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

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5555-4aaa-8bbb-000000000005",
);

const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5555-4aaa-8bbb-000000000006",
);

const COUNTS: Record<SloStatusSummaryTileKey, number> = {
  [SloStatusSummaryTileKey.Healthy]: 12,
  [SloStatusSummaryTileKey.AtRisk]: 3,
  [SloStatusSummaryTileKey.BudgetExhausted]: 1,
  [SloStatusSummaryTileKey.Misconfigured]: 2,
  [SloStatusSummaryTileKey.Paused]: 0,
  [SloStatusSummaryTileKey.Disabled]: 4,
};

function zeroCounts(): Record<SloStatusSummaryTileKey, number> {
  return {
    [SloStatusSummaryTileKey.Healthy]: 0,
    [SloStatusSummaryTileKey.AtRisk]: 0,
    [SloStatusSummaryTileKey.BudgetExhausted]: 0,
    [SloStatusSummaryTileKey.Misconfigured]: 0,
    [SloStatusSummaryTileKey.Paused]: 0,
    [SloStatusSummaryTileKey.Disabled]: 0,
  };
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>((resolve: (value: T) => void) => {
    resolvePromise = resolve;
  });

  return { promise: promise, resolve: resolvePromise };
}

// Which tile a count query belongs to, read off the query itself.
function tileKeyForQuery(
  query: Record<string, unknown>,
): SloStatusSummaryTileKey {
  if (query["isEnabled"] === false) {
    return SloStatusSummaryTileKey.Disabled;
  }

  const tile: SloStatusSummaryTile | undefined = SLO_STATUS_SUMMARY_TILES.find(
    (candidate: SloStatusSummaryTile): boolean => {
      return candidate.sloStatus === query["sloStatus"];
    },
  );

  if (!tile) {
    throw new Error(`Unexpected count query ${JSON.stringify(query)}`);
  }

  return tile.key;
}

function countsFrom(
  table: Record<SloStatusSummaryTileKey, number>,
): (args: CountArgs) => Promise<number> {
  return (args: CountArgs): Promise<number> => {
    return Promise.resolve(table[tileKeyForQuery(args.query)]);
  };
}

interface RenderOptions {
  facetSelections?: Record<string, Array<string>> | undefined;
  onTileClick?: ((tile: SloStatusSummaryTile) => void) | undefined;
  refreshToken?: string | undefined;
  projectId?: ObjectID | undefined;
}

function renderStrip(options: RenderOptions = {}): ReturnType<typeof render> {
  return render(
    <SloStatusSummaryCards
      projectId={options.projectId || PROJECT_ID}
      facetSelections={options.facetSelections || {}}
      facetOperators={{}}
      onTileClick={options.onTileClick}
      refreshToken={options.refreshToken}
    />,
  );
}

async function waitForCounts(): Promise<void> {
  await screen.findByTestId(
    `slo-status-count-${SloStatusSummaryTileKey.Healthy}`,
  );
}

function tileButton(label: string, count: number): HTMLElement {
  return screen.getByRole("button", {
    name: new RegExp(`^${label}: ${count}\\.`),
  });
}

// Six counts that answer only when the test says so.
function holdCounts(): Array<Deferred<number>> {
  const held: Array<Deferred<number>> = [];

  countMock.mockImplementation((): Promise<number> => {
    const pending: Deferred<number> = deferred<number>();
    held.push(pending);
    return pending.promise;
  });

  return held;
}

async function answer(
  held: Array<Deferred<number>>,
  value: number,
): Promise<void> {
  await act(async () => {
    for (const pending of held) {
      pending.resolve(value);
    }
    await Promise.all(
      held.map((pending: Deferred<number>) => {
        return pending.promise;
      }),
    );
  });
}

// A skeleton tile: its title is drawn, its count is not yet.
function isShowingSkeletons(): boolean {
  return (
    screen.queryByTestId("slo-status-summary-cards") !== null &&
    screen.queryByTestId(
      `slo-status-count-${SloStatusSummaryTileKey.Healthy}`,
    ) === null
  );
}

beforeEach(() => {
  countMock.mockReset().mockImplementation(countsFrom(COUNTS));
  window.localStorage.clear();
  // The memory of every project the tests use starts empty.
  rememberProjectHasSlos(PROJECT_ID.toString(), false);
  rememberProjectHasSlos(OTHER_PROJECT_ID.toString(), false);
});

afterEach(() => {
  cleanup();
});

describe("SloStatusSummaryCards", () => {
  test("counts each tile once, scoped to the project and to live SLOs", async () => {
    renderStrip({ onTileClick: jest.fn() });
    await waitForCounts();

    expect(countMock).toHaveBeenCalledTimes(SLO_STATUS_SUMMARY_TILES.length);

    const queries: Array<Record<string, unknown>> = countMock.mock.calls.map(
      (args: [CountArgs]): Record<string, unknown> => {
        return args[0].query;
      },
    );

    for (const query of queries) {
      expect((query["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(query["isArchived"]).toBe(false);
    }

    expect(
      queries
        .map((query: Record<string, unknown>): string => {
          return tileKeyForQuery(query);
        })
        .sort(),
    ).toEqual(Object.values(SloStatusSummaryTileKey).sort());
  });

  test("renders every tile's count, with non-zero counts coloured and zeros quiet", async () => {
    renderStrip();
    await waitForCounts();

    for (const tile of SLO_STATUS_SUMMARY_TILES) {
      expect(
        screen.getByTestId(`slo-status-count-${tile.key}`),
      ).toHaveTextContent(String(COUNTS[tile.key]));
      expect(screen.getByText(tile.caption)).toBeInTheDocument();
    }

    expect(
      screen.getByTestId(`slo-status-count-${SloStatusSummaryTileKey.Healthy}`),
    ).toHaveClass("text-emerald-600");
    expect(
      screen.getByTestId(
        `slo-status-count-${SloStatusSummaryTileKey.BudgetExhausted}`,
      ),
    ).toHaveClass("text-red-600");
    expect(
      screen.getByTestId(`slo-status-count-${SloStatusSummaryTileKey.Paused}`),
    ).toHaveClass("text-gray-400");
  });

  test("keeps the tiles inert until the counts land", async () => {
    // Skeleton tiles are drawn only for a project seen with an SLO before.
    rememberProjectHasSlos(PROJECT_ID.toString(), true);
    const pending: Deferred<number> = deferred<number>();
    countMock.mockReturnValue(pending.promise);
    const onTileClick: Mock<(tile: SloStatusSummaryTile) => void> =
      jest.fn<(tile: SloStatusSummaryTile) => void>();

    renderStrip({ onTileClick: onTileClick });

    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);

    fireEvent.click(screen.getByText("Healthy"));
    expect(onTileClick).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve(5);
      await pending.promise;
    });

    expect(screen.getAllByRole("button")).toHaveLength(
      SLO_STATUS_SUMMARY_TILES.length,
    );
  });

  test("hands the page the tile the user activated, by click or keyboard", async () => {
    const onTileClick: Mock<(tile: SloStatusSummaryTile) => void> =
      jest.fn<(tile: SloStatusSummaryTile) => void>();

    renderStrip({ onTileClick: onTileClick });
    await waitForCounts();

    fireEvent.click(tileButton("Budget Exhausted", 1));
    expect(onTileClick).toHaveBeenCalledTimes(1);
    expect(onTileClick.mock.calls[0]![0].key).toBe(
      SloStatusSummaryTileKey.BudgetExhausted,
    );

    fireEvent.keyDown(tileButton("Disabled", 4), { key: "Enter" });
    expect(onTileClick).toHaveBeenCalledTimes(2);
    expect(onTileClick.mock.calls[1]![0].key).toBe(
      SloStatusSummaryTileKey.Disabled,
    );
  });

  test("without a click handler the tiles are plain counts, not buttons", async () => {
    renderStrip();
    await waitForCounts();

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  test("a tile is pressed exactly while the chips show what it describes", async () => {
    renderStrip({
      onTileClick: jest.fn(),
      facetSelections: {
        [SLO_ENABLED_FACET_KEY]: [SloEnabledFacetValue.Enabled],
        [SLO_STATUS_FACET_KEY]: [SloStatus.AtRisk],
      },
    });
    await waitForCounts();

    expect(tileButton("At Risk", 3)).toHaveAttribute("aria-pressed", "true");
    expect(tileButton("At Risk", 3)).toHaveAccessibleName(
      /Filtering the SLO list below/,
    );
    expect(tileButton("Healthy", 12)).toHaveAttribute("aria-pressed", "false");
    expect(tileButton("Disabled", 4)).toHaveAttribute("aria-pressed", "false");
  });

  test("the Disabled tile is pressed when only the Enabled chip is set to disabled", async () => {
    renderStrip({
      onTileClick: jest.fn(),
      facetSelections: {
        [SLO_ENABLED_FACET_KEY]: [SloEnabledFacetValue.Disabled],
      },
    });
    await waitForCounts();

    expect(tileButton("Disabled", 4)).toHaveAttribute("aria-pressed", "true");
  });

  test("a failed count hides the strip rather than showing numbers nobody can trust", async () => {
    countMock.mockRejectedValue(new Error("count failed"));

    renderStrip();

    await waitFor(() => {
      expect(
        screen.queryByTestId("slo-status-summary-cards"),
      ).not.toBeInTheDocument();
    });
  });

  /*
   * A project without a live SLO has nothing to count. Six zeros - Budget
   * Exhausted, Misconfigured, Paused, each with what it means - sat above the
   * empty list's one next step before there was anything to be healthy or
   * not.
   */
  test("a project without a live SLO shows no strip: nothing to count yet", async () => {
    countMock.mockImplementation(countsFrom(zeroCounts()));

    renderStrip({ onTileClick: jest.fn() });

    await waitFor(() => {
      expect(countMock).toHaveBeenCalledTimes(SLO_STATUS_SUMMARY_TILES.length);
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId("slo-status-summary-cards"),
      ).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Budget Exhausted")).toBeNull();
  });

  test("one SLO in any tile brings the whole strip, zeros and all", async () => {
    const counts: Record<SloStatusSummaryTileKey, number> = zeroCounts();
    counts[SloStatusSummaryTileKey.Paused] = 1;
    countMock.mockImplementation(countsFrom(counts));

    renderStrip();
    await waitForCounts();

    expect(screen.getByTestId("slo-status-summary-cards")).toBeInTheDocument();
    expect(
      screen.getByTestId(`slo-status-count-${SloStatusSummaryTileKey.Paused}`),
    ).toHaveTextContent("1");
    expect(
      screen.getByTestId(`slo-status-count-${SloStatusSummaryTileKey.Healthy}`),
    ).toHaveTextContent("0");
  });

  test("a new project draws nothing while it counts: no skeletons flash over the empty list", async () => {
    const held: Array<Deferred<number>> = holdCounts();

    renderStrip({ onTileClick: jest.fn() });

    expect(held).toHaveLength(SLO_STATUS_SUMMARY_TILES.length);
    expect(screen.queryByTestId("slo-status-summary-cards")).toBeNull();
    expect(screen.queryByText("Healthy")).toBeNull();
    expect(screen.queryByText("Budget Exhausted")).toBeNull();

    await answer(held, 0);

    expect(screen.queryByTestId("slo-status-summary-cards")).toBeNull();
    expect(screen.queryByText("Healthy")).toBeNull();
  });

  test("a project this browser saw with an SLO holds the strip's place with skeletons while it counts", async () => {
    rememberProjectHasSlos(PROJECT_ID.toString(), true);
    const held: Array<Deferred<number>> = holdCounts();

    renderStrip({ onTileClick: jest.fn() });

    expect(isShowingSkeletons()).toBe(true);
    for (const tile of SLO_STATUS_SUMMARY_TILES) {
      expect(screen.getByText(tile.label)).toBeInTheDocument();
    }

    await answer(held, 2);

    expect(isShowingSkeletons()).toBe(false);
    expect(
      screen.getByTestId(`slo-status-count-${SloStatusSummaryTileKey.Healthy}`),
    ).toHaveTextContent("2");
  });

  test("a project with SLOs this browser has not seen yet shows its tiles once the counts land", async () => {
    const held: Array<Deferred<number>> = holdCounts();

    renderStrip();

    expect(screen.queryByTestId("slo-status-summary-cards")).toBeNull();

    await answer(held, 3);

    expect(screen.getByTestId("slo-status-summary-cards")).toBeInTheDocument();
    expect(
      screen.getByTestId(`slo-status-count-${SloStatusSummaryTileKey.AtRisk}`),
    ).toHaveTextContent("3");
  });

  test("the strip remembers what it found, project by project", async () => {
    const key: string = getSloSummaryHadSlosKey(PROJECT_ID.toString());

    renderStrip();
    await waitForCounts();
    expect(window.localStorage.getItem(key)).toBe("1");
    cleanup();

    // Another project is not this one: nothing remembered for it.
    holdCounts();
    renderStrip({ projectId: OTHER_PROJECT_ID });
    expect(screen.queryByTestId("slo-status-summary-cards")).toBeNull();
    cleanup();

    // Every SLO archived since: the memory goes with them.
    countMock.mockImplementation(countsFrom(zeroCounts()));
    renderStrip();
    expect(isShowingSkeletons()).toBe(true);
    await waitFor(() => {
      expect(screen.queryByTestId("slo-status-summary-cards")).toBeNull();
    });
    expect(window.localStorage.getItem(key)).toBeNull();
    cleanup();

    holdCounts();
    renderStrip();
    expect(screen.queryByTestId("slo-status-summary-cards")).toBeNull();
  });

  test("a failed count keeps what the strip remembered", async () => {
    rememberProjectHasSlos(PROJECT_ID.toString(), true);
    countMock.mockRejectedValue(new Error("count failed"));

    renderStrip();

    await waitFor(() => {
      expect(screen.queryByTestId("slo-status-summary-cards")).toBeNull();
    });
    expect(
      window.localStorage.getItem(
        getSloSummaryHadSlosKey(PROJECT_ID.toString()),
      ),
    ).toBe("1");
  });

  test("hasAnySlo adds the tiles up", () => {
    expect(hasAnySlo({})).toBe(false);
    expect(hasAnySlo(zeroCounts())).toBe(false);
    expect(hasAnySlo({ [SloStatusSummaryTileKey.Disabled]: 2 })).toBe(true);
  });

  test("a new refresh token recounts; a rebuilt project id with the same value does not", async () => {
    const view: ReturnType<typeof render> = renderStrip({
      refreshToken: "0",
    });
    await waitForCounts();
    expect(countMock).toHaveBeenCalledTimes(6);

    view.rerender(
      <SloStatusSummaryCards
        projectId={new ObjectID(PROJECT_ID.toString())}
        facetSelections={{}}
        facetOperators={{}}
        refreshToken="0"
      />,
    );
    expect(countMock).toHaveBeenCalledTimes(6);

    countMock.mockImplementation(
      countsFrom({ ...COUNTS, [SloStatusSummaryTileKey.Healthy]: 11 }),
    );

    view.rerender(
      <SloStatusSummaryCards
        projectId={PROJECT_ID}
        facetSelections={{}}
        facetOperators={{}}
        refreshToken="1"
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId(
          `slo-status-count-${SloStatusSummaryTileKey.Healthy}`,
        ),
      ).toHaveTextContent("11");
    });
    expect(countMock).toHaveBeenCalledTimes(12);
  });

  test("a slow earlier count never overwrites a newer one", async () => {
    const slowFirstRound: Array<Deferred<number>> = [];

    countMock.mockImplementation((): Promise<number> => {
      const pending: Deferred<number> = deferred<number>();
      slowFirstRound.push(pending);
      return pending.promise;
    });

    const view: ReturnType<typeof render> = renderStrip({
      refreshToken: "0",
    });

    expect(slowFirstRound).toHaveLength(6);

    countMock.mockImplementation(
      countsFrom({ ...COUNTS, [SloStatusSummaryTileKey.Healthy]: 7 }),
    );

    view.rerender(
      <SloStatusSummaryCards
        projectId={PROJECT_ID}
        facetSelections={{}}
        facetOperators={{}}
        refreshToken="1"
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId(
          `slo-status-count-${SloStatusSummaryTileKey.Healthy}`,
        ),
      ).toHaveTextContent("7");
    });

    await act(async () => {
      for (const pending of slowFirstRound) {
        pending.resolve(99);
      }
      await Promise.all(
        slowFirstRound.map((pending: Deferred<number>) => {
          return pending.promise;
        }),
      );
    });

    expect(
      screen.getByTestId(`slo-status-count-${SloStatusSummaryTileKey.Healthy}`),
    ).toHaveTextContent("7");
  });
});
