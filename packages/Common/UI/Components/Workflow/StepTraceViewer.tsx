/*
 * A workflow run, read as the list of steps it actually took.
 *
 * The raw log is still there and still useful — it carries the component's own
 * log lines — but "what did this step receive, what did it return, and where
 * did it go next" is a question about structure, and answering it by scanning
 * a newline-joined blob was the whole problem.
 *
 * Each step says, without a click, whether it worked, how long it took, which
 * of its outputs it took ("Took No") and which step that led to. That used to
 * be a small "→ no" at the far end of the row, hidden on a phone, and the full
 * log's "Executing Port: No" was the only place it read plainly. Warnings the
 * runner raised about a step - a {{...}} that resolved to nothing - sit on the
 * step too, rather than only in the full log. The steps are drawn as a
 * numbered path, so "Step 3" in one step's outcome is the third card down.
 *
 * Everything the view says comes from the trace (see StepTracePresentation),
 * and every newer field is optional: a run recorded before a field existed
 * still reads, just with less to say.
 */

import Icon from "../Icon/Icon";
import Tooltip from "../Tooltip/Tooltip";
import BreakableCode from "./BreakableCode";
import {
  StepOutcome,
  StepOutcomeKind,
  StepOutcomeNextStep,
  StepPortTone,
  StepValueRow,
  TraceValueDisplay,
  TraceValueKind,
  getReceivedRows,
  getReturnedRows,
  getStepOutcome,
  getStepWarnings,
  getTraceResumesAt,
  getTraceSteps,
  isSingleStepRun,
  isStepFailed,
  isWholeReference,
  returnsNothingByDesign,
  shouldStepStartOpen,
} from "./StepTracePresentation";
import OneUptimeDate from "../../../Types/Date";
import IconProp from "../../../Types/Icon/IconProp";
import {
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
  WorkflowStepTraceWarning,
} from "../../../Types/Workflow/StepTrace";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import TranslatedSentence from "../TranslatedSentence/TranslatedSentence";

export interface ComponentProps {
  trace: WorkflowStepTrace;
  /**
   * The run is still going. Its steps are written when it finishes (or
   * pauses on a Sleep), so an empty list then means "not yet", not "none".
   */
  isRunning?: boolean | undefined;
}

type FormatDurationFunction = (durationInMs: number) => string;

export const formatStepDuration: FormatDurationFunction = (
  durationInMs: number,
): string => {
  if (durationInMs < 1000) {
    return `${durationInMs}ms`;
  }

  if (durationInMs < 60000) {
    return `${(durationInMs / 1000).toFixed(1)}s`;
  }

  const minutes: number = Math.floor(durationInMs / 60000);
  const seconds: number = Math.round((durationInMs % 60000) / 1000);

  return `${minutes}m ${seconds}s`;
};

/*
 * The timeline's column: the numbered dot sits in it and the line joining one
 * step to the next runs down its middle. The card starts just past it.
 */
const TIMELINE_ITEM_CLASS: string = "relative pl-10";
const TIMELINE_DOT_CLASS: string =
  "absolute left-0 top-3 flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white ring-4 ring-white";
const TIMELINE_LINE_CLASS: string =
  "absolute left-[13px] top-10 -bottom-3 w-0.5 bg-gray-200";

interface PortChipProps {
  title: string;
  description: string | null;
  tone: StepPortTone;
}

/*
 * The output a step took, named as the canvas names it, with the canvas's own
 * tooltip. The Error output is the one that means something went wrong, so it
 * is the only one drawn in red: Yes and No are both just the way it went.
 */
