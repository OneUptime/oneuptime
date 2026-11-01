import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { UserFlowSessionDetailDto } from "../../../Types/Rum/UserFlow";
import {
  UserFlowSessionJourney,
  UserFlowVisit,
} from "../../../Utils/Rum/UserFlow";
import UserFlowJourneyList, {
  ComponentProps as JourneyListProps,
  USER_FLOW_JOURNEYS_PAGE_SIZE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowJourneyList";
import {
  BarProps,
  UserFlowPersonBar,
  UserFlowPersonSearch,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowPersonBar";
import { UserFlowPersonDescription } from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowPerson";

/*
 * One person's journeys, driven the way a person drives them: read the
 * sessions, open one, look for what went wrong, go to the replay. The page's
 * words are what is asserted, because they are what a support engineer acts
 * on: "Exit page" on a session still recording would simply be false.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.setTimeout(60000);

const APP_ID: ObjectID = new ObjectID("0193c0de-1111-4aaa-8bbb-000000000002");
const NOW: number = 1_800_000_000_000;

const FINISHED: UserFlowSessionDetailDto = {
  identifiedUserKey: "k",
  visitorId: "v",
  identifiedUserLabel: "jane@example.com",
  isFinalized: true,
  hasRecordingEnded: false,
  sealedReason: "",
  chunkCount: 4,
};

function visit(
  page: string,
  overrides: Partial<UserFlowVisit> = {},
): UserFlowVisit {
  return {
    page: page,
    url: `https://shop.example.com${page}`,
    visit: 1,
    visitsInSession: 1,
    isLanding: false,
    isExit: false,
    errorCount: 0,
    frustrationCount: 0,
    ...overrides,
  };
}

function journey(
  sessionId: string,
  overrides: Partial<UserFlowSessionJourney> = {},
): UserFlowSessionJourney {
  return {
    sessionId: sessionId,
    startUnixMs: NOW - 60_000,
    durationMs: 120_000,
    deviceType: "desktop",
    browserName: "Chrome",
    countryCode: "DK",
    errorCount: 0,
    frustrationCount: 0,
    visits: [
      visit("/pricing", { isLanding: true }),
      visit("/checkout", { isExit: true }),
    ],
    repeatVisits: 0,
    isCut: false,
    detail: FINISHED,
    ...overrides,
  };
}

function renderList(
  journeys: Array<UserFlowSessionJourney>,
  overrides: Partial<JourneyListProps> = {},
): RenderResult {
  return render(
    <MemoryRouter>
      <UserFlowJourneyList
        journeys={journeys}
        rumApplicationId={APP_ID}
        showsOwner={false}
        nowUnixMs={NOW}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

function rows(): Array<HTMLElement> {
  return screen.getAllByTestId("user-flow-journey");
}

afterEach(() => {
  cleanup();
});

describe("UserFlowJourneyList", () => {
  test("the newest session starts open, the rest folded to one line", () => {
    renderList([
      journey("newest"),
      journey("older", {
        visits: [
          visit("/a", { isLanding: true }),
          visit("/b"),
          visit("/c", { isExit: true }),
        ],
      }),
    ]);

    const [newest, older] = rows() as [HTMLElement, HTMLElement];

    expect(within(newest).getAllByTestId("user-flow-visit")).toHaveLength(2);
    expect(
      within(newest).getByTestId("user-flow-journey-toggle"),
    ).toHaveAttribute("aria-expanded", "true");

    expect(within(older).queryAllByTestId("user-flow-visit")).toHaveLength(0);
    expect(
      within(older).getByTestId("user-flow-journey-toggle"),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      within(older).getByTestId("user-flow-journey-summary"),
    ).toHaveTextContent("/a → … → /c");
  });

  test("a row opens and closes", () => {
    renderList([journey("one"), journey("two")]);

    const second: HTMLElement = rows()[1] as HTMLElement;
    const toggle: HTMLElement = within(second).getByTestId(
      "user-flow-journey-toggle",
    );

    fireEvent.click(toggle);
    expect(within(second).getAllByTestId("user-flow-visit")).toHaveLength(2);

    fireEvent.click(toggle);
    expect(within(second).queryAllByTestId("user-flow-visit")).toHaveLength(0);
  });

  test("says what the session was, in one line", () => {
    renderList([journey("s")]);

    expect(rows()[0]).toHaveTextContent("2m 00s · 2 pages");
    expect(rows()[0]).toHaveTextContent("Chrome · desktop · DK");
  });

  test("one page reads in the singular", () => {
    renderList([
      journey("s", {
        visits: [visit("/a", { isLanding: true, isExit: true })],
      }),
    ]);

    expect(rows()[0]).toHaveTextContent("1 page");
    expect(rows()[0]).not.toHaveTextContent("1 pages");
  });

  test("a duration nobody measured yet is left out, not shown as zero", () => {
    renderList([journey("s", { durationMs: 0 })]);

    expect(rows()[0]).not.toHaveTextContent("0s");
    expect(rows()[0]).not.toHaveTextContent("—");
  });

  describe("a visit", () => {
    function visitRow(index: number): HTMLElement {
      return screen.getAllByTestId("user-flow-visit")[index] as HTMLElement;
    }

    test("the landing page and the exit page are named", () => {
      renderList([journey("s")]);

      expect(visitRow(0)).toHaveTextContent("Landing page");
      expect(visitRow(1)).toHaveTextContent("Exit page");
      expect(visitRow(0)).not.toHaveTextContent("Exit page");
    });

    test("a session of one page says both of it", () => {
      renderList([
        journey("s", {
          visits: [visit("/a", { isLanding: true, isExit: true })],
        }),
      ]);

      expect(visitRow(0)).toHaveTextContent("Landing page");
      expect(visitRow(0)).toHaveTextContent("Exit page");
    });

    test("a repeat says which visit it is; a first visit says nothing", () => {
      renderList([
        journey("s", {
          visits: [
            visit("/cart", { visitsInSession: 2, isLanding: true }),
            visit("/help"),
            visit("/cart", { visit: 2, visitsInSession: 2, isExit: true }),
          ],
          repeatVisits: 1,
        }),
      ]);

      expect(visitRow(0)).not.toHaveTextContent("Visit");
      expect(visitRow(2)).toHaveTextContent("Visit 2 of 2");
      expect(rows()[0]).toHaveTextContent("1 repeat visit");
    });

    test("problems are told on the page, with the count that belongs to it", () => {
      renderList([
        journey("s", {
          errorCount: 3,
          frustrationCount: 1,
          visits: [
            visit("/a", { isLanding: true, errorCount: 3 }),
            visit("/b", { isExit: true, frustrationCount: 1 }),
          ],
        }),
      ]);

      expect(visitRow(0)).toHaveTextContent("3 errors on this page");
      expect(visitRow(1)).toHaveTextContent(
        "1 frustration signal on this page",
      );
      expect(rows()[0]).toHaveTextContent("3 errors");
      expect(rows()[0]).toHaveTextContent("1 frustration signal");
    });

    test("the stored URL is one hover away", () => {
      renderList([journey("s")]);

      expect(within(visitRow(0)).getByText("/pricing")).toHaveAttribute(
        "title",
        "https://shop.example.com/pricing",
      );
    });

    test("the list is an ordered one, for a screen reader as for the eye", () => {
      renderList([journey("s")]);

      expect(screen.getByTestId("user-flow-visits").tagName).toBe("OL");
    });
  });

  describe("a session still being recorded", () => {
    const LIVE: UserFlowSessionDetailDto = {
      ...FINISHED,
      isFinalized: false,
      chunkCount: 0,
    };

    test("has no exit page yet", () => {
      renderList([journey("s", { detail: LIVE })]);

      expect(screen.queryByText("Exit page")).not.toBeInTheDocument();
      expect(screen.getByText("Last page so far")).toBeInTheDocument();
      expect(screen.getByText("Recording now")).toBeInTheDocument();
    });

    /* A closed tab kept "Recording now" for minutes before the shared rule. */
    test("once every tab has closed it is over, though not yet counted", () => {
      renderList([
        journey("s", { detail: { ...LIVE, hasRecordingEnded: true } }),
      ]);

      expect(screen.getByText("Exit page")).toBeInTheDocument();
      expect(screen.queryByText("Recording now")).not.toBeInTheDocument();
    });
  });

  describe("the replay", () => {
    test("links to that session", () => {
      renderList([journey("0123456789abcdef0123456789abcdef")]);

      expect(
        screen.getByTestId("user-flow-watch").getAttribute("href"),
      ).toContain("0123456789abcdef0123456789abcdef");
    });

    test("is not offered when there is nothing to watch, and says why", () => {
      renderList([
        journey("s", {
          detail: {
            ...FINISHED,
            sealedReason: "recording-lost",
            chunkCount: 0,
          },
        }),
      ]);

      expect(screen.queryByTestId("user-flow-watch")).not.toBeInTheDocument();
      expect(screen.getByTestId("user-flow-no-replay")).toHaveAttribute(
        "title",
        expect.stringContaining("never arrived"),
      );
    });

    test("opening a row does not get in the way of it", () => {
      renderList([journey("one"), journey("two")]);

      const second: HTMLElement = rows()[1] as HTMLElement;

      fireEvent.click(within(second).getByTestId("user-flow-watch"));

      expect(
        within(second).getByTestId("user-flow-journey-toggle"),
      ).toHaveAttribute("aria-expanded", "false");
    });
  });

  describe("a journey past the cap", () => {
    test("says pages are missing, just before the page it really ended on", () => {
      renderList([
        journey("s", {
          isCut: true,
          visits: [
            visit("/1", { isLanding: true }),
            visit("/2"),
            visit("/last", { isExit: true }),
          ],
        }),
      ]);

      const items: Array<HTMLElement> = Array.from(
        screen.getByTestId("user-flow-visits").children,
      ) as Array<HTMLElement>;

      expect(items).toHaveLength(4);
      expect(items[2]).toHaveAttribute("data-testid", "user-flow-journey-cut");
      expect(items[3]).toHaveTextContent("/last");
      expect(items[3]).toHaveTextContent("Exit page");
    });

    test("a whole journey says nothing of the sort", () => {
      renderList([journey("s")]);

      expect(
        screen.queryByTestId("user-flow-journey-cut"),
      ).not.toBeInTheDocument();
    });
  });

  describe("whose session it was", () => {
    test("is said when the list is one browser, which can be several people", () => {
      renderList(
        [
          journey("mine"),
          journey("theirs", {
            detail: { ...FINISHED, identifiedUserLabel: "bob@example.com" },
          }),
          journey("nobody", {
            detail: {
              ...FINISHED,
              identifiedUserKey: "",
              identifiedUserLabel: "",
            },
          }),
        ],
        { showsOwner: true },
      );

      expect(rows()[0]).toHaveTextContent("jane@example.com");
      expect(rows()[1]).toHaveTextContent("bob@example.com");
      expect(rows()[2]).toHaveTextContent("Visitor v");
    });

    test("is left out when the whole page is one person already", () => {
      renderList([journey("s")]);

      expect(rows()[0]).not.toHaveTextContent("jane@example.com");
    });

    test("a role that may not read the name sees that it is hidden", () => {
      const { identifiedUserLabel: _label, ...hidden } = FINISHED;

      renderList([journey("s", { detail: hidden })], { showsOwner: true });

      expect(_label).toBeTruthy();
      expect(rows()[0]).toHaveTextContent("Hidden");
      expect(rows()[0]).not.toHaveTextContent("jane");
    });
  });

  describe("a long list", () => {
    const MANY: Array<UserFlowSessionJourney> = Array.from(
      { length: USER_FLOW_JOURNEYS_PAGE_SIZE * 2 + 5 },
      (_value: unknown, index: number): UserFlowSessionJourney => {
        return journey(`s-${index}`);
      },
    );

    test("draws a page at a time and says how many there are", () => {
      renderList(MANY);

      expect(rows()).toHaveLength(USER_FLOW_JOURNEYS_PAGE_SIZE);
      expect(
        screen.getByText(
          `Showing ${USER_FLOW_JOURNEYS_PAGE_SIZE} of ${MANY.length} sessions`,
        ),
      ).toBeInTheDocument();
    });

    test("shows more until there are none left, then stops offering", () => {
      renderList(MANY);

      fireEvent.click(screen.getByTestId("user-flow-journeys-more"));
      expect(rows()).toHaveLength(USER_FLOW_JOURNEYS_PAGE_SIZE * 2);

      /* The last page says how many it really holds. */
      expect(screen.getByTestId("user-flow-journeys-more")).toHaveTextContent(
        "Show 5 more",
      );

      fireEvent.click(screen.getByTestId("user-flow-journeys-more"));
      expect(rows()).toHaveLength(MANY.length);
      expect(
        screen.queryByTestId("user-flow-journeys-more"),
      ).not.toBeInTheDocument();
    });

    test("a list that fits offers nothing", () => {
      renderList(MANY.slice(0, USER_FLOW_JOURNEYS_PAGE_SIZE));

      expect(
        screen.queryByTestId("user-flow-journeys-more"),
      ).not.toBeInTheDocument();
    });
  });
});

