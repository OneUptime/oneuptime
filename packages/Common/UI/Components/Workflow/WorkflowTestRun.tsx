import Icon from "../Icon/Icon";
import Pill from "../Pill/Pill";
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
 *   - WorkflowTestRunPill: beside the run's status in both run lists, the
 *     same size as the status, with who started it on hover;
 *   - WorkflowTestRunNote: in the run itself, the same pill with who started
 *     it written out, on a line under the run's status;
 *   - WorkflowRunPanelTestRunNote: in the Run Workflow panel, before anything
 *     runs - a test run is not a dry run, and off does not make it one.
 *
 * The pill is a neutral outline: a test run is a fact about the run, not a
 * state of it, so it never competes with the status beside it. Only the Run
 * Workflow panel's note is a blue box, like the "Only this step ran" note of
 * a test of one step (StepTraceViewer), because it is read before the run
 * and says something worth stopping for: every step runs for real.
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

interface TestRunPillProps {
  tooltip?: string | undefined;
}

/*
 * "Test run", as both marks draw it. The default size, which is the status
 * pill's, so the two read as a pair.
 */
const TestRunPill: FunctionComponent<TestRunPillProps> = (
  props: TestRunPillProps,
): ReactElement => {
  return (
    <Pill
      text={WorkflowEnabledCopy.testRun}
      color={Gray500}
      isMinimal={true}
      icon={IconProp.Beaker}
      tooltip={props.tooltip}
    />
  );
};

export const WorkflowTestRunPill: FunctionComponent<TestRunProps> = (
  props: TestRunProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span data-testid="workflow-test-run-pill" className="inline-flex">
      <TestRunPill
        tooltip={getTestRunStartedByText(translator, props.startedBy)}
      />
    </span>
  );
};

/*
 * In the run itself: the pill the run lists show, and who started the run
 * written out beside it rather than in a tooltip. A quiet line under the
 * run's status: the person reading it has just started the run, or opened it
 * from a list that already marked it, so it is context, not news.
 *
 * The pill sits in the line of text, so a long name or a narrow window wraps
 * the sentence under it rather than leaving the pill alone on a line. A div,
 * not a p: the pill's icon draws a div.
 */
export const WorkflowTestRunNote: FunctionComponent<TestRunProps> = (
  props: TestRunProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      role="note"
      className="text-sm leading-6 text-gray-500"
      data-testid="workflow-run-test-run-note"
    >
      <span className="mr-2 inline-flex align-middle">
        <TestRunPill />
      </span>
      <span
        className="align-middle"
        data-testid="workflow-run-test-run-started-by"
      >
        {getTestRunStartedByText(translator, props.startedBy)}
      </span>
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
