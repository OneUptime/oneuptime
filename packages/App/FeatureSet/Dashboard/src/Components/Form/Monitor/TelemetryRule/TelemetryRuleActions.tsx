import MonitorCriteriaAlertForm from "../MonitorCriteriaAlertForm";
import MonitorCriteriaIncidentForm, {
  IncidentRoleOption,
} from "../MonitorCriteriaIncidentForm";
import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "Common/Types/Monitor/CriteriaIncident";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  TelemetryAlertRule,
  TelemetryAlertRuleAction,
} from "Common/Types/Monitor/TelemetryAlertRule";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import Radio from "Common/UI/Components/Radio/Radio";
import IconProp from "Common/Types/Icon/IconProp";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import {
  getActionChoices,
  TelemetryRuleChoice,
  TelemetryRuleCopy,
} from "../../../../Utils/Form/Monitor/TelemetryRule/TelemetryRuleText";
import {
  opensAlert,
  opensIncident,
} from "../../../../Utils/Form/Monitor/TelemetryRule/TelemetryRuleEdits";

/*
 * "What happens" when a telemetry rule matches: an alert, an incident, or
 * both - each drawn with the alert or incident form every criteria uses,
 * its title and severity first and the rest folded - and, folded under
 * More fields, the monitor's status while it matches, the rule's name and
 * the way into the full criteria editor.
 */

export interface ComponentProps {
  monitorType: MonitorType;
  rule: TelemetryAlertRule;
  monitorStatusDropdownOptions: Array<DropdownOption>;
  incidentSeverityDropdownOptions: Array<DropdownOption>;
  alertSeverityDropdownOptions: Array<DropdownOption>;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  labelDropdownOptions: Array<DropdownOption>;
  userDropdownOptions: Array<DropdownOption>;
  incidentRoleOptions?: Array<IncidentRoleOption> | undefined;
  seriesAttributeKeys: Array<string>;
  /*
   * The name the rule's filter gives it ("Log Count is above 10"): what a
   * name field left empty goes back to, since a rule cannot be saved
   * without one.
   */
  nameFromRule: string;
  onActionChange: (action: TelemetryAlertRuleAction) => void;
  onChange: (rule: TelemetryAlertRule) => void;
  onEditAsCustomCriteria: () => void;
}

/*
 * The alert's or the incident's own settings, under the choice and as wide
 * as it: indented under the radios, the box read as the last one's
 * ("Both"), whichever was picked. Its heading says whose settings these
 * are, with the icon the product draws alerts and incidents with.
 */
export const RULE_ACTION_PANEL_CLASS_NAME: string =
  "mt-4 rounded-md border border-gray-100 bg-gray-50 p-3 sm:p-4";

const RuleActionPanelHeading: FunctionComponent<{
  title: string;
  icon: IconProp;
}> = (props: { title: string; icon: IconProp }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
      <Icon icon={props.icon} className="h-4 w-4 flex-none text-gray-500" />
      <span>{translator.translateText(props.title) || props.title}</span>
    </div>
  );
};