describe("UserFlowPersonSearch", () => {
  type OnSearch = (identifier: string) => void;

  function renderSearch(): Mock<OnSearch> {
    const onSearch: Mock<OnSearch> = jest.fn<OnSearch>();

    render(<UserFlowPersonSearch onSearch={onSearch} />);

    return onSearch;
  }

  function submit(value: string): void {
    fireEvent.change(screen.getByTestId("user-flow-person-input"), {
      target: { value: value },
    });
    fireEvent.submit(screen.getByTestId("user-flow-person-search"));
  }

  test("asks on Enter, trimmed", () => {
    const onSearch: Mock<OnSearch> = renderSearch();

    submit("  jane@example.com ");

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith("jane@example.com");
  });

  test("typing alone reads nothing", () => {
    const onSearch: Mock<OnSearch> = renderSearch();

    fireEvent.change(screen.getByTestId("user-flow-person-input"), {
      target: { value: "jane" },
    });

    expect(onSearch).not.toHaveBeenCalled();
  });

  test("a blank value asks nothing", () => {
    const onSearch: Mock<OnSearch> = renderSearch();

    submit("   ");

    expect(onSearch).not.toHaveBeenCalled();
  });

  test("has a name for a screen reader", () => {
    renderSearch();

    expect(
      screen.getByRole("searchbox", { name: "Find a user or session" }),
    ).toBeInTheDocument();
  });
});

