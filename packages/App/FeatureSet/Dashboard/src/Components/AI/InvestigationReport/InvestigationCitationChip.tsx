import { formatEvidenceLabel } from "../../../Utils/InvestigationEvidenceFormat";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  citationId: string;
  label: string;
  onActivate: (citationId: string) => void;
}

/*
 * A citation mark reads as a footnote, never as code: a small round pill,
 * a little raised, in the text's own font and with no frame - where the
 * inline code beside it ("`checkout-api`") is a framed monospace box. Both
 * used to be framed grey boxes of one size, so an answer read as a row of
 * code spans. Shared by the report, an incident's AI conversation and Ask
 * AI, so a mark looks the same wherever OneUptime AI cites. Proportional
 * figures: Inter's tabular "1" has a foot, and drew "C1" as typewriter
 * text.
 */
export const CITATION_CHIP_CLASS_NAME: string =
  "mx-0.5 inline-flex h-4 min-w-[1.375rem] items-center justify-center rounded-full px-1.5 align-[0.1em] text-[10px] font-semibold leading-none bg-gray-100 text-gray-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

/*
 * An inline "[C11]" marker in the report prose, turned into a small button
 * that jumps to the query behind it in "Evidence checked". Rendered only for
 * citations that exist in that list, so every chip has somewhere to go.
 */
const InvestigationCitationChip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * Read aloud the way the evidence row shows it (local times, not ISO
   * timestamps); the tooltip keeps the raw label, like the row's does.
   */
  const spokenLabel: string = formatEvidenceLabel(props.label);

  return (
    <button
      type="button"
      className={CITATION_CHIP_CLASS_NAME}
      title={props.label}
      aria-label={translator.translateTemplate("Citation {{id}}: {{label}}", {
        id: props.citationId,
        label: spokenLabel,
      })}
      data-citation-id={props.citationId}
      onClick={() => {
        props.onActivate(props.citationId);
      }}
    >
      {props.citationId}
    </button>
  );
};

export default InvestigationCitationChip;
