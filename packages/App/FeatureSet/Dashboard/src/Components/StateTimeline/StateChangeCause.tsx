import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import StatusChangeCauseWording from "Common/Utils/Monitor/StatusChangeCauseWording";
import React, { FunctionComponent, ReactElement } from "react";
import { EVALUATION_TEXT_OPTIONS } from "../../Utils/EvaluationText";

/*
 * WHY A STATUS OR A STATE CHANGED, AS VIEW CAUSE SHOWS IT (#9752).
 *
 * A monitor's Status Timeline, and an incident's and an alert's State
 * Timeline, open each change's root cause from View Cause - the table's
 * button and the timeline's link. It was drawn as stored, in English, laid
 * out from the left on a page read from the right; the same Markdown on an
 * incident's Root Cause page read in the reader's language
 * (MonitorRootCauseValue). Both now word it one way
 * (StatusChangeCauseWording): OneUptime's own labels, notes, yes or no,
 * phases and figures in the reader's language, each finding from the
 * sentence the change's own check kept, every value set apart as stored.
 *
 * The timeline view hands its cause to wordStateChangeCause (its
 * `wordCause`); the table's View Cause opens StateChangeCauseModal.
 */

// A change's cause in the reader's language, as View Cause draws it.
export function wordStateChangeCause(data: {
  translator: Translator;
  cause: string;
  // The change's stored check: statusChangeLog or stateChangeLog, as read.
  log: unknown;
}): string {
  return StatusChangeCauseWording.wordCause({
    rootCause: data.cause,
    translator: data.translator,
    changeLog: data.log,
    options: EVALUATION_TEXT_OPTIONS,
    setsValuesApart: true,
  });
}

// What a timeline view hands its View Cause (ModelStatusTimeline's wordCause).
export function useWordStateChangeCause(): (data: {
  cause: string;
  log: unknown;
}) => string {
  const translator: Translator = useTranslator();

  return (data: { cause: string; log: unknown }): string => {
    return wordStateChangeCause({
      translator: translator,
      cause: data.cause,
      log: data.log,
    });
  };
}

export interface ComponentProps {
  // The change's root cause as stored; empty when it has none.
  rootCause: string;
  // The change's stored check (statusChangeLog, stateChangeLog), as read.
  changeLog?: unknown;
  // What a change with no cause says, in English: looked up here.
  noCauseText: string;
  onClose: () => void;
}

const StateChangeCauseModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const text: string = props.rootCause.trim()
    ? wordStateChangeCause({
        translator: translator,
        cause: props.rootCause,
        log: props.changeLog,
      })
    : translator.translateText(props.noCauseText) || props.noCauseText;

  return (
    <ConfirmModal
      title={"Root Cause"}
      description={
        <div data-testid="state-change-cause">
          <MarkdownViewer text={text} />
        </div>
      }
      isLoading={false}
      onSubmit={props.onClose}
      submitButtonText={"Close"}
      submitButtonType={ButtonStyleType.NORMAL}
    />
  );
};

export default StateChangeCauseModal;
