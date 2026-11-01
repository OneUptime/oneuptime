import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import { UserFlowJourney } from "../../../Utils/Rum/UserFlow";
import UserFlowJourneys, {
  USER_FLOW_JOURNEYS_PAGE_SIZE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserFlow/UserFlowJourneys";
import { RUM_USER_FLOW_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/RumMetricDescriptions";

/*
 * One person's sessions, a line each. The engine's half - which page is the
 * landing, the exit, a return - is pinned in Tests/Utils/Rum/UserFlow.test.ts;
 * this is what the page says about them.
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

const APP_ID: ObjectID = new ObjectID("0193c0de-1111-4aaa-8bbb-000000000002");

function journey(overrides: Partial<UserFlowJourney> = {}): UserFlowJourney {
  return {
    sessionId: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    startUnixMs: 1_800_000_000_000,
    durationMs: 75_000,
    deviceType: "desktop",
    browserName: "Chrome",
    countryCode: "DK",
    pages: ["/", "/cart"],
    errorPages: new Set<string>(),
    frustrationPages: new Set<string>(),
    hadErrors: false,
    hadFrustration: false,
    errorCount: 0,
    frustrationCount: 0,
    isTruncated: false,
    hasRecording: true,
    ...overrides,
  };
}

function many(count: number): Array<UserFlowJourney> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return journey({ sessionId: `session-${index}` });
  });
}

function renderJourneys(
  journeys: Array<UserFlowJourney>,
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <UserFlowJourneys journeys={journeys} rumApplicationId={APP_ID} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("a line of the list", () => {
  test("says when, how long and on what", () => {
    renderJourneys([journey()]);

    expect(screen.getByTestId("user-flow-journey-facts")).toHaveTextContent(
      "1m 15s · Chrome · desktop · DK",
    );
    expect(screen.getByTestId("user-flow-journey-start").textContent).toMatch(
      /2027/,
    );
  });

  test("leaves out a fact it does not have, and leaves no stray separator", () => {
    renderJourneys([journey({ browserName: "", countryCode: "" })]);

    expect(screen.getByTestId("user-flow-journey-facts").textContent).toBe(
      "1m 15s · desktop",
    );
  });

  test("counts problems in the plural a reader expects", () => {
    renderJourneys([
      journey({ sessionId: "one", errorCount: 1, frustrationCount: 1 }),
      journey({ sessionId: "two", errorCount: 2, frustrationCount: 2 }),
    ]);

    expect(
      screen
        .getAllByTestId("user-flow-journey-errors")
        .map((element: HTMLElement): string | null => {
          return element.textContent;
        }),
    ).toEqual(["1 error", "2 errors"]);
    expect(
      screen
        .getAllByTestId("user-flow-journey-frustration")
        .map((element: HTMLElement): string | null => {
          return element.textContent;
        }),
    ).toEqual(["1 frustration signal", "2 frustration signals"]);
  });

  test("a clean session has no problem lines", () => {
    renderJourneys([journey()]);

    expect(screen.queryByTestId("user-flow-journey-errors")).toBeNull();
    expect(screen.queryByTestId("user-flow-journey-frustration")).toBeNull();
  });

  test("says why a page is marked, for whoever points at it", () => {
    renderJourneys([
      journey({
        pages: ["/cart", "/pay", "/cart"],
        errorPages: new Set<string>(["/pay"]),
        frustrationPages: new Set<string>(["/cart"]),
      }),
    ]);

    const steps: Array<HTMLElement> = screen.getAllByTestId(
      "user-flow-journey-step",
    );

    expect(steps[0]?.querySelector("[title]")).toHaveAttribute(
      "title",
      expect.stringContaining("Landed here"),
    );
    expect(steps[1]?.querySelector("[title]")).toHaveAttribute(
      "title",
      expect.stringContaining("Hit an error on this page"),
    );
    expect(steps[2]?.querySelector("[title]")).toHaveAttribute(
      "title",
      expect.stringContaining("Visit 2 to this page"),
    );
    expect(steps[2]?.querySelector("[title]")).toHaveAttribute(
      "title",
      expect.stringContaining("Left the application here"),
    );
  });

  test("a long page name is the whole of its title, however it is cut on screen", () => {
    const page: string = `/reports/${"inventory-variance/".repeat(8)}detail`;

    renderJourneys([journey({ pages: [page] })]);

    expect(
      screen
        .getByTestId("user-flow-journey-step")
        .querySelector("[title]")
        ?.getAttribute("title"),
    ).toContain(page);
  });

  test("reads the pages as an ordered list", () => {
    renderJourneys([journey()]);

    expect(
      within(screen.getByRole("list", { name: "Pages visited, in order" }))
        .getAllByRole("listitem")
        .map((item: HTMLElement): string | null => {
          return item.getAttribute("data-page");
        }),
    ).toEqual(["/", "/cart"]);
  });
});

describe("the link to the recording", () => {
  test("goes to the session's replay when there is footage", () => {
    renderJourneys([journey()]);

    expect(
      screen.getByTestId("user-flow-journey-watch").getAttribute("href"),
    ).toContain(`/${APP_ID.toString()}/session-replay/a1b2c3d4`);
    expect(screen.queryByTestId("user-flow-journey-no-recording")).toBeNull();
  });

  test("is replaced by a plain word when there is none", () => {
    renderJourneys([journey({ hasRecording: false })]);

    expect(screen.queryByTestId("user-flow-journey-watch")).toBeNull();
    expect(
      screen.getByTestId("user-flow-journey-no-recording"),
    ).toHaveTextContent("No recording");
  });

  test("is offered when the server did not say, and the player can explain", () => {
    renderJourneys([journey({ hasRecording: undefined })]);

    expect(screen.getByTestId("user-flow-journey-watch")).toBeInTheDocument();
  });
});

describe("the list", () => {
  test("counts its sessions, in the singular too", () => {
    renderJourneys([journey()]);

    expect(screen.getByTestId("user-flow-journeys-count")).toHaveTextContent(
      "1 session",
    );
  });

  test("explains itself beside its title", () => {
    renderJourneys([journey()]);

    expect(screen.getByTestId("user-flow-journeys-info")).toBeInTheDocument();
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.journeys).toContain(
      "a return within one recording chunk (about 15 seconds) is missed",
    );
  });

  test("says so when the filters leave nothing", () => {
    renderJourneys([]);

    expect(screen.getByTestId("user-flow-journeys-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("user-flow-journeys-more")).toBeNull();
  });

  test("a page of rows needs no Show more", () => {
    renderJourneys(many(USER_FLOW_JOURNEYS_PAGE_SIZE));

    expect(screen.getAllByTestId("user-flow-journey")).toHaveLength(
      USER_FLOW_JOURNEYS_PAGE_SIZE,
    );
    expect(screen.queryByTestId("user-flow-journeys-more")).toBeNull();
  });

  test("a kiosk's thousands are drawn a page at a time", () => {
    renderJourneys(many(USER_FLOW_JOURNEYS_PAGE_SIZE * 2 + 5));

    expect(screen.getAllByTestId("user-flow-journey")).toHaveLength(
      USER_FLOW_JOURNEYS_PAGE_SIZE,
    );
    expect(screen.getByTestId("user-flow-journeys-more")).toHaveTextContent(
      `Show more (${USER_FLOW_JOURNEYS_PAGE_SIZE + 5} left)`,
    );

    fireEvent.click(screen.getByTestId("user-flow-journeys-more"));

    expect(screen.getAllByTestId("user-flow-journey")).toHaveLength(
      USER_FLOW_JOURNEYS_PAGE_SIZE * 2,
    );

    fireEvent.click(screen.getByTestId("user-flow-journeys-more"));

    expect(screen.getAllByTestId("user-flow-journey")).toHaveLength(
      USER_FLOW_JOURNEYS_PAGE_SIZE * 2 + 5,
    );
    expect(screen.queryByTestId("user-flow-journeys-more")).toBeNull();
  });

  test("a new set of journeys starts from the top again", () => {
    const view: ReturnType<typeof render> = renderJourneys(
      many(USER_FLOW_JOURNEYS_PAGE_SIZE * 2),
    );

    fireEvent.click(screen.getByTestId("user-flow-journeys-more"));

    expect(screen.getAllByTestId("user-flow-journey")).toHaveLength(
      USER_FLOW_JOURNEYS_PAGE_SIZE * 2,
    );

    view.rerender(
      <MemoryRouter>
        <UserFlowJourneys
          journeys={many(USER_FLOW_JOURNEYS_PAGE_SIZE * 2)}
          rumApplicationId={APP_ID}
        />
      </MemoryRouter>,
    );

    expect(screen.getAllByTestId("user-flow-journey")).toHaveLength(
      USER_FLOW_JOURNEYS_PAGE_SIZE,
    );
  });
});