describe("UserFlowPersonBar", () => {
  const NAMED: UserFlowPersonDescription = {
    kind: "user",
    value: "jane@example.com",
    title: "Identified by your page as jane@example.com.",
    initials: "JA",
    hue: 120,
  };

  function renderBar(overrides: Partial<BarProps> = {}): void {
    render(
      <MemoryRouter>
        <UserFlowPersonBar
          description={NAMED}
          sessionCount={3}
          view="journeys"
          onViewChange={jest.fn()}
          onClear={jest.fn()}
          sessionListRoute={null}
          {...overrides}
        />
      </MemoryRouter>,
    );
  }

  function nameOn(description: Partial<UserFlowPersonDescription>): string {
    renderBar({ description: { ...NAMED, ...description } });

    return screen.getByTestId("user-flow-person-name").textContent ?? "";
  }

  test.each([
    [{ kind: "user", value: "jane@example.com" }, "jane@example.com"],
    [{ kind: "hidden", value: "Hidden" }, "Hidden user"],
    [{ kind: "visitor", value: "7f3a2b" }, "Visitor 7f3a2b"],
    [{ kind: "session", value: "abcd1234" }, "Session abcd1234"],
    [{ kind: "typed", value: "nobody" }, "nobody"],
    [{ kind: "unknown-user", value: "" }, "This user"],
  ])(
    "calls them what they are: %j",
    (description: Partial<UserFlowPersonDescription>, expected: string) => {
      expect(nameOn(description)).toBe(expected);
    },
  );

  test("counts their sessions, in the singular too", () => {
    renderBar({ sessionCount: 1 });

    expect(screen.getByTestId("user-flow-person-count")).toHaveTextContent(
      "1 session in this range",
    );
  });

  test("before the first answer there is nothing to count", () => {
    renderBar({ sessionCount: null });

    expect(
      screen.queryByTestId("user-flow-person-count"),
    ).not.toBeInTheDocument();
  });

  test("the switch says which view is on, and moves it", () => {
    const onViewChange: Mock<(view: string) => void> =
      jest.fn<(view: string) => void>();

    renderBar({ view: "journeys", onViewChange: onViewChange });

    expect(screen.getByTestId("user-flow-view-journeys")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("user-flow-view-map")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(screen.getByTestId("user-flow-view-map"));

    expect(onViewChange).toHaveBeenCalledWith("map");
  });

  test("All users is the way back", () => {
    const onClear: Mock<() => void> = jest.fn<() => void>();

    renderBar({ onClear: onClear });

    fireEvent.click(screen.getByTestId("user-flow-person-clear"));

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  test("links to the session list only when it can name them", () => {
    renderBar({ sessionListRoute: null });

    expect(
      screen.queryByTestId("user-flow-person-sessions"),
    ).not.toBeInTheDocument();

    cleanup();
    renderBar({
      sessionListRoute: new Route(
        "/dashboard/p/rum/a/session-replay?userKey=k",
      ),
    });

    expect(screen.getByTestId("user-flow-person-sessions")).toHaveAttribute(
      "href",
      "/dashboard/p/rum/a/session-replay?userKey=k",
    );
  });

  test("offers everything this person did only from one session", () => {
    const onShowOwner: Mock<() => void> = jest.fn<() => void>();

    renderBar();
    expect(
      screen.queryByTestId("user-flow-person-owner"),
    ).not.toBeInTheDocument();

    cleanup();
    renderBar({ onShowOwner: onShowOwner });
    fireEvent.click(screen.getByTestId("user-flow-person-owner"));

    expect(onShowOwner).toHaveBeenCalledTimes(1);
  });
});
