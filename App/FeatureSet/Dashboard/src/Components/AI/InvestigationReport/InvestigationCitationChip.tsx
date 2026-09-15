import { formatEvidenceLabel } from "../../../Utils/InvestigationEvidenceFormat";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  citationId: string;
  label: string;
  onActivate: (citationId: string) => void;
}

export const CITATION_CHIP_CLASS_NAME: string =
  "mx-0.5 inline-flex h-[18px] items-center rounded px-1 align-baseline text-[11px] font-semibold tabular-nums bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200 hover:bg-indigo-50 hover:text-indigo-700 hover:ring-indigo-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

/*
 * An inline "[C11]" marker in the report prose, turned into a small button
 * that jumps to the query behind it in "Evidence checked". Rendered only for
 * citations that exist in that list, so every chip has somewhere to go.
 */
const InvestigationCitationChip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
      aria-label={`Citation ${props.citationId}: ${spokenLabel}`}
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
