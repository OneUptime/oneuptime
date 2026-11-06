import { IMPACT_ASPECT_ICONS } from "./InvestigationReport/InvestigationReportView";
import {
  getInvestigationImpactLines,
  INVESTIGATION_IMPACT_LIST_LABEL,
  InvestigationImpactLineWords,
} from "./InvestigationImpactCopy";
import { InvestigationImpactNumbers } from "Common/Utils/AI/InvestigationImpactNumbers";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  numbers: InvestigationImpactNumbers;
}

/*
 * Who and what the incident or alert hurts, under the folded
 * Investigation step's summary (InvestigationImpactCopy): one short line
 * each - "1,240 requests affected", "2 services affected", "1 of 2 SLOs
 * affected" - with the marks the full report's Impact lines have, side by
 * side while they fit and one under another on a phone. Quiet text and
 * marks, never pills or a box: the AI card is the only frame.
 */
const InvestigationFoldedImpact: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const lines: Array<InvestigationImpactLineWords> =
    getInvestigationImpactLines(props.numbers, translator);

  if (lines.length === 0) {
    return <></>;
  }

  return (
    <ul
      data-testid="investigation-folded-impact"
      aria-label={translator.translateText(INVESTIGATION_IMPACT_LIST_LABEL)}
      className="flex flex-wrap gap-x-5 gap-y-1.5"
    >
      {lines.map((line: InvestigationImpactLineWords): ReactElement => {
        return (
          <li
            key={line.aspect}
            data-testid="investigation-folded-impact-line"
            data-aspect={line.aspect}
            className="flex min-w-0 items-center gap-1.5 text-sm leading-6 text-gray-700"
          >
            {/* A div, not a span: Icon renders its own div around the svg. */}
            <div className="flex h-6 w-4 flex-shrink-0 items-center justify-center">
              <Icon
                icon={IMPACT_ASPECT_ICONS[line.aspect]}
                className="h-4 w-4 flex-shrink-0 text-gray-400"
              />
            </div>
            <span
              data-testid="investigation-folded-impact-words"
              className="min-w-0 break-words"
            >
              {line.text}
            </span>
          </li>
        );
      })}
    </ul>
  );
};

export default InvestigationFoldedImpact;
