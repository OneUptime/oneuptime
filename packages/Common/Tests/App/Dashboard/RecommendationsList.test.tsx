import "@testing-library/jest-dom";
import { beforeEach, describe, expect, test } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import RecommendationsList from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationsList";
import {
  RecommendationCategoryGroup,
  RecommendationStatus,
  RecommendationViewModel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationViewModel";
import Route from "../../../Types/API/Route";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
  MonitorRecommendationSeverity,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../Types/ObjectID";
import RecommendationType from "../../../Types/Recommendation/RecommendationType";

/*
 * The body of the recommendations page: category sections of cards, and the
 * selection maths that feeds the bulk-create button.
 *
 * Selection is the part worth guarding. It is one Set held by the page, and
 * every control here rebuilds it: a card's own toggle, and a per-category
 * "Select all". Rebuilding it wrong is invisible on screen right up until the
 * moment it matters — a select-all that REPLACES the Set instead of adding to
 * it silently drops the category the user ticked a second ago, and they find
 * out by counting the monitors that got created. A select-all that sweeps in
 * created or dismissed recommendations is worse: those are filtered back out
 * before the POST, so the button offers to create seven things and creates
 * four, with nothing saying why.
 *
 * The heading counts are the other half. They are what a person uses to decide
 * whether a section is worth opening at all, so a section that has work left
 * must never read as finished.
 */

const MONITOR_ID: ObjectID = ObjectID.generate();
const STORAGE_MONITOR_ID: ObjectID = ObjectID.generate();

type BuildRecommendationFunction = (data: {
  templateId: string;
  name: string;
  category: string;
  severity: MonitorRecommendationSeverity;
}) => MonitorRecommendation;

const buildRecommendation: BuildRecommendationFunction = (data: {
  templateId: string;
  name: string;
  category: string;
  severity: MonitorRecommendationSeverity;
}): MonitorRecommendation => {
  return {
    recommendationId: `Kubernetes:${data.templateId}`,
    recommendationType: RecommendationType.Monitor,
    resourceType: MonitorRecommendationResourceType.Kubernetes,
    monitorType: MonitorType.Kubernetes,
    templateId: data.templateId,
    name: data.name,
    /*
     * Deliberately short. RecommendationCard clamps anything past 170
     * characters behind a "Show more", and an extra button per card would be
     * noise in every query here.
     */
    description: `Watch for ${data.name.toLowerCase()}.`,
    category: data.category,
    severity: data.severity,
    getMonitorStep: () => {
      return new MonitorStep();
    },
  };
};

const API_SERVER_DOWN: RecommendationViewModel = {
  recommendation: buildRecommendation({
    templateId: "k8s-api-server-down",
    name: "API Server Down",
    category: "Control Plane",
    severity: "Critical",
  }),
  status: RecommendationStatus.Available,
};

const ETCD_NO_LEADER: RecommendationViewModel = {
  recommendation: buildRecommendation({
    templateId: "k8s-etcd-no-leader",
    name: "Etcd Has No Leader",
    category: "Control Plane",
    severity: "Critical",
  }),
  status: RecommendationStatus.Available,
};

const NODE_NOT_READY: RecommendationViewModel = {
  recommendation: buildRecommendation({
    templateId: "k8s-node-not-ready",
    name: "Node Not Ready",
    category: "Control Plane",
    severity: "Critical",
  }),
  status: RecommendationStatus.Created,
  monitorId: MONITOR_ID,
};

const POD_CRASH_LOOPING: RecommendationViewModel = {
  recommendation: buildRecommendation({
    templateId: "k8s-pod-crash-loop",
    name: "Pod Crash Looping",
    category: "Workload",
    severity: "Critical",
  }),
  status: RecommendationStatus.Available,
};

const JOB_FAILED: RecommendationViewModel = {
  recommendation: buildRecommendation({
    templateId: "k8s-job-failed",
    name: "Job Failed",
    category: "Workload",
    severity: "Warning",
  }),
  status: RecommendationStatus.Dismissed,
  dismissalId: ObjectID.generate(),
  dismissalReason: "We run these jobs by hand.",
};

const VOLUME_ALMOST_FULL: RecommendationViewModel = {
  recommendation: buildRecommendation({
    templateId: "k8s-pv-almost-full",
    name: "Persistent Volume Almost Full",
    category: "Storage",
    severity: "Warning",
  }),
  status: RecommendationStatus.Created,
  monitorId: STORAGE_MONITOR_ID,
};

/*
 * Three shapes on one page, on purpose: a category with work left AND work
 * done, a category whose only handled card is a dismissal, and a category with
 * nothing left to do.
 */
const GROUPS: Array<RecommendationCategoryGroup> = [
  {
    category: "Control Plane",
    recommendations: [API_SERVER_DOWN, ETCD_NO_LEADER, NODE_NOT_READY],
  },
  {
    category: "Workload",
    recommendations: [POD_CRASH_LOOPING, JOB_FAILED],
  },
  {
    category: "Storage",
    recommendations: [VOLUME_ALMOST_FULL],
  },
];

type RecommendationIdFunction = (viewModel: RecommendationViewModel) => string;

const idOf: RecommendationIdFunction = (
  viewModel: RecommendationViewModel,
): string => {
  return viewModel.recommendation.recommendationId;
};

let selectionChanges: Array<Set<string>> = [];
let dismissed: Array<RecommendationViewModel> = [];
let restored: Array<RecommendationViewModel> = [];
let monitorRouteRequests: Array<ObjectID> = [];

interface RenderListOptions {
  groups?: Array<RecommendationCategoryGroup> | undefined;
  selectedRecommendationIds?: Set<string> | undefined;
  isDisabled?: boolean | undefined;
}

type RenderListFunction = (options?: RenderListOptions) => void;

const renderList: RenderListFunction = (
  options: RenderListOptions = {},
): void => {
  render(
    <RecommendationsList
      groups={options.groups || GROUPS}
      selectedRecommendationIds={
        options.selectedRecommendationIds || new Set<string>()
      }
      isDisabled={options.isDisabled}
      onSelectionChange={(selectedRecommendationIds: Set<string>) => {
        selectionChanges.push(selectedRecommendationIds);
      }}
      onDismiss={(viewModel: RecommendationViewModel) => {
        dismissed.push(viewModel);
      }}
      onRestore={(viewModel: RecommendationViewModel) => {
        restored.push(viewModel);
      }}
      getMonitorRoute={(monitorId: ObjectID) => {
        monitorRouteRequests.push(monitorId);
        return new Route(`/dashboard/monitors/${monitorId.toString()}`);
      }}
    />,
  );
};

type LatestSelectionFunction = () => Set<string>;

const latestSelection: LatestSelectionFunction = (): Set<string> => {
  const latest: Set<string> | undefined =
    selectionChanges[selectionChanges.length - 1];

  if (!latest) {
    throw new Error("onSelectionChange was never called");
  }

  return latest;
};

/*
 * The whole heading row for a category — the title, both count chips and the
 * select-all control. Scoping to it is what keeps "1 handled" in one category
 * from satisfying an assertion about another.
 */
type GroupHeadingFunction = (category: string) => HTMLElement;

const groupHeading: GroupHeadingFunction = (category: string): HTMLElement => {
  const heading: HTMLElement = screen.getByRole("heading", {
    name: category,
    level: 4,
  });

  const row: HTMLElement | null | undefined =
    heading.closest("div")?.parentElement;

  if (!row) {
    throw new Error(`No heading row rendered for category ${category}`);
  }

  return row;
};

beforeEach(() => {
  selectionChanges = [];
  dismissed = [];
  restored = [];
  monitorRouteRequests = [];
});

describe("RecommendationsList", () => {
  describe("groups and cards", () => {
    /*
     * Catalog order, not alphabetical. The template modules declare their most
     * important category first — sorting would bury "Workload" under
     * "Control Plane" on every cluster.
     */
    test("renders the categories in the order they were given", () => {
      renderList();

      expect(
        screen
          .getAllByRole("heading", { level: 4 })
          .map((heading: HTMLElement) => {
            return heading.textContent;
          }),
      ).toEqual(["Control Plane", "Workload", "Storage"]);
    });

    test("renders a card for every recommendation in every group", () => {
      renderList();

      expect(screen.getByText("API Server Down")).toBeInTheDocument();
      expect(screen.getByText("Etcd Has No Leader")).toBeInTheDocument();
      expect(screen.getByText("Node Not Ready")).toBeInTheDocument();
      expect(screen.getByText("Pod Crash Looping")).toBeInTheDocument();
      expect(screen.getByText("Job Failed")).toBeInTheDocument();
      expect(
        screen.getByText("Persistent Volume Almost Full"),
      ).toBeInTheDocument();
    });

    /*
     * Cards carry their own state, and the list must not flatten it: only the
     * available ones offer selection, because creating something that already
     * exists duplicates a monitor and creating something dismissed contradicts
     * the dismissal shown on the card.
     */
    test("only the available cards offer selection", () => {
      renderList();

      expect(
        screen.getByRole("button", { name: "Select API Server Down" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Select Pod Crash Looping" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Select Node Not Ready" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Select Job Failed" }),
      ).not.toBeInTheDocument();
    });

    test("a dismissed card still shows why it was dismissed", () => {
      renderList();

      expect(
        screen.getByText("We run these jobs by hand."),
      ).toBeInTheDocument();
    });
  });

  describe("heading counts", () => {
    /*
     * "<n> to set up" is the number a person uses to decide whether to open
     * the section at all, so it counts only what is actually left: the created
     * and dismissed cards below it are not work.
     */
    test("a category with work left says how much", () => {
      renderList();

      expect(
        within(groupHeading("Control Plane")).getByText("2 to set up"),
      ).toBeInTheDocument();
      expect(
        within(groupHeading("Workload")).getByText("1 to set up"),
      ).toBeInTheDocument();
    });

    test("it also says how much has already been handled", () => {
      renderList();

      expect(
        within(groupHeading("Control Plane")).getByText("1 handled"),
      ).toBeInTheDocument();
      expect(
        within(groupHeading("Workload")).getByText("1 handled"),
      ).toBeInTheDocument();
    });

    /*
     * A finished category reads as finished rather than as "0 to set up",
     * which is the same information dressed as an outstanding task.
     */
    test("a category with nothing left reads as all handled", () => {
      renderList();

      const storage: HTMLElement = groupHeading("Storage");

      expect(within(storage).getByText("All handled")).toBeInTheDocument();
      expect(within(storage).queryByText(/to set up/)).not.toBeInTheDocument();
    });

    test("a category with nothing handled shows no handled count", () => {
      renderList({
        groups: [
          {
            category: "Control Plane",
            recommendations: [API_SERVER_DOWN, ETCD_NO_LEADER],
          },
        ],
      });

      const controlPlane: HTMLElement = groupHeading("Control Plane");

      expect(within(controlPlane).getByText("2 to set up")).toBeInTheDocument();
      expect(
        within(controlPlane).queryByText(/handled/),
      ).not.toBeInTheDocument();
    });
  });

  describe("select all", () => {
    test("the control names how many it will select", () => {
      renderList();

      expect(
        within(groupHeading("Control Plane")).getByRole("button", {
          name: "Select all 2",
        }),
      ).toBeInTheDocument();
      expect(
        within(groupHeading("Workload")).getByRole("button", {
          name: "Select all 1",
        }),
      ).toBeInTheDocument();
    });

    /*
     * The created and dismissed cards in the same category must stay out of
     * the Set. They are filtered out again before the create request, so
     * including them here would make the button offer more monitors than it
     * can create.
     */
    test("it selects every available recommendation in the category and nothing else", () => {
      renderList();

      fireEvent.click(screen.getByRole("button", { name: "Select all 2" }));

      expect(selectionChanges).toHaveLength(1);
      expect(latestSelection()).toEqual(
        new Set<string>([idOf(API_SERVER_DOWN), idOf(ETCD_NO_LEADER)]),
      );
      expect(latestSelection().has(idOf(NODE_NOT_READY))).toBe(false);
    });

    test("it does not touch a category the user has not pressed", () => {
      renderList();

      fireEvent.click(screen.getByRole("button", { name: "Select all 1" }));

      expect(latestSelection()).toEqual(
        new Set<string>([idOf(POD_CRASH_LOOPING)]),
      );
    });

    /*
     * Additivity is the whole point: pressing Select all on a second category
     * has to keep the first one. Replacing the Set instead would silently drop
     * everything the user picked before, and the only symptom is a lower
     * number on the create button.
     */
    test("it adds to selections made in other categories", () => {
      renderList({
        selectedRecommendationIds: new Set<string>([idOf(POD_CRASH_LOOPING)]),
      });

      fireEvent.click(screen.getByRole("button", { name: "Select all 2" }));

      expect(latestSelection()).toEqual(
        new Set<string>([
          idOf(POD_CRASH_LOOPING),
          idOf(API_SERVER_DOWN),
          idOf(ETCD_NO_LEADER),
        ]),
      );
    });

    // Partially selected is still "select the rest", not "clear".
    test("with some of the category selected it still reads as select all", () => {
      renderList({
        selectedRecommendationIds: new Set<string>([idOf(API_SERVER_DOWN)]),
      });

      expect(
        within(groupHeading("Control Plane")).getByRole("button", {
          name: "Select all 2",
        }),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Select all 2" }));

      expect(latestSelection()).toEqual(
        new Set<string>([idOf(API_SERVER_DOWN), idOf(ETCD_NO_LEADER)]),
      );
    });

    test("with the whole category selected it reads as a clear action", () => {
      renderList({
        selectedRecommendationIds: new Set<string>([
          idOf(API_SERVER_DOWN),
          idOf(ETCD_NO_LEADER),
        ]),
      });

      expect(
        within(groupHeading("Control Plane")).getByRole("button", {
          name: "Clear all",
        }),
      ).toBeInTheDocument();
    });

    test("clearing removes exactly that category and leaves the rest selected", () => {
      renderList({
        selectedRecommendationIds: new Set<string>([
          idOf(API_SERVER_DOWN),
          idOf(ETCD_NO_LEADER),
          idOf(POD_CRASH_LOOPING),
        ]),
      });

      /*
       * Scoped to the category on purpose: with Workload's only available
       * recommendation selected too, both headings read "Clear all" at the
       * same time, and the point of the assertion is that pressing one of them
       * leaves the other category's selection alone.
       */
      fireEvent.click(
        within(groupHeading("Control Plane")).getByRole("button", {
          name: "Clear all",
        }),
      );

      expect(latestSelection()).toEqual(
        new Set<string>([idOf(POD_CRASH_LOOPING)]),
      );
    });

    /*
     * A category with nothing to set up has nothing to select, and an
     * always-visible "Select all 0" on a finished section is a control that
     * can only ever do nothing.
     */
    test("a fully handled category offers no select-all", () => {
      renderList();

      expect(
        within(groupHeading("Storage")).queryByRole("button"),
      ).not.toBeInTheDocument();
    });
  });

  describe("while a create is in flight", () => {
    /*
     * isDisabled is set while the bulk create runs. Changing the selection
     * underneath a request that is already using it is how a user ends up
     * with monitors they did not pick.
     */
    test("isDisabled hides the select-all control entirely", () => {
      renderList({ isDisabled: true });

      expect(
        screen.queryByRole("button", { name: /Select all/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Clear all" }),
      ).not.toBeInTheDocument();
    });

    test("the cards still render while disabled", () => {
      renderList({ isDisabled: true });

      expect(screen.getByText("API Server Down")).toBeInTheDocument();
      expect(screen.getByText("Pod Crash Looping")).toBeInTheDocument();
    });
  });

  describe("selecting one card", () => {
    /*
     * Add to the Set, never replace it. Selection is built one card at a time
     * across several categories, and a card that replaced it would let a user
     * tick five things and create one.
     */
    test("ticking a card keeps everything already selected", () => {
      renderList({
        selectedRecommendationIds: new Set<string>([idOf(POD_CRASH_LOOPING)]),
      });

      fireEvent.click(
        screen.getByRole("button", { name: "Select API Server Down" }),
      );

      expect(latestSelection()).toEqual(
        new Set<string>([idOf(POD_CRASH_LOOPING), idOf(API_SERVER_DOWN)]),
      );
    });

    test("unticking a card removes only that one", () => {
      renderList({
        selectedRecommendationIds: new Set<string>([
          idOf(API_SERVER_DOWN),
          idOf(ETCD_NO_LEADER),
          idOf(POD_CRASH_LOOPING),
        ]),
      });

      fireEvent.click(
        screen.getByRole("button", { name: "Select API Server Down" }),
      );

      expect(latestSelection()).toEqual(
        new Set<string>([idOf(ETCD_NO_LEADER), idOf(POD_CRASH_LOOPING)]),
      );
    });

    test("a selected card is announced as pressed", () => {
      renderList({
        selectedRecommendationIds: new Set<string>([idOf(API_SERVER_DOWN)]),
      });

      expect(
        screen.getByRole("button", { name: "Select API Server Down" }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        screen.getByRole("button", { name: "Select Etcd Has No Leader" }),
      ).toHaveAttribute("aria-pressed", "false");
    });
  });

  describe("dismiss and restore", () => {
    /*
     * Both handlers take the view model rather than an id, and the page needs
     * the right one: dismissing writes a row keyed on that recommendation, and
     * restoring deletes the dismissal row carried on that view model. Handing
     * back a neighbouring card's model dismisses the wrong recommendation, and
     * the user watches a different card disappear.
     */
    test("dismissing a card hands back that card's own recommendation", () => {
      renderList();

      fireEvent.click(
        screen.getByRole("button", { name: "Dismiss Etcd Has No Leader" }),
      );

      expect(dismissed).toHaveLength(1);
      expect(dismissed[0]).toBe(ETCD_NO_LEADER);
      expect(selectionChanges).toHaveLength(0);
    });

    test("only the available cards can be dismissed", () => {
      renderList();

      expect(
        screen.getByRole("button", { name: "Dismiss API Server Down" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Dismiss Node Not Ready" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Dismiss Job Failed" }),
      ).not.toBeInTheDocument();
    });

    test("restoring hands back the dismissed card's view model", () => {
      renderList();

      fireEvent.click(screen.getByRole("button", { name: "Restore" }));

      expect(restored).toHaveLength(1);
      expect(restored[0]).toBe(JOB_FAILED);
      expect(restored[0]?.dismissalId).toBe(JOB_FAILED.dismissalId);
    });
  });

  describe("created cards", () => {
    /*
     * The only reason the list knows about routes at all. A created card whose
     * link is built from the wrong card's monitorId sends the user to somebody
     * else's monitor, which reads as "this recommendation created the wrong
     * thing".
     */
    test("a created card links to the monitor built from its own monitorId", () => {
      renderList();

      const links: Array<HTMLElement> = screen.getAllByRole("link", {
        name: "View monitor",
      });

      expect(links).toHaveLength(2);
      expect(monitorRouteRequests).toEqual([MONITOR_ID, STORAGE_MONITOR_ID]);
      expect(links[0]).toHaveAttribute(
        "href",
        `/dashboard/monitors/${MONITOR_ID.toString()}`,
      );
    });
  });
});
