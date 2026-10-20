import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "@jest/globals";
import * as React from "react";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
  MonitorEvaluationEvent,
  MonitorEvaluationGroupingNote,
} from "../../../Types/Monitor/MonitorEvaluationSummary";
import EvaluationLogList from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/EvaluationLogList";

const EVALUATED_AT: Date = new Date("2026-09-14T10:00:00.000Z");

function criteriaResult(
  overrides: Partial<MonitorEvaluationCriteriaResult> & {
    criteriaName: string;
  },
): MonitorEvaluationCriteriaResult {
  const { criteriaName, ...criteriaOverrides } = overrides;

  return {
    criteriaId: criteriaName.toLowerCase().replace(/\s+/g, "-"),
    criteriaName: criteriaName,
    filterCondition: FilterCondition.All,
    met: false,
    message: "Criteria was not met.",
    filters: [],
    ...criteriaOverrides,
  };
}

function renderCriteria(
  criteriaResults: Array<MonitorEvaluationCriteriaResult>,
): void {
  const evaluationSummary: MonitorEvaluationSummary = {
    evaluatedAt: EVALUATED_AT,
    criteriaResults,
    events: [],
  };

  render(<EvaluationLogList evaluationSummary={evaluationSummary} />);
}

describe("EvaluationLogList criteria results", () => {
  describe("criteria skipped after an earlier match", () => {
    it("names the matching criterion and presents the later criterion as not evaluated", () => {
      renderCriteria([
        criteriaResult({
          criteriaName: "Incoming Request is degraded",
          met: true,
          message: "Incoming request reported a degraded state.",
        }),
        criteriaResult({
          criteriaName: "Online Criteria",
          skipped: true,
          skipReason:
            "An earlier criteria already matched. Evaluation stopped at the first match.",
          message:
            "An earlier criteria already matched. Evaluation stopped at the first match.",
        }),
      ]);

      const skippedCriterion: HTMLElement = screen.getByLabelText(
        "Online Criteria: Not evaluated",
      );

      expect(within(skippedCriterion).getByText("Not evaluated")).toBeVisible();
      expect(skippedCriterion).toHaveTextContent(
        "Not evaluated because “Incoming Request is degraded” matched first.",
      );
      expect(skippedCriterion).toHaveTextContent(
        "Criteria are evaluated in order",
      );
    });

    it("uses a neutral dashed treatment instead of warning colors", () => {
      renderCriteria([
        criteriaResult({ criteriaName: "First match", met: true }),
        criteriaResult({
          criteriaName: "Later criterion",
          skipped: true,
          skipCause: "earlier-criterion-matched",
          skipReason: "An earlier criterion matched.",
        }),
      ]);

      const skippedCriterion: HTMLElement = screen.getByLabelText(
        "Later criterion: Not evaluated",
      );

      expect(skippedCriterion).toHaveClass(
        "border-dashed",
        "border-gray-200",
        "bg-gray-50/60",
      );
      expect(skippedCriterion.className).not.toMatch(/amber|yellow/);
    });
  });

  describe("criteria skipped without an earlier match", () => {
    it("shows a disabled criterion with its stored reason", () => {
      const storedReason: string =
        "This criterion is disabled and was not evaluated.";

      renderCriteria([
        criteriaResult({
          criteriaName: "Disabled recovery criterion",
          skipped: true,
          skipReason: storedReason,
          message: storedReason,
        }),
      ]);

      const disabledCriterion: HTMLElement = screen.getByLabelText(
        "Disabled recovery criterion: Disabled",
      );

      expect(within(disabledCriterion).getByText("Disabled")).toBeVisible();
      expect(within(disabledCriterion).getByText(storedReason)).toBeVisible();
      expect(
        within(disabledCriterion).queryByText(/matched first/i),
      ).not.toBeInTheDocument();
    });

    it("keeps a disabled criterion disabled when it follows a match", () => {
      const storedReason: string =
        "This criterion is disabled, so it was not evaluated.";

      renderCriteria([
        criteriaResult({ criteriaName: "Matched grouped series", met: true }),
        criteriaResult({
          criteriaName: "Disabled recovery criterion",
          skipped: true,
          skipCause: "disabled",
          skipReason: storedReason,
          message: storedReason,
        }),
      ]);

      const disabledCriterion: HTMLElement = screen.getByRole("group", {
        name: "Disabled recovery criterion: Disabled",
      });

      expect(disabledCriterion).toHaveTextContent(storedReason);
      expect(disabledCriterion).not.toHaveTextContent(/matched first/i);
      expect(disabledCriterion).not.toHaveTextContent(/stops after/i);
    });

    it("does not infer first-match short-circuiting from result order alone", () => {
      const storedReason: string = "The data source was unavailable.";

      renderCriteria([
        criteriaResult({ criteriaName: "Earlier matching series", met: true }),
        criteriaResult({
          criteriaName: "Unavailable series",
          skipped: true,
          skipReason: storedReason,
          message: storedReason,
        }),
      ]);

      const unavailableCriterion: HTMLElement = screen.getByRole("group", {
        name: "Unavailable series: Not evaluated",
      });

      expect(unavailableCriterion).toHaveTextContent(storedReason);
      expect(unavailableCriterion).not.toHaveTextContent(/matched first/i);
    });

    it("falls back to the legacy message when skipReason is absent", () => {
      const legacyMessage: string =
        "The legacy evaluator did not run this criterion.";

      renderCriteria([
        criteriaResult({
          criteriaName: "Legacy criterion",
          skipped: true,
          skipReason: undefined,
          message: legacyMessage,
        }),
      ]);

      const legacyCriterion: HTMLElement = screen.getByLabelText(
        "Legacy criterion: Not evaluated",
      );

      expect(within(legacyCriterion).getByText(legacyMessage)).toBeVisible();
    });

    it("uses a generic explanation when neither stored reason is available", () => {
      renderCriteria([
        criteriaResult({
          criteriaName: "Unexplained criterion",
          skipped: true,
          skipReason: undefined,
          message: "",
        }),
      ]);

      const unexplainedCriterion: HTMLElement = screen.getByLabelText(
        "Unexplained criterion: Not evaluated",
      );

      expect(
        within(unexplainedCriterion).getByText(
          "This criterion was not evaluated.",
        ),
      ).toBeVisible();
    });
  });

  describe("evaluated criteria", () => {
    it("does not claim that later criteria were skipped when the matching criterion is last", () => {
      renderCriteria([
        criteriaResult({
          criteriaName: "Only criterion",
          met: true,
          message: "The only criterion matched.",
        }),
      ]);

      expect(screen.getByLabelText("Only criterion: Met")).toBeInTheDocument();
      expect(
        screen.queryByText(
          "All other criteria was not checked because this criteria was met.",
        ),
      ).not.toBeInTheDocument();
    });

    it("does not claim that grouped results stopped after either matching criterion", () => {
      renderCriteria([
        criteriaResult({
          criteriaName: "Critical hosts",
          met: true,
          message: "At least one host is critical.",
        }),
        criteriaResult({
          criteriaName: "Warning hosts",
          met: true,
          message: "At least one other host is warning.",
        }),
      ]);

      expect(screen.getByLabelText("Critical hosts: Met")).toBeInTheDocument();
      expect(screen.getByLabelText("Warning hosts: Met")).toBeInTheDocument();
      expect(
        screen.queryByText(/all other criteria was not checked/i),
      ).not.toBeInTheDocument();
    });

    it("keeps Met and Not Met statuses and groups repeated filter metadata", () => {
      renderCriteria([
        criteriaResult({
          criteriaName: "Latency is high",
          met: true,
          filters: [
            {
              checkOn: CheckOn.ResponseTime,
              filterType: FilterType.GreaterThan,
              value: 500,
              message: "Response time exceeded 500 ms.",
              met: true,
            },
            {
              checkOn: CheckOn.ResponseTime,
              filterType: FilterType.GreaterThan,
              value: 500,
              message: "Response time exceeded 500 ms.",
              met: true,
            },
          ],
        }),
        criteriaResult({
          criteriaName: "Service is offline",
          met: false,
          filterCondition: FilterCondition.Any,
        }),
      ]);

      const metCriterion: HTMLElement = screen.getByLabelText(
        "Latency is high: Met",
      );
      const notMetCriterion: HTMLElement = screen.getByLabelText(
        "Service is offline: Not Met",
      );

      expect(within(metCriterion).getAllByText("Met")).not.toHaveLength(0);
      expect(within(notMetCriterion).getByText("Not Met")).toBeVisible();

      const groupedFilter: HTMLElement =
        within(metCriterion).getByRole("listitem");
      expect(
        within(groupedFilter).getByText("Response time exceeded 500 ms."),
      ).toBeVisible();
      expect(groupedFilter).toHaveTextContent(
        "Check: Response Time (in ms) • Condition: Greater Than • Threshold: 500 • 2 matching checks",
      );
      expect(
        within(metCriterion).getAllByText("Response time exceeded 500 ms."),
      ).toHaveLength(1);
    });
  });
});

