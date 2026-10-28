import { Black } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  TelemetryAlertRule,
  TelemetryAlertRuleAction,
} from "Common/Types/Monitor/TelemetryAlertRule";
import ObjectID from "Common/Types/ObjectID";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Pill from "Common/UI/Components/Pill/Pill";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import React, { FunctionComponent, ReactElement } from "react";
import { TelemetryRuleCopy } from "../../../Utils/Form/Monitor/TelemetryRule/TelemetryRuleText";
import { getRuleSentenceForStep } from "../../../Utils/Form/Monitor/TelemetryRule/TelemetryRuleMetric";
import {
  opensAlert,
  opensIncident,
} from "../../../Utils/Form/Monitor/TelemetryRule/TelemetryRuleEdits";

/*
 * A Logs, Traces, Exceptions or Metrics monitor's rule on its Criteria
 * page, said the way it is set up: "When to alert" in one sentence, and
 * "What happens" - the alert or incident it opens, and the monitor's
 * status while it matches and otherwise. The criteria behind it, every
 * setting of them, follow folded (MonitorStep).
 */

export interface ComponentProps {
  monitorType: MonitorType;
  monitorStep: MonitorStep;
  rule: TelemetryAlertRule;
  defaultMonitorStatusId: ObjectID | undefined;
  monitorStatusOptions: Array<MonitorStatus>;
  alertSeverityOptions: Array<AlertSeverity>;
  incidentSeverityOptions: Array<IncidentSeverity>;
}

type SeverityLike = {
  id?: ObjectID | null | undefined;
  name?: string | undefined;
  color?: Color | undefined;
};

const findById: <T extends SeverityLike>(
  options: Array<T>,
  id: ObjectID | undefined,
) => T | undefined = <T extends SeverityLike>(
  options: Array<T>,
  id: ObjectID | undefined,
): T | undefined => {
  if (!id) {
    return undefined;
  }

  return options.find((option: T) => {
    return option.id?.toString() === id.toString();
  });
};

const TelemetryRuleSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { rule } = props;

  const sentence: string = getRuleSentenceForStep({
    monitorType: props.monitorType,
    monitorStep: props.monitorStep,
    rule,
    translator,
  });

  const matchingStatus: MonitorStatus | undefined = findById(
    props.monitorStatusOptions,
    rule.monitorStatusId,
  );

  const otherwiseStatus: MonitorStatus | undefined =
    findById(props.monitorStatusOptions, props.defaultMonitorStatusId) ||
    props.monitorStatusOptions.find((status: MonitorStatus) => {
      return status.isOperationalState;
    });

  /*
   * A status inside the sentence, as text: a small dot in its colour and
   * its name, on the sentence's own line. The status bubble is a block of
   * its own (a 14px dot on a 24px line, a live region), which sat lower
   * than the words around it.
   */
  const renderStatus: (status: MonitorStatus | undefined) => ReactElement = (
    status: MonitorStatus | undefined,
  ): ReactElement => {
    if (!status) {
      return <span>{translator.translateText("Not set")}</span>;
    }

    const name: string = status.name || "";

    return (
      <span
        className="whitespace-nowrap font-medium text-gray-900"
        data-testid="telemetry-rule-summary-status-name"
      >
        <span
          aria-hidden="true"
          className="relative -top-px ms-0.5 me-1.5 inline-block h-2 w-2 rounded-full align-middle"
          style={{
            backgroundColor: ((status.color as Color) || Black).toString(),
          }}
        ></span>
        {translator.translateText(name) || name}
      </span>
    );
  };

  const renderOpened: (data: {
    testId: string;
    label: string;
    title: string | undefined;
    severity: AlertSeverity | IncidentSeverity | undefined;
  }) => ReactElement = (data: {
    testId: string;
    label: string;
    title: string | undefined;
    severity: AlertSeverity | IncidentSeverity | undefined;
  }): ReactElement => {
    return (
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1"
        data-testid={data.testId}
      >
        <span className="text-gray-500">
          {translator.translateText(data.label)}
        </span>
        <span className="min-w-0 break-words font-medium text-gray-900">
          {data.title || translator.translateText("No title")}
        </span>
        {data.severity ? (
          <Pill
            isMinimal={true}
            color={(data.severity.color as Color) || Black}
            text={data.severity.name || ""}
          />
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <div className="mt-5 space-y-6" data-testid="telemetry-rule-summary">
      <div>
        <FieldLabelElement
          title={TelemetryRuleCopy.whenToAlertTitle}
          description={TelemetryRuleCopy.whenToAlertDescription}
          isHeading={true}
          hideOptionalLabel={true}
        />
        <p
          className="mt-3 rounded-md bg-gray-50 px-4 py-3 text-sm font-medium text-gray-900"
          data-testid="telemetry-rule-summary-sentence"
        >
          {sentence}
        </p>
      </div>

      <div>
        <FieldLabelElement
          title={TelemetryRuleCopy.whatHappensTitle}
          description="When the rule matches."
          isHeading={true}
          hideOptionalLabel={true}
        />
        <div className="mt-3 space-y-2 text-sm">
          {opensAlert(rule.action) && rule.alert
            ? renderOpened({
                testId: "telemetry-rule-summary-alert",
                label: "Creates an alert:",
                title: rule.alert.title,
                severity: findById(
                  props.alertSeverityOptions,
                  rule.alert.alertSeverityId,
                ),
              })
            : null}
          {opensIncident(rule.action) && rule.incident
            ? renderOpened({
                testId: "telemetry-rule-summary-incident",
                label: "Declares an incident:",
                title: rule.incident.title,
                severity: findById(
                  props.incidentSeverityOptions,
                  rule.incident.incidentSeverityId,
                ),
              })
            : null}
          {rule.action === TelemetryAlertRuleAction.StatusOnly ? (
            <div
              className="text-gray-900"
              data-testid="telemetry-rule-summary-status-only"
            >
              {translator.translateText(
                "Changes the monitor's status, and opens no alert or incident.",
              )}
            </div>
          ) : (
            <></>
          )}
          <div
            className="leading-6 text-gray-500"
            data-testid="telemetry-rule-summary-status"
          >
            <TranslatedSentence
              template="Monitor status: {{matching}} while the rule matches, {{otherwise}} otherwise."
              slots={{
                matching: renderStatus(matchingStatus),
                otherwise: renderStatus(otherwiseStatus),
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default TelemetryRuleSummary;