const PortChip: FunctionComponent<PortChipProps> = (
  props: PortChipProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const chip: ReactElement = (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${
        props.tone === StepPortTone.Error
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-indigo-200 bg-indigo-50 text-indigo-700"
      }`}
      data-testid="workflow-run-step-port"
    >
      {translator.translateText(props.title)}
    </span>
  );

  if (!props.description) {
    return chip;
  }

  return (
    <Tooltip text={translator.translateText(props.description) || ""}>
      {chip}
    </Tooltip>
  );
};

interface NextStepLabelProps {
  next: StepOutcomeNextStep;
  /** What a next step that has not run says, which depends on the run. */
  notRunLabel: string;
  /** Another step follows this one in the list. */
  isFollowed: boolean;
}

/*
 * Plain inline text with real spaces, not a row of flex items: the line then
 * reads as one sentence when it is copied or read out, and the comma that
 * separates two next steps stays against the first rather than a gap away.
 */
const NextStepLabel: FunctionComponent<NextStepLabelProps> = (
  props: NextStepLabelProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const didRun: boolean = props.next.stepNumber !== null;

  return (
    <span data-testid="workflow-run-step-next">
      {didRun && (
        <>
          <span className="text-gray-500">
            {translator.translateTemplate("Step {{number}}", {
              number: props.next.stepNumber || 0,
            })}
          </span>{" "}
        </>
      )}
      <span className="font-medium text-gray-900">{props.next.title}</span>{" "}
      <code className="whitespace-nowrap font-mono text-xs text-gray-500">
        {props.next.componentId}
      </code>
      {!didRun && (
        <>
          {" "}
          <span className="text-gray-500">
            {translator.translateText(props.notRunLabel)}
          </span>
        </>
      )}
      {props.isFollowed && <span className="text-gray-500">,</span>}
    </span>
  );
};

interface StepOutcomeLineProps {
  outcome: StepOutcome;
  isFailed: boolean;
  isLastStep: boolean;
  notRunLabel: string;
}

/*
 * Which way the step went, as a sentence: "Took No → Step 3 Send Email". It
 * is shown whether or not the step is open, because it is the first thing
 * anyone reading a run wants from a step.
 */
const StepOutcomeLine: FunctionComponent<StepOutcomeLineProps> = (
  props: StepOutcomeLineProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  const outcome: StepOutcome = props.outcome;

  if (outcome.kind === StepOutcomeKind.NoPort || !outcome.portTitle) {
    // A failed step's own error says what happened instead.
    if (props.isFailed) {
      return null;
    }

    return (
      <p
        className="text-sm text-gray-600"
        data-testid="workflow-run-step-outcome"
      >
        {translator.translateText("Took no output, so the run ended here.")}
      </p>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm"
      data-testid="workflow-run-step-outcome"
    >
      <TranslatedSentence
        template="Took {{port}}"
        slots={{
          port: (
            <PortChip
              title={outcome.portTitle}
              description={outcome.portDescription}
              tone={outcome.portTone}
            />
          ),
        }}
        renderText={(text: string): ReactElement => {
          /*
           * The words in a span of their own, so the row's gap spaces them.
           * The spaces around them stay as text: a flex row does not draw
           * them, but they keep "Took" and the output apart for anything
           * that reads the line out.
           */
          return (
            <>
              {text.trimStart() === text ? "" : " "}
              <span className="text-gray-500">{text.trim()}</span>
              {text.trimEnd() === text ? "" : " "}
            </>
          );
        }}
      />
      {outcome.kind === StepOutcomeKind.LedTo && (
        <>
          {" "}
          <span aria-hidden="true" className="text-gray-400">
            →
          </span>{" "}
          <span className="sr-only">
            {translator.translateText("which led to")}
          </span>{" "}
          {outcome.nextSteps.map(
            (next: StepOutcomeNextStep, nextIndex: number) => {
              return (
                <React.Fragment key={next.componentId}>
                  {nextIndex > 0 && " "}
                  <NextStepLabel
                    next={next}
                    notRunLabel={props.notRunLabel}
                    isFollowed={nextIndex < outcome.nextSteps.length - 1}
                  />
                </React.Fragment>
              );
            },
          )}
        </>
      )}
      {outcome.kind === StepOutcomeKind.NothingConnected && (
        <>
          {" "}
          <span className="text-gray-600">
            {translator.translateText(
              props.isLastStep
                ? "Nothing is connected to it, so the run ended here."
                : "Nothing is connected to it, so this branch ended here.",
            )}
          </span>
        </>
      )}
    </div>
  );
};

interface StatusBadgeProps {
  isFailed: boolean;
}

const StatusBadge: FunctionComponent<StatusBadgeProps> = (
  props: StatusBadgeProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
        props.isFailed
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700"
      }`}
      data-testid="workflow-run-step-status"
    >
      {translator.translateText(props.isFailed ? "Failed" : "Succeeded")}
    </span>
  );
};

interface ValueTextProps {
  value: TraceValueDisplay;
}

/*
 * One recorded value. font-mono sits on the element that holds the text
 * itself: every frontend's index.ejs sets `* { font-family: Inter }`, which a
 * nested span would match instead of inheriting the monospace.
 */
