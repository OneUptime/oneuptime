import Icon from "../Icon/Icon";
import Pill, { PillSize } from "../Pill/Pill";
import { WorkflowEnabledCopy } from "./WorkflowEnabledCopy";
import { Gray500 } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * How the dashboard marks a test run: a run a person started from the
 * Builder, with Run Workflow or Run just this step, while the workflow was
 * turned off (Types/Workflow/WorkflowEnabled). Off pauses the workflow's
 * trigger, not a person testing it, so such a run goes ahead - and it is
 * marked wherever it is shown, so it is never mistaken for one its trigger
 * started:
 *
 *   - WorkflowTestRunPill: beside the run's status in both run lists;
 *   - WorkflowTestRunNote: at the top of the run, with who started it;
 *   - WorkflowRunPanelTestRunNote: in the Run Workflow panel, before anything
 *     runs - a test run is not a dry run, and off does not make it one.
 *
 * All three are drawn in blue, like the "Only this step ran" note of a test
 * of one step (StepTraceViewer): information about the run, not a warning.
 */

type GetTestRunStartedByTextFunction = (
  translator: Translator,
  startedBy: string | null | undefined,
) => string;

// "Started by Ada Lovelace while this workflow was off.", in the reader's language.
export const getTestRunStartedByText: GetTestRunStartedByTextFunction = (
  translator: Translator,
  startedBy: string | null | undefined,
): string => {
  const person: string = (startedBy || "").trim();

  if (!person) {
    return translator.translateTemplate(
      WorkflowEnabledCopy.testRunStartedByHand,
    );
  }

  return translator.translateTemplate(WorkflowEnabledCopy.testRunStartedBy, {
    person: person,
  });
};

export interface TestRunProps {
  // Who started the run, by name or email, when it is known.
  startedBy?: string | null | undefined;
}

export const WorkflowTestRunPill: FunctionComponent<TestRunProps> = (
  props: TestRunProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span data-testid="workflow-test-run-pill" className="inline-flex">
      <Pill
        text={WorkflowEnabledCopy.testRun}
        color={Gray500}
        isMinimal={true}
        icon={IconProp.Beaker}
        size={PillSize.Small}
        tooltip={getTestRunStartedByText(translator, props.startedBy)}
      />
    </span>
  );
};

export const WorkflowTestRunNote: FunctionComponent<TestRunProps> = (
  props: TestRunProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2"
      data-testid="workflow-run-test-run-note"
    >
      <div aria-hidden="true" className="mt-0.5 shrink-0 text-blue-500">
        <Icon icon={IconProp.Beaker} className="h-4 w-4" />
      </div>
      <div className="min-w-0 text-sm">
        <p className="font-medium text-blue-800">
          {translator.translateText(WorkflowEnabledCopy.testRun)}
        </p>
        <p
          className="mt-0.5 text-blue-700"
          data-testid="workflow-run-test-run-started-by"
        >
          {getTestRunStartedByText(translator, props.startedBy)}
        </p>
      </div>
    </div>
  );
};

export const WorkflowRunPanelTestRunNote: FunctionComponent =
  (): ReactElement => {
    const translator: Translator = useTranslator();

    return (
      <div
        role="note"
        className="flex items-start gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2"
        data-testid="workflow-run-panel-test-run-note"
      >
        <div aria-hidden="true" className="mt-0.5 shrink-0 text-blue-500">
          <Icon icon={IconProp.Beaker} className="h-4 w-4" />
        </div>
        <p className="min-w-0 text-sm text-blue-700">
          {translator.translateText(WorkflowEnabledCopy.runPanelTestRunNote)}
        </p>
      </div>
    );
  };
