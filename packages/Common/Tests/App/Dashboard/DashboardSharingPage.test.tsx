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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { getJestSpyOn } from "../../Spy";

/*
 * A dashboard's Sharing page (the old "Authentication" page under Advanced,
 * at the same address): the "Who can view this dashboard" card
 * (DashboardSharingCard, which has a suite of its own), then a folded
 * Advanced section holding the IP allowlist - which applies to the public
 * link, and which few dashboards need. It saves on its own, so its Scale
 * plan never stands in the way of the choice.
 *
 * It used to be four cards: an "Is Visible to Public" switch, a "Master
 * Password" card with its own switch and a button for the password, the
 * public link, and the IP whitelist. None of them is left: who can view
 * the dashboard is one choice, with the link under it.
 *
 * The IP allowlist is an Enterprise feature behind a core shell
 * (IpAllowlistSettings; EnterpriseSettingShells holds it, and
 * ee/Tests/UI/IpAllowlists the Enterprise card). The shell is recorded
 * rather than drawn: what matters is what the page hands it - and what the
 * folded section says, which is the real section.
 */

type Recorded = { kind: string; props: Record<string, unknown> };

interface RecorderStore {
  latest: Map<string, Recorded>;
}

const store: RecorderStore = { latest: new Map<string, Recorded>() };

(
  globalThis as unknown as { __sharingPageRecorded: RecorderStore }
).__sharingPageRecorded = store;

type Recorder = (
  kind: string,
) => (props: Record<string, unknown>) => ReactElement;

const mockRecorder: Recorder = (kind: string) => {
  return (props: Record<string, unknown>): ReactElement => {
    const name: string =
      (props["cardName"] as string | undefined) ||
      (props["name"] as string | undefined) ||
      kind;

    (
      globalThis as unknown as { __sharingPageRecorded: RecorderStore }
    ).__sharingPageRecorded.latest.set(name, { kind: kind, props: props });

    const react: typeof React = jest.requireActual("react") as typeof React;

    return react.createElement("div", {
      "data-testid": "recorded-card",
      "data-card": name,
      "data-kind": kind,
    });
  };
};

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return { __esModule: true, default: mockRecorder("card-model-detail") };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Sharing/DashboardSharingCard",
  () => {
    return { __esModule: true, default: mockRecorder("sharing-card") };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/IpAllowlist/IpAllowlistSettings",
  () => {
    return { __esModule: true, default: mockRecorder("ip-allowlist-shell") };
  },
);

import DashboardSharingPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/View/Sharing";
import DashboardSharingCopy, {
  DASHBOARD_IP_ALLOWLIST_ENTRIES_TEST_ID,
  DASHBOARD_SHARING_ADVANCED_SECTION_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Sharing/DashboardSharingCopy";
import IpAllowlistCopy from "../../../../App/FeatureSet/Dashboard/src/Components/IpAllowlist/IpAllowlistCopy";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Route from "../../../Types/API/Route";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  hasSetChip,
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

const DASHBOARD_ID: string = "44444444-4444-4444-8444-444444444444";
const ALLOWLIST_CARD: string = "Dashboard > IP Allowlist";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: false,
};

const PLAN_ORDER: Array<PlanType> = [
  PlanType.Free,
  PlanType.Growth,
  PlanType.Scale,
  PlanType.Enterprise,
];

let plan: PlanType | null = null;

