import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input from "Common/UI/Components/Input/Input";
import PeoplePicker from "Common/UI/Components/PeoplePicker/PeoplePicker";
import { getOwnersPeoplePickerConfig } from "Common/UI/Components/PeoplePicker/OwnersFormField";
import {
  PeoplePickerFieldConfig,
  PeoplePickerKind,
  PeoplePickerValue,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import { RuleCriteriaCopy } from "Common/UI/Components/RuleCriteria/RuleCriteriaFields";
import {
  RULE_CRITERIA_CONNECTOR_CELL_CLASS_NAME,
  RULE_CRITERIA_FIELD_CELL_CLASS_NAME,
  RULE_CRITERIA_OPERATOR_CELL_CLASS_NAME,
  RULE_CRITERIA_REMOVE_CELL_CLASS_NAME,
  RULE_CRITERIA_ROW_CLASS_NAME,
  RULE_CRITERIA_VALUE_CELL_CLASS_NAME,
} from "Common/UI/Components/RuleCriteria/RuleCriteriaRowLayout";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useId,
  useRef,
} from "react";
import NotificationRuleCondition, {
  ConditionType,
  getCheckOnLabel,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Label from "Common/Models/DatabaseModels/Label";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import Team from "Common/Models/DatabaseModels/Team";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import {
  getConditionFieldHint,
  getConditionOperatorWords,
  getConditionValueHint,
} from "./NotificationRuleConditionWords";

/*
 * ONE CONDITION OF A WORKSPACE RULE, AS A LINE OF A SENTENCE.
 *
 *   If   [Incident Owner   v]  [is any of  v]  (+ Add owner) (Platform) (Jane)  (bin)
 *                                              Matches the people and teams
 *                                              added as owners. Team
 *                                              membership does not count.
 *   And  [Incident Severity v]  [is none of v]  [(Low) (Info)              v]  (bin)
 *
 * The first condition opens with "If", each one after it with "And" or "Or",
 * as the rule's Match Condition combines them. The field, how it compares
 * (in the sentence's words: NotificationRuleConditionWords) and the value
 * follow, laid out by the room the conditions have, as every rule's
 * conditions are (RuleCriteriaRowLayout): one line on a page, a picker a
 * line on a phone.
 *
 * The value is what the field holds:
 *
 *   - words, for a title, a description or a name;
 *   - picks from the project's own values, searched as they are typed -
 *     states and severities in their colours, labels, monitors, SLOs and,
 *     for an on-call rule, the policies themselves (#7554). An archived
 *     value is not offered for a new pick (#7582); one the condition holds
 *     already stays, marked Archived, so it can be kept or taken out;
 *   - people and teams, for who owns the record (#7554, #7583), picked as
 *     owners are picked everywhere else (PeoplePicker), with their avatars.
 *
 * It was a grey box of three labelled dropdowns - "Filter Type", "Filter
 * Condition", "Value" - and a "Delete Filter" button, with the operator
 * said as the matcher stores it ("Contains Any").
 */

export interface ComponentProps {
  initialValue: NotificationRuleCondition | undefined;
  onChange?: undefined | ((value: NotificationRuleCondition) => void);
  onDelete?: undefined | (() => void);
  eventType: NotificationRuleEventType;
  // The row's place in the list: the first reads "If", the others "And"/"Or".
  index?: number | undefined;
  // How the rule combines its conditions: "And" for All, "Or" for Any.
  filterCondition?: FilterCondition | undefined;
  monitors: Array<Monitor>;
  labels: Array<Label>;
  alertStates: Array<AlertState>;
  alertSeverities: Array<AlertSeverity>;
  incidentSeverities: Array<IncidentSeverity>;
  incidentStates: Array<IncidentState>;
  scheduledMaintenanceStates: Array<ScheduledMaintenanceState>;
  // A security case rule's: the project's own case priorities and statuses.
  securityCasePriorities?: Array<SecurityCasePriority> | undefined;
  securityCaseStatuses?: Array<SecurityCaseStatus> | undefined;
  // An SLO rule's: the project's SLOs, to pick the ones it is for.
  serviceLevelObjectives?: Array<ServiceLevelObjective> | undefined;
  // An on-call rule's: the project's policies, to pick the ones it is for.
  onCallDutyPolicies?: Array<OnCallDutyPolicy> | undefined;
  /*
   * The project's teams: which of the ids an owners condition holds are
   * teams. The others are people.
   */
  teams?: Array<Team> | undefined;
  monitorStatus: Array<MonitorStatus>;
}

// Picked as owners are everywhere: people and teams, in one search list.
const OWNERS_PICKER_CONFIG: PeoplePickerFieldConfig =
  getOwnersPeoplePickerConfig();

const toLowerCaseIds: (ids: Array<string>) => Set<string> = (
  ids: Array<string>,
): Set<string> => {
  return new Set(
    ids.map((id: string): string => {
      return id.toLowerCase();
    }),
  );
};

/*
 * An owners condition's ids as the people picker holds them: the teams
 * among them as teams, everyone else as people. A team picked since the
 * page loaded is known by its pick.
 */
export const getOwnerPickerValue: (data: {
  ids: Array<string>;
  teamIds: Set<string>;
}) => PeoplePickerValue = (data: {
  ids: Array<string>;
  teamIds: Set<string>;
}): PeoplePickerValue => {
  const users: Array<string> = [];
  const teams: Array<string> = [];

  for (const id of data.ids) {
    if (data.teamIds.has(id.toLowerCase())) {
      teams.push(id);
    } else {
      users.push(id);
    }
  }

  return {
    [PeoplePickerKind.User]: users,
    [PeoplePickerKind.Team]: teams,
  };
};

const NotificationRuleConditionFormElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const translator: Translator = useTranslator();
  const rowId: string = useId();
  const hintId: string = `${rowId}-hint`;
  const valueLabelId: string = `${rowId}-value-label`;
  const number: number = (props.index || 0) + 1;

  const [notificationRuleCondition, setNotificationRuleCondition] =
    React.useState<NotificationRuleCondition | undefined>(props.initialValue);

  // Teams picked while the form is open, which the page's list may not have.
  const pickedTeamIds: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    if (props.onChange && notificationRuleCondition) {
      props.onChange(notificationRuleCondition);
    }
  }, [notificationRuleCondition]);

  const checkOn: NotificationRuleConditionCheckOn | undefined =
    notificationRuleCondition?.checkOn;
  const conditionType: ConditionType | undefined =
    notificationRuleCondition?.conditionType;

  // The record's fields, by their names, each with its hint when it has one.
  const fieldOptions: Array<DropdownOption> =
    NotificationRuleConditionUtil.getCheckOnByEventType(props.eventType).map(
      (field: NotificationRuleConditionCheckOn): DropdownOption => {
        const hint: string | undefined = getConditionFieldHint(field);

        return {
          value: field,
          // The stored value, unless it has words of its own (CHECK_ON_LABELS).
          label: getCheckOnLabel(field),
          ...(hint ? { description: hint } : {}),
        };
      },
    );

  // How the chosen field compares, in the sentence's words.
  const operatorOptions: Array<DropdownOption> = checkOn
    ? NotificationRuleConditionUtil.getConditionTypeByCheckOn(checkOn).map(
        (item: ConditionType): DropdownOption => {
          return {
            value: item,
            label: getConditionOperatorWords({
              checkOn: checkOn,
              conditionType: item,
            }),
          };
        },
      )
    : [];

  const valueIds: Array<string> = NotificationRuleConditionUtil.getValueIds(
    notificationRuleCondition,
  );

  const hasValue: boolean = Boolean(
    checkOn &&
      NotificationRuleConditionUtil.hasValueField({
        checkOn: checkOn,
        conditionType: conditionType,
      }),
  );
  const isPeopleValue: boolean =
    hasValue &&
    NotificationRuleConditionUtil.isPeopleValueField({
      checkOn: checkOn,
      conditionType: conditionType,
    });
  const isDropdownValue: boolean =
    hasValue &&
    !isPeopleValue &&
    NotificationRuleConditionUtil.isDropdownValueField({
      checkOn: checkOn,
      conditionType: conditionType,
    });

  /*
   * The line under the value, read with it: who counts as an owner, and
   * what keeps matching a renamed policy. A value picked from a list has
   * none - the line would sit under the open list, saying what it shows.
   */
  const hint: string | undefined = checkOn
    ? getConditionValueHint(checkOn)
    : undefined;

  const changeValue: (value: string | Array<string> | undefined) => void = (
    value: string | Array<string> | undefined,
  ): void => {
    if (!notificationRuleCondition) {
      return;
    }

    setNotificationRuleCondition({
      ...notificationRuleCondition,
      value: value,
    });
  };

  const renderConnector: () => ReactElement = (): ReactElement => {
    if (!props.index) {
      return (
        <span className="text-sm font-semibold text-gray-700">
          {translator.translateText(RuleCriteriaCopy.ifConnector)}
        </span>
      );
    }

    const isAll: boolean = props.filterCondition === FilterCondition.All;

    return (
      <span
        className={`inline-flex whitespace-nowrap rounded-md border px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide ${
          isAll
            ? "border-blue-200 bg-blue-50 text-blue-700"
            : "border-amber-200 bg-amber-50 text-amber-700"
        }`}
        data-testid={`notification-rule-condition-connector-${props.index}`}
      >
        {translator.translateText(
          isAll ? RuleCriteriaCopy.andConnector : RuleCriteriaCopy.orConnector,
        )}
      </span>
    );
  };

  const renderValue: () => ReactElement | null = (): ReactElement | null => {
    if (!checkOn || !hasValue) {
      return null;
    }

    const valueAriaLabel: string = translator.translateTemplate(
      "Value for condition {{number}}",
      { number: number },
    );

    if (isPeopleValue) {
      const teamIds: Set<string> = toLowerCaseIds(
        (props.teams || [])
          .map((team: Team): string => {
            return team._id?.toString() || "";
          })
          .filter((id: string): boolean => {
            return Boolean(id);
          }),
      );

      for (const id of pickedTeamIds.current) {
        teamIds.add(id);
      }

      return (
        <>
          <span id={valueLabelId} className="sr-only">
            {valueAriaLabel}
          </span>
          <div className="flex min-h-10 items-center">
            <PeoplePicker
              kinds={[PeoplePickerKind.User, PeoplePickerKind.Team]}
              value={getOwnerPickerValue({ ids: valueIds, teamIds: teamIds })}
              onChange={(next: PeoplePickerValue): void => {
                const teams: Array<string> = next[PeoplePickerKind.Team] || [];

                for (const id of teams) {
                  pickedTeamIds.current.add(id.toLowerCase());
                }

                changeValue([...(next[PeoplePickerKind.User] || []), ...teams]);
              }}
              addButtonText={OWNERS_PICKER_CONFIG.addButtonText}
              searchPlaceholder={OWNERS_PICKER_CONFIG.searchPlaceholder}
              emptyText={OWNERS_PICKER_CONFIG.emptyText}
              ariaLabelledby={valueLabelId}
              ariaDescribedby={hint ? hintId : undefined}
              dataTestId={`notification-rule-condition-people-${props.index || 0}`}
            />
          </div>
        </>
      );
    }

    if (isDropdownValue) {
      const options: Array<DropdownOption> =
        NotificationRuleConditionUtil.getDropdownOptionsByCheckOn({
          checkOn: checkOn,
          monitors: props.monitors,
          labels: props.labels,
          alertStates: props.alertStates,
          incidentStates: props.incidentStates,
          scheduledMaintenanceStates: props.scheduledMaintenanceStates,
          securityCasePriorities: props.securityCasePriorities,
          securityCaseStatuses: props.securityCaseStatuses,
          serviceLevelObjectives: props.serviceLevelObjectives,
          onCallDutyPolicies: props.onCallDutyPolicies,
          monitorStatus: props.monitorStatus,
          alertSeverities: props.alertSeverities,
          incidentSeverities: props.incidentSeverities,
          // An archived value the condition holds stays, marked Archived.
          keptIds: valueIds,
        });

      const picked: Set<string> = toLowerCaseIds(valueIds);

      /*
       * The test id goes on a wrapper: react-select, under Dropdown, puts
       * no data-testid it is handed on the page.
       */
      return (
        <div
          data-testid={`notification-rule-condition-value-${props.index || 0}`}
        >
          <Dropdown
            id={`${rowId}-value`}
            className="relative w-full"
            ariaLabel={valueAriaLabel}
            isAriaLabelTranslated={true}
            ariaDescribedby={hint ? hintId : undefined}
            isMultiSelect={true}
            placeholder={RuleCriteriaCopy.selectOneOrMore}
            options={options}
            value={options.filter((option: DropdownOption): boolean => {
              return picked.has(option.value.toString().toLowerCase());
            })}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              if (Array.isArray(value)) {
                changeValue(
                  value.map((item: DropdownValue) => {
                    return item.toString();
                  }),
                );
                return;
              }

              changeValue(value?.toString());
            }}
          />
        </div>
      );
    }

    return (
      <Input
        outerDivClassName="relative w-full rounded-md shadow-sm"
        ariaLabel={valueAriaLabel}
        ariaDescribedby={hint ? hintId : undefined}
        dataTestId={`notification-rule-condition-text-${props.index || 0}`}
        placeholder={RuleCriteriaCopy.enterText}
        value={notificationRuleCondition?.value?.toString()}
        onChange={(value: string) => {
          changeValue(value || "");
        }}
      />
    );
  };

  return (
    <li
      className={RULE_CRITERIA_ROW_CLASS_NAME}
      data-testid={`notification-rule-condition-${props.index || 0}`}
    >
      <div className={RULE_CRITERIA_CONNECTOR_CELL_CLASS_NAME}>
        {renderConnector()}
      </div>

      <div
        className={RULE_CRITERIA_FIELD_CELL_CLASS_NAME}
        data-testid={`notification-rule-condition-field-${props.index || 0}`}
      >
        <Dropdown
          id={`${rowId}-field`}
          className="relative w-full"
          ariaLabel={translator.translateTemplate(
            "Criteria for condition {{number}}",
            { number: number },
          )}
          isAriaLabelTranslated={true}
          isClearable={false}
          options={fieldOptions}
          value={fieldOptions.find((option: DropdownOption): boolean => {
            return option.value === checkOn;
          })}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            const nextCheckOn: NotificationRuleConditionCheckOn | undefined =
              value?.toString() as NotificationRuleConditionCheckOn | undefined;

            if (!nextCheckOn || nextCheckOn === checkOn) {
              return;
            }

            /*
             * A new field starts on its first way of comparing, so the row
             * always reads as a whole sentence; its value starts empty.
             */
            setNotificationRuleCondition({
              checkOn: nextCheckOn,
              conditionType:
                NotificationRuleConditionUtil.getConditionTypeByCheckOn(
                  nextCheckOn,
                )[0],
              value: undefined,
            });
          }}
        />
      </div>

      <div
        className={RULE_CRITERIA_OPERATOR_CELL_CLASS_NAME}
        data-testid={`notification-rule-condition-operator-${props.index || 0}`}
      >
        <Dropdown
          id={`${rowId}-operator`}
          className="relative w-full"
          ariaLabel={translator.translateTemplate(
            "Operator for condition {{number}}",
            { number: number },
          )}
          isAriaLabelTranslated={true}
          isClearable={false}
          disabled={!checkOn}
          options={operatorOptions}
          value={operatorOptions.find((option: DropdownOption): boolean => {
            return option.value === conditionType;
          })}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            if (!notificationRuleCondition || !value) {
              return;
            }

            const nextConditionType: ConditionType =
              value.toString() as ConditionType;

            if (nextConditionType === conditionType) {
              return;
            }

            /*
             * The value stays: "is any of" to "is none of" compares the same
             * picks the other way, "contains" to "starts with" the same
             * words. Every way a field compares takes the same kind of value.
             */
            setNotificationRuleCondition({
              ...notificationRuleCondition,
              conditionType: nextConditionType,
            });
          }}
        />
      </div>

      <div className={RULE_CRITERIA_VALUE_CELL_CLASS_NAME}>
        {renderValue()}
        {hint ? (
          <p
            id={hintId}
            className="mt-1 text-xs leading-5 text-gray-500"
            data-testid={`notification-rule-condition-hint-${props.index || 0}`}
          >
            {translator.translateText(hint)}
          </p>
        ) : (
          <></>
        )}
      </div>

      <div className={RULE_CRITERIA_REMOVE_CELL_CLASS_NAME}>
        <Button
          title={RuleCriteriaCopy.removeCondition}
          tooltip={RuleCriteriaCopy.removeCondition}
          ariaLabel={translator.translateTemplate(
            "Remove condition {{number}}",
            { number: number },
          )}
          isAriaLabelTranslated={true}
          dataTestId={`notification-rule-condition-remove-${props.index || 0}`}
          icon={IconProp.Trash}
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.ICON}
          onClick={() => {
            props.onDelete?.();
          }}
        />
      </div>
    </li>
  );
};

export default NotificationRuleConditionFormElement;
