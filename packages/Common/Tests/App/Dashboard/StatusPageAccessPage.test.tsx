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
 * A status page's Security -> Access page (the old "Authentication
 * Settings", at the same address): the "Who can see this status page" card
 * (StatusPageAccessCard, which has a suite of its own), then a folded
 * Advanced section holding the IP allowlist - which applies whoever the
 * page is open to, and which few pages need.
 *
 * It used to be three cards: an "Is Visible to Public" switch, a "Master
 * Password" card with its own switch and a button for the password, and the
 * IP whitelist. None of them is left: who can see the page is one choice.
 *
 * The reader session limit and the IP allowlist are Enterprise features,
 * each behind a core shell (StatusPageSessionLengthSettings,
 * IpAllowlistSettings; EnterpriseSettingShells holds them, and
 * ee/Tests/UI/IpAllowlists the Enterprise card). Both are recorded rather
 * than drawn: what matters is what the page hands them - and what the folded
 * section says, which is the real section.
 */

type Recorded = { kind: string; props: Record<string, unknown> };

interface RecorderStore {
  latest: Map<string, Recorded>;
}

const store: RecorderStore = { latest: new Map<string, Recorded>() };

(
  globalThis as unknown as { __accessPageRecorded: RecorderStore }
).__accessPageRecorded = store;

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
      globalThis as unknown as { __accessPageRecorded: RecorderStore }
    ).__accessPageRecorded.latest.set(name, { kind: kind, props: props });

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
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageAccessCard",
  () => {
    return { __esModule: true, default: mockRecorder("access-card") };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageSessionLengthSettings",
  () => {
    return { __esModule: true, default: mockRecorder("session-length-card") };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/IpAllowlist/IpAllowlistSettings",
  () => {
    return { __esModule: true, default: mockRecorder("ip-allowlist-shell") };
  },
);

import StatusPageAccessPage from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/AuthenticationSettings";
import StatusPageAccessCopy, {
  STATUS_PAGE_ACCESS_ADVANCED_SECTION_TEST_ID,
  STATUS_PAGE_IP_ALLOWLIST_ENTRIES_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageAccessCopy";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
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

const STATUS_PAGE_ID: string = "33333333-3333-4333-8333-333333333333";
const ALLOWLIST_CARD: string = "Status Page > IP Allowlist";

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
    .mockReturnValue(new ObjectID(STATUS_PAGE_ID));

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
    render(<StatusPageAccessPage {...PAGE_PROPS} />);
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
  return screen.getByTestId(STATUS_PAGE_ACCESS_ADVANCED_SECTION_TEST_ID);
}

describe("the page", () => {
  test("opens on who can see the page, then how long readers stay signed in, then a folded Advanced section with the IP allowlist", async () => {
    await renderPage();

    const cards: Array<string | null> = screen
      .getAllByTestId("recorded-card")
      .map((element: HTMLElement): string | null => {
        return element.getAttribute("data-card");
      });

    expect(cards).toEqual([
      "access-card",
      "session-length-card",
      ALLOWLIST_CARD,
    ]);

    expect(
      within(advancedSection()).getAllByTestId("recorded-card").length,
    ).toBe(1);
    expect(
      within(advancedSection()).getByTestId("recorded-card"),
    ).toHaveAttribute("data-card", ALLOWLIST_CARD);
  });

  test("the choice is for this status page", async () => {
    await renderPage();

    expect(
      (propsOf("access-card")["statusPageId"] as ObjectID).toString(),
    ).toBe(STATUS_PAGE_ID);
  });

  test("how long readers stay signed in is this status page's, and not folded away", async () => {
    await renderPage();

    expect(
      (propsOf("session-length-card")["statusPageId"] as ObjectID).toString(),
    ).toBe(STATUS_PAGE_ID);
    expect(
      within(advancedSection()).queryByText("session-length-card"),
    ).not.toBeInTheDocument();
    expect(
      within(advancedSection())
        .getAllByTestId("recorded-card")
        .map((element: HTMLElement): string | null => {
          return element.getAttribute("data-card");
        }),
    ).not.toContain("session-length-card");
  });

  test("no card is left of the switches and the password button", async () => {
    await renderPage();

    for (const gone of [
      "Status Page > Authentication Settings",
      "Status Page > Master Password",
      "Status Page > IP Whitelist",
    ]) {
      expect([gone, store.latest.has(gone)]).toEqual([gone, false]);
    }

    expect(screen.queryByText("Is Visible to Public")).not.toBeInTheDocument();
    expect(screen.queryByText("Set Master Password")).not.toBeInTheDocument();
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
      StatusPageAccessCopy.advancedDescription,
    );
  });

  test("with no allowlist: every address may open the page, and nothing is configured", async () => {
    await renderPage();
    await loadAllowlist(undefined);

    expect(advancedSection()).toHaveTextContent(
      StatusPageAccessCopy.advancedSummaryOpen,
    );
    expect(setChips(advancedSection())).toEqual([]);
  });

  test("with an allowlist: it says so, folded, and says Configured", async () => {
    await renderPage();
    await loadAllowlist("203.0.113.7\n10.0.0.0/8");

    expect(advancedSection()).toHaveTextContent(
      StatusPageAccessCopy.advancedSummaryConfigured,
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
  test("is the status page's IP Allowlist, in the page's own words", async () => {
    await renderPage();

    const props: Record<string, unknown> = propsOf(ALLOWLIST_CARD);

    expect(props["modelType"]).toBe(StatusPage);
    expect(props["modelId"]).toEqual(new ObjectID(STATUS_PAGE_ID));
    expect(props).toMatchObject({
      modelDetailId: "model-detail-status-page-ip-allowlist",
      title: "IP Allowlist",
      description: StatusPageAccessCopy.ipAllowlistDescription,
      editButtonText: "Edit IP Allowlist",
      fieldDescription: StatusPageAccessCopy.ipAllowlistFieldDescription,
      emptyText: StatusPageAccessCopy.ipAllowlistEmpty,
      noAddressText: StatusPageAccessCopy.ipAllowlistNoAddress,
      entriesTestId: STATUS_PAGE_IP_ALLOWLIST_ENTRIES_TEST_ID,
    });
  });

  test("tells the page each allowlist it reads, so the folded section can say Configured", async () => {
    await renderPage();

    expect(typeof propsOf(ALLOWLIST_CARD)["onLoaded"]).toBe("function");
  });
});