const TelemetryRuleActions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { rule } = props;

  const actionLabelId: string = useId();
  const statusLabelId: string = useId();
  const nameInputId: string = useId();

  // Folded at first: these rarely change, and the header says what is set.
  const [isMoreCollapsed, setIsMoreCollapsed] = useState<boolean>(true);

  const actionChoices: Array<TelemetryRuleChoice<TelemetryAlertRuleAction>> =
    getActionChoices(rule.action);

  const statusOption: DropdownOption | undefined =
    props.monitorStatusDropdownOptions.find((option: DropdownOption) => {
      return option.value === rule.monitorStatusId?.toString();
    });

  const moreFieldsItems: Array<FoldedSectionItem> = [
    {
      key: "monitorStatus",
      title: TelemetryRuleCopy.statusTitle,
      isSet: Boolean(statusOption),
      value: statusOption?.label,
      translateValue: true,
    },
    {
      key: "name",
      title: TelemetryRuleCopy.ruleNameTitle,
      isSet: false,
    },
    /*
     * The way to several rules is named on the folded header too: it is
     * where the docs send whoever needs warning and critical bands, and
     * folded it named only the status and the name.
     */
    {
      key: "customCriteria",
      title: TelemetryRuleCopy.editAsCustomCriteria,
      isSet: false,
    },
  ];

  return (
    <div data-testid="telemetry-rule-actions">
      <FieldLabelElement
        id={actionLabelId}
        title="When the rule matches"
        hideOptionalLabel={true}
      />
      <Radio
        ariaLabelledby={actionLabelId}
        dataTestId="telemetry-rule-action"
        value={rule.action}
        options={actionChoices.map(
          (choice: TelemetryRuleChoice<TelemetryAlertRuleAction>) => {
            return {
              value: choice.value,
              label: translator.translateText(choice.label) || choice.label,
              ...(choice.description
                ? {
                    description:
                      translator.translateText(choice.description) ||
                      choice.description,
                  }
                : {}),
            };
          },
        )}
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          if (value) {
            props.onActionChange(value as TelemetryAlertRuleAction);
          }
        }}
      />

      {opensAlert(rule.action) && rule.alert ? (
        <div
          className={RULE_ACTION_PANEL_CLASS_NAME}
          data-testid="telemetry-rule-alert"
        >
          <RuleActionPanelHeading
            title="Alert"
            icon={IconProp.ExclaimationCircle}
          />
          <MonitorCriteriaAlertForm
            key={`alert-${rule.alert.id}`}
            initialValue={rule.alert}
            alertSeverityDropdownOptions={props.alertSeverityDropdownOptions}
            onCallPolicyDropdownOptions={props.onCallPolicyDropdownOptions}
            labelDropdownOptions={props.labelDropdownOptions}
            monitorType={props.monitorType}
            seriesAttributeKeys={props.seriesAttributeKeys}
            onChange={(alert: CriteriaAlert) => {
              props.onChange({ ...rule, alert });
            }}
          />
        </div>
      ) : (
        <></>
      )}

      {opensIncident(rule.action) && rule.incident ? (
        <div
          className={RULE_ACTION_PANEL_CLASS_NAME}
          data-testid="telemetry-rule-incident"
        >
          <RuleActionPanelHeading title="Incident" icon={IconProp.Alert} />
          <MonitorCriteriaIncidentForm
            key={`incident-${rule.incident.id}`}
            initialValue={rule.incident}
            incidentSeverityDropdownOptions={
              props.incidentSeverityDropdownOptions
            }
            onCallPolicyDropdownOptions={props.onCallPolicyDropdownOptions}
            labelDropdownOptions={props.labelDropdownOptions}
            userDropdownOptions={props.userDropdownOptions}
            incidentRoleOptions={props.incidentRoleOptions}
            monitorType={props.monitorType}
            seriesAttributeKeys={props.seriesAttributeKeys}
            onChange={(incident: CriteriaIncident) => {
              props.onChange({ ...rule, incident });
            }}
          />
        </div>
      ) : (
        <></>
      )}

      <FoldedSection
        title={MORE_FIELDS_SECTION_TITLE}
        className="mt-6"
        isCollapsed={isMoreCollapsed}
        onToggle={(isCollapsed: boolean) => {
          setIsMoreCollapsed(isCollapsed);
        }}
        items={moreFieldsItems}
        dataTestId="telemetry-rule-more-fields"
      >
        <div className="space-y-5">
          <div data-testid="telemetry-rule-status-field">
            <FieldLabelElement
              id={statusLabelId}
              title={TelemetryRuleCopy.statusTitle}
              description={TelemetryRuleCopy.statusDescription}
              hideOptionalLabel={true}
            />
            <Dropdown
              ariaLabelledby={statusLabelId}
              value={statusOption}
              options={props.monitorStatusDropdownOptions}
              isClearable={false}
              placeholder="Leave the status as it is"
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                props.onChange({
                  ...rule,
                  monitorStatusId: value
                    ? new ObjectID(value.toString())
                    : undefined,
                });
              }}
            />
          </div>

          <div>
            <FieldLabelElement
              title={TelemetryRuleCopy.ruleNameTitle}
              description={TelemetryRuleCopy.ruleNameDescription}
              htmlFor={nameInputId}
              hideOptionalLabel={true}
            />
            <Input
              id={nameInputId}
              dataTestId="telemetry-rule-name"
              value={rule.name}
              placeholder={props.nameFromRule}
              onChange={(value: string) => {
                props.onChange({ ...rule, name: value });
              }}
              onBlur={() => {
                if (!rule.name.trim()) {
                  props.onChange({ ...rule, name: props.nameFromRule });
                }
              }}
            />
          </div>

          {/*
           * The button says what it does; the line above it says when to
           * press it. A label repeating the button's words read twice.
           */}
          <div data-testid="telemetry-rule-custom-criteria-entry">
            <p className="text-sm text-gray-500">
              {translator.translateText(
                TelemetryRuleCopy.editAsCustomCriteriaDescription,
              )}
            </p>
            {/* md:-ml-3 takes back the Button's own md:ml-3. */}
            <div className="mt-2 md:-ml-3">
              <Button
                title={TelemetryRuleCopy.editAsCustomCriteria}
                buttonSize={ButtonSize.Small}
                buttonStyle={ButtonStyleType.NORMAL}
                icon={IconProp.Settings}
                dataTestId="telemetry-rule-edit-as-custom"
                onClick={props.onEditAsCustomCriteria}
              />
            </div>
          </div>
        </div>
      </FoldedSection>
    </div>
  );
};

export default TelemetryRuleActions;