beforeEach(() => {
  store.latest.clear();
  plan = null;

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(DASHBOARD_ID));

  getJestSpyOn(ProjectUtil, "getCurrentPlan").mockImplementation(
    (): PlanType | null => {
      return plan;
    },
  );

  getJestSpyOn(
    SubscriptionPlan,
    "isFeatureAccessibleOnCurrentPlan",
  ).mockImplementation((needed: unknown, current: unknown): boolean => {
    return (
      PLAN_ORDER.indexOf(current as PlanType) >=
      PLAN_ORDER.indexOf(needed as PlanType)
    );
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  await act(async () => {
    render(<DashboardSharingPage {...PAGE_PROPS} />);
  });
}

function propsOf(name: string): Record<string, unknown> {
  const card: Recorded | undefined = store.latest.get(name);

  expect([name, Boolean(card)]).toEqual([name, true]);

  return card!.props;
}

// What the allowlist shell reads, handed to the page as the shell would.
async function loadAllowlist(ipWhitelist: string | undefined): Promise<void> {
  const onLoaded: (ipAllowlist: string) => void = propsOf(ALLOWLIST_CARD)[
    "onLoaded"
  ] as (ipAllowlist: string) => void;

  await act(async () => {
    onLoaded(ipWhitelist || "");
  });
}

function advancedSection(): HTMLElement {
  return screen.getByTestId(DASHBOARD_SHARING_ADVANCED_SECTION_TEST_ID);
}

describe("the page", () => {
  test("opens on who can view the dashboard, then a folded Advanced section with the IP allowlist", async () => {
    await renderPage();

    const cards: Array<string | null> = screen
      .getAllByTestId("recorded-card")
      .map((element: HTMLElement): string | null => {
        return element.getAttribute("data-card");
      });

    expect(cards).toEqual(["sharing-card", ALLOWLIST_CARD]);

    expect(
      within(advancedSection()).getAllByTestId("recorded-card").length,
    ).toBe(1);
    expect(
      within(advancedSection()).getByTestId("recorded-card"),
    ).toHaveAttribute("data-card", ALLOWLIST_CARD);
  });

  test("the choice is for this dashboard", async () => {
    await renderPage();

    expect(
      (propsOf("sharing-card")["dashboardId"] as ObjectID).toString(),
    ).toBe(DASHBOARD_ID);
  });

  test("no card is left of the switches, the password button and the preview link", async () => {
    await renderPage();

    for (const gone of [
      "Dashboard > Authentication Settings",
      "Dashboard > Master Password",
      "Dashboard > IP Whitelist",
    ]) {
      expect([gone, store.latest.has(gone)]).toEqual([gone, false]);
    }

    for (const text of [
      "Is Visible to Public",
      "Set Master Password",
      "Require Master Password",
      "Dashboard Preview URL",
    ]) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }

    expect(screen.queryByText(/whitelist/i)).not.toBeInTheDocument();
  });
});

describe("the folded Advanced section", () => {
  test("is folded, and names what is in it", async () => {
    await renderPage();

    const toggle: HTMLElement = within(advancedSection()).getByRole("button", {
      name: "More settings",
    });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(listedNames(toggle)).toEqual(["IP Allowlist"]);

    // Open, it says what it is for.
    fireEvent.click(toggle);

    expect(advancedSection()).toHaveTextContent(
      DashboardSharingCopy.advancedDescription,
    );
  });

  test("with no allowlist: every address may open the public link, and nothing is configured", async () => {
    await renderPage();
    await loadAllowlist(undefined);

    expect(advancedSection()).toHaveTextContent(
      DashboardSharingCopy.advancedSummaryOpen,
    );
    expect(setChips(advancedSection())).toEqual([]);
  });

  test("with an allowlist: it says so, folded, and says Configured", async () => {
    await renderPage();
    await loadAllowlist("203.0.113.7\n10.0.0.0/8");

    expect(advancedSection()).toHaveTextContent(
      DashboardSharingCopy.advancedSummaryConfigured,
    );
    expect(hasSetChip(advancedSection())).toBe(true);
  });

  test("a list of blank lines is in force on the server, so it is Configured too", async () => {
    await renderPage();
    await loadAllowlist("\n  \n");

    expect(hasSetChip(advancedSection())).toBe(true);
  });

  test("opens from its title", async () => {
    await renderPage();

    const toggle: HTMLElement = within(advancedSection()).getByRole("button", {
      name: "More settings",
    });

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});

describe("the IP allowlist shell", () => {
  test("is the dashboard's IP Allowlist, in the page's own words", async () => {
    await renderPage();

    const props: Record<string, unknown> = propsOf(ALLOWLIST_CARD);

    expect(props["modelType"]).toBe(Dashboard);
    expect(props["modelId"]).toEqual(new ObjectID(DASHBOARD_ID));
    expect(props).toMatchObject({
      modelDetailId: "model-detail-dashboard-ip-allowlist",
      title: IpAllowlistCopy.title,
      description: DashboardSharingCopy.ipAllowlistDescription,
      editButtonText: IpAllowlistCopy.editButton,
      fieldDescription: IpAllowlistCopy.fieldDescription,
      emptyText: DashboardSharingCopy.ipAllowlistEmpty,
      noAddressText: DashboardSharingCopy.ipAllowlistNoAddress,
      entriesTestId: DASHBOARD_IP_ALLOWLIST_ENTRIES_TEST_ID,
    });
  });
});
