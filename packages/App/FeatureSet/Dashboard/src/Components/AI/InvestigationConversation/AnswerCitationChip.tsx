import { navigateToCitationTarget } from "../../AIChat/CitationTargetNav";
import { CITATION_CHIP_CLASS_NAME } from "../InvestigationReport/InvestigationCitationChip";
import { AIChatCitation } from "Common/Types/AI/AIChatTypes";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  citation: AIChatCitation;
}

/*
 * An inline "[C2]" in an answer, as a small chip that names what it cites
 * and — when the evidence has a page (logs, traces, a monitor) — opens it.
 * A citation with nowhere to go (a kubectl command) stays a plain chip with
 * its label on hover, rather than a button that does nothing.
 *
 * Drawn in the answers of an incident's or alert's conversation and in Ask
 * AI's: one chip for the same mark wherever OneUptime AI answers.
 */
const AnswerCitationChip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const label: string = translator.translateTemplate(
    "Citation {{id}}: {{label}}",
    { id: props.citation.id, label: props.citation.label },
  );

  if (!props.citation.target) {
    return (
      <span
        className={CITATION_CHIP_CLASS_NAME}
        title={props.citation.label}
        aria-label={label}
        data-citation-id={props.citation.id}
      >
        {props.citation.id}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={CITATION_CHIP_CLASS_NAME}
      title={props.citation.label}
      aria-label={label}
      data-citation-id={props.citation.id}
      onClick={() => {
        navigateToCitationTarget(props.citation.target);
      }}
    >
      {props.citation.id}
    </button>
  );
};

export default AnswerCitationChip;