/*
 * An Incoming Request criteria that groups by a payload field says, among the
 * Actions, how it handled a request it matched - one without the field, say,
 * which it handled for the whole monitor rather than not at all. The server
 * sends what the note says (event.grouping) with the same note in English;
 * the list words it, the grouping path drawn as code.
 */
describe("EvaluationLogList grouping notes", () => {
  const CONTAINS_X_ID: string = "contains-x";
  const PATH: string = "requestBody.groupLabels.alertname";
  const ALERTS_PATH: string = "requestBody.alerts[*].labels.alertname";

  // A grouping event as the server writes it (IncomingRequestIncidentGrouping.describeNote).
  function groupingEvent(
    grouping: MonitorEvaluationGroupingNote | undefined,
    english: { title: string; message: string },
  ): MonitorEvaluationEvent {
    return {
      type: "grouping",
      title: english.title,
      message: english.message,
      ...(grouping ? { grouping } : {}),
      relatedCriteriaId: CONTAINS_X_ID,
      at: EVALUATED_AT,
    };
  }

  const NO_VALUE_EVENT: MonitorEvaluationEvent = groupingEvent(
    { outcome: "no-value", criteriaName: "Contains x", path: PATH },
    {
      title: "No value to group by",
      message: `This request has no value at ${PATH}, so criteria "Contains x" handled it without grouping, once for the whole monitor.`,
    },
  );

  function renderEvents(
    events: Array<MonitorEvaluationEvent>,
    criteriaResults: Array<MonitorEvaluationCriteriaResult> = [
      criteriaResult({
        criteriaName: "Contains x",
        met: true,
        message: "Request body contains x.",
        filters: [
          {
            checkOn: CheckOn.RequestBody,
            filterType: FilterType.Contains,
            value: "x",
            message: "Request body contains x.",
            met: true,
          },
        ],
      }),
    ],
  ): void {
    const evaluationSummary: MonitorEvaluationSummary = {
      evaluatedAt: EVALUATED_AT,
      criteriaResults: criteriaResults,
      events: [
        {
          type: "criteria-met",
          title: "Criteria met: Contains x",
          message: "Request body contains x.",
          at: EVALUATED_AT,
        },
        ...events,
      ],
    };

    render(<EvaluationLogList evaluationSummary={evaluationSummary} />);
  }

  // The row of the note with this title: its title, message and time.
  function noteRow(title: string): HTMLElement {
    return screen.getByText(title).parentElement!;
  }

  function messageOf(title: string): HTMLElement {
    return noteRow(title).children[1] as HTMLElement;
  }

  function renderGroupedMatch(): void {
    renderEvents([
      NO_VALUE_EVENT,
      {
        type: "alert-created",
        title: "Alert created: Alert: {{alertname}}",
        message: 'Alert triggered from criteria "Contains x".',
        relatedAlertId: "11111111-1111-4111-8111-111111111111",
        relatedAlertNumber: 7,
        at: EVALUATED_AT,
      },
    ]);
  }

  it("lists the note among the Actions, with what happened and why", () => {
    renderGroupedMatch();

    expect(screen.getByText("Actions")).toBeVisible();
    expect(screen.getByText("No value to group by")).toBeVisible();
    expect(messageOf("No value to group by")).toHaveTextContent(
      `This request has no value at ${PATH}, so “Contains x” handled it without grouping, once for the whole monitor.`,
    );
  });

  it("draws the grouping path as code, left to right, breaking it only when it is longer than the line", () => {
    renderGroupedMatch();

    const path: HTMLElement = within(
      messageOf("No value to group by"),
    ).getByTestId("evaluation-grouping-path");

    expect(path.tagName).toBe("CODE");
    expect(path).toHaveTextContent(PATH);
    expect(path).toHaveAttribute("dir", "ltr");
    expect(path).toHaveClass("font-mono", "[overflow-wrap:anywhere]");
  });

  it("names the criteria as the list above does, in its quotes and weight", () => {
    renderGroupedMatch();

    const name: HTMLElement = within(
      messageOf("No value to group by"),
    ).getByText("“Contains x”");

    expect(name).toHaveClass("font-medium");
  });

  it("lists it before what the criteria opened", () => {
    renderGroupedMatch();

    const note: HTMLElement = screen.getByText("No value to group by");
    const opened: HTMLElement = screen.getByText(
      "Alert created: Alert: {{alertname}} (Alert #7)",
    );

    expect(
      note.compareDocumentPosition(opened) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("offers no button of its own: it names no incident or alert", () => {
    renderGroupedMatch();

    expect(
      within(noteRow("No value to group by")).queryByRole("button"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "View Alert" })).toHaveLength(
      1,
    );
  });

  it.each([
    {
      name: "requests stopped arriving",
      grouping: { outcome: "no-request", criteriaName: "Contains x" },
      title: "No request to group by",
      sentence:
        "“Contains x” matched because requests stopped arriving, so it handled this without grouping, once for the whole monitor.",
      hasPath: false,
    },
    {
      name: "every value recovered",
      grouping: {
        outcome: "values-recovered",
        criteriaName: "Contains x",
        path: ALERTS_PATH,
      },
      title: "Nothing new to open",
      sentence: `Every value at ${ALERTS_PATH} in this request reported recovered, so “Contains x” opened nothing new.`,
      hasPath: true,
    },
    {
      name: "no value, reported recovered",
      grouping: {
        outcome: "no-value-recovered",
        criteriaName: "Contains x",
        path: PATH,
      },
      title: "Nothing new to open",
      sentence: `This request has no value at ${PATH} and reported recovered, so “Contains x” opened nothing new.`,
      hasPath: true,
    },
    {
      name: "the background check re-read the request",
      grouping: { outcome: "re-read", criteriaName: "Contains x" },
      title: "Nothing new to open",
      sentence:
        "The background check re-read the last request. “Contains x” opens one per value only when a request arrives.",
      hasPath: false,
    },
    {
      name: "one item without a value",
      grouping: {
        outcome: "some-without-value",
        criteriaName: "Contains x",
        path: ALERTS_PATH,
        itemsWithoutValue: 1,
      },
      title: "Not every item has a value to group by",
      sentence: `1 item in this request has no value at ${ALERTS_PATH}, so it opened nothing of its own.`,
      hasPath: true,
    },
    {
      name: "several items without a value",
      grouping: {
        outcome: "some-without-value",
        criteriaName: "Contains x",
        path: ALERTS_PATH,
        itemsWithoutValue: 3,
      },
      title: "Not every item has a value to group by",
      sentence: `3 items in this request have no value at ${ALERTS_PATH}, so they opened nothing of their own.`,
      hasPath: true,
    },
  ] as Array<{
    name: string;
    grouping: MonitorEvaluationGroupingNote;
    title: string;
    sentence: string;
    hasPath: boolean;
  }>)(
    "words $name",
    (expected: {
      grouping: MonitorEvaluationGroupingNote;
      title: string;
      sentence: string;
      hasPath: boolean;
    }) => {
      renderEvents([
        groupingEvent(expected.grouping, {
          title: "English title as stored",
          message: "English message as stored.",
        }),
      ]);

      const message: HTMLElement = messageOf(expected.title);

      expect(message).toHaveTextContent(expected.sentence);
      expect(
        within(message).queryAllByTestId("evaluation-grouping-path"),
      ).toHaveLength(expected.hasPath ? 1 : 0);
      // Worded here, so the stored English is not shown as well.
      expect(
        screen.queryByText("English message as stored."),
      ).not.toBeInTheDocument();
    },
  );

  it("puts the items without a value on a line of their own when every value recovered", () => {
    renderEvents([
      groupingEvent(
        {
          outcome: "values-recovered",
          criteriaName: "Contains x",
          path: ALERTS_PATH,
          itemsWithoutValue: 2,
        },
        { title: "Nothing new to open", message: "Stored." },
      ),
    ]);

    const lines: Array<Element> = Array.from(
      messageOf("Nothing new to open").querySelectorAll(":scope > span.block"),
    );

    expect(
      lines.map((line: Element): string => {
        return line.textContent || "";
      }),
    ).toEqual([
      `Every value at ${ALERTS_PATH} in this request reported recovered, so “Contains x” opened nothing new.`,
      `2 items in this request have no value at ${ALERTS_PATH}, so they opened nothing of their own.`,
    ]);
  });

  it("names a criteria without a name by its place in the list, as the list does", () => {
    renderEvents(
      [
        groupingEvent(
          { outcome: "no-value", path: PATH },
          {
            title: "No value to group by",
            message: `This request has no value at ${PATH}, so criteria "Unnamed criteria" handled it without grouping, once for the whole monitor.`,
          },
        ),
      ],
      [
        criteriaResult({ criteriaName: "Does not contain x", met: false }),
        {
          ...criteriaResult({ criteriaName: "Unnamed", met: true }),
          criteriaId: CONTAINS_X_ID,
          criteriaName: undefined,
        },
      ],
    );

    expect(screen.getByLabelText("Criteria 2: Met")).toBeInTheDocument();
    expect(messageOf("No value to group by")).toHaveTextContent(
      `This request has no value at ${PATH}, so “Criteria 2” handled it without grouping, once for the whole monitor.`,
    );
  });

  it.each([
    {
      name: "an event without the note's details",
      grouping: undefined,
    },
    {
      name: "an outcome this Dashboard does not know",
      grouping: {
        outcome: "something-newer",
        criteriaName: "Contains x",
        path: PATH,
      } as unknown as MonitorEvaluationGroupingNote,
    },
    {
      name: "a note that should name its path but does not",
      grouping: { outcome: "no-value", criteriaName: "Contains x" },
    },
    {
      name: "a count of items without a value that is missing",
      grouping: {
        outcome: "some-without-value",
        criteriaName: "Contains x",
        path: PATH,
      },
    },
  ] as Array<{
    name: string;
    grouping: MonitorEvaluationGroupingNote | undefined;
  }>)(
    "shows $name as the server wrote it",
    (input: { grouping: MonitorEvaluationGroupingNote | undefined }) => {
      renderEvents([
        groupingEvent(input.grouping, {
          title: "Stored title",
          message: "Stored message, in English.",
        }),
      ]);

      expect(screen.getByText("Stored title")).toBeVisible();
      expect(screen.getByText("Stored message, in English.")).toBeVisible();
      expect(
        screen.queryByTestId("evaluation-grouping-path"),
      ).not.toBeInTheDocument();
    },
  );

  it("shows the stored note when its criteria cannot be named", () => {
    renderEvents(
      [
        {
          ...groupingEvent(
            { outcome: "no-value", path: PATH },
            { title: "Stored title", message: "Stored message." },
          ),
          relatedCriteriaId: "a-criteria-not-in-the-list",
        },
      ],
      [],
    );

    expect(screen.getByText("Stored title")).toBeVisible();
    expect(screen.getByText("Stored message.")).toBeVisible();
  });

  it("wraps a long title, message or path inside its row, and reads each in its own direction", () => {
    renderGroupedMatch();

    const title: HTMLElement = screen.getByText("No value to group by");
    const column: HTMLElement = title.parentElement!;

    // A flex child that may shrink below its content, so nothing runs past the card.
    expect(column).toHaveClass("min-w-0", "flex-1");
    expect(title).toHaveClass("break-words");
    expect(title).toHaveAttribute("dir", "auto");
    expect(messageOf("No value to group by")).toHaveClass("break-words");
    expect(messageOf("No value to group by")).toHaveAttribute("dir", "auto");
  });
});
