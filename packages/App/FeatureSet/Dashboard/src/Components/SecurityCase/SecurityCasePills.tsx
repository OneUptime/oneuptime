import { Gray500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import { getSecurityCaseAiVerdictColor } from "Common/Types/SecurityCase/SecurityCaseAiVerdict";
import { getSecurityCaseVerdictColor } from "Common/Types/SecurityCase/SecurityCaseVerdict";
import SecurityDetectionSource from "Common/Types/SecurityCase/SecurityDetectionSource";
import {
  getSecurityPlaybookRunStatusColor,
  getSecurityPlaybookStepStatusColor,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The pills a case, a detection and a playbook run are read by. A case's
 * priority and status are the project's own (Security Events > Settings):
 * each pill shows the name and colour the project gave it, so the queue,
 * the case page and the overview never disagree. The other values take
 * their color from the type they show (Common/Types/SecurityCase). The text
 * is the record's own value; Pill translates it (SecurityCaseTerms.ts
 * registers every built-in one).
 */

interface ValuePillProps {
  value: string | undefined | null;
  size?: PillSize | undefined;
  isMinimal?: boolean | undefined;
}

// A pill that says more on hover: OneUptime AI's read, a run's status.
interface TooltipPillProps extends ValuePillProps {
  // Already in the reader's language.
  tooltip?: string | undefined;
}

const NoValue: FunctionComponent = (): ReactElement => {
  return <span className="text-gray-400">-</span>;
};

// A priority or a status of the project's: its name and its colour.
export interface SecurityCaseValueLike {
  name?: string | undefined;
  color?: Color | undefined;
}

interface CaseValuePillProps {
  value: SecurityCaseValueLike | undefined | null;
  size?: PillSize | undefined;
  isMinimal?: boolean | undefined;
  tooltip?: string | undefined;
}

const CaseValuePill: FunctionComponent<CaseValuePillProps> = (
  props: CaseValuePillProps,
): ReactElement => {
  if (!props.value?.name) {
    return <NoValue />;
  }

  return (
    <Pill
      text={props.value.name}
      color={props.value.color || Gray500}
      size={props.size}
      isMinimal={props.isMinimal}
      tooltip={props.tooltip}
    />
  );
};

export const SecurityCasePriorityPill: FunctionComponent<
  CaseValuePillProps
> = (props: CaseValuePillProps): ReactElement => {
  return <CaseValuePill {...props} />;
};

export const SecurityCaseStatusPill: FunctionComponent<CaseValuePillProps> = (
  props: CaseValuePillProps,
): ReactElement => {
  return <CaseValuePill {...props} />;
};

/*
 * OneUptime AI's read of a case (SecurityCaseAiVerdict), in the colors of
 * the verdicts each read suggests, with the AI mark in front so it is never
 * taken for the verdict a person set.
 */
export const SecurityCaseAiVerdictPill: FunctionComponent<TooltipPillProps> = (
  props: TooltipPillProps,
): ReactElement => {
  if (!props.value) {
    return <NoValue />;
  }

  return (
    <Pill
      text={props.value}
      icon={IconProp.Sparkles}
      color={getSecurityCaseAiVerdictColor(props.value)}
      size={props.size}
      isMinimal={props.isMinimal}
      tooltip={props.tooltip}
    />
  );
};

export const SecurityCaseVerdictPill: FunctionComponent<ValuePillProps> = (
  props: ValuePillProps,
): ReactElement => {
  if (!props.value) {
    return <NoValue />;
  }

  return (
    <Pill
      text={props.value}
      color={getSecurityCaseVerdictColor(props.value)}
      size={props.size}
      isMinimal={props.isMinimal}
    />
  );
};

export const SecurityPlaybookRunStatusPill: FunctionComponent<
  TooltipPillProps
> = (props: TooltipPillProps): ReactElement => {
  if (!props.value) {
    return <NoValue />;
  }

  return (
    <Pill
      text={props.value}
      color={getSecurityPlaybookRunStatusColor(props.value)}
      size={props.size}
      isMinimal={props.isMinimal}
      tooltip={props.tooltip}
    />
  );
};

export const SecurityPlaybookStepStatusPill: FunctionComponent<
  ValuePillProps
> = (props: ValuePillProps): ReactElement => {
  if (!props.value) {
    return <NoValue />;
  }

  return (
    <Pill
      text={props.value}
      color={getSecurityPlaybookStepStatusColor(props.value)}
      size={props.size}
      isMinimal={props.isMinimal}
    />
  );
};

// Whose judgement a detection is: a rule's, threat intelligence's, a product's or a person's.
export function getSecurityDetectionSourceIcon(
  source: SecurityDetectionSource | string | undefined | null,
): IconProp {
  switch (source) {
    case SecurityDetectionSource.DetectionRule:
      return IconProp.ShieldCheck;
    case SecurityDetectionSource.ThreatIntel:
      return IconProp.Bug;
    case SecurityDetectionSource.ConnectedProduct:
      return IconProp.Link;
    case SecurityDetectionSource.Manual:
      return IconProp.User;
    default:
      return IconProp.Circle;
  }
}
