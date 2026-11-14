import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import NotificationRuleCondition, {
  getCheckOnLabel,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import ArchivedTag from "Common/UI/Components/ArchivedTag/ArchivedTag";
import { PeopleList } from "Common/UI/Components/PeoplePicker/PeopleList";
import {
  PeoplePickerKind,
  PeoplePickerOption,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import { isArchivedValue } from "Common/Utils/ArchivableValues";
import {
  getConditionOperatorWords,
  VALUE_NOT_FOUND_NAME,
} from "../NotificationRuleForm/NotificationRuleConditionWords";
import React, { FunctionComponent, ReactElement } from "react";
import AlertSeverityElement from "../../AlertSeverity/AlertSeverityElement";
import AlertStateElement from "../../AlertState/AlertStateElement";
import IncidentSeverityElement from "../../IncidentSeverity/IncidentSeverityElement";
import IncidentStateElement from "../../IncidentState/IncidentStateElement";
import ScheduledMaintenanceStateElement from "../../ScheduledMaintenanceState/ScheduledMaintenanceStateElement";
import MonitorStatusElement from "../../MonitorStatus/MonitorStatusElement";
import LabelElement from "Common/UI/Components/Label/Label";
import { sortLabels } from "Common/Utils/LabelOrder";
import MonitorElement from "../../Monitor/Monitor";
import {
  SecurityCasePriorityPill,
  SecurityCaseStatusPill,
} from "../../SecurityCase/SecurityCasePills";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { getListSeparator, joinList } from "Common/UI/Utils/ListSeparator";

export interface ComponentProps {
  notificationRuleCondition: NotificationRuleCondition | undefined;
  value?: string | Array<string>;
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
  // An SLO rule's: the project's SLOs, to name the ones it picks.
  serviceLevelObjectives?: Array<ServiceLevelObjective> | undefined;
  // An on-call rule's: the project's policies, to name the ones it picks.
  onCallDutyPolicies?: Array<OnCallDutyPolicy> | undefined;
  // The project's people and teams, to name the owners a condition picks.
  users?: Array<User> | undefined;
  teams?: Array<Team> | undefined;
  monitorStatus: Array<MonitorStatus>;
}

/*
 * A value drawn in a condition, followed by "Archived" when it is archived
 * (#7582): a rule keeps matching the records that still have it, and it can
 * be taken out of the rule, but nobody can pick it again.
 */
const withArchivedTag: (data: {
  row: { isArchived?: boolean | undefined };
  key: string;
  element: ReactElement;
}) => ReactElement = (data: {
  row: { isArchived?: boolean | undefined };
  key: string;
  element: ReactElement;
}): ReactElement => {
  if (!isArchivedValue(data.row)) {
    return <React.Fragment key={data.key}>{data.element}</React.Fragment>;
  }

  return (
    <span
      key={data.key}
      className="inline-flex max-w-full items-center gap-1"
      data-testid="notification-rule-condition-archived-value"
    >
      {data.element}
      <ArchivedTag isCompact={true} />
    </span>
  );
};

/*
 * The owners an owners condition picks, as chips with their avatars - each
 * person and team the project still has, by name, and one it no longer has
 * (a person who left, a team since deleted) said to be so.
 */
export const getOwnerConditionOptions: (data: {
  ids: Array<string>;
  users: Array<User>;
  teams: Array<Team>;
}) => Array<PeoplePickerOption> = (data: {
  ids: Array<string>;
  users: Array<User>;
  teams: Array<Team>;
}): Array<PeoplePickerOption> => {
  return data.ids.map((id: string): PeoplePickerOption => {
    const lowerCaseId: string = id.toLowerCase();

    const team: Team | undefined = data.teams.find(
      (candidate: Team): boolean => {
        return candidate._id?.toString().toLowerCase() === lowerCaseId;
      },
    );

    if (team) {
      return {
        kind: PeoplePickerKind.Team,
        id: id,
        name: team.name?.toString() || "",
      };
    }

    const user: User | undefined = data.users.find(
      (candidate: User): boolean => {
        return candidate._id?.toString().toLowerCase() === lowerCaseId;
      },
    );

    if (user) {
      return {
        kind: PeoplePickerKind.User,
        id: id,
        name: user.name?.toString() || user.email?.toString() || "",
        userId: id,
        hasProfilePicture: Boolean(user.profilePictureId),
      };
    }

    return {
      kind: PeoplePickerKind.User,
      id: id,
      name: VALUE_NOT_FOUND_NAME,
      isUnknown: true,
    };
  });
};

const NotificationRuleConditionElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const getValueElement: GetReactElementFunction = (): ReactElement => {
    const checkOn: NotificationRuleConditionCheckOn | undefined =
      props.notificationRuleCondition?.checkOn;

    /*
     * Every dropdown-backed check-on stores its value as an array of ids, but
     * a row saved before the check-on became a dropdown - or one saved with
     * no value at all - can still hold a bare string or nothing. Normalise
     * once: a bad row then renders as "nothing selected" instead of throwing
     * and taking the whole rule view down with it.
     */
    const selectedIds: Array<string> =
      NotificationRuleConditionUtil.getValueIds(
        props.notificationRuleCondition,
      );

    let valueElement: ReactElement | undefined = Array.isArray(
      props.notificationRuleCondition?.value,
    ) ? (
      <span className="font-medium text-gray-900">
        {props.notificationRuleCondition?.value.join(", ")}
      </span>
    ) : (
      <span className="font-medium text-gray-900">
        {props.notificationRuleCondition?.value}
      </span>
    );

    if (
      checkOn === NotificationRuleConditionCheckOn.AlertSeverity ||
      checkOn === NotificationRuleConditionCheckOn.AlertEpisodeSeverity
    ) {
      const selectedAlertSeverities: Array<AlertSeverity> =
        props.alertSeverities.filter((alertSeverity: AlertSeverity) => {
          return selectedIds.includes(alertSeverity.id!.toString());
        });

      valueElement = (
        <div className="inline-flex flex-wrap items-center gap-1.5">
          {selectedAlertSeverities.map(
            (alertSeverity: AlertSeverity, index: number) => {
              return withArchivedTag({
                row: alertSeverity,
                key: `${index}`,
                element: <AlertSeverityElement alertSeverity={alertSeverity} />,
              });
            },
          )}
        </div>
      );
    }

    if (
      checkOn === NotificationRuleConditionCheckOn.AlertState ||
      checkOn === NotificationRuleConditionCheckOn.AlertEpisodeState
    ) {
      const selectedAlertStates: Array<AlertState> = props.alertStates.filter(
        (alertState: AlertState) => {
          return selectedIds.includes(alertState.id!.toString());
        },
      );

      valueElement = (
        <div className="inline-flex flex-wrap items-center gap-1.5">
          {selectedAlertStates.map((alertState: AlertState, index: number) => {
            return withArchivedTag({
              row: alertState,
              key: `${index}`,
              element: <AlertStateElement alertState={alertState} />,
            });
          })}
        </div>
      );
    }

    if (
      checkOn === NotificationRuleConditionCheckOn.IncidentSeverity ||
      checkOn === NotificationRuleConditionCheckOn.IncidentEpisodeSeverity
    ) {
      const selectedIncidentSeverities: Array<IncidentSeverity> =
        props.incidentSeverities.filter(
          (incidentSeverity: IncidentSeverity) => {
            return selectedIds.includes(incidentSeverity.id!.toString());
          },
        );

      valueElement = (
        <div className="inline-flex flex-wrap items-center gap-1.5">
          {selectedIncidentSeverities.map(
            (incidentSeverity: IncidentSeverity, index: number) => {
              return withArchivedTag({
                row: incidentSeverity,
                key: `${index}`,
                element: (
                  <IncidentSeverityElement
                    incidentSeverity={incidentSeverity}
                  />
                ),
              });
            },
          )}
        </div>
      );
    }

    if (
      checkOn === NotificationRuleConditionCheckOn.IncidentState ||
      checkOn === NotificationRuleConditionCheckOn.IncidentEpisodeState
    ) {
      const selectedIncidentStates: Array<IncidentState> =
        props.incidentStates.filter((incidentState: IncidentState) => {
          return selectedIds.includes(incidentState.id!.toString());
        });

      valueElement = (
        <div className="inline-flex flex-wrap items-center gap-1.5">
          {selectedIncidentStates.map(
            (incidentState: IncidentState, index: number) => {
              return withArchivedTag({
                row: incidentState,
                key: `${index}`,
                element: <IncidentStateElement incidentState={incidentState} />,
              });
            },
          )}
        </div>
      );
    }

    if (
      checkOn === NotificationRuleConditionCheckOn.ScheduledMaintenanceState
    ) {
      const selectedScheduledMaintenanceStates: Array<ScheduledMaintenanceState> =
        props.scheduledMaintenanceStates.filter(
          (scheduledMaintenanceState: ScheduledMaintenanceState) => {
            return selectedIds.includes(
              scheduledMaintenanceState.id!.toString(),
            );
          },
        );

      valueElement = (
        <div className="inline-flex flex-wrap items-center gap-1.5">
          {selectedScheduledMaintenanceStates.map(
            (
              scheduledMaintenanceState: ScheduledMaintenanceState,
              index: number,
            ) => {
              return withArchivedTag({
                row: scheduledMaintenanceState,
                key: `${index}`,
                element: (
                  <ScheduledMaintenanceStateElement
                    scheduledMaintenanceState={scheduledMaintenanceState}
                  />
                ),
              });
            },
          )}
        </div>
      );
    }

    if (checkOn === NotificationRuleConditionCheckOn.MonitorStatus) {
      const selectedMonitorStatuses: Array<MonitorStatus> =
        props.monitorStatus.filter((monitorStatus: MonitorStatus) => {
          return selectedIds.includes(monitorStatus.id!.toString());
        });

      valueElement = (
        <div className="inline-flex flex-wrap items-center gap-1.5">
          {selectedMonitorStatuses.map(
            (monitorStatus: MonitorStatus, index: number) => {
              return withArchivedTag({
                row: monitorStatus,
                key: `${index}`,
                element: (
                  <MonitorStatusElement
                    shouldAnimate={false}
                    monitorStatus={monitorStatus}
                  />
                ),
              });
            },
          )}
        </div>
      );
    }

    /*
     * Every label-backed check-on renders the same way. They are listed one
     * by one rather than matched on a "Labels" suffix so a new check-on has
     * to be added here deliberately.
     */
    if (
      checkOn === NotificationRuleConditionCheckOn.AlertLabels ||
      checkOn === NotificationRuleConditionCheckOn.AlertEpisodeLabels ||
      checkOn === NotificationRuleConditionCheckOn.IncidentLabels ||
      checkOn === NotificationRuleConditionCheckOn.IncidentEpisodeLabels ||
      checkOn === NotificationRuleConditionCheckOn.MonitorLabels ||
      checkOn === NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels ||
      checkOn === NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels ||
      checkOn === NotificationRuleConditionCheckOn.SecurityCaseLabels ||
      checkOn === NotificationRuleConditionCheckOn.SloLabels
    ) {
      // In natural order, as labels are listed everywhere (Utils/LabelOrder).
      const selectedLabels: Array<Label> = sortLabels<Label>(
        props.labels.filter((label: Label) => {
          return selectedIds.includes(label.id!.toString());
        }),
      );

      valueElement = (
        <div className="inline-flex flex-wrap items-center gap-1.5">
          {selectedLabels.map((label: Label, index: number) => {
            return withArchivedTag({
              row: label,
              key: `${index}`,
              element: <LabelElement label={label} />,
            });
          })}
        </div>
      );
    }

    if (checkOn === NotificationRuleConditionCheckOn.Monitors) {
      const selectedMonitors: Array<Monitor> = props.monitors.filter(
        (monitor: Monitor) => {
          return selectedIds.includes(monitor.id!.toString());
        },
      );

      valueElement = (
        <div className="inline-flex flex-wrap items-center gap-1.5">
          {selectedMonitors.map((monitor: Monitor, index: number) => {
            return withArchivedTag({
              row: monitor,
              key: `${index}`,
              element: <MonitorElement monitor={monitor} />,
            });
          })}
        </div>
      );
    }

    /*
     * A security case's priority and status are the project's own, matched
     * by id: each drawn as the pill the case pages draw it with, in its name
     * and colour, in the project's order.
     */
    if (
      checkOn === NotificationRuleConditionCheckOn.SecurityCasePriority ||
      checkOn === NotificationRuleConditionCheckOn.SecurityCaseStatus
    ) {
      const isPriority: boolean =
        checkOn === NotificationRuleConditionCheckOn.SecurityCasePriority;
      const values: Array<SecurityCasePriority | SecurityCaseStatus> = (
        (isPriority
          ? props.securityCasePriorities
          : props.securityCaseStatuses) || []
      ).filter((value: SecurityCasePriority | SecurityCaseStatus) => {
        return selectedIds.includes(value.id?.toString() || "");
      });

      valueElement = (
        <div className="inline-flex flex-wrap items-center gap-1.5">
          {values.map((value: SecurityCasePriority | SecurityCaseStatus) => {
            return withArchivedTag({
              row: value,
              key: value.id?.toString() || "",
              element: isPriority ? (
                <SecurityCasePriorityPill value={value} isMinimal={true} />
              ) : (
                <SecurityCaseStatusPill value={value} isMinimal={true} />
              ),
            });
          })}
        </div>
      );
    }

    /*
     * The SLOs an SLO rule picks and the policies an on-call rule picks, by
     * their names as the team wrote them, in the project's order, listed
     * with the commas of the script they are written in - each followed by
     * "Archived" when it is, on the same line as its name. A policy since
     * deleted is said to be gone, rather than left out: the rule still
     * holds it, and the words that say so, in the reader's language, choose
     * the commas too. (An SLO since deleted is left out, as it always was.)
     */
    if (
      checkOn === NotificationRuleConditionCheckOn.Slos ||
      checkOn === NotificationRuleConditionCheckOn.OnCallDutyPolicies
    ) {
      const rows: Array<ServiceLevelObjective | OnCallDutyPolicy> =
        (checkOn === NotificationRuleConditionCheckOn.Slos
          ? props.serviceLevelObjectives
          : props.onCallDutyPolicies) || [];
      const picked: Set<string> = new Set(
        selectedIds.map((id: string): string => {
          return id.toLowerCase();
        }),
      );
      const found: Array<ServiceLevelObjective | OnCallDutyPolicy> = rows
        .filter((row: ServiceLevelObjective | OnCallDutyPolicy): boolean => {
          return (
            picked.has(row.id?.toString().toLowerCase() || "") &&
            Boolean(row.name)
          );
        })
        .filter(
          (
            row: ServiceLevelObjective | OnCallDutyPolicy,
            index: number,
            all: Array<ServiceLevelObjective | OnCallDutyPolicy>,
          ): boolean => {
            // Once each, however often the rule names it.
            return (
              all.findIndex(
                (other: ServiceLevelObjective | OnCallDutyPolicy): boolean => {
                  return (
                    other.id?.toString().toLowerCase() ===
                    row.id?.toString().toLowerCase()
                  );
                },
              ) === index
            );
          },
        );
      const isAPolicyGone: boolean =
        checkOn === NotificationRuleConditionCheckOn.OnCallDutyPolicies &&
        found.length < picked.size;
      const notFoundName: string = isAPolicyGone
        ? translator.translateText(VALUE_NOT_FOUND_NAME) || VALUE_NOT_FOUND_NAME
        : "";
      const separator: string = getListSeparator([
        ...found.map(
          (row: ServiceLevelObjective | OnCallDutyPolicy): string => {
            return row.name || "";
          },
        ),
        notFoundName,
      ]);

      valueElement = (
        <span
          className="font-medium text-gray-900"
          data-testid="notification-rule-condition-named-values"
        >
          {found.map(
            (
              row: ServiceLevelObjective | OnCallDutyPolicy,
              index: number,
            ): ReactElement => {
              /*
               * An archived one keeps its tag beside it: the tag never
               * starts the next line alone, where it would seem to mark
               * what follows.
               */
              return (
                <React.Fragment key={row.id?.toString() || `${index}`}>
                  {index > 0 ? separator : ""}
                  {isArchivedValue(row) ? (
                    <span
                      className="inline-flex max-w-full items-center gap-1"
                      data-testid="notification-rule-condition-archived-value"
                    >
                      <span className="min-w-0">{row.name || ""}</span>
                      <ArchivedTag isCompact={true} />
                    </span>
                  ) : (
                    row.name || ""
                  )}
                </React.Fragment>
              );
            },
          )}
          {isAPolicyGone ? (
            <>
              {found.length > 0 ? separator : ""}
              <span
                className="font-normal italic text-gray-500"
                data-testid="notification-rule-condition-value-not-found"
              >
                {notFoundName}
              </span>
            </>
          ) : (
            <></>
          )}
        </span>
      );
    }

    /*
     * Who owns the record: the people and teams picked, with their avatars,
     * as owners are drawn everywhere (PeopleList).
     */
    if (NotificationRuleConditionUtil.isOwnerCheckOn(checkOn)) {
      valueElement = (
        <PeopleList
          dataTestId="notification-rule-condition-owners"
          options={getOwnerConditionOptions({
            ids: selectedIds,
            users: props.users || [],
            teams: props.teams || [],
          })}
        />
      );
    }

    /*
     * What raised the case, and what moved in an SLO's error budget policy:
     * words of a fixed list, in the reader's language.
     */
    if (
      checkOn === NotificationRuleConditionCheckOn.SecurityCaseSource ||
      checkOn === NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange
    ) {
      valueElement = (
        <span className="font-medium text-gray-900">
          {joinList(
            selectedIds.map((value: string): string => {
              return translator.translateText(value) || value;
            }),
          )}
        </span>
      );
    }

    return valueElement;
  };

  /*
   * One line: what is checked, how, and the values - chips for states,
   * severities, labels and monitors - wrapping onto the next line when
   * they do not fit. What is checked and how are named as the Conditions
   * step's dropdowns name them, in the reader's language.
   */
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm leading-6">
      <span className="font-medium text-gray-900">
        {translator.translateText(
          props.notificationRuleCondition?.checkOn
            ? getCheckOnLabel(props.notificationRuleCondition.checkOn)
            : "",
        )}
      </span>
      <span
        className="text-gray-500"
        data-testid="notification-rule-condition-operator-words"
      >
        {translator.translateText(
          getConditionOperatorWords({
            checkOn: props.notificationRuleCondition?.checkOn,
            conditionType: props.notificationRuleCondition?.conditionType,
          }),
        )}
      </span>
      {getValueElement()}
    </div>
  );
};

export default NotificationRuleConditionElement;
