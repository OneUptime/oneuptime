import {
  SECURITY_EVENT_RETENTION_TEST_IDS,
  SETTINGS_MORE_RULES,
  SETTINGS_RULES_PAST_RETENTION_TITLE,
  SETTINGS_RULE_LOOKBACK,
} from "./SecurityEventRetentionCopy";
import {
  SettingsRetentionWarning,
  getSettingsRetentionWarning,
  writeRetentionSentence,
} from "./SecurityEventRetentionModel";
import useSecurityEventRetention from "./UseSecurityEventRetention";
import { formatTimespan } from "../Timespan";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DetectionRulePastRetention,
  SecurityEventRetentionStatus,
} from "Common/Types/SecurityEvent/SecurityEventRetention";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator, composedValue } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * ENABLED RULES THAT LOOK BACK FURTHER THAN SECURITY EVENTS ARE KEPT
 * (#10432), on Settings -> Telemetry, under the Default Retention that
 * decides it. A project at the 15 days it started with, running the Rule
 * Library's 30-day First seen rules, is told which rules see only 15 days,
 * that a First seen rule then takes a value last seen before for new, and
 * the retention that covers them all - so the cost of keeping more, and
 * what it buys, is decided here, by a person.
 *
 * Shown only then: nothing while every enabled rule fits, while the person
 * may not read detection rules, or when it could not be read.
 */
export interface ComponentProps {
  // Its place on the page, such as the margin below it; nothing is drawn when it says nothing.
  className?: string | undefined;
}

const RulesPastRetentionNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const retention: SecurityEventRetentionStatus | null =
    useSecurityEventRetention();

  const warning: SettingsRetentionWarning | null =
    getSettingsRetentionWarning(retention);

  if (!warning) {
    return <></>;
  }

  return (
    <div
      role="status"
      data-testid={SECURITY_EVENT_RETENTION_TEST_IDS.settingsNotice}
      className={`flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 ${props.className || ""}`}
    >
      <Icon
        icon={IconProp.Alert}
        className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700"
      />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-semibold text-amber-900">
          {translator.translatePlural(
            SETTINGS_RULES_PAST_RETENTION_TITLE,
            warning.count,
          )}
        </p>
        <p>{writeRetentionSentence(translator, warning.description)}</p>
        <ul className="list-disc space-y-1 pl-5">
          {warning.listed.map(
            (rule: DetectionRulePastRetention): ReactElement => {
              return (
                <li
                  key={rule.id}
                  data-testid={SECURITY_EVENT_RETENTION_TEST_IDS.settingsRule}
                >
                  <TranslatedSentence
                    template={SETTINGS_RULE_LOOKBACK}
                    slots={{
                      rule: (
                        <IsolatedText
                          text={rule.name}
                          className="font-medium text-amber-900"
                        />
                      ),
                    }}
                    values={{
                      lookback: composedValue((inSentence: Translator) => {
                        return formatTimespan(
                          rule.lookbackInSeconds,
                          inSentence,
                        );
                      }),
                    }}
                  />
                </li>
              );
            },
          )}
          {warning.moreCount > 0 ? (
            <li
              data-testid={SECURITY_EVENT_RETENTION_TEST_IDS.settingsMoreRules}
            >
              {translator.translatePlural(
                SETTINGS_MORE_RULES,
                warning.moreCount,
              )}
            </li>
          ) : (
            <></>
          )}
        </ul>
      </div>
    </div>
  );
};

export default RulesPastRetentionNotice;
