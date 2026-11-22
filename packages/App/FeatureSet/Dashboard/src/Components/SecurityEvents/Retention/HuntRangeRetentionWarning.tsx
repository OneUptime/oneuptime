import { SECURITY_EVENT_RETENTION_TEST_IDS } from "./SecurityEventRetentionCopy";
import {
  RetentionSentence,
  getHuntRangeRetentionWarning,
  writeRetentionSentence,
} from "./SecurityEventRetentionModel";
import useSecurityEventRetention from "./UseSecurityEventRetention";
import IconProp from "Common/Types/Icon/IconProp";
import { SecurityEventRetentionStatus } from "Common/Types/SecurityEvent/SecurityEventRetention";
import Icon from "Common/UI/Components/Icon/Icon";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import SecurityHunt from "Common/Models/DatabaseModels/SecurityHunt";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // The hunt's time range, as the form holds it.
  timeRange: unknown;
}

/*
 * A HUNT'S TIME RANGE PAST THE KEPT EVENTS (#10432), said under the range
 * as it is chosen: a hunt over the past three months, in a project keeping
 * its security events for 15 days, finds nothing older than 15 days. One
 * quiet line; nothing for a range the kept events cover, or when the
 * retention could not be read.
 */
const HuntRangeRetentionWarning: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const retention: SecurityEventRetentionStatus | null =
    useSecurityEventRetention();

  const warning: RetentionSentence | null = getHuntRangeRetentionWarning({
    timeRange: typeof props.timeRange === "string" ? props.timeRange : null,
    retentionInDays: retention?.retentionInDays,
  });

  if (!warning) {
    return <></>;
  }

  return (
    <div
      className="mt-1.5 flex items-start gap-1.5 text-sm text-amber-800"
      data-testid={SECURITY_EVENT_RETENTION_TEST_IDS.huntRangeWarning}
    >
      <Icon
        icon={IconProp.Alert}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700"
      />
      <span className="min-w-0">
        {writeRetentionSentence(translator, warning)}
      </span>
    </div>
  );
};

// Under the hunt form's time range: the range the form holds.
export function renderHuntRangeRetentionWarning(
  values: FormValues<SecurityHunt>,
): ReactElement {
  return (
    <HuntRangeRetentionWarning
      timeRange={(values as Record<string, unknown>)["timeRange"]}
    />
  );
}

export default HuntRangeRetentionWarning;
