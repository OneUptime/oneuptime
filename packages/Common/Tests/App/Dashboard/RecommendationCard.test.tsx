import "@testing-library/jest-dom";
import {
  RenderResult,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import RecommendationCard, {
  DESCRIPTION_CLAMP_CHARACTER_COUNT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationCard";
import {
  RecommendationStatus,
  RecommendationViewModel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationViewModel";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
  MonitorRecommendationSeverity,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import RecommendationType from "../../../Types/Recommendation/RecommendationType";
import Route from "../../../Types/API/Route";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * One recommendation, in whichever of its three states it is in. The
 * recommendations page renders up to eighteen of these at once, so every
 * affordance on the card is repeated eighteen times and every mistake is too.
 *
 * These assertions are the ergonomics of that card, and each one stands in for
 * something a user could not do before:
 *
 *   - only the 16px checkbox was clickable, while the title and the paragraph
 *     beside it looked clickable and were not;
 *   - that checkbox was then a second tab stop and a second announcement for
 *     one action;
 *   - cards in a grid row share a height, so the single longest description in
 *     a category set the height of every short card beside it;
 *   - severity was carried by colour alone.
 *
 * The three states are the same object at different points in its life, so
 * most of what follows is asserted against all three: what changes between
 * them is which affordance the card offers, and offering the wrong one (a
 * dismiss on a created card, a select while a batch is mid-flight) is how a
 * user acts on something that is not there.
 */

const RECOMMENDATION_ID: string = "Kubernetes:k8s-node-not-ready";
const RECOMMENDATION_NAME: string = "Node Not Ready";
const SHORT_DESCRIPTION: string =
  "Alert when a Kubernetes node stops reporting Ready.";
const DISMISSAL_REASON: string =
  "We already page on the cloud provider's own node health check.";

const MONITOR_ROUTE: Route = new Route(
  "/dashboard/6019bf0b1e0a2c1b5c8b4567/monitors/6019bf0b1e0a2c1b5c8b0001",
);

/*
 * Descriptions built from the exported constant rather than hand-counted, so
 * that changing the clamp threshold moves both fixtures with it instead of
 * quietly turning the boundary cases into two long descriptions.
 */
type BuildDescriptionOfLengthFunction = (length: number) => string;

const buildDescriptionOfLength: BuildDescriptionOfLengthFunction = (
  length: number,
): string => {
  const filler: string = "the cgroup CFS quota throttles the container, ";
  const text: string = `Fires when ${filler.repeat(10)}`;

  return `${text.slice(0, length - 1)}.`;
};

const AT_CLAMP_LIMIT_DESCRIPTION: string = buildDescriptionOfLength(
  DESCRIPTION_CLAMP_CHARACTER_COUNT,
);

const OVER_CLAMP_LIMIT_DESCRIPTION: string = buildDescriptionOfLength(
  DESCRIPTION_CLAMP_CHARACTER_COUNT + 1,
);

const onSelectChange: MockFunction = getJestMockFunction();
const onDismiss: MockFunction = getJestMockFunction();
const onRestore: MockFunction = getJestMockFunction();

interface ViewModelOptions {
  status: RecommendationStatus;
  name?: string | undefined;
  description?: string | undefined;
  severity?: MonitorRecommendationSeverity | undefined;
  dismissalReason?: string | undefined;
}

type BuildViewModelFunction = (
  options: ViewModelOptions,
) => RecommendationViewModel;

const buildViewModel: BuildViewModelFunction = (
  options: ViewModelOptions,
): RecommendationViewModel => {
  const recommendation: MonitorRecommendation = {
    recommendationId: RECOMMENDATION_ID,
    recommendationType: RecommendationType.Monitor,
    resourceType: MonitorRecommendationResourceType.Kubernetes,
    monitorType: MonitorType.Kubernetes,
    templateId: "k8s-node-not-ready",
    name: options.name || RECOMMENDATION_NAME,
    description: options.description || SHORT_DESCRIPTION,
    category: "Cluster Health",
    severity: options.severity || "Critical",
    /*
     * The card must never build a monitor step: that happens in the create
     * side-over, after the user has picked severities and on-call policies.
     * Throwing turns "the card called it while merely rendering" into a
     * failure here rather than into a wasted object nobody sees.
     */
    getMonitorStep: (): MonitorStep => {
      throw new Error("RecommendationCard must not build a monitor step.");
    },
  };

  return {
    recommendation: recommendation,
    status: options.status,
    dismissalReason: options.dismissalReason,
  };
};

interface CardOptions {
  viewModel: RecommendationViewModel;
  isSelected?: boolean | undefined;
  isDisabled?: boolean | undefined;
  monitorRoute?: Route | undefined;
}

type RenderCardFunction = (options: CardOptions) => RenderResult;

const renderCard: RenderCardFunction = (options: CardOptions): RenderResult => {
  return render(
    <RecommendationCard
      viewModel={options.viewModel}
      isSelected={options.isSelected === true}
      isDisabled={options.isDisabled}
      monitorRoute={options.monitorRoute}
      onSelectChange={onSelectChange}
      onDismiss={onDismiss}
      onRestore={onRestore}
    />,
  );
};

type QueryElementFunction = () => HTMLElement | null;

/*
 * The page keeps its selection state keyed on recommendationId and addresses
 * the card through this test id, so the id has to stay in it.
 */
const querySelectButton: QueryElementFunction = (): HTMLElement | null => {
  return screen.queryByTestId(
    `recommendation-card-select-${RECOMMENDATION_ID}`,
  );
};

const queryDismissButton: QueryElementFunction = (): HTMLElement | null => {
  return screen.queryByRole("button", {
    name: `Dismiss ${RECOMMENDATION_NAME}`,
  });
};

const queryRestoreButton: QueryElementFunction = (): HTMLElement | null => {
  return screen.queryByRole("button", { name: "Restore" });
};

const queryDescriptionToggle: QueryElementFunction = (): HTMLElement | null => {
  return screen.queryByTestId(
    `recommendation-description-toggle-${RECOMMENDATION_ID}`,
  );
};

type GetElementFunction = () => HTMLElement;

const getSelectButton: GetElementFunction = (): HTMLElement => {
  return screen.getByRole("button", { name: `Select ${RECOMMENDATION_NAME}` });
};

const getDescription: GetElementFunction = (): HTMLElement => {
  return screen.getByTestId(`recommendation-description-${RECOMMENDATION_ID}`);
};

type IsDescriptionClampedFunction = () => boolean;

const isDescriptionClamped: IsDescriptionClampedFunction = (): boolean => {
  return getDescription().className.includes("line-clamp-3");
};

type GetCheckboxInputFunction = (container: HTMLElement) => HTMLInputElement;

const getCheckboxInput: GetCheckboxInputFunction = (
  container: HTMLElement,
): HTMLInputElement => {
  const input: HTMLInputElement | null =
    container.querySelector<HTMLInputElement>('input[type="checkbox"]');

  if (!input) {
    throw new Error("The card rendered no checkbox.");
  }

  return input;
};

/*
 * The 2px severity edge. It is decorative — aria-hidden — which is precisely
 * why the severity has to be readable somewhere else too.
 */
type GetSeverityRailClassFunction = (container: HTMLElement) => string;

const getSeverityRailClass: GetSeverityRailClassFunction = (
  container: HTMLElement,
): string => {
  const rail: Element | null = container.querySelector(
    'div[aria-hidden="true"][class*="inset-y-0"]',
  );

  if (!rail) {
    throw new Error("The card rendered no severity rail.");
  }

  return rail.className;
};

describe("RecommendationCard", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("the three states", () => {
    test("an available recommendation offers the select control and neither badge", () => {
      renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Available }),
      });

      expect(getSelectButton()).toBeInTheDocument();
      expect(screen.getByText(RECOMMENDATION_NAME)).toBeInTheDocument();
      expect(screen.queryByText("Created")).not.toBeInTheDocument();
      expect(screen.queryByText("Dismissed")).not.toBeInTheDocument();
    });

    /*
     * "Created" is the only thing separating a recommendation you still have
     * to act on from one whose monitor is already running. Without it the
     * page invites the user to create a second copy of a monitor they have.
     */
    test("a created recommendation is badged Created and cannot be selected", () => {
      renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Created }),
      });

      expect(screen.getByText("Created")).toBeInTheDocument();
      expect(querySelectButton()).not.toBeInTheDocument();
    });

    /*
     * The payoff for a created card: the monitor exists, so the card's job is
     * to get the user to it. A created card with nowhere to go is a dead end.
     */
    test("a created recommendation links to the monitor it produced", () => {
      renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Created }),
        monitorRoute: MONITOR_ROUTE,
      });

      const link: HTMLElement = screen.getByRole("link", {
        name: "View monitor",
      });

      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", MONITOR_ROUTE.toString());
    });

    /*
     * The monitor id is resolved by a lookup that can come back empty. A link
     * rendered anyway would point at /monitors/undefined.
     */
    test("a created recommendation with no route renders no link", () => {
      renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Created }),
      });

      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.queryByText("View monitor")).not.toBeInTheDocument();
    });

    test("a dismissed recommendation is badged Dismissed and shows its reason", () => {
      renderCard({
        viewModel: buildViewModel({
          status: RecommendationStatus.Dismissed,
          dismissalReason: DISMISSAL_REASON,
        }),
      });

      expect(screen.getByText("Dismissed")).toBeInTheDocument();
      expect(screen.getByText(DISMISSAL_REASON)).toBeInTheDocument();
    });

    /*
     * The reason is what stops the next person re-litigating a decision the
     * team already made, but it is optional on the dismissal row. When it is
     * absent the card must render nothing rather than an empty quote box —
     * a bordered, italic, empty strip reads as a rendering failure.
     */
    test("a dismissed recommendation with no reason renders no empty reason box", () => {
      const { container }: RenderResult = renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Dismissed }),
      });

      expect(screen.getByText("Dismissed")).toBeInTheDocument();
      expect(container.querySelectorAll("p")).toHaveLength(1);
      expect(screen.getByText(SHORT_DESCRIPTION)).toBeInTheDocument();
    });

    test("a dismissed recommendation can be restored", () => {
      renderCard({
        viewModel: buildViewModel({
          status: RecommendationStatus.Dismissed,
          dismissalReason: DISMISSAL_REASON,
        }),
      });

      const restoreButton: HTMLElement | null = queryRestoreButton();

      expect(restoreButton).toBeInTheDocument();

      fireEvent.click(restoreButton as HTMLElement);

      expect(onRestore).toHaveBeenCalledTimes(1);
    });

    test("available and created recommendations have nothing to restore", () => {
      renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Available }),
      });

      expect(queryRestoreButton()).not.toBeInTheDocument();

      renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Created }),
      });

      expect(queryRestoreButton()).not.toBeInTheDocument();
    });
  });

  /*
   * The whole card is the hit target, not the 16px box in its corner. This is
   * the fix for the complaint that started this work: the title and the
   * description look like part of the control and were not, so a click that
   * landed a few pixels off did nothing at all and gave no feedback.
   */
  describe("whole-card selection", () => {
    test("the hit target is a real button that names the recommendation", () => {
      renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Available }),
      });

      const selectButton: HTMLElement = getSelectButton();

      /*
       * A div with an onClick would satisfy a click test and still be
       * unreachable by keyboard, so the element type is the assertion.
       */
      expect(selectButton.tagName).toBe("BUTTON");
      expect(selectButton).toBe(querySelectButton());
    });

    test("aria-pressed reports the unselected state", () => {
      renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Available }),
        isSelected: false,
      });

      expect(getSelectButton()).toHaveAttribute("aria-pressed", "false");
    });

    /*
     * Selection drives a batch create of everything ticked, so a card whose
     * pressed state does not match the page's selection set is a monitor the
     * user did not ask for or one they did and will not get.
     */
    test("aria-pressed reports the selected state", () => {
      renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Available }),
        isSelected: true,
      });

      expect(getSelectButton()).toHaveAttribute("aria-pressed", "true");
    });

    test("clicking an unselected card asks to select it", () => {
      renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Available }),
        isSelected: false,
      });

      fireEvent.click(getSelectButton());

      expect(onSelectChange).toHaveBeenCalledTimes(1);
      expect(onSelectChange).toHaveBeenCalledWith(true);
    });

    /*
     * The other direction, because a card that only ever reports `true` looks
     * correct until someone tries to take one recommendation back out of a
     * selection of eighteen.
     */
    test("clicking a selected card asks to deselect it", () => {
      renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Available }),
        isSelected: true,
      });

      fireEvent.click(getSelectButton());

      expect(onSelectChange).toHaveBeenCalledTimes(1);
      expect(onSelectChange).toHaveBeenCalledWith(false);
    });

    test("a dismissed card offers no selection", () => {
      renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Dismissed }),
      });

      expect(querySelectButton()).not.toBeInTheDocument();
    });
  });

  /*
   * Two controls for one action is two tab stops and two announcements. The
   * visible box stays because it is what makes the card legible as selectable
   * at a glance, but assistive technology must see only the card button.
   */
  describe("the visible checkbox is presentational", () => {
    test("it is not announced as a second control", () => {
      renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Available }),
      });

      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(
        screen.getAllByRole("button", {
          name: `Select ${RECOMMENDATION_NAME}`,
        }),
      ).toHaveLength(1);
    });

    test("it is not a second tab stop", () => {
      const { container }: RenderResult = renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Available }),
      });

      expect(getCheckboxInput(container).tabIndex).toBe(-1);
    });

    /*
     * Presentational, not decorative: it is the only thing on the card that
     * shows the selection at a glance, so it still has to be ticked.
     */
    test("it still shows an unselected card as unticked", () => {
      const { container }: RenderResult = renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Available }),
        isSelected: false,
      });

      expect(getCheckboxInput(container).checked).toBe(false);
    });

    test("it still shows a selected card as ticked", () => {
      const { container }: RenderResult = renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Available }),
        isSelected: true,
      });

      expect(getCheckboxInput(container).checked).toBe(true);
    });
  });

  /*
   * isDisabled means a create batch is in flight. The selection it is working
   * from was fixed when it started, so anything that would change that
   * selection — or dismiss a recommendation out from under it — has to be
   * gone, not merely styled as unavailable.
   */
  describe("while a batch is running", () => {
    test("an available card offers neither selection nor dismissal", () => {
      renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Available }),
        isDisabled: true,
      });

      expect(querySelectButton()).not.toBeInTheDocument();
      expect(queryDismissButton()).not.toBeInTheDocument();
    });

    test("the checkbox on a disabled card cannot be ticked", () => {
      const { container }: RenderResult = renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Available }),
        isDisabled: true,
      });

      expect(getCheckboxInput(container).disabled).toBe(true);
    });

    test("a dismissed card offers no restore", () => {
      renderCard({
        viewModel: buildViewModel({
          status: RecommendationStatus.Dismissed,
          dismissalReason: DISMISSAL_REASON,
        }),
        isDisabled: true,
      });

      expect(queryRestoreButton()).not.toBeInTheDocument();
    });

    /*
     * Navigation is not a mutation. Hiding the link to a monitor that already
     * exists because some other monitor is being created would be a
     * disabled state that punishes the user for the page's own work.
     */
    test("a created card still links to its monitor", () => {
      renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Created }),
        monitorRoute: MONITOR_ROUTE,
        isDisabled: true,
      });

      expect(
        screen.getByRole("link", { name: "View monitor" }),
      ).toBeInTheDocument();
    });
  });

  /*
   * Dismiss is per-card and permanent enough to need naming: eighteen cards
   * means eighteen close buttons, and "Dismiss" alone tells a screen reader
   * user nothing about which of the eighteen they are on.
   */
  describe("dismissal", () => {
    test("an available card can be dismissed by name", () => {
      renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Available }),
      });

      const dismissButton: HTMLElement | null = queryDismissButton();

      expect(dismissButton).toBeInTheDocument();

      fireEvent.click(dismissButton as HTMLElement);

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    /*
     * The dismiss control sits inside a card whose whole surface selects. If
     * it ever ends up nested inside that button, dismissing would also tick
     * the card and queue it for creation — the exact opposite of the intent.
     */
    test("dismissing does not also select the card", () => {
      renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Available }),
      });

      fireEvent.click(queryDismissButton() as HTMLElement);

      expect(onSelectChange).not.toHaveBeenCalled();
    });

    test("a created card cannot be dismissed", () => {
      renderCard({
        viewModel: buildViewModel({ status: RecommendationStatus.Created }),
      });

      expect(queryDismissButton()).not.toBeInTheDocument();
    });

    test("an already dismissed card cannot be dismissed again", () => {
      renderCard({
        viewModel: buildViewModel({
          status: RecommendationStatus.Dismissed,
          dismissalReason: DISMISSAL_REASON,
        }),
      });

      expect(queryDismissButton()).not.toBeInTheDocument();
    });
  });

  /*
   * Cards in a grid row share a height. Before the clamp, one four-line
   * explanation of CFS quota accounting set the height of every card beside
   * it, leaving a hand's width of white space next to "Alert when Kubernetes
   * jobs fail."
   */
  describe("description clamping", () => {
    /*
     * The two fixtures are meant to sit either side of the threshold, one
     * character apart. If the helper ever drifts, the tests below would still
     * pass while testing two long descriptions.
     */
    test("the fixtures straddle the clamp threshold by one character", () => {
      expect(AT_CLAMP_LIMIT_DESCRIPTION).toHaveLength(
        DESCRIPTION_CLAMP_CHARACTER_COUNT,
      );
      expect(OVER_CLAMP_LIMIT_DESCRIPTION).toHaveLength(
        DESCRIPTION_CLAMP_CHARACTER_COUNT + 1,
      );
    });

    /*
     * A description exactly at the threshold fits, so a Show more beside it
     * would be a control that reveals nothing.
     */
    test("a description at the threshold is neither clamped nor toggleable", () => {
      renderCard({
        viewModel: buildViewModel({
          status: RecommendationStatus.Available,
          description: AT_CLAMP_LIMIT_DESCRIPTION,
        }),
      });

      expect(queryDescriptionToggle()).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Show more" }),
      ).not.toBeInTheDocument();
      expect(isDescriptionClamped()).toBe(false);
      expect(getDescription()).toHaveTextContent(AT_CLAMP_LIMIT_DESCRIPTION);
    });

    test("a longer description is clamped and offers Show more", () => {
      renderCard({
        viewModel: buildViewModel({
          status: RecommendationStatus.Available,
          description: OVER_CLAMP_LIMIT_DESCRIPTION,
        }),
      });

      const toggle: HTMLElement = screen.getByRole("button", {
        name: "Show more",
      });

      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(isDescriptionClamped()).toBe(true);
    });

    /*
     * The clamp is three lines of CSS and nothing else. Every character stays
     * in the DOM in both states, so a screen reader — which does not see the
     * clamp at all — reads the whole description either way. A test that
     * proved truncation by asserting the tail was absent would be asserting
     * that content is hidden from assistive technology.
     */
    test("the whole description is in the DOM while clamped", () => {
      renderCard({
        viewModel: buildViewModel({
          status: RecommendationStatus.Available,
          description: OVER_CLAMP_LIMIT_DESCRIPTION,
        }),
      });

      expect(getDescription().textContent).toBe(OVER_CLAMP_LIMIT_DESCRIPTION);
      expect(
        screen.getByText(OVER_CLAMP_LIMIT_DESCRIPTION),
      ).toBeInTheDocument();
    });

    test("Show more unclamps the description and becomes Show less", () => {
      renderCard({
        viewModel: buildViewModel({
          status: RecommendationStatus.Available,
          description: OVER_CLAMP_LIMIT_DESCRIPTION,
        }),
      });

      fireEvent.click(screen.getByRole("button", { name: "Show more" }));

      const toggle: HTMLElement = screen.getByRole("button", {
        name: "Show less",
      });

      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(isDescriptionClamped()).toBe(false);
      expect(getDescription().textContent).toBe(OVER_CLAMP_LIMIT_DESCRIPTION);
    });

    /*
     * Expanding is reversible, because a user who expands three cards to read
     * them has no other way to get the row heights back.
     */
    test("Show less clamps it again", () => {
      renderCard({
        viewModel: buildViewModel({
          status: RecommendationStatus.Available,
          description: OVER_CLAMP_LIMIT_DESCRIPTION,
        }),
      });

      fireEvent.click(screen.getByRole("button", { name: "Show more" }));
      fireEvent.click(screen.getByRole("button", { name: "Show less" }));

      expect(screen.getByRole("button", { name: "Show more" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(isDescriptionClamped()).toBe(true);
      expect(getDescription().textContent).toBe(OVER_CLAMP_LIMIT_DESCRIPTION);
    });

    /*
     * Reading is not choosing. The toggle sits on top of a card whose whole
     * surface selects, so if it ever ends up inside that button, expanding a
     * description would queue a monitor for creation.
     */
    test("expanding a description does not select the card", () => {
      renderCard({
        viewModel: buildViewModel({
          status: RecommendationStatus.Available,
          description: OVER_CLAMP_LIMIT_DESCRIPTION,
        }),
      });

      fireEvent.click(screen.getByRole("button", { name: "Show more" }));

      expect(onSelectChange).not.toHaveBeenCalled();
    });
  });

  /*
   * Severity is the one attribute you scan a list of eighteen for, so it is
   * carried twice: a coloured edge for peripheral vision and a badge for
   * everyone else. Colour alone is not an accessible signal (WCAG 1.4.1), and
   * the edge is aria-hidden, so the badge is the only reading of severity a
   * screen reader or a red-green colourblind user gets.
   */
  describe("severity", () => {
    test("a critical recommendation has a red rail and says Critical", () => {
      const { container }: RenderResult = renderCard({
        viewModel: buildViewModel({
          status: RecommendationStatus.Available,
          severity: "Critical",
        }),
      });

      expect(getSeverityRailClass(container)).toContain("bg-red-400");
      expect(screen.getByText("Critical")).toBeInTheDocument();
    });

    test("a warning recommendation has an amber rail and says Warning", () => {
      const { container }: RenderResult = renderCard({
        viewModel: buildViewModel({
          status: RecommendationStatus.Available,
          severity: "Warning",
        }),
      });

      expect(getSeverityRailClass(container)).toContain("bg-amber-400");
      expect(screen.getByText("Warning")).toBeInTheDocument();
    });

    /*
     * The rail only earns its place if the two severities actually differ at
     * a glance — one shared accent would be decoration, not information.
     */
    test("the two severities do not share a rail colour", () => {
      const critical: RenderResult = renderCard({
        viewModel: buildViewModel({
          status: RecommendationStatus.Available,
          severity: "Critical",
        }),
      });

      const warning: RenderResult = renderCard({
        viewModel: buildViewModel({
          status: RecommendationStatus.Available,
          severity: "Warning",
        }),
      });

      expect(getSeverityRailClass(critical.container)).not.toBe(
        getSeverityRailClass(warning.container),
      );
    });
  });
});
