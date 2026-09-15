import { RuleRunResult, RuleRunType } from "../../../../Types/Rules/RuleRun";
import RunRuleNowModal from "../../../../UI/Components/RuleRun/RunRuleNowModal";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import RuleRunClient, {
  RunRuleData,
} from "../../../../UI/Utils/Rules/RuleRunClient";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";

/*
 * Contract under test - the "Run now" modal.
 *
 * The notification question belongs before the run, so owner rules - and only
 * owner rules - ask it, defaulting to silent. While passes chain the modal says
 * how far it has got instead of spinning. Once the run answers, the same modal
 * becomes the report; a refusal stays on the confirmation with the reason, so
 * the user can fix the rule and try again.
 */

const RULE_ID: string = "44444444-4444-4444-8444-444444444444";

function finishedResult(): RuleRunResult {
  return {
    resourcesEvaluated: 40,
    resourcesMatched: 12,
    resourcesUpdated: 12,
    itemsAdded: 24,
    itemsRemoved: 0,
    resourcesFailed: 0,
    passes: 1,
    isTruncated: false,
    ownersNotified: false,
  };
}

function submit(): void {
  fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
}

describe("RunRuleNowModal", () => {
  beforeEach(() => {
    jest
      .spyOn(ModelAPI, "getCommonHeaders")
      .mockReturnValue({ tenantid: "project-1" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("names the rule and says what the run will do", () => {
    render(
      <RunRuleNowModal
        ruleType={RuleRunType.MonitorLabelRule}
        ruleId={RULE_ID}
        ruleName="Tag production"
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      'Run "Tag production" Now',
    );
    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      "attach its labels to the ones it matches",
    );
    expect(
      screen.queryByTestId("run-rule-notify-owners-checkbox"),
    ).not.toBeInTheDocument();
  });

  it("runs a label rule without asking about notifications", async () => {
    const runSpy: jest.SpyInstance = jest
      .spyOn(RuleRunClient, "run")
      .mockResolvedValue({
        isSuccess: true,
        message: "Added labels to 12 monitors (24 labels attached).",
        result: finishedResult(),
      });

    render(
      <RunRuleNowModal
        ruleType={RuleRunType.MonitorLabelRule}
        ruleId={RULE_ID}
        onClose={jest.fn()}
      />,
    );

    await act(async () => {
      submit();
    });

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy.mock.calls[0]![0]).toMatchObject({
      ruleType: RuleRunType.MonitorLabelRule,
      ruleId: RULE_ID,
      notifyOwners: false,
      headers: { tenantid: "project-1" },
    });
  });

  it("asks owner rules whether to notify, defaulting to silent", async () => {
    const runSpy: jest.SpyInstance = jest
      .spyOn(RuleRunClient, "run")
      .mockResolvedValue({ isSuccess: true, message: "Done.", result: null });

    render(
      <RunRuleNowModal
        ruleType={RuleRunType.IncidentOwnerRule}
        ruleId={RULE_ID}
        onClose={jest.fn()}
      />,
    );

    const checkbox: HTMLElement = screen.getByTestId(
      "run-rule-notify-owners-checkbox",
    );
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    await act(async () => {
      submit();
    });

    expect(runSpy.mock.calls[0]![0]).toMatchObject({ notifyOwners: true });
  });

  it("shows progress while passes chain, then turns into the report", async () => {
    let finish: () => void = () => {};
    const onRunComplete: jest.Mock = jest.fn();
    const onClose: jest.Mock = jest.fn();

    jest
      .spyOn(RuleRunClient, "run")
      .mockImplementation(async (data: RunRuleData) => {
        data.onProgress!({
          ...finishedResult(),
          resourcesEvaluated: 200,
          resourcesUpdated: 3,
        });

        await new Promise<void>((resolve: () => void) => {
          finish = resolve;
        });

        return {
          isSuccess: true,
          message: "Added labels to 12 monitors (24 labels attached).",
          result: finishedResult(),
        };
      });

    render(
      <RunRuleNowModal
        ruleType={RuleRunType.MonitorLabelRule}
        ruleId={RULE_ID}
        onClose={onClose}
        onRunComplete={onRunComplete}
      />,
    );

    await act(async () => {
      submit();
    });

    expect(screen.getByTestId("run-rule-progress")).toHaveTextContent(
      "Evaluated 200 monitors so far, and updated 3.",
    );

    await act(async () => {
      finish();
    });

    await waitFor(() => {
      expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
        "Added labels to 12 monitors (24 labels attached).",
      );
    });

    expect(screen.queryByTestId("run-rule-progress")).not.toBeInTheDocument();
    expect(onRunComplete).toHaveBeenCalledWith(finishedResult());

    const closeButton: HTMLElement = screen.getByTestId(
      "modal-footer-submit-button",
    );
    expect(closeButton).toHaveTextContent("Close");

    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the confirmation open with the reason when the run is refused", async () => {
    jest.spyOn(RuleRunClient, "run").mockResolvedValue({
      isSuccess: false,
      message: "This rule is disabled. Enable it before running it.",
      result: null,
    });

    render(
      <RunRuleNowModal
        ruleType={RuleRunType.HostLabelRule}
        ruleId={RULE_ID}
        onClose={jest.fn()}
      />,
    );

    await act(async () => {
      submit();
    });

    await waitFor(() => {
      expect(
        screen.getByText("This rule is disabled. Enable it before running it."),
      ).toBeInTheDocument();
    });

    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Run Rule",
    );
  });
});
