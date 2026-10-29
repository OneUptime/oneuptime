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
 * RUN ON PAST EVENTS, as people meet it: under the Detection Rules form's
 * YAML (the rule as it stands, new or changed) and from a rule's row (the
 * rule as saved). It runs as soon as it is shown, over the last 7 days, and
 * again on another period or Run again; it says how often the rule would
 * have fired, for whom, how busy that is, what its exceptions did, and what
 * it fired for - and what went wrong when the run could not be made.
 */

const runMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi",
  () => {
    return {
      __esModule: true,
      default: {
        runDetectionRuleRetrohunt: (...args: Array<unknown>) => {
          return runMock(...args);
        },
      },
    };
  },
);

import DetectionRuleRetrohuntPanel from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retrohunt/DetectionRuleRetrohuntPanel";
import DetectionRuleRetrohuntInForm from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retrohunt/DetectionRuleRetrohuntInForm";
import DetectionRuleRetrohuntModal from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retrohunt/DetectionRuleRetrohuntModal";
import { RETROHUNT_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retrohunt/RetrohuntCopy";
import {
  RetrohuntRuleInput,
  buildRetrohuntRequest,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retrohunt/RetrohuntModel";
import { JSONObject } from "../../../Types/JSON";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  DetectionRetrohuntGroup,
  DetectionRetrohuntResult,
} from "../../../Types/SecurityEvent/DetectionRetrohunt";

const RULE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

function group(value: string, firedCount: number): DetectionRetrohuntGroup {
  return {
    value,
    entityType: value ? SecurityEntityType.User : "",
    firedCount,
    eventCount: firedCount * 3,
    firstFiredAt: new Date("2026-10-21T03:05:00.000Z"),
    lastFiredAt: new Date("2026-10-26T03:05:00.000Z"),
    sampleMessage: "",
    summary: "",
  };
}

function answer(
  overrides: Partial<DetectionRetrohuntResult> = {},
): DetectionRetrohuntResult {
  return {
    startTime: new Date("2026-10-20T12:00:00.000Z"),
    endTime: new Date("2026-10-27T12:00:00.000Z"),
    periodInHours: 168,
    isCorrelation: false,
    windowInMinutes: 5,
    threshold: 3,
    firedCount: 42,
    groupCount: 3,
    eventCount: 126,
    matchedEventCount: 1204,
    exceptionCount: 0,
    skippedEventCount: 0,
    preventedFiredCount: 0,
    groups: [group("alice", 30), group("bob", 10), group("carol", 2)],
    hasMoreGroups: false,
    candidateLimit: null,
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function requests(): Array<JSONObject> {
  return runMock.mock.calls.map((call: Array<unknown>): JSONObject => {
    return call[0] as JSONObject;
  });
}

async function drawPanel(
  getRequest: (periodInHours: number) => JSONObject = (
    periodInHours: number,
  ): JSONObject => {
    return buildRetrohuntRequest({ detectionRuleId: RULE_ID }, periodInHours);
  },
): Promise<void> {
  render(<DetectionRuleRetrohuntPanel getRequest={getRequest} />);
  await settle();
}

describe("Run on Past Events", () => {
  beforeEach(() => {
    runMock.mockReset();
    runMock.mockResolvedValue(answer() as never);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("the answer", () => {
    test("runs as soon as it is shown, over the last 7 days", async () => {
      await drawPanel();

      expect(requests()).toEqual([
        { periodInHours: 168, detectionRuleId: RULE_ID },
      ]);
      expect(
        screen.getByTestId(`${RETROHUNT_TEST_IDS.period}-168`),
      ).toHaveAttribute("aria-checked", "true");
    });

    test("says how often it would have fired, how busy that is, for whom and out of how many events", async () => {
      await drawPanel();

      expect(screen.getByTestId(RETROHUNT_TEST_IDS.summary)).toHaveTextContent(
        "Would have fired 42 times",
      );
      expect(screen.getByTestId(RETROHUNT_TEST_IDS.facts)).toHaveTextContent(
        "6 a day · for 3 users · 1,204 matching events",
      );
      expect(screen.queryByTestId(RETROHUNT_TEST_IDS.noisy)).toBeNull();
      expect(screen.queryByTestId(RETROHUNT_TEST_IDS.exceptions)).toBeNull();
    });

    test("one firing reads in the singular", async () => {
      runMock.mockResolvedValue(
        answer({
          firedCount: 1,
          groupCount: 1,
          matchedEventCount: 1,
          groups: [group("alice", 1)],
        }) as never,
      );

      await drawPanel();

      expect(screen.getByTestId(RETROHUNT_TEST_IDS.summary)).toHaveTextContent(
        "Would have fired 1 time",
      );
      expect(screen.getByTestId(RETROHUNT_TEST_IDS.facts)).toHaveTextContent(
        "for 1 user · 1 matching event",
      );
    });

    test("lists what it fired for, the most first, with times, events and when last", async () => {
      await drawPanel();

      const rows: Array<HTMLElement> = screen.getAllByTestId(
        RETROHUNT_TEST_IDS.group,
      );

      expect(rows).toHaveLength(3);
      expect(rows[0]).toHaveTextContent("alice");
      // A value as written, in the mono type, on its own isolate.
      expect(within(rows[0]!).getByText("alice").tagName).toBe("BDI");
      expect(within(rows[0]!).getByText("alice").className).toContain(
        "font-mono",
      );
      expect(within(rows[0]!).getAllByRole("cell")[1]).toHaveTextContent("30");
      expect(within(rows[0]!).getAllByRole("cell")[2]).toHaveTextContent("90");

      const header: HTMLElement = screen.getByTestId(RETROHUNT_TEST_IDS.groups);

      expect(within(header).getByText("Fired for")).toBeInTheDocument();
      expect(within(header).getByText("Times")).toBeInTheDocument();
      expect(within(header).getByText("Events")).toBeInTheDocument();
      expect(within(header).getByText("Last fired")).toBeInTheDocument();
    });

    test("a long value breaks after its own dots, not at the letter that fills the column", async () => {
      runMock.mockResolvedValue(
        answer({
          groupCount: 1,
          groups: [group("svc-backup.corp.acme-commerce.example", 4)],
        }) as never,
      );

      await drawPanel();

      const value: HTMLElement = within(
        screen.getByTestId(RETROHUNT_TEST_IDS.group),
      ).getByText((_content: string, element: Element | null): boolean => {
        return (
          element?.tagName === "BDI" &&
          element.textContent === "svc-backup.corp.acme-commerce.example"
        );
      });

      // "svc-backup." / "corp." / "acme-commerce." / "example".
      expect(value.querySelectorAll("wbr")).toHaveLength(3);
      expect(value.className).toContain("font-mono");
      expect(value.parentElement!.className).toContain(
        "[overflow-wrap:anywhere]",
      );
      expect(value.parentElement!.className).not.toContain("break-all");
    });

    test("a rule that groups nothing fires for Every match, with no count of groups", async () => {
      runMock.mockResolvedValue(
        answer({ groupCount: 1, groups: [group("", 42)] }) as never,
      );

      await drawPanel();

      expect(screen.getByTestId(RETROHUNT_TEST_IDS.group)).toHaveTextContent(
        "Every match",
      );
      expect(
        screen.getByTestId(RETROHUNT_TEST_IDS.facts),
      ).not.toHaveTextContent("group");
    });

    test("more than 20 a day says how to make the rule quieter", async () => {
      runMock.mockResolvedValue(answer({ firedCount: 141 }) as never);

      await drawPanel();

      expect(screen.getByTestId(RETROHUNT_TEST_IDS.noisy)).toHaveTextContent(
        "That is more than 20 a day, more than a person can look at. Raise the Match Count Threshold, group by another field, or add exceptions for what you expect.",
      );
    });

    test("says what the rule's exceptions skipped, and the firings they prevented", async () => {
      runMock.mockResolvedValue(
        answer({
          exceptionCount: 2,
          skippedEventCount: 310,
          preventedFiredCount: 12,
        }) as never,
      );

      const consoleError: ReturnType<typeof jest.fn> = jest.fn();

      jest.spyOn(console, "error").mockImplementation(consoleError as never);

      await drawPanel();

      expect(
        screen.getByTestId(RETROHUNT_TEST_IDS.exceptions),
      ).toHaveTextContent(
        "Its exceptions skipped 310 matching events. Without them, it would have fired 12 more times.",
      );
      /*
       * Its mark is an Icon, which draws a div: in a div, not a paragraph,
       * so React has no nesting to warn about.
       */
      expect(screen.getByTestId(RETROHUNT_TEST_IDS.exceptions).tagName).toBe(
        "DIV",
      );
      expect(
        consoleError.mock.calls.filter((call: Array<unknown>): boolean => {
          return call.some((arg: unknown): boolean => {
            return String(arg).includes("validateDOMNesting");
          });
        }),
      ).toEqual([]);
    });

    test("would not have fired: how close it came", async () => {
      runMock.mockResolvedValue(
        answer({
          firedCount: 0,
          groupCount: 0,
          groups: [],
          matchedEventCount: 12,
          threshold: 5,
        }) as never,
      );

      await drawPanel();

      expect(screen.getByTestId(RETROHUNT_TEST_IDS.summary)).toHaveTextContent(
        "Would not have fired",
      );
      expect(screen.getByTestId(RETROHUNT_TEST_IDS.facts)).toHaveTextContent(
        "12 matching events, but no group reached the Match Count Threshold of 5 within one run.",
      );
      expect(screen.queryByTestId(RETROHUNT_TEST_IDS.groups)).toBeNull();
    });

    test("a correlation says what happened under each group, and how many groups it checked", async () => {
      runMock.mockResolvedValue(
        answer({
          isCorrelation: true,
          threshold: null,
          matchedEventCount: null,
          skippedEventCount: null,
          preventedFiredCount: null,
          firedCount: 1,
          groupCount: 1,
          eventCount: 7,
          candidateLimit: 500,
          groups: [
            {
              ...group("203.0.113.7", 1),
              entityType: SecurityEntityType.IpAddress,
              summary:
                "Failed sign-in, then Successful sign-in, 2 minutes apart",
            },
          ],
        }) as never,
      );

      await drawPanel();

      const row: HTMLElement = screen.getByTestId(RETROHUNT_TEST_IDS.group);

      expect(row).toHaveTextContent(
        "Failed sign-in, then Successful sign-in, 2 minutes apart",
      );
      // A correlation's group fires once: no Times or Last fired.
      expect(within(row).getAllByRole("cell")).toHaveLength(2);
      expect(screen.getByTestId(RETROHUNT_TEST_IDS.notice)).toHaveTextContent(
        "It checked the 500 most recently active groups. Others may have matched too.",
      );
    });

    test("lists ten, then Show all; past fifty it says only the top are listed", async () => {
      const many: Array<DetectionRetrohuntGroup> = [];

      for (let index: number = 0; index < 50; index++) {
        many.push(group(`user-${index}`, 60 - index));
      }

      runMock.mockResolvedValue(
        answer({ groups: many, groupCount: 64, hasMoreGroups: true }) as never,
      );

      await drawPanel();

      expect(screen.getAllByTestId(RETROHUNT_TEST_IDS.group)).toHaveLength(10);

      fireEvent.click(screen.getByTestId(RETROHUNT_TEST_IDS.showAll));

      expect(screen.getAllByTestId(RETROHUNT_TEST_IDS.group)).toHaveLength(50);
      expect(screen.queryByTestId(RETROHUNT_TEST_IDS.showAll)).toBeNull();
      expect(
        screen.getByText("Only the 50 that fired most are listed."),
      ).toBeInTheDocument();
    });
  });

  describe("running again", () => {
    test("another period runs again over it", async () => {
      await drawPanel();

      fireEvent.click(screen.getByTestId(`${RETROHUNT_TEST_IDS.period}-24`));
      await settle();

      expect(
        requests().map((request: JSONObject) => {
          return request["periodInHours"];
        }),
      ).toEqual([168, 24]);
      expect(
        screen.getByTestId(`${RETROHUNT_TEST_IDS.period}-24`),
      ).toHaveAttribute("aria-checked", "true");
    });

    test("a period choice inside a form never sends the form", async () => {
      const onSubmit: ReturnType<typeof jest.fn> = jest.fn();

      render(
        <form
          onSubmit={(event: React.FormEvent) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <DetectionRuleRetrohuntPanel
            getRequest={(periodInHours: number): JSONObject => {
              return { periodInHours };
            }}
          />
        </form>,
      );
      await settle();

      fireEvent.click(screen.getByTestId(`${RETROHUNT_TEST_IDS.period}-720`));
      fireEvent.click(screen.getByTestId(RETROHUNT_TEST_IDS.runAgain));
      await settle();

      expect(onSubmit).not.toHaveBeenCalled();
    });

    test("Run again reads the request as it is now", async () => {
      let yaml: string = "title: first";

      await drawPanel((periodInHours: number): JSONObject => {
        return buildRetrohuntRequest({ sigmaRuleYaml: yaml }, periodInHours);
      });

      yaml = "title: second";
      fireEvent.click(screen.getByTestId(RETROHUNT_TEST_IDS.runAgain));
      await settle();

      expect(requests()[1]!["sigmaRuleYaml"]).toBe("title: second");
    });

    test("says it is reading while a run is under way", async () => {
      let finish: (value: unknown) => void = () => {};

      runMock.mockReturnValue(
        new Promise((resolve: (value: unknown) => void) => {
          finish = resolve;
        }) as never,
      );

      await drawPanel();

      expect(screen.getByTestId(RETROHUNT_TEST_IDS.running)).toHaveTextContent(
        "Reading your events…",
      );
      expect(screen.getByTestId(RETROHUNT_TEST_IDS.runAgain)).toBeDisabled();

      await act(async () => {
        finish(answer());
      });

      expect(screen.queryByTestId(RETROHUNT_TEST_IDS.running)).toBeNull();
      expect(
        screen.getByTestId(RETROHUNT_TEST_IDS.summary),
      ).toBeInTheDocument();
    });

    test("a run that cannot be made says why, and Run again tries again", async () => {
      runMock.mockRejectedValueOnce(
        new Error("Sigma rule YAML is required.") as never,
      );

      await drawPanel();

      const error: HTMLElement = screen.getByTestId(RETROHUNT_TEST_IDS.error);

      expect(error).toHaveTextContent("Sigma rule YAML is required.");
      // In a box of its own, said to a screen reader as it appears.
      expect(error).toHaveAttribute("role", "alert");
      expect(error.className).toContain("bg-red-50");
      expect(screen.queryByTestId(RETROHUNT_TEST_IDS.summary)).toBeNull();

      fireEvent.click(screen.getByTestId(RETROHUNT_TEST_IDS.runAgain));
      await settle();

      expect(screen.queryByTestId(RETROHUNT_TEST_IDS.error)).toBeNull();
      expect(
        screen.getByTestId(RETROHUNT_TEST_IDS.summary),
      ).toBeInTheDocument();
    });

    test("an older run that ends after a newer one is dropped", async () => {
      const finishers: Array<(value: unknown) => void> = [];

      runMock.mockImplementation((() => {
        return new Promise((resolve: (value: unknown) => void) => {
          finishers.push(resolve);
        });
      }) as never);

      await drawPanel();

      fireEvent.click(screen.getByTestId(`${RETROHUNT_TEST_IDS.period}-24`));
      await settle();

      // The 24-hour run answers first; the week's answer comes after.
      await act(async () => {
        finishers[1]!(answer({ firedCount: 3, periodInHours: 24 }));
      });
      await act(async () => {
        finishers[0]!(answer({ firedCount: 99 }));
      });

      expect(screen.getByTestId(RETROHUNT_TEST_IDS.summary)).toHaveTextContent(
        "Would have fired 3 times",
      );
    });
  });

  describe("under the Detection Rules form", () => {
    function drawInForm(rule: RetrohuntRuleInput): {
      rerender: (rule: RetrohuntRuleInput) => void;
    } {
      const rendered: ReturnType<typeof render> = render(
        <DetectionRuleRetrohuntInForm rule={rule} />,
      );

      return {
        rerender: (next: RetrohuntRuleInput): void => {
          rendered.rerender(<DetectionRuleRetrohuntInForm rule={next} />);
        },
      };
    }

    test("is one quiet button until it is wanted, and runs nothing", () => {
      drawInForm({ sigmaRuleYaml: "title: x" });

      expect(screen.getByTestId(RETROHUNT_TEST_IDS.open)).toHaveTextContent(
        "Run on Past Events",
      );
      expect(screen.queryByTestId(RETROHUNT_TEST_IDS.panel)).toBeNull();
      expect(runMock).not.toHaveBeenCalled();
    });

    test("waits for a rule: an empty form shows no button at all", () => {
      /*
       * Nothing to run, so nothing to press: Draft with AI is an empty
       * form's next step, and a greyed-out button that only says why under
       * the pointer is lost on a touch screen.
       */
      const drawn: { rerender: (rule: RetrohuntRuleInput) => void } =
        drawInForm({ sigmaRuleYaml: "  " });

      expect(screen.queryByTestId(RETROHUNT_TEST_IDS.open)).toBeNull();
      expect(runMock).not.toHaveBeenCalled();

      // The rule written in: the button is there to press.
      drawn.rerender({ sigmaRuleYaml: "title: x" });
      expect(screen.getByTestId(RETROHUNT_TEST_IDS.open)).toBeEnabled();

      // A saved rule's edit can run before its YAML is read back.
      drawn.rerender({ detectionRuleId: RULE_ID });
      expect(screen.getByTestId(RETROHUNT_TEST_IDS.open)).toBeEnabled();
    });

    test("open, stays open while the rule is rewritten - and says it changed", async () => {
      const drawn: { rerender: (rule: RetrohuntRuleInput) => void } =
        drawInForm({ sigmaRuleYaml: "title: x" });

      fireEvent.click(screen.getByTestId(RETROHUNT_TEST_IDS.open));
      await settle();

      // Emptied while it is open, as when the whole rule is pasted over.
      drawn.rerender({ sigmaRuleYaml: "" });

      expect(screen.getByTestId(RETROHUNT_TEST_IDS.panel)).toBeInTheDocument();
      expect(screen.getByTestId(RETROHUNT_TEST_IDS.changed)).toHaveTextContent(
        "The rule changed after this run.",
      );
      expect(requests()).toHaveLength(1);
    });

    test("opened, runs the rule as the form holds it - with the saved rule's id on an edit", async () => {
      drawInForm({
        detectionRuleId: RULE_ID,
        sigmaRuleYaml: "title: x",
        groupByField: "principalUser",
        matchCountThreshold: 4,
        evaluationIntervalInMinutes: 15,
      });

      fireEvent.click(screen.getByTestId(RETROHUNT_TEST_IDS.open));
      await settle();

      expect(requests()).toEqual([
        {
          periodInHours: 168,
          detectionRuleId: RULE_ID,
          sigmaRuleYaml: "title: x",
          groupByField: "principalUser",
          distinctCountField: "",
          matchCountThreshold: 4,
          evaluationIntervalInMinutes: 15,
        },
      ]);
      expect(
        screen.getByText(
          "What this rule would have found in your events, with its exceptions. Nothing is opened or sent.",
        ),
      ).toBeInTheDocument();
    });

    test("says when the rule changed after its run", async () => {
      const drawn: { rerender: (rule: RetrohuntRuleInput) => void } =
        drawInForm({ sigmaRuleYaml: "title: x" });

      fireEvent.click(screen.getByTestId(RETROHUNT_TEST_IDS.open));
      await settle();

      expect(screen.queryByTestId(RETROHUNT_TEST_IDS.changed)).toBeNull();

      drawn.rerender({ sigmaRuleYaml: "title: y" });

      expect(screen.getByTestId(RETROHUNT_TEST_IDS.changed)).toHaveTextContent(
        "The rule changed after this run.",
      );
    });

    test("the x puts it away", async () => {
      drawInForm({ sigmaRuleYaml: "title: x" });

      fireEvent.click(screen.getByTestId(RETROHUNT_TEST_IDS.open));
      await settle();

      const close: HTMLElement = screen.getByTestId(RETROHUNT_TEST_IDS.close);

      expect(close).toHaveAttribute("aria-label", "Close Run on Past Events");
      fireEvent.click(close);

      expect(screen.queryByTestId(RETROHUNT_TEST_IDS.panel)).toBeNull();
      expect(screen.getByTestId(RETROHUNT_TEST_IDS.open)).toBeInTheDocument();
    });
  });

  describe("from a rule's row", () => {
    test("runs the saved rule, by its id, in a dialog that names it", async () => {
      const onClose: ReturnType<typeof jest.fn> = jest.fn();

      render(
        <DetectionRuleRetrohuntModal
          ruleId={RULE_ID}
          ruleName="Failed logon burst"
          onClose={onClose as unknown as () => void}
        />,
      );
      await settle();

      expect(requests()).toEqual([
        { periodInHours: 168, detectionRuleId: RULE_ID },
      ]);

      const dialog: HTMLElement = screen.getByRole("dialog");

      expect(
        within(dialog).getByText("Run on Past Events"),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByText("Failed logon burst"),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByTestId(RETROHUNT_TEST_IDS.modal),
      ).toBeInTheDocument();
      // Read only: Close, and nothing to submit.
      expect(
        within(dialog).queryByTestId("modal-footer-submit-button"),
      ).toBeNull();
      /*
       * As wide as its answer needs: a dialog as wide as the page put a
       * value and its count a screen's width apart.
       */
      expect(dialog.className).toContain("sm:max-w-3xl");
      expect(dialog.className).not.toContain("max-w-7xl");
    });
  });
});
