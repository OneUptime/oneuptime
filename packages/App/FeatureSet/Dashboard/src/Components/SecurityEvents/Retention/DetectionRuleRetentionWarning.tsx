import {
  CHANGE_RETENTION,
  SECURITY_EVENT_RETENTION_TEST_IDS,
} from "./SecurityEventRetentionCopy";
import {
  RetentionSentence,
  getDataRetentionSettingsRoute,
  getRuleRetentionWarning,
  writeRetentionSentence,
} from "./SecurityEventRetentionModel";
import useSecurityEventRetention from "./UseSecurityEventRetention";
import AppLink from "../../AppLink/AppLink";
import { DetectionRuleShape } from "../DetectionRuleShape";
import IconProp from "Common/Types/Icon/IconProp";
import { SecurityEventRetentionStatus } from "Common/Types/SecurityEvent/SecurityEventRetention";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  shape: DetectionRuleShape | null;
}

/*
 * A RULE WHOSE WINDOW REACHES PAST THE KEPT EVENTS (#10432), said under the
 * rule: under the Detection Rules form's YAML as it is typed, so it is
 * known before the rule is saved, and in a Rule Library rule's details,
 * before it is added. A First seen rule that looks back 30 days, in a
 * project keeping its security events for 15, takes a value last seen 20
 * days ago for new: this says so, what the rule needs kept, and where the
 * retention is changed.
 *
 * Nothing while the rule is a single one, or the kept events cover its
 * window - and nothing when the retention could not be read.
 */
const DetectionRuleRetentionWarning: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const retention: SecurityEventRetentionStatus | null =
    useSecurityEventRetention();

  const warning: RetentionSentence | null = getRuleRetentionWarning({
    shape: props.shape,
    retentionInDays: retention?.retentionInDays,
  });

  if (!warning) {
    return <></>;
  }

  return (
    <div
      role="status"
      className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
      data-testid={SECURITY_EVENT_RETENTION_TEST_IDS.ruleWarning}
    >
      <Icon
        icon={IconProp.Alert}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700"
      />
      <span className="min-w-0 break-words">
        {writeRetentionSentence(translator, warning)}{" "}
        <AppLink
          className="font-medium text-amber-900 underline hover:text-amber-700"
          to={getDataRetentionSettingsRoute()}
          dataTestId={SECURITY_EVENT_RETENTION_TEST_IDS.changeRetention}
        >
          {translator.translateText(CHANGE_RETENTION) || CHANGE_RETENTION}
        </AppLink>
      </span>
    </div>
  );
};

export default DetectionRuleRetentionWarning;
