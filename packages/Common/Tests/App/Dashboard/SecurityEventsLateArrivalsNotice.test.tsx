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
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * EVENTS THAT ARRIVED TOO LATE FOR THE RULES, as people meet them on
 * Detection Rules (#10491): nothing at all while every event arrives in
 * time; otherwise how many arrived more than a day after they happened in
 * the last week, from which sources and when they happened, and Run on Past
 * Events on a rule the person chooses, over the period that reaches back
 * to them.
 */

const lateMock: MockFunction = getJestMockFunction();
const runMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi",
  () => {
    return {
      __esModule: true,
      default: {
        getLateArrivals: (...args: Array<unknown>) => {
          return lateMock(...args);
        },
        runDetectionRuleRetrohunt: (...args: Array<unknown>) => {
          return runMock(...args);
        },
      },
    };
  },
);

import SecurityEventsLateArrivalsNotice, {
  getLateArrivalSourceName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/LateArrivals/LateArrivalsNotice";
import { LATE_ARRIVALS_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/LateArrivals/LateArrivalsCopy";
import { RETROHUNT_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retrohunt/RetrohuntCopy";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { DetectionRetrohuntResult } from "../../../Types/SecurityEvent/DetectionRetrohunt";
import {
  SecurityEventLateArrivalSource,
  SecurityEventLateArrivals,
} from "../../../Types/SecurityEvent/SecurityEventLateArrival";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

const DAY: number = 24 * 60 * 60 * 1000;

const RULES: Array<{ id: string; name: string }> = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", name: "Failed sign-ins" },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", name: "New admin user" },
];

function source(
  overrides: Partial<SecurityEventLateArrivalSource> = {},
): SecurityEventLateArrivalSource {
  const now: number = Date.now();

  return {
    vendorName: "Okta",
    productName: "Okta Workforce Identity",
    eventCount: 300,
    happenedFrom: new Date(now - 4 * DAY),
    happenedTo: new Date(now - 3 * DAY),
    arrivedFrom: new Date(now - DAY),
    arrivedTo: new Date(now - DAY),
    ...overrides,
  };
}

function late(
  sources: Array<SecurityEventLateArrivalSource>,
): SecurityEventLateArrivals {
  return {
    arrivedSince: new Date(Date.now() - 6 * DAY),
    eventCount: sources.reduce(
      (total: number, item: SecurityEventLateArrivalSource): number => {
        return total + item.eventCount;
      },
      0,
    ),
    sources,
  };
}

const ANSWER: DetectionRetrohuntResult = {
  startTime: new Date("2026-10-20T12:00:00.000Z"),
  endTime: new Date("2026-10-27T12:00:00.000Z"),
  periodInHours: 168,
  retentionInDays: 15,
  keptFrom: null,
  firstSeenHistory: null,
  isCorrelation: false,
  windowInMinutes: 5,
  threshold: 3,
  firedCount: 0,
  groupCount: 0,
  eventCount: 0,
  matchedEventCount: 0,
  exceptionCount: 0,
  skippedEventCount: 0,
  preventedFiredCount: 0,
  groups: [],
  hasMoreGroups: false,
  candidateLimit: null,
  uncounted: null,
  refusedTelemetry: [],
};

let ruleReads: Array<Record<string, unknown>>;
let rules: Array<{ id: string; name: string }>;

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function show(answer: SecurityEventLateArrivals | null): Promise<void> {
  lateMock.mockResolvedValue(answer as never);
  render(<SecurityEventsLateArrivalsNotice />);
  await settle();
}

function notice(): HTMLElement {
  return screen.getByTestId(LATE_ARRIVALS_TEST_IDS.notice);
}

/*
 * Run on Past Events is a dialog: what is outside it is hidden from the
 * accessibility tree, and the picker's menu is drawn over the page. A
 * rule's name is drawn as written, set apart from the words around it.
 */
async function chooseRule(name: RegExp): Promise<void> {
  /*
   * The picker searches the server as it opens (#10646): its search box
   * while nothing is chosen, the chosen rule's button once one is.
   */
  const box: HTMLElement | null = screen.queryByRole("combobox", {
    name: "Rule",
    hidden: true,
  });

  await act(async () => {
    if (box) {
      fireEvent.focus(box);
      return;
    }

    fireEvent.click(
      within(screen.getByTestId("entity-dropdown-value")).getAllByRole(
        "button",
        { hidden: true },
      )[0]!,
    );
  });

  const option: HTMLElement = await screen.findByRole("option", {
    name,
    hidden: true,
  });

  await act(async () => {
    fireEvent.click(option);
  });
  await settle();
}

function sourceLines(): Array<string> {
  return screen
    .queryAllByTestId(LATE_ARRIVALS_TEST_IDS.source)
    .map((line: HTMLElement): string => {
      return line.textContent || "";
    });
}

beforeEach(() => {
  ruleReads = [];
  rules = RULES;
  runMock.mockResolvedValue(ANSWER as never);

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (
    options: Record<string, unknown>,
  ) => {
    ruleReads.push(options);

    const data: Array<DetectionRule> = rules.map(
      (item: { id: string; name: string }): DetectionRule => {
        const rule: DetectionRule = new DetectionRule();
        rule._id = item.id;
        rule.name = item.name;
        return rule;
      },
    );

    return { data, count: data.length, skip: 0, limit: 500 };
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  lateMock.mockReset();
  runMock.mockReset();
});

describe("while every event arrives in time", () => {
  test("there is nothing to see", async () => {
    await show(late([]));

    expect(lateMock).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId(LATE_ARRIVALS_TEST_IDS.notice),
    ).not.toBeInTheDocument();
  });

  test("nor when the count cannot be read: the page is as it was", async () => {
    lateMock.mockRejectedValue(new Error("Forbidden") as never);
    render(<SecurityEventsLateArrivalsNotice />);
    await settle();

    expect(
      screen.queryByTestId(LATE_ARRIVALS_TEST_IDS.notice),
    ).not.toBeInTheDocument();
  });

  test("nor when the answer is not one", async () => {
    await show(null);

    expect(
      screen.queryByTestId(LATE_ARRIVALS_TEST_IDS.notice),
    ).not.toBeInTheDocument();
  });
});

describe("when events arrived more than a day after they happened", () => {
  test("says how many the rules did not check, and why, and what checks them", async () => {
    await show(
      late([
        source(),
        source({
          vendorName: "CrowdStrike",
          productName: "Falcon",
          eventCount: 12,
        }),
      ]),
    );

    expect(notice()).toHaveAttribute("role", "status");
    expect(notice()).toHaveTextContent(
      "Your rules did not check 312 events that arrived late",
    );
    expect(notice()).toHaveTextContent(
      "In the last 7 days, these arrived more than a day after they happened, and a rule's runs read only what arrives within a day of happening. Run on Past Events checks them.",
    );
  });

  test("one event is one", async () => {
    await show(late([source({ eventCount: 1 })]));

    expect(notice()).toHaveTextContent(
      "Your rules did not check 1 event that arrived late",
    );
    expect(sourceLines()[0]).toMatch(
      /^Okta Workforce Identity: 1 event that happened from .+ to .+$/,
    );
  });

  test("each source: its name, how many, and when the earliest and the latest happened", async () => {
    const okta: SecurityEventLateArrivalSource = source();

    await show(late([okta]));

    expect(sourceLines()[0]).toMatch(
      /^Okta Workforce Identity: 300 events that happened from .+ to .+$/,
    );

    const times: Array<HTMLElement> = Array.from(
      screen
        .getByTestId(LATE_ARRIVALS_TEST_IDS.source)
        .querySelectorAll("time"),
    );

    expect(
      times.map((time: HTMLElement): string | null => {
        return time.getAttribute("datetime");
      }),
    ).toEqual([okta.happenedFrom.toISOString(), okta.happenedTo.toISOString()]);
  });

  test("lists the five with the most, and counts the rest", async () => {
    const sources: Array<SecurityEventLateArrivalSource> = [];

    for (let index: number = 0; index < 7; index++) {
      sources.push(
        source({ productName: `Source ${index}`, eventCount: 70 - index }),
      );
    }

    await show(late(sources));

    expect(sourceLines()).toHaveLength(5);
    expect(sourceLines()[0]).toMatch(/^Source 0: 70 events/);
    expect(
      screen.getByTestId(LATE_ARRIVALS_TEST_IDS.moreSources),
    ).toHaveTextContent("2 more sources");
  });

  test("a source is named by its product, else its vendor, else says it has no name", async () => {
    expect(getLateArrivalSourceName(source({ productName: "  " }))).toBe(
      "Okta",
    );
    expect(
      getLateArrivalSourceName(source({ productName: "", vendorName: "" })),
    ).toBeNull();

    await show(late([source({ productName: "", vendorName: "" })]));

    expect(sourceLines()[0]).toMatch(/^Unnamed source: 300 events/);
  });
});

describe("Run on Past Events, from the notice", () => {
  async function openRun(
    happenedFrom: Date = new Date(Date.now() - 4 * DAY),
  ): Promise<HTMLElement> {
    await show(late([source({ happenedFrom })]));

    await act(async () => {
      screen.getByTestId(LATE_ARRIVALS_TEST_IDS.run).click();
    });
    await settle();

    return screen.getByTestId(LATE_ARRIVALS_TEST_IDS.modal);
  }

  test("is the notice's one action", async () => {
    await show(late([source()]));

    expect(
      within(notice()).getByTestId(LATE_ARRIVALS_TEST_IDS.run),
    ).toHaveTextContent("Run on Past Events");
  });

  /*
   * #10646: the dialog read the project's first 500 rules by name, so a
   * rule past them could not be run. It asks whether there is a rule at
   * all, and its picker searches the server as it is typed in.
   */
  test("asks whether there is a rule, searches the rules by name as the picker opens, and runs nothing until one is chosen", async () => {
    await openRun();

    expect(ruleReads).toHaveLength(1);
    expect(ruleReads[0]!["modelType"]).toBe(DetectionRule);
    expect(ruleReads[0]!["limit"]).toBe(1);

    await act(async () => {
      fireEvent.focus(
        screen.getByRole("combobox", { name: "Rule", hidden: true }),
      );
    });

    await screen.findByRole("option", {
      name: /Failed sign-ins/,
      hidden: true,
    });

    const search: Record<string, unknown> = ruleReads[ruleReads.length - 1]!;

    expect(search["modelType"]).toBe(DetectionRule);
    expect(search["select"]).toMatchObject({ _id: true, name: true });
    expect(search["sort"]).toEqual({ name: SortOrder.Ascending });
    expect(search["limit"]).toBe(50);
    expect(runMock).not.toHaveBeenCalled();
  });

  test("runs the chosen rule over the period that reaches back to when they happened", async () => {
    await openRun(new Date(Date.now() - 4 * DAY));

    await chooseRule(/New admin user/);

    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock.mock.calls[0]![0]).toEqual({
      periodInHours: 168,
      detectionRuleId: RULES[1]!.id,
    });
    expect(screen.getByTestId(RETROHUNT_TEST_IDS.panel)).toBeInTheDocument();
  });

  test("older than a week, it runs over the last 30 days", async () => {
    await openRun(new Date(Date.now() - 10 * DAY));

    await chooseRule(/Failed sign-ins/);

    expect(runMock.mock.calls[0]![0]).toEqual({
      periodInHours: 720,
      detectionRuleId: RULES[0]!.id,
    });
  });

  test("another rule chosen runs that one", async () => {
    await openRun();

    for (const name of [/Failed sign-ins/, /New admin user/]) {
      await chooseRule(name);
    }

    expect(
      runMock.mock.calls.map((call: Array<unknown>): unknown => {
        return (call[0] as Record<string, unknown>)["detectionRuleId"];
      }),
    ).toEqual([RULES[0]!.id, RULES[1]!.id]);
  });

  test("says so when there is no rule to run", async () => {
    rules = [];

    await openRun();

    expect(
      screen.getByTestId(LATE_ARRIVALS_TEST_IDS.noRules),
    ).toHaveTextContent("There is no detection rule to run yet.");
  });
});
