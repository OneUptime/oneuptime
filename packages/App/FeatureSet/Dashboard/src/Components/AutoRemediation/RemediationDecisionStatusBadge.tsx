import {
  InvestigationStatusIndicator,
  renderInvestigationStatusIndicator,
  STATUS_BADGE_CLASS_NAME,
} from "../AI/InvestigationStatusBadge";
import {
  RemediationDecisionStatus,
  RemediationDecisionTone,
} from "./RemediationDecisionLines";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  status: RemediationDecisionStatus;
}

/*
 * The mark in front of the pill's words, from the AI Investigation card's
 * marks: the two cards sit on the same page, so a remediation that waits
 * pulses like an investigation that runs, and one that acted is checked
 * like a finished report.
 */
export const REMEDIATION_STATUS_INDICATOR: Record<
  RemediationDecisionTone,
  InvestigationStatusIndicator
> = {
  waiting: "live",
  acted: "done",
  attention: "attention",
  info: "idle",
};

/*
 * Except for a decision that needs attention: the investigation marks that
 * with an amber "i", but here the line the pill points to carries a warning
 * triangle, and the pill shows the same one.
 */
export function renderRemediationStatusIndicator(
  tone: RemediationDecisionTone,
): ReactElement {
  if (tone === "attention") {
    return (
      <Icon
        icon={IconProp.Alert}
        className="h-3.5 w-3.5 flex-shrink-0 text-amber-500"
      />
    );
  }

  return renderInvestigationStatusIndicator(REMEDIATION_STATUS_INDICATOR[tone]);
}

/*
 * The Remediation card's status, at the right of its header: what
 * auto-remediation did, in a few words, on the same neutral pill as the AI
 * Investigation card's status. Only the mark carries colour.
 *
 * A div, not a span: Icon renders its own div around the svg.
 */
const RemediationDecisionStatusBadge: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      data-testid="remediation-decision-status"
      data-tone={props.status.tone}
      className={STATUS_BADGE_CLASS_NAME}
    >
      {renderRemediationStatusIndicator(props.status.tone)}
      <span>{translator.translateText(props.status.text)}</span>
    </div>
  );
};

export default RemediationDecisionStatusBadge;