const ValueText: FunctionComponent<ValueTextProps> = (
  props: ValueTextProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const value: TraceValueDisplay = props.value;

  if (value.kind === TraceValueKind.EmptyText) {
    return (
      <span className="text-xs italic text-gray-500">
        {translator.translateText("Empty text")}
      </span>
    );
  }

  if (value.kind === TraceValueKind.Null) {
    return <code className="font-mono text-xs text-gray-500">null</code>;
  }

  if (value.kind === TraceValueKind.Text && isWholeReference(value.text)) {
    return (
      <BreakableCode
        text={value.text}
        breakAfter="."
        className="text-xs text-gray-900"
      />
    );
  }

  if (value.isBlock) {
    return (
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-800">
        {value.text}
      </pre>
    );
  }

  return (
    <code className="whitespace-pre-wrap break-words font-mono text-xs text-gray-900">
      {value.text}
    </code>
  );
};

interface TemplateTextProps {
  text: string;
}

const TemplateText: FunctionComponent<TemplateTextProps> = (
  props: TemplateTextProps,
): ReactElement => {
  if (isWholeReference(props.text)) {
    return (
      <BreakableCode
        text={props.text}
        breakAfter="."
        className="text-xs text-gray-600"
      />
    );
  }

  return (
    <code className="whitespace-pre-wrap break-words font-mono text-xs text-gray-600">
      {props.text}
    </code>
  );
};

interface ValueSectionProps {
  title: string;
  rows: Array<StepValueRow>;
  emptyText: string;
  /** Show each value's id beside its name: a reference reads a value by id. */
  showIds?: boolean | undefined;
}

