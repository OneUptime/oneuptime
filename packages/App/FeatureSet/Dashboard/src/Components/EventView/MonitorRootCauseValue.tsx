import { JSONObject } from "Common/Types/JSON";
import MonitorEvaluationDetails from "Common/Types/Monitor/MonitorEvaluationDetails";
import EmptyValue from "Common/UI/Components/Detail/EmptyValue";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import MonitorEvaluationDetailsUtil from "Common/Utils/Monitor/MonitorEvaluationDetailsUtil";
import MonitorRootCauseWording from "Common/Utils/Monitor/MonitorRootCauseWording";
import React, { FunctionComponent, ReactElement } from "react";
import { EVALUATION_TEXT_OPTIONS } from "../../Utils/EvaluationText";

export interface ComponentProps {
  rootCause?: string | undefined;
  // The record's stored evaluation details, as read.
  evaluationDetails?: JSONObject | undefined;
  placeholder: string;
}

/*
 * An incident's or an alert's root cause on its Root Cause page, as a
 * detail card shows Markdown - with what a monitor wrote in it in the
 * reader's language as far as it goes (MonitorRootCauseWording), as the
 * overview's What happened card shows it.
 */
const MonitorRootCauseValue: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const storedRootCause: string = props.rootCause?.trim() || "";

  if (!storedRootCause) {
    return <EmptyValue placeholder={props.placeholder} />;
  }

  const evaluationDetails: MonitorEvaluationDetails | null =
    MonitorEvaluationDetailsUtil.deserialize(props.evaluationDetails);

  /*
   * The viewer spaces its paragraphs and lists apart; the first's space
   * above and the last's below would put the text further from the card's
   * top than any other value is (Detail's own Markdown value does the same).
   */
  return (
    <div
      className="[&>div>*:first-child]:mt-0 [&>div>*:last-child]:mb-0"
      data-testid="detail-markdown-value"
    >
      <MarkdownViewer
        text={MonitorRootCauseWording.wordRootCause({
          rootCause: storedRootCause,
          translator: translator,
          findings: evaluationDetails?.filters,
          options: EVALUATION_TEXT_OPTIONS,
        })}
      />
    </div>
  );
};

export default MonitorRootCauseValue;
