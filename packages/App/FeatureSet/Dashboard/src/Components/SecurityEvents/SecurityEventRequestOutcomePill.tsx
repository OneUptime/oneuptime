import React, { FunctionComponent, ReactElement } from "react";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { isSecurityEventRequestOutcome } from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import { getRequestOutcomeColor } from "./SecurityEventRequestStory";
import { REQUEST_OUTCOME_LABELS } from "./SecurityEventRequestCopy";

export interface ComponentProps {
  outcome?: string | undefined;
  size?: PillSize | undefined;
}

/*
 * How far the request behind an event got - Rejected, Reached App, Errored,
 * Reached Database - in the colour of how worried to be. The same words
 * the Request Outcome facet lists, so a reader can filter by what they see.
 * Nothing at all for an event nobody followed.
 */
const SecurityEventRequestOutcomePill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!isSecurityEventRequestOutcome(props.outcome)) {
    return <></>;
  }

  return (
    <Pill
      color={getRequestOutcomeColor(props.outcome)}
      // Pill looks its text up in the reader's language.
      text={REQUEST_OUTCOME_LABELS[props.outcome]}
      size={props.size}
    />
  );
};

export default SecurityEventRequestOutcomePill;
