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
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * WHAT A DETECTION RULE COULD NOT COUNT, ON ITS ROW (#10547).
 *
 * A rule that counts per value - a Group By Field with a threshold above 1,
 * or a Distinct Count Field - leaves out the matching events that have no
 * value for its field. Detection Rules asks the server, once for the rules
 * a page lists, what each left out in the last day, and says it under the
 * rule's name, in amber: how many it could not count, or, when that is all
 * it matched, that it could count none - and then its Status says Needs
 * attention. The line opens a dialog in Run on Past Events' own words: how
 * many had no value, how many of those a scrub rule hid, with Open Scrub
 * Rules, whether it can fire at all, and why such events are left out; its
 * button opens Run on Past Events for the whole picture.
 *
 * The page is rendered for real with its table mocked to capture the
 * columns (as SecurityEventsDetectionRulesPage.test.tsx does), so a cell is
 * drawn as the table would draw it; the network is stubbed.
 */

type ElementColumn = {
  title: string;
  getElement?: (item: unknown) => React.ReactElement;
};

type CapturedTableProps = {
  columns: Array<ElementColumn>;
  onFetchSuccess?:
    | ((data: Array<unknown>, totalCount: number) => void)
    | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retention/UseSecurityEventRetention",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return React.createElement("div", {
        "data-testid": "detection-rules-table",
      });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/LateArrivals/LateArrivalsNotice",
  () => {
    return {
      __esModule: true,
      default: () => {
        return React.createElement("div", {
          "data-testid": "late-arrivals-notice-marker",
        });
      },
    };
  },
);

import DetectionRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/DetectionRules";
import {
  UNCOUNTED_DIALOG_DESCRIPTION,
  UNCOUNTED_NOTHING_CANT_FIRE,
  UNCOUNTED_ROW_LINE,
  UNCOUNTED_ROW_LINE_NOTHING,
  UNCOUNTED_TEST_IDS,
  UNCOUNTED_WHY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Uncounted/DetectionRuleUncountedCopy";
import {
  UncountedDetail,
  UncountedRowLine,
  fetchDetectionRulesUncounted,
  getUncountedDetail,
  getUncountedRowLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Uncounted/DetectionRuleUncountedModel";
import {
  RUN_ON_PAST_EVENTS,
  UNCOUNTED_HIDDEN_BY_SCRUB_RULE,
  UNCOUNTED_NO_IP_ADDRESS,
  UNCOUNTED_NO_VALUE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retrohunt/RetrohuntCopy";
import SecurityCaseApi from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { parseDetectionRetrohuntResult } from "../../../Types/SecurityEvent/DetectionRetrohunt";
import {
  DETECTION_RULE_UNCOUNTED_PATH,
  DetectionRuleUncounted,
  MAX_DETECTION_RULES_UNCOUNTED_PER_ASK,
  detectionRulesUncountedToJSON,
} from "../../../Types/SecurityEvent/DetectionRuleUncounted";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

// Three rules on the page: one left some out, one left out all, one none.
const SOME_LEFT_OUT: string = "22222222-2222-4222-8222-222222222222";
const ALL_LEFT_OUT: string = "22222222-2222-4222-8222-222222222223";
const NONE_LEFT_OUT: string = "22222222-2222-4222-8222-222222222224";

const NAMES: Record<string, string> = {
  [SOME_LEFT_OUT]: "Failed logon burst",
  [ALL_LEFT_OUT]: "Password spray",
  [NONE_LEFT_OUT]: "Port scan",
};

function uncounted(
  detectionRuleId: string,
  values: Partial<DetectionRuleUncounted>,
): DetectionRuleUncounted {
  return {
    detectionRuleId,
    field: "principalIp",
    matchedCount: 0,
    uncountedCount: 0,
    hiddenInLogsCount: 0,
    hiddenInTracesCount: 0,
    ...values,
  };
}

// What the server says the rules left out: a rule it does not name left out none.
const ANSWER: Array<DetectionRuleUncounted> = [
  uncounted(SOME_LEFT_OUT, {
    matchedCount: 40,
    uncountedCount: 3,
    hiddenInLogsCount: 2,
  }),
  uncounted(ALL_LEFT_OUT, {
    matchedCount: 5,
    uncountedCount: 5,
    hiddenInTracesCount: 4,
  }),
];

let answer: JSONObject | HTTPErrorResponse = {};
let asked: Array<JSONObject> = [];

function fill(template: string, values: Record<string, string>): string {
  let text: string = template;

  for (const [key, value] of Object.entries(values)) {
    text = text.split(`{{${key}}}`).join(value);
  }

  return text;
}

function ruleOf(id: string): DetectionRule {
  const rule: DetectionRule = new DetectionRule();

  rule._id = id;
  rule.name = NAMES[id] || "";
  rule.isEnabled = true;
  rule.lastEvaluatedAt = new Date("2026-11-24T10:00:00.000Z");
  rule.groupByField = "principalIp";

  return rule;
}

beforeEach(() => {
  capturedTableProps = null;
  answer = detectionRulesUncountedToJSON({ periodInHours: 24, rules: ANSWER });
  asked = [];

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  // The count of each rule's exceptions: none.
  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 0,
  } as never);
  jest.spyOn(API, "post").mockImplementation((async (args: {
    url: { toString: () => string };
    data: JSONObject;
  }): Promise<never> => {
    if (args.url.toString().endsWith(DETECTION_RULE_UNCOUNTED_PATH)) {
      asked.push(args.data);

      if (answer instanceof HTTPErrorResponse) {
        return answer as unknown as never;
      }

      return new HTTPResponse<JSONObject>(200, answer, {}) as unknown as never;
    }

    return new HTTPResponse<JSONObject>(200, {}, {}) as unknown as never;
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 6; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

// The page, having listed the three rules, once it has heard what they left out.
async function renderPage(): Promise<void> {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  render(
    <MemoryRouter>
      <DetectionRulesPage
        pageRoute={new Route("/dashboard/security-events/detection-rules")}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  expect(capturedTableProps).not.toBeNull();

  act(() => {
    capturedTableProps!.onFetchSuccess!(
      [SOME_LEFT_OUT, ALL_LEFT_OUT, NONE_LEFT_OUT].map(ruleOf),
      3,
    );
  });

  await waitFor(() => {
    expect(asked.length).toBeGreaterThan(0);
  });
  await settle();
}

function column(title: string): ElementColumn {
  const found: ElementColumn | undefined = capturedTableProps!.columns.find(
    (candidate: ElementColumn): boolean => {
      return candidate.title === title;
    },
  );

  expect(found?.getElement).toBeDefined();

  return found!;
}

// A rule's Name cell, drawn as the table draws it.
function nameCell(id: string): HTMLElement {
  return render(column("Name").getElement!(ruleOf(id))).container;
}

function statusCell(id: string): HTMLElement {
  return render(column("Status").getElement!(ruleOf(id))).container;
}

async function openLine(id: string): Promise<HTMLElement> {
  fireEvent.click(within(nameCell(id)).getByTestId(UNCOUNTED_TEST_IDS.rowLine));

  return await screen.findByTestId(UNCOUNTED_TEST_IDS.dialog);
}

describe("what a rule could not count, as its row says it", () => {
  test("asks once, for the rules the page lists", async () => {
    await renderPage();

    expect(asked).toEqual([
      {
        detectionRuleIds: expect.arrayContaining([
          SOME_LEFT_OUT,
          ALL_LEFT_OUT,
          NONE_LEFT_OUT,
        ]),
      },
    ]);
    expect((asked[0]!["detectionRuleIds"] as Array<string>).length).toBe(3);
  });

  test("a rule that left some out says how many, under its name", async () => {
    await renderPage();

    const line: HTMLElement = within(nameCell(SOME_LEFT_OUT)).getByTestId(
      UNCOUNTED_TEST_IDS.rowLine,
    );

    expect(line).toHaveTextContent(
      fill(UNCOUNTED_ROW_LINE.other, { count: "3" }),
    );
    // A button: it opens why.
    expect(line.tagName).toBe("BUTTON");
    expect(line).toHaveAttribute("type", "button");
    // Still a rule that fires: its Status is as before.
    expect(statusCell(SOME_LEFT_OUT)).toHaveTextContent("Enabled");
    expect(statusCell(SOME_LEFT_OUT)).not.toHaveTextContent("Needs attention");
  });

  test("a rule that could count none of what it matched says so, and its Status needs attention", async () => {
    await renderPage();

    expect(
      within(nameCell(ALL_LEFT_OUT)).getByTestId(UNCOUNTED_TEST_IDS.rowLine),
    ).toHaveTextContent(fill(UNCOUNTED_ROW_LINE_NOTHING.other, { count: "5" }));
    expect(statusCell(ALL_LEFT_OUT)).toHaveTextContent("Needs attention");
  });

  test("a rule that left nothing out has no line, and its Status is as before", async () => {
    await renderPage();

    expect(
      within(nameCell(NONE_LEFT_OUT)).queryByTestId(UNCOUNTED_TEST_IDS.rowLine),
    ).toBeNull();
    expect(nameCell(NONE_LEFT_OUT)).toHaveTextContent("Port scan");
    expect(statusCell(NONE_LEFT_OUT)).toHaveTextContent("Enabled");
  });

  test("one event is said in the singular", async () => {
    answer = detectionRulesUncountedToJSON({
      periodInHours: 24,
      rules: [
        uncounted(SOME_LEFT_OUT, { matchedCount: 9, uncountedCount: 1 }),
        uncounted(ALL_LEFT_OUT, { matchedCount: 1, uncountedCount: 1 }),
      ],
    });

    await renderPage();

    expect(
      within(nameCell(SOME_LEFT_OUT)).getByTestId(UNCOUNTED_TEST_IDS.rowLine),
    ).toHaveTextContent(fill(UNCOUNTED_ROW_LINE.one, { count: "1" }));
    expect(
      within(nameCell(ALL_LEFT_OUT)).getByTestId(UNCOUNTED_TEST_IDS.rowLine),
    ).toHaveTextContent(fill(UNCOUNTED_ROW_LINE_NOTHING.one, { count: "1" }));
  });

  test("a read that fails shows no line and changes no Status: the rules are what the page is for", async () => {
    answer = new HTTPErrorResponse(500, { message: "ClickHouse is down" }, {});

    await renderPage();

    for (const id of [SOME_LEFT_OUT, ALL_LEFT_OUT, NONE_LEFT_OUT]) {
      expect(
        within(nameCell(id)).queryByTestId(UNCOUNTED_TEST_IDS.rowLine),
      ).toBeNull();
      expect(statusCell(id)).not.toHaveTextContent("Needs attention");
    }
    expect(screen.queryByText("ClickHouse is down")).toBeNull();
  });

  test("the line opens why: how many had no address, how many a scrub rule hid, with Open Scrub Rules", async () => {
    await renderPage();

    const body: HTMLElement = await openLine(SOME_LEFT_OUT);
    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(dialog).toHaveTextContent("Failed logon burst");
    expect(dialog).toHaveTextContent(UNCOUNTED_DIALOG_DESCRIPTION);
    expect(body).toHaveTextContent(
      fill(UNCOUNTED_NO_IP_ADDRESS.other, { count: "3" }),
    );
    expect(body).toHaveTextContent(
      fill(UNCOUNTED_HIDDEN_BY_SCRUB_RULE.other, { count: "2" }),
    );
    expect(body).toHaveTextContent(UNCOUNTED_WHY);
    // It still fires on what it could count.
    expect(body).not.toHaveTextContent(UNCOUNTED_NOTHING_CANT_FIRE);

    // Hidden in logs: the logs' scrub rules.
    const link: HTMLElement = within(body).getByTestId(
      UNCOUNTED_TEST_IDS.scrubRulesLink,
    );

    expect(link).toHaveTextContent("Open Scrub Rules");
    expect(link.closest("a")?.getAttribute("href") || "").toMatch(
      /logs.*scrub/i,
    );
  });

  test("for a rule that counted none it says plainly it can't fire; hidden in traces, the link is the traces' rules", async () => {
    await renderPage();

    const body: HTMLElement = await openLine(ALL_LEFT_OUT);

    expect(screen.getByRole("dialog")).toHaveTextContent("Password spray");
    expect(body).toHaveTextContent(
      fill(UNCOUNTED_NO_IP_ADDRESS.other, { count: "5" }),
    );
    expect(body).toHaveTextContent(UNCOUNTED_NOTHING_CANT_FIRE);
    expect(body).toHaveTextContent(UNCOUNTED_WHY);
    expect(
      within(body)
        .getByTestId(UNCOUNTED_TEST_IDS.scrubRulesLink)
        .closest("a")
        ?.getAttribute("href") || "",
    ).toMatch(/traces.*scrub/i);
  });

  test("with nothing hidden by a scrub rule, there is no scrub rule to open", async () => {
    answer = detectionRulesUncountedToJSON({
      periodInHours: 24,
      rules: [
        uncounted(SOME_LEFT_OUT, { matchedCount: 40, uncountedCount: 3 }),
      ],
    });

    await renderPage();

    const body: HTMLElement = await openLine(SOME_LEFT_OUT);

    expect(body).toHaveTextContent(
      fill(UNCOUNTED_NO_IP_ADDRESS.other, { count: "3" }),
    );
    expect(body).not.toHaveTextContent(
      fill(UNCOUNTED_HIDDEN_BY_SCRUB_RULE.other, { count: "0" }),
    );
    expect(
      within(body).queryByTestId(UNCOUNTED_TEST_IDS.scrubRulesLink),
    ).toBeNull();
  });

  test("Close closes it; Run on Past Events opens the rule's run", async () => {
    const run: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityCaseApi, "runDetectionRuleRetrohunt")
      .mockResolvedValue(
        parseDetectionRetrohuntResult({ firedCount: 0 }) as never,
      );

    await renderPage();

    await openLine(SOME_LEFT_OUT);

    const close: HTMLElement = within(screen.getByRole("dialog")).getByTestId(
      "modal-footer-close-button",
    );

    expect(close).toHaveTextContent("Close");
    fireEvent.click(close);
    await waitFor(() => {
      expect(screen.queryByTestId(UNCOUNTED_TEST_IDS.dialog)).toBeNull();
    });

    await openLine(SOME_LEFT_OUT);

    const runButton: HTMLElement = within(
      screen.getByRole("dialog"),
    ).getByTestId("modal-footer-submit-button");

    expect(runButton).toHaveTextContent(RUN_ON_PAST_EVENTS);
    fireEvent.click(runButton);

    await waitFor(() => {
      expect(run).toHaveBeenCalledWith({
        periodInHours: 168,
        detectionRuleId: SOME_LEFT_OUT,
      });
    });
    expect(screen.queryByTestId(UNCOUNTED_TEST_IDS.dialog)).toBeNull();
    expect(screen.getByRole("dialog")).toHaveTextContent(RUN_ON_PAST_EVENTS);
  });
});

describe("the words a rule's row and dialog take, from its counts", () => {
  test("some left out: the count left out, as a line to look at", () => {
    const line: UncountedRowLine = getUncountedRowLine(
      uncounted(SOME_LEFT_OUT, { matchedCount: 40, uncountedCount: 3 }),
    );

    expect(line).toEqual({
      template: UNCOUNTED_ROW_LINE,
      count: 3,
      countsNothing: false,
    });
  });

  test("all left out: the count it matched, and that it counted none", () => {
    for (const matchedCount of [5, 4]) {
      // More left out than matched is a count read in two moments: still all of it.
      expect(
        getUncountedRowLine(
          uncounted(ALL_LEFT_OUT, { matchedCount, uncountedCount: 5 }),
        ),
      ).toEqual({
        template: UNCOUNTED_ROW_LINE_NOTHING,
        count: matchedCount,
        countsNothing: true,
      });
    }
  });

  test("the dialog says Run on Past Events' sentences, then whether it can fire, then why", () => {
    const some: UncountedDetail = getUncountedDetail(
      uncounted(SOME_LEFT_OUT, {
        matchedCount: 40,
        uncountedCount: 3,
        hiddenInLogsCount: 1,
        hiddenInTracesCount: 1,
      }),
    );

    expect(some.lines).toEqual([
      { template: UNCOUNTED_NO_IP_ADDRESS, count: 3, values: {} },
      { template: UNCOUNTED_HIDDEN_BY_SCRUB_RULE, count: 2 },
    ]);
    // As many in traces as in logs: the logs' rules, where most scrubbing is.
    expect(some.scrubRulesSignal).toBe("log");
    expect(some.afterLines).toEqual([UNCOUNTED_WHY]);

    const none: UncountedDetail = getUncountedDetail(
      uncounted(ALL_LEFT_OUT, {
        matchedCount: 5,
        uncountedCount: 5,
        hiddenInTracesCount: 5,
      }),
    );

    expect(none.scrubRulesSignal).toBe("trace");
    expect(none.afterLines).toEqual([
      UNCOUNTED_NOTHING_CANT_FIRE,
      UNCOUNTED_WHY,
    ]);
  });

  test("a field that names no address, user or host is named in the sentence", () => {
    const detail: UncountedDetail = getUncountedDetail(
      uncounted(SOME_LEFT_OUT, {
        field: "http.route",
        matchedCount: 12,
        uncountedCount: 7,
      }),
    );

    expect(detail.lines).toEqual([
      {
        template: UNCOUNTED_NO_VALUE,
        count: 7,
        values: { field: "http.route" },
      },
    ]);
    expect(detail.scrubRulesSignal).toBeNull();
  });
});

describe("asking the server", () => {
  test("asks for each rule once, at most a page of them, and nothing for none", async () => {
    const ids: Array<string> = [];

    for (
      let i: number = 0;
      i < MAX_DETECTION_RULES_UNCOUNTED_PER_ASK + 10;
      i++
    ) {
      ids.push(ObjectID.generate().toString());
    }

    await fetchDetectionRulesUncounted([...ids, ids[0]!, ids[1]!]);

    expect(asked).toHaveLength(1);

    const sent: Array<string> = asked[0]!["detectionRuleIds"] as Array<string>;

    expect(sent).toEqual(ids.slice(0, MAX_DETECTION_RULES_UNCOUNTED_PER_ASK));

    asked = [];
    expect((await fetchDetectionRulesUncounted([])).size).toBe(0);
    expect(asked).toEqual([]);
  });

  test("reads the answer by rule, and throws what the server refused", async () => {
    const read: Map<string, DetectionRuleUncounted> =
      await fetchDetectionRulesUncounted([SOME_LEFT_OUT, ALL_LEFT_OUT]);

    expect([...read.keys()].sort()).toEqual(
      [SOME_LEFT_OUT, ALL_LEFT_OUT].sort(),
    );
    expect(read.get(SOME_LEFT_OUT)).toEqual(ANSWER[0]);

    answer = new HTTPErrorResponse(
      400,
      { message: "Ask about at most 50 detection rules at a time." },
      {},
    );

    await expect(
      fetchDetectionRulesUncounted([SOME_LEFT_OUT]),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });
});
