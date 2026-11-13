import { StoredRuleUpdates } from "Common/Types/Workspace/NotificationRules/NotificationRuleUpdates";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  getUpdatesSummary,
  UpdatesEventType,
  UpdatesSummary,
} from "../NotificationRuleForm/NotificationRuleUpdatesCopy";

/*
 * Which updates a rule posts, on its card (issue #7581):
 *
 *   Updates   Key updates only
 *             Resolved and reopened · Severity changes · Public notes
 *
 * The answer it picked on its Updates step, and the updates it posts. The
 * card shows the row only for a rule that leaves some updates out: every
 * other rule posts every update, as rules always did.
 */

export interface ComponentProps {
  rule: StoredRuleUpdates;
  eventType: UpdatesEventType;
}

const UpdatesRuleSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const summary: UpdatesSummary = getUpdatesSummary({
    rule: props.rule,
    eventType: props.eventType,
    translator: translator,
  });

  return (
    <div className="text-sm" data-testid="notification-rule-updates-summary">
      <p
        className="text-gray-700"
        data-testid="notification-rule-updates-summary-title"
      >
        {summary.title}
      </p>
      {summary.detail ? (
        <p
          className="mt-0.5 text-pretty text-gray-500"
          data-testid="notification-rule-updates-summary-detail"
        >
          {summary.detail}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default UpdatesRuleSummary;
