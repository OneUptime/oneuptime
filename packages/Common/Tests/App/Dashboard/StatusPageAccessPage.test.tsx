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
 * (StatusPageAccessCard, which has a suite of its own), then a folded More
 * settings section holding how long readers stay signed in (Reader
 * Sessions) and the IP allowlist - Enterprise access controls few pages
 * need. "Move custom roles to More settings because it is an advanced
 * feature. Please audit the entire project for advanced features just like
 * these and move them to More as well" - the maintainer: Reader Sessions
 * was a card of its own under the choice, and waits folded now, named in
 * the folded header with its length while one is set.
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
import StatusPageSessionLengthCopy, {
  STATUS_PAGE_SESSION_LENGTH_PLACE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageSessionLengthCopy";
import { IP_ALLOWLIST_CARD_PLACE } from "../../../../App/FeatureSet/Dashboard/src/Components/IpAllowlist/IpAllowlistCopy";
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

// What the reader sessions shell reads, handed to the page as the shell would.
async function loadSessionLength(lengthInHours: number | null): Promise<void> {
  const onLengthChange: (length: number | null) => void = propsOf(
    "session-length-card",
  )["onLengthChange"] as (length: number | null) => void;

  await act(async () => {
    onLengthChange(lengthInHours);
  });
}

function advancedSection(): HTMLElement {
  return screen.getByTestId(STATUS_PAGE_ACCESS_ADVANCED_SECTION_TEST_ID);
}

function cardsIn(container: HTMLElement): Array<string | null> {
  return within(container)
    .getAllByTestId("recorded-card")
    .map((element: HTMLElement): string | null => {
      return element.getAttribute("data-card");
    });
}

describe("the page", () => {
  test("opens on who can see the page, then a folded More settings with how long readers stay signed in and the IP allowlist", async () => {
    await renderPage();

    expect(cardsIn(document.body)).toEqual([
      "access-card",
      "session-length-card",
      ALLOWLIST_CARD,
    ]);

    // Only the choice is outside the fold.
    expect(cardsIn(advancedSection())).toEqual([
      "session-length-card",
      ALLOWLIST_CARD,
    ]);
  });

  test("the choice is for this status page", async () => {
    await renderPage();

    expect(
      (propsOf("access-card")["statusPageId"] as ObjectID).toString(),
    ).toBe(STATUS_PAGE_ID);
  });

  test("how long readers stay signed in is this status page's, folded under More settings", async () => {
    await renderPage();

    expect(
      (propsOf("session-length-card")["statusPageId"] as ObjectID).toString(),
    ).toBe(STATUS_PAGE_ID);
    expect(typeof propsOf("session-length-card")["onLengthChange"]).toBe(
      "function",
    );
    expect(cardsIn(advancedSection())).toContain("session-length-card");
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

describe("the folded More settings", () => {
  function toggle(): HTMLElement {
    return within(advancedSection()).getByRole("button", {
      name: "More settings",
    });
  }

  test("is folded, and names what is in it, in its order", async () => {
    await renderPage();

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(listedNames(toggle())).toEqual([
      StatusPageSessionLengthCopy.cardTitle,
      "IP Allowlist",
    ]);
    expect(setChips(advancedSection())).toEqual([]);

    // Open, it says what it is for.
    fireEvent.click(toggle());

    expect(advancedSection()).toHaveTextContent(
      StatusPageAccessCopy.advancedDescription,
    );
  });

  /*
   * Two settings, each with a value of its own: folded, each says what it
   * is set to - a sentence about one of them would hide the other.
   */
  test("says no sentence for one card alone: what is set shows on its own chip", async () => {
    await renderPage();
    await loadAllowlist("203.0.113.7");

    expect(advancedSection()).not.toHaveTextContent(
      "Every IP address can open this status page.",
    );
    expect(advancedSection()).not.toHaveTextContent(
      "Only the IP addresses on the allowlist can open this status page.",
    );
  });

  test("with no allowlist and no reader session limit: nothing is set", async () => {
    await renderPage();
    await loadAllowlist(undefined);
    await loadSessionLength(null);

    expect(setChips(advancedSection())).toEqual([]);
  });

  test("with an allowlist: a chip says how many entries it holds", async () => {
    await renderPage();
    await loadAllowlist("203.0.113.7\n10.0.0.0/8");

    expect(setChips(advancedSection())).toEqual(["IP Allowlist: 2"]);
    expect(hasSetChip(advancedSection())).toBe(true);
    // Saying so does not open it.
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  test("a list of blank lines is in force on the server, so it is set too", async () => {
    await renderPage();
    await loadAllowlist("\n  \n");

    expect(hasSetChip(advancedSection())).toBe(true);
  });

  test("with a reader session limit: a chip says how long readers stay signed in", async () => {
    await renderPage();
    await loadSessionLength(8);

    expect(setChips(advancedSection())).toEqual([
      `${StatusPageSessionLengthCopy.cardTitle}: 8 hours`,
    ]);

    await loadSessionLength(24 * 30);

    expect(setChips(advancedSection())).toEqual([
      `${StatusPageSessionLengthCopy.cardTitle}: 30 days`,
    ]);

    // Taken away: named again, not set.
    await loadSessionLength(null);

    expect(setChips(advancedSection())).toEqual([]);
    expect(listedNames(toggle())).toContain(
      StatusPageSessionLengthCopy.cardTitle,
    );
  });

  test("both set: both chips, the reader sessions first", async () => {
    await renderPage();
    await loadSessionLength(1);
    await loadAllowlist("10.0.0.0/8");

    expect(setChips(advancedSection())).toEqual([
      `${StatusPageSessionLengthCopy.cardTitle}: 1 hour`,
      "IP Allowlist: 1",
    ]);
  });

  test("opens from its title", async () => {
    await renderPage();

    fireEvent.click(toggle());

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
  });

  /*
   * A link to a card in it - a search result, the docs, another page -
   * opens it there (AdvancedPageSection): #reader-sessions and
   * #ip-allowlist, each its card's title's place.
   */
  test.each([
    [STATUS_PAGE_SESSION_LENGTH_PLACE, "reader-sessions"],
    [IP_ALLOWLIST_CARD_PLACE, "ip-allowlist"],
  ])("opened at #%s, it opens there", async (place: string, name: string) => {
    expect(place).toBe(name);

    window.history.replaceState(null, "", `#${place}`);

    try {
      await renderPage();

      expect(toggle()).toHaveAttribute("aria-expanded", "true");
    } finally {
      window.history.replaceState(null, "", "#");
    }
  });

  test("opened at any other place, it stays folded", async () => {
    window.history.replaceState(null, "", "#who-can-see-this-status-page");

    try {
      await renderPage();

      expect(toggle()).toHaveAttribute("aria-expanded", "false");
    } finally {
      window.history.replaceState(null, "", "#");
    }
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

  test("tells the page each allowlist it reads, so the folded section can mark it set", async () => {
    await renderPage();

    expect(typeof propsOf(ALLOWLIST_CARD)["onLoaded"]).toBe("function");
  });
});