const ValueSection: FunctionComponent<ValueSectionProps> = (
  props: ValueSectionProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        {translator.translateText(props.title)}
      </p>
      {props.rows.length === 0 ? (
        <p className="text-sm text-gray-500">
          {translator.translateText(props.emptyText)}
        </p>
      ) : (
        /*
         * Name beside value from sm up, so a step with six short arguments
         * takes six lines rather than twelve; stacked on a phone, where the
         * value needs the whole width.
         */
        <dl className="space-y-3 sm:space-y-2">
          {props.rows.map((row: StepValueRow) => {
            return (
              <div
                key={row.id}
                className="sm:flex sm:items-baseline sm:gap-4"
                data-testid="workflow-run-step-value"
              >
                <dt className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-gray-600 sm:w-44 sm:shrink-0">
                  <span>{row.name}</span>
                  {props.showIds && row.id !== row.name && (
                    <code className="font-mono text-[11px] font-normal text-gray-500">
                      {row.id}
                    </code>
                  )}
                  {row.unresolvedReferences.length > 0 && (
                    <span
                      className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800"
                      data-testid="workflow-run-step-unresolved"
                    >
                      {translator.translateText("Did not resolve")}
                    </span>
                  )}
                </dt>
                <dd className="mt-1 min-w-0 sm:mt-0 sm:flex-1">
                  <ValueText value={row.value} />
                  {row.template !== null && (
                    <p
                      className="mt-1 text-xs text-gray-500"
                      data-testid="workflow-run-step-template"
                    >
                      <TranslatedSentence
                        template="from {{template}}"
                        slots={{
                          template: <TemplateText text={row.template} />,
                        }}
                      />
                    </p>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
};

interface StepItemProps {
  trace: WorkflowStepTrace;
  step: WorkflowStepTraceEntry;
  index: number;
  /** No step and no "run stopped" note follows it. */
  isLastInList: boolean;
  /** The last step the run recorded. */
  isLastStep: boolean;
  notRunLabel: string;
}

const StepItem: FunctionComponent<StepItemProps> = (
  props: StepItemProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(
    shouldStepStartOpen(props.trace, props.index),
  );
  const detailsId: string = `${useId()}-step-details`;

  const step: WorkflowStepTraceEntry = props.step;
  const isFailed: boolean = isStepFailed(step);
  const warnings: Array<WorkflowStepTraceWarning> = getStepWarnings(step);
  const outcome: StepOutcome = getStepOutcome(props.trace, props.index);

  /*
   * Only the runner writes a trace, and it writes text here, but a row is
   * read back from JSON: anything else would stop the whole view rendering,
   * so it is read as text or not at all.
   */
  const componentId: string =
    typeof step.componentId === "string" ? step.componentId : "";
  const title: string =
    typeof step.title === "string" && step.title ? step.title : componentId;
  const errorMessage: string | null =
    typeof step.errorMessage === "string" && step.errorMessage
      ? step.errorMessage
      : null;

  const dotColour: string = isFailed
    ? "bg-red-500"
    : warnings.length > 0
      ? "bg-amber-500"
      : "bg-emerald-500";

  const durationInMs: number =
    typeof step.durationInMs === "number" && step.durationInMs >= 0
      ? step.durationInMs
      : 0;

  return (
    <li className={TIMELINE_ITEM_CLASS} data-testid="workflow-run-step">
      {!props.isLastInList && (
        <div aria-hidden="true" className={TIMELINE_LINE_CLASS} />
      )}
      <div aria-hidden="true" className={`${TIMELINE_DOT_CLASS} ${dotColour}`}>
        {props.index + 1}
      </div>

      <div
        className={`rounded-lg border bg-white ${
          isFailed ? "border-red-200" : "border-gray-200"
        }`}
      >
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={isOpen ? detailsId : undefined}
          className="flex w-full cursor-pointer items-start gap-3 rounded-lg px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          onClick={() => {
            setIsOpen(!isOpen);
          }}
        >
          <span className="min-w-0 flex-1">
            <span className="sr-only">
              {translator.translateTemplate("Step {{number}}:", {
                number: props.index + 1,
              })}{" "}
            </span>
            <span className="block break-words text-sm font-semibold text-gray-900">
              {title}
            </span>
            <span className="block break-all font-mono text-xs text-gray-500">
              {componentId}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <StatusBadge isFailed={isFailed} />
            <span className="text-xs tabular-nums text-gray-500">
              {formatStepDuration(durationInMs)}
            </span>
            <Icon
              icon={IconProp.ChevronDown}
              className={`h-4 w-4 text-gray-400 transition-transform ${
                isOpen ? "rotate-180" : ""
              }`}
            />
          </span>
        </button>

        <div className="space-y-2 px-4 pb-3">
          <StepOutcomeLine
            outcome={outcome}
            isFailed={isFailed}
            isLastStep={props.isLastStep}
            notRunLabel={props.notRunLabel}
          />

          {isFailed && errorMessage && (
            <div
              className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2"
              data-testid="workflow-run-step-error"
            >
              <Icon
                icon={IconProp.Alert}
                className="mt-0.5 h-4 w-4 shrink-0 text-red-500"
              />
              <div className="min-w-0 text-sm">
                <p className="font-medium text-red-800">
                  {translator.translateText("This step failed")}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-red-700">
                  {errorMessage}
                </p>
              </div>
            </div>
          )}

          {warnings.map((warning: WorkflowStepTraceWarning, i: number) => {
            return (
              <div
                key={i}
                className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
                data-testid="workflow-run-step-warning"
              >
                <Icon
                  icon={IconProp.Alert}
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
                />
                <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-amber-800">
                  {warning.message}
                </p>
              </div>
            );
          })}
        </div>

        {isOpen && (
          <div
            id={detailsId}
            className="space-y-4 border-t border-gray-200 px-4 py-3"
            data-testid="workflow-run-step-details"
          >
            <ValueSection
              title="Received"
              rows={getReceivedRows(step)}
              emptyText="Nothing received."
            />
            <ValueSection
              title="Returned"
              rows={getReturnedRows(step)}
              showIds={true}
              emptyText={
                returnsNothingByDesign(step)
                  ? "This step does not return any data."
                  : "Nothing returned."
              }
            />
          </div>
        )}
      </div>
    </li>
  );
};

interface RunStoppedProps {
  message: string;
  hasSteps: boolean;
}

/*
 * The end of a run that stopped for a reason no step carries: it timed out
 * between steps, found a cycle, or never reached its first step. Without it
 * the path would end on a step that worked, with no hint why nothing followed.
 */
const RunStopped: FunctionComponent<RunStoppedProps> = (
  props: RunStoppedProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const note: ReactElement = (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
      <p className="text-sm font-semibold text-red-800">
        {translator.translateText(
          props.hasSteps
            ? "The run stopped here"
            : "The run stopped before its first step",
        )}
      </p>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-red-700">
        {props.message}
      </p>
    </div>
  );

  if (!props.hasSteps) {
    return <div data-testid="workflow-run-stopped">{note}</div>;
  }

  return (
    <li className={TIMELINE_ITEM_CLASS} data-testid="workflow-run-stopped">
      <div aria-hidden="true" className={`${TIMELINE_DOT_CLASS} bg-red-500`}>
        <Icon icon={IconProp.Close} className="h-4 w-4 text-white" />
      </div>
      {note}
    </li>
  );
};

interface RunSleepingProps {
  resumesAt: Date;
}

/*
 * The end of the path for a run parked on a Sleep step. Without it the path
 * would stop at the Sleep with its next step "not run", which reads like a
 * run that broke rather than one that is waiting on purpose.
 */
const RunSleeping: FunctionComponent<RunSleepingProps> = (
  props: RunSleepingProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  return (
    <li className={TIMELINE_ITEM_CLASS} data-testid="workflow-run-sleeping">
      <div aria-hidden="true" className={`${TIMELINE_DOT_CLASS} bg-indigo-500`}>
        <Icon icon={IconProp.Clock} className="h-4 w-4 text-white" />
      </div>
      <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3">
        <p className="text-sm font-semibold text-indigo-800">
          {translator.translateText("Sleeping")}
        </p>
        <p className="mt-0.5 text-sm text-indigo-700">
          {translator.translateTemplate(
            "The run carries on by itself at {{time}}. The steps after the Sleep have not run yet.",
            {
              time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                props.resumesAt,
              ),
            },
          )}
        </p>
      </div>
    </li>
  );
};

const StepTraceViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const steps: Array<WorkflowStepTraceEntry> = getTraceSteps(props.trace);
  const runErrorMessage: string | null =
    typeof props.trace?.runErrorMessage === "string" &&
    props.trace.runErrorMessage
      ? props.trace.runErrorMessage
      : null;
  const singleStepRun: boolean = isSingleStepRun(props.trace);
  const resumesAt: Date | null = runErrorMessage
    ? null
    : getTraceResumesAt(props.trace);

  /*
   * A step the output led to that is not in the trace: in a test of one
   * step it was never going to run, in a sleeping run it has not run yet,
   * and otherwise the run stopped before it.
   */
  const notRunLabel: string = singleStepRun
    ? translationKey("(not run in this test)")
    : resumesAt
      ? translationKey("(not run yet)")
      : translationKey("(did not run)");

  if (steps.length === 0) {
    if (runErrorMessage) {
      return <RunStopped message={runErrorMessage} hasSteps={false} />;
    }

    if (props.isRunning) {
      return (
        <p className="text-sm text-gray-500">
          {translator.translateText(
            "The steps show here once the run finishes.",
          )}
        </p>
      );
    }

    return (
      <p className="text-sm text-gray-500">
        {translator.translateText(
          "This run has no recorded steps. Runs from before step recording was added show only their full log.",
        )}
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="workflow-run-steps">
      {singleStepRun && (
        <div
          className="flex items-start gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2"
          data-testid="workflow-run-single-step-note"
        >
          <Icon
            icon={IconProp.Info}
            className="mt-0.5 h-4 w-4 shrink-0 text-blue-500"
          />
          <div className="min-w-0 text-sm">
            <p className="font-medium text-blue-800">
              {translator.translateText("Only this step ran")}
            </p>
            <p className="mt-0.5 text-blue-700">
              {translator.translateText(
                "This was a test of one step. The steps before it did not run, so values it reads from them are missing, and the steps after it were not started. Use Run Workflow to try the whole workflow.",
              )}
            </p>
          </div>
        </div>
      )}

      {props.trace.truncated && (
        <p className="text-sm text-amber-700">
          {translator.translatePlural(
            {
              one: "Only the last {{count}} step of this run was kept.",
              other: "Only the last {{count}} steps of this run were kept.",
            },
            steps.length,
          )}
        </p>
      )}

      <ol
        className="space-y-3"
        aria-label={translator.translateText("Steps, in the order they ran")}
      >
        {steps.map((step: WorkflowStepTraceEntry, index: number) => {
          const isLastStep: boolean = index === steps.length - 1;

          return (
            <StepItem
              key={index}
              trace={props.trace}
              step={step}
              index={index}
              isLastStep={isLastStep}
              isLastInList={isLastStep && !runErrorMessage && !resumesAt}
              notRunLabel={notRunLabel}
            />
          );
        })}

        {runErrorMessage && (
          <RunStopped message={runErrorMessage} hasSteps={true} />
        )}

        {resumesAt && <RunSleeping resumesAt={resumesAt} />}
      </ol>
    </div>
  );
};

export default StepTraceViewer;
