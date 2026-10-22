import IconProp from "Common/Types/Icon/IconProp";
import { getSecurityCaseAiVerdictColor } from "Common/Types/SecurityCase/SecurityCaseAiVerdict";
import { getSecurityCasePriorityColor } from "Common/Types/SecurityCase/SecurityCasePriority";
import { getSecurityCaseStatusColor } from "Common/Types/SecurityCase/SecurityCaseStatus";
import { getSecurityCaseVerdictColor } from "Common/Types/SecurityCase/SecurityCaseVerdict";
import SecurityDetectionSource from "Common/Types/SecurityCase/SecurityDetectionSource";
import {
  getSecurityPlaybookRunStatusColor,
  getSecurityPlaybookStepStatusColor,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The pills a case, a detection and a playbook run are read by. Each takes
 * its color from the type it shows (Common/Types/SecurityCase), so the
 * queue, the case page and the overview never disagree on what red means.
 * The text is the record's own value; Pill translates it
 * (SecurityCaseTerms.ts registers every one).
 */

interface ValuePillProps {
  value: string | undefined | null;
  size?: PillSize | undefined;
  isMinimal?: boolean | undefined;
}

const NoValue: FunctionComponent = (): ReactElement => {
  return <span className="text-gray-400">-</span>;
};

export const SecurityCasePriorityPill: FunctionComponent<ValuePillProps> = (
  props: ValuePillProps,
): ReactElement => {
  if (!props.value) {
    return <NoValue />;
  }

  return (
    <Pill
      text={props.value}
      color={getSecurityCasePriorityColor(props.value)}
      size={props.size}
      isMinimal={props.isMinimal}
    />
  );
};

export const SecurityCaseStatusPill: FunctionComponent<ValuePillProps> = (
  props: ValuePillProps,
): ReactElement => {
  if (!props.value) {
    return <NoValue />;
  }

  return (
    <Pill
      text={props.value}
      color={getSecurityCaseStatusColor(props.value)}
      size={props.size}
      isMinimal={props.isMinimal}
    />
  );
};

/*
 * OneUptime AI's read of a case (SecurityCaseAiVerdict), in the colors of
 * the verdicts each read suggests, with the AI mark in front so it is never
 * taken for the verdict a person set.
 */
export const SecurityCaseAiVerdictPill: FunctionComponent<ValuePillProps> = (
  props: ValuePillProps,
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
  ValuePillProps
> = (props: ValuePillProps): ReactElement => {
  if (!props.value) {
    return <NoValue />;
  }

  return (
    <Pill
      text={props.value}
      color={getSecurityPlaybookRunStatusColor(props.value)}
      size={props.size}
      isMinimal={props.isMinimal}
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
