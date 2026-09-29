import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "@jest/globals";
import * as React from "react";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
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
