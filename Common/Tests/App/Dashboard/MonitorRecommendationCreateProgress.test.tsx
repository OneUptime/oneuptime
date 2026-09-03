/*
 * The main entry, not "/extend-expect": the latter no longer ships type
 * declarations, so every jest-dom matcher in this file fails to typecheck and
 * the whole suite is skipped before a single assertion runs.
 */
import "@testing-library/jest-dom";
import { render, RenderResult, screen, within } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";
import CreateProgressPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationCreateProgress";
import MonitorRecommendationCreateRunner, {
  MonitorRecommendationCreateItemProgress,
  MonitorRecommendationCreateItemStatus,
  MonitorRecommendationCreateProgress,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationCreateRunner";

/*
 * The panel a user stares at for the better part of a minute after pressing
 * Create on a batch of recommendations. Everything asserted here is something
 * that, if it broke, would leave that minute unexplained:
 *
 *   - a bar that counts only successes stalls short of the end forever on any
 *     run that had a failure, so the panel says "still working" about a batch
 *     that finished;
 *   - rows that appear one at a time reproduce the original complaint, which
 *     was that NOTHING appeared until the first monitor had already landed —
 *     the longest silence in the operation was the one right after the click;
 *   - a Failed row that does not carry its error message loses that error for
 *     good, because the run no longer aborts and nothing else in the app
 *     records why one monitor out of eighteen did not get made.
 *
 * The counts below are always derived from the item statuses rather than
 * written out by hand, so a test cannot accidentally assert against a progress
 * shape the runner would never emit.
 */

type MakeItemFunction = (data: {
  recommendationId: string;
  name: string;
  status: MonitorRecommendationCreateItemStatus;
  errorMessage?: string | undefined;
}) => MonitorRecommendationCreateItemProgress;

const makeItem: MakeItemFunction = (data: {
  recommendationId: string;
  name: string;
  status: MonitorRecommendationCreateItemStatus;
  errorMessage?: string | undefined;
}): MonitorRecommendationCreateItemProgress => {
  return {
    recommendationId: data.recommendationId,
    name: data.name,
    status: data.status,
    errorMessage: data.errorMessage,
  };
};

type CountWithStatusFunction = (
  items: Array<MonitorRecommendationCreateItemProgress>,
  status: MonitorRecommendationCreateItemStatus,
) => number;

const countWithStatus: CountWithStatusFunction = (
  items: Array<MonitorRecommendationCreateItemProgress>,
  status: MonitorRecommendationCreateItemStatus,
): number => {
  return items.filter(
    (item: MonitorRecommendationCreateItemProgress): boolean => {
      return item.status === status;
    },
  ).length;
};

type MakeProgressFunction = (
  items: Array<MonitorRecommendationCreateItemProgress>,
) => MonitorRecommendationCreateProgress;

const makeProgress: MakeProgressFunction = (
  items: Array<MonitorRecommendationCreateItemProgress>,
): MonitorRecommendationCreateProgress => {
  const createdCount: number = countWithStatus(
    items,
    MonitorRecommendationCreateItemStatus.Created,
  );
  const failedCount: number = countWithStatus(
    items,
    MonitorRecommendationCreateItemStatus.Failed,
  );

  return {
    items: items,
    totalCount: items.length,
    createdCount: createdCount,
    failedCount: failedCount,
    isComplete: createdCount + failedCount === items.length,
  };
};

type RenderPanelFunction = (
  progress: MonitorRecommendationCreateProgress,
) => RenderResult;

const renderPanel: RenderPanelFunction = (
  progress: MonitorRecommendationCreateProgress,
): RenderResult => {
  return render(<CreateProgressPanel progress={progress} />);
};

type GetRowFunction = (recommendationId: string) => HTMLElement;

const getRow: GetRowFunction = (recommendationId: string): HTMLElement => {
  return screen.getByTestId(
    `monitor-recommendation-create-progress-item-${recommendationId}`,
  );
};

/*
 * The status indicator is the row's first child — a tick, a cross, a spinner
 * or a hollow ring. Comparing its markup rather than a class name is what lets
 * "these four statuses look different from each other" be asserted as one
 * fact, instead of four assertions that could all be satisfied by the same
 * glyph.
 */
type GetStatusIndicatorMarkupFunction = (recommendationId: string) => string;

const getStatusIndicatorMarkup: GetStatusIndicatorMarkupFunction = (
  recommendationId: string,
): string => {
  const indicator: Element | null = getRow(recommendationId).firstElementChild;

  return indicator ? indicator.outerHTML : "";
};

type GetSummaryFunction = () => HTMLElement;

const getSummary: GetSummaryFunction = (): HTMLElement => {
  return screen.getByTestId("monitor-recommendation-create-progress-summary");
};

type GetRowNamesFunction = () => Array<string>;

const getRowNames: GetRowNamesFunction = (): Array<string> => {
  return screen.getAllByRole("listitem").map((row: HTMLElement): string => {
    return row.textContent || "";
  });
};

describe("MonitorRecommendationCreateProgress", () => {
  describe("the progress bar", () => {
    /*
     * The regression that matters most in this file. The bar is fed
     * created + failed, not created: a batch of four where one has already
     * failed and two have landed is three quarters done. A bar wired to
     * createdCount would read "2 of 4" here and, on a run where anything at
     * all failed, would never reach the end — leaving a finished operation
     * looking like a hung one.
     */
    test("counts failures as settled work, so a half-failed batch is not stuck short of the end", () => {
      renderPanel(
        makeProgress([
          makeItem({
            recommendationId: "one",
            name: "Node CPU",
            status: MonitorRecommendationCreateItemStatus.Created,
          }),
          makeItem({
            recommendationId: "two",
            name: "Node memory",
            status: MonitorRecommendationCreateItemStatus.Created,
          }),
          makeItem({
            recommendationId: "three",
            name: "Pod restarts",
            status: MonitorRecommendationCreateItemStatus.Failed,
            errorMessage: "Monitor limit reached on this plan.",
          }),
          makeItem({
            recommendationId: "four",
            name: "Disk pressure",
            status: MonitorRecommendationCreateItemStatus.Creating,
          }),
        ]),
      );

      expect(screen.getByTestId("progress-bar-count")).toHaveTextContent(
        "3 of 4 monitors",
      );
      expect(screen.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        "75",
      );

      // What the created-only reading would have been.
      expect(screen.getByTestId("progress-bar-count")).not.toHaveTextContent(
        "2 of 4 monitors",
      );
    });

    test("fills the bar completely once the last item has settled, even though one of them failed", () => {
      renderPanel(
        makeProgress([
          makeItem({
            recommendationId: "one",
            name: "Node CPU",
            status: MonitorRecommendationCreateItemStatus.Created,
          }),
          makeItem({
            recommendationId: "two",
            name: "Node memory",
            status: MonitorRecommendationCreateItemStatus.Created,
          }),
          makeItem({
            recommendationId: "three",
            name: "Pod restarts",
            status: MonitorRecommendationCreateItemStatus.Created,
          }),
          makeItem({
            recommendationId: "four",
            name: "Disk pressure",
            status: MonitorRecommendationCreateItemStatus.Failed,
            errorMessage: "Monitor limit reached on this plan.",
          }),
        ]),
      );

      expect(screen.getByTestId("progress-bar-count")).toHaveTextContent(
        "4 of 4 monitors",
      );
      expect(screen.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        "100",
      );
    });

    test("starts empty rather than skipping ahead, so the bar means what it says on the first frame", () => {
      renderPanel(
        makeProgress([
          makeItem({
            recommendationId: "one",
            name: "Node CPU",
            status: MonitorRecommendationCreateItemStatus.Pending,
          }),
          makeItem({
            recommendationId: "two",
            name: "Node memory",
            status: MonitorRecommendationCreateItemStatus.Pending,
          }),
        ]),
      );

      expect(screen.getByTestId("progress-bar-count")).toHaveTextContent(
        "0 of 2 monitors",
      );
      expect(screen.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        "0",
      );
    });
  });

  describe("the item list", () => {
    /*
     * The original complaint, in one assertion. Before this panel existed the
     * user saw nothing at all until the first create had come back from the
     * server — several seconds of a button that had visibly been pressed and
     * an interface that had visibly done nothing. Every planned monitor is
     * listed from the first render, Pending ones included.
     */
    test("lists every planned monitor the instant the batch starts, before a single one has been created", () => {
      const progress: MonitorRecommendationCreateProgress = makeProgress([
        makeItem({
          recommendationId: "one",
          name: "Node CPU is high",
          status: MonitorRecommendationCreateItemStatus.Pending,
        }),
        makeItem({
          recommendationId: "two",
          name: "Node memory is high",
          status: MonitorRecommendationCreateItemStatus.Pending,
        }),
        makeItem({
          recommendationId: "three",
          name: "Pods are restarting",
          status: MonitorRecommendationCreateItemStatus.Pending,
        }),
      ]);

      renderPanel(progress);

      expect(progress.createdCount).toBe(0);
      expect(screen.getAllByRole("listitem")).toHaveLength(3);

      expect(getRow("one")).toBeInTheDocument();
      expect(getRow("two")).toBeInTheDocument();
      expect(getRow("three")).toBeInTheDocument();

      expect(screen.getByText("Node CPU is high")).toBeInTheDocument();
      expect(screen.getByText("Node memory is high")).toBeInTheDocument();
      expect(screen.getByText("Pods are restarting")).toBeInTheDocument();
    });

    /*
     * The list is the user's map of a sequential run: the row that is spinning
     * has to stay where they last looked, and the rows above it have to be the
     * ones already dealt with. Re-ordering by status would move the whole list
     * under them on every emission.
     */
    test("keeps the plan's order as items move through their statuses", () => {
      renderPanel(
        makeProgress([
          makeItem({
            recommendationId: "one",
            name: "Node CPU is high",
            status: MonitorRecommendationCreateItemStatus.Created,
          }),
          makeItem({
            recommendationId: "two",
            name: "Node memory is high",
            status: MonitorRecommendationCreateItemStatus.Creating,
          }),
          makeItem({
            recommendationId: "three",
            name: "Pods are restarting",
            status: MonitorRecommendationCreateItemStatus.Pending,
          }),
        ]),
      );

      expect(getRowNames()).toEqual([
        "Node CPU is high",
        "Node memory is high",
        "Pods are restarting",
      ]);
    });
  });

  describe("the status of one row", () => {
    type RenderOneOfEachStatusFunction = () => void;

    const renderOneOfEachStatus: RenderOneOfEachStatusFunction = (): void => {
      renderPanel(
        makeProgress([
          makeItem({
            recommendationId: "created",
            name: "Node CPU is high",
            status: MonitorRecommendationCreateItemStatus.Created,
          }),
          makeItem({
            recommendationId: "creating",
            name: "Node memory is high",
            status: MonitorRecommendationCreateItemStatus.Creating,
          }),
          makeItem({
            recommendationId: "failed",
            name: "Pods are restarting",
            status: MonitorRecommendationCreateItemStatus.Failed,
            errorMessage: "Monitor limit reached on this plan.",
          }),
          makeItem({
            recommendationId: "pending",
            name: "Disk is filling up",
            status: MonitorRecommendationCreateItemStatus.Pending,
          }),
        ]),
      );
    };

    /*
     * Four statuses, four different-looking rows. Asserted as one set rather
     * than four class checks because the failure worth catching is two
     * statuses collapsing onto the same glyph — a Pending row that renders the
     * same tick as a Created one reads as eighteen finished monitors half a
     * minute before any of them exist.
     */
    test("gives each of the four statuses its own indicator", () => {
      renderOneOfEachStatus();

      const markups: Array<string> = [
        getStatusIndicatorMarkup("created"),
        getStatusIndicatorMarkup("creating"),
        getStatusIndicatorMarkup("failed"),
        getStatusIndicatorMarkup("pending"),
      ];

      for (const markup of markups) {
        expect(markup).not.toBe("");
      }

      expect(new Set<string>(markups).size).toBe(4);
    });

    test("marks a created row in green and a failed one in red, the two colours a user scans for", () => {
      renderOneOfEachStatus();

      expect(getStatusIndicatorMarkup("created")).toContain("text-green-500");
      expect(getStatusIndicatorMarkup("failed")).toContain("text-red-500");
    });

    test("spins the row that is actually in flight, so 'still working' points at one monitor", () => {
      renderOneOfEachStatus();

      expect(getStatusIndicatorMarkup("creating")).toContain("animate-spin");
      expect(getStatusIndicatorMarkup("created")).not.toContain("animate-spin");
      expect(getStatusIndicatorMarkup("pending")).not.toContain("animate-spin");
    });

    /*
     * A hollow ring, not a greyed tick: any tick shape at a glance down a list
     * of ticks reads as done, whatever colour it is drawn in.
     */
    test("draws a queued row as an empty ring rather than a tick in another colour", () => {
      renderOneOfEachStatus();

      const pendingMarkup: string = getStatusIndicatorMarkup("pending");

      expect(pendingMarkup).toContain("rounded-full");
      expect(pendingMarkup).not.toContain("<svg");
    });

    test("dims the name of a queued row and not of one that has landed", () => {
      renderOneOfEachStatus();

      expect(
        within(getRow("pending")).getByText("Disk is filling up"),
      ).toHaveClass("text-gray-400");
      expect(
        within(getRow("created")).getByText("Node CPU is high"),
      ).not.toHaveClass("text-gray-400");
    });

    /*
     * The run no longer aborts on the first rejection, so a batch can finish
     * with three of eighteen missing. This row is the only place the app ever
     * says which three and why — nothing is persisted, and the list reloads
     * behind the panel showing only what did get created.
     */
    test("a failed row carries its error message, which exists nowhere else", () => {
      renderOneOfEachStatus();

      expect(
        within(getRow("failed")).getByText(
          "Monitor limit reached on this plan.",
        ),
      ).toBeInTheDocument();
    });

    test("does not attach that error to the rows that did not fail", () => {
      renderOneOfEachStatus();

      expect(getRow("created")).not.toHaveTextContent(
        "Monitor limit reached on this plan.",
      );
      expect(getRow("pending")).not.toHaveTextContent(
        "Monitor limit reached on this plan.",
      );
    });

    test("reports each failure separately when several of them failed differently", () => {
      renderPanel(
        makeProgress([
          makeItem({
            recommendationId: "one",
            name: "Node CPU is high",
            status: MonitorRecommendationCreateItemStatus.Failed,
            errorMessage: "Monitor limit reached on this plan.",
          }),
          makeItem({
            recommendationId: "two",
            name: "Node memory is high",
            status: MonitorRecommendationCreateItemStatus.Failed,
            errorMessage: "A monitor with this name already exists.",
          }),
        ]),
      );

      expect(getRow("one")).toHaveTextContent(
        "Monitor limit reached on this plan.",
      );
      expect(getRow("two")).toHaveTextContent(
        "A monitor with this name already exists.",
      );
    });
  });

  describe("the summary line", () => {
    /*
     * The sentence itself lives on the runner, because "which of these numbers
     * is the headline" is a decision rather than a formatting detail. What the
     * panel owes is to render THAT sentence — a panel that rolled its own
     * would drift from it the first time either changed.
     */
    test("renders the runner's sentence while the batch is still running", () => {
      const progress: MonitorRecommendationCreateProgress = makeProgress([
        makeItem({
          recommendationId: "one",
          name: "Node CPU is high",
          status: MonitorRecommendationCreateItemStatus.Created,
        }),
        makeItem({
          recommendationId: "two",
          name: "Node memory is high",
          status: MonitorRecommendationCreateItemStatus.Creating,
        }),
      ]);

      renderPanel(progress);

      expect(progress.isComplete).toBe(false);
      expect(getSummary()).toHaveTextContent(
        MonitorRecommendationCreateRunner.getSummaryText(progress),
      );
    });

    test("renders the runner's sentence once the batch has finished with failures", () => {
      const progress: MonitorRecommendationCreateProgress = makeProgress([
        makeItem({
          recommendationId: "one",
          name: "Node CPU is high",
          status: MonitorRecommendationCreateItemStatus.Created,
        }),
        makeItem({
          recommendationId: "two",
          name: "Node memory is high",
          status: MonitorRecommendationCreateItemStatus.Created,
        }),
        makeItem({
          recommendationId: "three",
          name: "Pods are restarting",
          status: MonitorRecommendationCreateItemStatus.Failed,
          errorMessage: "Monitor limit reached on this plan.",
        }),
        makeItem({
          recommendationId: "four",
          name: "Disk is filling up",
          status: MonitorRecommendationCreateItemStatus.Failed,
          errorMessage: "A monitor with this name already exists.",
        }),
      ]);

      renderPanel(progress);

      expect(progress.isComplete).toBe(true);
      expect(getSummary()).toHaveTextContent(
        MonitorRecommendationCreateRunner.getSummaryText(progress),
      );

      /*
       * Pinned separately from the delegation above: the count of failures is
       * the one number a user has to be told, and a summary that rendered the
       * right function but the wrong progress would still satisfy the
       * equality check.
       */
      expect(getSummary()).toHaveTextContent("2 failed");
    });

    /*
     * Red is reserved for a finished run that lost something. Colouring the
     * in-progress sentence red would alarm the user in the middle of a run
     * that is going perfectly well; leaving the failed one grey would let a
     * partial failure slide past unnoticed, which is the whole reason the run
     * is allowed to continue past a failure at all.
     */
    test("styles a finished-with-failures summary as an error", () => {
      renderPanel(
        makeProgress([
          makeItem({
            recommendationId: "one",
            name: "Node CPU is high",
            status: MonitorRecommendationCreateItemStatus.Created,
          }),
          makeItem({
            recommendationId: "two",
            name: "Node memory is high",
            status: MonitorRecommendationCreateItemStatus.Failed,
            errorMessage: "Monitor limit reached on this plan.",
          }),
        ]),
      );

      expect(getSummary()).toHaveClass("text-red-700");
    });

    test("does not style the in-progress summary as an error", () => {
      renderPanel(
        makeProgress([
          makeItem({
            recommendationId: "one",
            name: "Node CPU is high",
            status: MonitorRecommendationCreateItemStatus.Failed,
            errorMessage: "Monitor limit reached on this plan.",
          }),
          makeItem({
            recommendationId: "two",
            name: "Node memory is high",
            status: MonitorRecommendationCreateItemStatus.Creating,
          }),
        ]),
      );

      expect(getSummary()).not.toHaveClass("text-red-700");
      expect(getSummary()).toHaveClass("text-gray-600");
    });

    test("does not style a clean finished run as an error", () => {
      renderPanel(
        makeProgress([
          makeItem({
            recommendationId: "one",
            name: "Node CPU is high",
            status: MonitorRecommendationCreateItemStatus.Created,
          }),
          makeItem({
            recommendationId: "two",
            name: "Node memory is high",
            status: MonitorRecommendationCreateItemStatus.Created,
          }),
        ]),
      );

      expect(getSummary()).not.toHaveClass("text-red-700");
    });
  });

  describe("assistive technology", () => {
    /*
     * The entire content of this panel is a thing that changes on its own
     * while the user does nothing, which is exactly what a live region is
     * for. Without it a screen-reader user presses Create and is told nothing
     * further until they go hunting for the panel — and the one announcement
     * that matters, that two of the eighteen failed, is the one they would
     * never hear.
     */
    test("announces itself as a live region, because it changes without the user acting", () => {
      renderPanel(
        makeProgress([
          makeItem({
            recommendationId: "one",
            name: "Node CPU is high",
            status: MonitorRecommendationCreateItemStatus.Creating,
          }),
        ]),
      );

      const panel: HTMLElement = screen.getByTestId(
        "monitor-recommendation-create-progress",
      );

      expect(panel).toHaveAttribute("role", "status");
      expect(panel).toHaveAttribute("aria-live", "polite");
      expect(panel).toContainElement(getSummary());
    });
  });

  describe("an empty batch", () => {
    /*
     * Reachable in ordinary use: every selected recommendation can be filtered
     * out of the plan before the run starts (a teammate dismissed them, or the
     * monitors already exist), and `getInitialProgress([])` is then handed
     * straight to this panel. The division behind the bar's percentage has a
     * zero denominator here, so the guard being asserted is simply that the
     * panel still renders instead of taking the whole side panel down with it.
     */
    test("renders a zero-item batch instead of crashing on the empty denominator", () => {
      const progress: MonitorRecommendationCreateProgress = makeProgress([]);

      expect(() => {
        renderPanel(progress);
      }).not.toThrow();

      expect(
        screen.getByTestId("monitor-recommendation-create-progress"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("progress-bar-count")).toHaveTextContent(
        "0 of 0 monitors",
      );
      expect(screen.queryAllByRole("listitem")).toHaveLength(0);
      expect(getSummary()).toHaveTextContent(
        MonitorRecommendationCreateRunner.getSummaryText(progress),
      );
    });
  });
});
